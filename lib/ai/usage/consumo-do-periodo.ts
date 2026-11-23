/**
 * FORK MIA (MIA-44) — QUANTO ESTE CLIENTE CONSUMIU DE IA NUM PERÍODO, quebrado
 * por agente, pela linha "Sistema" e pela finalidade da chamada.
 *
 * É a leitura que a aba Uso do cliente (`/api/v1/admin/tenants/[id]/usage`) e a
 * ferramenta `plataforma_ver_consumo_de_ia` do MCP de plataforma devolvem. As
 * duas chamam ESTA função, para o número da tela e o do MCP não divergirem.
 * Documento: `docs/fork/consumo-de-ia.md`.
 *
 * ── A régua do custo é a do teto ────────────────────────────────────────────
 *
 * Custo = soma de `coalesce(llm_calls.cost_cents, 0)`, a mesma definição de
 * `fn_gasto_de_ia_do_mes` (migration 0159). A soma é feita aqui, linha a linha,
 * e não numa soma nova escrita em SQL: a cerca
 * `tests/unit/orcamento-uma-regua-de-gasto.test.ts` impede a segunda régua.
 * Chamada sem preço (`cost_cents` nulo) entra como zero na soma, como na função,
 * e é CONTADA à parte (`sem_preco`): zero não é "de graça", é "preço desconhecido".
 *
 * ⚠️ O mês daqui é o de BRASÍLIA. O teto corta o mês pelo `now()` no fuso do
 * banco (UTC): o mês do teto começa às 21h do último dia do mês anterior, no
 * horário de Brasília. Para o mesmo mês, os dois números podem diferir pelas
 * chamadas dessas três horas. Mudar a régua do teto muda o que o cliente recebe e
 * é decisão do Gabriel; aqui só se mede.
 *
 * ── Agente e "Sistema" ──────────────────────────────────────────────────────
 *
 * Chamada com `agent_id` é do agente. Chamada sem `agent_id` é do SISTEMA: o
 * resumo depois da conversa (`checkpoint`), os classificadores, a promessa, o
 * jailbreak, a transcrição. Ela não some numa linha só do cliente: aparece
 * separada, porque é custo que não acompanha o número de agentes.
 *
 * ── Tokens ─────────────────────────────────────────────────────────────────
 *
 * `tokens_entrada` é `input_tokens` inteiro. `tokens_do_cache` é
 * `cache_read_tokens`, que é PARTE da entrada (o preço do catálogo cobra 10% da
 * tarifa por ele: `lib/agent-engine/edge/llm/preco-do-catalogo.ts`), e não um
 * terceiro tipo a somar.
 *
 * ── R$ ─────────────────────────────────────────────────────────────────────
 *
 * Cada chamada é convertida pela cotação do DIA dela, em Brasília, da tabela
 * `platform_fx_rates` (migration 0241), pela mesma regra da tela de uso
 * (`lib/ai/custo/cotacao.ts`: a do dia ou a mais recente anterior, nunca uma
 * posterior). Dia com custo e sem cotação nenhuma fica fora do total em real e
 * é DITO em `reais.dias_sem_cotacao`: o real passa a ser declaradamente parcial.
 *
 * ── A soma fecha com o total (MIA-136) ──────────────────────────────────────
 *
 * Cada linha arredondada sozinha (R$ a 2 casas, US$ a 4 casas de centavo) fazia
 * a soma dos agentes com o Sistema, ou a das finalidades, diferir do total em
 * centavos. O TOTAL MANDA: ele é o arredondamento do valor exato do período, e
 * as linhas se ajustam a ele pelo maior resto (`fecharPeloTotal`): cada linha
 * fica no valor dela para baixo ou para cima, e os centavos que faltam vão para
 * as de maior fração. Uma linha nunca se afasta mais de um centavo do exato.
 *
 * ── A plataforma inteira (MIA-136) ──────────────────────────────────────────
 *
 * `lerRankingDoConsumo` é o ranking das empresas por custo, a mesma visão da
 * tela geral (`/admin/usage`): todas as empresas menos as de demonstração
 * (`SEM_DEMONSTRACAO`), o mesmo `periodoDoPedido`. Cada empresa é lida por
 * esta mesma leitura (uma conta só), e o total da plataforma manda nas linhas
 * das empresas pela mesma regra: a soma das empresas fecha com ele.
 *
 * ── Paginado ───────────────────────────────────────────────────────────────
 *
 * `lib/leitura/todas-as-paginas.ts`, da chamada mais nova para a mais antiga.
 * Acima do teto de páginas a leitura sai `truncado: true` (o que ficou de fora é
 * o começo do período), e quem mostra avisa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cotacaoDoDia, type CotacaoDoDia } from "@/lib/ai/custo/cotacao";
import { janelaDoMes, mesNoFuso } from "@/lib/crm/metas/fuso";
import { SEM_DEMONSTRACAO } from "@/lib/demonstracao/fora-das-metricas";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";

/** O fuso do mês do calendário desta leitura. */
export const FUSO_DO_CONSUMO = "America/Sao_Paulo";

/** 100 páginas = 100 mil chamadas, o mesmo teto de `lib/ai/custo/consumo-de-ia.ts`. */
export const PAGINAS_MAXIMAS_DO_PERIODO = 100;

/** A janela em dias aceita, a mesma que a aba Uso já aceitava. */
export const DIAS_MINIMO = 1;
export const DIAS_MAXIMO = 180;
export const DIAS_PADRAO = 30;

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PeriodoDoConsumo {
  tipo: "mes" | "dias";
  /** AAAA-MM quando o período é um mês do calendário em Brasília. */
  mes: string | null;
  /** Os dias da janela. No mês, quantos dias o mês tem. */
  dias: number;
  /** Primeiro instante, em UTC. */
  inicio: string;
  /** Fim EXCLUSIVO, em UTC. */
  fim: string;
  fuso: typeof FUSO_DO_CONSUMO;
}

/**
 * O período pedido. `mes` vence `dias` quando os dois vêm. `mes` fora do formato
 * AAAA-MM devolve `null` (quem chama responde erro de validação, em vez de cair
 * em silêncio na janela padrão). `dias` inválido cai no padrão e é limitado a
 * 1..180, como a rota já fazia.
 *
 * MIA-78: `dias=N` são os N DIAS DO CALENDÁRIO EM BRASÍLIA terminados hoje,
 * hoje incluído: de 00:00 de (hoje − N + 1) a 00:00 de amanhã, em Brasília.
 * É a régua única de "N dias" da tela geral (`/admin/usage`), da aba Uso do
 * cliente e de `plataforma_ver_consumo_de_ia`. Antes a aba Uso e o MCP liam
 * N×24 h corridas até agora, e a tela geral N dias de calendário UTC: a mesma
 * chamada entrava numa e não na outra. Dia de Brasília porque o mês desta
 * leitura já é o de Brasília: um mês é a soma dos dias dele, e a série diária
 * da tela geral tem N barras inteiras.
 */
export function periodoDoPedido(
  pedido: { mes?: string | null; dias?: string | number | null },
  agora: Date = new Date(),
): PeriodoDoConsumo | null {
  const mes = pedido.mes?.trim();
  if (mes) {
    if (!MES_VALIDO.test(mes)) return null;
    const janela = janelaDoMes(mes, FUSO_DO_CONSUMO);
    const dias = Math.round((Date.parse(janela.fim) - Date.parse(janela.inicio)) / 86_400_000);
    return { tipo: "mes", mes, dias, inicio: janela.inicio, fim: janela.fim, fuso: FUSO_DO_CONSUMO };
  }
  const bruto = Number(pedido.dias ?? DIAS_PADRAO) || DIAS_PADRAO;
  const dias = Math.min(Math.max(Math.trunc(bruto), DIAS_MINIMO), DIAS_MAXIMO);
  const hoje = diaEmBrasilia(agora.toISOString());
  return {
    tipo: "dias",
    mes: null,
    dias,
    inicio: inicioDoDiaEmBrasilia(somarDias(hoje, 1 - dias)),
    fim: inicioDoDiaEmBrasilia(somarDias(hoje, 1)),
    fuso: FUSO_DO_CONSUMO,
  };
}

/** AAAA-MM-DD mais `n` dias do calendário (a conta é de data, sem fuso). */
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const FORMATADOR_DO_INSTANTE = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DO_CONSUMO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Quanto o relógio de Brasília está à frente do UTC naquele instante, em ms. */
function deslocamentoEmBrasilia(ms: number): number {
  const partes = FORMATADOR_DO_INSTANTE.formatToParts(new Date(ms));
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? "0");
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second")) - ms;
}

/**
 * 00:00 do dia AAAA-MM-DD em Brasília, em UTC. Duas passadas, como
 * `janelaDoMes`: o deslocamento depende do instante (o horário de verão de
 * antes de 2019), e o instante, do deslocamento.
 */
export function inicioDoDiaEmBrasilia(dia: string): string {
  const chute = Date.parse(`${dia}T00:00:00Z`);
  let real = chute;
  for (let i = 0; i < 2; i++) real = chute - deslocamentoEmBrasilia(real);
  return new Date(real).toISOString();
}

/** AAAA-MM de agora em Brasília, e o mês anterior: os dois atalhos das telas. */
export function mesAtualEAnterior(agora: Date = new Date()): { atual: string; anterior: string } {
  const atual = mesNoFuso(agora.toISOString(), FUSO_DO_CONSUMO);
  const [a, m] = atual.split("-").map(Number) as [number, number];
  const anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  return { atual, anterior };
}

export interface LinhaDeConsumo {
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  /** Quantos da ENTRADA vieram do cache (`cache_read_tokens`). Parte de `tokens_entrada`. */
  tokens_do_cache: number;
  /** Centavos de DÓLAR: soma de `coalesce(cost_cents, 0)`, a régua do teto. */
  custo_usd_cents: number;
  /** Reais, cada dia pela cotação dele. Parcial quando `reais.dias_sem_cotacao` não está vazio. */
  custo_brl: number;
  /** Chamadas com `cost_cents` nulo: entram como zero, e não são de graça. */
  sem_preco: number;
}

export interface ConsumoDoAgente extends LinhaDeConsumo {
  agent_id: string;
  /** `null` = o agente não existe mais na empresa (as chamadas ficaram). */
  nome: string | null;
  arquivado: boolean;
}

export interface ConsumoDaFinalidade extends LinhaDeConsumo {
  /** `llm_calls.purpose`: `agent_turn`, `checkpoint`, `classifier`... */
  finalidade: string;
}

export interface ConsumoDoPeriodo {
  periodo: PeriodoDoConsumo;
  total: LinhaDeConsumo;
  /** Todo agente da empresa (os sem chamada com zero), do mais caro para o mais barato. */
  por_agente: ConsumoDoAgente[];
  /** As chamadas sem `agent_id`. */
  sistema: LinhaDeConsumo;
  /** Por `purpose`, do mais caro para o mais barato. */
  por_finalidade: ConsumoDaFinalidade[];
  reais: {
    /** Dias (AAAA-MM-DD, Brasília) com custo e sem cotação nenhuma até eles. Fora do total em real. */
    dias_sem_cotacao: string[];
    /** A cotação mais recente usada no período, para a tela dizer de quando é. */
    ultima_cotacao: CotacaoDoDia | null;
  };
  /** O teto de páginas acabou antes do fim: o começo do período ficou de fora. */
  truncado: boolean;
  /** Quantas chamadas o banco disse haver no período. `null` = não disse. */
  chamadas_no_banco: number | null;
}

/** O que a leitura falhou em ler. Não lança: quem chama decide a resposta. */
export interface FalhaDoConsumo {
  erro: string;
}

interface ChamadaLida {
  agent_id: string | null;
  purpose: string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cache_read_tokens: number | string | null;
  cost_cents: number | string | null;
  created_at: string;
}

/** O dia de Brasília (AAAA-MM-DD), com UM formatador para a leitura inteira. */
const FORMATADOR_DO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DO_CONSUMO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function diaEmBrasilia(iso: string): string {
  return FORMATADOR_DO_DIA.format(new Date(iso));
}

function numero(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Acumulador de uma linha: os números e o custo por dia, para converter depois. */
interface Acumulado {
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_do_cache: number;
  custo_usd_cents: number;
  sem_preco: number;
  porDia: Map<string, number>;
}

function novoAcumulado(): Acumulado {
  return {
    chamadas: 0,
    tokens_entrada: 0,
    tokens_saida: 0,
    tokens_do_cache: 0,
    custo_usd_cents: 0,
    sem_preco: 0,
    porDia: new Map(),
  };
}

function somar(a: Acumulado, c: ChamadaLida, dia: string): void {
  a.chamadas++;
  a.tokens_entrada += numero(c.input_tokens);
  a.tokens_saida += numero(c.output_tokens);
  a.tokens_do_cache += numero(c.cache_read_tokens);
  // coalesce(cost_cents, 0): a régua de fn_gasto_de_ia_do_mes.
  const custo = numero(c.cost_cents);
  if (c.cost_cents === null || c.cost_cents === undefined) a.sem_preco++;
  a.custo_usd_cents += custo;
  a.porDia.set(dia, (a.porDia.get(dia) ?? 0) + custo);
}

/** Os reais EXATOS de uma linha, cada dia pela cotação dele (sem arredondar). */
function reaisExatos(a: Acumulado, historico: readonly CotacaoDoDia[]): number {
  let reais = 0;
  for (const [dia, cents] of a.porDia) {
    const taxa = cotacaoDoDia(historico, dia);
    if (taxa !== null) reais += (cents / 100) * taxa;
  }
  return reais;
}

/** O valor exato de uma linha, antes de arredondar: é dele que o total e as partes saem. */
interface Exato {
  reais: number;
  usd_cents: number;
}

function exatoDe(a: Acumulado, historico: readonly CotacaoDoDia[]): Exato {
  return { reais: reaisExatos(a, historico), usd_cents: a.custo_usd_cents };
}

function linha(a: Acumulado, custo_usd_cents: number, custo_brl: number): LinhaDeConsumo {
  return {
    chamadas: a.chamadas,
    tokens_entrada: a.tokens_entrada,
    tokens_saida: a.tokens_saida,
    tokens_do_cache: a.tokens_do_cache,
    custo_usd_cents,
    custo_brl,
    sem_preco: a.sem_preco,
  };
}

/**
 * MIA-136 — reparte o TOTAL arredondado entre as partes, e a soma delas fecha
 * com ele.
 *
 * O total é o valor exato arredondado a `casas`. Cada parte começa no seu valor
 * exato para baixo; as unidades que faltam para o total (nunca mais que uma por
 * parte) vão para as de maior fração, e no empate para a maior. Parte com fração
 * zero só recebe se não houver outra (resíduo de ponto flutuante). Assim cada
 * parte fica no seu valor para baixo ou para cima, e a soma é o total.
 *
 * Pressupõe que as partes somam o total (uma partição: agentes + Sistema,
 * finalidades, empresas). É exportada para o teste.
 */
export function fecharPeloTotal(
  totalExato: number,
  partesExatas: readonly number[],
  casas: number,
): { total: number; partes: number[] } {
  const fator = 10 ** casas;
  // O resíduo do ponto flutuante sai antes do piso: 12,35 não pode virar 12,34
  // porque a conta deu 1234,9999999. Perto de um inteiro, é o inteiro.
  const emUnidades = (n: number) => {
    const v = n * fator;
    const inteiro = Math.round(v);
    return Math.abs(v - inteiro) <= Math.max(1e-6, Math.abs(v) * 1e-12) ? inteiro : v;
  };
  const total = Math.round(emUnidades(totalExato));
  const pisos = partesExatas.map((p) => Math.floor(emUnidades(p)));
  const fracoes = partesExatas.map((p, i) => emUnidades(p) - pisos[i]!);
  let falta = total - pisos.reduce((s, n) => s + n, 0);
  const ordem = partesExatas
    .map((_, i) => i)
    .sort((x, y) => fracoes[y]! - fracoes[x]! || partesExatas[y]! - partesExatas[x]! || x - y);
  const partes = [...pisos];
  // `falta` fica entre 0 e o número de partes numa partição; o laço cobre o
  // resíduo de ponto flutuante nas duas direções sem dar volta infinita.
  for (let volta = 0; falta !== 0 && ordem.length > 0 && volta < ordem.length * 2; volta++) {
    if (falta > 0) {
      partes[ordem[volta % ordem.length]!]! += 1;
      falta--;
    } else {
      const i = ordem[ordem.length - 1 - (volta % ordem.length)]!;
      if (partes[i]! > 0) {
        partes[i]! -= 1;
        falta++;
      }
    }
  }
  return { total: total / fator, partes: partes.map((n) => n / fator) };
}

/**
 * O total e as partes de uma partição, com R$ (2 casas) e US$ (4 casas de
 * centavo) fechando pelo total.
 */
function fecharAsPartes(
  total: Acumulado,
  partes: readonly Acumulado[],
  historico: readonly CotacaoDoDia[],
): { total: LinhaDeConsumo; partes: LinhaDeConsumo[] } {
  const t = exatoDe(total, historico);
  const exatos = partes.map((p) => exatoDe(p, historico));
  return fecharExatos(total, t, partes, exatos);
}

function fecharExatos(
  total: Acumulado,
  t: Exato,
  partes: readonly Acumulado[],
  exatos: readonly Exato[],
): { total: LinhaDeConsumo; partes: LinhaDeConsumo[] } {
  const brl = fecharPeloTotal(t.reais, exatos.map((e) => e.reais), 2);
  const usd = fecharPeloTotal(t.usd_cents, exatos.map((e) => e.usd_cents), 4);
  return {
    total: linha(total, usd.total, brl.total),
    partes: partes.map((p, i) => linha(p, usd.partes[i]!, brl.partes[i]!)),
  };
}

/** O histórico de cotações que converte o período: o do período e a anterior a ele. */
async function lerCotacoesDoPeriodo(
  admin: Pick<SupabaseClient, "from">,
  periodo: PeriodoDoConsumo,
): Promise<{ historico: CotacaoDoDia[] } | FalhaDoConsumo> {
  const primeiroDia = diaEmBrasilia(periodo.inicio);
  // O fim é exclusivo: o último dia é o do instante logo antes dele.
  const ultimoDia = diaEmBrasilia(new Date(Date.parse(periodo.fim) - 1).toISOString());
  const [cotacoes, cotacaoAnterior] = await Promise.all([
    admin
      .from("platform_fx_rates")
      .select("dia, usd_brl")
      .gte("dia", primeiroDia)
      .lte("dia", ultimoDia)
      .order("dia", { ascending: false })
      .limit(400),
    // A cotação anterior ao período: um dia sem captura cai na mais recente
    // ANTES dele, e sem esta leitura o primeiro dia ficaria sem conversão
    // sempre que o cron tivesse falhado nele (a mesma da tela de uso).
    admin
      .from("platform_fx_rates")
      .select("dia, usd_brl")
      .lt("dia", primeiroDia)
      .order("dia", { ascending: false })
      .limit(1),
  ]);
  if (cotacoes.error) return { erro: cotacoes.error.message };
  if (cotacaoAnterior.error) return { erro: cotacaoAnterior.error.message };
  const historico: CotacaoDoDia[] = [...(cotacoes.data ?? []), ...(cotacaoAnterior.data ?? [])].map((r) => ({
    dia: String(r.dia),
    usd_brl: Number(r.usd_brl),
  }));
  return { historico };
}

/** O consumo de uma empresa e o valor exato do total dela, para o ranking fechar pela plataforma. */
interface ConsumoComExato {
  consumo: ConsumoDoPeriodo;
  totalAcumulado: Acumulado;
  totalExato: Exato;
}

/** A leitura e as somas de UMA organização, com o histórico de cotações já lido. */
async function lerConsumoComCotacoes(
  admin: Pick<SupabaseClient, "from">,
  organizationId: string,
  periodo: PeriodoDoConsumo,
  historico: readonly CotacaoDoDia[],
): Promise<ConsumoComExato | FalhaDoConsumo> {
  const [lido, agentes] = await Promise.all([
    lerTodasAsPaginas<ChamadaLida>(
      (de, ate, pedirContagem) =>
        admin
          .from("llm_calls")
          .select(
            "agent_id, purpose, input_tokens, output_tokens, cache_read_tokens, cost_cents, created_at",
            pedirContagem ? { count: "exact" } : undefined,
          )
          .eq("organization_id", organizationId)
          .gte("created_at", periodo.inicio)
          .lt("created_at", periodo.fim)
          // Da mais nova para a mais antiga, com `id` de desempate: ordem única,
          // e se o teto cortar, o que fica de fora é o começo do período.
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS_DO_PERIODO },
    ),
    // Arquivados também: o agente arquivado no meio do mês gastou até ali.
    admin.from("ai_agents").select("id, name, archived_at").eq("organization_id", organizationId),
  ]);

  if (lido.erro) return { erro: lido.erro };
  if (agentes.error) return { erro: agentes.error.message };

  const total = novoAcumulado();
  const sistema = novoAcumulado();
  const porAgente = new Map<string, Acumulado>();
  const porFinalidade = new Map<string, Acumulado>();
  const diasComCusto = new Set<string>();

  for (const c of lido.linhas) {
    const dia = diaEmBrasilia(c.created_at);
    if (numero(c.cost_cents) > 0) diasComCusto.add(dia);
    somar(total, c, dia);
    if (c.agent_id) {
      let a = porAgente.get(c.agent_id);
      if (!a) porAgente.set(c.agent_id, (a = novoAcumulado()));
      somar(a, c, dia);
    } else {
      somar(sistema, c, dia);
    }
    const finalidade = c.purpose || "sem_finalidade";
    let f = porFinalidade.get(finalidade);
    if (!f) porFinalidade.set(finalidade, (f = novoAcumulado()));
    somar(f, c, dia);
  }

  const cadastro = new Map(
    ((agentes.data ?? []) as Array<{ id: string; name: string | null; archived_at: string | null }>).map((a) => [a.id, a]),
  );
  // Todo agente ativo aparece, mesmo sem chamada: "o segundo agente não gastou
  // nada" é resposta, e a linha sumida pareceria agente que não existe.
  for (const a of cadastro.values()) {
    if (!a.archived_at && !porAgente.has(a.id)) porAgente.set(a.id, novoAcumulado());
  }

  const porCusto = (x: LinhaDeConsumo, y: LinhaDeConsumo) =>
    y.custo_usd_cents - x.custo_usd_cents || y.chamadas - x.chamadas;

  // MIA-136: os agentes e o Sistema são uma partição do total, e fecham com ele.
  const listaDeAgentes = [...porAgente.entries()];
  const daPartilha = fecharAsPartes(total, [...listaDeAgentes.map(([, a]) => a), sistema], historico);

  const por_agente: ConsumoDoAgente[] = listaDeAgentes
    .map(([agent_id], i) => {
      const registro = cadastro.get(agent_id);
      return {
        agent_id,
        nome: registro?.name ?? null,
        arquivado: Boolean(registro?.archived_at),
        ...daPartilha.partes[i]!,
      };
    })
    .sort((x, y) => porCusto(x, y) || (x.nome ?? "").localeCompare(y.nome ?? ""));

  // As finalidades também são uma partição do total.
  const finalidades = [...porFinalidade.entries()];
  const dasFinalidades = fecharAsPartes(total, finalidades.map(([, a]) => a), historico);
  const por_finalidade: ConsumoDaFinalidade[] = finalidades
    .map(([finalidade], i) => ({ finalidade, ...dasFinalidades.partes[i]! }))
    .sort((x, y) => porCusto(x, y) || x.finalidade.localeCompare(y.finalidade));

  const dias_sem_cotacao = [...diasComCusto].filter((dia) => cotacaoDoDia(historico, dia) === null).sort();
  const ultima = historico.reduce<CotacaoDoDia | null>((m, l) => (!m || l.dia > m.dia ? l : m), null);

  return {
    consumo: {
      periodo,
      total: daPartilha.total,
      por_agente,
      sistema: daPartilha.partes[listaDeAgentes.length]!,
      por_finalidade,
      reais: { dias_sem_cotacao, ultima_cotacao: ultima },
      truncado: lido.truncado,
      chamadas_no_banco: lido.total,
    },
    totalAcumulado: total,
    totalExato: exatoDe(total, historico),
  };
}

/**
 * Lê e soma o consumo de IA de UMA organização no período.
 *
 * `admin` é o cliente de serviço: `llm_calls`, `ai_agents` e `platform_fx_rates`
 * são lidos sem RLS, e o filtro por `organization_id` é o que isola.
 */
export async function lerConsumoDoPeriodo(
  admin: Pick<SupabaseClient, "from">,
  organizationId: string,
  periodo: PeriodoDoConsumo,
): Promise<ConsumoDoPeriodo | FalhaDoConsumo> {
  const cotacoes = await lerCotacoesDoPeriodo(admin, periodo);
  if ("erro" in cotacoes) return cotacoes;
  const lido = await lerConsumoComCotacoes(admin, organizationId, periodo, cotacoes.historico);
  return "erro" in lido ? lido : lido.consumo;
}

export function falhouOConsumo<T extends object>(r: T | FalhaDoConsumo): r is FalhaDoConsumo {
  return "erro" in r;
}

// ---------------------------------------------------------------------------
// MIA-136 · a plataforma inteira: as empresas em ordem de custo
// ---------------------------------------------------------------------------

/** Quantas empresas são lidas ao mesmo tempo no ranking. */
const EMPRESAS_EM_PARALELO = 5;

export interface ConsumoDaEmpresa extends LinhaDeConsumo {
  /** 1 = a que mais custou. */
  posicao: number;
  organization_id: string;
  empresa: string;
  slug: string | null;
  /** Dias da empresa com custo e sem cotação: o R$ dela é parcial. */
  dias_sem_cotacao: string[];
  /** A leitura desta empresa passou do teto de páginas. */
  truncado: boolean;
}

export interface RankingDoConsumo {
  periodo: PeriodoDoConsumo;
  /** A plataforma inteira, sem as empresas de demonstração. As empresas fecham com ele. */
  total: LinhaDeConsumo;
  /** Todas as empresas (as sem chamada com zero), da mais cara para a mais barata. */
  empresas: ConsumoDaEmpresa[];
  reais: {
    dias_sem_cotacao: string[];
    ultima_cotacao: CotacaoDoDia | null;
  };
  /** Alguma empresa passou do teto de páginas: o começo do período dela ficou de fora. */
  truncado: boolean;
  /** A soma do que o banco disse haver. `null` = alguma empresa não disse. */
  chamadas_no_banco: number | null;
}

interface EmpresaLida {
  id: string;
  display_name: string | null;
  slug: string | null;
}

/**
 * O consumo de IA da PLATAFORMA no período: cada empresa (menos as de
 * demonstração, como na tela geral `/admin/usage`) lida por esta mesma leitura,
 * em ordem de custo. O total é o da plataforma, e o custo das empresas fecha
 * com ele (`fecharPeloTotal`).
 *
 * Ordem: custo em US$ (a régua do teto, a mesma da tela geral), depois
 * chamadas, depois o nome.
 */
export async function lerRankingDoConsumo(
  admin: Pick<SupabaseClient, "from">,
  periodo: PeriodoDoConsumo,
): Promise<RankingDoConsumo | FalhaDoConsumo> {
  const [orgs, cotacoes] = await Promise.all([
    lerTodasAsPaginas<EmpresaLida>(
      (de, ate, pedirContagem) =>
        admin
          .from("organizations")
          .select("id, display_name, slug", pedirContagem ? { count: "exact" } : undefined)
          // A empresa de demonstração não entra no uso da plataforma (cliente modelo, 9010).
          .not(...SEM_DEMONSTRACAO)
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: 10 },
    ),
    lerCotacoesDoPeriodo(admin, periodo),
  ]);
  if (orgs.erro) return { erro: orgs.erro };
  if ("erro" in cotacoes) return cotacoes;
  if (orgs.truncado) return { erro: "a lista de empresas passou do teto de leitura" };

  const lidas: Array<{ org: EmpresaLida; lido: ConsumoComExato }> = [];
  for (let i = 0; i < orgs.linhas.length; i += EMPRESAS_EM_PARALELO) {
    const lote = orgs.linhas.slice(i, i + EMPRESAS_EM_PARALELO);
    const resultados = await Promise.all(
      lote.map(async (org) => ({
        org,
        lido: await lerConsumoComCotacoes(admin, org.id, periodo, cotacoes.historico),
      })),
    );
    for (const r of resultados) {
      if ("erro" in r.lido) return { erro: r.lido.erro };
      lidas.push({ org: r.org, lido: r.lido });
    }
  }

  // O total da plataforma: a soma dos acumulados de cada empresa.
  const total = novoAcumulado();
  for (const { lido } of lidas) {
    const a = lido.totalAcumulado;
    total.chamadas += a.chamadas;
    total.tokens_entrada += a.tokens_entrada;
    total.tokens_saida += a.tokens_saida;
    total.tokens_do_cache += a.tokens_do_cache;
    total.custo_usd_cents += a.custo_usd_cents;
    total.sem_preco += a.sem_preco;
  }
  const totalExato: Exato = {
    reais: lidas.reduce((s, l) => s + l.lido.totalExato.reais, 0),
    usd_cents: total.custo_usd_cents,
  };
  const fechado = fecharExatos(
    total,
    totalExato,
    lidas.map((l) => l.lido.totalAcumulado),
    lidas.map((l) => l.lido.totalExato),
  );

  const empresas = lidas
    .map(({ org, lido }, i) => ({
      org,
      lido,
      linha: fechado.partes[i]!,
    }))
    .sort(
      (x, y) =>
        y.lido.totalExato.usd_cents - x.lido.totalExato.usd_cents ||
        y.linha.chamadas - x.linha.chamadas ||
        (x.org.display_name ?? "").localeCompare(y.org.display_name ?? ""),
    )
    .map(({ org, lido, linha: l }, i): ConsumoDaEmpresa => ({
      posicao: i + 1,
      organization_id: org.id,
      empresa: org.display_name ?? org.id,
      slug: org.slug ?? null,
      ...l,
      dias_sem_cotacao: lido.consumo.reais.dias_sem_cotacao,
      truncado: lido.consumo.truncado,
    }));

  const dias = new Set<string>();
  for (const { lido } of lidas) for (const d of lido.consumo.reais.dias_sem_cotacao) dias.add(d);
  const ultima = cotacoes.historico.reduce<CotacaoDoDia | null>((m, l) => (!m || l.dia > m.dia ? l : m), null);
  const contagens = lidas.map((l) => l.lido.consumo.chamadas_no_banco);

  return {
    periodo,
    total: fechado.total,
    empresas,
    reais: { dias_sem_cotacao: [...dias].sort(), ultima_cotacao: ultima },
    truncado: lidas.some((l) => l.lido.consumo.truncado),
    chamadas_no_banco: contagens.some((c) => c === null) ? null : contagens.reduce<number>((s, c) => s + (c ?? 0), 0),
  };
}

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
 * ── Paginado ───────────────────────────────────────────────────────────────
 *
 * `lib/leitura/todas-as-paginas.ts`, da chamada mais nova para a mais antiga.
 * Acima do teto de páginas a leitura sai `truncado: true` (o que ficou de fora é
 * o começo do período), e quem mostra avisa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cotacaoDoDia, type CotacaoDoDia } from "@/lib/ai/custo/cotacao";
import { janelaDoMes, mesNoFuso } from "@/lib/crm/metas/fuso";
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
  return {
    tipo: "dias",
    mes: null,
    dias,
    inicio: new Date(agora.getTime() - dias * 86_400_000).toISOString(),
    fim: agora.toISOString(),
    fuso: FUSO_DO_CONSUMO,
  };
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

/** Quatro casas: tira o resíduo de ponto flutuante sem apagar fração de centavo. */
function quatroCasas(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function fechar(a: Acumulado, historico: readonly CotacaoDoDia[]): LinhaDeConsumo {
  let reais = 0;
  for (const [dia, cents] of a.porDia) {
    const taxa = cotacaoDoDia(historico, dia);
    if (taxa !== null) reais += (cents / 100) * taxa;
  }
  return {
    chamadas: a.chamadas,
    tokens_entrada: a.tokens_entrada,
    tokens_saida: a.tokens_saida,
    tokens_do_cache: a.tokens_do_cache,
    custo_usd_cents: quatroCasas(a.custo_usd_cents),
    custo_brl: Math.round(reais * 100) / 100,
    sem_preco: a.sem_preco,
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
  const primeiroDia = diaEmBrasilia(periodo.inicio);
  // O fim é exclusivo: o último dia é o do instante logo antes dele.
  const ultimoDia = diaEmBrasilia(new Date(Date.parse(periodo.fim) - 1).toISOString());

  const [lido, agentes, cotacoes, cotacaoAnterior] = await Promise.all([
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

  if (lido.erro) return { erro: lido.erro };
  if (agentes.error) return { erro: agentes.error.message };
  if (cotacoes.error) return { erro: cotacoes.error.message };
  if (cotacaoAnterior.error) return { erro: cotacaoAnterior.error.message };

  const historico: CotacaoDoDia[] = [...(cotacoes.data ?? []), ...(cotacaoAnterior.data ?? [])].map((r) => ({
    dia: String(r.dia),
    usd_brl: Number(r.usd_brl),
  }));

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

  const por_agente: ConsumoDoAgente[] = [...porAgente.entries()]
    .map(([agent_id, a]) => {
      const registro = cadastro.get(agent_id);
      return {
        agent_id,
        nome: registro?.name ?? null,
        arquivado: Boolean(registro?.archived_at),
        ...fechar(a, historico),
      };
    })
    .sort((x, y) => porCusto(x, y) || (x.nome ?? "").localeCompare(y.nome ?? ""));

  const por_finalidade: ConsumoDaFinalidade[] = [...porFinalidade.entries()]
    .map(([finalidade, a]) => ({ finalidade, ...fechar(a, historico) }))
    .sort((x, y) => porCusto(x, y) || x.finalidade.localeCompare(y.finalidade));

  const dias_sem_cotacao = [...diasComCusto].filter((dia) => cotacaoDoDia(historico, dia) === null).sort();
  const ultima = historico.reduce<CotacaoDoDia | null>((m, l) => (!m || l.dia > m.dia ? l : m), null);

  return {
    periodo,
    total: fechar(total, historico),
    por_agente,
    sistema: fechar(sistema, historico),
    por_finalidade,
    reais: { dias_sem_cotacao, ultima_cotacao: ultima },
    truncado: lido.truncado,
    chamadas_no_banco: lido.total,
  };
}

export function falhouOConsumo(r: ConsumoDoPeriodo | FalhaDoConsumo): r is FalhaDoConsumo {
  return "erro" in r;
}

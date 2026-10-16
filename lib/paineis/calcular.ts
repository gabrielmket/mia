/**
 * FORK MIA (item 8) — OS DOZE PAINÉIS PRONTOS, montados por cima do motor.
 *
 * Cada painel é UMA pergunta ao motor (`fn_mia_relatorio`, migration 9030) e a
 * leitura da resposta no formato que a tela desenha. Os doze saem em paralelo,
 * e nenhum número é recalculado aqui: o que se faz é escolher grupo, nomear e
 * dividir (taxa de faltas, % que segue adiante), sempre sobre números que o
 * banco já somou com todas as linhas.
 *
 * ── As três telas que usam, e o que muda entre elas ────────────────────────
 *
 * - `/app/paineis` (a sessão de quem usa): o motor vê o que a RLS deixa ver.
 * - `/painel/<token>` (o link do dono, cliente de serviço): só os painéis do
 *   link, com ou sem valores, e NUNCA um agrupamento que identifique pessoa (o
 *   catálogo daqui não tem nenhum: os doze prontos não agrupam por responsável).
 * - `plataforma_ver_paineis` (o MCP, cliente de serviço).
 *
 * ── A palavra do segmento ──────────────────────────────────────────────────
 *
 * Vem do VOCABULÁRIO do funil (`crm_pipelines.vocabulary`), não de código por
 * nicho: "Avaliações" na clínica, "Visitas" na construtora. O título do painel
 * de agenda é `vocabulary.compromisso_plural`; os rótulos de ganho e perda são
 * `won` e `lost`, os mesmos que o quadro do funil mostra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";

import {
  PAINEIS_PRONTOS,
  PERGUNTA_DO_PAINEL,
  ROTULO_DA_ORIGEM,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DE_OUTROS,
  ROTULO_DO_SEM,
  TITULO_DO_PAINEL,
  type ChaveDoPainel,
  type PeriodoDosPaineis,
} from "./catalogo";
import {
  consultarMotor,
  grupo,
  numero,
  RecusaDoMotor,
  type PedidoAoMotor,
  type RespostaDoMotor,
} from "./motor";

// ─── O que cada painel entrega para a tela ──────────────────────────────────

export interface LinhaRotulada {
  chave: string;
  /** Texto pronto (dado do banco) ou rótulo codificado a traduzir (`traduzir: true`). */
  rotulo: string;
  traduzir: boolean;
  n: number;
}

export type DadosDoPainel =
  | {
      tipo: "resultado";
      ganhos: number;
      perdidos: number;
      abertos: number;
      taxaDeGanho: number | null;
      valorGanho: number | null;
      diasAteFechar: number | null;
      foraDaMoeda: number;
    }
  | {
      tipo: "meta";
      temMeta: boolean;
      alvo: number | null;
      realizado: number | null;
      fracao: number | null;
      corrido: number | null;
    }
  | {
      tipo: "funil";
      etapas: Array<{ chave: string; nome: string; chegaram: number; seguemAdiante: number | null; ganho: boolean }>;
    }
  | { tipo: "origem"; linhas: Array<LinhaRotulada & { fecharam: number }> }
  | { tipo: "perdas"; linhas: LinhaRotulada[]; total: number }
  | { tipo: "atendimento"; total: number; agente: number; equipe: number; semResposta: number; resolvidas: number | null }
  | { tipo: "resposta"; agente: number | null; equipeMetade: number | null; equipeNoveEmDez: number | null; conversas: number }
  | {
      tipo: "agenda";
      marcadas: number;
      confirmadas: number;
      realizadas: number;
      faltas: number;
      desmarcadas: number;
      taxaDeFaltas: number | null;
    }
  | { tipo: "followup"; receberam: number; responderam: number; viraramVenda: number; pediramParaParar: number; taxa: number | null }
  | { tipo: "anuncios"; plataformas: Array<{ chave: string; rotulo: string; informados: number; aceitos: number }> }
  | {
      tipo: "previsao";
      previsto: number | null;
      abertos: number;
      semProbabilidade: number;
      meses: Array<{ chave: string; previsto: number | null; n: number }>;
    }
  | { tipo: "assuntos"; linhas: LinhaRotulada[] };

export interface PainelCalculado {
  chave: ChaveDoPainel;
  /** O título já com a palavra do segmento (agenda) — a tela traduz o que não for dado. */
  titulo: string;
  tituloEDado: boolean;
  pergunta: string;
  /** Preenchido quando o painel não pôde ser calculado para quem pergunta. */
  restrito: "so_gestor" | null;
  erro: string | null;
  dados: DadosDoPainel | null;
}

export interface VocabularioDoFunil {
  lead?: string;
  lead_plural?: string;
  deal?: string;
  deal_plural?: string;
  won?: string;
  lost?: string;
  compromisso?: string;
  compromisso_plural?: string;
}

export interface PaineisCalculados {
  organizationId: string;
  empresa: { nome: string; demonstracao: boolean; fuso: string; moeda: string };
  periodo: PeriodoDosPaineis;
  janela: { de: string | null; ate: string | null; hoje: string | null };
  funil: { id: string; nome: string; vocabulario: VocabularioDoFunil } | null;
  funis: Array<{ id: string; nome: string }>;
  valores: boolean;
  paineis: PainelCalculado[];
  calculadoEm: string;
}

export interface OpcoesDosPaineis {
  organizationId: string;
  periodo: PeriodoDosPaineis;
  paineis?: readonly ChaveDoPainel[];
  /** Nulo: o funil principal da empresa. */
  pipelineId?: string | null;
  /** `false`: nenhum valor em reais sai (o link "só quantidades"). */
  valores?: boolean;
  agora?: string | null;
}

// ─── A empresa e o funil ────────────────────────────────────────────────────

interface FunilLido {
  id: string;
  name: string;
  vocabulary: unknown;
  is_default: boolean;
  is_archived: boolean;
  position: number | string;
}

function vocabularioDe(bruto: unknown): VocabularioDoFunil {
  if (!bruto || typeof bruto !== "object") return {};
  const v = bruto as Record<string, unknown>;
  const texto = (k: string): string | undefined =>
    typeof v[k] === "string" && (v[k] as string).trim() ? (v[k] as string).trim() : undefined;
  return {
    lead: texto("lead"),
    lead_plural: texto("lead_plural"),
    deal: texto("deal"),
    deal_plural: texto("deal_plural"),
    won: texto("won"),
    lost: texto("lost"),
    compromisso: texto("compromisso"),
    compromisso_plural: texto("compromisso_plural"),
  };
}

async function lerEmpresaEFunis(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
): Promise<{ empresa: PaineisCalculados["empresa"]; funis: FunilLido[] }> {
  const [org, funis] = await Promise.all([
    db
      .from("organizations")
      .select("display_name, timezone, currency, demonstracao")
      .eq("id", organizationId)
      .maybeSingle(),
    db
      .from("crm_pipelines")
      .select("id, name, vocabulary, is_default, is_archived, position")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true }),
  ]);
  if (org.error) throw new Error(`não li a empresa: ${org.error.message}`);
  if (!org.data) throw new RecusaDoMotor("22023", "organizacao_inexistente");
  if (funis.error) throw new Error(`não li os funis: ${funis.error.message}`);
  const o = org.data as { display_name: string; timezone: string | null; currency: string | null; demonstracao?: boolean };
  return {
    empresa: {
      nome: o.display_name,
      demonstracao: o.demonstracao === true,
      fuso: o.timezone || "America/Sao_Paulo",
      moeda: o.currency || "BRL",
    },
    funis: (funis.data ?? []) as FunilLido[],
  };
}

/** O funil pedido (se for da empresa e não estiver arquivado) ou o principal. */
export function escolherFunil(funis: readonly FunilLido[], pedido?: string | null): FunilLido | null {
  const vivos = funis.filter((f) => !f.is_archived);
  if (pedido) {
    const achado = vivos.find((f) => f.id === pedido);
    if (achado) return achado;
  }
  return (
    vivos.find((f) => f.is_default) ??
    [...vivos].sort((a, b) => Number(a.position) - Number(b.position))[0] ??
    null
  );
}

// ─── Cada painel: a pergunta ao motor e a leitura da resposta ───────────────

type Pergunta = Omit<PedidoAoMotor, "organizationId" | "periodo" | "valores" | "agora"> & {
  periodo?: PedidoAoMotor["periodo"];
};

function perguntaDo(painel: ChaveDoPainel, funil: string | null): Pergunta {
  const doFunil: Record<string, string> = funil ? { funil } : {};
  switch (painel) {
    case "resultado":
      return { fonte: "negocios", medidas: ["qtd", "soma", "tfechar"], dim1: "situacao", filtros: doFunil };
    case "meta":
      // A meta é da empresa inteira e o realizado vem dos funis em que vencer é
      // receita (a régua de app/api/v1/metas/route.ts). Sempre o mês corrente.
      return {
        fonte: "negocios",
        medidas: ["soma"],
        filtros: { situacao: "ganho", so_receita: true },
        periodo: "mes",
      };
    case "funil":
      return { fonte: "negocios", medidas: ["chegaram"], dim1: "etapa", filtros: doFunil };
    case "origem":
      return { fonte: "negocios", medidas: ["qtd"], dim1: "origem", dim2: "situacao", filtros: doFunil };
    case "perdas":
      return { fonte: "negocios", medidas: ["qtd"], dim1: "motivo", filtros: { ...doFunil, situacao: "perdido" } };
    case "atendimento":
      return { fonte: "conversas", medidas: ["qtd", "resolv"], dim1: "quem" };
    case "resposta":
      return { fonte: "conversas", medidas: ["tresp", "tresp90"], dim1: "quem" };
    case "agenda":
      return { fonte: "agenda", medidas: ["qtd", "comp"], dim1: "situacao" };
    case "followup":
      return { fonte: "followup", medidas: ["qtd", "taxa"], dim1: "resultado" };
    case "anuncios":
      return { fonte: "anuncios", medidas: ["qtd", "aceito"], dim1: "plataforma" };
    case "previsao":
      // Os negócios abertos HOJE, qualquer que seja a data de entrada: a
      // previsão olha para a frente (a mesma regra de lib/leads/previsao.ts).
      return {
        fonte: "negocios",
        medidas: ["prev", "qtd", "sem_prob"],
        dim1: "previsto",
        filtros: { ...doFunil, situacao: "aberto" },
        periodo: "tudo",
      };
    case "assuntos":
      return { fonte: "conversas", medidas: ["qtd"], dim1: "etiqueta" };
  }
}

/**
 * Os grupos com rótulo. "Sem …" e "Outros" levam o texto codificado (a tela
 * traduz); o resto, o que `rotular` disser. `semZeros` tira os grupos vazios,
 * menos o "Sem …", que fica sempre (decisão do protótipo: o buraco no cadastro
 * também é informação).
 */
function linhasRotuladas(
  r: RespostaDoMotor,
  dim: string,
  rotular: (chave: string) => { rotulo: string; traduzir: boolean },
  opcoes: { semZeros?: boolean } = {},
): LinhaRotulada[] {
  return r.grupos
    .filter((g) => !opcoes.semZeros || g.n > 0 || g.sem)
    .map((g) => {
      if (g.outros) return { chave: g.chave, rotulo: ROTULO_DE_OUTROS, traduzir: true, n: g.n };
      if (g.sem) return { chave: g.chave, rotulo: ROTULO_DO_SEM[dim] ?? "Sem informação", traduzir: true, n: g.n };
      return { chave: g.chave, n: g.n, ...rotular(g.chave) };
    });
}

function rotuloDaOrigem(chave: string): { rotulo: string; traduzir: boolean } {
  const conhecido = ROTULO_DA_ORIGEM[chave];
  return conhecido ? { rotulo: conhecido, traduzir: true } : { rotulo: chave, traduzir: false };
}

function lerPainel(painel: ChaveDoPainel, r: RespostaDoMotor): DadosDoPainel {
  switch (painel) {
    case "resultado": {
      const ganhos = grupo(r, "ganho")?.n ?? 0;
      const perdidos = grupo(r, "perdido")?.n ?? 0;
      return {
        tipo: "resultado",
        ganhos,
        perdidos,
        abertos: grupo(r, "aberto")?.n ?? 0,
        taxaDeGanho: ganhos + perdidos > 0 ? Math.round((ganhos * 1000) / (ganhos + perdidos)) / 10 : null,
        valorGanho: numero(grupo(r, "ganho"), "soma"),
        diasAteFechar: numero(grupo(r, "ganho"), "tfechar"),
        foraDaMoeda: r.fora_da_moeda,
      };
    }
    case "meta":
      return {
        tipo: "meta",
        temMeta: r.meta !== null,
        alvo: r.meta?.alvo_cents ?? null,
        realizado: numero(r.total, "soma"),
        fracao: r.meta?.fracao ?? null,
        corrido: r.meta?.corrido ?? null,
      };
    case "funil": {
      const etapas = r.grupos.map((g, i) => {
        const seguinte = r.grupos[i + 1];
        return {
          chave: g.chave,
          nome: g.rotulo ?? "",
          chegaram: g.n,
          seguemAdiante: seguinte && g.n > 0 ? Math.round((seguinte.n * 1000) / g.n) / 10 : null,
          ganho: g.ganho === true,
        };
      });
      return { tipo: "funil", etapas };
    }
    case "origem":
      return {
        tipo: "origem",
        linhas: linhasRotuladas(r, "origem", rotuloDaOrigem).map((l) => {
          const g = grupo(r, l.chave);
          return { ...l, fecharam: g?.series?.ganho?.n ?? 0 };
        }),
      };
    case "perdas":
      return {
        tipo: "perdas",
        total: r.total.n,
        linhas: linhasRotuladas(r, "motivo", (chave) => {
          const rotulo = rotuloDoMotivoDePerda(chave);
          // O canônico tem rótulo em português (a tela traduz); o do funil é dado.
          return { rotulo, traduzir: rotulo !== chave };
        }),
      };
    case "atendimento":
      return {
        tipo: "atendimento",
        total: r.total.n,
        agente: grupo(r, "agente")?.n ?? 0,
        equipe: grupo(r, "equipe")?.n ?? 0,
        semResposta: grupo(r, "sem_resposta")?.n ?? 0,
        resolvidas: numero(r.total, "resolv"),
      };
    case "resposta":
      return {
        tipo: "resposta",
        agente: numero(grupo(r, "agente"), "tresp"),
        equipeMetade: numero(grupo(r, "equipe"), "tresp"),
        equipeNoveEmDez: numero(grupo(r, "equipe"), "tresp90"),
        conversas: r.total.n,
      };
    case "agenda": {
      const n = (k: string) => grupo(r, k)?.n ?? 0;
      const realizadas = n("compareceu");
      const faltas = n("faltou");
      return {
        tipo: "agenda",
        // "Marcadas" é tudo que ficou de pé: desmarcado não é compromisso.
        marcadas: r.total.n - n("desmarcou"),
        confirmadas: n("confirmado") + realizadas + faltas,
        realizadas,
        faltas,
        desmarcadas: n("desmarcou"),
        taxaDeFaltas: realizadas + faltas > 0 ? Math.round((faltas * 1000) / (realizadas + faltas)) / 10 : null,
      };
    }
    case "followup": {
      const n = (k: string) => grupo(r, k)?.n ?? 0;
      return {
        tipo: "followup",
        receberam: r.total.n,
        responderam: n("respondeu") + n("fechou"),
        viraramVenda: n("fechou"),
        pediramParaParar: n("parou"),
        taxa: numero(r.total, "taxa"),
      };
    }
    case "anuncios":
      return {
        tipo: "anuncios",
        plataformas: r.grupos
          .filter((g) => g.n > 0)
          .map((g) => ({
            chave: g.chave,
            rotulo: ROTULO_DA_PLATAFORMA[g.chave] ?? g.chave,
            informados: g.n,
            aceitos: g.n_ok,
          })),
      };
    case "previsao":
      return {
        tipo: "previsao",
        previsto: numero(r.total, "prev"),
        abertos: r.total.n,
        semProbabilidade: numero(r.total, "sem_prob") ?? 0,
        meses: r.grupos
          .filter((g) => g.n > 0)
          .map((g) => ({ chave: g.chave, previsto: numero(g, "prev"), n: g.n })),
      };
    case "assuntos":
      return {
        tipo: "assuntos",
        linhas: linhasRotuladas(r, "etiqueta", (chave) => ({ rotulo: chave, traduzir: false }), { semZeros: true }),
      };
  }
}

// ─── A montagem ─────────────────────────────────────────────────────────────

/**
 * Os painéis pedidos, na ordem pedida, cada um com a sua resposta ou com o
 * motivo de não ter resposta. Um painel recusado (anúncios para quem não é
 * gestor) ou com erro não derruba os outros.
 */
export async function calcularPaineis(
  db: Pick<SupabaseClient, "from" | "rpc">,
  opcoes: OpcoesDosPaineis,
): Promise<PaineisCalculados> {
  const { empresa, funis } = await lerEmpresaEFunis(db, opcoes.organizationId);
  const funil = escolherFunil(funis, opcoes.pipelineId);
  const vocabulario = vocabularioDe(funil?.vocabulary);
  const valores = opcoes.valores ?? true;
  const pedidos = (opcoes.paineis && opcoes.paineis.length > 0 ? opcoes.paineis : PAINEIS_PRONTOS).filter(
    (p, i, todos) => todos.indexOf(p) === i,
  );

  let janela: PaineisCalculados["janela"] = { de: null, ate: null, hoje: null };

  const paineis = await Promise.all(
    pedidos.map(async (chave): Promise<PainelCalculado> => {
      const tituloDoSegmento = chave === "agenda" ? vocabulario.compromisso_plural : undefined;
      const base: Omit<PainelCalculado, "dados" | "erro" | "restrito"> = {
        chave,
        titulo: tituloDoSegmento ?? TITULO_DO_PAINEL[chave],
        tituloEDado: Boolean(tituloDoSegmento),
        pergunta: PERGUNTA_DO_PAINEL[chave],
      };
      const pergunta = perguntaDo(chave, funil?.id ?? null);
      try {
        const resposta = await consultarMotor(db, {
          organizationId: opcoes.organizationId,
          valores,
          agora: opcoes.agora ?? null,
          ...pergunta,
          periodo: pergunta.periodo ?? opcoes.periodo,
        });
        if (!pergunta.periodo) {
          janela = { de: resposta.janela.de, ate: resposta.janela.ate, hoje: resposta.janela.hoje };
        }
        return { ...base, restrito: null, erro: null, dados: lerPainel(chave, resposta) };
      } catch (e) {
        if (e instanceof RecusaDoMotor && e.semPermissao) {
          return { ...base, restrito: "so_gestor", erro: null, dados: null };
        }
        return { ...base, restrito: null, erro: e instanceof Error ? e.message : String(e), dados: null };
      }
    }),
  );

  return {
    organizationId: opcoes.organizationId,
    empresa,
    periodo: opcoes.periodo,
    janela,
    funil: funil ? { id: funil.id, nome: funil.name, vocabulario } : null,
    funis: funis.filter((f) => !f.is_archived).map((f) => ({ id: f.id, nome: f.name })),
    valores,
    paineis,
    calculadoEm: new Date().toISOString(),
  };
}

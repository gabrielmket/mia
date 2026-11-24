/**
 * FORK MIA (MIA-103) · A ANÁLISE DO FUNIL DE UM CLIENTE, lida pelo MCP de
 * plataforma (`plataforma_ver_analise_do_funil`).
 *
 * ── É um ESPELHO da rota ──────────────────────────────────────────────────
 *
 * A tela `/app/paineis/funil` lê `GET /api/v1/metrics/funil`
 * (`app/api/v1/metrics/funil/route.ts`, do upstream), e a rota faz as leituras
 * dentro dela, sem função que dê para chamar de fora. Tirar a sequência de lá
 * mexeria num arquivo do upstream a cada fusão. Por isso esta é a MESMA
 * sequência, com as mesmas funções de biblioteca: as seis leituras da janela,
 * as duas grafias de `stage_changed`, `montarRelatorioDeFunil`
 * (`lib/metrics/funil.ts`), a contra-métrica de `fn_atrito_metrics` e as duas
 * parcelas de `separarValoresDoPeriodo`. A rota está na lista de
 * `tests/unit/mcp-de-implantacao-espelhos.test.ts`: mudou o código dela, o teste
 * reprova e manda reler esta cópia.
 *
 * ── A diferença declarada ─────────────────────────────────────────────────
 *
 * Só o cliente. A rota, pelo token da empresa, usa o cliente de serviço e filtra
 * `organization_id` à mão em cada leitura; aqui é o mesmo cliente de serviço,
 * com a organização conferida por `alvo` (nunca vinda do corpo sem conferência),
 * e o mesmo filtro em cada leitura. A moeda vem da linha da organização que a
 * ferramenta já leu, a mesma que `moedaDaOrganizacao` leria.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AtividadeDeEtapa,
  type EtapaReferencia,
  type FunilReferencia,
  type LeadDaJanela,
  montarRelatorioDeFunil,
  type RelatorioDeFunil,
} from "@/lib/metrics/funil";
import { separarValoresDoPeriodo, type ValoresDoPeriodo } from "@/lib/metrics/valores-do-periodo";
import { lerPaginado } from "@/lib/supabase/pagina";

interface AtividadeCrua {
  lead_id: string;
  payload: unknown;
  performed_at: string;
}

interface LeadCru {
  id: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
  source: string;
  value_cents: number | null;
  currency: string | null;
  created_at: string;
  closed_at: string | null;
  recurring_value_cents: number | null;
  recurring_period: string | null;
  /** #4191 (upstream 1.124): classificação não comercial; `null` é o estado comercial. */
  nao_comercial_em: string | null;
}

const COLUNAS_DO_LEAD =
  "id, pipeline_id, stage_id, status, source, value_cents, currency, created_at, closed_at, recurring_value_cents, recurring_period, nao_comercial_em";

export interface ContraMetrica {
  turnos: { p50: number | null; p90: number | null; denominador: string } | null;
  opt_outs: { quantidade: number | null; denominador: string } | null;
  fonte: string;
  nota: string;
}

export type AnaliseDoFunil = RelatorioDeFunil & {
  contra_metrica: ContraMetrica;
  truncado: boolean;
  valores_do_periodo: ValoresDoPeriodo;
};

function numeroOuNull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/** A contra-métrica como a rota a devolve: nunca some, nunca vira 0. */
function lerContraMetrica(dado: unknown, motivo: string | null): ContraMetrica {
  if (motivo) return { turnos: null, opt_outs: null, fonte: "fn_atrito_metrics", nota: motivo };
  const cliente = (dado && typeof dado === "object" ? (dado as { cliente?: unknown }).cliente : null) as Record<
    string,
    unknown
  > | null;
  if (!cliente || typeof cliente !== "object") {
    return {
      turnos: null,
      opt_outs: null,
      fonte: "fn_atrito_metrics",
      nota: "Contra-métrica não medida: fn_atrito_metrics não devolveu o bloco 'cliente' nesta janela.",
    };
  }
  return {
    turnos: {
      p50: numeroOuNull(cliente.turnos_p50),
      p90: numeroOuNull(cliente.turnos_p90),
      denominador: "demandas encerradas na janela",
    },
    opt_outs: { quantidade: numeroOuNull(cliente.descadastros), denominador: "contatos bloqueados na janela" },
    fonte: "fn_atrito_metrics (mesma janela)",
    nota: "A taxa de conversão vem junto do custo de empurrá-la: turnos até o desfecho e opt-outs.",
  };
}

/**
 * A análise do funil de UMA organização na janela `[from, to)`, com os mesmos
 * números que a tela mostra para a mesma janela.
 */
export async function lerAnaliseDoFunil(
  admin: SupabaseClient,
  organizationId: string,
  janela: { from: string; to: string },
  moedaDaOrganizacao: string | null,
): Promise<AnaliseDoFunil> {
  const de = janela.from;
  const ate = janela.to;

  const [leituraDeAtividades, leituraDeCriados, leituraDeEncerrados, etapasRes, funisRes, atritoRes] = await Promise.all([
    lerPaginado<AtividadeCrua>((inicio, fim, contar) =>
      admin
        .from("crm_lead_activities")
        .select("lead_id, payload, performed_at", contar ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .eq("type", "stage_changed")
        .gte("performed_at", de)
        .lt("performed_at", ate)
        .order("performed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(inicio, fim),
    ),
    lerPaginado<LeadCru>((inicio, fim, contar) =>
      admin
        .from("crm_leads")
        .select(COLUNAS_DO_LEAD, contar ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .gte("created_at", de)
        .lt("created_at", ate)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(inicio, fim),
    ),
    lerPaginado<LeadCru>((inicio, fim, contar) =>
      admin
        .from("crm_leads")
        .select(COLUNAS_DO_LEAD, contar ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .gte("closed_at", de)
        .lt("closed_at", ate)
        .order("closed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(inicio, fim),
    ),
    admin.from("crm_stages").select("id, name, pipeline_id, position").eq("organization_id", organizationId),
    admin.from("crm_pipelines").select("id, name, position").eq("organization_id", organizationId),
    admin.rpc("fn_atrito_metrics", { p_org: organizationId, p_from: de, p_to: ate }),
  ]);

  for (const [nome, erro] of [
    ["crm_lead_activities", leituraDeAtividades.erro],
    ["crm_leads: criados", leituraDeCriados.erro],
    ["crm_leads: encerrados", leituraDeEncerrados.erro],
  ] as const) {
    if (erro) throw new Error(`não li ${nome}: ${erro}`);
  }
  if (etapasRes.error) throw new Error(`não li crm_stages: ${etapasRes.error.message}`);
  if (funisRes.error) throw new Error(`não li crm_pipelines: ${funisRes.error.message}`);

  // As DUAS grafias de `stage_changed`, como na rota: as rotas de movimento
  // gravam `from_stage_id/to_stage_id`; o agente, o handoff e a agenda gravam
  // `{ de, para }`. Ler só a primeira perderia os movimentos feitos pela IA.
  const atividades: AtividadeDeEtapa[] = leituraDeAtividades.linhas
    .map((a) => {
      const p = (a.payload && typeof a.payload === "object" ? a.payload : {}) as {
        from_stage_id?: string | null;
        to_stage_id?: string | null;
        de?: string | null;
        para?: string | null;
      };
      return {
        lead_id: a.lead_id,
        de: p.from_stage_id ?? p.de ?? null,
        para: p.to_stage_id ?? p.para ?? "",
        quando: a.performed_at,
      };
    })
    .filter((a) => Boolean(a.lead_id) && Boolean(a.para));

  const porId = new Map<string, LeadCru>();
  for (const l of [...leituraDeCriados.linhas, ...leituraDeEncerrados.linhas]) if (l.id) porId.set(l.id, l);
  const leads: LeadDaJanela[] = [...porId.values()].map((l) => ({
    id: l.id,
    pipeline_id: l.pipeline_id,
    stage_id: l.stage_id,
    status: l.status === "won" || l.status === "lost" ? l.status : "open",
    source: l.source ?? "",
    value_cents: l.value_cents,
    currency: l.currency,
    created_at: l.created_at,
    closed_at: l.closed_at,
    // #4191: como a rota, a coluna vai para montarRelatorioDeFunil, que corta o negócio não comercial da conta.
    nao_comercial_em: l.nao_comercial_em ?? null,
  }));

  const etapas: EtapaReferencia[] = (
    (etapasRes.data ?? []) as Array<{ id: string; name: string; pipeline_id: string; position: number | string }>
  ).map((e) => ({ id: e.id, nome: e.name, pipeline_id: e.pipeline_id, posicao: Number(e.position) }));

  const funis: FunilReferencia[] = (
    (funisRes.data ?? []) as Array<{ id: string; name: string; position: number | string }>
  ).map((f) => ({ id: f.id, nome: f.name, posicao: Number(f.position) }));

  const relatorio = montarRelatorioDeFunil({ janela: { from: de, to: ate }, atividades, leads, etapas, funis });

  return {
    ...relatorio,
    contra_metrica: lerContraMetrica(
      atritoRes.error ? null : atritoRes.data,
      atritoRes.error ? `Contra-métrica não medida nesta resposta: ${atritoRes.error.message}` : null,
    ),
    truncado: leituraDeAtividades.truncado || leituraDeCriados.truncado || leituraDeEncerrados.truncado,
    valores_do_periodo: separarValoresDoPeriodo({
      negocios: leituraDeEncerrados.linhas,
      janela: { from: de, to: ate },
      moedaDaOrganizacao,
      truncado: leituraDeEncerrados.truncado,
    }),
  };
}

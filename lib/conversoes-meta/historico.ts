/**
 * FORK MIA — o HISTÓRICO DE ENVIOS das duas plataformas, com a situação de cada
 * envio dita como quem opera a lê.
 *
 * ── Ao lado de `lib/conversoes/historico.ts` ────────────────────────────────
 *
 * O histórico do upstream lê o mesmo livro-razão (`ad_conversion_dispatches`) e
 * continua valendo para quem o chama. Este existe porque a tela precisava de
 * três coisas que o dele não tem, e mexer no dele seria conflito a cada
 * sincronização (docs/FORK-MIA.md, regra 1):
 *
 *   · os eventos de etapa da Meta (`Meta:<evento>`) no filtro de evento;
 *   · a situação separada pelo MOTIVO de não ter enviado (`./situacao.ts`);
 *   · "dá para reenviar?" por linha, com o teto de 7 dias da Meta.
 *
 * O período, a página e a busca são os dele (`PERIODOS`, `inicioDoPeriodo`,
 * `TAMANHO_DA_PAGINA`), reaproveitados.
 *
 * Sempre filtrado pela organização da sessão: o cliente é o de serviço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PendenciaDeEnvio } from "@/lib/conversoes/estado-da-conexao";
import { inicioDoPeriodo, PERIODOS, TAMANHO_DA_PAGINA, type Periodo } from "@/lib/conversoes/historico";

import { ehEventoDaMetaNoLivro } from "./eventos";
import {
  MOTIVOS_ANTERIORES,
  MOTIVOS_COM_SITUACAO_PROPRIA,
  MOTIVOS_DE_ESPERA,
  MOTIVOS_SEM_CLIQUE,
  reenvioDoEnvio,
  SITUACOES_DE_ENVIO,
  situacaoDoEnvio,
  type Reenvio,
  type SituacaoDeEnvio,
} from "./situacao";

export interface FiltrosDoHistoricoDeEnvios {
  periodo: Periodo;
  situacao: "todas" | SituacaoDeEnvio;
  /** `Purchase`, `QualifiedLead`, `Etapa:<uuid>`, `Meta:<evento>` ou vazio para todos. */
  evento: string;
  plataforma: "" | "google_ads" | "meta_ads";
  busca: string;
  pagina: number;
}

export interface LinhaDoHistoricoDeEnvios {
  id: string;
  leadId: string;
  tituloDoLead: string | null;
  plataforma: string;
  evento: string;
  status: string;
  motivo: string | null;
  detalhe: string | null;
  eventoId: string | null;
  protocolo: string | null;
  acaoGoogle: string | null;
  valorCentavos: number | null;
  moeda: string | null;
  /** Quando o evento aconteceu: o retrato da etapa, ou o fechamento do negócio na compra. */
  ocorridoEm: string | null;
  tentadoEm: string;
  situacao: SituacaoDeEnvio;
  reenvio: Reenvio;
}

const EVENTO_DO_UPSTREAM = /^(Purchase|QualifiedLead|Etapa:[0-9a-f-]{36})$/;

/** Lê os filtros da URL, caindo no padrão em qualquer valor desconhecido. */
export function lerFiltrosDoHistoricoDeEnvios(bruto: Record<string, string | undefined>): FiltrosDoHistoricoDeEnvios {
  const um = <T extends string>(lista: readonly T[], v: string | undefined, padrao: T): T =>
    v && (lista as readonly string[]).includes(v) ? (v as T) : padrao;
  const evento = bruto.evento ?? "";
  return {
    periodo: um(PERIODOS, bruto.periodo, "30d"),
    situacao: um(["todas", ...SITUACOES_DE_ENVIO] as const, bruto.situacao, "todas"),
    evento: EVENTO_DO_UPSTREAM.test(evento) || ehEventoDaMetaNoLivro(evento) ? evento : "",
    plataforma: um(["", "google_ads", "meta_ads"] as const, bruto.plataforma, ""),
    // Só letras, números, espaço e pontuação comum: vai para um ilike.
    busca: (bruto.busca ?? "")
      .replace(/[^\p{L}\p{N} .@+-]/gu, "")
      .trim()
      .slice(0, 60),
    pagina: Math.max(1, Math.min(1000, Number.parseInt(bruto.pagina ?? "1", 10) || 1)),
  };
}

export async function lerHistoricoDeEnvios(
  admin: SupabaseClient,
  organizationId: string,
  filtros: FiltrosDoHistoricoDeEnvios,
  agora: Date = new Date(),
): Promise<{ linhas: LinhaDoHistoricoDeEnvios[]; total: number }> {
  let q = admin
    .from("ad_conversion_dispatches")
    .select(
      "id, lead_id, platform, event_name, status, reason, detail, event_id, remote_request_id, google_action_id, value_cents, currency, event_occurred_at, attempted_at, crm_leads!inner(title, closed_at)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId);

  q = q.eq("crm_leads.organization_id", organizationId);

  const inicio = inicioDoPeriodo(filtros.periodo, agora);
  if (inicio) q = q.gte("attempted_at", inicio);
  if (filtros.evento) q = q.eq("event_name", filtros.evento);
  if (filtros.plataforma) q = q.eq("platform", filtros.plataforma);
  if (filtros.busca) q = q.ilike("crm_leads.title", `%${filtros.busca}%`);
  switch (filtros.situacao) {
    case "enviado":
      q = q.eq("status", "sent");
      break;
    case "recusado":
      q = q.eq("status", "error");
      break;
    case "aguardando":
      q = q.eq("status", "skipped").in("reason", [...MOTIVOS_DE_ESPERA]);
      break;
    case "sem_clique":
      q = q.eq("status", "skipped").in("reason", [...MOTIVOS_SEM_CLIQUE]);
      break;
    case "sem_valor":
      q = q.eq("status", "skipped").eq("reason", "sem_valor");
      break;
    case "anterior_a_regra":
      q = q.eq("status", "skipped").in("reason", [...MOTIVOS_ANTERIORES]);
      break;
    case "conexao":
      // Tudo o que não foi enviado e não tem situação própria, inclusive a linha
      // sem motivo: `not in` sozinho deixaria o motivo nulo de fora.
      q = q
        .eq("status", "skipped")
        .or(`reason.is.null,reason.not.in.(${MOTIVOS_COM_SITUACAO_PROPRIA.join(",")})`);
      break;
  }

  const de = (filtros.pagina - 1) * TAMANHO_DA_PAGINA;
  const { data, count, error } = await q
    .order("attempted_at", { ascending: false })
    .range(de, de + TAMANHO_DA_PAGINA - 1);
  if (error) throw new Error("Não foi possível ler o histórico de envios.");

  const linhas = ((data ?? []) as unknown[]).map((bruto): LinhaDoHistoricoDeEnvios => {
    const l = bruto as {
      id: string;
      lead_id: string;
      platform: string;
      event_name: string;
      status: string;
      reason: string | null;
      detail: string | null;
      event_id: string | null;
      remote_request_id: string | null;
      google_action_id: string | null;
      value_cents: number | null;
      currency: string | null;
      event_occurred_at: string | null;
      attempted_at: string;
      crm_leads:
        | { title: string | null; closed_at: string | null }
        | Array<{ title: string | null; closed_at: string | null }>
        | null;
    };
    const lead = Array.isArray(l.crm_leads) ? l.crm_leads[0] : l.crm_leads;
    // A compra não guarda retrato: o momento dela é o fechamento do negócio.
    const ocorridoEm = l.event_occurred_at ?? (l.event_name === "Purchase" ? (lead?.closed_at ?? null) : null);
    return {
      id: l.id,
      leadId: l.lead_id,
      tituloDoLead: lead?.title ?? null,
      plataforma: l.platform,
      evento: l.event_name,
      status: l.status,
      motivo: l.reason,
      detalhe: l.detail,
      eventoId: l.event_id,
      protocolo: l.remote_request_id,
      acaoGoogle: l.google_action_id,
      valorCentavos: l.value_cents,
      moeda: l.currency,
      ocorridoEm,
      tentadoEm: l.attempted_at,
      situacao: situacaoDoEnvio(l.status, l.reason),
      reenvio: reenvioDoEnvio(
        { plataforma: l.platform, status: l.status, motivo: l.reason, ocorridoEm, tentadoEm: l.attempted_at },
        agora,
      ),
    };
  });
  return { linhas, total: count ?? linhas.length };
}

/**
 * Os envios que são PENDÊNCIA de quem opera: não foram enviados e têm conserto.
 *
 * A lista do upstream (`lerPendencias`) mostra tudo o que não é `sent`. Com esta
 * peça o livro-razão passou a guardar também as DECISÕES das travas ("anterior
 * à regra", "formulário desligado"), que não são pendência de ninguém: ficam no
 * histórico, com a situação delas, e fora daqui.
 */
export const MOTIVOS_FORA_DAS_PENDENCIAS: readonly string[] = [...MOTIVOS_ANTERIORES, ...MOTIVOS_SEM_CLIQUE];

/**
 * O mesmo que `lerPendencias` do upstream devolve, sem as decisões das travas.
 * A tela de Configuração chama esta no lugar daquela.
 */
export async function lerPendenciasDeEnvio(
  admin: SupabaseClient,
  organizationId: string,
  limite = 20,
): Promise<PendenciaDeEnvio[]> {
  const { data } = await admin
    .from("ad_conversion_dispatches")
    .select("lead_id, event_name, platform, status, reason, detail, value_cents, attempted_at, crm_leads(title)")
    .eq("organization_id", organizationId)
    .neq("status", "sent")
    .or(`reason.is.null,reason.not.in.(${MOTIVOS_FORA_DAS_PENDENCIAS.join(",")})`)
    .order("attempted_at", { ascending: false })
    .limit(limite);

  return ((data ?? []) as unknown[]).map((linha) => {
    const l = linha as {
      lead_id: string;
      event_name: string;
      platform: string;
      status: string;
      reason: string | null;
      detail: string | null;
      value_cents: number | null;
      attempted_at: string;
      crm_leads: { title: string | null } | { title: string | null }[] | null;
    };
    const lead = Array.isArray(l.crm_leads) ? l.crm_leads[0] : l.crm_leads;
    return {
      leadId: l.lead_id,
      evento: l.event_name ?? "Purchase",
      plataforma: l.platform,
      status: l.status,
      motivo: l.reason,
      detalhe: l.detail,
      valorCentavos: l.value_cents,
      tentadoEm: l.attempted_at,
      tituloDoLead: lead?.title ?? null,
    };
  });
}

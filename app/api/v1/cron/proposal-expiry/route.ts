/**
 * Cron diário: propostas ENVIADAS cujo valid_until passou sem decisão viram
 * VENCIDAS e abrem aviso na Central. Mesmo padrão de
 * recover-stuck-messages/route.ts (lógica pura separada do handler HTTP,
 * ok()/fail() como wrapper, audit() só quando houve efeito).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoAviso } from "@/lib/i18n/idioma-do-aviso";
import type { Idioma } from "@/lib/i18n/idiomas";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataIsoNoFuso } from "@/lib/propostas/data-no-fuso";
import { FUSO_PADRAO, fusoUtilizavel } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

/**
 * FORK MIA (MIA-367) — as duas leituras da rodada são lidas INTEIRAS, página a
 * página (`lerTodasAsPaginas`), na ordem de `id`. Acabou o teto sem prova de
 * fim, a rodada falha FECHADA (500, nada vence) em vez de tratar metade como
 * tudo. Em 28/11/2026 a produção tinha 0 propostas enviadas com validade e 18
 * empresas: as folgas são largas.
 */
const PAGINAS_DAS_CANDIDATAS = 50;
/** Por lote de `LOTE_DE_EMPRESAS` empresas: uma linha por id, uma página basta. */
const PAGINAS_DAS_EMPRESAS = 2;
/** Ids por `in(...)`: 100 uuids cabem folgados na URL do PostgREST. */
const LOTE_DE_EMPRESAS = 100;

interface PropostaParaVerificar {
  id: string; organization_id: string; lead_id: string; contact_id: string;
  status: string; valid_until: string | null;
}

export function encontrarPropostasVencidas(
  propostas: readonly PropostaParaVerificar[],
  agora: Date,
  fusoPorOrganizacao: ReadonlyMap<string, string>,
): PropostaParaVerificar[] {
  return propostas.filter((p) => {
    if (p.status !== "enviada" || p.valid_until === null) return false;
    const fuso = fusoPorOrganizacao.get(p.organization_id) ?? FUSO_PADRAO;
    const hoje = dataIsoNoFuso(agora, fuso);
    return p.valid_until < hoje;
  });
}

export interface VencimentoResult { vencidas: number }

async function rodarVencimento(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
): Promise<VencimentoResult> {
  // FORK MIA (MIA-367) — as enviadas com validade da instalação inteira, lidas
  // TODAS. Antes era uma leitura só, cortada em 1000 linhas pelo PostgREST sem
  // aviso: a proposta vencida que ficava fora da página não vencia nunca.
  const lidas = await lerTodasAsPaginas<PropostaParaVerificar>(
    (de, ate, pedirContagem) =>
      admin
        .from("crm_proposals")
        .select("id, organization_id, lead_id, contact_id, status, valid_until", pedirContagem ? { count: "exact" } : undefined)
        .eq("status", "enviada")
        .not("valid_until", "is", null)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DAS_CANDIDATAS },
  );
  if (lidas.erro) throw new Error(`query_failed: ${lidas.erro}`);
  if (lidas.truncado) throw new Error(`query_truncada: mais de ${lidas.linhas.length} propostas enviadas`);
  const candidatas = lidas.linhas;

  // FORK MIA (MIA-367) — o fuso de cada empresa, em lotes de 100 ids e lido
  // inteiro. Leitura que falha ou sai cortada derruba a rodada: vencer com o
  // fuso padrão no lugar do da empresa adiantaria o vencimento em horas.
  const orgIds = [...new Set(candidatas.map((p) => p.organization_id))];
  const fusoPorOrganizacao = new Map<string, string>();
  for (let i = 0; i < orgIds.length; i += LOTE_DE_EMPRESAS) {
    const lote = orgIds.slice(i, i + LOTE_DE_EMPRESAS);
    const orgs = await lerTodasAsPaginas<{ id: string; timezone: string | null }>(
      (de, ate, pedirContagem) =>
        admin
          .from("organizations")
          .select("id, timezone", pedirContagem ? { count: "exact" } : undefined)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: PAGINAS_DAS_EMPRESAS },
    );
    if (orgs.erro) throw new Error(`query_orgs_failed: ${orgs.erro}`);
    if (orgs.truncado) throw new Error(`query_orgs_truncada: mais de ${orgs.linhas.length} empresas num lote`);
    for (const o of orgs.linhas) fusoPorOrganizacao.set(o.id, fusoUtilizavel(o.timezone));
  }
  const vencidas = encontrarPropostasVencidas(candidatas, new Date(), fusoPorOrganizacao);
  if (vencidas.length === 0) return { vencidas: 0 };

  // A camada POR EMPRESA (#4871): o cron é GLOBAL, então a pergunta é feita por
  // organização, uma vez cada, antes de qualquer escrita. `moduloLigado` já
  // aplica as duas réguas de uma vez — instalação desligada é teto (a rodada nem
  // chega aqui) e a linha `desligado` da empresa tira o módulo dela. Leitura que
  // falha devolve `false` (falha fechada), então a empresa fica de fora da
  // rodada em vez de ser vencida sem permissão.
  const organizacoesPermitidas = new Set<string>();
  for (const orgId of new Set(vencidas.map((p) => p.organization_id))) {
    if (await moduloLigado(admin, "propostas", orgId)) organizacoesPermitidas.add(orgId);
  }
  const aVencer = vencidas.filter((p) => organizacoesPermitidas.has(p.organization_id));
  if (aVencer.length === 0) return { vencidas: 0 };

  const idiomas = new Map<string, Idioma>();
  for (const p of aVencer) {
    const { error: updErr } = await admin
      .from("crm_proposals")
      .update({ status: "vencida" })
      .eq("organization_id", p.organization_id)
      .eq("id", p.id)
      .eq("status", "enviada"); // claim atomico — se ja decidiram entre o select e aqui, nao sobrescreve
    if (updErr) {
      logger.error("[proposal-expiry] update falhou", { error: updErr.message, proposal_id: p.id, requestId });
      continue;
    }

    await emitLeadActivity(admin, {
      organizationId: p.organization_id, leadId: p.lead_id, contactId: p.contact_id,
      type: "proposal_expired", sourceModule: "proposals", sourceId: p.id,
      actor: { type: "api_token", id: "cron:proposal-expiry" },
      reason: "Proposta venceu sem decisão do cliente",
    });

    // Dedupe: não abre um segundo aviso se já existe um aberto para esta proposta.
    const { data: existente } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", p.organization_id)
      .eq("kind", "proposal_expired_notice")
      .eq("ref_id", p.id)
      .eq("status", "open")
      .maybeSingle();
    if (!existente) {
      // A Central mostra o texto como foi gravado: o aviso nasce no idioma da organização.
      const idioma = await idiomaDoAviso(admin, p.organization_id, idiomas);
      const { error: inboxErr } = await admin.from("agent_inbox_items").insert({
        organization_id: p.organization_id,
        kind: "proposal_expired_notice",
        severity: "warn",
        title: traduzir("Uma proposta venceu sem decisão do cliente", idioma),
        body: traduzir(
          "O prazo de validade passou e ninguém marcou aceite ou recusa. Reveja a proposta e decida os próximos passos com o cliente.",
          idioma,
        ),
        ref_kind: "proposal",
        ref_id: p.id,
      });
      if (inboxErr) {
        logger.error("[proposal-expiry] aviso na Central falhou", { error: inboxErr.message, proposal_id: p.id, requestId });
      }
    }
  }

  return { vencidas: aVencer.length };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let result: VencimentoResult;
  try {
    const admin = createAdminClient();
    // #4871: `propostas` é o módulo dono destas linhas. Instalação desligada não
    // roda — a mesma régua dos outros crons do módulo (rotas 404, cron pula) — e a
    // resposta diz POR QUE a rodada saiu, em vez de devolver `vencidas: 0`, que se
    // confunde com "nada vencia hoje".
    if (!(await moduloLigado(admin, "propostas"))) {
      return ok({ pulado: "modulo_desligado" }, { requestId });
    }
    result = await rodarVencimento(admin, requestId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[proposal-expiry] falhou", { error: detail, requestId });
    return fail("internal_error", "Failed to expire proposals.", 500, { requestId });
  }

  // Rodada que nao venceu nada NAO e mutacao e nao audita (CLAUDE.md, mesmo
  // criterio de recover-stuck-messages) — a que venceu, audita.
  if (result.vencidas > 0) {
    void audit({
      action: "proposal.expired_batch", organizationId: null, bypassedRls: true,
      metadata: result as unknown as Record<string, unknown>, requestId,
    });
  }

  return ok(result, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}
export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

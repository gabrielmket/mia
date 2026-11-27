import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET   /api/v1/ai/budget — o estado do orçamento da org ativa (manager+).
 * PATCH /api/v1/ai/budget — muda teto, limiar e MODO (admin).
 *
 * `organization_id` vem do JWT via `requireRole` — nunca do body. O PATCH usa
 * service role e filtra por `orgId` explicitamente (doutrina).
 *
 * ═══ A ESCADA, E POR QUE ELA É VALIDADA NO SERVIDOR ═══
 *
 * `off → avisar → bloquear`, um degrau por vez. O salto `off → bloquear` é 422,
 * mesmo vindo de chamada direta de API: a fase de aviso existe para que ninguém
 * descubra a parada pelo cliente reclamando no WhatsApp, e uma regra que só vive
 * no componente React não é regra — é sugestão. Afrouxar (`→ off`,
 * `bloquear → avisar`) é sempre livre e imediato, nos dois sentidos da doutrina:
 * falhar fechado na AÇÃO, aberto na INFORMAÇÃO.
 *
 * Armar `bloquear` grava `enforcement_effective_at = now() + 72h` — a carência.
 * `confirmar_imediato: true` renuncia a ela por escolha explícita de quem arma.
 *
 * ═══ O PISO ═══
 *
 * Sair de `off` — para `avisar` OU para `bloquear` — exige teto ≥ US$ 1,00,
 * resolvido sobre o estado PÓS-escrita
 * (`tetoDepois = payload ?? atual`) — senão "armado sem valor útil" renasce pela
 * porta da frente: mudar só o modo hoje e derrubar o teto para 0 amanhã. O CHECK
 * `ai_budgets_bloquear_precisa_de_teto` é o backstop, não a régua: quem bate nele
 * recebe 23514 → 500 genérico, sem saber qual campo ofendeu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { requireRole } from "@/lib/auth/require-role";
import { podeVerCusto } from "@/lib/ai/custo-e-da-plataforma";
import { extractBearer } from "@/lib/mcp/auth";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";
import { getBudgetStatus, type BudgetStatus } from "@/lib/ai/budget/check";
// FORK MIA (MIA-309): a regra do PATCH mora em `lib/ai/budget/mudanca-do-teto.ts`,
// a mesma que o MCP de plataforma usa (`plataforma_definir_teto_de_ia`).
import {
  COLUNAS_DO_TETO,
  DEGRAU,
  decidirMudancaDoTeto,
  pedidoDoTetoSchema,
  retratarAvisosDoTeto,
} from "@/lib/ai/budget/mudanca-do-teto";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

// FORK MIA (MIA-309): a carência, o piso, a escada e o schema do pedido saíram
// para `lib/ai/budget/mudanca-do-teto.ts` sem mudar, com os comentários de cá.

/** Quem chama, pelo portão que o trouxe (sessão de navegador ou token de integração). */
type QuemChama = { idioma: Idioma; orgId: string; autor: string | null; apiTokenId: string | null };

/** FORK MIA: a recusa de quem não vê o consumo de IA (lib/ai/custo-e-da-plataforma.ts). */
function recusaDoConsumo(idioma: Idioma, requestId: string): Response {
  return fail(
    "forbidden",
    traduzir("O consumo de IA é acompanhado pela administração da plataforma.", idioma),
    403,
    { requestId },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // Token de integração (Bearer). Sem Bearer, a sessão segue como era.
  if (extractBearer(req.headers.get("authorization"))) {
    const authz = await resolveAuthDual(req, {
      requestId,
      resource: "ai_budget",
      role: "manager",
      scope: "config:read",
      tokenRole: "admin",
    });
    if (!authz.ok) return authz.response;
    const teto = await tetoDeEscritaDoToken(authz, "ai_budget", requestId);
    if (teto) return teto;
    // FORK MIA: teto e gasto são dinheiro da plataforma, e o token nunca é da
    // plataforma. A v1.121 abriu a leitura ao token; aqui ela segue recusada.
    return recusaDoConsumo(authz.idioma ?? IDIOMA_PADRAO, requestId);
  }

  const authz = await requireRole("manager", { requestId, resource: "ai_budget" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;
  // Teto de gasto é dinheiro, e dinheiro é da plataforma nesta instalação
  // (`lib/ai/custo-e-da-plataforma.ts`): quem paga o provedor é quem opera.
  if (!podeVerCusto(authz.user)) {
    return fail(
      "forbidden",
      traduzir("O consumo de IA é acompanhado pela administração da plataforma.", authz.user.idioma),
      403,
      { requestId },
    );
  }

  const status = await getBudgetStatus(activeOrg.orgId);
  return ok(status, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let quem: QuemChama;
  if (extractBearer(req.headers.get("authorization"))) {
    const authz = await resolveAuthDual(req, {
      requestId,
      resource: "ai_budget",
      role: "admin",
      scope: "config:write",
      tokenRole: "admin",
    });
    if (!authz.ok) return authz.response;
    const teto = await tetoDeEscritaDoToken(authz, "ai_budget", requestId);
    if (teto) return teto;
    // FORK MIA: o token é da empresa, nunca da plataforma (lib/ai/trava-da-ia-na-rota.ts),
    // e quem não vê o gasto não arma o teto dele. A v1.121 abriu esta escrita ao
    // token; aqui ela continua só da plataforma, pela sessão.
    return recusaDoConsumo(authz.idioma ?? IDIOMA_PADRAO, requestId);
  } else {
    const authz = await requireRole("admin", { requestId, resource: "ai_budget" });
    if (!authz.ok) return authz.response;
    // Quem não vê o gasto não arma o teto dele: a escada off → avisar → bloquear
    // decide se a IA PARA, e essa decisão é de quem paga a conta do provedor.
    if (!podeVerCusto(authz.user)) return recusaDoConsumo(authz.user.idioma, requestId);
    quem = { idioma: authz.user.idioma, orgId: authz.org.orgId, autor: authz.user.id, apiTokenId: null };
  }
  const t = (texto: string) => traduzir(texto, quem.idioma);
  const activeOrg = { orgId: quem.orgId };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", t("JSON inválido."), 422, { requestId });
  }

  const parsed = pedidoDoTetoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", t("Payload inválido."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();

  const { data: existing, error: readErr } = await admin
    .from("ai_budgets")
    .select(COLUNAS_DO_TETO)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (readErr) {
    logger.error("ai-budget: leitura do estado atual falhou", {
      organization_id: activeOrg.orgId,
      request_id: requestId,
      causa: readErr.message,
    });
    return fail("internal_error", t("Erro ao ler o orçamento."), 500, { requestId });
  }

  // FORK MIA (MIA-309): a escada, o piso, a carência e o desarme que zera a data
  // (lib/ai/budget/mudanca-do-teto.ts, a mesma regra do MCP de plataforma).
  const decisao = decidirMudancaDoTeto(existing, parsed.data);
  if (!decisao.ok) {
    return fail(decisao.codigo, decisao.mensagem(t), 422, { requestId, details: decisao.details });
  }
  const { patch } = decisao;
  const modoAntes = decisao.antes.modo;
  const modoDepois = decisao.depois.modo;
  const tetoDepois = decisao.depois.tetoCents;

  if (existing) {
    const { error: updErr } = await admin
      .from("ai_budgets")
      .update(patch)
      .eq("organization_id", activeOrg.orgId);
    if (updErr) {
      logger.error("ai-budget: update falhou", {
        organization_id: activeOrg.orgId,
        request_id: requestId,
        causa: updErr.message,
      });
      return fail("internal_error", t("Erro ao atualizar orçamento."), 500, { requestId });
    }
  } else {
    const { error: insErr } = await admin.from("ai_budgets").insert({
      organization_id: activeOrg.orgId,
      // Explícito, e nunca o `DEFAULT 5000` da coluna: a linha nasce aqui de uma
      // decisão humana, e "não disse teto" significa SEM teto, não US$ 50.
      monthly_limit_cents: tetoDepois,
      ...patch,
    });
    if (insErr) {
      logger.error("ai-budget: insert falhou", {
        organization_id: activeOrg.orgId,
        request_id: requestId,
        causa: insErr.message,
      });
      return fail("internal_error", t("Erro ao criar orçamento."), 500, { requestId });
    }
  }

  void audit({
    // FORK MIA (MIA-309): o código e o metadata vêm da regra comum (antes e
    // depois dos três campos; a data e o `confirmar_imediato` quando arma).
    action: decisao.acaoDaAuditoria,
    actorUserId: quem.autor,
    actorApiTokenId: quem.apiTokenId,
    organizationId: activeOrg.orgId,
    resourceType: "ai_budgets",
    resourceId: activeOrg.orgId,
    requestId,
    metadata: decisao.metadataDaAuditoria,
  });

  const status = await getBudgetStatus(activeOrg.orgId);
  const retratados = await retratarAvisosDoTeto({
    admin,
    orgId: activeOrg.orgId,
    requestId,
    afrouxou:
      DEGRAU[modoDepois] < DEGRAU[modoAntes] ||
      status.current_month_consumed_cents < limiarDeAlerta(status),
  });

  // Fechar aqui e devolver `blocked_now: true` faria a tela contradizer o clique
  // que o usuário acabou de dar.
  return ok(retratados ? { ...status, blocked_now: false } : status, { requestId });
}

/** O gasto a partir do qual o aviso abre. Sem teto ⇒ não há limiar a cruzar. */
function limiarDeAlerta(status: BudgetStatus): number {
  if (status.monthly_limit_cents <= 0) return Number.POSITIVE_INFINITY;
  return (status.monthly_limit_cents * status.alarm_threshold_pct) / 100;
}

// FORK MIA (MIA-309): `retratarAvisos` virou `retratarAvisosDoTeto`, em
// lib/ai/budget/mudanca-do-teto.ts, para o MCP fechar os mesmos avisos.

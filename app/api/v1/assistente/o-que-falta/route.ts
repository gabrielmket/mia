/**
 * FORK MIA (.91) — GET/POST /api/v1/assistente/o-que-falta: o bloco "O que
 * falta" dos primeiros passos e do Início.
 *
 *   GET   o rótulo do cliente (preenchido, posso completar, preciso confirmar,
 *         não se aplica), a evolução dos retratos e o critério de quem vê.
 *         Não grava nada.
 *   POST  o mesmo, e guarda o retrato desta rodada se algo mudou (9081). Só
 *         ADMINISTRADOR, e nunca o acompanhamento do suporte: o retrato é a
 *         régua de quem enxerga a empresa inteira.
 *
 * A leitura é pela SESSÃO (`lerOQueFalta`, o checklist do MCP com o acesso de
 * quem pergunta). O cliente de serviço só lê a chave da cobrança da
 * INSTALAÇÃO, que a sessão não alcança, como o layout de `/app` faz.
 *
 * Quem vê sai de `oQueFaltaAparece` (lib/onboarding/o-que-falta-aparece.ts):
 * empresa que passou pelo passo a passo desta versão, gestor ou administrador,
 * no passo a passo ou até zerar. Para os outros a resposta é `aparece: false`,
 * sem leitura nenhuma.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { lerOQueFalta } from "@/lib/assistente/leituras/o-que-falta";
import { guardarRetrato, lerEvolucao } from "@/lib/assistente/retratos";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { oQueFaltaAparece } from "@/lib/onboarding/o-que-falta-aparece";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function responder(req: NextRequest, guardar: boolean): Promise<Response> {
  void req;
  const requestId = randomUUID();
  const authz = await requireRole(guardar ? "admin" : "viewer", { requestId, resource: "mia_assistente_retratos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const papel = authz.org.role;

  const db = await createClient();
  const { data: linha } = await db
    .from("organizations")
    .select("onboarding_state, onboarded_at, demonstracao")
    .eq("id", orgId)
    .maybeSingle();
  const org = linha as { onboarding_state?: unknown; onboarded_at?: string | null; demonstracao?: boolean } | null;
  if (!org) return fail("not_found", t("Empresa não encontrada."), 404, { requestId });

  const podeVer = roleAtLeast(papel, "manager");
  const evolucao = podeVer ? await lerEvolucao(db, orgId).catch(() => null) : null;
  const criterio = oQueFaltaAparece({
    onboardingState: org.onboarding_state,
    onboardedAt: org.onboarded_at ?? null,
    papel,
    zerou: evolucao?.zerou ?? false,
    demonstracao: org.demonstracao === true,
    suporte: Boolean(authz.user.support),
  });
  if (!criterio.aparece) return ok({ criterio, rotulo: null, evolucao: null, pode_aplicar: false }, { requestId });

  const cobrancaLigada = await modulosLigados(createAdminClient())
    .then((m) => m.includes("cobranca"))
    .catch(() => false);
  let lido;
  try {
    lido = await lerOQueFalta(db, { organizationId: orgId, papel, cobrancaLigada, requestId });
  } catch {
    return fail("unavailable", t("Não deu para ver o que falta agora."), 503, { requestId });
  }

  let guardou = false;
  if (guardar) {
    guardou = await guardarRetrato(db, { organizationId: orgId, rotulo: lido.rotulo, origem: "tela" });
  }
  const depois = guardou ? await lerEvolucao(db, orgId).catch(() => evolucao) : evolucao;

  return ok(
    {
      criterio,
      rotulo: lido.rotulo,
      evolucao: depois,
      guardou_retrato: guardou,
      pode_aplicar: roleAtLeast(papel, "admin"),
    },
    { requestId },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  return responder(req, false);
}

export async function POST(req: NextRequest): Promise<Response> {
  // O acompanhamento do suporte não grava retrato em nome da empresa.
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  return responder(req, true);
}

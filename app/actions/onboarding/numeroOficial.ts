"use server";

/**
 * FORK MIA (.91) — o número oficial pelo Facebook no passo "O telefone dele".
 *
 * Depois de "Entrar com o Facebook" (o cadastro incorporado do upstream), a
 * ligação do número à empresa continua À MÃO, pela Time, em Admin › Cadastro
 * incorporado: o aviso da Meta não diz de qual empresa é o número, e ligar
 * errado faria a conversa de um cliente sair pelo número de outro. O passo
 * grava que a pessoa entrou com o Facebook e fica "esperando a Time"
 * (`whatsapp.status = "esperando_a_time"`); o "o que falta" mostra isso com
 * quem faz: Time Company, até o número aparecer conectado.
 *
 * O passo conta como feito-pulado no indicador do upstream (`skipped`), como
 * "Pular por enquanto": o wizard segue, e nada é dito como conectado.
 */
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { NUMERO_OFICIAL_ESPERANDO_A_TIME } from "@/lib/mcp-plataforma/checklist/area-dos-primeiros-passos";

import { OnboardingError, patchOnboardingState, requireOnboardingCtx } from "./_shared";

export async function marcarNumeroOficialEsperandoATime(): Promise<{ ok: boolean }> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false };
    throw err;
  }
  await patchOnboardingState(ctx.orgId, {
    whatsapp: { status: NUMERO_OFICIAL_ESPERANDO_A_TIME, skipped: true, entrou_com_facebook_em: new Date().toISOString() },
  });
  void audit({
    action: "onboarding.numero_oficial_esperando_a_time",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "organization",
    resourceId: ctx.orgId,
  });
  return { ok: true };
}

export async function seguirDepoisDoFacebook(): Promise<void> {
  await requireOnboardingCtx();
  redirect("/onboarding");
}

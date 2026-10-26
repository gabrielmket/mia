"use server";

/**
 * FORK MIA (.91) — o passo "Treinar" quando o agente JÁ EXISTE em rascunho,
 * pela proposta do assistente (`mia_assistente_propostas`, 9080).
 *
 * O agente da proposta nasceu pelo caminho da implantação (`garantirAgente`),
 * com uma versão em rascunho. Criar de novo pelo passo do upstream
 * (`createDefaultAgent`) colidiria com essa versão; aqui o passo PUBLICA o
 * rascunho que a pessoa aprovou, pelo mesmo caminho do MCP (`publicarAgente`,
 * que confere número, chave e capacidades como o botão "Publicar"). Publicar é
 * o clique humano que o desenho do upstream exige, e é só de quem administra.
 *
 * O follow-up proposto que estava armado no rascunho sai junto (o gancho em
 * `publishAgentVersion`).
 */
import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { publicarAgente } from "@/lib/implantacao/agente";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { createAdminClient } from "@/lib/supabase/admin";

import { OnboardingError, patchOnboardingState, requireOnboardingCtx } from "./_shared";

/** Por que não publicou: a tela escreve a frase de cada motivo. */
export type MotivoDoNaoPublicou = "sem_numero" | "ia_da_plataforma" | "nao_deu" | "sessao" | "papel" | "registro";

export type ResultadoDaPublicacao = { ok: true } | { ok: false; motivo: MotivoDoNaoPublicou };

/** O que impede publicar, para quem não opera a plataforma. */
function motivoDoBloqueio(mensagem: string): MotivoDoNaoPublicou {
  if (/número|numero|conectad/i.test(mensagem)) return "sem_numero";
  if (/chave|IA|modelo/i.test(mensagem)) return "ia_da_plataforma";
  return "nao_deu";
}

export async function publicarAgenteDoModelo(agenteId: string): Promise<ResultadoDaPublicacao> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, motivo: "sessao" };
    throw err;
  }
  if (ctx.role !== "admin") return { ok: false, motivo: "papel" };

  const requestId = randomUUID();
  try {
    await publicarAgente({ admin: createAdminClient(), orgId: ctx.orgId, autorUserId: ctx.userId, requestId }, { agente: agenteId });
  } catch (err) {
    if (err instanceof Recusa) return { ok: false, motivo: motivoDoBloqueio(err.message) };
    return { ok: false, motivo: "nao_deu" };
  }

  try {
    await patchOnboardingState(ctx.orgId, { ai: { agent_id: agenteId, prompt_template: "modelo_do_segmento" } });
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, motivo: "registro" };
    throw err;
  }
  void audit({
    action: "onboarding.agente_do_modelo_publicado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "ai_agent",
    resourceId: agenteId,
    requestId,
  });
  redirect("/onboarding");
}

/** Seguir sem publicar: o passo fica feito com o agente em rascunho (o "o que falta" segue cobrando a publicação). */
export async function seguirComORascunhoDoModelo(agenteId: string): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, { ai: { agent_id: agenteId, prompt_template: "modelo_do_segmento" } });
  redirect("/onboarding");
}

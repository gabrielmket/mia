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

export type ResultadoDaPublicacao = { ok: true } | { ok: false; erro: string };

/** O que impede publicar, dito para quem não opera a plataforma. */
function fraseDoBloqueio(mensagem: string): string {
  if (/número|numero|conectad/i.test(mensagem)) {
    return "Ele ainda não tem um número de WhatsApp conectado. Conecte o número no passo \"O telefone dele\" (ou em Conexões) e publique de novo, ou siga sem publicar.";
  }
  if (/chave|IA|modelo/i.test(mensagem)) {
    return "A inteligência dele é configurada pela nossa equipe e ainda não está pronta nesta conta. Pode seguir; se ele não entrar no ar, fale com o suporte.";
  }
  return "Ainda não deu para publicar. Pode seguir e publicar depois em Agente MIA › Agentes.";
}

export async function publicarAgenteDoModelo(agenteId: string): Promise<ResultadoDaPublicacao> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, erro: "Sua sessão expirou. Entre de novo." };
    throw err;
  }
  if (ctx.role !== "admin") return { ok: false, erro: "Publicar o agente é de quem administra a empresa." };

  const requestId = randomUUID();
  try {
    await publicarAgente({ admin: createAdminClient(), orgId: ctx.orgId, autorUserId: ctx.userId, requestId }, { agente: agenteId });
  } catch (err) {
    if (err instanceof Recusa) return { ok: false, erro: fraseDoBloqueio(err.message) };
    return { ok: false, erro: "Ainda não deu para publicar. Tente de novo em instantes." };
  }

  try {
    await patchOnboardingState(ctx.orgId, { ai: { agent_id: agenteId, prompt_template: "modelo_do_segmento" } });
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, erro: "Publiquei o agente, mas não consegui registrar o passo. Tente continuar de novo." };
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

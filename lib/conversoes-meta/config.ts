/**
 * FORK MIA — a chave "leads de formulário da Meta voltam para a Meta"
 * (`mia_conversoes_meta_config`, migration 9017).
 *
 * Ligada, os eventos de etapa com regra ligada (as regras são as do upstream,
 * `meta_ads_conversion_rules`, migration 0524) e a venda também são informados
 * para o lead que veio de formulário da Meta, pelo id do lead guardado na origem
 * do negócio, mesmo sem clique em anúncio de WhatsApp. Quem envia é o consumidor
 * `formulario.handler.ts`, ao lado dos do upstream.
 *
 * ⚠️ AUSENTE É DESLIGADA, e é a decisão: toda empresa que existe hoje chega aqui
 * sem linha, e o id do lead e o telefone do cliente só saem para a Meta quando
 * alguém pede. E ligar NÃO envia o passado: `desde` (carimbado pelo gatilho no
 * banco, não pelo relógio de quem chama) é a trava de retroatividade.
 *
 * ⚠️ Servidor: importa `lib/audit`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

/** Quem grava, para a trilha de auditoria. */
export interface QuemSalva {
  organizationId: string;
  /** A pessoa responsável: quem clicou na tela, ou quem criou o token do MCP. */
  autorUserId: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Por onde a gravação veio. */
  via: "tela" | "mcp_plataforma";
}

export interface ChaveDeFormulario {
  ligada: boolean;
  /** Desde quando está ligada. `null` com a chave desligada. */
  desde: string | null;
}

/** Lê a chave. LANÇA em falha de leitura: o consumidor espera e tenta de novo. */
export async function lerChaveDeFormulario(admin: SupabaseClient, organizationId: string): Promise<ChaveDeFormulario> {
  const { data, error } = await admin
    .from("mia_conversoes_meta_config")
    .select("leads_de_formulario, leads_de_formulario_desde")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler a chave dos leads de formulário.");
  const linha = data as { leads_de_formulario: boolean; leads_de_formulario_desde: string | null } | null;
  return {
    ligada: linha?.leads_de_formulario === true,
    desde: linha?.leads_de_formulario === true ? (linha.leads_de_formulario_desde ?? null) : null,
  };
}

export type ResultadoDaChave =
  | { ok: true; desfecho: "atualizou" | "ja_estava"; ligada: boolean }
  | { ok: false; erro: "erro_ao_gravar" };

/** Liga ou desliga a chave. Mesmo pedido de novo responde `ja_estava` e não regrava. */
export async function definirChaveDeFormulario(
  admin: SupabaseClient,
  quem: QuemSalva,
  ligar: boolean,
): Promise<ResultadoDaChave> {
  let atual: ChaveDeFormulario;
  try {
    atual = await lerChaveDeFormulario(admin, quem.organizationId);
  } catch {
    return { ok: false, erro: "erro_ao_gravar" };
  }
  if (atual.ligada === ligar) return { ok: true, desfecho: "ja_estava", ligada: ligar };

  const { error } = await admin.from("mia_conversoes_meta_config").upsert(
    {
      organization_id: quem.organizationId,
      leads_de_formulario: ligar,
      atualizada_por: quem.autorUserId,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, erro: "erro_ao_gravar" };

  await audit({
    action: "conversoes_meta.leads_de_formulario",
    actorUserId: quem.autorUserId,
    organizationId: quem.organizationId,
    resourceType: "mia_conversoes_meta_config",
    resourceId: quem.organizationId,
    requestId: quem.requestId,
    ip: quem.ip,
    userAgent: quem.userAgent,
    metadata: { via: quem.via, ligada: ligar },
  });

  return { ok: true, desfecho: "atualizou", ligada: ligar };
}

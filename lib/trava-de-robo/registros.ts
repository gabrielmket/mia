/**
 * FORK MIA (.108) · Ver, configurar e desfazer a trava de robô: o que o MCP de
 * plataforma chama (`lib/mcp-plataforma/ferramentas/trava-de-robo.ts`).
 *
 * Desfazer é a MESMA devolução da tela ("Devolver ao automático",
 * `devolverAtendimentoAoAgente`), que solta o `force_human` do contato e o
 * silêncio da conversa; aqui ela ganha só as duas coisas que são da trava: tirar
 * a etiqueta "robô" e marcar o registro como desfeito. O negócio NÃO reabre e a
 * conversa NÃO reabre: os dois são decisão de quem atende, pela tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { normalizarTags } from "@/lib/contacts/tag-normalizada";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import {
  CONFIG_PADRAO_DA_TRAVA,
  configDaLinha,
  lerConfigDaTrava,
  LIMITES_DA_TRAVA,
  type ConfigDaTrava,
  type PedidoDeConfigDaTrava,
} from "./config";
import { ETIQUETA_DE_ROBO } from "./etiqueta";

export interface RegistroDaTrava {
  id: string;
  organization_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  job_id: string | null;
  motivo: "robo" | "teto";
  sinais: unknown;
  mensagens_de_robo: number;
  respostas_da_ia: number;
  duracao_segundos: number;
  negocios_afetados: string[];
  conversa_encerrada: boolean;
  etiqueta_aplicada: boolean;
  followups_cancelados: number;
  falhas: string[];
  desfeita_em: string | null;
  desfeita_por_user_id: string | null;
  created_at: string;
}

/** Os 4 últimos dígitos do telefone: o bastante para achar, sem expor o número. */
export function finalDoTelefone(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/gu, "");
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

export async function listarTravas(
  admin: SupabaseClient,
  filtro: { organizationId?: string | null; desde: Date; motivo?: "robo" | "teto" | null; limite: number },
): Promise<Array<RegistroDaTrava & { telefone_final: string | null; empresa: string | null; link_da_conversa: string | null }>> {
  let consulta = admin.from("mia_travas_de_robo").select("*").gte("created_at", filtro.desde.toISOString());
  if (filtro.organizationId) consulta = consulta.eq("organization_id", filtro.organizationId);
  if (filtro.motivo) consulta = consulta.eq("motivo", filtro.motivo);
  const { data, error } = await consulta.order("created_at", { ascending: false }).limit(filtro.limite);
  if (error) throw new Error(`não consegui ler as travas de robô: ${error.message}`);
  const linhas = (data ?? []) as RegistroDaTrava[];

  const contatos = [...new Set(linhas.map((l) => l.contact_id).filter((c): c is string => typeof c === "string"))];
  const empresas = [...new Set(linhas.map((l) => l.organization_id))];
  const telefones = new Map<string, string | null>();
  if (contatos.length > 0) {
    const { data: cs } = await admin.from("contacts").select("id, phone_number").in("id", contatos);
    for (const c of (cs ?? []) as Array<{ id: string; phone_number: string | null }>) telefones.set(c.id, finalDoTelefone(c.phone_number));
  }
  const nomes = new Map<string, string>();
  if (empresas.length > 0) {
    const { data: os } = await admin.from("organizations").select("id, display_name").in("id", empresas);
    for (const o of (os ?? []) as Array<{ id: string; display_name: string }>) nomes.set(o.id, o.display_name);
  }
  return linhas.map((l) => ({
    ...l,
    telefone_final: l.contact_id ? (telefones.get(l.contact_id) ?? null) : null,
    empresa: nomes.get(l.organization_id) ?? null,
    link_da_conversa: l.conversation_id ? `/app/inbox?id=${l.conversation_id}` : null,
  }));
}

export async function configurarTrava(
  admin: SupabaseClient,
  entrada: { organizationId: string; pedido: PedidoDeConfigDaTrava; autorUserId: string; requestId: string },
): Promise<{ config: ConfigDaTrava; ja_estava: boolean; antes: ConfigDaTrava }> {
  const lida = await lerConfigDaTrava(admin, entrada.organizationId);
  if (!lida.lida) throw new Error(`não consegui ler a configuração da trava de robô: ${lida.erro ?? "erro"}`);
  const antes = lida.config;
  const depois = configDaLinha({ ...antes, ...entrada.pedido });
  const igual = depois.ligada === antes.ligada && LIMITES_DA_TRAVA.every((c) => depois[c] === antes[c]);
  if (igual && lida.gravada) return { config: depois, ja_estava: true, antes };

  const { error } = await admin.from("mia_trava_de_robo_config").upsert(
    {
      organization_id: entrada.organizationId,
      ...depois,
      updated_by_user_id: entrada.autorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(`não consegui gravar a configuração da trava de robô: ${error.message}`);
  await audit({
    action: "ai.trava_de_robo_configurada",
    actorUserId: entrada.autorUserId,
    organizationId: entrada.organizationId,
    resourceType: "organization",
    resourceId: entrada.organizationId,
    requestId: entrada.requestId,
    metadata: { antes, depois, via: "mcp_plataforma" },
  });
  return { config: depois, ja_estava: igual, antes };
}

export interface DesfazimentoDaTrava {
  registro_id: string;
  motivo: "robo" | "teto";
  conversation_id: string;
  ia_retomada: boolean;
  etiqueta_tirada: boolean;
  negocios_continuam_perdidos: string[];
  conversa_continua_encerrada: boolean;
}

export async function desfazerTrava(
  admin: SupabaseClient,
  entrada: { organizationId: string; conversationId: string; autorUserId: string; requestId: string },
): Promise<DesfazimentoDaTrava> {
  const { data, error } = await admin
    .from("mia_travas_de_robo")
    .select("*")
    .eq("organization_id", entrada.organizationId)
    .eq("conversation_id", entrada.conversationId)
    .is("desfeita_em", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a trava de robô da conversa: ${error.message}`);
  const registro = data as RegistroDaTrava | null;
  if (!registro) {
    throw new Recusa(
      `A conversa ${entrada.conversationId} não tem trava de robô de pé nesta empresa. ` +
        "Use plataforma_ver_travas_de_robo com o organization_id para ver as conversas travadas.",
    );
  }

  // A IA volta pela MESMA devolução da tela. A mensagem do robô que está sem resposta
  // não é respondida agora: quem desfaz decide o que a IA fala, e o próximo turno é o
  // da próxima mensagem do contato.
  const devolucao = await devolverAtendimentoAoAgente(
    { supabase: admin, organizationId: entrada.organizationId, actor: { type: "user", id: entrada.autorUserId, role: "admin" }, requestId: entrada.requestId },
    { conversationId: entrada.conversationId, responderPendente: false },
  );
  if (!devolucao.ok) {
    if (devolucao.erro === "contato_sempre_humano") {
      throw new Recusa(
        'O contato está marcado como "sempre atendimento humano": a IA não volta para ele por aqui. ' +
          "Quem decide isso é a equipe, na ficha do contato.",
      );
    }
    throw new Error(`a IA não foi devolvida à conversa: ${devolucao.erro}${devolucao.detalhe ? ` (${devolucao.detalhe})` : ""}`);
  }

  let etiquetaTirada = false;
  if (registro.contact_id) {
    const { data: contato } = await admin
      .from("contacts")
      .select("tags")
      .eq("organization_id", entrada.organizationId)
      .eq("id", registro.contact_id)
      .maybeSingle();
    const atuais = normalizarTags(((contato as { tags?: string[] } | null)?.tags ?? []) as string[]);
    if (atuais.includes(ETIQUETA_DE_ROBO)) {
      const { error: erroDaEtiqueta } = await admin
        .from("contacts")
        .update({ tags: atuais.filter((t) => t !== ETIQUETA_DE_ROBO) })
        .eq("organization_id", entrada.organizationId)
        .eq("id", registro.contact_id);
      etiquetaTirada = !erroDaEtiqueta;
    }
  }

  await admin
    .from("mia_travas_de_robo")
    .update({ desfeita_em: new Date().toISOString(), desfeita_por_user_id: entrada.autorUserId })
    .eq("organization_id", entrada.organizationId)
    .eq("id", registro.id);

  await audit({
    action: "ai.trava_de_robo_desfeita",
    actorUserId: entrada.autorUserId,
    organizationId: entrada.organizationId,
    resourceType: "conversation",
    resourceId: entrada.conversationId,
    requestId: entrada.requestId,
    metadata: { registro_id: registro.id, motivo: registro.motivo, etiqueta_tirada: etiquetaTirada, via: "mcp_plataforma" },
  });

  return {
    registro_id: registro.id,
    motivo: registro.motivo,
    conversation_id: entrada.conversationId,
    ia_retomada: true,
    etiqueta_tirada: etiquetaTirada,
    negocios_continuam_perdidos: registro.negocios_afetados ?? [],
    conversa_continua_encerrada: registro.conversa_encerrada === true,
  };
}

export { CONFIG_PADRAO_DA_TRAVA };

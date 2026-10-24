/**
 * FORK MIA (.89) — O QUE FAZER COM CADA AVISO DA AMAZON.
 *
 *   entrega     o destinatário vira "entregue"
 *   rejeição    permanente (o endereço não existe): "rejeitado" e entra na
 *               supressão NA HORA, para sempre. Temporária (caixa cheia): a
 *               Amazon já tentou de novo; em 3 campanhas SEGUIDAS vira permanente
 *   reclamação  marcou como spam: entra na supressão na hora, para sempre
 *
 * Idempotente pelo id do aviso (`mia_email_eventos.aviso_id`): a Amazon entrega
 * o mesmo aviso mais de uma vez, e o segundo não faz nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventoDaSes } from "./avisos-da-amazon";
import { REJEICOES_TEMPORARIAS_SEGUIDAS } from "./regras";
import { suprimirEmail } from "./supressao";

export type DesfechoDoAviso = "aplicado" | "repetido" | "sem_destinatario";

interface Destinatario {
  id: string;
  organization_id: string;
  campanha_id: string;
  contact_id: string | null;
  email: string | null;
  email_hash: string;
  status: string;
}

async function nomeDaCampanha(db: SupabaseClient, orgId: string, id: string): Promise<string> {
  const { data } = await db
    .from("mia_email_campanhas")
    .select("nome")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return ((data as { nome?: string } | null)?.nome ?? "campanha").slice(0, 80);
}

/** As últimas 3 campanhas que mandaram para este endereço voltaram todas como temporárias? */
async function temporariaRepetida(db: SupabaseClient, d: Destinatario): Promise<boolean> {
  const { data, error } = await db
    .from("mia_email_destinatarios")
    .select("id, status, rejeicao_tipo, enviado_em")
    .eq("organization_id", d.organization_id)
    .eq("email_hash", d.email_hash)
    .in("status", ["enviado", "entregue", "rejeitado", "reclamacao"])
    .order("enviado_em", { ascending: false })
    .limit(REJEICOES_TEMPORARIAS_SEGUIDAS);
  if (error) throw new Error(`rejeições anteriores: ${error.message}`);
  const linhas = (data ?? []) as Array<{ status: string; rejeicao_tipo: string | null }>;
  return (
    linhas.length >= REJEICOES_TEMPORARIAS_SEGUIDAS &&
    linhas.every((l) => l.status === "rejeitado" && l.rejeicao_tipo === "temporaria")
  );
}

export async function aplicarAviso(
  db: SupabaseClient,
  evento: EventoDaSes,
  avisoId: string,
): Promise<DesfechoDoAviso> {
  const { data, error } = await db
    .from("mia_email_destinatarios")
    .select("id, organization_id, campanha_id, contact_id, email, email_hash, status")
    .eq("ses_message_id", evento.messageId)
    .maybeSingle();
  if (error) throw new Error(`destinatário do aviso: ${error.message}`);
  if (!data) return "sem_destinatario";
  const d = data as Destinatario;

  const { error: erroEvento } = await db.from("mia_email_eventos").insert({
    organization_id: d.organization_id,
    destinatario_id: d.id,
    tipo: evento.tipo,
    aviso_id: avisoId,
    ocorrido_em: evento.ocorridoEm,
    detalhe: evento.detalhe,
  });
  if (erroEvento) {
    if ((erroEvento as { code?: string }).code === "23505") return "repetido";
    throw new Error(`aviso: ${erroEvento.message}`);
  }

  if (evento.tipo === "entrega") {
    await db
      .from("mia_email_destinatarios")
      .update({ status: "entregue", entregue_em: evento.ocorridoEm })
      .eq("organization_id", d.organization_id)
      .eq("id", d.id)
      .eq("status", "enviado");
    return "aplicado";
  }

  const campanha = await nomeDaCampanha(db, d.organization_id, d.campanha_id);
  if (evento.tipo === "reclamacao") {
    await db
      .from("mia_email_destinatarios")
      .update({ status: "reclamacao", reclamacao_em: evento.ocorridoEm })
      .eq("organization_id", d.organization_id)
      .eq("id", d.id);
    await suprimirEmail(db, {
      organizationId: d.organization_id,
      email: d.email,
      hash: d.email_hash,
      motivo: "reclamacao",
      deOnde: `Marcou como spam · ${campanha}`,
      contactId: d.contact_id,
    });
    return "aplicado";
  }

  // Rejeição.
  await db
    .from("mia_email_destinatarios")
    .update({
      status: "rejeitado",
      rejeitado_em: evento.ocorridoEm,
      rejeicao_tipo: evento.rejeicao ?? "permanente",
    })
    .eq("organization_id", d.organization_id)
    .eq("id", d.id)
    .neq("status", "reclamacao");
  if (evento.rejeicao === "permanente") {
    await suprimirEmail(db, {
      organizationId: d.organization_id,
      email: d.email,
      hash: d.email_hash,
      motivo: "rejeicao",
      deOnde: `Rejeição permanente · ${campanha}`,
      contactId: d.contact_id,
    });
  } else if (await temporariaRepetida(db, d)) {
    await suprimirEmail(db, {
      organizationId: d.organization_id,
      email: d.email,
      hash: d.email_hash,
      motivo: "rejeicao",
      deOnde: `Rejeição temporária em ${REJEICOES_TEMPORARIAS_SEGUIDAS} campanhas seguidas`,
      contactId: d.contact_id,
    });
  }
  return "aplicado";
}

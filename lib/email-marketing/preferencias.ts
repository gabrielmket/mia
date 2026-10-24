/**
 * FORK MIA (.89) — O LADO DE QUEM RECEBE: descadastro de um clique, página de
 * preferências sem login e "voltar a receber".
 *
 * Quem chama é uma rota pública, com o token assinado do e-mail
 * (`lib/email-marketing/token.ts`). A empresa e o destinatário vêm do TOKEN e
 * são conferidos na linha do banco (o destinatário tem de ser daquela empresa):
 * nada vem do corpo do pedido.
 *
 * As decisões do protótipo:
 *   - o descadastro vale para TODO e-mail de marketing da empresa (todas as
 *     campanhas); pedido, agenda e atendimento continuam;
 *   - um clique, sem login e sem pedir motivo (o motivo é opcional na página);
 *   - a página oferece também sair do marketing pelo WhatsApp
 *     (`consent.marketing.declined_at`, a recusa que o WhatsApp do sistema já
 *     respeita);
 *   - só a própria pessoa desfaz, pelo link de um e-mail que já recebeu;
 *   - no e-mail de TESTE os links abrem a página e não mudam nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import { lerConfiguracao, lerEmpresa, type EmpresaDoEmail } from "./banco";
import { consentComAceite, consentComRecusa, recusouMarketing } from "./consentimento";
import {
  comEmpresa,
  TEXTO_PADRAO_DO_CONSENTIMENTO,
  VERSAO_PADRAO_DO_CONSENTIMENTO,
} from "./textos-padrao";
import { suprimirEmail, supressaoDoEmail, voltarAReceber } from "./supressao";
import { verificarToken } from "./token";

export interface QuemRecebe {
  teste: boolean;
  empresa: EmpresaDoEmail;
  destinatarioId: string | null;
  campanhaId: string | null;
  campanhaNome: string | null;
  contactId: string | null;
  email: string | null;
  emailHash: string | null;
  privacidade: { url: string | null; usarPadrao: boolean };
}

/** Resolve o token. `null` = malformado, adulterado, ou de linha que não existe. */
export async function resolverQuemRecebe(
  db: SupabaseClient,
  token: string,
): Promise<QuemRecebe | null> {
  const t = verificarToken(token);
  if (!t || t.k === "c") return null;
  let empresa: EmpresaDoEmail;
  try {
    empresa = await lerEmpresa(db, t.o);
  } catch {
    return null;
  }
  const config = await lerConfiguracao(db, empresa);
  const privacidade = {
    url: config.rodape.privacidadeUrl || null,
    usarPadrao: config.rodape.usarPrivacidadePadrao,
  };
  if (t.k === "t") {
    const { data } = await db
      .from("mia_email_campanhas")
      .select("id, nome")
      .eq("organization_id", t.o)
      .eq("id", t.r)
      .maybeSingle();
    if (!data) return null;
    return {
      teste: true,
      empresa,
      destinatarioId: null,
      campanhaId: (data as { id: string }).id,
      campanhaNome: (data as { nome: string }).nome,
      contactId: null,
      email: null,
      emailHash: null,
      privacidade,
    };
  }
  const { data, error } = await db
    .from("mia_email_destinatarios")
    .select("id, campanha_id, contact_id, email, email_hash")
    .eq("organization_id", t.o)
    .eq("id", t.r)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as {
    id: string;
    campanha_id: string;
    contact_id: string | null;
    email: string | null;
    email_hash: string;
  };
  const { data: c } = await db
    .from("mia_email_campanhas")
    .select("nome")
    .eq("organization_id", t.o)
    .eq("id", d.campanha_id)
    .maybeSingle();
  // O endereço legível pode ter saído (anonimização): o hash ainda decide.
  let email = d.email;
  if (!email && d.contact_id) {
    const { data: contato } = await db
      .from("contacts")
      .select("email")
      .eq("organization_id", t.o)
      .eq("id", d.contact_id)
      .maybeSingle();
    email = (contato as { email?: string | null } | null)?.email ?? null;
  }
  return {
    teste: false,
    empresa,
    destinatarioId: d.id,
    campanhaId: d.campanha_id,
    campanhaNome: (c as { nome?: string } | null)?.nome ?? null,
    contactId: d.contact_id,
    email,
    emailHash: d.email_hash,
    privacidade,
  };
}

export interface SituacaoDaPessoa {
  saiu: boolean;
  saiuEm: string | null;
  motivoDaSaida: string | null;
  podeVoltar: boolean;
  recusouWhatsapp: boolean;
}

export async function situacaoDaPessoa(
  db: SupabaseClient,
  q: QuemRecebe,
): Promise<SituacaoDaPessoa> {
  if (q.teste || !q.emailHash)
    return {
      saiu: false,
      saiuEm: null,
      motivoDaSaida: null,
      podeVoltar: false,
      recusouWhatsapp: false,
    };
  const s = await supressaoDoEmail(db, q.empresa.id, q.emailHash);
  let recusouWhatsapp = false;
  if (q.contactId) {
    const { data } = await db
      .from("contacts")
      .select("consent")
      .eq("organization_id", q.empresa.id)
      .eq("id", q.contactId)
      .maybeSingle();
    recusouWhatsapp = recusouMarketing((data as { consent?: unknown } | null)?.consent);
  }
  return {
    saiu: !!s,
    saiuEm: s?.quando ?? null,
    motivoDaSaida: s?.motivo ?? null,
    // Rejeição não volta: o endereço não existe. Anonimizado (sem endereço
    // legível) também não: o veto que sobrevive à anonimização é o pedido dele.
    podeVoltar: !!s && s.motivo !== "rejeicao" && !!q.email,
    recusouWhatsapp,
  };
}

export type PortaDoDescadastro = "um_clique" | "pagina";

/**
 * Tira a pessoa da lista. Idempotente: o segundo clique não muda nada e não
 * audita de novo. No teste, não faz nada.
 */
export async function descadastrar(
  db: SupabaseClient,
  q: QuemRecebe,
  opcoes: { porta: PortaDoDescadastro; tambemWhatsapp?: boolean; motivo?: string | null },
): Promise<{ saiu: boolean; jaTinhaSaido: boolean }> {
  if (q.teste || !q.emailHash) return { saiu: false, jaTinhaSaido: false };
  const antes = await supressaoDoEmail(db, q.empresa.id, q.emailHash);
  const deOnde = `${opcoes.porta === "um_clique" ? "Botão do Gmail" : "Página de preferências"}${q.campanhaNome ? ` · ${q.campanhaNome.slice(0, 80)}` : ""}`;
  if (!antes) {
    await suprimirEmail(db, {
      organizationId: q.empresa.id,
      email: q.email,
      hash: q.emailHash,
      motivo: "descadastro",
      deOnde: opcoes.motivo ? `${deOnde} · ${opcoes.motivo.slice(0, 60)}` : deOnde,
      contactId: q.contactId,
    });
    if (q.destinatarioId) {
      await db
        .from("mia_email_destinatarios")
        .update({ descadastrado_em: new Date().toISOString() })
        .eq("organization_id", q.empresa.id)
        .eq("id", q.destinatarioId)
        .is("descadastrado_em", null);
    }
  }
  if (q.contactId && (!antes || opcoes.tambemWhatsapp)) {
    const { data } = await db
      .from("contacts")
      .select("consent")
      .eq("organization_id", q.empresa.id)
      .eq("id", q.contactId)
      .maybeSingle();
    const consent = consentComRecusa((data as { consent?: unknown } | null)?.consent, {
      quando: new Date().toISOString(),
      porta: "pagina_de_preferencias",
      registradoPor: null,
      tambemWhatsapp: opcoes.tambemWhatsapp,
    });
    await db
      .from("contacts")
      .update({ consent })
      .eq("organization_id", q.empresa.id)
      .eq("id", q.contactId);
    await db.from("mia_email_consentimentos").insert({
      organization_id: q.empresa.id,
      contact_id: q.contactId,
      email_hash: q.emailHash,
      tipo: "recusa",
      ocorrido_em: new Date().toISOString(),
      origem: deOnde,
      aceitou_medicao: false,
      registrado_pelo: "pagina_de_preferencias",
    });
  }
  if (!antes || opcoes.tambemWhatsapp) {
    void audit({
      action: "email_marketing.descadastro",
      organizationId: q.empresa.id,
      resourceType: "mia_email_destinatarios",
      resourceId: q.destinatarioId,
      metadata: {
        porta: opcoes.porta,
        tambem_whatsapp: opcoes.tambemWhatsapp === true,
        ja_tinha_saido: !!antes,
      },
    });
  }
  return { saiu: true, jaTinhaSaido: !!antes };
}

/**
 * Volta a receber: só pela própria pessoa, pela página do link que ela recebeu.
 * Grava um aceite novo com o texto que a página mostra (a medição incluída).
 */
export async function voltarAReceberPeloTitular(
  db: SupabaseClient,
  q: QuemRecebe,
): Promise<{ voltou: boolean }> {
  if (q.teste || !q.emailHash || !q.email) return { voltou: false };
  const s = await supressaoDoEmail(db, q.empresa.id, q.emailHash);
  if (s?.motivo === "rejeicao") return { voltou: false };
  if (s) await voltarAReceber(db, q.empresa.id, q.emailHash);
  if (q.contactId) {
    const { data } = await db
      .from("contacts")
      .select("consent")
      .eq("organization_id", q.empresa.id)
      .eq("id", q.contactId)
      .maybeSingle();
    const atual = (data as { consent?: unknown } | null)?.consent;
    const agora = new Date().toISOString();
    const consent = consentComAceite(atual, {
      quando: agora,
      origem: "Página de preferências",
      versao: VERSAO_PADRAO_DO_CONSENTIMENTO,
      evidencia: "A própria pessoa, pelo link de um e-mail recebido",
      medicao: true,
      registradoPor: null,
      porta: "pagina_de_preferencias",
    });
    await db
      .from("contacts")
      .update({ consent })
      .eq("organization_id", q.empresa.id)
      .eq("id", q.contactId);
    await db.from("mia_email_consentimentos").insert({
      organization_id: q.empresa.id,
      contact_id: q.contactId,
      email_hash: q.emailHash,
      tipo: "aceite",
      ocorrido_em: agora,
      origem: "Página de preferências",
      versao_do_texto: VERSAO_PADRAO_DO_CONSENTIMENTO,
      texto_aceito: comEmpresa(TEXTO_PADRAO_DO_CONSENTIMENTO, q.empresa.nome),
      aceitou_medicao: true,
      evidencia: "A própria pessoa, pelo link de um e-mail recebido",
      registrado_pelo: "pagina_de_preferencias",
    });
  }
  void audit({
    action: "email_marketing.reinscricao",
    organizationId: q.empresa.id,
    resourceType: "mia_email_destinatarios",
    resourceId: q.destinatarioId,
    metadata: { porta: "pagina_de_preferencias" },
  });
  return { voltou: true };
}

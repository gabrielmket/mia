/**
 * FORK MIA — o lead da Meta traduzido para o que o CRM grava. Puro: nenhuma rede,
 * nenhum banco, nenhuma data implícita. O que pode errar em silêncio (a janela de
 * leitura, o nome que vem em duas partes, a origem do anúncio) mora aqui, onde o
 * teste alcança sem token.
 */
import { createHash } from "node:crypto";

import type { LeadCru } from "@/lib/plataformas-de-anuncio/meta/leads";

// ─── as datas ───────────────────────────────────────────────────────────────

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

/**
 * Quanto cada leitura volta para trás da marca. Cobre o lead que a Meta grava
 * com `created_time` de antes da marca mas só torna legível depois dela; a
 * deduplicação pelo id faz a sobreposição sair de graça.
 */
export const SOBREPOSICAO_MS = 15 * MINUTO;
/** Uma leitura nunca pede mais que 7 dias: a recuperação anda em passos. */
export const JANELA_MAXIMA_MS = 7 * DIA;
/** A Meta guarda os leads por 90 dias. Antes disso não há o que buscar. */
export const RETENCAO_DA_META_MS = 90 * DIA;

/**
 * `2026-09-29T12:34:56+0000` → Date. O fuso sem dois-pontos é o formato da
 * Graph; nem todo motor de JavaScript o aceita, então vira `+00:00` antes.
 */
export function dataDaMeta(valor: string | undefined | null): Date | null {
  if (!valor) return null;
  const normalizado = valor.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(normalizado);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface JanelaDeLeitura {
  de: Date;
  ate: Date;
  /** `ate` chegou a `agora`: esta leitura alcança o presente. */
  alcancaOPresente: boolean;
  /** A marca (ou a recuperação pedida) era mais velha que os 90 dias da Meta. */
  recuperacaoCortada: boolean;
}

/**
 * A janela desta leitura.
 *
 * Primeira leitura (sem marca): volta `diasDeRecuperacao`. Depois: da marca menos
 * a sobreposição. Nunca antes dos 90 dias da Meta, nunca mais que 7 dias de uma
 * vez, nunca depois de `agora`.
 */
export function janelaDeLeitura(entrada: {
  lidoAte: Date | null;
  diasDeRecuperacao: number;
  agora: Date;
}): JanelaDeLeitura {
  const agora = entrada.agora.getTime();
  const dias = Math.min(Math.max(entrada.diasDeRecuperacao, 0), 90);
  const base = entrada.lidoAte ? entrada.lidoAte.getTime() : agora - dias * DIA;
  const piso = agora - RETENCAO_DA_META_MS;
  const desejado = base - SOBREPOSICAO_MS;
  const de = Math.max(Math.min(desejado, agora), piso);
  const ate = Math.min(de + JANELA_MAXIMA_MS, agora);
  return {
    de: new Date(de),
    ate: new Date(ate),
    alcancaOPresente: ate >= agora,
    // A sobreposição sozinha não conta como corte: só a marca além dos 90 dias.
    recuperacaoCortada: base < piso,
  };
}

// ─── o lead ─────────────────────────────────────────────────────────────────

export interface CampoDoLead {
  /** A chave da pergunta na Meta (`full_name`, `phone_number`, `qual_seu_interesse?`). */
  chave: string;
  valor: string;
}

export interface LeadDaMeta {
  leadgenId: string;
  criadoEm: Date | null;
  formId: string | null;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Veio de publicação orgânica (sem anúncio) — a Meta marca assim. */
  organico: boolean | null;
  /** `fb`, `ig`… de onde a pessoa preencheu. */
  plataforma: string | null;
  campos: CampoDoLead[];
}

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** O fio → o lead. Sem id não há como deduplicar, e o lead é descartado aqui. */
export function lerLeadCru(cru: LeadCru): LeadDaMeta | null {
  const id = texto(cru.id);
  if (!id) return null;
  const campos: CampoDoLead[] = [];
  for (const campo of cru.field_data ?? []) {
    const chave = texto(campo.name);
    if (!chave) continue;
    // Múltipla escolha chega como vários valores; a tela e a IA leem uma frase.
    const valores = (campo.values ?? [])
      .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "")))
      .filter(Boolean);
    if (valores.length === 0) continue;
    campos.push({ chave, valor: valores.join(", ") });
  }
  return {
    leadgenId: id,
    criadoEm: dataDaMeta(cru.created_time),
    formId: texto(cru.form_id),
    adId: texto(cru.ad_id),
    adName: texto(cru.ad_name),
    adsetId: texto(cru.adset_id),
    adsetName: texto(cru.adset_name),
    campaignId: texto(cru.campaign_id),
    campaignName: texto(cru.campaign_name),
    organico: typeof cru.is_organic === "boolean" ? cru.is_organic : null,
    plataforma: texto(cru.platform),
    campos,
  };
}

/**
 * O formulário como o mapeador da fonte de webhook o entende (`mapInboundPayload`
 * reconhece `full_name`, `phone_number` e `email`, que são as chaves padrão da
 * Meta). Nome em duas partes (`first_name` + `last_name`) vira `full_name`.
 */
export function payloadParaMapear(lead: LeadDaMeta): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const { chave, valor } of lead.campos) payload[chave] = valor;
  if (!payload.full_name && (payload.first_name || payload.last_name)) {
    payload.full_name = [payload.first_name, payload.last_name].filter(Boolean).join(" ");
    delete payload.first_name;
    delete payload.last_name;
  }
  // Telefone e e-mail "do trabalho" só valem na falta dos pessoais.
  if (!payload.phone_number && payload.work_phone_number) {
    payload.phone_number = payload.work_phone_number;
    delete payload.work_phone_number;
  }
  if (!payload.email && payload.work_email) {
    payload.email = payload.work_email;
    delete payload.work_email;
  }
  return payload;
}

/** Os rótulos das perguntas padrão, quando o formulário não traz o texto. */
const ROTULO_PADRAO: Record<string, string> = {
  full_name: "Nome completo",
  first_name: "Nome",
  last_name: "Sobrenome",
  email: "E-mail",
  phone_number: "Telefone",
  city: "Cidade",
  state: "Estado",
  zip_code: "CEP",
  post_code: "CEP",
  street_address: "Endereço",
  country: "País",
  date_of_birth: "Data de nascimento",
  job_title: "Cargo",
  company_name: "Empresa",
  work_email: "E-mail do trabalho",
  work_phone_number: "Telefone do trabalho",
};

/** A chave da Meta → o texto que a pessoa leu no formulário. */
export function rotuloDaPergunta(chave: string, perguntas: Record<string, string>): string {
  return perguntas[chave] ?? ROTULO_PADRAO[chave] ?? chave.replace(/[_?]+/g, " ").trim();
}

/** Troca as chaves pelos rótulos originais (o que a captação e o negócio guardam). */
export function comRotulos(
  campos: Record<string, string>,
  perguntas: Record<string, string>,
): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    saida[rotuloDaPergunta(chave, perguntas)] = valor;
  }
  return saida;
}

export interface FormularioDaAtribuicao {
  formId: string;
  formName: string | null;
  pageId: string;
  pageName: string | null;
}

/**
 * A origem que o contato e o negócio carregam em `source_metadata`.
 *
 * `ad_platform` e `ad_id` são as chaves que o produto já lê (a ficha do contato
 * resolve anúncio, conjunto e campanha pelo `ad_id`; a origem da tela lê
 * `campaign_name`, `adset_name` e `ad_name`). `ad_source_id` fica de fora DE
 * PROPÓSITO: hoje ele sai para a Meta como identificador de clique do WhatsApp,
 * e o id do lead não é isso. O id do lead vai em `meta_lead_id`, para a conversão
 * de CRM que ainda vai sair (docs/fork/leads-da-meta.md).
 */
export function atribuicaoDoLead(
  lead: LeadDaMeta,
  formulario: FormularioDaAtribuicao,
): Record<string, string | boolean> {
  const meta: Record<string, string | boolean> = {
    ad_platform: "meta_ads",
    meta_lead_id: lead.leadgenId,
    meta_form_id: lead.formId ?? formulario.formId,
    meta_page_id: formulario.pageId,
    ad_captured_at: (lead.criadoEm ?? new Date()).toISOString(),
  };
  if (formulario.formName) meta.meta_form_name = formulario.formName;
  if (formulario.pageName) meta.meta_page_name = formulario.pageName;
  if (lead.adId) meta.ad_id = lead.adId;
  if (lead.adName) meta.ad_name = lead.adName;
  if (lead.adsetId) meta.adset_id = lead.adsetId;
  if (lead.adsetName) meta.adset_name = lead.adsetName;
  if (lead.campaignId) meta.campaign_id = lead.campaignId;
  if (lead.campaignName) meta.campaign_name = lead.campaignName;
  if (lead.organico !== null) meta.meta_lead_organico = lead.organico;
  if (lead.plataforma) meta.meta_lead_plataforma = lead.plataforma;
  return meta;
}

/**
 * O que a tabela de deduplicação e o `external_id` do negócio guardam: um hash do
 * id do lead, nunca o id cru (migration 9003, cabeçalho).
 */
export function chaveDoLead(leadgenId: string): string {
  return createHash("sha256").update(`meta-lead:${leadgenId}`).digest("hex");
}

/** O `external_id` do negócio. O índice único do upstream deduplica por ele. */
export function externalIdDoLead(leadgenId: string): string {
  return `meta-lead:${chaveDoLead(leadgenId).slice(0, 40)}`;
}

/** O nome da fonte na tela de captações e no que a IA lê ("o formulário X"). */
export function nomeDaFonte(formName: string | null, formId: string): string {
  return `Formulário da Meta: ${formName ?? formId}`;
}

/** A mesma regra do CHECK `contacts_email_format`: e-mail que o banco recusaria fica de fora do contato. */
export function emailAceito(email: string | null): string | null {
  if (!email) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email) ? email : null;
}

/**
 * FORK MIA (.89) — REGISTRAR o consentimento de e-mail marketing: na ficha do
 * contato, pela importação de aceites e pela página de preferências.
 *
 * Toda porta grava as DUAS coisas, na mesma ordem: o vigente
 * (`contacts.consent.email_marketing`) e o registro com a evidência
 * (`mia_email_consentimentos`). O registro é a prova da base legal — sem ele, o
 * aceite gravado no contato não responde "com base em quê você me mandou isto?".
 *
 * Regras do protótipo aprovado:
 *   - na ficha, a evidência é OBRIGATÓRIA ("print da conversa de 24/10");
 *   - na importação, linha sem data ou sem origem é recusada (lista comprada não
 *     entra como consentimento);
 *   - quem saiu da lista não é reinscrito por ninguém além dele mesmo: nem na
 *     ficha, nem por importação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import {
  comEmpresa,
  versoesPadrao,
  VERSAO_PADRAO_DO_CONSENTIMENTO,
  type VersaoDoTexto,
} from "./textos-padrao";
import {
  consentComAceite,
  consentComRecusa,
  consentimentoVigente,
  lerConsentimentoDeEmail,
  recusouMarketing,
  type PortaDoRegistro,
} from "./consentimento";
import { emailComForma, hashDoEmail, normalizarEmail } from "./endereco";
import { suprimirEmail, supressaoDoEmail } from "./supressao";
import { RecusaDaCampanha } from "./recusa";

/** As versões do texto que valem para a empresa: as dela, e as padrão. */
export async function versoesDoTexto(db: SupabaseClient, orgId: string): Promise<VersaoDoTexto[]> {
  const { data, error } = await db
    .from("mia_email_textos_de_consentimento")
    .select("versao, texto, inclui_aviso_de_medicao, rascunho_juridico")
    .eq("organization_id", orgId)
    .is("arquivado_em", null)
    .order("vigente_desde", { ascending: false });
  if (error) throw new Error(`textos de consentimento: ${error.message}`);
  const daEmpresa = ((data ?? []) as Array<Record<string, unknown>>).map((t) => ({
    versao: String(t.versao),
    texto: String(t.texto),
    incluiAvisoDeMedicao: t.inclui_aviso_de_medicao === true,
    rascunhoJuridico: t.rascunho_juridico === true,
  }));
  const usadas = new Set(daEmpresa.map((v) => v.versao));
  return [...daEmpresa, ...versoesPadrao().filter((v) => !usadas.has(v.versao))];
}

async function versao(
  db: SupabaseClient,
  orgId: string,
  nome: string | null | undefined,
  empresa: string,
): Promise<VersaoDoTexto & { textoFinal: string }> {
  const todas = await versoesDoTexto(db, orgId);
  const v = todas.find((x) => x.versao === (nome ?? VERSAO_PADRAO_DO_CONSENTIMENTO));
  if (!v)
    throw new RecusaDaCampanha(
      "versao_desconhecida",
      `Versão do texto desconhecida: ${nome}. Use uma das cadastradas.`,
    );
  return { ...v, textoFinal: comEmpresa(v.texto, empresa) };
}

interface ContatoDoRegistro {
  id: string;
  email: string | null;
  consent: unknown;
  is_anonymized: boolean;
}

async function lerContato(
  db: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<ContatoDoRegistro> {
  const { data, error } = await db
    .from("contacts")
    .select("id, email, consent, is_anonymized")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(`contato: ${error.message}`);
  if (!data) throw new RecusaDaCampanha("contato_nao_encontrado", "Contato não encontrado.", 404);
  return data as ContatoDoRegistro;
}

export interface PedidoDeAceite {
  organizationId: string;
  contactId: string;
  origem: string;
  /** Quando a pessoa aceitou (ISO). */
  quando: string;
  versao?: string | null;
  evidencia: string | null;
  porta: PortaDoRegistro;
  registradoPor: string | null;
  empresaNome: string;
  requestId?: string;
}

export async function registrarAceite(
  db: SupabaseClient,
  p: PedidoDeAceite,
): Promise<{ registrado: boolean }> {
  const c = await lerContato(db, p.organizationId, p.contactId);
  if (c.is_anonymized)
    throw new RecusaDaCampanha("anonimizado", "Contato anonimizado: não há o que registrar.", 409);
  const email = c.email ? normalizarEmail(c.email) : "";
  if (!emailComForma(email))
    throw new RecusaDaCampanha("sem_email", "O contato não tem e-mail válido no cadastro.", 422);
  if (!p.origem.trim())
    throw new RecusaDaCampanha("sem_origem", "Diga como a pessoa pediu (a origem do aceite).", 422);
  if (p.porta === "ficha" && !(p.evidencia ?? "").trim()) {
    throw new RecusaDaCampanha("sem_evidencia", "Sem evidência, o registro não grava.", 422);
  }
  const quando = Date.parse(p.quando);
  if (!Number.isFinite(quando) || quando > Date.now() + 5 * 60_000) {
    throw new RecusaDaCampanha(
      "data_invalida",
      "A data do aceite tem de ser uma data válida, e não no futuro.",
      422,
    );
  }
  const hash = hashDoEmail(email);
  const suprimido = await supressaoDoEmail(db, p.organizationId, hash);
  if (suprimido) {
    throw new RecusaDaCampanha(
      "saiu_da_lista",
      "A pessoa saiu da lista de e-mail. Só ela volta, pelo link de um e-mail que já recebeu.",
      409,
    );
  }
  const v = await versao(db, p.organizationId, p.versao, p.empresaNome);
  const consent = consentComAceite(c.consent, {
    quando: new Date(quando).toISOString(),
    origem: p.origem.trim().slice(0, 200),
    versao: v.versao,
    evidencia: (p.evidencia ?? "").trim().slice(0, 500) || null,
    medicao: v.incluiAvisoDeMedicao,
    registradoPor: p.registradoPor,
    porta: p.porta,
  });
  const { error } = await db
    .from("contacts")
    .update({ consent })
    .eq("organization_id", p.organizationId)
    .eq("id", c.id);
  if (error) throw new Error(`não consegui gravar o consentimento: ${error.message}`);
  const { error: erroRegistro } = await db.from("mia_email_consentimentos").insert({
    organization_id: p.organizationId,
    contact_id: c.id,
    email_hash: hash,
    tipo: "aceite",
    ocorrido_em: new Date(quando).toISOString(),
    origem: p.origem.trim().slice(0, 200),
    versao_do_texto: v.versao,
    texto_aceito: v.textoFinal,
    aceitou_medicao: v.incluiAvisoDeMedicao,
    evidencia: (p.evidencia ?? "").trim().slice(0, 500) || null,
    registrado_por: p.registradoPor,
    registrado_pelo: p.porta,
  });
  if (erroRegistro)
    throw new Error(`não consegui gravar o registro do consentimento: ${erroRegistro.message}`);
  void audit({
    action: "lgpd.consent_changed",
    actorUserId: p.registradoPor,
    organizationId: p.organizationId,
    resourceType: "contact",
    resourceId: c.id,
    requestId: p.requestId ?? null,
    metadata: { canal: "email_marketing", tipo: "aceite", porta: p.porta, versao: v.versao },
  });
  return { registrado: true };
}

export interface PedidoDeRecusa {
  organizationId: string;
  contactId: string;
  canal: string;
  porta: PortaDoRegistro;
  registradoPor: string | null;
  registradoPorNome?: string | null;
  tambemWhatsapp?: boolean;
  campanhaNome?: string | null;
  requestId?: string;
}

/** A recusa entra na supressão na hora. Depois disso, só a própria pessoa volta. */
export async function registrarRecusa(
  db: SupabaseClient,
  p: PedidoDeRecusa,
): Promise<{ registrado: boolean }> {
  const c = await lerContato(db, p.organizationId, p.contactId);
  const email = c.email ? normalizarEmail(c.email) : "";
  if (!emailComForma(email))
    throw new RecusaDaCampanha("sem_email", "O contato não tem e-mail válido no cadastro.", 422);
  const hash = hashDoEmail(email);
  const agora = new Date().toISOString();
  const deOnde =
    p.porta === "ficha"
      ? `${p.canal.slice(0, 80)} · registrado por ${(p.registradoPorNome ?? "a equipe").slice(0, 60)}`
      : `${p.canal.slice(0, 80)}${p.campanhaNome ? ` · ${p.campanhaNome.slice(0, 80)}` : ""}`;
  await suprimirEmail(db, {
    organizationId: p.organizationId,
    email,
    motivo: p.porta === "ficha" ? "manual" : "descadastro",
    deOnde,
    contactId: c.id,
    criadoPor: p.registradoPor,
  });
  const consent = consentComRecusa(c.consent, {
    quando: agora,
    porta: p.porta,
    registradoPor: p.registradoPor,
    tambemWhatsapp: p.tambemWhatsapp,
  });
  const { error } = await db
    .from("contacts")
    .update({ consent })
    .eq("organization_id", p.organizationId)
    .eq("id", c.id);
  if (error) throw new Error(`não consegui gravar a recusa: ${error.message}`);
  await db.from("mia_email_consentimentos").insert({
    organization_id: p.organizationId,
    contact_id: c.id,
    email_hash: hash,
    tipo: "recusa",
    ocorrido_em: agora,
    origem: p.canal.slice(0, 200),
    aceitou_medicao: false,
    registrado_por: p.registradoPor,
    registrado_pelo: p.porta,
  });
  void audit({
    action: "lgpd.consent_changed",
    actorUserId: p.registradoPor,
    organizationId: p.organizationId,
    resourceType: "contact",
    resourceId: c.id,
    requestId: p.requestId ?? null,
    metadata: {
      canal: "email_marketing",
      tipo: "recusa",
      porta: p.porta,
      tambem_whatsapp: p.tambemWhatsapp === true,
    },
  });
  return { registrado: true };
}

export interface LinhaDeAceiteImportado {
  email: string;
  /** A data do aceite (ISO ou AAAA-MM-DD). */
  data: string | null;
  origem: string | null;
  versao?: string | null;
  evidencia?: string | null;
}

export interface ResultadoDaImportacaoDeAceites {
  lidas: number;
  gravadas: number;
  ja_estavam: number;
  recusadas: Array<{ linha: number; email: string; motivo: string }>;
  ja_descadastrados: number;
  sem_contato: number;
}

/**
 * Importa aceites de uma planilha, linha a linha. Recusa linha sem data ou sem
 * origem, não mexe em quem já se descadastrou, e rodar de novo não duplica.
 */
export async function importarAceites(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    linhas: readonly LinhaDeAceiteImportado[];
    registradoPor: string | null;
    porta: "importacao" | "plataforma";
    empresaNome: string;
    requestId?: string;
  },
): Promise<ResultadoDaImportacaoDeAceites> {
  const r: ResultadoDaImportacaoDeAceites = {
    lidas: entrada.linhas.length,
    gravadas: 0,
    ja_estavam: 0,
    recusadas: [],
    ja_descadastrados: 0,
    sem_contato: 0,
  };
  const versoes = await versoesDoTexto(db, entrada.organizationId);
  for (let i = 0; i < entrada.linhas.length; i += 1) {
    const l = entrada.linhas[i]!;
    const email = normalizarEmail(l.email);
    const recusar = (motivo: string) => r.recusadas.push({ linha: i + 1, email, motivo });
    if (!emailComForma(email)) {
      recusar("não parece um endereço de e-mail");
      continue;
    }
    if (!(l.data ?? "").trim()) {
      recusar("sem data do aceite");
      continue;
    }
    if (!(l.origem ?? "").trim()) {
      recusar("sem origem do aceite");
      continue;
    }
    const quando = Date.parse(String(l.data));
    if (!Number.isFinite(quando) || quando > Date.now() + 5 * 60_000) {
      recusar("data do aceite inválida ou no futuro");
      continue;
    }
    const v = versoes.find((x) => x.versao === (l.versao ?? VERSAO_PADRAO_DO_CONSENTIMENTO));
    if (!v) {
      recusar(`versão do texto desconhecida: ${l.versao}`);
      continue;
    }
    const { data: contatos, error } = await db
      .from("contacts")
      .select("id, email, consent, is_anonymized")
      .eq("organization_id", entrada.organizationId)
      .eq("email_normalized", email)
      .eq("is_anonymized", false)
      .limit(5);
    if (error) throw new Error(`contato da linha ${i + 1}: ${error.message}`);
    const lista = (contatos ?? []) as ContatoDoRegistro[];
    if (lista.length === 0) {
      r.sem_contato += 1;
      recusar("nenhum contato com este e-mail");
      continue;
    }
    const hash = hashDoEmail(email);
    if (await supressaoDoEmail(db, entrada.organizationId, hash)) {
      r.ja_descadastrados += 1;
      continue;
    }
    const iso = new Date(quando).toISOString();
    for (const c of lista) {
      const atual = lerConsentimentoDeEmail(c.consent);
      if (
        consentimentoVigente(c.consent) &&
        atual?.granted_at &&
        Date.parse(atual.granted_at) === quando
      ) {
        r.ja_estavam += 1;
        continue;
      }
      const consent = consentComAceite(c.consent, {
        quando: iso,
        origem: String(l.origem).trim().slice(0, 200),
        versao: v.versao,
        evidencia: (l.evidencia ?? "").trim().slice(0, 500) || null,
        medicao: v.incluiAvisoDeMedicao,
        registradoPor: entrada.registradoPor,
        porta: entrada.porta,
      });
      const { error: e1 } = await db
        .from("contacts")
        .update({ consent })
        .eq("organization_id", entrada.organizationId)
        .eq("id", c.id);
      if (e1) throw new Error(`consentimento da linha ${i + 1}: ${e1.message}`);
      await db.from("mia_email_consentimentos").insert({
        organization_id: entrada.organizationId,
        contact_id: c.id,
        email_hash: hash,
        tipo: "aceite",
        ocorrido_em: iso,
        origem: String(l.origem).trim().slice(0, 200),
        versao_do_texto: v.versao,
        texto_aceito: comEmpresa(v.texto, entrada.empresaNome),
        aceitou_medicao: v.incluiAvisoDeMedicao,
        evidencia: (l.evidencia ?? "").trim().slice(0, 500) || null,
        registrado_por: entrada.registradoPor,
        registrado_pelo: entrada.porta,
      });
      r.gravadas += 1;
    }
  }
  if (r.gravadas > 0) {
    void audit({
      action: "email_marketing.consentimentos_importados",
      actorUserId: entrada.registradoPor,
      organizationId: entrada.organizationId,
      resourceType: "contact",
      requestId: entrada.requestId ?? null,
      metadata: {
        lidas: r.lidas,
        gravadas: r.gravadas,
        recusadas: r.recusadas.length,
        porta: entrada.porta,
      },
    });
  }
  return r;
}

export interface FichaDoConsentimento {
  email: string | null;
  vigente: boolean;
  consentimento: ReturnType<typeof lerConsentimentoDeEmail>;
  supressao: Awaited<ReturnType<typeof supressaoDoEmail>>;
  recusouMarketingNoWhatsapp: boolean;
  registros: Array<{
    tipo: "aceite" | "recusa";
    ocorrido_em: string;
    origem: string | null;
    versao_do_texto: string | null;
    texto_aceito: string | null;
    evidencia: string | null;
    registrado_pelo: PortaDoRegistro;
    registrado_por: string | null;
  }>;
  versoes: VersaoDoTexto[];
}

/** O que a ficha do contato mostra sobre o e-mail marketing. */
export async function fichaDoConsentimento(
  db: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<FichaDoConsentimento> {
  const c = await lerContato(db, orgId, contactId);
  const email = c.email ? normalizarEmail(c.email) : null;
  const [supressao, registros, versoes] = await Promise.all([
    email && emailComForma(email)
      ? supressaoDoEmail(db, orgId, hashDoEmail(email))
      : Promise.resolve(null),
    db
      .from("mia_email_consentimentos")
      .select(
        "tipo, ocorrido_em, origem, versao_do_texto, texto_aceito, evidencia, registrado_pelo, registrado_por",
      )
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .order("ocorrido_em", { ascending: false })
      .limit(50),
    versoesDoTexto(db, orgId),
  ]);
  if (registros.error) throw new Error(`registros de consentimento: ${registros.error.message}`);
  return {
    email,
    vigente: consentimentoVigente(c.consent),
    consentimento: lerConsentimentoDeEmail(c.consent),
    supressao,
    recusouMarketingNoWhatsapp: recusouMarketing(c.consent),
    registros: (registros.data ?? []) as FichaDoConsentimento["registros"],
    versoes,
  };
}

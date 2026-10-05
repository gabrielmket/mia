/**
 * FORK MIA — UM lead da Meta gravado pela MESMA via da fonte de webhook.
 *
 * A rota pública `app/api/v1/webhooks/in/[token]` (do upstream) é o serviço de
 * captação: ela não tem uma função reutilizável por baixo. Em vez de reescrevê-la
 * (conflito a cada sincronização), este arquivo compõe as MESMAS peças, na mesma
 * ordem, e é por elas que o lead da Meta chega aos mesmos lugares:
 *
 *   mapInboundPayload            → nome, telefone (E.164), e-mail e o resto
 *   encontrarContatoPorTelefone… → o contato que já existe (grafias do celular)
 *   insert em contacts (23505)   → o contato novo, ou o vencedor da corrida
 *   createLeadHandler            → o negócio; emite `lead.created` (automações,
 *                                  follow-up "Lead criado", atividade, auditoria)
 *   registrarCaptacao            → `webhook_lead_captures`: a tela de captações,
 *                                  a LGPD (gatilho por contact_id) e o que a IA lê
 *                                  do formulário (`dados-do-formulario.ts`)
 *   audit webhook.lead_received  → a mesma linha de auditoria de toda captação
 *
 * Duas diferenças, declaradas (docs/fork/leads-da-meta.md):
 *
 *   1. Contato nasce também quando só veio e-mail. Na rota do webhook o negócio
 *      nasceria sem contato; aqui ele perderia a origem do anúncio e a LGPD não o
 *      alcançaria pela pessoa.
 *   2. Quem já tem negócio ABERTO não ganha outro: a captação fica como
 *      `duplicado` apontando para o negócio aberto, e ele recebe uma anotação. É a
 *      regra de nascimento do lead ("um por demanda", `nascimento-do-lead.ts`).
 *
 * Erro inesperado (banco fora, rede) LANÇA: quem chama para o formulário e não
 * avança a marca de leitura, e a próxima rodada tenta de novo — a deduplicação
 * pelo id do lead faz a repetição ser segura. Recusa conhecida (sem nome,
 * telefone nem e-mail; etapa que sumiu) é registrada e não volta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { encontrarContatoPorTelefoneComNome } from "@/lib/channels/contato-por-telefone";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { registrarCaptacao, type CaptacaoParaRegistrar } from "@/lib/webhooks/captacao";
import { mapInboundPayload } from "@/lib/webhooks/inbound";

import type { EscolhaDosCampos } from "./campos-do-formulario";
import {
  atribuicaoDoLead,
  chaveDoLead,
  comRotulos,
  emailAceito,
  externalIdDoLead,
  nomeDaFonte,
  payloadParaMapear,
  prepararParaMapear,
  type LeadDaMeta,
} from "./mapear";

/** O valor de `crm_leads.source` e de `contacts.source`: o mesmo do lead que nasce de clique em anúncio. */
export const ORIGEM_DO_LEAD = "meta_ads";
/** A etiqueta do card, a mesma que `nascimento-do-lead.ts` põe em quem veio de anúncio da Meta. */
export const ETIQUETA_DO_CARD = "Meta_ads";
/**
 * FORK MIA (.61) — a SEGUNDA etiqueta, só de quem PREENCHEU o formulário.
 *
 * `Meta_ads` sozinha não separa as duas portas da Meta: o clique para o
 * WhatsApp (`nascimento-do-lead.ts`) também a recebe, e ali a pessoa já chegou
 * falando. Quem preencheu o formulário não mandou mensagem nenhuma, e é com ele
 * que a IA precisa puxar a conversa: a régua de follow-up filtra por esta
 * etiqueta no card (`crm_leads.tags`, o `tag` do nó de condição) para abordar
 * só quem veio do formulário. Por isso ela mora aqui e em nenhum outro lugar.
 */
export const ETIQUETA_DO_FORMULARIO = "Formulario_Meta";

export interface FormularioParaGravar {
  /** Id da linha em `mia_leads_da_meta_formularios`. */
  id: string;
  organizationId: string;
  formId: string;
  formName: string | null;
  pageId: string;
  pageName: string | null;
  pipelineId: string;
  stageId: string;
  perguntas: Record<string, string>;
  /**
   * FORK MIA (.62): qual pergunta é o telefone, o nome e o e-mail, quando o
   * administrador escolheu (`campo_telefone`/`campo_nome`/`campo_email`).
   * Ausente ou nulo: automático (`campos-do-formulario.ts`).
   */
  campos?: EscolhaDosCampos;
}

/**
 * Por qual caminho o lead chegou: a leitura a cada 5 minutos ou o aviso em
 * tempo real da Meta (.62). Só o primeiro grava; o outro o acha já importado.
 */
export type ViaDoLead = "consulta" | "tempo_real";

export type DesfechoDoLead = "criado" | "repetido" | "recusado" | "ja_importado";

export interface ResultadoDoLead {
  desfecho: DesfechoDoLead;
  leadId: string | null;
  contactId: string | null;
  /** Por que foi recusado, quando foi. */
  motivo?: string;
}

interface ContatoAchado {
  id: string;
  nasceuAqui: boolean;
}

async function registrarRecebido(
  admin: SupabaseClient,
  formulario: FormularioParaGravar,
  lead: LeadDaMeta,
  desfecho: Exclude<DesfechoDoLead, "ja_importado">,
  crmLeadId: string | null,
  via: ViaDoLead,
): Promise<void> {
  const { error } = await admin.from("mia_leads_da_meta_recebidos").upsert(
    {
      organization_id: formulario.organizationId,
      chave_do_lead: chaveDoLead(lead.leadgenId),
      formulario_id: formulario.id,
      form_id: lead.formId ?? formulario.formId,
      page_id: formulario.pageId,
      ad_id: lead.adId,
      adset_id: lead.adsetId,
      campaign_id: lead.campaignId,
      criado_na_meta: lead.criadoEm?.toISOString() ?? null,
      desfecho,
      crm_lead_id: crmLeadId,
      via,
    },
    { onConflict: "organization_id,chave_do_lead", ignoreDuplicates: true },
  );
  // Sem esta linha o lead seria lido de novo na sobreposição. O negócio já existe
  // (e o `external_id` o protege); a captação `duplicado`/`recusado` é que
  // repetiria. Falha aqui vira exceção para a marca de leitura não avançar.
  if (error) throw new Error(`registro do lead recebido falhou: ${error.message}`);
}

/** Já processado antes? Pela tabela de recebidos e, de reserva, pelo `external_id` do negócio. */
async function jaImportado(
  admin: SupabaseClient,
  formulario: FormularioParaGravar,
  lead: LeadDaMeta,
): Promise<{
  sim: boolean;
  crmLeadId: string | null;
  contactId: string | null;
  soNoNegocio: boolean;
}> {
  const { data: recebido, error } = await admin
    .from("mia_leads_da_meta_recebidos")
    .select("id")
    .eq("organization_id", formulario.organizationId)
    .eq("chave_do_lead", chaveDoLead(lead.leadgenId))
    .maybeSingle();
  if (error) throw new Error(`consulta de recebidos falhou: ${error.message}`);
  if (recebido) return { sim: true, crmLeadId: null, contactId: null, soNoNegocio: false };

  const { data: negocio, error: erroNegocio } = await admin
    .from("crm_leads")
    .select("id, contact_id")
    .eq("organization_id", formulario.organizationId)
    .eq("source", ORIGEM_DO_LEAD)
    .eq("external_id", externalIdDoLead(lead.leadgenId))
    .maybeSingle();
  if (erroNegocio) throw new Error(`consulta do negócio falhou: ${erroNegocio.message}`);
  if (negocio) {
    return {
      sim: true,
      crmLeadId: negocio.id as string,
      contactId: (negocio.contact_id as string | null) ?? null,
      soNoNegocio: true,
    };
  }
  return { sim: false, crmLeadId: null, contactId: null, soNoNegocio: false };
}

/**
 * O contato: pelo telefone (todas as grafias do celular), senão pelo e-mail, senão
 * nasce. A corrida (23505 nos índices únicos de telefone ou e-mail) é resolvida
 * como na rota do webhook: o vencedor por telefone, depois por e-mail.
 */
async function resolverContato(
  admin: SupabaseClient,
  organizationId: string,
  dados: { nome: string | null; telefone: string | null; email: string | null },
  atribuicao: Record<string, unknown>,
): Promise<ContatoAchado | null> {
  const porTelefone = async () =>
    dados.telefone
      ? encontrarContatoPorTelefoneComNome(admin, organizationId, dados.telefone)
      : null;
  const porEmail = async () => {
    if (!dados.email) return null;
    const { data } = await admin
      .from("contacts")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("email_normalized", dados.email.trim().toLowerCase())
      .is("is_merged_into", null)
      .maybeSingle();
    return (data as { id: string } | null) ?? null;
  };

  const existente = (await porTelefone()) ?? (dados.telefone ? null : await porEmail());
  if (existente) return { id: existente.id, nasceuAqui: false };
  if (!dados.telefone && !dados.email) return null;

  const { data: criado, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      name: dados.nome ?? dados.telefone ?? dados.email,
      phone_number: dados.telefone,
      email: dados.email,
      source: ORIGEM_DO_LEAD,
      source_metadata: atribuicao,
    })
    .select("id")
    .maybeSingle();
  if (!error && criado) return { id: criado.id as string, nasceuAqui: true };
  if (error?.code === "23505") {
    const vencedor = (await porTelefone()) ?? (await porEmail());
    if (vencedor) return { id: vencedor.id, nasceuAqui: false };
  }
  throw new Error(
    `contato não pôde ser criado: ${error?.code ?? "?"} ${error?.message ?? ""}`.trim(),
  );
}

/**
 * FORK MIA (.62) — este lead já passou por aqui, por qualquer dos dois caminhos?
 * Só a tabela de recebidos, sem a reserva do negócio: é a pergunta barata que o
 * aviso em tempo real faz ANTES de gastar uma chamada na Meta. A conferência
 * completa continua em `gravarLeadDaMeta`.
 */
export async function leadJaRecebido(
  admin: SupabaseClient,
  organizationId: string,
  leadgenId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("mia_leads_da_meta_recebidos")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("chave_do_lead", chaveDoLead(leadgenId))
    .maybeSingle();
  if (error) throw new Error(`consulta de recebidos falhou: ${error.message}`);
  return Boolean(data);
}

/**
 * Grava um lead. Devolve o desfecho; lança só no inesperado (ver o cabeçalho).
 */
export async function gravarLeadDaMeta(
  admin: SupabaseClient,
  formulario: FormularioParaGravar,
  lead: LeadDaMeta,
  opcoes: { requestId: string; via?: ViaDoLead },
): Promise<ResultadoDoLead> {
  const org = formulario.organizationId;
  const via: ViaDoLead = opcoes.via ?? "consulta";

  // ── 1. já passou por aqui? ────────────────────────────────────────────────
  const anterior = await jaImportado(admin, formulario, lead);
  if (anterior.sim) {
    // Negócio existe e a linha de recebido não (a rodada anterior caiu entre os
    // dois passos): completa o registro para a próxima leitura nem consultar.
    if (anterior.soNoNegocio) {
      await registrarRecebido(admin, formulario, lead, "criado", anterior.crmLeadId, via);
    }
    return { desfecho: "ja_importado", leadId: anterior.crmLeadId, contactId: anterior.contactId };
  }

  // ── 2. o formulário como a fonte de webhook o entende ─────────────────────
  // FORK MIA (.62): as chaves do telefone, do nome e do e-mail vão na frente
  // das que o mapeador conhece, e a do telefone só entra se a resposta vira
  // telefone. É o que faz o celular perguntado numa pergunta própria
  // (`celular:_(ddd_+_número)`) chegar ao contato.
  const preparado = prepararParaMapear(lead, formulario.perguntas, formulario.campos ?? {});
  const mapeado = mapInboundPayload(preparado.payload, preparado.mapa);
  const atribuicao = atribuicaoDoLead(lead, formulario);
  const campos = comRotulos(mapeado.custom_fields, formulario.perguntas);
  const fonte: Pick<
    CaptacaoParaRegistrar,
    "organizationId" | "webhookSourceId" | "sourceName" | "requestId"
  > = {
    organizationId: org,
    // Não há linha em `webhook_sources`: a fonte é o formulário da Meta, e o nome
    // dele é o que a tela de captações e a IA mostram.
    webhookSourceId: null,
    sourceName: nomeDaFonte(formulario.formName, formulario.formId),
    requestId: opcoes.requestId,
  };
  const dadosDaCaptacao = {
    capturedName: mapeado.name,
    capturedPhone: mapeado.phone,
    capturedEmail: mapeado.email,
    fields: campos,
    utm: mapeado.source_metadata,
  };

  if (!mapeado.name && !mapeado.phone && !mapeado.email) {
    await registrarCaptacao(admin, {
      ...fonte,
      // Os campos como chegaram, com as chaves da Meta: quem depura precisa ver
      // exatamente o que o formulário pergunta.
      fields: payloadParaMapear(lead),
      outcome: "recusado",
      rejectReason: "sem_campo_mapeavel",
    });
    await registrarRecebido(admin, formulario, lead, "recusado", null, via);
    return { desfecho: "recusado", leadId: null, contactId: null, motivo: "sem_campo_mapeavel" };
  }

  // ── 3. o contato ──────────────────────────────────────────────────────────
  const email = emailAceito(mapeado.email);
  const contato = await resolverContato(
    admin,
    org,
    { nome: mapeado.name, telefone: mapeado.phone, email },
    atribuicao,
  );

  if (contato && !contato.nasceuAqui) {
    // Primeiro toque: só grava a origem se o contato ainda não tem nenhuma. A
    // função é do upstream e já faz essa guarda no `where`.
    const { error } = await admin.rpc(
      "fn_estampar_atribuicao_de_anuncio" as never,
      {
        p_org: org,
        p_contact: contato.id,
        p_platform: ORIGEM_DO_LEAD,
        p_metadata: atribuicao,
      } as never,
    );
    if (error) {
      logger.warn("[leads-da-meta] origem do anúncio não gravada no contato", {
        organization_id: org,
        detalhe: error.message.slice(0, 200),
      });
    }

    // ── 4. a mesma pessoa, com demanda aberta: não nasce outro card ─────────
    const { data: aberto, error: erroAberto } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", org)
      .eq("contact_id", contato.id)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (erroAberto) throw new Error(`consulta de negócio aberto falhou: ${erroAberto.message}`);
    if (aberto) {
      const leadId = aberto.id as string;
      await registrarCaptacao(admin, {
        ...fonte,
        ...dadosDaCaptacao,
        leadId,
        contactId: contato.id,
        outcome: "duplicado",
      });
      await emitLeadActivity(admin, {
        organizationId: org,
        leadId,
        contactId: contato.id,
        type: "note",
        sourceModule: "leads_da_meta",
        sourceId: formulario.id,
        actor: { type: "webhook_source", id: formulario.id },
        // Sem dado pessoal: a frase aparece na timeline e no export da LGPD.
        reason: `Preencheu de novo o formulário "${formulario.formName ?? formulario.formId}" da Meta. As respostas estão nas captações.`,
        payload: {
          meta_form_id: formulario.formId,
          campaign_id: lead.campaignId,
          ad_id: lead.adId,
        },
      });
      await registrarRecebido(admin, formulario, lead, "repetido", leadId, via);
      return { desfecho: "repetido", leadId, contactId: contato.id };
    }
  }

  // ── 5. o negócio ──────────────────────────────────────────────────────────
  const tituloBruto = mapeado.name ?? mapeado.phone ?? mapeado.email ?? "";
  const titulo = tituloBruto.length >= 2 ? tituloBruto.slice(0, 200) : "Lead da Meta";
  let negocio: Record<string, unknown>;
  try {
    negocio = await createLeadHandler(
      admin,
      {
        organization_id: org,
        actor: { type: "webhook_source", id: formulario.id },
        requestId: opcoes.requestId,
      },
      {
        pipeline_id: formulario.pipelineId,
        stage_id: formulario.stageId,
        title: titulo,
        contact_id: contato?.id,
        // As duas: `Meta_ads` mantém o card igual ao de todo lead da Meta (o
        // ponto do Kanban, os filtros que já existem); `Formulario_Meta` diz
        // por qual porta ele entrou.
        tags: [ETIQUETA_DO_CARD, ETIQUETA_DO_FORMULARIO],
        source: ORIGEM_DO_LEAD,
        custom_fields: campos,
        source_metadata: { ...atribuicao, ...mapeado.source_metadata },
        external_id: externalIdDoLead(lead.leadgenId),
      },
      // O lead do formulário da Meta é captação, como o webhook de entrada do
      // upstream: entra na etapa configurada mesmo que ela exija um campo que o
      // formulário não mandou (a isenção é a mesma da rota de captação, #2295).
      { exigirCamposDaEtapa: false },
    );
  } catch (erro) {
    if (!(erro instanceof ApiError)) throw erro;
    // Corrida entre duas leituras: o índice único do `external_id` derrubou a
    // segunda. O vencedor já gravou tudo.
    if (erro.message?.includes("uniq_crm_leads_org_source_external")) {
      const vencedor = await jaImportado(admin, formulario, lead);
      if (vencedor.crmLeadId)
        await registrarRecebido(admin, formulario, lead, "criado", vencedor.crmLeadId, via);
      return {
        desfecho: "ja_importado",
        leadId: vencedor.crmLeadId,
        contactId: vencedor.contactId,
      };
    }
    // Recusa do próprio CRM (etapa que sumiu, funil de outra organização): não
    // adianta tentar de novo. Fica registrada, como na rota do webhook.
    await registrarCaptacao(admin, {
      ...fonte,
      ...dadosDaCaptacao,
      contactId: contato?.id ?? null,
      outcome: "recusado",
      rejectReason: "erro_ao_criar_lead",
    });
    await registrarRecebido(admin, formulario, lead, "recusado", null, via);
    return {
      desfecho: "recusado",
      leadId: null,
      contactId: contato?.id ?? null,
      motivo: "erro_ao_criar_lead",
    };
  }

  const leadId = String(negocio.id);

  await audit({
    action: "webhook.lead_received",
    organizationId: org,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId: opcoes.requestId,
    metadata: {
      origem: "leads_da_meta",
      formulario_id: formulario.id,
      meta_form_id: formulario.formId,
    },
  });

  await registrarCaptacao(admin, {
    ...fonte,
    ...dadosDaCaptacao,
    leadId,
    contactId: contato?.id ?? null,
    outcome: "criado",
  });
  await registrarRecebido(admin, formulario, lead, "criado", leadId, via);

  return { desfecho: "criado", leadId, contactId: contato?.id ?? null };
}

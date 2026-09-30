/**
 * FORK MIA (.62) — O AVISO EM TEMPO REAL DA META: o lead entra em segundos.
 *
 * A rota `app/api/v1/webhooks/leads-da-meta` confere a assinatura (HMAC com o
 * App Secret da instalação) e entrega aqui cada aviso `leadgen`. O aviso traz
 * só ids (`leadgen_id`, `page_id`, `form_id`), nunca as respostas; o lead em si
 * é buscado na Meta e gravado pela MESMA `gravarLeadDaMeta` da rodada de 5 em 5
 * minutos: mesma deduplicação pelo id do lead, mesmas etiquetas `Meta_ads` e
 * `Formulario_Meta`, mesma escolha do telefone.
 *
 * ─── De quem é o aviso ─────────────────────────────────────────────────────
 *
 * O corpo diz a Página, e o corpo só é lido DEPOIS de a assinatura provar que
 * quem falou foi a Meta. Mesmo assim o tenant nunca vem dele: quem traduz
 * Página → empresa é `mia_paginas_da_meta` (migration 9004). Página sem dono é
 * ignorada. E o formulário tem de estar LIGADO na empresa dona, naquela Página:
 * a Meta avisa todo formulário da Página, inclusive os que a empresa não
 * escolheu importar.
 *
 * ─── Nada aqui é a última chance ───────────────────────────────────────────
 *
 * A rodada continua lendo tudo a cada 5 minutos. Aviso que se perde (servidor
 * fora, token recusado, Meta que não entregou) é lido por ela, e o que o aviso
 * já gravou ela acha pela chave do lead e não grava de novo. Por isso toda
 * recusa aqui é um desfecho, e não um erro que peça reentrega.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { kickLocalPipeline } from "@/lib/dev/kick-local-pipeline";
import { logger } from "@/lib/logger";
import { CAMPO_DO_AVISO_DE_LEAD, lerLead } from "@/lib/plataformas-de-anuncio/meta/leads";

import { COLUNAS_DO_FORMULARIO, paraGravar, type LinhaDoFormulario } from "./formulario";
import { gravarLeadDaMeta, leadJaRecebido, type DesfechoDoLead } from "./gravar";
import { leadsDaMetaLiberados } from "./liberacao";
import { lerLeadCru } from "./mapear";
import { acessoAsPaginas } from "./paginas";

/** Um aviso `leadgen`, já conferido na forma. */
export interface AvisoDeLead {
  leadgenId: string;
  pageId: string;
  /** Pode faltar no aviso; aí vale o `form_id` do próprio lead. */
  formId: string | null;
}

export type DesfechoDoAviso =
  | DesfechoDoLead
  /** A Página não foi atribuída a empresa nenhuma (9004). */
  | "pagina_sem_dono"
  /** A empresa dona não ligou a importação, ou o módulo não está liberado. */
  | "importacao_desligada"
  /** O formulário não está ligado na empresa dona, naquela Página. */
  | "formulario_nao_ligado"
  /** O formulário está ligado sem funil ou etapa de destino. */
  | "sem_funil"
  /** Nenhum token da empresa alcança a Página agora. */
  | "sem_acesso"
  /** A Meta recusou devolver o lead. */
  | "leitura_recusada"
  /** O lead não é do formulário que o aviso disse. */
  | "lead_de_outro_formulario";

/** Id da Meta: só dígitos, como a 9004 exige das Páginas. */
const ID_DA_META = /^\d{1,30}$/;

function idDaMeta(valor: unknown): string | null {
  const texto =
    typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor.trim() : "";
  return ID_DA_META.test(texto) ? texto : null;
}

/**
 * Os avisos `leadgen` de um corpo de webhook da Página. Pura. O que não tem a
 * forma certa fica de fora (a Meta manda outros campos pelo mesmo webhook, e
 * um aviso sem id de lead não tem o que buscar).
 */
export function avisosDoCorpo(corpo: unknown): AvisoDeLead[] {
  if (!corpo || typeof corpo !== "object") return [];
  const envelope = corpo as { object?: unknown; entry?: unknown };
  if (envelope.object !== undefined && envelope.object !== "page") return [];
  const entradas = Array.isArray(envelope.entry) ? envelope.entry : [];
  const avisos: AvisoDeLead[] = [];
  for (const entrada of entradas) {
    if (!entrada || typeof entrada !== "object") continue;
    const { id, changes } = entrada as { id?: unknown; changes?: unknown };
    for (const mudanca of Array.isArray(changes) ? changes : []) {
      if (!mudanca || typeof mudanca !== "object") continue;
      const { field, value } = mudanca as { field?: unknown; value?: unknown };
      if (field !== CAMPO_DO_AVISO_DE_LEAD || !value || typeof value !== "object") continue;
      const v = value as { leadgen_id?: unknown; page_id?: unknown; form_id?: unknown };
      const leadgenId = idDaMeta(v.leadgen_id);
      const pageId = idDaMeta(v.page_id) ?? idDaMeta(id);
      if (!leadgenId || !pageId) continue;
      avisos.push({ leadgenId, pageId, formId: idDaMeta(v.form_id) });
    }
  }
  return avisos;
}

async function formularioLigado(
  admin: SupabaseClient,
  organizationId: string,
  pageId: string,
  formId: string,
): Promise<LinhaDoFormulario | null> {
  const { data, error } = await admin
    .from("mia_leads_da_meta_formularios")
    .select(COLUNAS_DO_FORMULARIO)
    .eq("organization_id", organizationId)
    .eq("form_id", formId)
    .eq("page_id", pageId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(`leitura do formulário falhou: ${error.message}`);
  return (data as unknown as LinhaDoFormulario | null) ?? null;
}

/**
 * Um aviso → o lead gravado (ou o motivo de não gravar). Lança só no
 * inesperado (banco fora); quem chama registra e segue, e a rodada relê.
 */
export async function receberAvisoDeLead(
  admin: SupabaseClient,
  aviso: AvisoDeLead,
  opcoes: { requestId: string; agora?: Date },
): Promise<DesfechoDoAviso> {
  const agora = opcoes.agora ?? new Date();

  // ── 1. de quem é a Página (9004), nunca pelo corpo ────────────────────────
  const { data: dono, error: erroDono } = await admin
    .from("mia_paginas_da_meta")
    .select("organization_id, page_name")
    .eq("page_id", aviso.pageId)
    .maybeSingle();
  if (erroDono) throw new Error(`leitura do dono da Página falhou: ${erroDono.message}`);
  if (!dono) return "pagina_sem_dono";
  const org = (dono as { organization_id: string }).organization_id;
  const pageName = (dono as { page_name: string | null }).page_name ?? null;

  // ── 2. a empresa importa? ─────────────────────────────────────────────────
  const { data: config } = await admin
    .from("mia_leads_da_meta_config")
    .select("ativo")
    .eq("organization_id", org)
    .maybeSingle();
  if (!(config as { ativo?: boolean } | null)?.ativo) return "importacao_desligada";
  if (!(await leadsDaMetaLiberados(admin, org))) return "importacao_desligada";

  // ── 3. o formulário ligado, quando o aviso o diz ──────────────────────────
  let formulario = aviso.formId
    ? await formularioLigado(admin, org, aviso.pageId, aviso.formId)
    : null;
  if (aviso.formId && !formulario) return "formulario_nao_ligado";

  // Já veio pela leitura: nenhuma chamada à Meta.
  if (await leadJaRecebido(admin, org, aviso.leadgenId)) return "ja_importado";

  // ── 4. o lead, na Meta, com o token da Página desta empresa ───────────────
  const acesso = await acessoAsPaginas(admin, org, [
    { page_id: aviso.pageId, page_name: pageName },
  ]);
  const pagina = acesso.ok ? acesso.paginas.get(aviso.pageId) : undefined;
  if (!pagina?.tokenDaPagina) return "sem_acesso";

  const lido = await lerLead(pagina.tokenDaPagina, aviso.leadgenId);
  if (!lido.ok) {
    logger.warn("[leads-da-meta] aviso em tempo real: a Meta recusou o lead", {
      organization_id: org,
      falha: lido.falha,
    });
    return "leitura_recusada";
  }
  const lead = lerLeadCru(lido.dados);
  if (!lead) return "leitura_recusada";

  // Sem `form_id` no aviso, vale o do lead; com os dois, têm de bater.
  if (!formulario) {
    if (!lead.formId) return "formulario_nao_ligado";
    formulario = await formularioLigado(admin, org, aviso.pageId, lead.formId);
    if (!formulario) return "formulario_nao_ligado";
  }
  if (lead.formId && lead.formId !== formulario.form_id) return "lead_de_outro_formulario";
  if (!formulario.pipeline_id || !formulario.stage_id) return "sem_funil";

  // ── 5. a MESMA gravação da rodada ─────────────────────────────────────────
  const r = await gravarLeadDaMeta(
    admin,
    paraGravar({
      ...formulario,
      pipeline_id: formulario.pipeline_id,
      stage_id: formulario.stage_id,
    }),
    lead,
    { requestId: opcoes.requestId, via: "tempo_real" },
  );

  // O que a tela mostra: o tempo real FUNCIONA (e não só "foi assinado").
  const { error: erroForm } = await admin
    .from("mia_leads_da_meta_formularios")
    .update({
      ultimo_aviso_da_meta_em: agora.toISOString(),
      ...(r.desfecho === "criado"
        ? { importados_total: (formulario.importados_total ?? 0) + 1 }
        : {}),
    })
    .eq("id", formulario.id)
    .eq("organization_id", org);
  if (erroForm) {
    logger.warn("[leads-da-meta] aviso em tempo real: formulário não atualizado", {
      formulario_id: formulario.id,
      detalhe: erroForm.message.slice(0, 200),
    });
  }

  // Os `lead.created` saem da fila agora, como na rodada e na rota do webhook.
  if (r.desfecho === "criado") await kickLocalPipeline(admin);
  return r.desfecho;
}

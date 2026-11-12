/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ, a parte que AGE (docs/fork/trava-de-robo.md).
 *
 * Dois desfechos, e nenhum chama o modelo nem manda nada ao contato:
 *
 * ## O laço com outro robô (`aplicarTravaDeRobo`)
 *
 *   1. a IA fica calada para o CONTATO de forma durável: `contacts.force_human`,
 *      a mesma trava do handoff. Ela vale em todo número e em conversa nova,
 *      sobrevive ao encerramento (que zera o silêncio da conversa) e é lida pelos
 *      três guardas do motor (`isLeadInHandoff`, o worker nativo e o
 *      `before-send`). "Devolver ao automático" (`lib/escalacao/retomada.ts`) a
 *      solta, como solta a de qualquer handoff. É o PRIMEIRO passo, e o único que
 *      derruba o turno se falhar: sem ele, a próxima mensagem do robô reabriria
 *      o laço;
 *   2. a etiqueta "robô" no contato (com o `contact.tag_added`, como a tela);
 *   3. os follow-ups agendados (`cron_jobs`) e as réguas vivas
 *      (`followup_enrollments`) do contato são cancelados, com o motivo;
 *   4. cada negócio ABERTO do contato vira PERDIDO pelo `encerraDemanda` (a mesma
 *      regra do botão), com o motivo de sistema "Robô ou atendimento
 *      automático" garantido na lista do funil, e a nota na linha do tempo. Sem
 *      negócio aberto, nenhum é criado;
 *   5. a nota do sistema na conversa;
 *   6. a conversa é encerrada pela MESMA função que o botão Encerrar usa
 *      (`fn_service_status`, pela rota `conversations/[id]/close`);
 *   7. o registro em `mia_travas_de_robo` (migration 9154) e a auditoria.
 *
 * Do 2 em diante cada passo é independente: falha vira código em `falhas` (no
 * registro e no log) e o resto segue.
 *
 * ## O teto de respostas (`aplicarTetoDeRespostas`)
 *
 * A IA pausa SÓ naquela conversa, pelo mesmo silêncio do "Pausar o automático"
 * e do handoff (`bot_silenced_until = 'infinity'`, com `last_handoff_at`, o que
 * faz o silêncio sobreviver a um encerramento), e a conversa vai para a fila da
 * equipe (`pending`). Sem perder negócio, sem
 * encerrar, sem tocar no contato. Fica o aviso na Central (`kind = 'handoff'`
 * na conversa, que a varredura de avisos fecha quando a conversa sai da fila),
 * a nota, a linha do tempo e o registro.
 *
 * ⚠️ A regra do upstream que a .107 manteve ("calada em todos, mas avisando"):
 * `isLeadInHandoff` conta o silêncio de QUALQUER conversa do contato, então,
 * enquanto a pausa do teto vale, o motor também não responde esse contato nos
 * outros números da empresa. A faixa da .107 avisa isso na tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { normalizarTags } from "@/lib/contacts/tag-normalizada";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { encerraDemanda } from "@/lib/leads/encerramento";

import { minutosDaDuracao, type AvaliacaoDaTrava } from "./deteccao";
import { ETIQUETA_DE_ROBO } from "./etiqueta";
import {
  AUTOR_DA_NOTA,
  CATEGORIA_DO_MOTIVO_DA_TRAVA,
  LINHA_DO_TEMPO_DO_ROBO,
  LINHA_DO_TEMPO_DO_TETO,
  MOTIVO_DE_PERDA_DA_TRAVA,
  MOTIVO_DO_CANCELAMENTO_DO_FOLLOWUP,
  MOTIVO_DO_SILENCIO_DO_TETO,
  PERDA_NA_LINHA_DO_TEMPO,
  frase,
} from "./textos";

/** O produto agiu, não uma pessoa: a linha do tempo grava como sistema. */
export const ATOR_DA_TRAVA = { type: "webhook_source", id: "trava-de-robo" } as const satisfies Actor;

export const TABELA_DOS_REGISTROS = "mia_travas_de_robo";

/** Estados de uma régua que ainda pode mandar mensagem. */
const REGUA_VIVA = ["active", "waiting_reply", "dormente", "paused_handoff", "paused_manual", "coletando"];

/** No teto, a conversa nestes estados não vai para a fila: já encerrou, ou alguém já a tem. */
const STATUS_QUE_FICAM: ReadonlySet<string> = new Set(["closed", "resolved", "archived", "claimed", "pending"]);

/** Teto de motivos de perda por funil (o mesmo do PATCH do funil, `.max(50)`). */
const TETO_DE_MOTIVOS_DO_FUNIL = 50;

/** Quantos negócios abertos um contato pode ter aqui antes de a trava parar de contar. */
const TETO_DE_NEGOCIOS = 20;

export interface LoggerDaTrava {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface DepsDaAplicacao {
  admin: SupabaseClient;
  agora: () => Date;
  requestId: string;
  log?: LoggerDaTrava;
}

export interface AlvoDaAplicacao {
  organizationId: string;
  conversationId: string;
  contactId: string;
  jobId: string | null;
  idioma: Idioma;
}

export interface DesfechoDaAplicacao {
  registroId: string | null;
  negocios: string[];
  conversaEncerrada: boolean;
  etiquetaAplicada: boolean;
  followupsCancelados: number;
  falhas: string[];
}

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message.slice(0, 200);
  if (erro && typeof erro === "object" && "message" in erro) return String((erro as { message: unknown }).message).slice(0, 200);
  return String(erro).slice(0, 200);
}

function codigoDoErro(erro: unknown): string {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && codigo !== "" ? codigo : "erro";
}

function chaveDoRotulo(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

function rotuloDoItem(item: unknown): string | null {
  if (typeof item === "string") return item;
  const label = (item as { label?: unknown } | null)?.label;
  return typeof label === "string" ? label : null;
}

/**
 * O motivo de perda da trava NO FUNIL do negócio. Segue o padrão de motivo de
 * funil (`crm_pipelines.settings.lost_reasons`, o que o gatilho
 * `fn_validate_lost_reason_required` aceita além dos canônicos): sem redefinir o
 * gatilho do upstream, o motivo novo só pode morar ali. Já existe (em português
 * ou no idioma da empresa)? Usa o rótulo gravado, byte a byte, porque o gatilho
 * compara por igualdade. Não existe? Acrescenta `{ label, categoria: "Ausência" }`
 * com trava otimista em `updated_at`, para não apagar um ajuste simultâneo da
 * tela. Funil sem vaga (50 motivos) ou escrita perdida duas vezes: "other".
 */
export async function garantirMotivoDaTravaNoFunil(
  admin: SupabaseClient,
  alvo: { organizationId: string; pipelineId: string; idioma: Idioma },
): Promise<{ motivo: string; acrescentado: boolean }> {
  const rotulos = [MOTIVO_DE_PERDA_DA_TRAVA, traduzir(MOTIVO_DE_PERDA_DA_TRAVA, alvo.idioma)].map(chaveDoRotulo);
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const { data, error } = await admin
      .from("crm_pipelines")
      .select("id, settings, updated_at")
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.pipelineId)
      .maybeSingle();
    if (error || !data) return { motivo: "other", acrescentado: false };
    const funil = data as { settings: Record<string, unknown> | null; updated_at: string | null };
    const settings = funil.settings && typeof funil.settings === "object" ? funil.settings : {};
    const lista = Array.isArray(settings.lost_reasons) ? (settings.lost_reasons as unknown[]) : [];
    const existente = lista.map(rotuloDoItem).find((r): r is string => r !== null && rotulos.includes(chaveDoRotulo(r)));
    if (existente) return { motivo: existente, acrescentado: false };
    if (lista.length >= TETO_DE_MOTIVOS_DO_FUNIL) return { motivo: "other", acrescentado: false };

    const rotulo = traduzir(MOTIVO_DE_PERDA_DA_TRAVA, alvo.idioma);
    let escrita = admin
      .from("crm_pipelines")
      .update({ settings: { ...settings, lost_reasons: [...lista, { label: rotulo, categoria: CATEGORIA_DO_MOTIVO_DA_TRAVA }] } })
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.pipelineId);
    if (funil.updated_at) escrita = escrita.eq("updated_at", funil.updated_at);
    const { data: gravado, error: erroDaEscrita } = await escrita.select("id");
    if (!erroDaEscrita && Array.isArray(gravado) && gravado.length > 0) return { motivo: rotulo, acrescentado: true };
  }
  return { motivo: "other", acrescentado: false };
}

/** A etiqueta "robô" no contato, e o evento que as automações escutam. Devolve se pôs agora. */
async function etiquetarComoRobo(
  deps: DepsDaAplicacao,
  alvo: AlvoDaAplicacao,
  tagsAtuais: unknown,
  falhas: string[],
): Promise<boolean> {
  const atuais = normalizarTags(Array.isArray(tagsAtuais) ? (tagsAtuais as string[]) : []);
  if (atuais.includes(ETIQUETA_DE_ROBO)) return false;
  if (atuais.length >= 20) {
    falhas.push("etiqueta_sem_vaga");
    return false;
  }
  const proximas = [...atuais, ETIQUETA_DE_ROBO];
  const { error } = await deps.admin
    .from("contacts")
    .update({ tags: proximas })
    .eq("organization_id", alvo.organizationId)
    .eq("id", alvo.contactId);
  if (error) {
    falhas.push(`etiqueta:${codigoDoErro(error)}`);
    return false;
  }
  const { error: erroDoEvento } = await deps.admin.rpc("emit_event", {
    p_event_type: "contact.tag_added",
    p_entity_kind: "contact",
    p_entity_id: alvo.contactId,
    p_payload: { added_tags: [ETIQUETA_DE_ROBO], tags: proximas, service_origin: null },
    p_metadata: { request_id: deps.requestId, actor_type: ATOR_DA_TRAVA.type, actor_id: ATOR_DA_TRAVA.id, via: "trava_de_robo" },
    p_organization_id: alvo.organizationId,
  });
  if (erroDoEvento) falhas.push("evento_da_etiqueta");
  return true;
}

/** Desmarca os follow-ups agendados e as réguas vivas do contato. Devolve quantos. */
async function cancelarFollowups(deps: DepsDaAplicacao, alvo: AlvoDaAplicacao, falhas: string[]): Promise<number> {
  const agora = deps.agora().toISOString();
  let total = 0;
  const { data: crons, error: erroDosCrons } = await deps.admin
    .from("cron_jobs")
    .update({ enabled: false, cancelled_at: agora, cancel_reason: MOTIVO_DO_CANCELAMENTO_DO_FOLLOWUP, updated_at: agora })
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .eq("enabled", true)
    .select("id");
  if (erroDosCrons) falhas.push(`followups:${codigoDoErro(erroDosCrons)}`);
  else total += (crons ?? []).length;

  const { data: reguas, error: erroDasReguas } = await deps.admin
    .from("followup_enrollments")
    .update({
      status: "cancelled",
      cancel_reason: MOTIVO_DO_CANCELAMENTO_DO_FOLLOWUP,
      completed_at: agora,
      next_eval_at: null,
      claimed_until: null,
      updated_at: agora,
    })
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .in("status", REGUA_VIVA)
    .select("id, current_node_id");
  if (erroDasReguas) {
    falhas.push(`reguas:${codigoDoErro(erroDasReguas)}`);
    return total;
  }
  const canceladas = (reguas ?? []) as Array<{ id: string; current_node_id: string | null }>;
  total += canceladas.length;
  if (canceladas.length > 0) {
    const { error: erroDosEventos } = await deps.admin.from("followup_enrollment_events").insert(
      canceladas.map((r) => ({
        organization_id: alvo.organizationId,
        enrollment_id: r.id,
        node_id: r.current_node_id,
        event_type: "trava_de_robo_cancelou",
        payload: { motivo: "robo", conversation_id: alvo.conversationId },
        idempotency_key: `trava_de_robo:${alvo.conversationId}:${agora}`,
      })),
    );
    if (erroDosEventos) falhas.push("eventos_das_reguas");
  }
  return total;
}

async function notaNaConversa(deps: DepsDaAplicacao, alvo: AlvoDaAplicacao, corpo: string, falhas: string[]): Promise<void> {
  const { error } = await deps.admin.from("conversation_notes").insert({
    organization_id: alvo.organizationId,
    conversation_id: alvo.conversationId,
    body: corpo,
    created_by_user_id: null,
    created_by_name: traduzir(AUTOR_DA_NOTA, alvo.idioma),
  });
  if (error) falhas.push(`nota:${codigoDoErro(error)}`);
}

async function registrar(
  deps: DepsDaAplicacao,
  alvo: AlvoDaAplicacao,
  linha: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await deps.admin
    .from("mia_travas_de_robo")
    .insert({
      organization_id: alvo.organizationId,
      contact_id: alvo.contactId,
      conversation_id: alvo.conversationId,
      job_id: alvo.jobId,
      ...linha,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    deps.log?.error("trava de robô: o registro não foi gravado", {
      conversation_id: alvo.conversationId,
      error: mensagemDoErro(error),
    });
    return null;
  }
  return ((data as { id?: string } | null)?.id ?? null) as string | null;
}

/** O laço com outro robô: cala, etiqueta, cancela, perde, anota, encerra e registra. */
export async function aplicarTravaDeRobo(
  deps: DepsDaAplicacao,
  alvo: AlvoDaAplicacao,
  avaliacao: AvaliacaoDaTrava,
): Promise<DesfechoDaAplicacao> {
  const falhas: string[] = [];
  const { admin } = deps;

  // 1 · a IA calada para o contato: sem isto o resto não vale, e o turno é refeito.
  const { data: contato, error: erroDaTrava } = await admin
    .from("contacts")
    .update({ force_human: true })
    .eq("organization_id", alvo.organizationId)
    .eq("id", alvo.contactId)
    .select("id, tags")
    .maybeSingle();
  if (erroDaTrava) throw new Error(`trava de robô: a IA não foi calada para o contato (${mensagemDoErro(erroDaTrava)})`);

  // 2 · a etiqueta
  const etiquetaAplicada = await etiquetarComoRobo(deps, alvo, (contato as { tags?: unknown } | null)?.tags, falhas);

  // 3 · os follow-ups e as réguas
  const followupsCancelados = await cancelarFollowups(deps, alvo, falhas);

  // 4 · os negócios abertos viram perdidos
  const minutos = minutosDaDuracao(avaliacao.duracao_segundos);
  const negocios: string[] = [];
  const { data: abertos, error: erroDosNegocios } = await admin
    .from("crm_leads")
    .select("id, pipeline_id")
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .eq("status", "open")
    .limit(TETO_DE_NEGOCIOS);
  if (erroDosNegocios) falhas.push(`negocios:${codigoDoErro(erroDosNegocios)}`);
  for (const lead of (abertos ?? []) as Array<{ id: string; pipeline_id: string }>) {
    try {
      const { motivo } = await garantirMotivoDaTravaNoFunil(admin, {
        organizationId: alvo.organizationId,
        pipelineId: lead.pipeline_id,
        idioma: alvo.idioma,
      });
      await encerraDemanda(
        admin,
        { organization_id: alvo.organizationId, actor: ATOR_DA_TRAVA, requestId: deps.requestId, idioma: alvo.idioma },
        {
          leadId: lead.id,
          desfecho: "lost",
          motivo,
          razaoNaTimeline: PERDA_NA_LINHA_DO_TEMPO,
          payloadNaTimeline: { conversation_id: alvo.conversationId, trava_de_robo: true },
        },
      );
      negocios.push(lead.id);
      const atividade = await emitLeadActivity(admin, {
        organizationId: alvo.organizationId,
        leadId: lead.id,
        contactId: alvo.contactId,
        type: "conversation_ai_paused",
        sourceModule: "trava-de-robo",
        sourceId: alvo.conversationId,
        actor: ATOR_DA_TRAVA,
        reason: LINHA_DO_TEMPO_DO_ROBO,
        payload: { conversation_id: alvo.conversationId, motivo: "robo", mensagens: avaliacao.mensagens_de_robo, minutos },
      });
      if (!atividade.ok) falhas.push("linha_do_tempo");
    } catch (erro) {
      falhas.push(`negocio_nao_perdido:${codigoDoErro(erro)}`);
      deps.log?.warn("trava de robô: negócio não marcado como perdido", {
        lead_id: lead.id,
        error: mensagemDoErro(erro),
      });
    }
  }

  // 5 · a nota na conversa
  const valores = { mensagens: avaliacao.mensagens_de_robo, minutos };
  await notaNaConversa(
    deps,
    alvo,
    frase(negocios.length > 0 ? "nota_do_robo_com_negocio" : "nota_do_robo_sem_negocio", alvo.idioma, valores),
    falhas,
  );

  // 6 · a conversa encerrada pela função do botão Encerrar
  let conversaEncerrada = false;
  const { error: erroDoEncerramento } = await admin.rpc("fn_service_status", {
    p_org: alvo.organizationId,
    p_conversation: alvo.conversationId,
    p_status: "closed",
    p_expected: null,
  });
  if (erroDoEncerramento) falhas.push(`conversa_nao_encerrada:${codigoDoErro(erroDoEncerramento)}`);
  else {
    conversaEncerrada = true;
    await audit({
      action: "conversation.closed",
      actorUserId: null,
      organizationId: alvo.organizationId,
      resourceType: "conversation",
      resourceId: alvo.conversationId,
      requestId: deps.requestId,
      metadata: { via: "trava_de_robo" },
    });
  }

  // 7 · o registro e a auditoria
  const registroId = await registrar(deps, alvo, {
    motivo: "robo",
    sinais: avaliacao.sinais,
    mensagens_de_robo: avaliacao.mensagens_de_robo,
    respostas_da_ia: avaliacao.respostas_da_ia,
    duracao_segundos: avaliacao.duracao_segundos,
    negocios_afetados: negocios,
    conversa_encerrada: conversaEncerrada,
    etiqueta_aplicada: etiquetaAplicada,
    followups_cancelados: followupsCancelados,
    falhas,
  });
  await audit({
    action: "ai.trava_de_robo_disparada",
    actorUserId: null,
    organizationId: alvo.organizationId,
    resourceType: "conversation",
    resourceId: alvo.conversationId,
    requestId: deps.requestId,
    metadata: {
      motivo: "robo",
      registro_id: registroId,
      mensagens_de_robo: avaliacao.mensagens_de_robo,
      respostas_da_ia: avaliacao.respostas_da_ia,
      negocios_afetados: negocios.length,
      falhas,
    },
  });

  return { registroId, negocios, conversaEncerrada, etiquetaAplicada, followupsCancelados, falhas };
}

/** O teto: pausa SÓ a conversa, avisa a equipe, anota e registra. */
export async function aplicarTetoDeRespostas(
  deps: DepsDaAplicacao,
  alvo: AlvoDaAplicacao,
  avaliacao: AvaliacaoDaTrava,
  conversa: { status: string | null },
): Promise<DesfechoDaAplicacao> {
  const falhas: string[] = [];
  const { admin } = deps;
  const agora = deps.agora().toISOString();

  // 1 · a pausa da conversa (a mesma do handoff e do "Pausar o automático"). Sem ela, o turno é refeito.
  const { error: erroDaPausa } = await admin
    .from("conversations")
    .update({
      bot_silenced_until: "infinity",
      last_handoff_at: agora,
      last_handoff_reason: MOTIVO_DO_SILENCIO_DO_TETO,
      // A conversa vai para a fila da equipe (`pending`), que é o que mantém o aviso da
      // Central aberto (a varredura de avisos o fecha quando a conversa sai da fila).
      // Encerrada ou com alguém fica como está: o status é ciclo de vida, não quem manda.
      ...(STATUS_QUE_FICAM.has(conversa.status ?? "") ? {} : { status: "pending" }),
    })
    .eq("organization_id", alvo.organizationId)
    .eq("id", alvo.conversationId);
  if (erroDaPausa) throw new Error(`teto de respostas: a conversa não foi pausada (${mensagemDoErro(erroDaPausa)})`);

  const minutos = minutosDaDuracao(avaliacao.duracao_segundos);
  const valores = { respostas: avaliacao.respostas_no_teto, minutos };

  // 2 · o aviso na Central (um por conversa enquanto estiver aberto)
  const { data: aberto, error: erroDoAberto } = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", alvo.organizationId)
    .eq("kind", "handoff")
    .eq("ref_kind", "conversation")
    .eq("ref_id", alvo.conversationId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (erroDoAberto) falhas.push(`aviso:${codigoDoErro(erroDoAberto)}`);
  else if (!aberto) {
    const { error: erroDoAviso } = await admin.from("agent_inbox_items").insert({
      organization_id: alvo.organizationId,
      kind: "handoff",
      severity: "warn",
      title: frase("titulo_do_aviso_do_teto", alvo.idioma),
      body: frase("corpo_do_aviso_do_teto", alvo.idioma, valores),
      ref_kind: "conversation",
      ref_id: alvo.conversationId,
    });
    if (erroDoAviso) falhas.push(`aviso:${codigoDoErro(erroDoAviso)}`);
  }

  // 3 · a nota na conversa
  await notaNaConversa(deps, alvo, frase("nota_do_teto", alvo.idioma, valores), falhas);

  // 4 · a linha do tempo dos negócios abertos (nenhum muda de etapa)
  const { data: abertos } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .eq("status", "open")
    .limit(TETO_DE_NEGOCIOS);
  for (const lead of (abertos ?? []) as Array<{ id: string }>) {
    const atividade = await emitLeadActivity(admin, {
      organizationId: alvo.organizationId,
      leadId: lead.id,
      contactId: alvo.contactId,
      type: "conversation_ai_paused",
      sourceModule: "trava-de-robo",
      sourceId: alvo.conversationId,
      actor: ATOR_DA_TRAVA,
      reason: LINHA_DO_TEMPO_DO_TETO,
      payload: { conversation_id: alvo.conversationId, motivo: "teto", respostas: avaliacao.respostas_no_teto, minutos },
    });
    if (!atividade.ok) falhas.push("linha_do_tempo");
  }

  // 5 · o registro e a auditoria
  const registroId = await registrar(deps, alvo, {
    motivo: "teto",
    sinais: avaliacao.sinais,
    mensagens_de_robo: avaliacao.mensagens_de_robo,
    respostas_da_ia: avaliacao.respostas_no_teto,
    duracao_segundos: avaliacao.duracao_segundos,
    negocios_afetados: [],
    conversa_encerrada: false,
    etiqueta_aplicada: false,
    followups_cancelados: 0,
    falhas,
  });
  await audit({
    action: "ai.trava_de_robo_teto",
    actorUserId: null,
    organizationId: alvo.organizationId,
    resourceType: "conversation",
    resourceId: alvo.conversationId,
    requestId: deps.requestId,
    metadata: { motivo: "teto", registro_id: registroId, respostas_da_ia: avaliacao.respostas_no_teto, falhas },
  });

  return { registroId, negocios: [], conversaEncerrada: false, etiquetaAplicada: false, followupsCancelados: 0, falhas };
}

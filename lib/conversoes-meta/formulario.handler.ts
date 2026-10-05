/**
 * FORK MIA — a volta dos LEADS DE FORMULÁRIO da Meta para a Meta: os eventos de
 * etapa e a venda do negócio que nasceu de um formulário (anúncio de cadastro),
 * pela API de conversões para CRM (docs/fork/conversoes-da-meta.md).
 *
 * ── O que é do upstream e o que sobrou aqui ─────────────────────────────────
 *
 * A régua por etapa da Meta é do upstream desde a 1.70 (migration 0524,
 * `meta_ads_conversion_rules`): `lib/conversoes/etapa-meta.handler.ts` envia o
 * evento da etapa e `lib/conversoes/envio.handler.ts` envia a venda, para quem
 * tem ATRIBUIÇÃO de anúncio (`lerAtribuicao`: o clique em anúncio para o
 * WhatsApp, ou a página com UTM da Meta, #2076). Até a .71 a MIA tinha a
 * própria régua (9017) e o próprio consumidor; na .72 a dele virou a principal,
 * e o nosso consumidor saiu do registro.
 *
 * O que o upstream não tem é o lead de FORMULÁRIO: o contato dele não traz
 * clique nem UTM (a origem é `meta_ads` sem `ad_source_id`), então os dois
 * consumidores dele param em `sem_atribuicao` sem gravar nada. Este consumidor
 * cobre exatamente esse buraco, e só ele:
 *
 *   · lê a MESMA régua (`lerRegraMetaDaEtapa`) e escreve no MESMO livro-razão
 *     (`registraEnvio`), com a MESMA chave (`MetaEtapa:<uuid>` e `Purchase`) e o
 *     MESMO `event_id` (`<leadId>:<evento>`);
 *   · só age quando `lerAtribuicao` diz que NÃO há atribuição. Com atribuição, o
 *     negócio é dos consumidores do upstream e este sai de cena.
 *
 * É essa exclusão que garante a regra da casa: um negócio que muda de etapa
 * gera no máximo UM envio daquele evento para a Meta. Provado em
 * `tests/invariants/conversoes-da-meta-por-etapa.test.ts`.
 *
 * ── As travas, em ordem ─────────────────────────────────────────────────────
 *
 *  1. o que já foi enviado não sai de novo (`sent` nunca é rebaixado);
 *  2. o retrato gravado (quando aconteceu, qual evento) vence a regra de agora;
 *  3. a etapa precisa ser desta organização e estar aberta;
 *  4. movimento anterior à regra não envia (`configured_at`, a trava do upstream);
 *  5. só lead de formulário, sem atribuição de anúncio, com contato não anonimizado;
 *  6. a chave "leads de formulário voltam para a Meta" (`mia_conversoes_meta_config`)
 *     precisa estar ligada, e o que aconteceu antes de ligar não vai.
 *
 * Decisão de NÃO enviar (sem regra, chave desligada, anterior à regra ou à
 * chave) não vira linha no livro-razão: não há pendência, havia nada a
 * informar. O veredito fica no `event_log`, pelo `detail` do resultado — o mesmo
 * critério do upstream para o lead orgânico.
 *
 * ── A empresa de demonstração ───────────────────────────────────────────────
 *
 * Não tem conexão ligada (o banco recusa, migration 9010): este consumidor para
 * em `sem_conexao`/`conexao_desabilitada`, antes da rede.
 */
import { z } from "zod";

import { branding } from "@/lib/branding";
import { lerAtribuicao } from "@/lib/conversoes/leitura-da-atribuicao";
import { lerRegistro, registraEnvio } from "@/lib/conversoes/registro-de-envio";
import { ehEventoDeEtapaMeta, lerRegraMetaDaEtapa } from "@/lib/conversoes/regras-meta";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import {
  ehIdDeLeadDaMeta,
  enviarEventoDoFunil,
  type IdentidadeNaMeta,
} from "@/lib/plataformas-de-anuncio/meta/eventos-do-funil";
import type { NomeDoEvento, ResultadoDeEnvio } from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerChaveDeFormulario } from "./config";
import { aconteceuAntes } from "./instante";

export const CHAVE_DO_CONSUMIDOR_DE_FORMULARIO = "conversoes.meta_formulario";
const KEY = CHAVE_DO_CONSUMIDOR_DE_FORMULARIO;

/** Backoff do transitório. O dreno reagenda sem contar tentativa. */
const ESPERA_PADRAO_MS = 5 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: KEY,
  status,
  detail,
});
const ignorar = (detail: string) => resultado("skipped", detail);

interface Negocio {
  id: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  closed_at: string | null;
  contact_id: string | null;
  source_metadata: Record<string, unknown> | null;
}

/** ⚠️ Filtro de organização junto do id: o cliente é service-role e atravessa a RLS. */
async function lerNegocio(admin: Admin, organizationId: string, leadId: string): Promise<Negocio | null> {
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, status, value_cents, currency, closed_at, contact_id, source_metadata")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler o negócio.");
  return (data as Negocio | null) ?? null;
}

interface Formulario {
  identidade: IdentidadeNaMeta;
  telefone: string | null;
  email: string | null;
  /** Desde quando a chave está ligada. */
  desde: string | null;
}

type Origem = { tem: true; formulario: Formulario } | { tem: false; motivo: string };

/**
 * O negócio é um lead de FORMULÁRIO que só este consumidor informa?
 *
 * A primeira pergunta é a do upstream, pela mesma função: se o contato tem
 * atribuição de anúncio, o negócio é dos consumidores dele, e daqui não sai
 * nada. Só depois vem o id do lead do formulário (no próprio negócio, migration
 * 9003), o contato (anonimizado não volta para a Meta pelo id de um formulário
 * antigo) e a chave da empresa.
 */
async function origemDoFormulario(admin: Admin, organizationId: string, negocio: Negocio): Promise<Origem> {
  const atribuicao = await lerAtribuicao(admin, organizationId, negocio.contact_id);
  if (atribuicao.temAtribuicao) return { tem: false, motivo: "atribuicao_do_upstream" };

  const id = negocio.source_metadata?.meta_lead_id;
  if (!ehIdDeLeadDaMeta(id)) return { tem: false, motivo: "sem_formulario" };

  let telefone: string | null = null;
  let email: string | null = null;
  if (negocio.contact_id) {
    const { data, error } = await admin
      .from("contacts")
      .select("phone_number, email, is_anonymized")
      .eq("id", negocio.contact_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler o contato do negócio.");
    const contato = data as {
      phone_number: string | null;
      email: string | null;
      is_anonymized: boolean | null;
    } | null;
    if (contato?.is_anonymized === true) return { tem: false, motivo: "contato_anonimizado" };
    // Só dígitos ANTES do hash: normalizar depois seria tarde.
    telefone = contato?.phone_number ? contato.phone_number.replace(/\D/g, "") || null : null;
    email = contato?.email?.trim() || null;
  }

  const chave = await lerChaveDeFormulario(admin, organizationId);
  if (!chave.ligada) return { tem: false, motivo: "formulario_desligado" };

  return {
    tem: true,
    formulario: {
      identidade: { tipo: "lead_de_formulario", idDoLead: id.trim() },
      telefone,
      email,
      desde: chave.desde,
    },
  };
}

interface Envio {
  admin: Admin;
  organizationId: string;
  leadId: string;
  /** A chave no livro-razão: `MetaEtapa:<uuid>` ou `Purchase`. */
  evento: NomeDoEvento;
  /** O `event_name` que viaja: o evento padrão da regra, ou `Purchase`. */
  nomeTecnico: string;
  formulario: Formulario;
  ocorridoEm: string;
  valorCentavos: number | null;
  moeda: string;
  /** Os eventos de etapa guardam o retrato (quando e qual evento); a venda relê o negócio. */
  etapa: boolean;
}

/** Lê a credencial, envia e grava o desfecho. O mesmo caminho para etapa e para venda. */
async function enviar(e: Envio): Promise<HandlerResult> {
  const registra = (status: "sent" | "skipped" | "error", motivo: string | null, detalhe?: string) =>
    registraEnvio(e.admin, {
      organizationId: e.organizationId,
      leadId: e.leadId,
      plataforma: "meta_ads",
      evento: e.evento,
      status,
      motivo,
      eventoId: `${e.leadId}:${e.evento}`,
      valorCentavos: e.valorCentavos,
      moeda: e.moeda,
      detalhe: detalhe ?? null,
      ...(e.etapa ? { ocorridoEm: e.ocorridoEm, metaEventName: e.nomeTecnico } : {}),
    });

  const credencial = await lerCredencial(e.admin, e.organizationId, "meta_ads");
  if (!credencial.ok) {
    if (credencial.motivo === "leitura_indisponivel") throw new Error("Leitura da conexão indisponível.");
    // Sem conexão, pausada ou incompleta: a linha fica (com o retrato, na etapa),
    // e a tela diz o que falta. Nada foi enviado.
    await registra("skipped", credencial.motivo);
    return ignorar(credencial.motivo);
  }

  const desfecho: ResultadoDeEnvio = await enviarEventoDoFunil(credencial.credencial, {
    leadId: e.leadId,
    nomeTecnico: e.nomeTecnico,
    eventoId: `${e.leadId}:${e.evento}`,
    ocorridoEm: new Date(e.ocorridoEm),
    identidade: e.formulario.identidade,
    telefone: e.formulario.telefone,
    email: e.formulario.email,
    valorCentavos: e.valorCentavos,
    moeda: e.moeda,
    nomeDoCrm: branding().name,
  });

  if (desfecho.tipo === "ok") {
    if (credencial.credencial.testEventCode) {
      // O código de teste marca também estes eventos: a Meta recebeu, e não
      // conta. Fica como não enviado, para sair de verdade depois.
      await registra(
        "skipped",
        "evento_de_teste",
        "Evento recebido em modo de teste. Desative o teste antes de informar o evento real.",
      );
      return ignorar("evento_de_teste");
    }
    await registra("sent", null, desfecho.detalhe);
    return resultado("ok", "evento do lead de formulário informado à plataforma (meta_ads)");
  }

  if (desfecho.tipo === "transitorio" || desfecho.tipo === "processando") {
    await registra("skipped", "nova_tentativa_agendada", desfecho.detalhe);
    return {
      consumer_key: KEY,
      status: "retry",
      retry_at: new Date(
        Date.now() + ((desfecho.tipo === "transitorio" ? desfecho.tentarEmMs : undefined) ?? ESPERA_PADRAO_MS),
      ).toISOString(),
      detail: desfecho.detalhe,
    };
  }

  await registra("error", "recusado_pela_plataforma", desfecho.detalhe);
  return ignorar("recusado_pela_plataforma");
}

/**
 * O reenvio pedido de uma linha que ficou, cuja origem hoje não serve mais (a
 * chave foi desligada, o contato foi anonimizado). A linha deixa de dizer
 * "reprocessamento agendado" e passa a dizer por que não vai.
 */
async function reenvioSemOrigem(
  admin: Admin,
  org: string,
  leadId: string,
  evento: NomeDoEvento,
  registro: { value_cents: number | null; currency: string | null; event_occurred_at?: string | null; meta_event_name?: string | null },
  motivo: string,
): Promise<HandlerResult> {
  await registraEnvio(admin, {
    organizationId: org,
    leadId,
    plataforma: "meta_ads",
    evento,
    status: "skipped",
    motivo: "sem_atribuicao",
    eventoId: `${leadId}:${evento}`,
    valorCentavos: registro.value_cents,
    moeda: registro.currency,
    detalhe:
      motivo === "formulario_desligado"
        ? "A volta dos leads de formulário da Meta está desligada nesta empresa."
        : "O contato deste negócio não pode mais ser informado à Meta.",
  });
  return ignorar(motivo);
}

/** Um negócio entrou numa etapa: a regra da etapa (a do upstream) decide se a Meta fica sabendo. */
async function etapa(admin: Admin, row: EventRow, leadId: string): Promise<HandlerResult> {
  const etapaId = z.uuid().safeParse(row.payload.to_stage_id);
  if (!etapaId.success || !row.created_at || !Number.isFinite(Date.parse(row.created_at))) {
    return ignorar("sem_etapa_ou_data");
  }
  const org = row.organization_id;

  const regra = await lerRegraMetaDaEtapa(admin, org, etapaId.data);
  if (!regra || !regra.enabled) return ignorar("etapa_sem_regra_meta");
  if (!ehEventoDeEtapaMeta(regra.eventName)) return ignorar("regra_invalida");
  const evento = regra.eventName;

  const registro = await lerRegistro(admin, org, leadId, evento);
  if (registro?.status === "sent") return ignorar("ja_enviada");

  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");
  const origem = await origemDoFormulario(admin, org, negocio);
  if (!origem.tem) return ignorar(origem.motivo);
  const moeda = negocio.currency ?? "BRL";

  // O retrato do primeiro envio vence a regra de agora: o evento que aconteceu
  // é aquele, mesmo que a etapa tenha trocado de evento depois.
  if (registro?.event_occurred_at && registro.meta_event_name) {
    return enviar({
      admin,
      organizationId: org,
      leadId,
      evento,
      nomeTecnico: registro.meta_event_name,
      formulario: origem.formulario,
      ocorridoEm: registro.event_occurred_at,
      valorCentavos: null,
      moeda: registro.currency ?? moeda,
      etapa: true,
    });
  }

  const { data: aberta, error: erroEtapa } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", org)
    .eq("id", etapaId.data)
    .eq("is_won", false)
    .eq("is_lost", false)
    .maybeSingle();
  if (erroEtapa) throw erroEtapa;
  if (!aberta) return ignorar("etapa_invalida");

  // As duas travas de retroatividade: a da regra (a do upstream, com a precisão
  // de microssegundos que o banco guarda) e a da chave dos formulários.
  if (aconteceuAntes(row.created_at, regra.configuredAt)) return ignorar("anterior_a_configuracao");
  if (origem.formulario.desde && aconteceuAntes(row.created_at, origem.formulario.desde)) {
    return ignorar("anterior_a_chave");
  }

  // O retrato nasce ANTES do envio, como no upstream: se dois movimentos
  // concorrem, ou se o processo cai no meio, a linha já diz quando o evento
  // aconteceu e qual foi.
  await registraEnvio(admin, {
    organizationId: org,
    leadId,
    plataforma: "meta_ads",
    evento,
    status: "skipped",
    motivo: "nova_tentativa_agendada",
    eventoId: `${leadId}:${evento}`,
    valorCentavos: null,
    moeda,
    ocorridoEm: row.created_at,
    metaEventName: regra.metaEvent,
  });

  // E é o retrato GRAVADO que viaja: o primeiro vence também quando dois
  // movimentos concorrem (a Meta ainda deduplica pelo `event_id`).
  const salvo = await lerRegistro(admin, org, leadId, evento);
  if (salvo?.status === "sent") return ignorar("ja_enviada");
  if (!salvo?.event_occurred_at || !salvo.meta_event_name) throw new Error("Retrato do evento de etapa ausente.");

  return enviar({
    admin,
    organizationId: org,
    leadId,
    evento,
    nomeTecnico: salvo.meta_event_name,
    formulario: origem.formulario,
    ocorridoEm: salvo.event_occurred_at,
    valorCentavos: null,
    moeda: salvo.currency ?? moeda,
    etapa: true,
  });
}

/** O reenvio de um evento de etapa (`fn_solicitar_reenvio_conversao`, do upstream). */
async function reenvioDeEtapa(admin: Admin, row: EventRow, leadId: string, evento: NomeDoEvento): Promise<HandlerResult> {
  const org = row.organization_id;
  const registro = await lerRegistro(admin, org, leadId, evento);
  if (!registro || registro.status === "sent") return ignorar("ja_enviada");
  if (!registro.event_occurred_at || !registro.meta_event_name) return ignorar("sem_etapa_registrada");

  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");
  const origem = await origemDoFormulario(admin, org, negocio);
  if (!origem.tem) {
    // Com atribuição, quem reenvia é o consumidor do upstream; sem formulário,
    // a linha não é nossa.
    if (origem.motivo === "atribuicao_do_upstream" || origem.motivo === "sem_formulario") return ignorar(origem.motivo);
    return reenvioSemOrigem(admin, org, leadId, evento, registro, origem.motivo);
  }

  return enviar({
    admin,
    organizationId: org,
    leadId,
    evento,
    nomeTecnico: registro.meta_event_name,
    formulario: origem.formulario,
    ocorridoEm: registro.event_occurred_at,
    valorCentavos: null,
    moeda: registro.currency ?? negocio.currency ?? "BRL",
    etapa: true,
  });
}

/**
 * A venda do lead que veio de FORMULÁRIO da Meta.
 *
 * A venda de quem tem atribuição (clique ou página) é do consumidor de venda do
 * upstream; este sai de cena na hora (`origemDoFormulario`). E a linha `Purchase`
 * de outra plataforma, ou com protocolo pendente do transporte direto, também é
 * dele: uma venda, um caminho, uma linha no livro.
 */
async function vendaDeFormulario(admin: Admin, row: EventRow, leadId: string, reenvio: boolean): Promise<HandlerResult> {
  const org = row.organization_id;
  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");
  if (negocio.status !== "won") return ignorar("nao_e_ganho");

  const registro = await lerRegistro(admin, org, leadId, "Purchase");
  if (registro?.status === "sent") return ignorar("ja_enviada");
  if (registro && (registro.platform !== "meta_ads" || registro.remote_request_id)) {
    return ignorar("venda_do_consumidor_de_venda");
  }

  const origem = await origemDoFormulario(admin, org, negocio);
  if (!origem.tem) {
    if (reenvio && registro && origem.motivo !== "atribuicao_do_upstream" && origem.motivo !== "sem_formulario") {
      return reenvioSemOrigem(admin, org, leadId, "Purchase", registro, origem.motivo);
    }
    return ignorar(origem.motivo);
  }

  const ocorridoEm = negocio.closed_at ?? row.created_at ?? new Date().toISOString();
  const moeda = negocio.currency ?? "BRL";
  const valor = negocio.value_cents !== null && negocio.value_cents > 0 ? negocio.value_cents : null;

  if (origem.formulario.desde && aconteceuAntes(ocorridoEm, origem.formulario.desde)) {
    return ignorar("anterior_a_chave");
  }
  // A compra exige valor, como no upstream: mandar zero ensinaria à Meta que a
  // venda não vale nada. É pendência acionável: preencher o valor e reprocessar.
  if (valor === null) {
    await registraEnvio(admin, {
      organizationId: org,
      leadId,
      plataforma: "meta_ads",
      evento: "Purchase",
      status: "skipped",
      motivo: "sem_valor",
      eventoId: `${leadId}:Purchase`,
      valorCentavos: null,
      moeda,
    });
    return ignorar("sem_valor");
  }

  return enviar({
    admin,
    organizationId: org,
    leadId,
    evento: "Purchase",
    nomeTecnico: "Purchase",
    formulario: origem.formulario,
    ocorridoEm,
    valorCentavos: valor,
    moeda,
    etapa: false,
  });
}

async function processar(row: EventRow): Promise<HandlerResult> {
  if (!row.entity_id) return ignorar("sem_entidade");
  const admin = createAdminClient();
  const leadId = row.entity_id;

  if (row.event_type === "ad_conversion.retry_requested") {
    const nome = row.payload.event_name ?? "Purchase";
    if (ehEventoDeEtapaMeta(nome)) return reenvioDeEtapa(admin, row, leadId, nome);
    if (nome === "Purchase") return vendaDeFormulario(admin, row, leadId, true);
    return ignorar("outro_evento");
  }

  if (row.event_type === "lead.won") return vendaDeFormulario(admin, row, leadId, false);
  if (row.event_type !== "lead.stage_changed") return ignorar("outro_evento");

  // A mudança de etapa é as duas portas: a etapa aberta com regra (o evento de
  // etapa) e a etapa de ganho arrastada no quadro (a venda). As duas nunca são
  // a mesma etapa, então um resultado não esconde o outro.
  const daEtapa = await etapa(admin, row, leadId);
  if (daEtapa.status !== "skipped" || daEtapa.detail !== "etapa_sem_regra_meta") return daEtapa;
  const daVenda = await vendaDeFormulario(admin, row, leadId, false);
  return daVenda.detail === "nao_e_ganho" || daVenda.detail === "lead_inexistente" ? daEtapa : daVenda;
}

async function handle(row: EventRow): Promise<HandlerResult> {
  try {
    return await processar(row);
  } catch {
    return {
      consumer_key: KEY,
      status: "retry",
      retry_at: new Date(Date.now() + ESPERA_PADRAO_MS).toISOString(),
      detail: "Não foi possível processar o evento do lead de formulário da Meta. Nova tentativa agendada.",
    };
  }
}

export const conversaoDoLeadDeFormularioHandler: EventHandler = {
  key: KEY,
  // Sai para a Meta: na organização parada, não roda (lib/organizacao/operante.ts).
  naOrgParada: "pula",
  events: ["lead.stage_changed", "lead.won", "ad_conversion.retry_requested"],
  handle,
};

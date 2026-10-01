/**
 * FORK MIA — o consumidor das conversões da Meta por ETAPA do funil, e da venda
 * do lead que veio de formulário da Meta (migration 9017).
 *
 * ── Ao lado dos dois consumidores do upstream ───────────────────────────────
 *
 * `lib/conversoes/envio.handler.ts` (a venda de quem veio de clique em anúncio)
 * e `lib/conversoes/qualificacao.handler.ts` (as etapas do Google) são do
 * upstream e não mudam uma linha por causa deste arquivo. Este escuta os MESMOS
 * eventos, escreve no MESMO livro-razão (`registraEnvio`) e aplica as MESMAS
 * travas, com as regras da Meta (`mia_conversoes_meta_regras`).
 *
 * ── As travas, em ordem ─────────────────────────────────────────────────────
 *
 *  1. o que já foi enviado não sai de novo. A chave do livro é `Meta:<evento>`
 *     por negócio: sair e voltar à etapa não duplica, e o mesmo evento ligado em
 *     duas etapas só sai na primeira;
 *  2. a linha que guarda o RETRATO de um evento (passou nas travas e não chegou
 *     a ser aceita) é reenviada com a data e o valor do primeiro envio, nunca
 *     com a regra de agora;
 *  3. a etapa precisa ser desta organização e estar aberta (ganho é a compra);
 *  4. o canal de entrada do negócio precisa atender o filtro da regra;
 *  5. o negócio precisa ter vindo da Meta: clique em anúncio para o WhatsApp
 *     ou, com a chave ligada, formulário da Meta;
 *  6. movimento anterior à regra não envia (`configurada_em`), e evento anterior
 *     à chave dos formulários não envia para lead de formulário.
 *
 * ── O que vai para o livro-razão, e o que não vai ───────────────────────────
 *
 * Só o negócio que veio da Meta. Um negócio orgânico (ou do Google) que entra
 * numa etapa com regra não é uma conversão que deixou de ser informada: não
 * havia o que informar. Gravar uma linha para cada um encheria o histórico de
 * ruído. O veredito ainda fica no `event_log`, pelo `detail` do resultado.
 *
 * ── A chave de vendas do cartão da Meta ─────────────────────────────────────
 *
 * Igual ao Google de hoje: a conexão desligada pausa TUDO, compra e etapas
 * (`lerCredencial` responde `conexao_desabilitada`). O que os eventos de etapa
 * não exigem é nada que seja só da venda. A linha fica no livro com o retrato,
 * e o "Reenviar" a manda depois de a conexão voltar, se ainda couber nos 7 dias.
 *
 * ── A empresa de demonstração ───────────────────────────────────────────────
 *
 * Não tem conexão ligada (o banco recusa, migration 9010): a regra pode existir
 * e este consumidor para em `sem_conexao`/`conexao_desabilitada`, antes da rede.
 */
import { z } from "zod";

import { branding } from "@/lib/branding";
import { lerAtribuicao } from "@/lib/conversoes/leitura-da-atribuicao";
import { canalAtende, canalDoLead } from "@/lib/conversoes/regras-google";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import {
  ehIdDeLeadDaMeta,
  enviarEventoDoFunil,
  type IdentidadeNaMeta,
} from "@/lib/plataformas-de-anuncio/meta/eventos-do-funil";
import type { ResultadoDeEnvio } from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerChaveDeFormulario } from "./config";
import {
  chaveDoEventoNoLivro,
  COMPRA_NA_META,
  eventoDaMeta,
  eventoNoLivro,
  valorDoEvento,
  type ChaveDoEventoDaMeta,
} from "./eventos";
import { lerRegistroDaMeta, registrarNoLivro, temRetrato } from "./livro";
import { lerRegraDaEtapaDaMeta } from "./regras";

const KEY = "conversoes.meta_etapa";

/** O evento que `fn_mia_solicitar_reenvio_conversao_meta` emite (migration 9017). */
export const EVENTO_DE_REENVIO_DA_META = "conversao_meta.retry_requested";

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

/** O id do lead do formulário da Meta, guardado na origem do negócio (migration 9003). */
function idDoLeadDeFormulario(negocio: Negocio): string | null {
  const id = negocio.source_metadata?.meta_lead_id;
  return ehIdDeLeadDaMeta(id) ? id.trim() : null;
}

type Origem =
  | { tem: true; identidade: IdentidadeNaMeta; telefone: string | null; email: string | null }
  | { tem: false; motivo: "sem_origem_na_meta" };

/**
 * A origem pelo FORMULÁRIO: o id do lead guardado no próprio negócio, com o
 * telefone e o e-mail do contato para reforçar o casamento (com hash, no
 * transporte).
 *
 * Contato anonimizado não tem origem: quem pediu para ser esquecido não volta
 * para a Meta pelo id de um formulário antigo.
 */
async function origemDoFormulario(admin: Admin, organizationId: string, negocio: Negocio): Promise<Origem> {
  const idDoLead = idDoLeadDeFormulario(negocio);
  if (!idDoLead) return { tem: false, motivo: "sem_origem_na_meta" };

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
    if (contato?.is_anonymized === true) return { tem: false, motivo: "sem_origem_na_meta" };
    // Só dígitos ANTES do hash: normalizar depois seria tarde.
    telefone = contato?.phone_number ? contato.phone_number.replace(/\D/g, "") || null : null;
    email = contato?.email?.trim() || null;
  }
  return { tem: true, identidade: { tipo: "lead_de_formulario", idDoLead }, telefone, email };
}

/**
 * De onde este negócio veio, na Meta: o clique em anúncio para o WhatsApp (a
 * atribuição do contato, lida pela MESMA função do consumidor de venda) ou o
 * formulário (o id do lead no próprio negócio). O clique vence: é a identidade
 * que a porta de mensagens de negócio exige.
 */
async function origemNaMeta(admin: Admin, organizationId: string, negocio: Negocio): Promise<Origem> {
  const leitura = await lerAtribuicao(admin, organizationId, negocio.contact_id);
  if (leitura.temAtribuicao && leitura.atribuicao.plataforma === "meta_ads") {
    return {
      tem: true,
      identidade: { tipo: "clique_no_whatsapp", clique: leitura.atribuicao.cliqueDeOrigem },
      telefone: leitura.atribuicao.telefone,
      email: null,
    };
  }
  return origemDoFormulario(admin, organizationId, negocio);
}

interface Envio {
  admin: Admin;
  organizationId: string;
  leadId: string;
  /** A chave no livro-razão: `Meta:<evento>` ou `Purchase`. */
  eventoNoLivro: string;
  /** O `event_name` que viaja. */
  nomeTecnico: string;
  origem: Extract<Origem, { tem: true }>;
  ocorridoEm: string;
  valorCentavos: number | null;
  moeda: string;
  /** Os eventos de etapa guardam o retrato (quando aconteceu); a venda relê o negócio. */
  guardaRetrato: boolean;
}

/** Lê a credencial, envia e grava o desfecho. O mesmo caminho para etapa e para venda. */
async function enviar(e: Envio): Promise<HandlerResult> {
  const registra = (
    status: "sent" | "skipped" | "error",
    motivo: string | null,
    detalhe?: string,
  ) =>
    registrarNoLivro(e.admin, {
      organizationId: e.organizationId,
      leadId: e.leadId,
      evento: e.eventoNoLivro,
      status,
      motivo,
      detalhe,
      valorCentavos: e.valorCentavos,
      moeda: e.moeda,
      ...(e.guardaRetrato ? { ocorridoEm: e.ocorridoEm } : {}),
    });

  const credencial = await lerCredencial(e.admin, e.organizationId, "meta_ads");
  if (!credencial.ok) {
    if (credencial.motivo === "leitura_indisponivel") throw new Error("Leitura da conexão indisponível.");
    // Sem conexão, pausada ou incompleta: a linha fica com o retrato, e a tela
    // diz o que falta. Nada foi enviado.
    await registra("skipped", credencial.motivo);
    return ignorar(credencial.motivo);
  }

  const desfecho: ResultadoDeEnvio = await enviarEventoDoFunil(credencial.credencial, {
    leadId: e.leadId,
    nomeTecnico: e.nomeTecnico,
    eventoId: `${e.leadId}:${e.eventoNoLivro}`,
    ocorridoEm: new Date(e.ocorridoEm),
    identidade: e.origem.identidade,
    telefone: e.origem.telefone,
    email: e.origem.email,
    valorCentavos: e.valorCentavos,
    moeda: e.moeda,
    nomeDoCrm: branding().name,
  });

  if (desfecho.tipo === "ok") {
    if (credencial.credencial.testEventCode) {
      // O código de teste marca também os eventos de etapa: a Meta recebeu, e
      // não conta. Fica como não enviado, para sair de verdade depois.
      await registra(
        "skipped",
        "evento_de_teste",
        "Evento recebido em modo de teste. Desative o teste antes de informar o evento real.",
      );
      return ignorar("evento_de_teste");
    }
    await registra("sent", null, desfecho.detalhe);
    return resultado("ok", "evento informado à plataforma (meta_ads)");
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

/** Um negócio entrou numa etapa: a regra da etapa decide se a Meta fica sabendo. */
async function etapa(admin: Admin, row: EventRow, leadId: string): Promise<HandlerResult> {
  const etapaId = z.uuid().safeParse(row.payload.to_stage_id);
  if (!etapaId.success || !row.created_at || !Number.isFinite(Date.parse(row.created_at))) {
    return ignorar("sem_etapa_ou_data");
  }
  const org = row.organization_id;

  const regra = await lerRegraDaEtapaDaMeta(admin, org, etapaId.data);
  if (!regra || !regra.ligada) return ignorar("etapa_sem_regra");

  const noLivro = eventoNoLivro(regra.evento);
  const registro = await lerRegistroDaMeta(admin, org, leadId, noLivro);
  if (registro?.status === "sent") return ignorar("ja_enviada");
  // O retrato do primeiro envio vence a regra de agora (a etapa, o valor e a
  // data podem ter mudado desde então; o evento que aconteceu é aquele).
  if (temRetrato(registro)) return comRetrato(admin, org, leadId, noLivro, regra.evento, registro);

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

  if (regra.canal !== "todos") {
    const canal = await canalDoLead(admin, org, leadId);
    if (!canalAtende(regra.canal, canal)) return ignorar("canal_fora_da_regra");
  }

  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");

  const origem = await origemNaMeta(admin, org, negocio);
  if (!origem.tem) return ignorar(origem.motivo);

  const moeda = negocio.currency ?? "BRL";
  const valor = valorDoEvento(regra, negocio.value_cents);
  const decisao = (motivo: string) =>
    registrarNoLivro(admin, {
      organizationId: org,
      leadId,
      evento: noLivro,
      status: "skipped",
      motivo,
      valorCentavos: valor,
      moeda,
      ocorridoEm: row.created_at,
    });

  if (Date.parse(row.created_at) < Date.parse(regra.configuradaEm)) {
    await decisao("anterior_a_regra");
    return ignorar("anterior_a_regra");
  }

  if (origem.identidade.tipo === "lead_de_formulario") {
    const chave = await lerChaveDeFormulario(admin, org);
    if (!chave.ligada) {
      await decisao("formulario_desligado");
      return ignorar("formulario_desligado");
    }
    if (chave.desde && Date.parse(row.created_at) < Date.parse(chave.desde)) {
      await decisao("anterior_a_chave");
      return ignorar("anterior_a_chave");
    }
  }

  // O retrato nasce ANTES do envio: se dois movimentos concorrem, ou se o
  // processo cai no meio, a linha já diz quando o evento aconteceu e quanto valia.
  await registrarNoLivro(admin, {
    organizationId: org,
    leadId,
    evento: noLivro,
    status: "skipped",
    motivo: "nova_tentativa_agendada",
    valorCentavos: valor,
    moeda,
    ocorridoEm: row.created_at,
  });

  // E é o retrato GRAVADO que viaja: dois movimentos concorrentes do mesmo
  // negócio leem a mesma linha e mandam o mesmo evento (a Meta deduplica pelo id).
  const salvo = await lerRegistroDaMeta(admin, org, leadId, noLivro);
  if (salvo?.status === "sent") return ignorar("ja_enviada");
  if (!temRetrato(salvo)) throw new Error("Retrato do evento de etapa ausente.");

  return enviar({
    admin,
    organizationId: org,
    leadId,
    eventoNoLivro: noLivro,
    nomeTecnico: eventoDaMeta(regra.evento).nomeTecnico,
    origem,
    ocorridoEm: salvo.event_occurred_at,
    valorCentavos: salvo.value_cents,
    moeda: salvo.currency ?? moeda,
    guardaRetrato: true,
  });
}

/** Reenvia um evento de etapa com a data e o valor do primeiro envio. */
async function comRetrato(
  admin: Admin,
  org: string,
  leadId: string,
  noLivro: string,
  chave: ChaveDoEventoDaMeta,
  registro: { event_occurred_at: string; value_cents: number | null; currency: string | null },
): Promise<HandlerResult> {
  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");
  const moeda = registro.currency ?? negocio.currency ?? "BRL";

  const origem = await origemNaMeta(admin, org, negocio);
  const semOrigem = async (motivo: string) => {
    await registrarNoLivro(admin, {
      organizationId: org,
      leadId,
      evento: noLivro,
      status: "skipped",
      motivo,
      valorCentavos: registro.value_cents,
      moeda,
      ocorridoEm: registro.event_occurred_at,
    });
    return ignorar(motivo);
  };
  // A origem pode ter sumido desde o primeiro envio (contato anonimizado).
  if (!origem.tem) return semOrigem("sem_atribuicao");
  // E a chave pode ter sido desligada: a decisão de agora vale para o reenvio.
  if (origem.identidade.tipo === "lead_de_formulario" && !(await lerChaveDeFormulario(admin, org)).ligada) {
    return semOrigem("formulario_desligado");
  }

  return enviar({
    admin,
    organizationId: org,
    leadId,
    eventoNoLivro: noLivro,
    nomeTecnico: eventoDaMeta(chave).nomeTecnico,
    origem,
    ocorridoEm: registro.event_occurred_at,
    valorCentavos: registro.value_cents,
    moeda,
    guardaRetrato: true,
  });
}

/**
 * A venda do lead que veio de FORMULÁRIO da Meta.
 *
 * A venda de quem veio de clique em anúncio é do consumidor de venda do
 * upstream, e este sai de cena na hora em que o contato tem clique (qualquer
 * plataforma): uma venda, um caminho, uma linha `Purchase` no livro. O que
 * sobra para cá é o negócio SEM clique que nasceu de um formulário da Meta,
 * que até a 9017 fechava e a Meta nunca ficava sabendo.
 */
async function vendaDeFormulario(admin: Admin, row: EventRow, leadId: string): Promise<HandlerResult> {
  const org = row.organization_id;
  const negocio = await lerNegocio(admin, org, leadId);
  if (!negocio) return ignorar("lead_inexistente");
  if (negocio.status !== "won") return ignorar("nao_e_ganho");

  const registro = await lerRegistroDaMeta(admin, org, leadId, COMPRA_NA_META.nomeTecnico);
  if (registro?.status === "sent") return ignorar("ja_enviada");
  // Linha de outra plataforma, ou com protocolo pendente: é do consumidor de venda.
  if (registro && (registro.platform !== "meta_ads" || registro.remote_request_id)) {
    return ignorar("venda_do_consumidor_de_venda");
  }

  const atribuicao = await lerAtribuicao(admin, org, negocio.contact_id);
  if (atribuicao.temAtribuicao) return ignorar("venda_do_consumidor_de_venda");

  const origem = await origemDoFormulario(admin, org, negocio);
  if (!origem.tem) return ignorar(origem.motivo);

  const ocorridoEm = negocio.closed_at ?? row.created_at ?? new Date().toISOString();
  const moeda = negocio.currency ?? "BRL";
  const valor = negocio.value_cents !== null && negocio.value_cents > 0 ? negocio.value_cents : null;
  const decisao = async (motivo: string) => {
    await registrarNoLivro(admin, {
      organizationId: org,
      leadId,
      evento: COMPRA_NA_META.nomeTecnico,
      status: "skipped",
      motivo,
      valorCentavos: valor,
      moeda,
    });
    return ignorar(motivo);
  };

  const chave = await lerChaveDeFormulario(admin, org);
  if (!chave.ligada) return decisao("formulario_desligado");
  if (chave.desde && Date.parse(ocorridoEm) < Date.parse(chave.desde)) return decisao("anterior_a_chave");
  // A compra continua exigindo valor, como sempre: mandar zero ensinaria à Meta
  // que a venda não vale nada.
  if (valor === null) return decisao("sem_valor");

  return enviar({
    admin,
    organizationId: org,
    leadId,
    eventoNoLivro: COMPRA_NA_META.nomeTecnico,
    nomeTecnico: COMPRA_NA_META.nomeTecnico,
    origem,
    ocorridoEm,
    valorCentavos: valor,
    moeda,
    guardaRetrato: false,
  });
}

async function processar(row: EventRow): Promise<HandlerResult> {
  if (!row.entity_id) return ignorar("sem_entidade");
  const admin = createAdminClient();
  const leadId = row.entity_id;

  if (row.event_type === EVENTO_DE_REENVIO_DA_META) {
    const nome = row.payload.event_name;
    const chave = chaveDoEventoNoLivro(nome);
    if (!chave || typeof nome !== "string") return ignorar("outro_evento");
    const registro = await lerRegistroDaMeta(admin, row.organization_id, leadId, nome);
    if (registro?.status === "sent") return ignorar("ja_enviada");
    if (!temRetrato(registro)) return ignorar("sem_retrato_registrado");
    return comRetrato(admin, row.organization_id, leadId, nome, chave, registro);
  }

  if (row.event_type === "ad_conversion.retry_requested") {
    // O reenvio do upstream: só a venda é assunto deste consumidor (as etapas
    // do Google são do consumidor dele, e as nossas têm evento próprio).
    const nome = row.payload.event_name;
    if (nome !== undefined && nome !== null && nome !== COMPRA_NA_META.nomeTecnico) return ignorar("outro_evento");
    return vendaDeFormulario(admin, row, leadId);
  }

  if (row.event_type === "lead.won") return vendaDeFormulario(admin, row, leadId);

  if (row.event_type !== "lead.stage_changed") return ignorar("outro_evento");

  // A mudança de etapa é as duas portas: a etapa aberta com regra (o evento de
  // etapa) e a etapa de ganho arrastada no quadro (a venda). As duas nunca são
  // a mesma etapa, então um resultado não esconde o outro.
  const daEtapa = await etapa(admin, row, leadId);
  if (daEtapa.status !== "skipped" || daEtapa.detail !== "etapa_sem_regra") return daEtapa;
  const daVenda = await vendaDeFormulario(admin, row, leadId);
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
      detail: "Não foi possível processar a conversão da Meta. Nova tentativa agendada.",
    };
  }
}

export const conversaoDeEtapaDaMetaHandler: EventHandler = {
  key: KEY,
  events: ["lead.stage_changed", "lead.won", "ad_conversion.retry_requested", EVENTO_DE_REENVIO_DA_META],
  handle,
};

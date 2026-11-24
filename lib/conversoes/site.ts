/**
 * FORK MIA (MIA-169) — as CONVERSÕES DO SITE no motor de sempre
 * (docs/fork/conversoes-da-meta.md, seção "Conversões do site").
 *
 * O cadastro e a assinatura da MIA viram negócio no funil da Time (parte A,
 * `mia_cadastro_na_time`), e cada etapa da conta tem de chegar à Meta como
 * EVENTO DE SITE e ao Google Ads como importação de clique. Não há motor novo:
 * as regras moram ao lado das do upstream (`mia_regras_de_conversao_do_site`,
 * 9170), e o envio passa pelo MESMO `processarConversao`, o mesmo livro-razão
 * (`ad_conversion_dispatches`) e o mesmo reenvio.
 *
 * ─── A chave no livro-razão ─────────────────────────────────────────────────
 *
 * `MetaEtapa:<id da regra>` (Meta) ou `Etapa:<id da regra>` (Google). O formato
 * é o que o upstream já aceita no reenvio (`fn_solicitar_reenvio_conversao`) e
 * nos consumidores dele (`etapa-meta.handler.ts`, `qualificacao.handler.ts`),
 * que leem o RETRATO e chamam `processarConversao`. O uuid é o da REGRA, e o do
 * upstream é o da ETAPA: as duas famílias não colidem. Por isso o ramo do
 * `envio.handler.ts` pergunta aqui primeiro: se a chave é de uma regra do site,
 * este arquivo decide tudo; se não é, devolve `null` e o upstream segue.
 *
 * ─── O que muda em relação à regra de etapa do upstream ────────────────────
 *
 *  - a atribuição vem da `mia_cadastro_na_time` (o navegador do /signup), e não
 *    do carimbo do contato: na Meta todo cadastro é elegível; no Google, só com
 *    `gclid`, `gbraid` ou `wbraid`;
 *  - `leva_valor` manda o valor do negócio (sem valor: `sem_valor`, como a compra);
 *  - a credencial da Meta vem do AMBIENTE (`MIA_META_DATASET_DO_SITE`,
 *    `MIA_META_TOKEN_DO_SITE`), e só para a empresa dona da fonte
 *    `CADASTRO_FONTE_DO_CRM`. Nenhuma outra empresa usa a variável, nem que
 *    tenha uma regra do site gravada à mão;
 *  - o Google usa a conexão da própria empresa, com a ação da regra.
 *
 * E a guarda `venda_pelo_site`: o negócio que tem linha na `mia_cadastro_na_time`
 * não manda o `Purchase` do caminho da venda (`lead.won`): a compra do site já
 * sai pela etapa "Assinante", e contaria duas vezes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { lerIdentificadoresGoogle } from "@/lib/plataformas-de-anuncio/google/identificadores";
import { ehEventoDeSiteDaMeta } from "@/lib/plataformas-de-anuncio/meta/evento-do-site";
import { transporteDe } from "@/lib/plataformas-de-anuncio/registry";
import type {
  ConversaoOffline,
  CredencialDeConversao,
  DadosDoEventoDoSite,
  NomeDoEvento,
  PlataformaDeAnuncio,
  ResultadoDeEnvio,
} from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerRegistro, registraEnvio } from "./registro-de-envio";

export const TABELA_DAS_REGRAS_DO_SITE = "mia_regras_de_conversao_do_site";
export const TABELA_DO_CADASTRO = "mia_cadastro_na_time";

/** As variáveis (declaradas em `lib/env.ts` e no `.env.example`). Nunca no log. */
export const VARIAVEL_DA_FONTE_DO_CADASTRO = "CADASTRO_FONTE_DO_CRM";
export const VARIAVEL_DO_DATASET_DO_SITE = "MIA_META_DATASET_DO_SITE";
export const VARIAVEL_DO_TOKEN_DO_SITE = "MIA_META_TOKEN_DO_SITE";
export const VARIAVEL_DO_CODIGO_DE_TESTE = "META_TEST_EVENT_CODE";

const KEY = "conversoes.etapa_site";
const ESPERA_PADRAO_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^(MetaEtapa|Etapa):([0-9a-f-]{36})$/;

export interface RegraDoSite {
  id: string;
  organizationId: string;
  stageId: string;
  plataforma: "meta_ads" | "google_ads";
  eventoMeta: string | null;
  googleAcaoId: string | null;
  levaValor: boolean;
  enabled: boolean;
  configuredAt: string;
}

const COLUNAS_DA_REGRA =
  "id, organization_id, stage_id, plataforma, evento_meta, google_acao_id, leva_valor, enabled, configured_at";

function regraDaLinha(l: Record<string, unknown>): RegraDoSite {
  return {
    id: String(l.id),
    organizationId: String(l.organization_id),
    stageId: String(l.stage_id),
    plataforma: l.plataforma === "google_ads" ? "google_ads" : "meta_ads",
    eventoMeta: typeof l.evento_meta === "string" ? l.evento_meta : null,
    googleAcaoId: typeof l.google_acao_id === "string" ? l.google_acao_id : null,
    levaValor: l.leva_valor === true,
    enabled: l.enabled === true,
    configuredAt: String(l.configured_at),
  };
}

/** A chave da regra no livro-razão. */
export function chaveDaRegraDoSite(
  regra: Pick<RegraDoSite, "id" | "plataforma">,
): `MetaEtapa:${string}` | `Etapa:${string}` {
  return regra.plataforma === "meta_ads" ? `MetaEtapa:${regra.id}` : `Etapa:${regra.id}`;
}

/** As regras LIGADAS de uma etapa (várias: Subscribe, Purchase e a do Google). */
export async function lerRegrasDoSiteDaEtapa(
  admin: SupabaseClient,
  organizationId: string,
  stageId: string,
): Promise<RegraDoSite[]> {
  const { data, error } = await admin
    .from(TABELA_DAS_REGRAS_DO_SITE)
    .select(COLUNAS_DA_REGRA)
    .eq("organization_id", organizationId)
    .eq("stage_id", stageId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Não foi possível ler as regras do site.");
  return ((data ?? []) as Record<string, unknown>[]).map(regraDaLinha);
}

async function lerRegraDoSite(
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<RegraDoSite | null> {
  const { data, error } = await admin
    .from(TABELA_DAS_REGRAS_DO_SITE)
    .select(COLUNAS_DA_REGRA)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler a regra do site.");
  // A linha tem de ser a pedida, e de uma das duas plataformas: qualquer outra
  // coisa não é regra do site, e a chave segue para o upstream.
  const l = data as Record<string, unknown> | null;
  if (!l || l.id !== id || (l.plataforma !== "meta_ads" && l.plataforma !== "google_ads")) return null;
  return regraDaLinha(l);
}

/** O id da fonte do cadastro, só se tiver forma de uuid. */
export function idDaFonteDoCadastro(ambiente: NodeJS.ProcessEnv = process.env): string | null {
  const id = (ambiente[VARIAVEL_DA_FONTE_DO_CADASTRO] ?? "").trim();
  return UUID.test(id) ? id : null;
}

/** A empresa dona da fonte `CADASTRO_FONTE_DO_CRM` (a Time). `null` sem a variável ou sem a fonte. */
export async function orgDaFonteDoCadastro(
  admin: SupabaseClient,
  ambiente: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const id = idDaFonteDoCadastro(ambiente);
  if (!id) return null;
  const { data, error } = await admin
    .from("webhook_sources")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler a fonte do cadastro.");
  const org = (data as { organization_id?: unknown } | null)?.organization_id;
  return typeof org === "string" ? org : null;
}

export type CredencialDoSite =
  | { ok: true; credencial: CredencialDeConversao }
  | { ok: false; motivo: "site_fora_da_empresa_da_fonte" | "site_sem_credencial" };

/**
 * A credencial da Meta do site. A variável vale SÓ para a empresa da fonte do
 * cadastro: qualquer outra recebe `site_fora_da_empresa_da_fonte`, sem ler o
 * token. Sem dataset ou token no ambiente: `site_sem_credencial`.
 */
export function credencialDaMetaDoSite(
  organizationId: string,
  orgDaFonte: string | null,
  ambiente: NodeJS.ProcessEnv = process.env,
): CredencialDoSite {
  if (!orgDaFonte || orgDaFonte !== organizationId)
    return { ok: false, motivo: "site_fora_da_empresa_da_fonte" };
  const datasetId = (ambiente[VARIAVEL_DO_DATASET_DO_SITE] ?? "").trim();
  const accessToken = (ambiente[VARIAVEL_DO_TOKEN_DO_SITE] ?? "").trim();
  if (!/^[0-9]{1,32}$/.test(datasetId) || accessToken === "")
    return { ok: false, motivo: "site_sem_credencial" };
  return { ok: true, credencial: { datasetId, accessToken, testEventCode: codigoDeTesteDoSite(ambiente) } };
}

export function codigoDeTesteDoSite(ambiente: NodeJS.ProcessEnv = process.env): string | null {
  const codigo = (ambiente[VARIAVEL_DO_CODIGO_DE_TESTE] ?? "").trim();
  return codigo === "" ? null : codigo;
}

/** O que a parte A guardou do /signup, mais o que o contato do negócio tem. */
export interface CadastroDoSite {
  empresaClienteId: string | null;
  ip: string | null;
  navegador: string | null;
  pagina: string | null;
  fbp: string | null;
  fbc: string | null;
  consentimento: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  pedidoId: string | null;
}

async function lerCadastroDoSite(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<CadastroDoSite | null> {
  const { data, error } = await admin
    .from(TABELA_DO_CADASTRO)
    .select("lead_id, empresa_cliente_id, ip, navegador, pagina, fbp, fbc, consentimento, gclid, gbraid, wbraid, pedido_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler o cadastro do site.");
  if (!data) return null;
  const l = data as Record<string, unknown>;
  if (l.lead_id !== leadId) return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return {
    empresaClienteId: s(l.empresa_cliente_id),
    ip: s(l.ip),
    navegador: s(l.navegador),
    pagina: s(l.pagina),
    fbp: s(l.fbp),
    fbc: s(l.fbc),
    consentimento: s(l.consentimento),
    gclid: s(l.gclid),
    gbraid: s(l.gbraid),
    wbraid: s(l.wbraid),
    pedidoId: s(l.pedido_id),
  };
}

/**
 * A guarda `venda_pelo_site`: o negócio do cadastro não manda o `Purchase` do
 * caminho da venda. Falha fechada: erro de leitura lança e o consumidor reagenda,
 * nunca manda a compra em dobro.
 */
export async function ehVendaPeloSite(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABELA_DO_CADASTRO)
    .select("lead_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível conferir o cadastro do site.");
  return (data as { lead_id?: unknown } | null)?.lead_id === leadId;
}

/** O que o consumidor de etapa passa: quando, e (no reenvio) o retrato. */
export interface EnvioDeEtapaDoSite {
  ocorridoEm: string;
}

const ok = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: KEY,
  status,
  detail,
});
const depois = (detail: string, ms = ESPERA_PADRAO_MS): HandlerResult => ({
  consumer_key: KEY,
  status: "retry",
  retry_at: new Date(Date.now() + ms).toISOString(),
  detail,
});

/**
 * O ramo do `processarConversao`. `null` = a chave não é de uma regra do site
 * (o upstream segue como sempre). Qualquer outro desfecho é final.
 */
export async function processarConversaoDoSite(
  row: EventRow,
  evento: NomeDoEvento,
  etapa: EnvioDeEtapaDoSite,
  deps: { admin?: SupabaseClient; ambiente?: NodeJS.ProcessEnv } = {},
): Promise<HandlerResult | null> {
  const chave = CHAVE.exec(evento);
  if (!chave || !row.entity_id) return null;
  const admin = deps.admin ?? createAdminClient();
  const ambiente = deps.ambiente ?? process.env;

  const regra = await lerRegraDoSite(admin, row.organization_id, chave[2]!);
  if (!regra) {
    // A regra sumiu (a etapa foi apagada e levou a regra junto). Um retrato
    // com um dos 4 eventos de site é nosso, e não pode cair no transporte do
    // upstream, que mandaria ao dataset da conexão da empresa.
    if (!evento.startsWith("MetaEtapa:")) return null;
    const antigo = await lerRegistro(admin, row.organization_id, row.entity_id, evento);
    return ehEventoDeSiteDaMeta(antigo?.meta_event_name) ? ok("skipped", "regra_do_site_removida") : null;
  }
  const registro = await lerRegistro(admin, row.organization_id, row.entity_id, evento);
  const plataformaDaChave: PlataformaDeAnuncio = chave[1] === "MetaEtapa" ? "meta_ads" : "google_ads";
  if (regra.plataforma !== plataformaDaChave) return ok("skipped", "regra_invalida");
  if (registro?.status === "sent") return ok("skipped", "ja_enviada");

  const { data: lido, error: erroLead } = await admin
    .from("crm_leads")
    .select("id, value_cents, currency, contact_id")
    .eq("id", row.entity_id)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (erroLead) return depois(`leitura do lead falhou: ${erroLead.message}`);
  if (!lido) return ok("skipped", "lead_inexistente");
  const lead = lido as { id: string; value_cents: number | null; currency: string | null; contact_id: string | null };

  // Atribuição: o cadastro do site. Sem linha, o negócio não veio do /signup
  // (alguém o arrastou para a etapa à mão): nada a reportar, sem linha no livro-razão.
  const cadastro = await lerCadastroDoSite(admin, row.organization_id, lead.id);
  if (!cadastro) return ok("skipped", "sem_cadastro_do_site");
  const identificadoresGoogle = lerIdentificadoresGoogle({
    ...(cadastro.gclid ? { gclid: cadastro.gclid } : {}),
    ...(cadastro.gbraid ? { gbraid: cadastro.gbraid } : {}),
    ...(cadastro.wbraid ? { wbraid: cadastro.wbraid } : {}),
  });
  if (regra.plataforma === "google_ads" && !identificadoresGoogle)
    return ok("skipped", "sem_clique_do_google");

  // O retrato: o primeiro envio vence, e mudar a regra depois não rebatiza nada.
  const ocorridoEm = registro?.event_occurred_at ?? etapa.ocorridoEm;
  const eventoMeta = registro?.meta_event_name ?? regra.eventoMeta;
  const acaoDoGoogle = registro?.google_action_id ?? regra.googleAcaoId;
  const valorCentavos =
    regra.levaValor && lead.value_cents !== null && lead.value_cents > 0 ? lead.value_cents : null;
  const moeda = (lead.currency ?? "BRL").toUpperCase();

  const registra = (
    status: "sent" | "skipped" | "error",
    motivo: string | null,
    detalhe?: string,
    protocolo?: string | null,
    solicitadoEm?: string | null,
  ) =>
    registraEnvio(admin, {
      organizationId: row.organization_id,
      leadId: lead.id,
      plataforma: regra.plataforma,
      evento,
      status,
      motivo,
      eventoId: `${lead.id}:${evento}`,
      valorCentavos,
      moeda,
      detalhe: detalhe ?? null,
      protocolo,
      solicitadoEm,
      ocorridoEm,
      ...(regra.plataforma === "meta_ads" && eventoMeta ? { metaEventName: eventoMeta } : {}),
      ...(regra.plataforma === "google_ads" && acaoDoGoogle ? { googleActionId: acaoDoGoogle } : {}),
    });

  if (regra.levaValor && valorCentavos === null) {
    await registra("skipped", "sem_valor");
    return ok("skipped", "sem_valor");
  }

  // A credencial. Meta: só a variável, só na empresa da fonte. Google: a conexão da empresa.
  let credencial: CredencialDeConversao;
  if (regra.plataforma === "meta_ads") {
    const lida = credencialDaMetaDoSite(row.organization_id, await orgDaFonteDoCadastro(admin, ambiente), ambiente);
    if (!lida.ok) {
      await registra("skipped", lida.motivo);
      return ok("skipped", lida.motivo);
    }
    // A trava da demonstração (9010) mora na conexão, e este ramo não lê a
    // conexão: pergunta à mesma `fn_mia_e_demonstracao`. Demonstração não manda;
    // sem confirmar, também não, e tenta de novo mais tarde.
    const trava = await travaDaDemonstracao(admin, row.organization_id);
    if (trava.travado) {
      if (trava.motivo === "nao_confirmado") return depois("site_demonstracao_nao_confirmada");
      await registra("skipped", "site_empresa_de_demonstracao");
      return ok("skipped", "site_empresa_de_demonstracao");
    }
    credencial = lida.credencial;
  } else {
    const lida = await lerCredencial(admin, row.organization_id, "google_ads", { exigirAcaoDeVenda: false });
    if (!lida.ok) {
      if (lida.motivo === "leitura_indisponivel") throw new Error("Leitura da conexão indisponível.");
      await registra("skipped", lida.motivo);
      return ok("skipped", lida.motivo);
    }
    credencial = lida.credencial;
    if (!credencial.google || !acaoDoGoogle) {
      await registra("skipped", "credencial_incompleta");
      return ok("skipped", "credencial_incompleta");
    }
    credencial.google.conversionActionId = acaoDoGoogle;
  }

  // O retrato vai ao banco ANTES do envio, como no upstream: dois movimentos que
  // concorrem leem o mesmo (o gatilho da 0436 preserva o primeiro).
  if (!registro?.event_occurred_at) await registra("skipped", "nova_tentativa_agendada");

  const transporte = transporteDe(regra.plataforma);
  if (!transporte) {
    await registra("skipped", "plataforma_sem_transporte");
    return ok("skipped", "plataforma_sem_transporte");
  }

  const contato = await lerContato(admin, row.organization_id, lead.contact_id);
  const conversao = montarConversaoDoSite({
    organizationId: row.organization_id,
    leadId: lead.id,
    evento,
    ocorridoEm: new Date(ocorridoEm),
    eventoMeta: regra.plataforma === "meta_ads" ? eventoMeta : null,
    valorCentavos,
    moeda,
    telefone: contato.telefone,
    cadastro,
    email: contato.email,
    nome: contato.nome,
    identificadoresGoogle: identificadoresGoogle ?? undefined,
  });

  const resultado =
    registro?.remote_request_id && transporte.consultar
      ? await transporte.consultar(credencial, registro.remote_request_id)
      : await transporte.enviar(credencial, conversao);
  return desfechoDoSite(resultado, Boolean(credencial.testEventCode), registra, registro);
}

/** A conversão no formato da casa. Exportada para a ferramenta de teste do MCP. */
export function montarConversaoDoSite(p: {
  organizationId: string;
  leadId: string;
  evento: NomeDoEvento;
  ocorridoEm: Date;
  eventoMeta: string | null;
  valorCentavos: number | null;
  moeda: string;
  telefone: string | null;
  email: string | null;
  nome: string | null;
  cadastro: CadastroDoSite;
  identificadoresGoogle?: ConversaoOffline["identificadoresGoogle"];
  somenteValidar?: boolean;
}): ConversaoOffline {
  const site: DadosDoEventoDoSite = {
    email: p.email,
    nome: p.nome,
    idExterno: p.cadastro.empresaClienteId,
    ip: p.cadastro.ip,
    navegador: p.cadastro.navegador,
    pagina: p.cadastro.pagina,
    // O transporte confere de novo; aqui já não passam sem o aviso aceito.
    fbp: p.cadastro.consentimento === "medicao" ? p.cadastro.fbp : null,
    fbc: p.cadastro.consentimento === "medicao" ? p.cadastro.fbc : null,
    consentimento: p.cadastro.consentimento,
    pedidoId: p.cadastro.pedidoId,
    ...(p.somenteValidar ? { somenteValidar: true } : {}),
  };
  return {
    organizationId: p.organizationId,
    leadId: p.leadId,
    evento: p.evento,
    eventoId: `${p.leadId}:${p.evento}`,
    ocorridoEm: p.ocorridoEm,
    cliqueDeOrigem: p.identificadoresGoogle?.gclid ?? "",
    ...(p.identificadoresGoogle ? { identificadoresGoogle: p.identificadoresGoogle } : {}),
    telefone: p.telefone,
    moeda: p.moeda,
    valorCentavos: p.valorCentavos,
    eventoNaPlataforma: p.eventoMeta,
    site,
  };
}

async function lerContato(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string | null,
): Promise<{ email: string | null; telefone: string | null; nome: string | null }> {
  if (!contactId) return { email: null, telefone: null, nome: null };
  const { data, error } = await admin
    .from("contacts")
    .select("name, display_name, email, phone_number")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível ler o contato do negócio.");
  if (!data) return { email: null, telefone: null, nome: null };
  const c = data as { name: string | null; display_name: string | null; email: string | null; phone_number: string | null };
  return {
    email: c.email?.trim() || null,
    telefone: c.phone_number ? c.phone_number.replace(/\D/g, "") || null : null,
    nome: nomeDoContato(c),
  };
}

type Registra = (
  status: "sent" | "skipped" | "error",
  motivo: string | null,
  detalhe?: string,
  protocolo?: string | null,
  solicitadoEm?: string | null,
) => Promise<void>;

/** O mesmo desfecho do `envio.handler.ts`: o livro-razão e a espera de sempre. */
async function desfechoDoSite(
  resultado: ResultadoDeEnvio,
  modoDeTeste: boolean,
  registra: Registra,
  registro: Awaited<ReturnType<typeof lerRegistro>>,
): Promise<HandlerResult> {
  if (resultado.tipo === "processando") {
    const solicitadoEm =
      registro?.remote_request_id === resultado.protocolo
        ? (registro.remote_requested_at ?? new Date().toISOString())
        : new Date().toISOString();
    const vencido = Date.now() - new Date(solicitadoEm).getTime() > 24 * 60 * 60 * 1000;
    await registra(
      "skipped",
      vencido ? "processamento_demorado" : "aguardando_processamento",
      resultado.detalhe,
      resultado.protocolo,
      solicitadoEm,
    );
    return vencido ? ok("skipped", "processamento_demorado") : depois(resultado.detalhe);
  }
  if (resultado.tipo === "ok") {
    if (modoDeTeste) {
      await registra(
        "skipped",
        "evento_de_teste",
        "Evento recebido em modo de teste (META_TEST_EVENT_CODE). Tire o código antes de ligar as regras do site.",
      );
      return ok("skipped", "evento_de_teste");
    }
    await registra("sent", null, resultado.detalhe);
    return ok("ok", "conversão do site reportada");
  }
  if (resultado.tipo === "transitorio") {
    await registra("skipped", "nova_tentativa_agendada", resultado.detalhe);
    return depois(resultado.detalhe, resultado.tentarEmMs);
  }
  await registra(
    "error",
    "recusado_pela_plataforma",
    resultado.detalhe,
    resultado.rejeicaoConfirmada ? null : undefined,
  );
  return ok("skipped", "recusado_pela_plataforma");
}

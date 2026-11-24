/**
 * FORK MIA · coexistência (S3): a CONEXÃO do número do app WhatsApp Business.
 *
 * O navegador abre a janela da Meta (`janela.ts`), o cliente lê o QR com o
 * celular e a janela devolve um CÓDIGO e a conta (`waba_id`). Daqui para
 * baixo é tudo no servidor:
 *
 *  1. a chave da empresa está ligada (`chave.ts`);
 *  2. o código vira token com o App Secret (`oauth/access_token`);
 *  3. o número sai da janela ou, quando ela não manda, da conta na Graph
 *     (`numeros-da-waba.ts`);
 *  4. o par número/conta é validado com o token novo, como na porta manual;
 *  5. o número NUNCA é tomado de outra empresa: sessão ativa ou cadastro
 *     incorporado de outra organização recusam;
 *  6. a sessão do canal oficial nasce (ou volta) NA EMPRESA QUE ABRIU A
 *     JANELA, com a origem `embedded_signup` do upstream (9328), e o cadastro
 *     incorporado (`meta_onboardings`) já sai amarrado: nenhum passo manual em
 *     /admin/meta;
 *  7. o webhook do número é registrado pela instalação (mesma peça da porta
 *     manual);
 *  8. o ciclo da coexistência abre (`mia_coexistencia_conexoes`) e o pedido
 *     da sincronização vai ao worker (`sincronizacao.ts`). Quem pede é ele,
 *     com a trava; a rota só avisa.
 *
 * Não chama `/register`: a página da Meta manda pular o registro, o número já
 * está registrado no app.
 *
 * ─── Idempotência ────────────────────────────────────────────────────────────
 *
 * A mesma volta duas vezes (o navegador reenviando, dois cliques) dá UMA
 * sessão e UM ciclo: a sessão é a do canal oficial da empresa (uma por
 * empresa, como na porta manual) e o ciclo vivo do número é único no banco
 * (`mia_coexistencia_conexoes_viva_uidx`). Ciclo vivo aberto pela janela há
 * menos de 10 minutos é o MESMO ciclo; mais velho é passagem nova pela janela
 * (o cliente saiu do app e voltou): o velho vira `encerrada` e nasce outro,
 * com as duas travas de pedido novas.
 *
 * Nada de credencial no que sai daqui: o token só existe cifrado na sessão, e
 * os desfechos de erro dizem o motivo sem ecoar o que a Meta devolveu.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../../archived";
import { CHANNEL_PROVIDER_META } from "../../capabilities";
import { reactivateChannelSession } from "../../reactivate";
import { appDaMeta } from "../app";
import { graphBaseUrl } from "../graph-base";
import { numerosDaWaba } from "../numeros-da-waba";
import { ORIGEM_DO_EMBEDDED_SIGNUP, registrarOrigemDaConexao } from "../origem-da-conexao";
import { validateMetaCredentials } from "../validate-credentials";
import { registrarWebhookDaSessao } from "../webhook-da-sessao";
import { lerChaveDaCoexistencia } from "./chave";
import { desligarQrDoMesmoNumero } from "./qr-do-mesmo-numero";
import { emitirPedidoDaSincronizacao } from "./sincronizacao";
import { VALIDADE_DO_NONCE_MS } from "./janela";

type Admin = SupabaseClient;

export type RecusaDaConexao =
  | "chave_desligada"
  | "sem_app_da_meta"
  | "codigo_recusado"
  | "sem_numero"
  | "varios_numeros"
  | "numero_recusado"
  | "numero_de_outra_empresa"
  | "outro_numero_conectado"
  | "sem_cifra"
  | "limite_do_plano"
  | "falha";

export type DesfechoDaConexao =
  | {
      ok: true;
      channelSessionId: string;
      conexaoId: string;
      /** `false` quando a volta repetiu uma conexão de minutos atrás: nada novo nasceu. */
      cicloNovo: boolean;
      phoneNumber: string | null;
      displayName: string;
      webhookRegistrado: boolean;
      pedidoEmitido: boolean;
      qrDesligados: number;
    }
  | { ok: false; motivo: RecusaDaConexao; erroDoBanco?: unknown };

export interface EntradaDaConexao {
  organizationId: string;
  userId: string;
  code: string;
  wabaId: string;
  /** O número que a janela mandou, quando mandou. A página da Meta não garante. */
  phoneNumberId?: string | null;
  /** Base pública do callback da Meta (`basePublicaDoWebhookMeta`). */
  baseDoWebhook: string;
  requestId: string;
}

export interface DependenciasDaConexao {
  fetch?: typeof fetch;
  agora?: () => Date;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * O código da janela vira o token de acesso da empresa. `null` em qualquer
 * recusa: o corpo da Meta não volta (pode ecoar o código ou o segredo).
 */
export async function trocarCodigoPeloToken(input: {
  code: string;
  appId: string;
  appSecret: string;
  fetch?: typeof fetch;
}): Promise<string | null> {
  const f = input.fetch ?? fetch;
  const url = new URL(`${graphBaseUrl()}/oauth/access_token`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);
  try {
    const res = await f(url.toString(), { method: "GET" });
    const corpo = (await res.json().catch(() => ({}))) as { access_token?: unknown };
    if (!res.ok) return null;
    return texto(corpo.access_token);
  } catch {
    return null;
  }
}

/** Só os dígitos: o canal oficial grava `+55…` e o QR grava `55…`. */
export function digitosDoNumero(numero: string | null | undefined): string {
  return (numero ?? "").replace(/\D/g, "");
}

async function numeroDaConexao(
  entrada: EntradaDaConexao,
  token: string,
): Promise<{ ok: true; phoneNumberId: string } | { ok: false; motivo: "sem_numero" | "varios_numeros" }> {
  const daJanela = texto(entrada.phoneNumberId);
  if (daJanela) return { ok: true, phoneNumberId: daJanela };
  const lidos = await numerosDaWaba({ wabaId: entrada.wabaId, token });
  if (!lidos.ok || lidos.numeros.length === 0) return { ok: false, motivo: "sem_numero" };
  // A conta que a janela do app cria tem o número do app. Mais de um é conta
  // antiga reaproveitada: adivinhar qual amarraria o número errado.
  if (lidos.numeros.length > 1) return { ok: false, motivo: "varios_numeros" };
  return { ok: true, phoneNumberId: lidos.numeros[0]!.id };
}

/** O número está ativo em OUTRA empresa (sessão ou cadastro incorporado)? */
async function numeroEDeOutraEmpresa(
  admin: Admin,
  input: { organizationId: string; phoneNumberId: string; wabaId: string },
): Promise<boolean> {
  // De propósito SEM filtro de organização: a pergunta é justamente se o
  // número vive em OUTRA empresa da instalação (só o id e a empresa saem daqui).
  const sessoes = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id")
      .eq("provider", CHANNEL_PROVIDER_META)
      .eq("meta_phone_number_id", input.phoneNumberId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => sessoes().is(ARCHIVED_AT, null).limit(20),
    () => sessoes().limit(20),
  );
  if (error) throw new Error(`numero_de_outra_empresa: ${error.message ?? ""}`);
  if (((data ?? []) as Array<{ organization_id: string }>).some((s) => s.organization_id !== input.organizationId)) {
    return true;
  }

  const { data: chegada, error: erroDaChegada } = await admin
    .from("meta_onboardings")
    .select("organization_id")
    .eq("waba_id", input.wabaId)
    .maybeSingle();
  if (erroDaChegada) throw new Error(`cadastro_de_outra_empresa: ${erroDaChegada.message}`);
  const dono = (chegada as { organization_id?: string | null } | null)?.organization_id ?? null;
  return dono !== null && dono !== input.organizationId;
}

/** O nome que o canal já tem, ou o que a Meta deu ao número. */
function nomeDoCanal(existente: { display_name?: string | null } | null, daMeta: string): string {
  const atual = existente ? existente.display_name : null;
  return atual && atual.trim().length > 0 ? atual : daMeta;
}

interface SessaoExistente {
  id: string;
  archived_at?: string | null;
  webhook_path_token?: string | null;
  display_name?: string | null;
  meta_phone_number_id?: string | null;
}

async function gravarSessao(
  admin: Admin,
  entrada: EntradaDaConexao,
  dados: { phoneNumberId: string; tokenCifrado: string; phoneNumber: string | null; nome: string },
): Promise<
  | { ok: true; channelSessionId: string; webhookPathToken: string | null; displayName: string }
  | { ok: false; motivo: RecusaDaConexao; erroDoBanco?: unknown }
> {
  const orgId = entrada.organizationId;
  // A busca NÃO filtra `archived_at`, como a porta manual: o canal oficial
  // excluído é o que a conexão traz de volta (uma linha oficial por empresa).
  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", orgId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .maybeSingle();
  const { data: bruto, error: erroDaBusca } = await queryTolerantToMissingArchived(
    () => buscar(`id, ${ARCHIVED_AT}, webhook_path_token, display_name, meta_phone_number_id`),
    () => buscar("id, webhook_path_token, display_name, meta_phone_number_id"),
  );
  if (erroDaBusca) return { ok: false, motivo: "falha", erroDoBanco: erroDaBusca };
  const existente = bruto as SessaoExistente | null;

  // A empresa já fala por OUTRO número oficial: trocar em silêncio derrubaria
  // as conversas dele. Quem quer trocar tira o outro em Conexões primeiro.
  if (
    existente &&
    !existente.archived_at &&
    existente.meta_phone_number_id &&
    existente.meta_phone_number_id !== dados.phoneNumberId
  ) {
    return { ok: false, motivo: "outro_numero_conectado" };
  }

  const linha = {
    organization_id: orgId,
    provider: CHANNEL_PROVIDER_META,
    meta_phone_number_id: dados.phoneNumberId,
    meta_waba_id: entrada.wabaId,
    meta_token_encrypted: dados.tokenCifrado,
    phone_number: dados.phoneNumber,
    // O nome do canal é do operador depois da 1ª conexão (Renomear): reconectar não o apaga.
    display_name: nomeDoCanal(existente, dados.nome),
    status: "WORKING",
  };

  if (existente) {
    const { error } = await reactivateChannelSession(
      admin,
      { organizationId: orgId, channelSessionId: existente.id, archivedAt: existente.archived_at ?? null },
      linha,
      {
        userId: entrada.userId,
        requestId: entrada.requestId,
        metadata: { provider: CHANNEL_PROVIDER_META, phone_number: linha.phone_number, coexistencia: true },
      },
    );
    if (error) return { ok: false, motivo: "falha", erroDoBanco: error };
    return {
      ok: true,
      channelSessionId: existente.id,
      webhookPathToken: existente.webhook_path_token ?? null,
      displayName: linha.display_name,
    };
  }

  // O segredo de webhook do CANAL é aleatório e não é o token da Meta (mesma
  // decisão da amarração em /admin/meta).
  const segredoCifrado = await encryptWebhookSecret(admin, randomBytes(32).toString("hex"));
  if (!segredoCifrado) return { ok: false, motivo: "sem_cifra" };
  const inserida = await admin
    .from("channel_sessions")
    .insert({ ...linha, webhook_secret_encrypted: segredoCifrado, metadata: metadataInicialDoCanal() })
    .select("id, webhook_path_token")
    .maybeSingle();
  if (inserida.error || !inserida.data) return { ok: false, motivo: "falha", erroDoBanco: inserida.error };
  const criada = inserida.data as { id: string; webhook_path_token: string | null };
  return {
    ok: true,
    channelSessionId: criada.id,
    webhookPathToken: criada.webhook_path_token,
    displayName: linha.display_name,
  };
}

/** O cadastro incorporado já amarrado à empresa: nada fica na fila de /admin/meta. */
async function amarrarCadastro(
  admin: Admin,
  entrada: EntradaDaConexao,
  dados: { channelSessionId: string; phoneNumberId: string; phoneNumber: string | null; nome: string; agora: string },
): Promise<void> {
  const { error } = await admin.from("meta_onboardings").upsert(
    {
      waba_id: entrada.wabaId,
      business_name: dados.nome,
      phone_number_id: dados.phoneNumberId,
      phone_number: dados.phoneNumber,
      organization_id: entrada.organizationId,
      channel_session_id: dados.channelSessionId,
      bound_at: dados.agora,
      bound_by: entrada.userId,
      updated_at: dados.agora,
    },
    { onConflict: "waba_id" },
  );
  // Best-effort: o canal já funciona sem esta linha. Ela só tira a conta da
  // fila do operador; falhar aqui não desfaz a conexão.
  if (error) {
    logger.warn("[meta.coexistencia] cadastro incorporado não amarrado", {
      request_id: entrada.requestId,
      codigo: error.code ?? null,
    });
  }
}

/** Abre o ciclo da coexistência, ou devolve o da mesma passagem pela janela. Exportada para o teste. */
export async function abrirCiclo(
  admin: Admin,
  entrada: EntradaDaConexao,
  dados: { channelSessionId: string; phoneNumberId: string; agora: Date },
): Promise<{ conexaoId: string; cicloNovo: boolean }> {
  const lerVivo = async () => {
    const { data, error } = await admin
      .from("mia_coexistencia_conexoes")
      .select("id, aberta_por, conectada_em, phone_number_id")
      .eq("organization_id", entrada.organizationId)
      .eq("channel_session_id", dados.channelSessionId)
      .in("estado", ["no_ar", "fora_do_ar"])
      .limit(1);
    if (error) throw new Error(`ciclo_vivo: ${error.message}`);
    return ((data ?? []) as Array<{ id: string; aberta_por: string; conectada_em: string; phone_number_id: string }>)[0] ?? null;
  };

  const vivo = await lerVivo();
  if (vivo) {
    const idade = dados.agora.getTime() - new Date(vivo.conectada_em).getTime();
    const mesmaPassagem =
      vivo.aberta_por === "conexao_pelo_app" &&
      vivo.phone_number_id === dados.phoneNumberId &&
      idade >= 0 &&
      idade < VALIDADE_DO_NONCE_MS;
    if (mesmaPassagem) return { conexaoId: vivo.id, cicloNovo: false };
    // Passagem nova pela janela: o ciclo velho fecha. Os pedidos dele ficam
    // como estão (histórico do que aconteceu); os do ciclo novo são outros.
    const { error } = await admin
      .from("mia_coexistencia_conexoes")
      .update({ estado: "encerrada" })
      .eq("organization_id", entrada.organizationId)
      .eq("id", vivo.id)
      .not("estado", "eq", "encerrada");
    if (error) throw new Error(`ciclo_encerrar: ${error.message}`);
  }

  const { data, error } = await admin
    .from("mia_coexistencia_conexoes")
    .insert({
      organization_id: entrada.organizationId,
      channel_session_id: dados.channelSessionId,
      waba_id: entrada.wabaId,
      phone_number_id: dados.phoneNumberId,
      aberta_por: "conexao_pelo_app",
      conectada_em: dados.agora.toISOString(),
    })
    .select("id");
  if (!error) {
    const id = ((data ?? []) as Array<{ id: string }>)[0]?.id;
    if (id) return { conexaoId: id, cicloNovo: true };
  }
  // 23505: a outra volta, ao mesmo tempo, abriu primeiro. O ciclo é o dela.
  if (error && error.code !== "23505") throw new Error(`ciclo_novo: ${error.message}`);
  const outro = await lerVivo();
  if (!outro) throw new Error("ciclo_novo: sem id");
  return { conexaoId: outro.id, cicloNovo: false };
}

export async function conectarPeloApp(
  admin: Admin,
  entrada: EntradaDaConexao,
  deps: DependenciasDaConexao = {},
): Promise<DesfechoDaConexao> {
  const agora = deps.agora?.() ?? new Date();

  try {
    const chave = await lerChaveDaCoexistencia(admin, entrada.organizationId);
    if (!chave.ligada) return { ok: false, motivo: "chave_desligada" };

    const appId = (process.env.META_APP_ID ?? "").trim();
    const { appSecret } = await appDaMeta();
    if (!appId || !appSecret) return { ok: false, motivo: "sem_app_da_meta" };

    const token = await trocarCodigoPeloToken({ code: entrada.code, appId, appSecret, fetch: deps.fetch });
    if (!token) return { ok: false, motivo: "codigo_recusado" };

    const numero = await numeroDaConexao(entrada, token);
    if (!numero.ok) return { ok: false, motivo: numero.motivo };
    const phoneNumberId = numero.phoneNumberId;

    const validacao = await validateMetaCredentials({ phoneNumberId, token, wabaId: entrada.wabaId });
    if (!validacao.ok) return { ok: false, motivo: "numero_recusado" };

    if (await numeroEDeOutraEmpresa(admin, { organizationId: entrada.organizationId, phoneNumberId, wabaId: entrada.wabaId })) {
      return { ok: false, motivo: "numero_de_outra_empresa" };
    }

    const tokenCifrado = await encryptWebhookSecret(admin, token);
    if (!tokenCifrado) return { ok: false, motivo: "sem_cifra" };

    const phoneNumber = validacao.displayPhoneNumber ? `+${digitosDoNumero(validacao.displayPhoneNumber)}` : null;
    const nome = validacao.verifiedName ?? "WhatsApp Oficial";
    const sessao = await gravarSessao(admin, entrada, { phoneNumberId, tokenCifrado, phoneNumber, nome });
    if (!sessao.ok) return sessao;

    // A origem é constante de código, nunca lida do corpo (#4074).
    await registrarOrigemDaConexao(admin, {
      organizationId: entrada.organizationId,
      channelSessionId: sessao.channelSessionId,
      origem: ORIGEM_DO_EMBEDDED_SIGNUP,
    });

    const webhook = sessao.webhookPathToken
      ? await registrarWebhookDaSessao({
          admin,
          channelSessionId: sessao.channelSessionId,
          phoneNumberId,
          wabaId: entrada.wabaId,
          tokenCifrado,
          webhookPathToken: sessao.webhookPathToken,
          base: entrada.baseDoWebhook,
          requestId: entrada.requestId,
        })
      : null;

    await amarrarCadastro(admin, entrada, {
      channelSessionId: sessao.channelSessionId,
      phoneNumberId,
      phoneNumber,
      nome,
      agora: agora.toISOString(),
    });

    const ciclo = await abrirCiclo(admin, entrada, {
      channelSessionId: sessao.channelSessionId,
      phoneNumberId,
      agora,
    });

    // D5: o canal por QR do MESMO número, na mesma empresa, sai do ar. A Meta
    // já desliga os aparelhos conectados na conexão; sem isto a mesma mensagem
    // entraria duas vezes (pela Meta e pelo QR) e a IA responderia duas.
    const qrDesligados = await desligarQrDoMesmoNumero(admin, {
      organizationId: entrada.organizationId,
      digitos: digitosDoNumero(phoneNumber),
      userId: entrada.userId,
      requestId: entrada.requestId,
    });

    const pedidoEmitido = ciclo.cicloNovo
      ? await emitirPedidoDaSincronizacao(admin, {
          organizationId: entrada.organizationId,
          conexaoId: ciclo.conexaoId,
          requestId: entrada.requestId,
        })
      : false;

    if (ciclo.cicloNovo) {
      const channelSessionId = sessao.channelSessionId;
      void audit({
        action: "channel.coexistencia_conectada",
        actorUserId: entrada.userId,
        organizationId: entrada.organizationId,
        resourceType: "channel_session",
        resourceId: channelSessionId,
        requestId: entrada.requestId,
        metadata: {
          conexao_id: ciclo.conexaoId,
          waba_id: entrada.wabaId,
          phone_number_id: phoneNumberId,
          qr_desligados: qrDesligados,
        },
      });
    }

    return {
      ok: true,
      channelSessionId: sessao.channelSessionId,
      conexaoId: ciclo.conexaoId,
      cicloNovo: ciclo.cicloNovo,
      phoneNumber,
      displayName: sessao.displayName,
      webhookRegistrado: Boolean(webhook?.registrado),
      pedidoEmitido,
      qrDesligados,
    };
  } catch (err) {
    logger.error("[meta.coexistencia] conexão pelo app falhou", {
      request_id: entrada.requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, motivo: "falha" };
  }
}

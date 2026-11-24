import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/official — estado da conexão oficial + o que colar na Meta.
 * POST /api/v1/channels/official — VALIDA a credencial e só então grava.
 *
 * O `POST` valida contra a Graph API **antes** de persistir. Gravar primeiro e
 * descobrir depois é o que faz o operador achar que conectou e só entender que não na
 * primeira mensagem que não sai — com o lead do outro lado esperando.
 *
 * O `POST` é também o caminho de VOLTA: conectar por cima de um canal oficial que
 * foi excluído RESSUSCITA a linha (`lib/channels/reactivate.ts`). Sem isso o
 * update devolvia status/credencial/número e deixava `archived_at` no lugar — e o
 * canal "conectado" ficava invisível para o webhook, para o ingest, para os
 * seletores e para o envio, todos filtrados por essa coluna.
 *
 * Ressuscitar NÃO devolve a URL de webhook antiga: a exclusão rotacionou o
 * `webhook_path_token` de propósito (é o que corta a entrega da plataforma), e a
 * volta mantém a nova. É por isso que a tela mostra o que colar na Meta depois de
 * conectar — inclusive na reconexão, onde o endereço mudou.
 *
 * O token é cifrado pelas MESMAS RPCs do resto do repo (`lib/webhooks/secrets.ts`) e
 * **nunca volta** num GET: uma vez gravado, a tela mostra que existe, não qual é.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { metaPodeReceber } from "@/lib/channels/meta/webhook";
import { appDaMeta, appDaMetaDoAmbiente, embeddedSignupDaInstalacao, fontesDoAppDaMeta } from "@/lib/channels/meta/app";
import { metaGraphBase } from "@/lib/channels/meta/credentials";
import { graphBaseUrl } from "@/lib/channels/meta/graph-base";
import { gravarCanalOficial } from "@/lib/channels/meta/gravar-canal-oficial";
import { ORIGEM_DO_TOKEN_MANUAL, lerOrigemDaConexao } from "@/lib/channels/meta/origem-da-conexao";
import { COLUNAS_DO_DESFECHO_DO_WEBHOOK } from "@/lib/channels/meta/webhook-da-sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { basePublicaDoWebhookMeta } from "@/lib/webhooks/url-publica";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const conectarSchema = z.object({
  phone_number_id: z.string().min(5),
  waba_id: z.string().min(5),
  token: z.string().min(20),
});

interface DesfechoGravado {
  meta_webhook_override_uri: string | null;
  meta_webhook_override_erro: string | null;
  meta_webhook_override_em: string | null;
}

/**
 * O desfecho do registro do webhook desta sessão, lido em consulta PRÓPRIA.
 *
 * Separado do select principal de propósito: as três colunas chegam na migration
 * 0311, e num banco sem ela o select inteiro voltaria 42703 — a tela perderia o
 * canal (conectado, número, URL) por causa de um EXTRA. Aqui a ausência só significa
 * "estado do registro indisponível".
 */
async function lerDesfechoDoWebhook(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  channelSessionId: string,
): Promise<DesfechoGravado | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS_DO_DESFECHO_DO_WEBHOOK)
    .eq("organization_id", orgId)
    .eq("id", channelSessionId)
    .maybeSingle();
  if (error) return null;
  return data as DesfechoGravado | null;
}

/**
 * O token de verificação que esta tela pode MOSTRAR — e de onde vem o que vale.
 *
 * Isto lia `process.env.META_WEBHOOK_VERIFY_TOKEN` direto, e a migration 0257
 * tornou a leitura errada nos dois sentidos: com o App da Meta cadastrado pela
 * tela de administração, o handshake passa a conferir o token do BANCO, e esta
 * rota seguia mostrando o do `.env` (que a Meta recusaria) ou, sem `.env`,
 * "defina no servidor" para quem já tinha configurado tudo.
 *
 * O valor do banco NÃO é devolvido: ele é mostrado uma vez, na resposta da
 * action que o gera (`app/actions/settings/updateMetaApp.ts`), e aqui quem
 * responde é o admin de UM tenant, não quem administra a instalação. O do `.env`
 * continua sendo mostrado, como sempre foi — é o mesmo valor, na mesma rota.
 *
 * Por que "o que vale é igual ao do `.env`" basta para rotular a origem como
 * `ambiente`: o token em vigor (`lib/channels/meta/app.ts`) é OU o do banco OU o
 * do `.env` — o do banco só vale com o par inteiro decifrado; fora disso vale o
 * que o `.env` tiver, até pela metade. Então a igualdade só engana num caso: o
 * token do banco coincidir com o do `.env`. E o do banco ninguém escolhe — é
 * gerado pelo servidor com 32 bytes aleatórios —, então coincidir exige alguém
 * ter COPIADO o token gerado para o `.env`. Nesse caso o rótulo erra a origem,
 * mas o valor exibido é o mesmo que já está no `.env`, que esta rota sempre
 * mostrou: não sai nada que antes não saía.
 */
async function tokenDeVerificacaoParaATela(): Promise<{
  verifyToken: string | null;
  verifyTokenOrigem: "ambiente" | "instalacao" | null;
}> {
  const { verifyToken: emVigor } = await appDaMeta();
  if (!emVigor) return { verifyToken: null, verifyTokenOrigem: null };
  if (emVigor === appDaMetaDoAmbiente().verifyToken) {
    return { verifyToken: emVigor, verifyTokenOrigem: "ambiente" };
  }
  return { verifyToken: null, verifyTokenOrigem: "instalacao" };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  // Canal ARQUIVADO não conta como conectado. A linha sobrevive à exclusão como
  // âncora das FKs, e sem este filtro a tela dizia "conectado" (com a URL de
  // webhook já rotacionada, portanto morta) para um canal que o operador acabou
  // de excluir — e oferecia "Trocar credencial" onde deveria oferecer "Conectar".
  // O POST, ao contrário, PRECISA enxergar a linha arquivada: é ela que ele
  // ressuscita.
  const consultar = () =>
    admin
      .from("channel_sessions")
      .select("id, meta_phone_number_id, meta_waba_id, meta_token_encrypted, phone_number, display_name, webhook_path_token, status")
      .eq("organization_id", orgId)
      .eq("provider", CHANNEL_PROVIDER_META);
  const { data } = await queryTolerantToMissingArchived(
    () => consultar().is(ARCHIVED_AT, null).maybeSingle(),
    () => consultar().maybeSingle(),
  );

  // `basePublicaDoWebhookMeta` e não `basePublicaDaInstalacao`: desde a v1.60 o
  // upstream separou a base do callback da Meta (`META_WEBHOOK_BASE_URL`, #1426), e
  // sem a variável ela cai na base da instalação — a mesma URL de antes. A escolha
  // tem que ser a MESMA do POST lá embaixo, que registra o override com ela: a tela
  // mostrando uma URL e o registro apontando outra é o "duas telas, dois webhooks"
  // que o módulo `url-publica` existe para impedir.
  const base = basePublicaDoWebhookMeta(req);
  const desfecho = data?.id ? await lerDesfechoDoWebhook(admin, orgId, data.id) : null;
  // O par em vigor (banco da 0257 primeiro, `.env` como piso) com os NOMES das
  // variáveis de ambiente — é o que `metaPodeReceber` sabe ler. Ver `podeReceber`
  // no corpo da resposta.
  const fontesDoApp = await fontesDoAppDaMeta();

  /**
   * A PORTA DO LOGIN, quando a plataforma tiver configurado uma.
   *
   * Nulo = a tela mostra só o caminho manual. Ausência ESCONDE a porta; ela
   * nunca mostra uma porta que não abre — um botão "Conectar com o Facebook"
   * que leva a lugar nenhum custa mais confiança do que a sua falta.
   *
   * Leitura com service role porque `platform_meta` é configuração da
   * instalação e não tem policy para tenant: o link em si não é segredo (ele
   * vai para o cliente), mas quem o DEFINE é quem opera a plataforma.
   */
  let linkDoCadastro: string | null = null;
  try {
    const { data: conf } = await admin
      .from("platform_meta")
      .select("embedded_signup_url")
      .eq("id", 1)
      .maybeSingle();
    linkDoCadastro = (conf as { embedded_signup_url?: string | null } | null)?.embedded_signup_url ?? null;
  } catch {
    // Migration ainda não aplicada, leitura fora do ar: a tela cai para a porta
    // manual, que é o comportamento de sempre. Nunca derruba a tela inteira.
    linkDoCadastro = null;
  }

  // Em consulta PRÓPRIA, pelo mesmo motivo do desfecho: um banco anterior à 9328
  // recusaria o select inteiro ao ver a coluna da origem.
  const origem = data?.id
    ? await lerOrigemDaConexao(admin, { organizationId: orgId, channelSessionId: data.id })
    : null;
  const embedded = await embeddedSignupDaInstalacao();
  return ok({
    /**
     * A janela da Meta (Embedded Signup, #4074) — `null` quando a instalação não
     * cadastrou App ID, Configuration ID e App Secret em `/admin/meta`. Os dois
     * IDs não são segredo: vão ao `FB.init`/`FB.login` no navegador.
     */
    embeddedSignup: embedded
      ? {
          appId: embedded.appId,
          configId: embedded.configId,
          graphVersion: graphBaseUrl().split("/").pop() ?? "",
        }
      : null,
    connected: Boolean(data),
    embedded_signup_url: linkDoCadastro,
    channel_session_id: data?.id ?? null,
    // `hasToken` em vez do token: uma vez gravado, a tela mostra que EXISTE, nunca
    // qual é. Devolver o segredo para preencher o campo seria vazá-lo a cada render.
    hasToken: Boolean(data?.meta_token_encrypted),
    /**
     * DE ONDE veio esta conexão (#4074): `embedded_signup` ou `token_manual`.
     * `null` = coluna ausente (banco anterior à 9328) ou valor desconhecido —
     * a tela não rotula o que ninguém registrou. `inferida` marca as linhas
     * anteriores à coluna, que só podiam ter nascido do formulário.
     */
    origem: origem?.ok
      ? { valor: origem.origem, rotulo: origem.rotulo, inferida: origem.inferida }
      : null,
    phoneNumberId: data?.meta_phone_number_id ?? null,
    wabaId: data?.meta_waba_id ?? null,
    /** Base pública da Graph API — para o operador reaproveitar em outro sistema. */
    endpoint: data ? metaGraphBase() : null,
    displayName: data?.display_name ?? null,
    phoneNumber: data?.phone_number ?? null,
    status: data?.status ?? null,
    /**
     * A instalação consegue RECEBER? — a pergunta que ninguém fazia aqui.
     *
     * `metaPodeReceber` existia, com o modo de falha inteiro escrito no
     * comentário dela, e só era consultada no ONBOARDING. Quem conecta um
     * número meses depois — que é o caso normal, e o de quem troca de número —
     * nunca via o aviso. O sintoma é o pior possível: o canal conecta, a tela
     * diz "conectado", o número ENVIA, e nada volta. Sem erro em lugar nenhum,
     * porque cada POST da Meta morre em 401 antes de virar linha.
     *
     * Os NOMES das variáveis ausentes vão no corpo; os valores, nunca.
     *
     * ⚠️ A pergunta é feita a `fontesDoAppDaMeta()` e NÃO a `process.env`. Depois
     * da 0257 o par em vigor pode vir do BANCO (cadastrado em /admin/meta), e
     * perguntar ao ambiente diria "não dá para receber" — com os nomes de duas
     * variáveis para editar na VPS — a quem acabou de configurar tudo pela tela.
     * Um aviso vermelho falso sobre algo que funciona é pior que aviso nenhum:
     * ele manda o operador desfazer o que estava certo.
     */
    podeReceber: metaPodeReceber(fontesDoApp),
    faltaNoAmbiente: (["META_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET"] as const).filter(
      (nome) => (fontesDoApp[nome] ?? "").trim() === "",
    ),
    /** O que o operador precisa colar do NOSSO lado no dashboard da Meta. */
    webhook: data
      ? {
          callbackUrl: `${base}/api/v1/webhooks/meta/${data.webhook_path_token}`,
          ...(await tokenDeVerificacaoParaATela()),
          // A porta para quem PODE abrir a tela da instalação — mesma regra do
          // link de `/admin/google` na Agenda. Para o admin de um tenant qualquer
          // o link seria um 404; a tela diz a ele quem procurar.
          configurarEm: authz.user.is_platform_admin && !authz.user.support ? "/admin/meta" : null,
          // `smb_message_echoes`: o que a empresa manda pelo app WhatsApp Business
          // num número em coexistência. Sem coexistência a Meta não o envia, então
          // assinar é inofensivo para quem não usa.
          // `smb_app_state_sync`: o que a empresa faz no ENDEREÇO do app (contato
          // criado/editado), que vira cadastro no CRM. Mesma régua: sem
          // coexistência a Meta não envia.
          fields: [
            "messages",
            "message_template_status_update",
            "smb_message_echoes",
            "smb_app_state_sync",
          ],
        }
      : null,
    /**
     * E o que a instalação já fez SOZINHA (fatia F1): o webhook deste número está
     * registrado na Meta ou ainda não? `registrado: false` com `erro` é estado
     * esperado e não falha da conexão — o canal ENVIA normalmente; o que depende
     * disto é a ENTREGA. A tela mostra o motivo e oferece tentar de novo.
     */
    webhookRegistro: data
      ? {
          registrado:
            Boolean(desfecho?.meta_webhook_override_uri) && !desfecho?.meta_webhook_override_erro,
          url: desfecho?.meta_webhook_override_uri ?? null,
          erro: desfecho?.meta_webhook_override_erro ?? null,
          em: desfecho?.meta_webhook_override_em ?? null,
        }
      : null,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;

  const parsed = conectarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", t("phone_number_id, waba_id e token são obrigatórios"), 422, {
      requestId,
    });
  }
  const { phone_number_id, waba_id, token } = parsed.data;

  // Validar, cifrar, criar ou ressuscitar a linha, registrar a origem e apontar
  // o webhook do número: o mesmo caminho do Embedded Signup (#4074), num lugar só.
  // A origem é constante de código — nunca lida do corpo do request.
  return gravarCanalOficial({
    req,
    requestId,
    orgId,
    userId,
    idioma: authz.user.idioma,
    phoneNumberId: phone_number_id,
    wabaId: waba_id,
    token,
    origem: ORIGEM_DO_TOKEN_MANUAL,
  });
}

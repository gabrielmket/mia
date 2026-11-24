/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md).
 *
 * GET  /api/v1/channels/official/coexistencia — a chave da empresa, se a
 *      janela da Meta pode abrir nesta instalação, e o número conectado pelo
 *      app com o estado da sincronização (só contagens).
 * POST /api/v1/channels/official/coexistencia
 *      { acao: "abrir" }    → o nonce da janela (10 min, preso a empresa e pessoa)
 *      { acao: "concluir", nonce, code, waba_id, phone_number_id? }
 *                           → conecta o número NA EMPRESA DA SESSÃO
 *                             (`lib/channels/meta/coexistencia/conectar.ts`)
 *
 * Rota à parte de propósito: não mexe em `channels/official/route.ts` (a porta
 * manual do upstream) nem no `useOfficialChannel.ts`. A empresa vem da sessão,
 * nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { conectarPeloApp, type RecusaDaConexao } from "@/lib/channels/meta/coexistencia/conectar";
import { configuracaoDaJanela, emitirNonceDaJanela, nonceDaJanelaConfere } from "@/lib/channels/meta/coexistencia/janela";
import { estadoDaCoexistencia } from "@/lib/channels/meta/coexistencia/leitura";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { basePublicaDoWebhookMeta } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pedidoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("abrir") }),
  z.object({
    acao: z.literal("concluir"),
    nonce: z.string().min(20).max(800),
    code: z.string().min(4).max(2000),
    waba_id: z.string().regex(/^\d{5,30}$/),
    phone_number_id: z.string().regex(/^\d{5,30}$/).nullable().optional(),
  }),
]);

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  try {
    const estado = await estadoDaCoexistencia(admin, orgId);
    // A tela mostra o número do canal oficial DESTA empresa: o ciclo dele, se houver.
    const consultar = () =>
      admin.from("channel_sessions").select("id").eq("organization_id", orgId).eq("provider", CHANNEL_PROVIDER_META);
    const { data: sessao } = await queryTolerantToMissingArchived(
      () => consultar().is(ARCHIVED_AT, null).maybeSingle(),
      () => consultar().maybeSingle(),
    );
    const sessaoId = (sessao as { id?: string } | null)?.id ?? null;
    const numero = sessaoId ? (estado.numeros.find((n) => n.channelSessionId === sessaoId) ?? null) : null;
    const janela = configuracaoDaJanela();
    const { data: org } = await admin.from("organizations").select("display_name").eq("id", orgId).maybeSingle();
    return ok(
      {
        empresa: (org as { display_name?: string | null } | null)?.display_name ?? null,
        ligada: estado.chave.ligada,
        janela: janela.ok
          ? { pronta: true, appId: janela.appId, configId: janela.configId, graphVersion: janela.graphVersion, faltaNoAmbiente: [] }
          : { pronta: false, appId: null, configId: null, graphVersion: null, faltaNoAmbiente: janela.faltaNoAmbiente },
        numero,
      },
      { requestId },
    );
  } catch (err) {
    logger.error("[coexistencia] estado não lido", {
      request_id: requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "coexistencia_indisponivel", 500, { requestId });
  }
}

/** O que a tela mostra para cada recusa. Um literal por ramo: a cerca de i18n lê o que está escrito. */
function mensagemDaRecusa(motivo: RecusaDaConexao, t: (texto: string) => string): { status: number; mensagem: string } {
  switch (motivo) {
    case "chave_desligada":
      return { status: 403, mensagem: t("Esta opção ainda não está liberada para a sua empresa. Fale com o suporte da MIA.") };
    case "sem_app_da_meta":
      return { status: 422, mensagem: t("A instalação ainda não tem o app da Meta configurado para esta conexão. Fale com o suporte da MIA.") };
    case "codigo_recusado":
      return { status: 422, mensagem: t("A Meta não confirmou a conexão. Abra a janela de novo e vá até o fim.") };
    case "sem_numero":
      return { status: 422, mensagem: t("A Meta não informou o número desta conta. Tente de novo; se continuar, fale com o suporte da MIA.") };
    case "varios_numeros":
      return { status: 422, mensagem: t("A conta escolhida tem mais de um número. Fale com o suporte da MIA para conectar o número certo.") };
    case "numero_recusado":
      return { status: 422, mensagem: t("A Meta não confirmou que este número pertence à conta escolhida.") };
    case "numero_de_outra_empresa":
      return { status: 409, mensagem: t("Este número já está conectado a outra empresa nesta instalação.") };
    case "outro_numero_conectado":
      return { status: 409, mensagem: t("A empresa já tem outro número no canal oficial. Exclua aquele canal em Conexões antes de conectar este.") };
    case "sem_cifra":
      return { status: 422, mensagem: t("Esta instalação não consegue guardar a credencial cifrada. Fale com o suporte da MIA.") };
    case "limite_do_plano":
    case "falha":
      return { status: 500, mensagem: t("Não foi possível concluir a conexão. Tente de novo em alguns minutos.") };
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;

  const pedido = pedidoSchema.safeParse(await req.json().catch(() => null));
  if (!pedido.success) return fail("invalid_request", t("Pedido inválido."), 422, { requestId });
  const admin = createAdminClient();

  if (pedido.data.acao === "abrir") {
    // A janela só abre para quem pode concluir: chave ligada e app configurado.
    const estado = await estadoDaCoexistencia(admin, orgId).catch(() => null);
    if (!estado) return fail("internal_error", "coexistencia_indisponivel", 500, { requestId });
    if (!estado.chave.ligada) {
      const r = mensagemDaRecusa("chave_desligada", t);
      return fail("forbidden", r.mensagem, r.status, { requestId });
    }
    if (!configuracaoDaJanela().ok) {
      const r = mensagemDaRecusa("sem_app_da_meta", t);
      return fail("invalid_request", r.mensagem, r.status, { requestId });
    }
    const nonce = emitirNonceDaJanela({ organizationId: orgId, userId }, { segredo: env.INTERNAL_SECRET, agora: new Date() });
    return ok({ nonce }, { requestId });
  }

  const { nonce, code, waba_id, phone_number_id } = pedido.data;
  if (!nonceDaJanelaConfere(nonce, { organizationId: orgId, userId }, { segredo: env.INTERNAL_SECRET, agora: new Date() })) {
    return fail("invalid_request", t("A janela da Meta expirou ou foi aberta em outra empresa. Abra de novo."), 422, { requestId });
  }

  const desfecho = await conectarPeloApp(admin, {
    organizationId: orgId,
    userId,
    code,
    wabaId: waba_id,
    phoneNumberId: phone_number_id ?? null,
    baseDoWebhook: basePublicaDoWebhookMeta(req),
    requestId,
  });
  if (!desfecho.ok) {
    // O canal acima do plano: o gatilho de canais recusa (spec cobrança §5).
    const limite = desfecho.erroDoBanco ? traduzirLimiteDoPlano(desfecho.erroDoBanco, authz.user.idioma) : null;
    if (limite) return fail(limite.code, limite.message, 409, { requestId, details: limite.details });
    const r = mensagemDaRecusa(desfecho.motivo, t);
    return fail(r.status === 403 ? "forbidden" : r.status === 409 ? "conflict" : r.status === 500 ? "internal_error" : "invalid_request", r.mensagem, r.status, {
      requestId,
      details: { motivo: desfecho.motivo },
    });
  }
  return ok(
    {
      connected: true,
      channel_session_id: desfecho.channelSessionId,
      conexao_id: desfecho.conexaoId,
      ciclo_novo: desfecho.cicloNovo,
      displayName: desfecho.displayName,
      phoneNumber: desfecho.phoneNumber,
      webhook_registrado: desfecho.webhookRegistrado,
      pedido_emitido: desfecho.pedidoEmitido,
      qr_desligados: desfecho.qrDesligados,
    },
    { requestId },
  );
}

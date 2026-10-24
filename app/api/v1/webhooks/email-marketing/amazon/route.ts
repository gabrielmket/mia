/**
 * FORK MIA (.89) — POST /api/v1/webhooks/email-marketing/amazon: os avisos da
 * Amazon SES (entrega, rejeição, reclamação), entregues pelo tópico do SNS.
 *
 * Rota pública (`/api/v1/webhooks/` é público no proxy): quem chama pode ser
 * qualquer um, e por isso nada é aceito sem a assinatura do SNS conferida, o
 * tópico da plataforma (`AWS_SES_SNS_TOPIC_ARN`) e um aviso recente
 * (`lib/email-marketing/avisos-da-amazon.ts`). Assinatura inválida recebe 403 e
 * não muda nada.
 *
 * A confirmação da inscrição do tópico (`SubscriptionConfirmation`) também
 * chega aqui: assinada e do tópico certo, a rota visita o endereço de
 * confirmação, que só pode ser do SNS.
 */
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { configuracaoDaAmazon } from "@/lib/email/ses";
import {
  conferirAviso,
  enderecoDeConfirmacaoValido,
  lerEventoDaSes,
  lerMensagemDoSns,
} from "@/lib/email-marketing/avisos-da-amazon";
import { aplicarAviso } from "@/lib/email-marketing/eventos";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** O SNS manda `text/plain` com JSON dentro; o corpo nunca passa disto. */
const TAMANHO_MAXIMO = 256 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  if (await authRateLimited("email_marketing_avisos", null, { ip: 600, windowSec: 60 })) {
    return fail("rate_limited", "Muitos avisos.", 429);
  }
  const bruto = await req.text();
  if (bruto.length > TAMANHO_MAXIMO) return fail("payload_too_large", "Aviso grande demais.", 413);
  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return fail("validation_failed", "Aviso ilegível.", 400);
  }
  const mensagem = lerMensagemDoSns(corpo);
  if (!mensagem) return fail("validation_failed", "Não é um aviso do SNS.", 400);

  const recusa = await conferirAviso(mensagem, {
    topicoEsperado: configuracaoDaAmazon().topicoDosAvisos,
  });
  if (recusa) {
    // A recusa não diz qual das provas falhou além do código: quem forja não
    // aprende nada que já não soubesse.
    logger.warn("[email-marketing] aviso recusado", {
      motivo: recusa,
      topico: mensagem.TopicArn.slice(0, 120),
    });
    void audit({
      action: "webhook.hmac_invalid",
      resourceType: "email_marketing_amazon",
      metadata: { motivo: recusa },
    });
    return fail(
      "forbidden",
      "Aviso não conferido.",
      recusa === "sem_topico_configurado" ? 503 : 403,
    );
  }

  if (mensagem.Type === "SubscriptionConfirmation" || mensagem.Type === "UnsubscribeConfirmation") {
    if (
      mensagem.Type === "SubscriptionConfirmation" &&
      mensagem.SubscribeURL &&
      enderecoDeConfirmacaoValido(mensagem.SubscribeURL)
    ) {
      try {
        const r = await fetch(mensagem.SubscribeURL, {
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        logger.info("[email-marketing] inscrição do tópico confirmada", { status: r.status });
      } catch (err) {
        logger.error("[email-marketing] não confirmei a inscrição do tópico", {
          error: err instanceof Error ? err.message : String(err),
        });
        return fail("upstream_failed", "Não confirmei a inscrição.", 502);
      }
    }
    return ok({ confirmado: mensagem.Type === "SubscriptionConfirmation" });
  }

  const evento = lerEventoDaSes(mensagem.Message);
  if (!evento) return ok({ ignorado: true });
  try {
    const desfecho = await aplicarAviso(createAdminClient(), evento, mensagem.MessageId);
    return ok({ desfecho });
  } catch (err) {
    logger.error("[email-marketing] aviso não aplicado", {
      error: err instanceof Error ? err.message : String(err),
    });
    // 500 faz o SNS tentar de novo: o aviso é idempotente pelo id.
    return fail("internal_error", "Aviso não aplicado.", 500);
  }
}

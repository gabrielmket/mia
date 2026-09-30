/**
 * FORK MIA (.62) — GET|POST /api/v1/webhooks/leads-da-meta: o aviso em tempo
 * real dos formulários de cadastro da Meta (webhook da PÁGINA, campo `leadgen`).
 *
 * É a URL que se cadastra no painel do app da Meta, em Webhooks › Página
 * (docs/fork/leads-da-meta.md, "O que o Gabriel faz na Meta"). O app é o MESMO
 * do WhatsApp (`platform_meta_app`, migration 0257): mesmo App Secret, mesmo
 * token de verificação, e as duas conferências são as do canal oficial
 * (`lib/channels/meta/webhook.ts`), reaproveitadas, não copiadas.
 *
 * `GET` é o handshake: devolve `hub.challenge` em TEXTO PURO, sem o envelope da
 * API (o motivo está no cabeçalho de `app/api/v1/webhooks/meta/[token]`).
 *
 * `POST` confere o HMAC SHA-256 do corpo cru com o App Secret ANTES de ler
 * qualquer coisa. Sem token no caminho: o aviso é da Página, e quem diz de qual
 * empresa ela é está no nosso banco (`mia_paginas_da_meta`), nunca no corpo.
 * Cada aviso vai a `receberAvisoDeLead` (`lib/leads-da-meta/tempo-real.ts`),
 * que grava pela MESMA via da leitura de 5 em 5 minutos.
 *
 * 200 SEMPRE que a assinatura confere: a Meta reentrega em backoff tudo que não
 * recebe 2xx, e a leitura periódica já é a rede de segurança do aviso que falhar
 * aqui. `outcomes` no corpo diz o que aconteceu com cada aviso.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { appDaMeta } from "@/lib/channels/meta/app";
import { verificationChallenge, verifyMetaSignature } from "@/lib/channels/meta/webhook";
import { avisosDoCorpo, receberAvisoDeLead } from "@/lib/leads-da-meta/tempo-real";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Avisos por entrega. A Meta manda um ou poucos por vez; o teto só impede que
 * um corpo anormal prenda a rota por minutos. O que passar do teto a leitura
 * periódica busca.
 */
const AVISOS_POR_ENTREGA = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Do BANCO (platform_meta_app), com o `.env` como piso: o mesmo token de
  // verificação do webhook do WhatsApp. Nunca lança (`lib/channels/meta/app.ts`).
  const { verifyToken } = await appDaMeta();
  const challenge = verificationChallenge(req.nextUrl.searchParams, verifyToken ?? "");
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const rawBody = await req.text();

  const { appSecret } = await appDaMeta();
  const assinatura = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, assinatura, appSecret ?? "")) {
    // A recusa deixa rastro: sem esta linha, um app com o segredo errado (token
    // gerado para OUTRO app, por exemplo) seria silêncio puro.
    logger.warn("[leads-da-meta.webhook] assinatura recusada", {
      request_id: requestId,
      tem_assinatura: Boolean(assinatura),
      tem_segredo: Boolean(appSecret),
    });
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(rawBody);
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const avisos = avisosDoCorpo(corpo);
  const admin = createAdminClient();
  const desfechos: string[] = [];
  for (const aviso of avisos.slice(0, AVISOS_POR_ENTREGA)) {
    try {
      desfechos.push(await receberAvisoDeLead(admin, aviso, { requestId }));
    } catch (erro) {
      // Banco fora, rede: a leitura periódica relê o formulário e grava o lead.
      logger.error("[leads-da-meta.webhook] aviso não processado", {
        request_id: requestId,
        detalhe: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
      });
      desfechos.push("falhou");
    }
  }
  if (avisos.length > AVISOS_POR_ENTREGA) desfechos.push("excedente_fica_para_a_leitura");

  return NextResponse.json({ received: avisos.length, outcomes: desfechos }, { status: 200 });
}

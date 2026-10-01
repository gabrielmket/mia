/**
 * POST /api/v1/agenda/microsoft/notificacoes: as notificações de mudança da Graph.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 4.5). Duas conversas chegam aqui:
 *
 *  - **validação**: ao criar a assinatura, a Graph chama com `?validationToken=`
 *    e espera a MESMA string, em `text/plain`, em até 10 s. A resposta é só isso
 *    (sem HTML, com `nosniff`), e o tamanho é limitado;
 *  - **notificação**: um lote `{ value: [...] }`. Cada item é conferido pelo
 *    `clientState` da assinatura (guardado como hash) e só marca o calendário
 *    para ler AGORA. Responde 202 sempre que o corpo é legível: responder erro
 *    faria a Graph insistir, e o que não confere já foi descartado.
 *
 * Pública (sem sessão): quem chama é o servidor da Microsoft. A prova é o
 * segredo de cada assinatura, não o endereço.
 */

import { NextResponse, type NextRequest } from "next/server";

import { receberNotificacoes } from "@/lib/agenda/microsoft/notificacoes";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TAMANHO_MAXIMO_DO_CORPO = 512 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const validacao = new URL(req.url).searchParams.get("validationToken");
  if (validacao !== null) {
    if (validacao.length > 2048) return new Response("", { status: 400 });
    return new Response(validacao, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }

  const tamanho = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(tamanho) && tamanho > TAMANHO_MAXIMO_DO_CORPO) {
    return NextResponse.json({ error: { code: "payload_too_large" } }, { status: 413 });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "validation_failed" } }, { status: 400 });
  }

  try {
    const resumo = await receberNotificacoes(createAdminClient(), corpo);
    if (resumo.descartadas > 0) {
      logger.info("[agenda.microsoft.notificacoes] notificações descartadas", {
        aceitas: resumo.aceitas,
        descartadas: resumo.descartadas,
      });
    }
  } catch (e) {
    // A consulta periódica é a rede de segurança: perder o aviso atrasa, não perde.
    logger.warn("[agenda.microsoft.notificacoes] falha ao registrar", {
      erro: e instanceof Error ? e.message : String(e),
    });
  }
  return new Response(null, { status: 202 });
}

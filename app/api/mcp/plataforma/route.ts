/**
 * O endpoint MCP de PLATAFORMA (item E6).
 *
 * ── Por que uma ROTA separada, e não um escopo na de sempre ───────────────
 *
 * `/api/mcp` autentica contra `api_tokens`, que tem `organization_id` não
 * nulo: todo token de lá pertence a UM cliente, e é isso que limita o estrago
 * quando um vaza. Um token de plataforma não pertence a cliente nenhum.
 *
 * Se as duas famílias entrassem pela mesma porta, a linha que decide o que um
 * token pode fazer viraria um `if` no meio do caminho — e o dia em que alguém
 * escrevesse o `if` errado seria o dia em que um token de cliente administra a
 * plataforma. Portas separadas tornam esse erro impossível de escrever, em vez
 * de improvável.
 *
 * O formato do bearer também separa (`dskp_` contra `dsk_`), então o token
 * colado na porta errada é recusado pela FORMA, com uma mensagem que diz qual
 * é a porta certa — antes de qualquer consulta ao banco.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { ErroDeAutenticacao, validarTokenDePlataforma } from "@/lib/mcp-plataforma/auth";
import { criarServidorDePlataforma } from "@/lib/mcp-plataforma/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function erroJsonRpc(code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function atender(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  let token;
  try {
    token = await validarTokenDePlataforma(req.headers.get("authorization"));
  } catch (err) {
    if (err instanceof ErroDeAutenticacao) {
      return erroJsonRpc(err.mcpCode, err.message, err.httpStatus);
    }
    return erroJsonRpc(-32603, err instanceof Error ? err.message : "auth_failed", 500);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({});
  const server = criarServidorDePlataforma(token, requestId);

  try {
    await server.connect(transport);
    const resposta = await transport.handleRequest(req as unknown as Request);
    resposta.headers.set("X-Request-Id", requestId);
    return resposta;
  } catch (err) {
    return erroJsonRpc(-32603, err instanceof Error ? err.message : "transport_error", 500);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return atender(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return atender(req);
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return atender(req);
}

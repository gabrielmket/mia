/**
 * Autenticação do MCP de PLATAFORMA (item E6).
 *
 * Espelha `lib/mcp/auth.ts` de propósito — mesmo formato de bearer, mesmo
 * SHA-256, mesma ausência de plaintext em log — e difere no que importa:
 *
 *   `lib/mcp/auth.ts`       devolve organização + papel; o erro fica num cliente
 *   este arquivo            não tem organização; o erro alcança todos
 *
 * Por isso o prefixo do token é OUTRO (`dskp_`, de plataforma). Não é
 * cosmético: um token de plataforma colado por engano no campo de token de
 * cliente é recusado pelo formato, antes de qualquer consulta — e vice-versa.
 * Com o mesmo prefixo, os dois seriam procurados em tabelas diferentes e a
 * mensagem de recusa seria "token não reconhecido", que manda quem configurou
 * procurar no lugar errado.
 */
import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/** O prefixo que separa token de plataforma de token de cliente (`dsk_`). */
export const PREFIXO_DE_PLATAFORMA = "dskp_";

export interface TokenDePlataforma {
  tokenId: string;
  /** A lista branca de escritas. Vazia = só leitura. */
  operacoes: string[];
}

export class ErroDeAutenticacao extends Error {
  constructor(
    public readonly mcpCode: number,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroDeAutenticacao";
  }
}

export function extrairBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m?.[1]?.trim() ?? null;
}

/** O hash como o Postgres quer receber um `bytea` pelo PostgREST. */
export function hashDoToken(plaintext: string): string {
  return `\\x${createHash("sha256").update(plaintext).digest("hex")}`;
}

function listaDeOperacoes(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.filter((o): o is string => typeof o === "string");
}

export async function validarTokenDePlataforma(
  authHeader: string | null,
): Promise<TokenDePlataforma> {
  const plaintext = extrairBearer(authHeader);
  if (!plaintext) {
    throw new ErroDeAutenticacao(-32001, 401, "Falta o cabeçalho Authorization.");
  }
  // A checagem de FORMA vem antes da ida ao banco, e a mensagem diz qual token
  // é o certo: quem colou o de cliente aqui precisa saber disso, não receber
  // "não reconhecido" e ir procurar um token que existe e está correto.
  if (!plaintext.startsWith(PREFIXO_DE_PLATAFORMA)) {
    throw new ErroDeAutenticacao(
      -32001,
      401,
      `Este endpoint aceita token de PLATAFORMA (${PREFIXO_DE_PLATAFORMA}…). ` +
        "Token de organização (dsk_…) fala com /api/v1/mcp.",
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_api_tokens")
    .select("id, operacoes, revoked_at, expires_at")
    .eq("token_hash", hashDoToken(plaintext))
    .maybeSingle();

  if (error) {
    throw new ErroDeAutenticacao(-32603, 500, `Falha ao conferir o token: ${error.message}`);
  }
  if (!data) throw new ErroDeAutenticacao(-32001, 401, "Token não reconhecido.");

  const linha = data as {
    id: string;
    operacoes: unknown;
    revoked_at: string | null;
    expires_at: string | null;
  };

  if (linha.revoked_at) throw new ErroDeAutenticacao(-32001, 401, "Token revogado.");
  if (linha.expires_at && new Date(linha.expires_at) < new Date()) {
    throw new ErroDeAutenticacao(-32001, 401, "Token expirado.");
  }

  // `last_used_at` sem `await`: é rastro, não parte da decisão. Esperar por ele
  // poria uma escrita no caminho quente de TODA chamada, e uma falha dele
  // recusaria um token válido — trocar disponibilidade por telemetria.
  void supabase
    .from("platform_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", linha.id)
    .then(() => undefined);

  return { tokenId: linha.id, operacoes: listaDeOperacoes(linha.operacoes) };
}

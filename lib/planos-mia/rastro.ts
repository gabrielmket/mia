/**
 * FORK MIA (MIA-256) — O RASTRO DE QUEM MEXEU NO PLANO: quem, quando, o antes e o depois.
 *
 * Dois defeitos que este arquivo fecha:
 *
 * 1. O id do token de PLATAFORMA ia em `actor_api_token_id`, que é chave
 *    estrangeira para `api_tokens` (o token de CLIENTE). O insert da auditoria
 *    falhava e o erro só ia ao console: nenhuma linha `planos_mia.*` chegava ao
 *    banco. O id vai em `metadata.token_de_plataforma_id`, e a coluna fica nula
 *    (`autoriaDoToken`). Sem migration: a linha `plataforma.mcp_executado` já faz
 *    assim (`metadata.token_id`).
 * 2. Nenhum caminho guardava o valor anterior. `antesEDepois` compara a linha
 *    lida antes da escrita com a gravada e devolve SÓ os campos que mudaram.
 *
 * Puro: sem banco, sem relógio.
 */

/** Campos de controle: mudam em toda escrita e não dizem o que foi decidido. */
const IGNORADOS = new Set(["id", "plano_id", "created_at", "updated_at", "updated_by"]);

function normal(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) return [...v].map(normal).sort();
  return v;
}

function igual(a: unknown, b: unknown): boolean {
  const x = normal(a);
  const y = normal(b);
  // O PostgREST devolve `bigint` como texto em alguns caminhos: 4990 e "4990" são o mesmo preço.
  if (typeof x === "number" && typeof y === "string" && y.trim() !== "") return x === Number(y);
  if (typeof y === "number" && typeof x === "string" && x.trim() !== "") return y === Number(x);
  return JSON.stringify(x) === JSON.stringify(y);
}

export interface AntesEDepois {
  /** `null` = a linha não existia (criação). */
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown>;
}

/**
 * Os campos que mudaram entre `antes` (a linha lida antes da escrita; `null` na
 * criação) e `depois` (o que foi gravado). Só entram as chaves de `depois`:
 * campo que o pedido não trouxe não aparece. `null` quando nada mudou.
 */
export function antesEDepois(
  antes: Record<string, unknown> | null | undefined,
  depois: Record<string, unknown>,
): AntesEDepois | null {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(depois)) {
    if (IGNORADOS.has(k) || v === undefined) continue;
    const anterior = antes ? antes[k] : undefined;
    if (antes && igual(anterior, v)) continue;
    if (antes) a[k] = anterior === undefined ? null : anterior;
    d[k] = v;
  }
  if (Object.keys(d).length === 0) return null;
  return { antes: antes ? a : null, depois: d };
}

/**
 * Quem agiu pelo token de plataforma, do jeito que a auditoria aceita: a coluna
 * `actor_api_token_id` fica nula (é do token de cliente) e o id vai na metadata.
 * Sem token (o painel): nada.
 */
export function autoriaDoToken(tokenId: string | null | undefined): Record<string, string> {
  return tokenId ? { token_de_plataforma_id: tokenId, via: "mcp_de_plataforma" } : {};
}

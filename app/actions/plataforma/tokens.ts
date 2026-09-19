"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { PREFIXO_DE_PLATAFORMA } from "@/lib/mcp-plataforma/auth";
import { CHAVES_DE_OPERACAO } from "@/lib/mcp-plataforma/operacoes";
import { createAdminClient } from "@/lib/supabase/admin";

export type CriarTokenResult =
  | { ok: true; token: string; id: string }
  | { ok: false; error: string };

export type RevogarTokenResult = { ok: true } | { ok: false; error: string };

/**
 * Emite um token de administração da PLATAFORMA (item E6).
 *
 * ── O plaintext existe UMA vez ────────────────────────────────────────────
 *
 * Só o SHA-256 vai para o banco. A resposta desta action é a única vez que o
 * token completo existe fora da cabeça de quem o guardou — é o mesmo contrato
 * de `api_tokens`, e é o que torna "perdi o token" uma emissão nova em vez de
 * uma consulta.
 *
 * ── Por que `requirePlatformAdmin()` e não um token ───────────────────────
 *
 * Um token de plataforma não pode emitir outro. Se pudesse, o escopo deixaria
 * de ser uma parede: quem tivesse qualquer token emitiria um com todas as
 * operações. A emissão exige sessão de pessoa, com MFA, na tela.
 */
export async function criarTokenDePlataforma(input: {
  name: string;
  reason: string;
  operacoes: string[];
  expiresInDays: number | null;
}): Promise<CriarTokenResult> {
  const { user, platformAdmin } = await requirePlatformAdmin();

  // `support_readonly` administra lendo. Emitir credencial de escrita a partir
  // de um acesso de leitura seria a escada que transforma um no outro.
  if (platformAdmin.scope !== "full") {
    return { ok: false, error: "Seu acesso de suporte não permite emitir tokens." };
  }

  const name = input.name.trim();
  const reason = input.reason.trim();
  if (!name) return { ok: false, error: "Dê um nome ao token." };
  if (!reason) return { ok: false, error: "Escreva por que este token existe." };

  // Operação desconhecida é RECUSA, não filtro silencioso: gravar a lista sem
  // ela faria a tela dizer "criado" e o token não fazer o que quem o criou
  // acha que ele faz.
  const desconhecidas = input.operacoes.filter((o) => !CHAVES_DE_OPERACAO.includes(o));
  if (desconhecidas.length > 0) {
    return { ok: false, error: `Operação desconhecida: ${desconhecidas.join(", ")}` };
  }

  // 32 bytes de aleatório — o mesmo tamanho do segredo dos tokens de tenant.
  const segredo = randomBytes(32).toString("base64url");
  const plaintext = `${PREFIXO_DE_PLATAFORMA}${segredo}`;
  const prefix = plaintext.slice(0, 12);

  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await createAdminClient()
    .from("platform_api_tokens")
    .insert({
      name,
      reason,
      prefix,
      token_hash: `\\x${createHash("sha256").update(plaintext).digest("hex")}`,
      operacoes: input.operacoes,
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "falha ao gravar" };

  const hdrs = await headers();
  void audit({
    action: "plataforma.token_criado",
    actorUserId: user.id,
    actingAsPlatformAdmin: true,
    resourceType: "platform_api_token",
    resourceId: null,
    requestId: hdrs.get("x-request-id"),
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: hdrs.get("user-agent") ?? null,
    metadata: {
      // O NOME e as OPERAÇÕES vão; o prefixo e o segredo não. Quem audita
      // precisa saber o que foi concedido, não como autenticar com aquilo.
      nome: name,
      operacoes: input.operacoes,
      expira_em: expiresAt,
    },
  });

  return { ok: true, token: plaintext, id: (data as { id: string }).id };
}

export async function revogarTokenDePlataforma(input: {
  id: string;
  motivo: string;
}): Promise<RevogarTokenResult> {
  const { user, platformAdmin } = await requirePlatformAdmin();
  if (platformAdmin.scope !== "full") {
    return { ok: false, error: "Seu acesso de suporte não permite revogar tokens." };
  }

  const motivo = input.motivo.trim();
  if (!motivo) return { ok: false, error: "Escreva por que está revogando." };

  const { error } = await createAdminClient()
    .from("platform_api_tokens")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
      revoke_reason: motivo,
    })
    .eq("id", input.id)
    // Só alcança o que ainda está vivo: re-revogar reescreveria a data e o
    // autor da primeira revogação, apagando quando o acesso de fato acabou.
    .is("revoked_at", null);

  if (error) return { ok: false, error: error.message };

  const hdrs = await headers();
  void audit({
    action: "plataforma.token_revogado",
    actorUserId: user.id,
    actingAsPlatformAdmin: true,
    resourceType: "platform_api_token",
    resourceId: null,
    requestId: hdrs.get("x-request-id"),
    metadata: { token_id: input.id, motivo },
  });

  return { ok: true };
}

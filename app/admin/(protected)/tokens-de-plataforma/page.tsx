import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPERACOES } from "@/lib/mcp-plataforma/operacoes";

import { TokensDePlataforma } from "./_client";

export const metadata = { title: "Tokens de plataforma — Admin" };
export const dynamic = "force-dynamic";

/**
 * Onde se emite a credencial que administra a instalação inteira (item E6).
 *
 * ── Por que ela mora em `/admin`, e não em Configurações ──────────────────
 *
 * O token de API que o cliente cria (`/app/settings/api-tokens`) pertence a UM
 * cliente e erra dentro dele. Este não pertence a ninguém e erra em todos. São
 * objetos de naturezas diferentes na mesma frase ("token de API"), e a única
 * coisa que os separa para quem usa é estarem em lugares diferentes.
 *
 * ── `notFound()` e não 403 ────────────────────────────────────────────────
 *
 * Para quem não administra a instalação, esta tela simplesmente não faz parte
 * do produto — a existência dela não é assunto dele. Mesma escolha de
 * `/admin/marca`. O layout de `(protected)` já roda `requirePlatformAdmin()`;
 * este gate fica porque a garantia precisa ser local.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const idioma = normalizarIdioma(usuario.locale);

  const { data } = await createAdminClient()
    .from("platform_api_tokens")
    .select(
      "id, name, prefix, operacoes, reason, created_at, last_used_at, expires_at, revoked_at, revoke_reason",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Tokens de plataforma", idioma)}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          {traduzir(
            "Credenciais que administram a instalação inteira por conversa, pelo MCP. Um token de cliente erra dentro daquele cliente; um destes erra em todos — por isso cada escrita é liberada uma a uma, e um token sem nenhuma marcada só lê.",
            idioma,
          )}
        </p>
      </div>

      <TokensDePlataforma
        tokens={(data ?? []).map((t) => {
          const linha = t as {
            id: string;
            name: string;
            prefix: string;
            operacoes: string[] | null;
            reason: string;
            created_at: string;
            last_used_at: string | null;
            expires_at: string | null;
            revoked_at: string | null;
            revoke_reason: string | null;
          };
          return { ...linha, operacoes: linha.operacoes ?? [] };
        })}
        operacoes={OPERACOES.map((o) => ({ chave: o.chave, rotulo: o.rotulo, raio: o.raio }))}
      />
    </div>
  );
}

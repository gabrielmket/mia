/**
 * GET /api/v1/admin/tenants/[id]/team — quem tem acesso a ESTE cliente.
 *
 * A aba existia na tela de cada tenant, marcada `disabled`. Uma aba que não
 * abre é pior que uma aba ausente: ela promete a informação, e quem precisa
 * dela conclui que o produto tem a resposta em algum lugar que ele não achou.
 *
 * A pergunta que ela responde é de operação, não de curiosidade: quando um
 * cliente diz "ninguém está vendo as conversas", a primeira coisa a conferir é
 * quem de fato tem acesso, com que papel, e se o convite chegou a ser aceito.
 *
 * ⚠️ NÃO devolve nada que identifique além do necessário para essa pergunta:
 * nome, e-mail e papel. É o painel da PLATAFORMA olhando para dentro da conta
 * de um cliente — o mínimo é a régua, não o máximo.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role, accepted_at, revoked_at, created_at")
    .eq("organization_id", id)
    .order("created_at", { ascending: true });
  if (error) return fail("db_error", error.message, 500, { requestId });

  const vinculos = (data ?? []) as Array<{
    user_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }>;

  /**
   * Nome e e-mail vêm do Auth, não de uma tabela nossa: é lá que eles moram, e
   * uma cópia local envelheceria no primeiro cliente que trocasse de e-mail.
   * Uma chamada por pessoa porque o Admin API não tem busca em lote — e a
   * equipe de um tenant tem dezenas, não milhares.
   */
  const pessoas = await Promise.all(
    vinculos.map(async (v) => {
      const { data: u } = await admin.auth.admin.getUserById(v.user_id);
      const meta = (u?.user?.user_metadata ?? {}) as { full_name?: string; name?: string };
      return {
        user_id: v.user_id,
        nome: meta.full_name ?? meta.name ?? null,
        email: u?.user?.email ?? null,
        // "Nunca entrou" é diferente de "entrou há muito tempo", e a primeira
        // explica sozinha o "ninguém está vendo as conversas".
        ultimo_acesso: u?.user?.last_sign_in_at ?? null,
        role: v.role,
        /**
         * Três estados, e a tela precisa dos três separados:
         *  - `revogado`: tinha acesso e perdeu.
         *  - `convidado`: foi chamado e nunca aceitou — o caso mais comum de
         *    "não estou conseguindo entrar".
         *  - `ativo`.
         */
        estado: v.revoked_at ? "revogado" : v.accepted_at ? "ativo" : "convidado",
        desde: v.created_at,
      };
    }),
  );

  return ok({ equipe: pessoas }, { requestId });
}

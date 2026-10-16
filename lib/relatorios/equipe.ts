import "server-only";

/**
 * FORK MIA (item 9) — O NOME de quem é da equipe, para o grupo "Larissa" do
 * relatório por responsável.
 *
 * O CRM guarda o id da pessoa (`owner_user_id`, `carteira_user_id`, quem
 * marcou o compromisso); o nome mora no Auth (`user_metadata.full_name`), que
 * a sessão não lê. Como em `GET /api/v1/team/assignable` (o mínimo: só o
 * nome, sem e-mail), o cliente de serviço lê, DEPOIS de a organização ter sido
 * resolvida de fonte confiável e só para quem é (ou foi) membro DELA: um id de
 * fora da empresa não vira nome.
 *
 * Quem saiu da equipe continua com nome (o trabalho foi dele); sem nome no
 * Auth, a tela escreve "Pessoa fora da equipe".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TETO = 300;

/** Os ids de pessoa que aparecem como chave de grupo ou de série (`ia:` é agente, não pessoa). */
export function idsDePessoa(chaves: Iterable<string | null | undefined>): string[] {
  const vistos = new Set<string>();
  for (const c of chaves) if (c && UUID.test(c)) vistos.add(c.toLowerCase());
  return [...vistos].slice(0, TETO);
}

export async function nomesDaEquipe(
  admin: SupabaseClient,
  organizationId: string,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .in("user_id", ids.slice(0, TETO));
  if (error || !data) return {};
  const membros = (data as Array<{ user_id: string }>).map((m) => m.user_id);
  const pares = await Promise.all(
    membros.map(async (id) => {
      try {
        const { data: r } = await admin.auth.admin.getUserById(id);
        const nome = (r?.user?.user_metadata?.full_name as string | undefined)?.trim();
        return nome ? ([id, nome] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(pares.filter((p): p is readonly [string, string] => p !== null));
}

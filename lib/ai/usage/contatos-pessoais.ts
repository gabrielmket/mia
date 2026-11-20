/**
 * FORK MIA (MIA-78) — OS CONTATOS PESSOAIS QUE O USO DA PLATAFORMA NÃO CONTA.
 *
 * Pessoal não soma (spec 21, caminho 10): a mensagem do contato pessoal
 * (`contacts.is_personal`) entra no banco, mas o uso da plataforma conta
 * operação, e o pessoal saiu dela. A tela geral (`/api/v1/admin/usage`) já
 * tirava essas mensagens; a aba Uso do cliente (`/api/v1/admin/tenants/[id]/usage`)
 * não, e as duas davam números diferentes para o mesmo cliente e o mesmo mês.
 * As duas leem a lista AQUI e aplicam o mesmo filtro (`listaDosPessoais`).
 *
 * ── O teto ─────────────────────────────────────────────────────────────────
 *
 * Os ids vão na URL do PostgREST (`contact_id not in (...)`), e por isso a
 * lista tem teto: 2 páginas de 1000. O `.limit(2000)` de antes nunca trazia
 * 2000 (o PostgREST corta toda resposta em 1000, sem avisar), e passar do teto
 * não era dito. Agora a leitura é paginada e sai `truncado: true` quando a lista
 * passa do teto: as mensagens dos pessoais que ficaram de fora da lista CONTAM,
 * e quem mostra o número tem de dizer.
 *
 * Leitura que falha devolve `erro`: quem chama responde erro, e não conta as
 * mensagens dos pessoais como se a lista estivesse vazia.
 */
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import type { createAdminClient } from "@/lib/supabase/admin";

/** 2 páginas de 1000: o teto que a tela geral já tinha (`limit(2000)`). */
export const PAGINAS_MAXIMAS_DOS_PESSOAIS = 2;

export interface ContatosPessoais {
  ids: string[];
  /** A lista passou do teto: há pessoais fora dela, e as mensagens deles contam. */
  truncado: boolean;
  /** A mensagem do banco, se a leitura falhou. `ids` vem vazio. */
  erro: string | null;
}

export async function lerContatosPessoais(
  admin: ReturnType<typeof createAdminClient>,
  orgIds: readonly string[],
): Promise<ContatosPessoais> {
  if (orgIds.length === 0) return { ids: [], truncado: false, erro: null };
  const leitura = await lerTodasAsPaginas<{ id: string }>(
    (de, ate, pedirContagem) =>
      admin
        .from("contacts")
        .select("id", pedirContagem ? { count: "exact" } : undefined)
        .in("organization_id", [...orgIds])
        .eq("is_personal", true)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_MAXIMAS_DOS_PESSOAIS },
  );
  if (leitura.erro) return { ids: [], truncado: false, erro: leitura.erro };
  return { ids: leitura.linhas.map((c) => c.id), truncado: leitura.truncado, erro: null };
}

/**
 * O valor do `.not("contact_id", "in", …)` que tira os pessoais de `messages`,
 * ou `null` quando não há pessoal (o PostgREST não tem `in.()` vazio, e aí não
 * se filtra). `messages.contact_id` é NOT NULL, então o `not in` não derruba
 * mensagem sem contato.
 */
export function listaDosPessoais(ids: readonly string[]): string | null {
  return ids.length > 0 ? `(${ids.join(",")})` : null;
}

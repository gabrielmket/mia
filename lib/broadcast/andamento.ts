/**
 * FORK MIA — O ANDAMENTO DE CADA DISPARO, contado NO BANCO.
 *
 * ── O defeito que isto fecha ────────────────────────────────────────────────
 *
 * A lista de disparos lia as linhas de `broadcast_recipients` de até 100
 * campanhas de uma vez, com `.limit(200_000)`, e contava por estado no
 * JavaScript. O PostgREST corta toda resposta em 1000 linhas sem avisar: com
 * uma campanha de 3.000 contatos, a tela dizia "1.000 na lista", o custo
 * estimado saía de 1.000, e as campanhas seguintes da lista apareciam com zero,
 * porque as 1000 linhas que vinham eram quase todas da primeira.
 *
 * ── Contar, e não trazer ────────────────────────────────────────────────────
 *
 * Aqui não se traz linha nenhuma: cada número é um `count: "exact", head: true`
 * por campanha e por estado, a mesma forma que o detalhe do disparo já usa
 * (`app/api/v1/broadcasts/[id]/route.ts`, o resumo por estado). A contagem roda
 * no índice `idx_broadcast_recipients_fila (broadcast_id, status)` e não tem
 * teto de linhas para cortar.
 *
 * O `total` é a soma dos seis estados: o CHECK da tabela só aceita esses seis,
 * então a soma é o total, e ele bate com as partes por construção.
 *
 * O custo é em IDAS ao banco: seis por campanha. Vão em levas de campanhas,
 * para a lista de 100 não abrir 600 pedidos ao mesmo tempo.
 *
 * ⚠️ Contagem que falha devolve erro. Zero no lugar de "não consegui contar"
 * faria a tela mostrar um disparo de 3.000 como lista vazia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { contagemDaResposta } from "@/lib/leitura/contagem-da-resposta";

/** Os estados que o CHECK de `broadcast_recipients.status` aceita. */
export const ESTADOS_DO_DESTINATARIO = [
  "pendente",
  "enviada",
  "entregue",
  "lida",
  "falhou",
  "estornada",
] as const;

export type EstadoDoDestinatario = (typeof ESTADOS_DO_DESTINATARIO)[number];

export type Andamento = { total: number } & Partial<Record<EstadoDoDestinatario, number>>;

/** Quantas campanhas são contadas ao mesmo tempo (seis pedidos cada). */
const CAMPANHAS_POR_LEVA = 10;

export type AndamentoLido =
  | { ok: true; porCampanha: Map<string, Andamento> }
  | { ok: false; erro: string };

export async function contarAndamento(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
  idsDasCampanhas: readonly string[],
): Promise<AndamentoLido> {
  const porCampanha = new Map<string, Andamento>();

  for (let i = 0; i < idsDasCampanhas.length; i += CAMPANHAS_POR_LEVA) {
    const leva = idsDasCampanhas.slice(i, i + CAMPANHAS_POR_LEVA);
    const contagens = await Promise.all(
      leva.flatMap((id) =>
        ESTADOS_DO_DESTINATARIO.map(async (estado) => {
          const resposta = await db
            .from("broadcast_recipients")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("broadcast_id", id)
            .eq("status", estado);
          return { id, estado, count: contagemDaResposta(resposta), erro: resposta.error?.message ?? null };
        }),
      ),
    );

    for (const c of contagens) {
      if (c.erro) return { ok: false, erro: c.erro };
      // Sem contagem não é zero: é o servidor sem dizer quantas há.
      if (c.count === null) {
        return { ok: false, erro: "o banco não devolveu a contagem dos destinatários" };
      }
      const atual = porCampanha.get(c.id) ?? { total: 0 };
      // Só o estado que tem alguém entra, como na soma antiga: a tela trata a
      // ausência como zero.
      if (c.count > 0) atual[c.estado] = c.count;
      atual.total += c.count;
      porCampanha.set(c.id, atual);
    }
  }

  return { ok: true, porCampanha };
}

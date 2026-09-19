/**
 * QUEM ENTRA NA LISTA DA CAMPANHA — a pergunta, respondida uma vez só.
 *
 * Duas rotas perguntam isso: a que CRIA a campanha e a que a edita (remontando
 * a lista quando o filtro muda). Enquanto o filtro era só "tags do contato", as
 * duas cópias eram duas linhas idênticas e ninguém reparava. Com a etapa do
 * funil entrando, elas passariam a divergir no primeiro ajuste — e a divergência
 * teria o pior sintoma possível: editar uma campanha segmentada por etapa
 * remontaria a lista IGNORANDO a etapa, em silêncio, e a mensagem sairia para
 * gente que não deveria recebê-la.
 *
 * ─── Tag e etapa respondem coisas diferentes ───────────────────────────────
 *
 * Tag do contato diz QUEM a pessoa é ("VIP", "revenda"). Etapa diz ONDE a
 * negociação dela está ("pediu orçamento", "proposta enviada"). A segunda é a
 * que se quer segmentar numa campanha, e é a que o produto não oferecia — a
 * primeira exige que alguém tenha marcado a tag à mão, o que quase nunca
 * acontece.
 *
 * Os dois se somam como E, não como OU: "VIP" + "pediu orçamento" é uma lista
 * menor que cada um deles. É o que a tela mostra e o que o operador espera; OU
 * produziria uma lista maior a cada filtro acrescentado, que é o oposto do que
 * a palavra "filtrar" promete.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** O que o `peneirar` precisa de cada contato. */
export const COLUNAS_DO_CONTATO = "id, phone_number, display_name, is_blocked, consent";

/** Teto da varredura, igual nas duas rotas. */
const LIMITE = 50_000;

/**
 * Um uuid que não existe. Serve ao caso "etapa escolhida, nenhum negócio aberto
 * nela": sem ele, o `.in()` receberia uma lista VAZIA — que o PostgREST trata
 * como "sem filtro" e devolveria a base inteira. Uma campanha para ninguém
 * viraria uma campanha para todos, que é o defeito mais caro que esta função
 * pode ter.
 */
const NINGUEM = "00000000-0000-0000-0000-000000000000";

export interface FiltroDaLista {
  tags: string[];
  etapas: string[];
}

export type ResultadoDaLista =
  | { ok: true; contatos: unknown[] }
  | { ok: false; erro: string };

export async function quemEntraNaLista(
  db: SupabaseClient,
  organizationId: string,
  filtro: FiltroDaLista,
): Promise<ResultadoDaLista> {
  let contatosDasEtapas: string[] | null = null;

  if (filtro.etapas.length > 0) {
    /**
     * `status = 'open'` de propósito.
     *
     * Uma campanha para "quem pediu orçamento" não pode cair em quem já comprou
     * (`won`) nem em quem disse não (`lost`) — os dois continuam registrados na
     * etapa, e mandar oferta para eles é o disparo que gera reclamação. Quem
     * quiser falar com ganhos ou perdidos está fazendo outra campanha, e ela
     * precisa dizer isso em voz alta.
     */
    const { data: negocios, error } = await db
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", organizationId)
      .in("stage_id", filtro.etapas)
      .eq("status", "open")
      .not("contact_id", "is", null)
      .limit(LIMITE);
    if (error) return { ok: false, erro: error.message };

    /**
     * Deduplicado aqui, e não por join.
     *
     * O PostgREST resolveria com `!inner`, mas o contato voltaria uma vez por
     * negócio — e quem tem três negócios abertos na mesma etapa receberia três
     * mensagens. O `Set` é o que impede isso.
     */
    const unicos = new Set(
      (negocios ?? []).map((n) => (n as { contact_id: string }).contact_id),
    );
    contatosDasEtapas = unicos.size > 0 ? [...unicos] : [NINGUEM];
  }

  let q = db
    .from("contacts")
    // A MESMA régua de consentimento da automação (guarda-do-contato.ts):
    // recusa REGISTRADA, não ausência de consentimento.
    .select(COLUNAS_DO_CONTATO)
    .eq("organization_id", organizationId)
    .limit(LIMITE);
  if (filtro.tags.length > 0) q = q.overlaps("tags", filtro.tags);
  if (contatosDasEtapas) q = q.in("id", contatosDasEtapas);

  const { data, error } = await q;
  if (error) return { ok: false, erro: error.message };
  return { ok: true, contatos: data ?? [] };
}

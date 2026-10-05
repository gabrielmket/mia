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
 *
 * ─── A lista vem INTEIRA, ou não vem ───────────────────────────────────────
 *
 * As duas leituras pediam `.limit(50_000)`. O PostgREST corta toda resposta em
 * 1000 linhas sem avisar: quem montava uma lista de 3.000 contatos disparava
 * para 1.000, e a tela dizia "1.000 destinatários" como se fosse a lista. Com
 * etapa era pior: os negócios também paravam em 1000, e os contatos deles iam
 * todos num `.in()` só, que acima de umas 400 linhas estoura o cabeçalho da
 * resposta e derruba o pedido (o motivo de `lib/supabase/em-lotes.ts` existir).
 *
 * Agora as leituras paginam (`lib/leitura/todas-as-paginas.ts`) e os contatos
 * de uma etapa vêm em lotes de 100 ids.
 *
 * ⚠️ NO TETO, RECUSA. Lista acima de `TETO_DA_LISTA_DO_DISPARO` não volta
 * cortada: volta `{ ok: false, acimaDoTeto: true }`, e quem chama responde com
 * a frase ANTES de criar ou remontar o disparo. Nas outras telas um total
 * parcial sai com aviso; aqui o "parcial" seriam mensagens que não saem para
 * quem a pessoa escolheu, e ninguém confere 50 mil nomes para descobrir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas, TAMANHO_DA_PAGINA } from "@/lib/leitura/todas-as-paginas";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

/** O que o `peneirar` precisa de cada contato. */
export const COLUNAS_DO_CONTATO = "id, phone_number, name, display_name, is_blocked, consent";

/** 50 páginas de 1000: os 50 mil que o `.limit(50_000)` antigo declarava. */
const PAGINAS_MAXIMAS = 50;

/** Quantos contatos (e quantos negócios abertos nas etapas) uma lista pode ter. */
export const TETO_DA_LISTA_DO_DISPARO = PAGINAS_MAXIMAS * TAMANHO_DA_PAGINA;

/**
 * A frase da recusa, em português: é a chave de tradução. A rota a devolve já
 * no idioma de quem pediu, e a tela a mostra como veio.
 */
export const LISTA_ACIMA_DO_TETO =
  "A lista passa de 50.000 contatos, o máximo de um disparo. Filtre por tags ou por etapa do funil e crie um disparo para cada parte.";

/**
 * Quantos ids vão por vez à leitura dos contatos de uma etapa: dez lotes de 100
 * em paralelo (`buscaEmLotes`), uma leva depois da outra. Tudo de uma vez
 * seriam 500 pedidos simultâneos numa lista de 50 mil.
 */
const IDS_POR_LEVA = 1000;

export interface FiltroDaLista {
  tags: string[];
  etapas: string[];
}

export type ResultadoDaLista =
  | { ok: true; contatos: unknown[] }
  | {
      ok: false;
      erro: string;
      /**
       * A lista existe e é grande demais: não é falha do banco, é pedido que
       * tem de ser dividido. Quem chama responde 422 com `LISTA_ACIMA_DO_TETO`.
       */
      acimaDoTeto?: true;
    };

const ACIMA_DO_TETO: ResultadoDaLista = { ok: false, erro: LISTA_ACIMA_DO_TETO, acimaDoTeto: true };

export async function quemEntraNaLista(
  db: SupabaseClient,
  organizationId: string,
  filtro: FiltroDaLista,
): Promise<ResultadoDaLista> {
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
    const negocios = await lerTodasAsPaginas<{ contact_id: string }>(
      (de, ate, pedirContagem) =>
        db
          .from("crm_leads")
          .select("contact_id", pedirContagem ? { count: "exact" } : undefined)
          .eq("organization_id", organizationId)
          .in("stage_id", filtro.etapas)
          .eq("status", "open")
          .not("contact_id", "is", null)
          // Ordem única: paginar por `range` só é correto assim.
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    );
    if (negocios.erro) return { ok: false, erro: negocios.erro };
    // Sem todos os negócios não há como saber quem são todos os contatos.
    if (negocios.truncado) return ACIMA_DO_TETO;

    /**
     * Deduplicado aqui, e não por join.
     *
     * O PostgREST resolveria com `!inner`, mas o contato voltaria uma vez por
     * negócio — e quem tem três negócios abertos na mesma etapa receberia três
     * mensagens. O `Set` é o que impede isso.
     */
    const unicos = [...new Set(negocios.linhas.map((n) => n.contact_id))].sort();

    /**
     * Etapa escolhida, nenhum negócio aberto nela: NINGUÉM.
     *
     * Sai daqui, sem consulta. Um `.in()` com lista VAZIA é tratado pelo
     * PostgREST como "sem filtro" e devolveria a base inteira: uma campanha para
     * ninguém viraria uma campanha para todos, que é o defeito mais caro que
     * esta função pode ter.
     */
    if (unicos.length === 0) return { ok: true, contatos: [] };

    const contatos: unknown[] = [];
    for (let i = 0; i < unicos.length; i += IDS_POR_LEVA) {
      const leva = await buscaEmLotes<unknown>(unicos.slice(i, i + IDS_POR_LEVA), (lote) => {
        let q = db
          .from("contacts")
          // A MESMA régua de consentimento da automação (guarda-do-contato.ts):
          // recusa REGISTRADA, não ausência de consentimento.
          .select(COLUNAS_DO_CONTATO)
          .eq("organization_id", organizationId)
          .in("id", lote);
        if (filtro.tags.length > 0) q = q.overlaps("tags", filtro.tags);
        // Cada lote devolve no máximo 100 linhas (o `id` é único), então aqui o
        // teto de 1000 do PostgREST não alcança.
        return q.order("id", { ascending: true });
      });
      if (leva.error) return { ok: false, erro: leva.error.message };
      contatos.push(...leva.data);
    }
    return { ok: true, contatos };
  }

  const contatos = await lerTodasAsPaginas<unknown>(
    (de, ate, pedirContagem) => {
      let q = db
        .from("contacts")
        // A MESMA régua de consentimento da automação (guarda-do-contato.ts):
        // recusa REGISTRADA, não ausência de consentimento.
        .select(COLUNAS_DO_CONTATO, pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId);
      if (filtro.tags.length > 0) q = q.overlaps("tags", filtro.tags);
      // Do mais antigo para o mais novo, com `id` de desempate: ordem única
      // entre as páginas, e a mesma em toda remontagem (a peneira descarta
      // telefone repetido ficando com o primeiro que aparece).
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(de, ate);
    },
    { paginasMaximas: PAGINAS_MAXIMAS },
  );
  if (contatos.erro) return { ok: false, erro: contatos.erro };
  if (contatos.truncado) return ACIMA_DO_TETO;
  return { ok: true, contatos: contatos.linhas };
}

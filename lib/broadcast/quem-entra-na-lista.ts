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
 *
 * ─── A etiqueta casa sem olhar maiúscula, e a lista é a do seletor ─────────
 *
 * FORK MIA (.97). "0 destinatários · 0 sem telefone · 0 repetidos" é o que sai
 * quando o filtro não acha NINGUÉM, e foi o que uma campanha real mostrou com 25
 * contatos na etiqueta. Medido contra o PostgREST de verdade (v14.14): o `ov`
 * compara byte a byte, e `Leads Odonto JHS` não acha `leads odonto jhs`. O
 * `contacts.tags` é gravado em minúsculas (`normalizarTags`), mas a etiqueta nasce
 * com a grafia de quem a criou (o vocabulário a guarda assim) e o corpo desta
 * rota não normalizava. Agora o filtro procura todas as grafias da mesma etiqueta.
 *
 * Etiqueta com vírgula também dava zero: o `overlaps` do supabase-js monta
 * `{a,b}` sem aspas, e a vírgula virava separador. As aspas vão por `citar`.
 *
 * E a lista passou a ter o mesmo WHERE do seletor (`fn_contact_tags`): sem
 * anonimizado e sem ficha absorvida por mesclagem, que contavam como "sem
 * telefone" gente que não está mais na base. O seletor dizia 25, e a conferência
 * podia dizer 26.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarTag } from "@/lib/contacts/tag-normalizada";
import { lerTodasAsPaginas, TAMANHO_DA_PAGINA } from "@/lib/leitura/todas-as-paginas";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

/** O que o `peneirar` precisa de cada contato. */
export const COLUNAS_DO_CONTATO = "id, phone_number, name, display_name, is_blocked, is_personal, consent";

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
  | {
      ok: true;
      contatos: unknown[];
      /**
       * FORK MIA (.97): quem tem a etiqueta e não tem negócio aberto na etapa. Só
       * com os dois filtros juntos: é o que explica uma lista vazia que a peneira,
       * que só vê quem passou no filtro, não tem como explicar.
       */
      semNegocioNaEtapa?: number;
    }
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

/** Aspas do literal de array do Postgres: vírgula no nome não vira outro elemento. */
function citar(valor: string): string {
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * FORK MIA (.97): todas as grafias gravadas das etiquetas pedidas.
 *
 * `fn_contact_tags` é a função do seletor: ela diz o que está gravado, e a régua
 * da comparação é a mesma da escrita (`normalizarTag`). A pedida e a minúscula
 * entram mesmo sem aparecer ali: a lista de grafias só pode crescer o filtro.
 */
async function grafiasDasEtiquetas(
  db: SupabaseClient,
  organizationId: string,
  pedidas: string[],
): Promise<{ ok: true; grafias: string[] } | { ok: false; erro: string }> {
  if (pedidas.length === 0) return { ok: true, grafias: [] };
  const { data, error } = await db.rpc("fn_contact_tags", { p_org: organizationId });
  if (error) return { ok: false, erro: error.message };
  const chaves = new Set(pedidas.map(normalizarTag));
  const gravadas = ((data ?? []) as Array<{ tag: string }>)
    .map((l) => l.tag)
    .filter((tag) => chaves.has(normalizarTag(tag)));
  return { ok: true, grafias: [...new Set([...pedidas, ...chaves, ...gravadas])].map(citar) };
}

export async function quemEntraNaLista(
  db: SupabaseClient,
  organizationId: string,
  filtro: FiltroDaLista,
): Promise<ResultadoDaLista> {
  const etiquetas = await grafiasDasEtiquetas(db, organizationId, filtro.tags);
  if (!etiquetas.ok) return { ok: false, erro: etiquetas.erro };
  const grafias = etiquetas.grafias;

  /** O mesmo recorte do seletor (`fn_contact_tags`): quem ainda é contato vivo. */
  const consultaDeContatos = (colunas: string, opcoes?: { count: "exact"; head?: boolean }) => {
    let q = db
      .from("contacts")
      .select(colunas, opcoes)
      .eq("organization_id", organizationId)
      .eq("kind", "person")
      .eq("is_anonymized", false)
      .is("is_merged_into", null);
    if (grafias.length > 0) q = q.overlaps("tags", grafias);
    return q;
  };

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
    /**
     * FORK MIA (.97): etiqueta E etapa, quantos têm a etiqueta ao todo. Quem a tem
     * e não está na lista ficou de fora pela etapa, e a tela precisa dizer isso:
     * sem o número, "25 na etiqueta e nenhum negócio aberto" vira um zero mudo.
     */
    const foraPelaEtapa = async (naLista: number): Promise<{ semNegocioNaEtapa?: number }> => {
      if (grafias.length === 0) return {};
      const { count } = await consultaDeContatos("id", { count: "exact", head: true });
      return { semNegocioNaEtapa: Math.max((count ?? naLista) - naLista, 0) };
    };

    if (unicos.length === 0) return { ok: true, contatos: [], ...(await foraPelaEtapa(0)) };

    const contatos: unknown[] = [];
    for (let i = 0; i < unicos.length; i += IDS_POR_LEVA) {
      const leva = await buscaEmLotes<unknown>(unicos.slice(i, i + IDS_POR_LEVA), (lote) =>
        consultaDeContatos(COLUNAS_DO_CONTATO)
          // A MESMA régua de consentimento da automação (guarda-do-contato.ts):
          // recusa REGISTRADA, não ausência de consentimento.
          .in("id", lote)
          // Cada lote devolve no máximo 100 linhas (o `id` é único), então aqui o
          // teto de 1000 do PostgREST não alcança.
          .order("id", { ascending: true }),
      );
      if (leva.error) return { ok: false, erro: leva.error.message };
      contatos.push(...leva.data);
    }
    return { ok: true, contatos, ...(await foraPelaEtapa(contatos.length)) };
  }

  const contatos = await lerTodasAsPaginas<unknown>(
    (de, ate, pedirContagem) =>
      // A MESMA régua de consentimento da automação (guarda-do-contato.ts):
      // recusa REGISTRADA, não ausência de consentimento.
      consultaDeContatos(COLUNAS_DO_CONTATO, pedirContagem ? { count: "exact" } : undefined)
        // Do mais antigo para o mais novo, com `id` de desempate: ordem única
        // entre as páginas, e a mesma em toda remontagem (a peneira descarta
        // telefone repetido ficando com o primeiro que aparece).
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_MAXIMAS },
  );
  if (contatos.erro) return { ok: false, erro: contatos.erro };
  if (contatos.truncado) return ACIMA_DO_TETO;
  return { ok: true, contatos: contatos.linhas };
}

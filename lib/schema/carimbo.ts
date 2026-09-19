/**
 * O CARIMBO DO SCHEMA — qual baseline este banco recebeu.
 *
 * ── O buraco que isto fecha ───────────────────────────────────────────────
 *
 * `easypanel/bootstrap.sh` aplica `supabase/baseline.sql` a cada implantação.
 * Num banco NOVO ele usa `ON_ERROR_STOP` e o app não sobe se falhar. Num banco
 * EXISTENTE — que é todo deploy depois do primeiro — ele roda com `|| true`,
 * filtra os erros benignos ("already exists") e, se sobrar erro inesperado,
 * escreve `AVISO: ... (o app sobe mesmo assim)` e segue.
 *
 * Ou seja: o schema pode ter falhado e o produto sobe igual, saudável, com a
 * versão nova do código e o banco de ontem. O único registro é o stdout de um
 * contêiner efêmero — e a agregação de logs da VPS está desligada (item E4 do
 * backlog). Na prática, "as migrations subiram?" não tinha resposta.
 *
 * É o formato de falha que este repositório mais combate: o degrade silencioso.
 * `platform_branding.fallback_at` existe pelo mesmo motivo.
 *
 * ── Como funciona ─────────────────────────────────────────────────────────
 *
 * O baseline, perto do fim, grava a migration mais nova que ele contém em
 * `public.schema_baseline`. A imagem carrega a MESMA string nesta constante.
 * `/api/v1/health` compara as duas:
 *
 *   iguais     o código e o banco são da mesma entrega
 *   diferentes o baseline não passou, ou a imagem é outra — nos dois casos há
 *              alguém para chamar, e antes não havia sintoma nenhum
 *
 * ── Por que a constante mora no código, e não é lida de `supabase/` ───────
 *
 * A imagem não carrega a pasta `supabase/`: o `Dockerfile` copia o build do
 * Next, e ler arquivo de migration em tempo de execução devolveria "não existe"
 * em produção — o pior lugar para descobrir. A constante é compilada junto, e o
 * que a mantém honesta é o teste, não a disciplina de quem escreve.
 */

/**
 * A migration mais nova que `supabase/baseline.sql` contém.
 *
 * ⚠️ ATUALIZE AO ACRESCENTAR MIGRATION. É uma linha, e
 * `tests/unit/carimbo-do-schema.test.ts` reprova enquanto ela não bater com o
 * arquivo mais novo de `supabase/migrations/` E com o que o baseline grava.
 * Três lugares, uma verdade, conferidos por máquina — que é o oposto do modo
 * como este repositório acumulou as listas que esta semana passou consertando.
 */
export const CARIMBO_DO_SCHEMA = "20260920030000_0268_carimbo_do_schema";

/** Onde o baseline grava, e de onde a saúde lê. Singleton, como a marca. */
export const TABELA_DO_CARIMBO = "schema_baseline";

export interface CarimboLido {
  /** O que o banco diz ter recebido. `null` = tabela ausente ou ilegível. */
  no_banco: string | null;
  /** O que esta imagem esperava encontrar. */
  esperado: string;
  /**
   * `true` só quando os dois batem. Ausência de carimbo é `false`, nunca
   * `true`: um banco que nunca foi carimbado é exatamente o caso em que o
   * baseline pode não ter passado, e responder "em dia" ali desligaria a
   * pergunta em vez de deixá-la aberta.
   */
  em_dia: boolean;
}

export function compararCarimbo(noBanco: string | null): CarimboLido {
  return {
    no_banco: noBanco,
    esperado: CARIMBO_DO_SCHEMA,
    em_dia: noBanco === CARIMBO_DO_SCHEMA,
  };
}

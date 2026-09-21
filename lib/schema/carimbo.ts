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
export const CARIMBO_DO_SCHEMA = "20260921200000_0272_a_chegada_guardou_o_id_errado";

/** Onde o baseline grava, e de onde a saúde lê. Singleton, como a marca. */
export const TABELA_DO_CARIMBO = "schema_baseline";

export interface CarimboLido {
  /** O que o banco diz ter recebido. `null` = tabela ausente ou ilegível. */
  no_banco: string | null;
  /** O que esta imagem esperava encontrar. */
  esperado: string;
  /**
   * Erros NÃO benignos ao aplicar o baseline, contados pelo bootstrap
   * (migration 0269). `0` = passou limpo.
   */
  erros: number;
  /** As primeiras linhas do erro. NUNCA sai na resposta pública. */
  amostra: string | null;
  /**
   * `true` só quando o carimbo bate E o baseline passou sem erro.
   *
   * As DUAS metades importam, e a segunda foi o conserto da 0269: num banco
   * existente o `psql` roda sem `ON_ERROR_STOP`, então um comando que falha
   * não impede o arquivo de chegar ao fim — e de carimbar. Só o carimbo provava
   * "o baseline foi lido inteiro", nunca "cada comando passou".
   *
   * Ausência de carimbo é `false`, nunca `true`: um banco que nunca foi
   * carimbado é exatamente o caso em que o baseline pode não ter passado, e
   * responder "em dia" ali desligaria a pergunta em vez de deixá-la aberta.
   */
  em_dia: boolean;
}

export function compararCarimbo(
  noBanco: string | null,
  erros = 0,
  amostra: string | null = null,
): CarimboLido {
  return {
    no_banco: noBanco,
    esperado: CARIMBO_DO_SCHEMA,
    erros,
    amostra,
    em_dia: noBanco === CARIMBO_DO_SCHEMA && erros === 0,
  };
}

/**
 * O grupo interno precisa ser avisado sobre o schema? E com que texto?
 *
 * ── Por que uma função pura, e não um `if` dentro do cron ─────────────────
 *
 * Porque a decisão tem quatro estados e três deles são "não avisar" — e os três
 * pelo motivo certo. Enterrada no meio de uma rota que precisa de Supabase,
 * segredo de cron e adaptador de WhatsApp para rodar, ela seria a parte não
 * medida do alerta que existe justamente para ser confiável.
 *
 * ── A chave carrega o ESTADO, não o momento ───────────────────────────────
 *
 * A trava anti-ruído de `reportar()` é por chave. Com `"schema_fora_de_dia"`
 * fixa, consertar um problema e cair noutro deixaria o grupo calado até o dia
 * seguinte. Com o estado dentro dela, problema NOVO é recado novo, e o mesmo
 * problema de ontem continua rendendo um por dia.
 */
export function alertaDoSchema(linha: {
  migration_mais_nova: string | null;
  erros_inesperados: number | null;
  erros_amostra: string | null;
}): { chave: string; corpo: string } | null {
  // Ausência de carimbo NÃO é alarme: um banco anterior à 0268 nunca foi
  // carimbado, e acusar ali faria toda instalação antiga tocar o alarme na
  // primeira rodada — alarme que toca sempre ninguém escuta.
  const noBanco = linha.migration_mais_nova?.trim() || null;
  if (!noBanco) return null;

  const erros = linha.erros_inesperados ?? 0;
  const bate = noBanco === CARIMBO_DO_SCHEMA;
  if (bate && erros === 0) return null;

  const corpo = !bate
    ? `*O banco recebeu:* ${noBanco}\n` +
      `*Esta versão espera:* ${CARIMBO_DO_SCHEMA}\n\n` +
      `Ou o baseline não passou no último deploy, ou a imagem no ar é outra.`
    : `*Erros ao aplicar o baseline:* ${erros}\n` +
      `*Primeiras linhas:*\n${(linha.erros_amostra ?? "(sem amostra)").slice(0, 600)}\n\n` +
      `O baseline chegou ao fim e o Postgres recusou pelo menos um comando pelo ` +
      `caminho. Num banco que já existe isso não derruba o sistema — e é por ` +
      `isso que passa despercebido.`;

  return { chave: `schema_fora_de_dia:${noBanco}:${erros}`, corpo };
}

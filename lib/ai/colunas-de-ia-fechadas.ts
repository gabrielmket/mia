/**
 * FORK MIA (MIA-251 G) · AS COLUNAS DE IA QUE A SESSÃO NÃO LÊ.
 *
 * Desde a migration 9175, `authenticated` lê `llm_calls`, `agent_turn_traces` e
 * `ai_agent_runs` coluna por coluna: tudo, menos o custo, os tokens, o provedor
 * e o modelo. É o mesmo recorte que `semIaDaPlataforma`
 * (`lib/ai/custo-e-da-plataforma.ts`) já fazia na resposta da API, agora também
 * no banco: quem abre o PostgREST com a sessão do cliente recebe 42501 ao pedir
 * essas colunas, e não mais o número.
 *
 * A regra é uma só, escrita duas vezes e conferida por máquina:
 *   - aqui, para o código montar a lista de colunas da sessão;
 *   - em `fn_mia_colunas_de_ia_fechadas()` (9175), para o banco.
 * `tests/unit/colunas-de-custo-fora-da-sessao.test.ts` reprova se as duas
 * divergirem, e reprova leitor que peça coluna fechada pela sessão.
 *
 * Quem precisa da coluna fechada é rota da plataforma (`podeVerCusto`): lê com o
 * cliente admin, filtrando `organization_id`, DEPOIS do portão. Status, erro e
 * tempo continuam pela sessão.
 */

/** As três tabelas de telemetria de IA com leitura por coluna. */
export const TABELAS_COM_COLUNAS_DE_IA_FECHADAS = [
  "llm_calls",
  "agent_turn_traces",
  "ai_agent_runs",
] as const;

/**
 * As fechadas pelo nome. Além delas, toda coluna com `tokens` no nome fica de
 * fora (`input_tokens`, `cache_read_tokens`, `tokens_in`…), inclusive a que o
 * upstream criar depois: a função do banco aplica a mesma regra a cada
 * implantação.
 */
export const COLUNAS_DE_IA_FECHADAS = [
  "cost_cents",
  "provider",
  "model",
  // Tokens de entrada do 1º passo (9105 do upstream): é token, sem `tokens` no nome.
  "entrada_do_primeiro_passo",
] as const;

const FECHADAS = new Set<string>(COLUNAS_DE_IA_FECHADAS);

export function ehColunaDeIaFechada(coluna: string): boolean {
  return FECHADAS.has(coluna) || coluna.includes("tokens");
}

/**
 * O nome da coluna de um item de `select` do PostgREST: tira o apelido
 * (`apelido:coluna`), a conversão (`coluna::text`) e o caminho de JSON
 * (`coluna->>chave`).
 */
export function nomeDaColuna(item: string): string {
  let nome = item.trim();
  const conversao = nome.indexOf("::");
  if (conversao >= 0) nome = nome.slice(0, conversao);
  const apelido = nome.indexOf(":");
  if (apelido >= 0) nome = nome.slice(apelido + 1);
  const json = nome.indexOf("->");
  if (json >= 0) nome = nome.slice(0, json);
  return nome.trim();
}

/**
 * A lista de colunas que a SESSÃO pode pedir, a partir da lista da plataforma.
 *
 * O tipo devolvido é o da lista de entrada, de propósito: o PostgREST tipado
 * continua inferindo a mesma linha, e as colunas fechadas chegam `undefined`,
 * que `semIaDaPlataforma` troca por `null` na resposta (como já fazia).
 */
export function colunasDaSessao<T extends string>(colunas: T): T {
  return colunas
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "" && !ehColunaDeIaFechada(nomeDaColuna(item)))
    .join(", ") as T;
}

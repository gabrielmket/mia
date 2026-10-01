/**
 * FORK MIA — OS ENDEREÇOS DA MICROSOFT TÊM UM LUGAR SÓ.
 *
 * A raiz da Graph da Microsoft (`v1.0`) e os endereços da plataforma de
 * identidade (`v2.0`) carregam um número de versão no caminho. Escritos em três
 * arquivos, o dia em que a Microsoft mudar um deles vira o mesmo defeito que a
 * catraca `tests/unit/versao-da-graph-num-lugar-so.test.ts` guarda para a Meta:
 * quem sobe a versão edita dois e esquece um. Por isso eles moram aqui, e esse
 * é o único arquivo da agenda Microsoft que a catraca deixa escrever o número.
 *
 * Nada aqui é da Graph da Meta: aquela continua em `lib/graph-version.ts`.
 * Módulo puro (sem ambiente, sem banco), para qualquer camada poder importar.
 */

/** A raiz das chamadas à Graph da Microsoft. */
export const RAIZ_DA_GRAPH = "https://graph.microsoft.com/v1.0";

const LOGIN_DA_MICROSOFT = "https://login.microsoftonline.com";

export function enderecoDeAutorizacao(tenant: string): string {
  return `${LOGIN_DA_MICROSOFT}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
}

export function enderecoDeToken(tenant: string): string {
  return `${LOGIN_DA_MICROSOFT}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

/**
 * Onde o TI de uma empresa aprova o app uma vez. `organizations`: o
 * administrador entra com a conta dele, e a Microsoft usa o tenant dele.
 */
export const ENDERECO_DA_APROVACAO_DO_TI = `${LOGIN_DA_MICROSOFT}/organizations/v2.0/adminconsent`;

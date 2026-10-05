/**
 * FORK MIA — as origens de produto que o FORK escreve em
 * `catalog_products.origem`, além de "manual" e "planilha" do upstream.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * O upstream 1.73 (#2288) pôs o botão Editar na tela Produtos, e a regra dele é
 * conservadora de propósito: `origem` que não seja "manual" nem "planilha" veio
 * de uma integração, e abre o formulário SOMENTE LEITURA, com o aviso de que a
 * próxima sincronização sobrescreve (`sincronizadoDeOrigem`, em
 * `lib/catalogo/edicao-do-produto.ts`).
 *
 * O fork grava duas origens que o upstream não conhece, e nenhuma delas é
 * integração:
 *
 *   implantacao    o catálogo que entrou por `plataforma_garantir_produtos`
 *                  (`lib/implantacao/produtos.ts`)
 *   demonstracao   o catálogo das empresas de demonstração
 *                  (`lib/demonstracao/semente/aplicar.ts`)
 *
 * Sem esta lista, todo cliente implantado por ferramenta ficaria com o catálogo
 * inteiro trancado na tela, com uma frase que manda editar "na origem", e a
 * origem é uma ferramenta que a pessoa do cliente não tem. Não há sincronização
 * nenhuma por trás: a implantação só regrava o campo que vier num pedido novo,
 * como a planilha.
 *
 * ── PROIBIDO importar qualquer coisa aqui ─────────────────────────────────
 *
 * `edicao-do-produto.ts` é importado por um componente `"use client"`
 * (`app/app/products/_edicao.tsx`). As constantes de quem grava moram em
 * módulos de servidor (auditoria, banco); importá-las daqui levaria o servidor
 * para dentro do JavaScript do navegador. Por isso os dois textos são repetidos
 * aqui, e `tests/unit/produto-da-implantacao-se-edita-na-tela.test.ts` reprova
 * no dia em que um deles divergir do que é gravado.
 */
export const ORIGENS_DO_FORK: readonly string[] = ["implantacao", "demonstracao"];

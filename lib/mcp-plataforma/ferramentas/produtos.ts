/**
 * `plataforma_garantir_produtos` — o catálogo de um cliente, em lote. A
 * operação mora em `lib/implantacao/produtos.ts`.
 */
import { z } from "zod";

import { garantirProdutos, TETO_DE_PRODUTOS, type ProdutoPedido } from "@/lib/implantacao/produtos";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

// O item é conferido UM A UM dentro da operação (com o contrato da tela), para a
// resposta dizer qual entrou e qual foi recusado. Aqui fica só a forma: um item
// com problema não derruba a chamada inteira.
const produto = z
  .object({
    codigo: z
      .string()
      .max(60)
      .optional()
      .describe(
        "O código do produto na empresa (SKU, código interno). É a identidade: uma nova chamada com o mesmo código ATUALIZA o produto. " +
          "Maiúsculas e minúsculas não mudam o código. Sem código, o nome vira o código (até 60 caracteres).",
      ),
    nome: z.string().describe("O nome do produto ou serviço, de 2 a 200 caracteres."),
    descricao: z.string().optional().describe("O que é, para quem serve, o que inclui. É daqui que o agente tira o que responde. Até 2000 caracteres."),
    marca: z.string().optional(),
    categoria: z.string().optional(),
    preco_cents: z.number().optional().describe("O preço em CENTAVOS, número inteiro. R$ 149,90 = 14990."),
    preco: z.string().optional().describe('Alternativa a `preco_cents`: o preço em texto, como numa planilha ("R$ 1.499,90", "149,9").'),
    custo_cents: z.number().nullable().optional().describe("O custo em centavos (opcional). É o piso da regra de desconto do agente."),
    controla_estoque: z
      .boolean()
      .optional()
      .describe("A empresa conta estoque deste item? Sem isto: verdadeiro se `quantidade` veio, falso se não veio. Item que controla estoque e está zerado NÃO é oferecido pelo agente."),
    quantidade: z.number().optional().describe("Quantidade em estoque."),
    ativo: z.boolean().optional().describe("false tira o produto do que o agente oferece, sem apagá-lo."),
    imagem_url: z.string().optional().describe("Endereço https de uma imagem do produto."),
  })
  .strict();

export const FERRAMENTAS_DE_PRODUTOS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_produtos",
    description:
      "Importa ou atualiza, em LOTE, os produtos e serviços do catálogo de um cliente: o que o agente consulta para informar preço e descrever o que a empresa vende. " +
      `Até ${TETO_DE_PRODUTOS} produtos por chamada; catálogos maiores vão em mais de uma chamada. ` +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o CÓDIGO (ou o nome, quando não há código). " +
      "Produto novo é criado; produto que já existe tem atualizados SÓ os campos que vieram no item (item sem `descricao` não apaga a descrição que existe); igual, nada acontece. " +
      "A resposta lista os itens UM A UM, pela posição na lista: `criou`, `atualizou`, `ja_estava` ou `recusado`, com o motivo. " +
      "Um item recusado NÃO derruba os outros: corrija só os recusados e mande de novo. " +
      "PREÇO: `preco_cents` em centavos (R$ 149,90 = 14990) ou `preco` em texto. A moeda é a da empresa (plataforma_configurar_empresa), não se informa por produto. " +
      "ATENÇÃO: o agente que já está no ar passa a responder com o preço gravado aqui, na hora. " +
      "O QUE NÃO FAZ: não apaga produto (para tirar de circulação, `ativo: false`), não sobe foto por arquivo, e não importa planilha CSV (isso é pela tela, em Produtos).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      produtos: z.array(produto).min(1).max(TETO_DE_PRODUTOS).describe(`A lista de produtos, de 1 a ${TETO_DE_PRODUTOS}.`),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      produtos: [
        { codigo: "PLANO-MENSAL", nome: "Plano mensal", descricao: "Acesso livre, de segunda a sábado.", preco_cents: 14990, categoria: "Planos" },
        { codigo: "AVALIACAO", nome: "Avaliação inicial", preco: "R$ 80,00" },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return garantirProdutos(c, args.produtos as ProdutoPedido[]);
    },
  },
];

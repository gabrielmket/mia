/**
 * FORK MIA · OS QUADROS PRONTOS QUE A MIA ACRESCENTA aos do onboarding.
 *
 * Moram aqui, e não dentro de `pacotes-de-funil.ts` (do upstream), para a
 * diferença com ele ser UMA linha: a lista dele espalha esta. O quadro novo
 * aparece no passo "onde ele organiza" do onboarding, serve de exemplo para a
 * sugestão da IA e é o funil da empresa de demonstração do mesmo segmento
 * (`lib/demonstracao/semente/segmentos/`).
 *
 * As regras são as mesmas dos quadros do upstream, e os mesmos testes as cobram
 * (`proposta-de-funil.test.ts`): toda etapa carrega o passo do agente, há uma
 * coluna de ganho e uma de perda, e nenhum nome é jargão de manual de vendas.
 */
import type { PacoteDeFunil } from "./pacotes-de-funil";

export const PACOTES_DA_MIA: readonly PacoteDeFunil[] = [
  {
    // Fabricante ou distribuidora que vende para revendas, instaladores e
    // construtoras. O próximo passo é a cotação, não a reunião: quem compra
    // manda a lista de itens, compara fornecedores e fecha o pedido.
    id: "industria",
    comoSeApresenta: "Indústria ou distribuidora que vende para revendas",
    proposta: {
      nome: "Pedidos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o que precisa", passo: "qualifying" },
        { nome: "Cotação enviada", passo: "qualified" },
        { nome: "Negociando o pedido", passo: "negotiating" },
        { nome: "Pedido fechado", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
  },
];

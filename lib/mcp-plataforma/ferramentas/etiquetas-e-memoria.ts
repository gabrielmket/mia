/**
 * As ferramentas de ETIQUETAS e de MEMÓRIA da empresa. As operações moram em
 * `lib/implantacao/etiquetas.ts` e `lib/implantacao/memoria.ts`.
 */
import { z } from "zod";

import { garantirEtiquetas, TETO_DE_ETIQUETAS, type EtiquetaPedida } from "@/lib/implantacao/etiquetas";
import { etiquetarContatos, TETO_POR_CHAMADA, type PedidoDeEtiquetagem } from "@/lib/implantacao/etiquetar-contatos";
import { gravarMemoria, TETO_DE_ANOTACOES, type PedidoDeMemoria } from "@/lib/implantacao/memoria";
import { OPERACAO_IMPORTAR_BASE } from "@/lib/mcp-plataforma/importacao/operacoes";
import { recusar } from "@/lib/mcp-plataforma/recusa";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_ETIQUETAS_E_MEMORIA: readonly FerramentaDePlataforma[] = [
  {
    // FORK MIA (.97): o "Selecionar todos os N contatos deste filtro" da tela de Contatos.
    name: "plataforma_etiquetar_contatos",
    description:
      "Põe ou tira UMA etiqueta em TODOS os contatos de um filtro de um cliente, sem o teto de 100 da tela: é o \"Selecionar todos os N contatos deste filtro\" de Contatos. " +
      "O filtro é o da lista de Contatos: busca (nome, e-mail ou telefone), etiquetas (com modo e ou ou), origem (como import_csv) e pessoais. " +
      `Cada chamada anda até ${TETO_POR_CHAMADA} contatos. Se a resposta vier com continua: true, repita com o cursor que ela trouxe, até continua: false. Repetir não duplica: quem já tem a etiqueta fica como está. ` +
      "ANTES DE GRAVAR, chame com apenas_contar: true para ver o total_do_filtro, e confira com quem pediu. " +
      "O QUE NÃO FAZ: não envia mensagem, não dispara automação (nem a de etiqueta nova, de propósito), não abre conversa e não toca contato anonimizado. " +
      "Sem filtro ela recusa: a base inteira só com toda_a_base: true. Para pôr a etiqueta no vocabulário (nome, cor e descrição), a ferramenta é plataforma_garantir_etiquetas.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      etiqueta: z.string().trim().min(1).max(60).describe("A etiqueta, como aparece no chip. Maiúsculas não mudam a etiqueta: ela é gravada em minúsculas."),
      acao: z.enum(["adicionar", "remover"]).optional().describe('"adicionar" (padrão) ou "remover".'),
      filtro: z
        .object({
          busca: z.string().optional().describe("Nome, e-mail ou telefone, como a busca da tela."),
          etiquetas: z.array(z.string()).max(20).optional().describe("Só quem tem estas etiquetas."),
          modo: z.enum(["e", "ou"]).optional().describe('Entre as etiquetas: "e" (padrão, todas) ou "ou" (qualquer uma).'),
          origem: z.string().optional().describe('Só desta origem, como "import_csv", "whatsapp" ou "manual".'),
          pessoais: z.boolean().optional().describe("true = só os contatos pessoais. Sem o campo, eles ficam de fora."),
        })
        .strict()
        .optional()
        .describe("Quem recebe a etiqueta. Sem ele, a chamada recusa, salvo com toda_a_base: true."),
      toda_a_base: z.boolean().optional().describe("true confirma que a etiqueta vale para a base inteira do cliente, sem filtro."),
      apenas_contar: z.boolean().optional().describe("true só devolve o total_do_filtro, sem gravar nada."),
      cursor: z.string().optional().describe("O cursor da resposta anterior, quando ela veio com continua: true."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      etiqueta: "Lista de outubro",
      filtro: { origem: "import_csv" },
      apenas_contar: true,
    },
    operacao: OPERACAO_IMPORTAR_BASE,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return etiquetarContatos(c, args as unknown as PedidoDeEtiquetagem);
    },
  },
  {
    name: "plataforma_garantir_etiquetas",
    description:
      "Põe etiquetas no VOCABULÁRIO de um cliente, com a cor de cada uma: é a lista que a equipe e o agente usam para marcar contatos, negócios e conversas. " +
      `Até ${TETO_DE_ETIQUETAS} por chamada. GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME (maiúsculas e minúsculas não mudam a etiqueta). ` +
      "Etiqueta nova entra; a que já existe tem a cor ou a descrição atualizada só se veio diferente; igual, nada acontece. " +
      "As que já existem e o pedido não cita ficam como estão. " +
      "A cor é `#rrggbb`; a paleta recomendada está em plataforma_listar_modelos, seção etiquetas. " +
      "O QUE NÃO FAZ: não marca contato nem negócio com a etiqueta, e não renomeia, junta nem exclui etiqueta " +
      "(isso mexe em tudo que já carrega o nome, e é pela tela: Configurações › Etiquetas).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      etiquetas: z
        .array(
          z
            .object({
              nome: z.string().trim().min(1).max(60).describe("O nome da etiqueta, como aparece no chip."),
              cor: z.string().nullable().optional().describe('A cor, em #rrggbb (ex.: "#0091ff"). null tira a cor. Sem o campo, a cor que existe fica.'),
              descricao: z.string().trim().max(200).nullable().optional().describe("Quando usar esta etiqueta."),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_ETIQUETAS)
        .describe(`A lista de etiquetas, de 1 a ${TETO_DE_ETIQUETAS}.`),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      etiquetas: [
        { nome: "Plano anual", cor: "#00655a" },
        { nome: "Indicação", cor: "#0091ff", descricao: "Chegou por indicação de cliente." },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const etiquetas = await garantirEtiquetas(c, args.etiquetas as EtiquetaPedida[]);
      return {
        criadas: etiquetas.filter((e) => e.desfecho === "criou").length,
        atualizadas: etiquetas.filter((e) => e.desfecho === "atualizou").length,
        ja_estavam: etiquetas.filter((e) => e.desfecho === "ja_estava").length,
        etiquetas,
      };
    },
  },

  {
    name: "plataforma_gravar_memoria",
    description:
      "Grava a MEMÓRIA da empresa de um cliente: o que TODOS os agentes dela seguem, em qualquer conversa. Tem duas partes, e pode vir uma só: " +
      "`documento` são as REGRAS DA CASA (política de preço e desconto, o que nunca prometer, tom de voz, horários, formas de pagamento), num texto só; " +
      "`anotacoes` são aprendizados avulsos, cada um com título e corpo. " +
      "REPETIR NÃO EMPILHA: o documento só ganha versão nova se o texto mudou; a anotação casa pelo TÍTULO (título igual com corpo igual não mexe; " +
      "com corpo diferente, a antiga é arquivada e entra a nova). Anotações que o pedido não cita ficam. " +
      `Até ${TETO_DE_ANOTACOES} anotações por chamada. ` +
      "ATENÇÃO: o agente que já está no ar passa a seguir o que for gravado aqui na conversa seguinte, sem publicar nada. " +
      "O QUE NÃO VAI AQUI: o que é de UM agente só vai no prompt dele (plataforma_garantir_agente); preço de produto vai no catálogo (plataforma_garantir_produtos); " +
      "perguntas e respostas longas vão no conhecimento (plataforma_garantir_conhecimento).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      documento: z
        .string()
        .trim()
        .min(1)
        .max(50_000)
        .optional()
        .describe("As regras da casa, em texto corrido ou Markdown. SUBSTITUI o documento em vigor: mande o texto inteiro, não só o que mudou."),
      anotacoes: z
        .array(
          z
            .object({
              titulo: z.string().trim().min(1).max(200).describe("O assunto da anotação. É a chave para atualizar."),
              corpo: z.string().trim().min(1).max(10_000).describe("O que a equipe e o agente precisam saber."),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_ANOTACOES)
        .optional()
        .describe("Anotações avulsas."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      documento:
        "Nunca prometa desconto acima de 10% sem falar com a gerência. Não confirme horário sem consultar a agenda. Formas de pagamento: Pix, cartão em até 6 vezes.",
      anotacoes: [{ titulo: "Estacionamento", corpo: "Há convênio com o estacionamento ao lado, com uma hora grátis." }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      if (args.documento === undefined && args.anotacoes === undefined) {
        recusar('Informe `documento` (as regras da casa), `anotacoes`, ou os dois. Ex.: { "documento": "Nunca prometa desconto acima de 10%." }');
      }
      const { c } = await alvo(ctx, args);
      return gravarMemoria(c, { documento: args.documento, anotacoes: args.anotacoes } as PedidoDeMemoria);
    },
  },
];

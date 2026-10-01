/**
 * As ferramentas de DOCUMENTOS E OBRIGAÇÕES do MCP de plataforma. As operações
 * moram em `lib/implantacao/obrigacoes.ts`; a regra do produto, em
 * `docs/fork/obrigacoes.md`.
 *
 * Três ferramentas, e a operação do token segue o tamanho do estrago:
 *
 *   plataforma_ver_obrigacoes               leitura
 *   plataforma_garantir_tipos_de_obrigacao  `implantar_configuracao`: o catálogo
 *                                           do funil é montagem, não fala com
 *                                           ninguém de fora
 *   plataforma_garantir_obrigacoes          `importar_base`: grava itens ligados
 *                                           às empresas, aos contatos e aos
 *                                           negócios do cliente, em lote
 *
 * Nenhuma das três envia nada: quem avisa o cliente é a automação que a empresa
 * ligar (plataforma_garantir_automacao com um dos gatilhos `obrigacao.*`, e
 * plataforma_ligar_automacao).
 */
import { z } from "zod";

import {
  EXEMPLO_DE_OBRIGACAO,
  SITUACOES_DA_LEITURA,
  TETO_DA_LEITURA,
  TETO_DE_OBRIGACOES,
  garantirObrigacoesEmLote,
  garantirTiposDeObrigacao,
  lerObrigacoesDoCliente,
  type PedidoDeTipos,
  type SituacaoDaLeitura,
} from "@/lib/implantacao/obrigacoes";
import { SEGMENTOS_DE_OBRIGACAO } from "@/lib/obrigacoes/catalogo";
import { TETO_DE_TIPOS_POR_FUNIL } from "@/lib/obrigacoes/catalogo-servidor";
import { CATEGORIAS, LIGA_A, QUEM_ENTREGA, RECORRENCIAS } from "@/lib/obrigacoes/tipos";

import { redigirLote } from "../importacao/auditoria";
import { OPERACAO_IMPORTAR_BASE } from "../importacao/operacoes";
import type { FerramentaDeImportacao } from "../importacao/tipos";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const FERRAMENTA_GARANTIR_OBRIGACOES: FerramentaDeImportacao = {
  name: "plataforma_garantir_obrigacoes",
  description:
    "Cria ou atualiza, em lote, os DOCUMENTOS E OBRIGAÇÕES de um cliente: o que os clientes DELE precisam entregar ou renovar " +
    "(alvará, AVCB, licença sanitária, CNH, contrato assinado) e o que se repete (relatório mensal, renovação anual, revisão). " +
    "Serve para a implantação e para MIGRAR os vencimentos que a empresa controlava em planilha. " +
    `Teto: ${TETO_DE_OBRIGACOES} itens por chamada; lista maior, chame várias vezes. ` +
    "GARANTIR quer dizer: pode ser repetida sem duplicar. A chave é o TIPO mais A QUEM o item está ligado (a mesma empresa com o mesmo " +
    "tipo é o mesmo item). A resposta diz, item a item (posição começando em 1), se criou, atualizou, já estava igual ou recusou e por quê; " +
    "um item ruim não derruba os outros. " +
    "A SITUAÇÃO (a pedir, pedido, recebido, válido, vencendo, vencido, pendente, feita) NÃO é informada: é calculada pelas datas. " +
    "Informe as datas que souber (`pedido_em`, `recebido_em`, `valido_ate`, `proxima_em`, `feita_em`). Um `recebido_em` mais novo que o gravado " +
    "fecha o ciclo: o anterior vai para o histórico do item. " +
    "O tipo traz os padrões (validade, recorrência, avisos, quem entrega) do catálogo do cliente ou dos modelos (plataforma_listar_modelos, seção obrigacoes); " +
    "o que vier no item vale mais. Tipo fora do catálogo e dos modelos precisa de `categoria`. " +
    "ANTES DE chamar: as empresas, os contatos e os negócios precisam existir (plataforma_importar_empresas, plataforma_importar_contatos, plataforma_importar_negocios). " +
    "O QUE NÃO FAZ: não envia mensagem, não dispara automação (nem a de documento recebido, nem aviso de vencimento atrasado), não cria tarefa, " +
    "não guarda arquivo (o arquivo é anexado por uma pessoa, na tela) e não cria empresa, contato nem negócio.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
    origem: z
      .string()
      .optional()
      .describe('De onde os itens vêm, em minúsculas e sem espaço (ex.: "planilha"). Fica gravado no item. Sem isto, a origem é "mcp".'),
    obrigacoes: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_OBRIGACOES} itens. Cada um: tipo (obrigatório: o nome, ex.: "Alvará de funcionamento"); a quem está ligado, pelo menos um de ` +
          "negocio_id, empresa_cnpj / empresa_nome / empresa_id, contato_telefone / contato_email / contato_id; " +
          `categoria ("documento" ou "atividade"; só quando o tipo não está no catálogo nem nos modelos); ` +
          "pedido_em, prazo_em, recebido_em, valido_ate (documento), proxima_em, feita_em (atividade), em AAAA-MM-DD ou DD/MM/AAAA; " +
          `recorrencia (${RECORRENCIAS.join(", ")}) e recorrencia_meses; validade_meses; avisos_dias (até 3 números, ex.: [30, 15, 7]); ` +
          `quem_entrega ("cliente" ou "nos"); responsavel_email (pessoa da equipe); observacao. ` +
          `Exemplo: ${JSON.stringify(EXEMPLO_DE_OBRIGACAO)}`,
      ),
  },
  operacao: OPERACAO_IMPORTAR_BASE,
  exemplo: { organization_id: ORG_DE_EXEMPLO, origem: "planilha", obrigacoes: [EXEMPLO_DE_OBRIGACAO] },
  handler: garantirObrigacoesEmLote,
  // Os itens citam telefone, e-mail e CNPJ de clientes: a auditoria guarda só a contagem.
  redigirParaAuditoria: redigirLote(["organization_id", "origem"], ["obrigacoes"]),
};

export const FERRAMENTAS_DE_OBRIGACOES: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_obrigacoes",
    description:
      "Os DOCUMENTOS E OBRIGAÇÕES de um cliente: o que os clientes dele precisam entregar ou renovar (alvará, licença, CNH, contrato) e as " +
      "atividades que se repetem (relatório mensal, renovação anual). Devolve os CONTADORES (vencidos, vencendo em 30 dias, pedidos sem resposta, " +
      "em dia), os itens do mais urgente para o menos, com a situação calculada, as datas e a quem cada um está ligado, e o CATÁLOGO de tipos por funil. " +
      "QUANDO USAR: para conferir o que foi migrado, antes de montar as automações de aviso, e para responder \"o que vence este mês?\". " +
      "Por padrão vêm só os pendentes (tudo que não está em dia); `situacao` muda o corte. A pessoa de um item vem só pelo id.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      situacao: z
        .enum(SITUACOES_DA_LEITURA)
        .optional()
        .describe(
          'Qual corte: "pendentes" (padrão: tudo que não está em dia), "vencidas", "vencendo" (nos próximos 30 dias), "pedidas_sem_resposta", "em_dia" ou "todas".',
        ),
      limite: z.number().int().min(1).max(TETO_DA_LEITURA).optional().describe(`Quantos itens devolver (padrão 50, até ${TETO_DA_LEITURA}).`),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, situacao: "vencendo" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return lerObrigacoesDoCliente(c, {
        situacao: args.situacao as SituacaoDaLeitura | undefined,
        limite: args.limite as number | undefined,
      });
    },
  },

  {
    name: "plataforma_garantir_tipos_de_obrigacao",
    description:
      "Cria ou ajusta o CATÁLOGO DE TIPOS de documentos e obrigações de um funil de um cliente: os tipos que a equipe escolhe ao adicionar um item " +
      "num negócio (alvará, AVCB, CNH, contrato assinado, relatório mensal). Cada tipo traz a validade padrão, a recorrência, a antecedência dos avisos, " +
      "quem entrega e a quem costuma se ligar; no item, tudo pode ser mudado. " +
      "`modelo_do_segmento` instala de uma vez os tipos que o produto traz para o segmento (" +
      SEGMENTOS_DE_OBRIGACAO.join(", ") +
      "; a lista de cada um está em plataforma_listar_modelos, seção obrigacoes). `tipos` acrescenta ou ajusta um a um. Podem vir os dois. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do tipo dentro do funil. Tipo novo entra; o que já existe é " +
      "atualizado só quando veio em `tipos` com algo diferente; aplicar o modelo de novo não desfaz ajuste feito num tipo. Tipos que o pedido não cita ficam. " +
      `Até ${TETO_DE_TIPOS_POR_FUNIL} tipos por funil. Sem \`funil\`, os tipos valem para todos os funis do cliente. ` +
      "O QUE NÃO FAZ: não cria item nenhum (isso é plataforma_garantir_obrigacoes), não tira tipo do catálogo (é pela tela: Configurações, Etapas do funil), " +
      "não muda os itens que já existem (cada item guarda as próprias regras) e não cria automação de aviso (plataforma_garantir_automacao).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .nullable()
        .optional()
        .describe("Nome ou id do funil (de plataforma_ver_funis). Sem isto, os tipos valem para todos os funis do cliente."),
      modelo_do_segmento: z
        .enum(SEGMENTOS_DE_OBRIGACAO)
        .optional()
        .describe("Instala os tipos do segmento. Os que o funil já tem pelo nome ficam como estão."),
      tipos: z
        .array(
          z
            .object({
              nome: z.string().trim().min(1).max(120).describe("O nome do tipo. É a chave para atualizar."),
              categoria: z.enum(CATEGORIAS).describe('"documento" (o cliente entrega, ou tem validade) ou "atividade" (algo que se repete).'),
              quem_entrega: z.enum(QUEM_ENTREGA).optional().describe('"cliente" (a empresa pede) ou "nos" (a empresa entrega ao cliente).'),
              recorrencia: z.enum(RECORRENCIAS).optional().describe('"unica", "mensal", "anual" ou "n_meses" (com recorrencia_meses).'),
              recorrencia_meses: z.number().int().min(1).max(240).nullable().optional().describe('De quantos em quantos meses, com recorrencia "n_meses".'),
              validade_meses: z.number().int().min(0).max(600).optional().describe("A validade padrão do documento, em meses. 0 = sem validade."),
              avisos_dias: z.array(z.number().int().min(1).max(3650)).max(3).optional().describe("Até três antecedências de aviso, em dias (ex.: [30, 15, 7])."),
              liga_a: z.enum(LIGA_A).optional().describe('A quem o tipo costuma se ligar: "negocio", "empresa" (aparece em todos os negócios dela) ou "contato".'),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_TIPOS_POR_FUNIL)
        .optional()
        .describe("Os tipos a acrescentar ou ajustar, um a um."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      funil: "Orçamentos",
      modelo_do_segmento: "servicos_b2b",
      tipos: [{ nome: "Certidão negativa de débitos", categoria: "documento", validade_meses: 6, avisos_dias: [30, 15] }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirTiposDeObrigacao(c, pedido as unknown as PedidoDeTipos);
    },
  },

  FERRAMENTA_GARANTIR_OBRIGACOES,
];

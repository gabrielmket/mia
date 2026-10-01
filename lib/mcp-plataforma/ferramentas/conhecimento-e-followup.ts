/**
 * As ferramentas de CONHECIMENTO (por texto) e de FOLLOW-UP. As operações moram
 * em `lib/implantacao/conhecimento.ts` e `lib/implantacao/followup.ts`.
 */
import { z } from "zod";

import {
  garantirConhecimento,
  TETO_DE_PERGUNTAS,
  TETO_DO_DOCUMENTO,
  type PedidoDeConhecimento,
} from "@/lib/implantacao/conhecimento";
import { garantirFollowup, publicarFollowup, type PedidoDeFollowup } from "@/lib/implantacao/followup";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_CONHECIMENTO_E_FOLLOWUP: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_conhecimento",
    description:
      "Cadastra um MATERIAL DE CONHECIMENTO de um cliente a partir de TEXTO: o que o agente consulta para responder além do prompt. Dois tipos: " +
      "`faq` (uma lista de perguntas e respostas) e `documento` (um texto corrido, pode ser Markdown: política, regulamento, descrição de serviços). " +
      "O material é indexado sozinho depois de gravado; a resposta diz se a indexação vai acontecer (`indexacao_habilitada`). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do material. " +
      "FAQ com o mesmo nome e outras perguntas tem as perguntas TROCADAS no mesmo material (os agentes continuam consultando). " +
      "Documento com o mesmo nome e o mesmo texto responde `ja_estava`; com outro texto é recusado, porque um documento não é editado no lugar " +
      "(grave com outro nome). Para conteúdo que muda sempre, prefira `faq`. " +
      `Tetos: ${TETO_DE_PERGUNTAS} perguntas, ou ${TETO_DO_DOCUMENTO.toLocaleString("pt-BR")} caracteres de texto, por chamada. ` +
      "DEPOIS DE CRIAR: ligue o material ao agente com plataforma_garantir_agente (`materiais`). Material que nenhum agente consulta não é usado. " +
      "O QUE NÃO FAZ: não recebe arquivo (PDF, planilha, áudio) nem endereço de site: isso é pela tela, em IA › Conhecimento.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(2).max(120).describe('O nome do material (ex.: "Perguntas frequentes"). É a chave para atualizar.'),
      tipo: z.enum(["faq", "documento"]).describe('"faq" para perguntas e respostas; "documento" para um texto corrido.'),
      perguntas: z
        .array(
          z
            .object({
              pergunta: z.string().trim().min(1).max(500),
              resposta: z.string().trim().min(1).max(4000),
              etiquetas: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
            })
            .strict(),
        )
        .max(TETO_DE_PERGUNTAS)
        .optional()
        .describe("Só para `faq`: a lista COMPLETA de perguntas e respostas (substitui as que existem no material)."),
      texto: z.string().max(TETO_DO_DOCUMENTO).optional().describe("Só para `documento`: o texto do material."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Perguntas frequentes",
      tipo: "faq",
      perguntas: [
        { pergunta: "Vocês atendem aos sábados?", resposta: "Sim, das 8h às 13h." },
        { pergunta: "Aceitam convênio?", resposta: "Não trabalhamos com convênio; emitimos recibo para reembolso." },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirConhecimento(c, pedido as unknown as PedidoDeConhecimento);
    },
  },

  {
    name: "plataforma_garantir_followup",
    description:
      "Instala um fluxo de FOLLOW-UP a partir de um MODELO pronto, ou ajusta um fluxo que já existe. Follow-up é a sequência de mensagens que procura de novo " +
      "quem parou de responder, faltou, ou entrou numa etapa do funil. " +
      "INSTALAR: informe `modelo` (o id, de plataforma_listar_modelos, seção followup). O fluxo nasce RASCUNHO, com os textos do modelo, e NÃO manda mensagem para ninguém. " +
      "Modelo que dispara por etapa pede `etapa` (funil e etapa pelo nome). " +
      "AJUSTAR: `textos` troca o texto de uma mensagem pelo id do nó (veja os nós em plataforma_ver_followup); `esperas` troca os minutos de uma espera; " +
      "`silencio_minutos`, `etapa` e `numero` ajustam o gatilho. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do fluxo (sem `nome`, vale o nome do modelo). " +
      "ORDEM: (1) esta ferramenta, (2) plataforma_garantir_agente com `followups` para ARMAR o fluxo no agente, (3) plataforma_publicar_followup, (4) plataforma_publicar_agente. " +
      "Fluxo com gatilho automático só inscreve alguém se um agente PUBLICADO o tem armado. " +
      "O QUE NÃO FAZ: não publica, não arma em agente, e não desenha fluxo do zero (isso é o construtor, na tela IA › Follow-ups). " +
      "Num fluxo já publicado, o texto muda no rascunho; o gatilho não muda sem desligar o fluxo antes.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      modelo: z.string().trim().min(1).max(80).optional().describe("O id do modelo a instalar. Obrigatório quando o fluxo ainda não existe."),
      nome: z.string().trim().min(1).max(80).optional().describe("O nome do fluxo. Sem isto, o nome do modelo. Para ajustar um fluxo existente, o nome dele."),
      etapa: z
        .object({
          funil: z.string().trim().min(1).max(120).describe("Nome (ou id) do funil."),
          etapa: z.string().trim().min(1).max(120).describe("Nome (ou id) da etapa que dispara o fluxo."),
        })
        .strict()
        .optional()
        .describe("Para fluxo que dispara quando o negócio ENTRA numa etapa."),
      textos: z
        .array(
          z
            .object({
              no: z.string().min(1).max(80).describe('O id do nó de mensagem (ex.: "msg-1").'),
              texto: z.string().min(1).max(4000).describe("O texto novo, exatamente como a pessoa vai ler."),
            })
            .strict(),
        )
        .max(30)
        .optional()
        .describe("Troca o texto das mensagens."),
      esperas: z
        .array(
          z
            .object({
              no: z.string().min(1).max(80).describe('O id do nó de espera (ex.: "espera-2").'),
              minutos: z.number().int().min(1).max(129_600).describe("A espera nova, em minutos."),
            })
            .strict(),
        )
        .max(30)
        .optional()
        .describe("Troca a duração das esperas."),
      silencio_minutos: z.number().int().min(5).max(129_600).optional().describe("Para gatilho de silêncio: depois de quantos minutos sem resposta o fluxo começa."),
      numero: z.string().trim().min(1).max(120).optional().describe("Para gatilho de negócio criado: por qual número abordar (id, nome ou telefone de um número conectado)."),
      cancelar_ao_responder: z.boolean().optional().describe("true encerra o fluxo na primeira resposta da pessoa."),
      quando_humano_assume: z
        .enum(["pause", "cancel", "allow"])
        .optional()
        .describe('O que acontece com o fluxo quando uma pessoa da equipe assume a conversa: "pause" (espera), "cancel" (encerra) ou "allow" (segue).'),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      modelo: "geral-retomada",
      textos: [{ no: "msg-1", texto: "Oi! Ficou alguma dúvida sobre o que conversamos?" }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirFollowup(c, pedido as PedidoDeFollowup);
    },
  },

  {
    name: "plataforma_publicar_followup",
    description:
      "PUBLICA (ou desliga) um fluxo de follow-up. Publicado e armado num agente no ar, ele passa a MANDAR MENSAGEM para os clientes da empresa conforme o gatilho. " +
      "A publicação roda a mesma validação da tela: gatilho com motor, etapa que existe, grafo alcançável, e modelo aprovado quando o número é o oficial. " +
      "A recusa diz o nó e o motivo. Publicar de novo sem mudança no rascunho responde `ja_estava`. " +
      "`ativo: false` DESLIGA o fluxo (ele para de inscrever gente; ninguém perde o histórico). " +
      "ANTES DE CHAMAR: leia os textos com plataforma_ver_followup. Texto que vai para cliente é conferido antes de sair. " +
      "O QUE NÃO FAZ: não arma o fluxo em agente (plataforma_garantir_agente, `followups`).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      fluxo: z.string().trim().min(1).max(120).describe("Nome ou id do fluxo."),
      ativo: z.boolean().optional().describe("true (padrão) publica; false desliga."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, fluxo: "Retomada · voltar a quem parou de responder" },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return publicarFollowup(c, { fluxo: String(args.fluxo), ativo: args.ativo !== false });
    },
  },
];

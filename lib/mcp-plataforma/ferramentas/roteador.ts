/**
 * As ferramentas do ROTEADOR DE INTENÇÃO: garantir (desligado) e ligar. As
 * operações moram em `lib/implantacao/roteador.ts`, e é lá que está escrito por
 * que o roteador nasce desligado aqui e ligado na tela.
 *
 * ── Duas operações, de propósito ──────────────────────────────────────────
 *
 * Montar o roteador (nome, número, agente reserva, intenções e o funil de
 * destino de cada uma) não muda quem responde a ninguém: é montagem
 * (`implantar_configuracao`). LIGAR faz o sistema passar a escolher o agente a
 * cada mensagem do número e, com destino de funil, a mover o negócio do
 * cliente: é `colocar_no_ar`.
 */
import { z } from "zod";

import { garantirRoteador, ligarRoteador, TETO_DE_INTENCOES, type PedidoDeRoteador } from "@/lib/implantacao/roteador";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const intencao = z
  .object({
    nome: z.string().trim().min(1).max(120).describe('O nome curto da intenção (ex.: "Comprar plano"). Não se repete no roteador.'),
    descricao: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe("QUANDO o classificador deve escolher esta intenção, em uma ou duas frases. É o que ele lê para decidir: descreva o que o cliente quer, não o que o agente faz."),
    exemplos: z
      .array(z.string().trim().min(1).max(300))
      .max(20)
      .optional()
      .describe('Frases que um cliente escreveria nesta intenção (ex.: "quanto custa o plano mensal?"). Ajudam nas mensagens curtas.'),
    agente: z.string().trim().min(1).max(120).describe("Nome (ou id) do agente que atende esta intenção. Tem de existir: plataforma_garantir_agente."),
    destino: z
      .object({
        funil: z.string().trim().min(1).max(120).describe("Nome (ou id) do funil para onde o negócio vai."),
        etapa: z.string().trim().min(1).max(120).optional().describe("Nome (ou id) da etapa de destino. Sem isto, a primeira etapa aberta do funil."),
      })
      .strict()
      .nullable()
      .optional()
      .describe(
        "Para onde o NEGÓCIO do cliente vai quando esta intenção casa, antes de o agente responder. Sem isto (ou null), o roteador só escolhe o agente e o card fica no funil de entrada. " +
          "Com destino, o card vai para o funil de destino e o negócio de origem é encerrado como transferência, que não conta como perda.",
      ),
  })
  .strict();

export const FERRAMENTAS_DE_ROTEADOR: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_roteador",
    description:
      "Cria ou ajusta o ROTEADOR DE INTENÇÃO de um número de WhatsApp de um cliente. É ele que divide o atendimento entre dois ou mais agentes publicados no MESMO número: " +
      "a cada mensagem, classifica a intenção do cliente e escolhe o agente daquela intenção. Cada intenção também pode levar o NEGÓCIO para o funil certo (`destino`). " +
      "QUANDO USAR: só quando há mais de um agente no mesmo número. Com um agente por número, não crie roteador. " +
      "O roteador NASCE DESLIGADO e continua desligado: ele só passa a decidir depois de plataforma_ligar_roteador. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do roteador. Só os campos que VIERAM mudam; pedido igual ao que está gravado responde `ja_estava`. " +
      `\`intencoes\` é a lista COMPLETA, na ordem (substitui a que existe), com até ${TETO_DE_INTENCOES} intenções. ` +
      "Roteador LIGADO não é editado por aqui (ele não tem rascunho: a mudança valeria na mensagem seguinte): desligue, ajuste e religue. " +
      "ORDEM RECOMENDADA: antes desta, crie e publique os agentes (plataforma_garantir_agente, plataforma_publicar_agente) e os funis de destino (plataforma_garantir_funil); o número precisa estar conectado. " +
      "A resposta traz `avisos` com o que conferir antes de ligar (agente fora do ar, falta de agente reserva, destino que move negócio). " +
      "O modelo de IA do classificador é da PLATAFORMA: não se informa aqui. " +
      "O QUE NÃO FAZ: não liga o roteador, não troca o número de um roteador que existe, não apaga roteador e não amarra roteiro de atendimento a uma intenção (isso é pela tela, em IA › Roteadores; o que já está amarrado é preservado).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).describe('O nome do roteador (ex.: "Recepção"). É a chave: chamar de novo com o mesmo nome ajusta o mesmo roteador.'),
      roteador_id: z.string().uuid().optional().describe("O id de um roteador que já existe. Só é preciso para RENOMEAR (o id acha o roteador, `nome` é o nome novo)."),
      numero: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe("O número de WhatsApp em que o roteador divide o atendimento: id, nome ou telefone de um número JÁ CONECTADO. Obrigatório para criar; depois não se troca."),
      agente_reserva: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .nullable()
        .optional()
        .describe("Nome (ou id) do agente que atende quando NENHUMA intenção casa. null tira. Sem reserva, responde o agente publicado no número."),
      intencoes: z
        .array(intencao)
        .max(TETO_DE_INTENCOES)
        .optional()
        .describe("As intenções do roteador, na ordem em que o classificador as lê. Lista completa: intenção que existe e o pedido não cita é REMOVIDA."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Recepção",
      numero: "Recepção",
      agente_reserva: "Bia",
      intencoes: [
        {
          nome: "Marcar avaliação",
          descricao: "A pessoa quer agendar, remarcar ou saber de horários para uma avaliação.",
          exemplos: ["tem horário amanhã?", "quero marcar uma avaliação"],
          agente: "Bia",
        },
        {
          nome: "Plano empresarial",
          descricao: "A pessoa fala em nome de uma empresa e quer convênio ou plano para os funcionários.",
          agente: "Caio",
          destino: { funil: "Empresas", etapa: "Novo contato" },
        },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirRoteador(c, pedido as unknown as PedidoDeRoteador);
    },
  },

  {
    name: "plataforma_ligar_roteador",
    description:
      "LIGA ou desliga o roteador de intenção de um número. Ligado, ele passa a decidir, a cada mensagem que chega ao número, QUAL agente responde, " +
      "e as intenções com destino passam a MOVER o negócio do cliente para o funil de destino. Desligado, volta a responder o agente publicado no número (o de maior prioridade). " +
      "ANTES DE LIGAR: confira o roteador em plataforma_ver_agentes (as intenções, o agente de cada uma e o destino) e publique os agentes das intenções. " +
      "Intenção que aponta para agente fora do ar cai no agente reserva. Só um roteador fica ligado por número: a recusa diz qual está ligado. " +
      "Roteador sem intenção não liga. Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "O QUE NÃO FAZ: não cria nem edita o roteador (plataforma_garantir_roteador), não publica agente e não mexe nas conversas que uma pessoa já assumiu.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      roteador: z.string().trim().min(1).max(120).describe("Nome ou id do roteador."),
      ligado: z.boolean().describe("true liga, false desliga."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, roteador: "Recepção", ligado: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return ligarRoteador(c, { roteador: String(args.roteador), ligado: args.ligado === true });
    },
  },
];

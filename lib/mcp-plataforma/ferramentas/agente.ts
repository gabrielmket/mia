/**
 * As ferramentas do AGENTE DE IA: garantir (rascunho), publicar e pausar. As
 * operações moram em `lib/implantacao/agente.ts`, e é lá que está escrito
 * quantos agentes uma organização pode ter e como o motor escolhe quem atende.
 *
 * ── Duas operações, de propósito ──────────────────────────────────────────
 *
 * Criar e editar o agente grava um RASCUNHO: nada chega ao cliente final, e por
 * isso é montagem (`implantar_configuracao`). Publicar faz o agente responder
 * às pessoas no WhatsApp da empresa, e pausar o cala: são `colocar_no_ar`.
 */
import { z } from "zod";

import { TAMANHO_MAXIMO_DO_TEXTO } from "@/lib/agent-engine/agent/aviso-fora-do-horario";
import { DEFAULT_SENTIMENT_THRESHOLD } from "@/lib/ai/prompts/sentiment";
import { garantirAgente, pausarAgente, publicarAgente, type PedidoDeAgente } from "@/lib/implantacao/agente";
import { PACOTES } from "@/lib/mcp/tools/pacotes";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, DIA_DA_SEMANA, HORA, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const janela = z
  .object({
    inicio: HORA.describe('Quando começa, em "HH:MM".'),
    fim: HORA.describe('Quando termina, em "HH:MM". Tem de ser depois do início.'),
    dias: z.array(DIA_DA_SEMANA).min(1).max(7).describe("Os dias da semana: 0 (domingo) a 6 (sábado)."),
  })
  .strict();

export const FERRAMENTAS_DE_AGENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_agente",
    description:
      "Cria ou altera um AGENTE DE IA de um cliente: o nome, o PROMPT, as capacidades (por pacote), os funis em que ele pode mexer, os materiais que consulta, " +
      "os follow-ups que arma, as palavras que passam a conversa para uma pessoa, o horário em que atende (e o aviso para quem escreve fora dele), o limiar de sentimento e o número de WhatsApp. " +
      "O que esta ferramenta grava é um RASCUNHO: nada muda no atendimento até plataforma_publicar_agente. " +
      "As exceções são do CADASTRO do agente e valem na hora: `nome`, `descricao`, `prioridade` e `limiar_de_sentimento`. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do agente. Agente novo nasce com a versão 1 em rascunho; " +
      "agente com rascunho tem o rascunho atualizado; agente só com versão publicada ganha um rascunho novo. " +
      "Só os campos que VIERAM mudam: chamar só com `prompt` troca o prompt e preserva o resto. Pedido igual ao que está gravado responde `ja_estava`. " +
      "A resposta traz `falta_para_publicar`, com quem resolve cada pendência (você, uma pessoa na tela, ou a plataforma). " +
      "QUANTOS AGENTES: uma organização pode ter vários. Responde a mensagem o agente publicado no NÚMERO em que ela chegou; " +
      "dois no mesmo número precisam de um roteador de intenção (plataforma_garantir_roteador). O desenho simples é um agente por número. " +
      "A IA (provedor, modelo e chave) é da PLATAFORMA: não se informa aqui, e o agente nasce com a IA padrão. " +
      `CAPACIDADES: \`pacotes\` liga as capacidades de cada pacote (${PACOTES.map((p) => p.id).join(", ")}); as de efeito que não dá para desfazer entram uma a uma, em \`capacidades\`. ` +
      `Até ${TETO_TOOLS_POR_AGENTE} capacidades por agente. Agente novo sem \`pacotes\` nasce com o pacote "vender". ` +
      "ORDEM RECOMENDADA: antes desta, crie o que o agente referencia: o funil (plataforma_garantir_funil), os materiais (plataforma_garantir_conhecimento) " +
      "e os follow-ups (plataforma_garantir_followup). O número pode ficar para depois: o rascunho nasce sem número. " +
      "O QUE NÃO FAZ: não publica, não troca o modelo de IA, não cria roteador (plataforma_garantir_roteador) e não arquiva agente.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).describe('O nome do agente (ex.: "Bia"). É a chave: chamar de novo com o mesmo nome altera o mesmo agente.'),
      agente_id: z.string().uuid().optional().describe("O id de um agente que já existe. Só é preciso para RENOMEAR (o id acha o agente, `nome` é o nome novo)."),
      descricao: z.string().trim().max(500).nullable().optional().describe("Para a equipe saber o que este agente faz."),
      prioridade: z.number().int().min(0).max(1000).optional().describe("Desempate entre agentes publicados no MESMO número: vence o maior. Padrão: 0."),
      prompt: z
        .string()
        .trim()
        .min(10)
        .max(20000)
        .optional()
        .describe(
          "O texto que diz ao agente quem ele é, o que a empresa faz, como conduz a conversa, o que qualifica, o que pode prometer e quando chama uma pessoa. " +
            "Obrigatório para agente novo. Não repita aqui preço e política que já estão no catálogo e na memória, nem nomes de ferramenta.",
        ),
      pacotes: z
        .array(z.enum(PACOTES.map((p) => p.id) as [string, ...string[]]))
        .max(PACOTES.length)
        .optional()
        .describe("Os pacotes de capacidade a ligar. Quando vem, SUBSTITUI a seleção inteira do agente (junto com `capacidades`)."),
      capacidades: z
        .array(z.string().min(1).max(80))
        .max(TETO_TOOLS_POR_AGENTE)
        .optional()
        .describe("Capacidades avulsas, pelo id (ex.: as críticas, que o pacote não liga sozinho). Ids em plataforma_listar_modelos, seção capacidades_do_agente."),
      funis: z.array(z.string().min(1)).max(50).optional().describe("Nomes (ou ids) dos funis em que o agente pode criar e mover negócio. Lista vazia = nenhum."),
      materiais: z.array(z.string().min(1)).max(100).optional().describe("Nomes (ou ids) dos materiais de conhecimento que o agente consulta."),
      followups: z
        .object({
          fluxos: z.array(z.string().min(1)).max(20).describe("Nomes (ou ids) dos fluxos de follow-up que este agente arma. Lista vazia desliga."),
          janela: janela.nullable().optional().describe("Em que horário os follow-ups podem SAIR. null = qualquer horário."),
        })
        .strict()
        .optional()
        .describe("Os follow-ups que o agente arma. Um fluxo com gatilho automático só inscreve alguém se um agente PUBLICADO o tem aqui."),
      palavras_de_passagem: z
        .array(z.string().trim().min(1).max(60))
        .max(20)
        .optional()
        .describe('Expressões que, ditas pelo cliente, passam a conversa para uma pessoa (ex.: "falar com atendente").'),
      passagem_para_humano: z.boolean().optional().describe("O agente pode pedir a passagem para uma pessoa por conta própria. Padrão: sim."),
      casos: z.boolean().optional().describe("O agente abre um caso para a equipe quando promete algo que depende de uma pessoa. Padrão: não."),
      dividir_mensagens: z.boolean().optional().describe("Quebra a resposta em mensagens curtas, como uma pessoa digitando. Padrão: não."),
      tamanho_da_mensagem: z.number().int().min(80).max(4000).optional().describe("Tamanho máximo de cada mensagem quando `dividir_mensagens` está ligado."),
      espera_por_rajada_ms: z
        .number()
        .int()
        .min(0)
        .max(60000)
        .nullable()
        .optional()
        .describe("Quanto esperar o cliente terminar de mandar várias mensagens seguidas antes de responder, em milissegundos. null = o padrão da instalação."),
      horario_de_atendimento: janela
        .extend({ fuso: z.string().min(1).max(64).optional().describe("Fuso da janela. Sem isto, o da empresa.") })
        .strict()
        .nullable()
        .optional()
        .describe("O horário em que o agente RESPONDE. null = responde a qualquer hora. Trocar a janela preserva o aviso de fora do horário que já existe."),
      aviso_fora_do_horario: z
        .string()
        .trim()
        .min(1)
        .max(TAMANHO_MAXIMO_DO_TEXTO)
        .nullable()
        .optional()
        .describe(
          "O texto que o sistema manda a quem escreve FORA do horário de atendimento, para a pessoa saber que a mensagem chegou e quando alguém responde. " +
            "Sai no máximo UMA vez por contato a cada período fechado, e nunca para contato bloqueado. Quando o horário abre, o agente responde normalmente. " +
            `Até ${TAMANHO_MAXIMO_DO_TEXTO} caracteres. null apaga o aviso. Só vale com \`horario_de_atendimento\` definido. Sem isto, fica o texto que está gravado.`,
        ),
      limiar_de_sentimento: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          `A nota de clima da conversa, de 0 a 1, abaixo da qual ela passa para uma pessoa. Padrão: ${DEFAULT_SENTIMENT_THRESHOLD}. ` +
            "Nota mais alta passa MAIS conversas para uma pessoa; mais baixa deixa só a hostilidade forte acionar a passagem. " +
            "Em segmento onde todo contato chega como queixa (advocacia, saúde, assistência técnica), relatar o problema não é irritação. " +
            "ATENÇÃO: é do cadastro do agente, não do rascunho. Vale na hora, sem publicar.",
        ),
      numero: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .nullable()
        .optional()
        .describe("O número de WhatsApp por onde o agente atende: id, nome ou telefone de um número JÁ CONECTADO. Pode ficar de fora e ser informado ao publicar."),
      max_passos: z.number().int().min(1).max(25).optional().describe("Quantas ações o agente pode encadear numa resposta. Padrão: 10."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Bia",
      descricao: "Atende quem chama no WhatsApp e agenda a avaliação.",
      prompt:
        "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer. Quando ela quiser marcar, ofereça os horários livres. Se pedir desconto ou falar de dor forte, chame uma pessoa da equipe.",
      pacotes: ["atender", "vender"],
      funis: ["Agendamentos"],
      palavras_de_passagem: ["falar com atendente", "pessoa de verdade"],
      horario_de_atendimento: { inicio: "08:00", fim: "20:00", dias: [1, 2, 3, 4, 5, 6] },
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirAgente(c, org, pedido as unknown as PedidoDeAgente);
    },
  },

  {
    name: "plataforma_publicar_agente",
    description:
      "PÕE NO AR o rascunho de um agente de IA: a partir daqui ele responde às pessoas que escrevem para o número da empresa. " +
      "ANTES DE CHAMAR: o número de WhatsApp precisa estar CONECTADO, e conectar é com uma pessoa, na tela Conexões (/app/connections). " +
      "Se o rascunho não tem número e a empresa tem um único número conectado, ele é escolhido sozinho; com mais de um, informe `numero`. " +
      "Quando algo impede a publicação, a recusa lista TODAS as pendências e quem resolve cada uma (você, uma pessoa na tela, ou a plataforma). " +
      "Chamar de novo sem rascunho novo responde `ja_estava`. " +
      "O QUE NÃO FAZ: não cria o agente (plataforma_garantir_agente), não conecta número e não cria roteador entre dois agentes do mesmo número (plataforma_garantir_roteador).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      agente: z.string().trim().min(1).max(120).describe("Nome ou id do agente."),
      numero: z.string().trim().min(1).max(120).optional().describe("Id, nome ou telefone do número conectado por onde o agente vai atender."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, agente: "Bia" },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return publicarAgente(c, { agente: String(args.agente), ...(typeof args.numero === "string" ? { numero: args.numero } : {}) });
    },
  },

  {
    name: "plataforma_pausar_agente",
    description:
      "PAUSA ou RETOMA um agente de IA. Pausado, ele para de responder na hora; a versão publicada continua guardada, e retomar o põe de volta sem publicar de novo. " +
      "QUANDO USAR: para calar um agente que foi ao ar com algo errado, enquanto o rascunho é corrigido. `pausar: false` retoma. " +
      "Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "O QUE NÃO FAZ: não despublica nem arquiva o agente, e não mexe nas conversas que uma pessoa já assumiu.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      agente: z.string().trim().min(1).max(120).describe("Nome ou id do agente."),
      pausar: z.boolean().describe("true pausa, false retoma."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, agente: "Bia", pausar: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return pausarAgente(c, { agente: String(args.agente), pausar: args.pausar === true });
    },
  },
];

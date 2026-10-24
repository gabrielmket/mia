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
import { MAX_FAIXAS_POR_DIA } from "@/lib/agent-engine/agent/horario-da-ia";
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

/**
 * .85 — uma faixa do horário de atendimento da IA. O fim aceita "24:00" (o fim
 * do dia); a conferência de cada faixa (fim depois do início, até 6 por dia,
 * nenhuma faixa) mora em `lib/implantacao/horario-da-ia.ts`, com a frase que
 * ensina.
 */
const FIM_DA_FAIXA = z
  .string()
  .regex(/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/, 'use "HH:MM" de 24 horas, ou "24:00" para o fim do dia');

const faixaDaIa = z
  .object({
    dias: z.array(DIA_DA_SEMANA).min(1).max(7).describe("Os dias desta faixa: 0 (domingo) a 6 (sábado)."),
    inicio: HORA.describe('Quando a IA fica ativa, em "HH:MM" ("00:00" a "23:59").'),
    fim: FIM_DA_FAIXA.describe('Quando a IA fica inativa, em "HH:MM", ou "24:00" (o fim do dia). Depois do início.'),
  })
  .strict();

/** O formato antigo, de UMA faixa, com a régua nova ("24:00" vale como fim). */
const faixaNoFormatoAntigo = z
  .object({
    inicio: HORA.describe('Quando a IA fica ativa, em "HH:MM".'),
    fim: FIM_DA_FAIXA.describe('Quando fica inativa, em "HH:MM" ou "24:00". Depois do início.'),
    dias: z.array(DIA_DA_SEMANA).min(1).max(7).describe("Os dias da semana: 0 (domingo) a 6 (sábado)."),
    fuso: z.string().min(1).max(64).optional().describe("Fuso. Sem isto, o da empresa."),
  })
  .strict()
  .describe('O formato antigo, de UMA faixa: { "inicio", "fim", "dias" }. Vira uma faixa.');

const horarioDaIa = z
  .object({
    faixas: z
      .array(faixaDaIa)
      .max(MAX_FAIXAS_POR_DIA * 7)
      .describe(`As faixas em que a IA fica ATIVA. Até ${MAX_FAIXAS_POR_DIA} por dia; as que se cruzam são unidas.`),
    fuso: z.string().min(1).max(64).optional().describe("Fuso do horário. Sem isto, o da empresa."),
  })
  .strict();

export const FERRAMENTAS_DE_AGENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_agente",
    description:
      "Cria ou altera um AGENTE DE IA de um cliente: o nome, o PROMPT, as capacidades (por pacote), os funis em que ele pode mexer, os materiais que consulta, " +
      "os follow-ups que arma, as palavras que passam a conversa para uma pessoa, se o assunto jurídico passa a conversa para uma pessoa, o HORÁRIO DE ATENDIMENTO DA IA (as faixas por dia em que ela fica ativa; fora delas ela não responde e a conversa é da equipe), o limiar de sentimento e o número de WhatsApp. " +
      "O que esta ferramenta grava é um RASCUNHO: nada muda no atendimento até plataforma_publicar_agente. " +
      "As exceções são do CADASTRO do agente e valem na hora: `nome`, `descricao`, `prioridade`, `limiar_de_sentimento` e `servidor_mcp_externo.no_atendimento`. " +
      "ATENÇÃO: `bloquear_afirmacao_clinica` é da EMPRESA, não do agente: liga ou desliga a proteção para TODOS os agentes do cliente, na hora. Só faz sentido em clínica e consultório. " +
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
      passagem_por_assunto_juridico: z
        .boolean()
        .optional()
        .describe(
          "Assunto jurídico (processo, advogado, ação na justiça) passa a conversa para uma pessoa. Padrão: sim. " +
            "Num escritório de advocacia esse é o vocabulário normal do cliente: ali desligue (false). O pedido explícito de falar com uma pessoa e as palavras de passagem seguem valendo. " +
            "É do rascunho: vale depois de publicar.",
        ),
      bloquear_afirmacao_clinica: z
        .boolean()
        .optional()
        .describe(
          "A proteção \"não fazer afirmação clínica\" da EMPRESA (vale para todos os agentes dela, na hora, sem publicar). Ligada, o agente não diz o que a pessoa tem, não indica remédio, pomada nem dose, " +
            "não garante resultado e não diz que uma lesão é câncer: reescreve oferecendo consulta, e se insistir a mensagem é barrada e um caso é aberto. " +
            "Nasce desligada; ligue só em clínica e consultório (em outro negócio ela barraria frases normais, como \"passe o creme\"). Não custa IA.",
        ),
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
      horario_de_atendimento: z
        .union([horarioDaIa, faixaNoFormatoAntigo])
        .nullable()
        .optional()
        .describe(
          "O HORÁRIO DE ATENDIMENTO DA IA: as faixas por dia em que ela fica ATIVA e responde. " +
            "FORA delas a IA fica INATIVA: não responde a mensagem que chegou, nem depois, e a conversa fica com a equipe (não há aviso automático). " +
            "Se o cliente escrever de novo com a IA ativa, ela responde lendo a conversa inteira. Os toques de follow-up que caem com ela inativa esperam a próxima abertura. " +
            'Forma: { "faixas": [{ "dias": [1,2,3,4,5], "inicio": "00:00", "fim": "10:00" }, { "dias": [1,2,3,4,5], "inicio": "17:30", "fim": "24:00" }], "fuso"?: "America/Sao_Paulo" }. ' +
            `"24:00" vale como fim do dia; até ${MAX_FAIXAS_POR_DIA} faixas por dia; faixas que se cruzam são unidas. ` +
            'A faixa que passa da meia-noite é DUAS: até "24:00" num dia e de "00:00" no seguinte. ' +
            "Zero faixas é recusado: para parar o agente, use plataforma_pausar_agente. " +
            "O formato antigo { inicio, fim, dias } continua aceito e vira uma faixa. Sem `fuso`, o da empresa. null = a IA responde a qualquer hora. " +
            "É do RASCUNHO: vale depois de publicar. Substitui o horário antigo (que adiava a resposta e tinha aviso). " +
            "A janela de RESPOSTA do número (anti-bloqueio, padrão 7h às 22h) continua valendo: o que a IA escrever fora dela sai na abertura; " +
            "plataforma_ver_agentes diz se o horário cai fora dela, e plataforma_configurar_canal (`janela_de_resposta`) a abre.",
        ),
      aviso_fora_do_horario: z
        .string()
        .trim()
        .min(1)
        .max(TAMANHO_MAXIMO_DO_TEXTO)
        .nullable()
        .optional()
        .describe(
          "SÓ DO HORÁRIO ANTIGO (o que adiava a resposta), que nenhum agente novo usa: o texto mandado a quem escrevia fora dele. " +
            "Com o horário de atendimento da IA (`horario_de_atendimento`) é RECUSADO: fora das faixas a IA fica inativa e a conversa é da equipe, que responde. " +
            `Até ${TAMANHO_MAXIMO_DO_TEXTO} caracteres. null apaga um aviso antigo.`,
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
      // .81 — o servidor MCP externo da empresa no agente (upstream v1.83).
      servidor_mcp_externo: z
        .object({
          ferramentas: z
            .array(
              z
                .object({
                  nome: z.string().trim().min(1).max(64).describe("O nome EXATO da ferramenta, como o servidor a anuncia."),
                  leitura: z
                    .boolean()
                    .optional()
                    .describe("true (o padrão): só consulta. false: a ferramenta escreve no sistema do cliente, e não monta em conversa com cliente."),
                })
                .strict(),
            )
            .max(30)
            .optional()
            .describe("A lista INTEIRA das ferramentas do servidor que o agente pode usar (substitui as escolhidas; [] tira todas). Vai para o RASCUNHO."),
          no_atendimento: z
            .boolean()
            .optional()
            .describe(
              "true: o servidor também é usado nas CONVERSAS com cliente, e cada consulta leva a ele a identidade de quem está falando (id, telefone, canal). " +
                "É do CADASTRO do agente e vale na hora. Nasce desligado.",
            ),
        })
        .strict()
        .optional()
        .describe(
          "As ferramentas do SERVIDOR MCP EXTERNO da empresa (cadastrado por plataforma_configurar_servidor_mcp_externo) que este agente pode usar. " +
            "Recusado na empresa de demonstração.",
        ),
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
      horario_de_atendimento: {
        faixas: [
          { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "08:00" },
          { dias: [1, 2, 3, 4, 5], inicio: "18:00", fim: "24:00" },
          { dias: [0, 6], inicio: "00:00", fim: "24:00" },
        ],
      },
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
      "Se houver OUTRO agente publicado e no ar no mesmo número, é ele que passa a responder ali; com todos os agentes do número pausados, o número fica sem resposta automática. " +
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

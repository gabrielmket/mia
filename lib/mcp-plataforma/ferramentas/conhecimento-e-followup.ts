/**
 * As ferramentas de CONHECIMENTO (por texto) e de FOLLOW-UP. As operações moram
 * em `lib/implantacao/conhecimento.ts`, `lib/implantacao/followup.ts` e (.84,
 * a cópia de fluxo do upstream 1.86) `lib/implantacao/copiar-followup.ts`.
 */
import { z } from "zod";

import {
  garantirConhecimento,
  TETO_DE_PERGUNTAS,
  TETO_DO_DOCUMENTO,
  type PedidoDeConhecimento,
} from "@/lib/implantacao/conhecimento";
import { MAX_PAUSA_DE_REENTRADA_MINUTES } from "@/lib/followup/pausa-de-reentrada";
import { copiarFollowup, type PedidoDeCopiaDeFollowup } from "@/lib/implantacao/copiar-followup";
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
      "AJUSTAR: `textos` troca o texto de uma mensagem pelo id do nó (veja os nós em plataforma_ver_followup) e, no texto fixo, a `midia` (imagem ou PDF que sai com o texto de legenda); `esperas` troca os minutos de uma espera; " +
      "`silencio_minutos`, `silencio_maximo_minutos`, `pausa_para_recomecar_minutos`, `so_se_a_equipe_respondeu`, `repeticoes_por_contato`, `etapa` e `numero` ajustam o gatilho. " +
      "MEXER NO NEGÓCIO SEM FALAR COM O CLIENTE: `mover_no_funil` garante uma caixa que leva o card para uma etapa, e `etiquetar` uma caixa que grava etiquetas. " +
      "Cada uma entra ANTES de um nó (`antes_de`): antes do fim «sem resposta» para marcar quem não respondeu, antes de uma mensagem para mover na hora em que ela sai. " +
      "Com `no`, ajusta uma caixa que já existe (feita aqui ou na tela). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do fluxo (sem `nome`, vale o nome do modelo); a caixa é achada pelo lugar onde está. " +
      "ORDEM: (1) esta ferramenta, (2) plataforma_garantir_agente com `followups` para ARMAR o fluxo no agente, (3) plataforma_publicar_followup, (4) plataforma_publicar_agente. " +
      "Fluxo com gatilho automático só inscreve alguém se um agente PUBLICADO o tem armado. " +
      "O QUE NÃO FAZ: não publica, não arma em agente, não tira caixa e não desenha fluxo do zero nem ramificação (isso é o construtor, na tela IA › Follow-ups). " +
      "Num fluxo já publicado, textos, esperas e caixas mudam no rascunho; o gatilho não muda sem desligar o fluxo antes.",
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
              texto: z.string().min(1).max(4000).optional().describe("O texto novo, exatamente como a pessoa vai ler."),
              // .83 — upstream 1.85 (#2734): a mídia do passo de texto fixo.
              midia: z
                .string()
                .trim()
                .url()
                .max(2000)
                .nullable()
                .optional()
                .describe(
                  "Só no passo de TEXTO FIXO: o endereço de uma imagem (.jpg, .png, .webp, .gif) ou de um PDF que sai junto, com o texto como legenda. " +
                    "O endereço tem de terminar na extensão do arquivo. No número oficial, fora da janela de 24 horas, o passo é pulado (nem a mídia nem o texto saem). null tira.",
                ),
            })
            .strict(),
        )
        .max(30)
        .optional()
        .describe("Troca o texto das mensagens e, no texto fixo, a mídia que sai junto (cada item traz `texto`, `midia` ou os dois)."),
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
      silencio_maximo_minutos: z
        .number()
        .int()
        .min(5)
        .max(10_080)
        .nullable()
        .optional()
        .describe(
          "Para gatilho de silêncio: o TETO do silêncio. O fluxo só começa para quem está calado entre `silencio_minutos` e este valor. " +
            "Sem teto, ligar um fluxo de «10 minutos depois» dispara de uma vez para todo mundo que está calado há dias. Precisa ser maior que `silencio_minutos`. null tira o teto.",
        ),
      pausa_para_recomecar_minutos: z
        .number()
        .int()
        .min(0)
        .max(MAX_PAUSA_DE_REENTRADA_MINUTES)
        .nullable()
        .optional()
        .describe(
          "Para gatilho de silêncio: quanto esperar antes de o fluxo RECOMEÇAR para quem já passou por ele (1440 = um dia). " +
            "Sem pausa, quem responde «obrigado» a uma mensagem do fluxo volta a ser inscrito logo depois. 0 ou null = sem pausa.",
        ),
      pausa_conta_do_ultimo_envio: z
        .boolean()
        .optional()
        .describe(
          "De onde a pausa conta. false (padrão): da última mensagem do CLIENTE, e cada mensagem nova recomeça a contagem. " +
            "true: do fim do último envio deste fluxo, para o toque curto que roda no máximo uma vez por dia. Só vale com `pausa_para_recomecar_minutos`.",
        ),
      // .84 — upstream 1.86 (#3048): os dois freios novos do gatilho de silêncio.
      so_se_a_equipe_respondeu: z
        .boolean()
        .optional()
        .describe(
          "Para gatilho de silêncio: true só começa o fluxo para quem a EQUIPE já respondeu depois da última mensagem do cliente. " +
            "Sem isto (o padrão), o fluxo alcança também quem escreveu e ficou sem atendimento, e pergunta «ainda tem interesse?» a quem está esperando resposta. false desliga.",
        ),
      repeticoes_por_contato: z
        .number()
        .int()
        .min(1)
        .max(50)
        .nullable()
        .optional()
        .describe(
          "Para gatilho de silêncio: quantas vezes NO MÁXIMO o fluxo começa para o mesmo contato (as tentativas canceladas no meio contam). " +
            "A pausa só espaça os recomeços; sem limite, quem nunca responde recomeça para sempre. null tira o limite. " +
            "Nesta plataforma o fluxo já não recomeça no MESMO silêncio (só depois de o contato escrever de novo); o limite conta por cima disso.",
        ),
      mover_no_funil: z
        .array(
          z
            .object({
              antes_de: z.string().min(1).max(120).optional().describe('O id do nó ANTES do qual a caixa entra (ex.: "fim-esgotou"). Toda seta que chegava nele passa pela caixa.'),
              no: z.string().min(1).max(120).optional().describe("O id de uma caixa de mover que JÁ existe, para trocar a etapa de destino. Use este OU `antes_de`."),
              funil: z.string().trim().min(1).max(120).describe("Nome (ou id) do funil da etapa de destino."),
              etapa: z.string().trim().min(1).max(120).describe("Nome (ou id) da etapa para onde o card vai."),
              rotulo: z.string().trim().min(1).max(60).optional().describe("O nome da caixa no construtor. Sem isto, «Mover card de etapa»."),
            })
            .strict(),
        )
        .max(10)
        .optional()
        .describe(
          "Caixas que MOVEM o card no funil quando o fluxo chega ali, sem mandar mensagem. " +
            'Ex.: [{ "antes_de": "fim-esgotou", "funil": "Agendamentos", "etapa": "Sem resposta" }]. Os ids dos nós estão em plataforma_ver_followup.',
        ),
      etiquetar: z
        .array(
          z
            .object({
              antes_de: z.string().min(1).max(120).optional().describe("O id do nó ANTES do qual a caixa entra."),
              no: z.string().min(1).max(120).optional().describe("O id de uma caixa de etiquetar que JÁ existe, para trocar as etiquetas. Use este OU `antes_de`."),
              etiquetas: z.array(z.string().max(60)).min(1).max(10).describe("As etiquetas a gravar, até 10, cada uma com até 60 caracteres. Prefira as do vocabulário (plataforma_garantir_etiquetas)."),
              rotulo: z.string().trim().min(1).max(60).optional().describe("O nome da caixa no construtor. Sem isto, «Gravar tag no lead»."),
            })
            .strict(),
        )
        .max(10)
        .optional()
        .describe(
          "Caixas que GRAVAM ETIQUETAS no negócio quando o fluxo chega ali, sem mandar mensagem. " +
            'Ex.: [{ "antes_de": "fim-esgotou", "etiquetas": ["Follow-up sem resposta"] }].',
        ),
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

  // .84 — upstream 1.86 (#3056): exportar e importar fluxo de follow-up.
  {
    name: "plataforma_copiar_followup",
    description:
      "COPIA um fluxo de FOLLOW-UP para um cliente: de OUTRA EMPRESA da plataforma (`de_outra_empresa`: a empresa e o fluxo, ex.: o fluxo que já funciona na Empresa Modelo) " +
      "ou de um ARQUIVO `.fluxo.json` exportado pela tela (`arquivo`). É a exportação e a importação de fluxos da tela IA › Follow-ups, sem o arquivo passar de mão em mão. " +
      "O fluxo copiado nasce RASCUNHO e NÃO manda mensagem para ninguém. Etapas, modelos de mensagem, responsáveis e próximos fluxos citados são conferidos contra o cliente: " +
      "o que existe com o mesmo id fica, o que tem o mesmo NOME aqui é ligado sozinho, e o resto é esvaziado e volta em `pendencias` (as com `bloqueia: true` impedem a publicação até serem resolvidas). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME no cliente (`nome`, ou o do fluxo de origem): se já existe um fluxo com esse nome, nada é copiado (`ja_estava`). " +
      "ORDEM: crie antes os funis, as etapas e os modelos de mensagem que o fluxo cita (para casarem pelo nome); depois esta ferramenta; depois plataforma_ver_followup, os ajustes em plataforma_garantir_followup, " +
      "plataforma_publicar_followup e, se o gatilho é automático, plataforma_garantir_agente com `followups`. " +
      "O QUE NÃO FAZ: não publica, não arma em agente, não sobrescreve fluxo e não copia roteiro de atendimento (outra superfície).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      de_outra_empresa: z
        .object({
          organization_id: z.string().uuid().describe("A empresa de ORIGEM (de plataforma_listar_clientes ou plataforma_listar_demonstracoes)."),
          fluxo: z.string().trim().min(1).max(120).describe("O nome (ou id) do fluxo de follow-up na empresa de origem."),
        })
        .strict()
        .optional()
        .describe("De onde copiar, quando o fluxo está em outra empresa da plataforma. Use este OU `arquivo`."),
      arquivo: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('O conteúdo de um arquivo ".fluxo.json" exportado pela tela (o objeto inteiro, com `format`, `version`, `flow` e `refs`). Use este OU `de_outra_empresa`.'),
      nome: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("O nome do fluxo no cliente. Sem isto, o nome do fluxo de origem. É a chave para não duplicar."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      de_outra_empresa: { organization_id: "00000000-0000-4000-8000-000000000002", fluxo: "Retomada · voltar a quem parou de responder" },
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return copiarFollowup(c, pedido as PedidoDeCopiaDeFollowup);
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

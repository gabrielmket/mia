/**
 * As ferramentas dos DADOS DA EMPRESA e da DISTRIBUIÇÃO do atendimento. As
 * operações moram em `lib/implantacao/empresa.ts`.
 */
import { z } from "zod";

import {
  configurarAtendimento,
  configurarEmpresa,
  type PedidoDeAtendimento,
  type PedidoDeEmpresa,
} from "@/lib/implantacao/empresa";
import { PRAZO_MAX_MINUTOS, PRAZO_MIN_MINUTOS } from "@/lib/escalacao/devolucao-automatica";
import { recusar } from "@/lib/mcp-plataforma/recusa";
import { MOEDAS_SERVIDAS } from "@/lib/money";
import { ROUTING_MODES } from "@/lib/schemas/routing";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_EMPRESA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_configurar_empresa",
    description:
      "Ajusta os DADOS DA EMPRESA de um cliente: nome de exibição, razão social, CNPJ, fuso horário, idioma, moeda, modo de venda (para empresas ou para pessoas), " +
      "e os dados de privacidade (e-mail do encarregado, endereço da política, dias de retenção de mídia e se a limpeza automática de mídia antiga está ligada). " +
      "Grava também a META DO MÊS (`meta_do_mes`, o faturamento dos negócios ganhos da empresa inteira, em centavos): é ela que vira a barra do painel \"Meta do mês\" e do link para o dono. " +
      "Só os campos que VIERAM mudam; o que veio igual ao que está gravado responde `ja_estava`. " +
      "Trocar o `pais` sem mandar `fuso` leva o fuso sugerido do país, como na tela. " +
      "ATENÇÃO: `limpeza_automatica_de_midia` ligada apaga, na limpeza diária, a mídia das conversas e o anexo de nota interna mais velhos que `dias_de_retencao_de_midia`, sem volta. Ela nasce ligada em toda empresa. " +
      "QUANDO USAR: logo depois de criar o cliente, antes do catálogo (a MOEDA da empresa é a que os produtos novos recebem) e da agenda (o FUSO é o das jornadas e dos horários). " +
      "`modo_de_venda`: \"b2b\" mostra a aba Empresas e pede empresa, cargo e setor no cadastro; \"misto\" (vende para empresas e para pessoas) mostra igual, com a empresa sempre opcional; \"b2c\" esconde tudo isso. " +
      "O QUE NÃO FAZ: não muda o identificador da empresa na URL, não suspende nem apaga a empresa, e não mexe na marca (logo e cor).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).optional().describe("O nome que aparece no produto e nas mensagens."),
      razao_social: z.string().trim().min(1).max(200).optional(),
      cnpj: z.string().trim().max(20).nullable().optional().describe('O CNPJ (ex.: "00.000.000/0001-00"). null apaga.'),
      pais: z
        .string()
        .regex(/^[A-Z]{2}$/, 'duas letras maiúsculas, ex.: "BR"')
        .nullable()
        .optional()
        .describe(
          'O país da empresa, em duas letras (ex.: "BR", "PT"). Decide a lei citada e a língua dos avisos ao encarregado. ' +
            "TROCAR o país sem mandar `fuso` leva o fuso sugerido do país (Portugal: Europe/Lisbon), como a tela faz; mande `fuso` junto para escolher outro.",
        ),
      fuso: z.string().trim().min(1).max(64).optional().describe('O fuso da empresa, pelo nome da região sem acento (ex.: "America/Sao_Paulo").'),
      idioma: z.string().trim().min(2).max(10).optional().describe('O idioma da interface para a equipe (ex.: "pt-BR").'),
      moeda: z.enum(MOEDAS_SERVIDAS).optional().describe("A moeda dos valores e dos produtos novos."),
      modo_de_venda: z
        .enum(["b2b", "misto", "b2c"])
        .optional()
        .describe('"b2b" = vende para empresas; "misto" = para empresas e para pessoas; "b2c" = vende para pessoas.'),
      dias_de_retencao_de_midia: z.number().int().min(30).max(3650).optional().describe("Por quantos dias a mídia das conversas é guardada."),
      limpeza_automatica_de_midia: z
        .boolean()
        .optional()
        .describe(
          "Liga (true) ou desliga (false) a limpeza automática de mídia antiga. Ligada, a limpeza diária apaga fotos, áudios, documentos e o anexo de nota interna " +
            "com mais de `dias_de_retencao_de_midia` dias; a conversa mostra que a mídia foi apagada. Desligada, nada é apagado por idade e o armazenamento cresce sem teto.",
        ),
      email_do_encarregado: z.string().email().max(200).nullable().optional().describe("O e-mail de quem responde pelos dados pessoais na empresa."),
      politica_de_privacidade_url: z
        .string()
        .url()
        .max(2048)
        .nullable()
        .optional()
        .describe("O endereço (https://...) da política de privacidade da empresa."),
      meta_do_mes: z
        .object({
          valor_cents: z
            .number()
            .int()
            .positive()
            .max(1_000_000_000_000)
            .describe("A meta de faturamento do mês, em CENTAVOS (ex.: 10000000 = R$ 100.000,00)."),
          mes: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use AAAA-MM, ex.: "2026-10"')
            .optional()
            .describe('O mês da meta, AAAA-MM. Ausente: o mês corrente no fuso da empresa.'),
        })
        .strict()
        .optional()
        .describe(
          "A meta do mês da empresa inteira: a soma do valor dos negócios GANHOS no mês, nos funis em que ganhar é receita. " +
            "É a mesma meta da tela Desempenho (sem pessoa nem agente). A mesma meta já gravada responde `ja_estava`.",
        ),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, nome: "Clínica Exemplo", fuso: "America/Sao_Paulo", moeda: "BRL", modo_de_venda: "b2c" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { organization_id: _org, ...pedido } = args;
      if (Object.keys(pedido).length === 0) {
        recusar('Informe ao menos um campo para ajustar. Ex.: { "fuso": "America/Sao_Paulo", "modo_de_venda": "b2c" }');
      }
      const { c, org } = await alvo(ctx, args);
      return configurarEmpresa(c, org, pedido as PedidoDeEmpresa);
    },
  },

  {
    name: "plataforma_configurar_atendimento",
    description:
      "Ajusta a DISTRIBUIÇÃO DO ATENDIMENTO de um cliente: quem recebe o cliente novo, o que cada atendente enxerga, quando a IA volta a responder e se a mensagem mostra quem fala. " +
      "`modo`: \"manual\" (alguém assume cada conversa), \"round_robin\" (rodízio entre quem está de plantão) ou \"load\" (vai para quem está com MENOS conversas abertas; no empate, o rodízio decide). " +
      "O `modo` daqui vale para os números SEM regra própria: um número com modo próprio (plataforma_configurar_canal, `distribuicao`) segue o dele. " +
      "`visibilidade` do papel Atendente: \"all\" (vê tudo), \"own_and_unassigned\" (o que é dele e o que não tem dono) ou \"own\" (só o que é dele). " +
      "A mesma régua decide o que o atendente pode ASSUMIR e TRANSFERIR: conversa que ele não enxerga, ele também não assume nem repassa (gestor e administrador seguem com tudo). " +
      "`devolver_para_a_ia_apos_minutos`: depois de quanto tempo sem sinal de uma pessoa a conversa volta para o agente (null = nunca volta sozinha). " +
      "`conversa_fica_com_quem_atendeu`: quem responde pelo Inbox assume a conversa, e ela volta para a mesma pessoa quando o cliente escreve de novo. " +
      "`ia_espera_apos_resposta_pelo_celular_minutos`: quanto a IA fica calada depois que alguém da equipe responde pelo celular, fora do sistema. " +
      "`assinatura`: o nome de quem fala (o atendente, ou a IA) em negrito, na linha de cima de cada mensagem enviada ao cliente. Nasce desligada. " +
      "`ia_decide_nas_automacoes`: o freio da empresa inteira para o passo \"a IA decide\" das automações; false faz toda regra com esse passo parar sem consultar a IA (e sem gastar). Nasce ligado. " +
      "`colegas_podem_mexer_na_agenda`: o atendente marca, remarca e cancela na agenda dos colegas (nasce ligado); false deixa cada atendente só na própria agenda (gestor e administrador seguem mexendo em todas). " +
      "`google_meet_com_acesso_aberto`: a reunião do Google Meet que o sistema cria já nasce com o acesso aberto a quem tem o link, sem sala de espera (nasce desligado). " +
      "Só os campos que VIERAM mudam; pedido igual ao que está gravado responde `ja_estava`. As duas primeiras decisões andam juntas: rodízio sem restringir a visibilidade deixa todo mundo vendo a carteira do colega. " +
      "ATENÇÃO: tudo aqui vale na hora, inclusive para o agente que já está no ar. A assinatura ligada aparece na PRÓXIMA mensagem que o cliente final receber. " +
      "O QUE NÃO FAZ: não define a distribuição de cada NÚMERO (quem recebe, o modo próprio e o atendente padrão do número: é plataforma_configurar_canal, `distribuicao`) " +
      "e não escolhe o grupo de avisos (Admin › Número de avisos).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      modo: z.enum(ROUTING_MODES).optional(),
      visibilidade: z.enum(["all", "own_and_unassigned", "own"]).optional(),
      devolver_para_a_ia_apos_minutos: z
        .number()
        .int()
        .min(PRAZO_MIN_MINUTOS)
        .max(PRAZO_MAX_MINUTOS)
        .nullable()
        .optional()
        .describe(`De ${PRAZO_MIN_MINUTOS} a ${PRAZO_MAX_MINUTOS} minutos. null = a conversa nunca volta sozinha para o agente.`),
      conversa_fica_com_quem_atendeu: z.boolean().optional(),
      ia_espera_apos_resposta_pelo_celular_minutos: z
        .number()
        .int()
        .min(PRAZO_MIN_MINUTOS)
        .max(PRAZO_MAX_MINUTOS)
        .nullable()
        .optional()
        .describe(
          `De ${PRAZO_MIN_MINUTOS} a ${PRAZO_MAX_MINUTOS} minutos. null = o padrão de 60. Cada resposta pelo celular renova o prazo: ` +
            "numa empresa que atende o dia inteiro pelo celular, um prazo longo deixa a IA sem responder ninguém.",
        ),
      assinatura: z
        .object({
          atendentes: z.boolean().optional().describe("Assina as mensagens das pessoas da equipe com o nome de quem respondeu."),
          ia: z.boolean().optional().describe("Assina as mensagens do agente de IA com `nome_da_ia`."),
          // A régua do nome (1 a 120, sem asterisco nem quebra de linha) é a da
          // tela, `assinaturaEntradaSchema`, conferida na operação.
          nome_da_ia: z
            .string()
            .max(200)
            .optional()
            .describe('O nome que assina as mensagens da IA (ex.: "Assistente Virtual", ou o nome do agente). De 1 a 120 caracteres, sem asterisco e sem quebra de linha.'),
        })
        .strict()
        .optional()
        .describe(
          "Mostra QUEM FALA em negrito, na linha de cima da mensagem que vai ao cliente, para ele saber quando a conversa passa de uma pessoa para outra ou para a IA. " +
            'Só as chaves que vieram mudam. Ex.: { "atendentes": true, "ia": true, "nome_da_ia": "Assistente Virtual" }. Mensagem de automação não é assinada.',
        ),
      ia_decide_nas_automacoes: z
        .boolean()
        .optional()
        .describe(
          'Liga (true) ou desliga (false), para a empresa inteira, o passo "a IA decide" das automações (a ação `ai_decide` de plataforma_garantir_automacao). ' +
            "Desligado, cada regra com esse passo para nele sem chamar a IA, e a aba Atividade das automações diz que a empresa desligou. As outras ações da regra seguem.",
        ),
      // .81 — as duas opções da agenda do upstream (1.80 #978 e 1.81 #2063, 0648).
      colegas_podem_mexer_na_agenda: z
        .boolean()
        .optional()
        .describe(
          "true (o padrão): o atendente pode marcar, remarcar e cancelar compromissos na agenda dos colegas. false: cada atendente só mexe na própria agenda. " +
            "Gestor e administrador mexem em todas nos dois casos.",
        ),
      google_meet_com_acesso_aberto: z
        .boolean()
        .optional()
        .describe(
          "true: a reunião do Google Meet criada pelo sistema já nasce com o acesso aberto (quem tem o link entra sem esperar ser admitido). false (o padrão): a sala de espera do Google vale.",
        ),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, modo: "round_robin", visibilidade: "own_and_unassigned", devolver_para_a_ia_apos_minutos: 60 },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { organization_id: _org, ...pedido } = args;
      if (Object.keys(pedido).length === 0) {
        recusar('Informe ao menos um campo para ajustar. Ex.: { "modo": "round_robin" }');
      }
      const { c } = await alvo(ctx, args);
      return configurarAtendimento(c, pedido as PedidoDeAtendimento);
    },
  },
];

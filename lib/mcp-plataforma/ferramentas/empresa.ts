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
      "e os dados de privacidade (e-mail do encarregado, endereço da política, dias de retenção de mídia). " +
      "Só os campos que VIERAM mudam; o que veio igual ao que está gravado responde `ja_estava`. " +
      "QUANDO USAR: logo depois de criar o cliente, antes do catálogo (a MOEDA da empresa é a que os produtos novos recebem) e da agenda (o FUSO é o das jornadas e dos horários). " +
      "`modo_de_venda`: \"b2b\" mostra a aba Empresas e pede empresa, cargo e setor no cadastro; \"b2c\" esconde tudo isso. " +
      "O QUE NÃO FAZ: não muda o identificador da empresa na URL, não suspende nem apaga a empresa, e não mexe na marca (logo e cor).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).optional().describe("O nome que aparece no produto e nas mensagens."),
      razao_social: z.string().trim().min(1).max(200).optional(),
      cnpj: z.string().trim().max(20).nullable().optional().describe('O CNPJ (ex.: "00.000.000/0001-00"). null apaga.'),
      pais: z.string().regex(/^[A-Z]{2}$/, 'duas letras maiúsculas, ex.: "BR"').nullable().optional(),
      fuso: z.string().trim().min(1).max(64).optional().describe('O fuso da empresa, pelo nome da região sem acento (ex.: "America/Sao_Paulo").'),
      idioma: z.string().trim().min(2).max(10).optional().describe('O idioma da interface para a equipe (ex.: "pt-BR").'),
      moeda: z.enum(MOEDAS_SERVIDAS).optional().describe("A moeda dos valores e dos produtos novos."),
      modo_de_venda: z.enum(["b2b", "b2c"]).optional().describe('"b2b" = vende para empresas; "b2c" = vende para pessoas.'),
      dias_de_retencao_de_midia: z.number().int().min(30).max(3650).optional().describe("Por quantos dias a mídia das conversas é guardada."),
      email_do_encarregado: z.string().email().max(200).nullable().optional().describe("O e-mail de quem responde pelos dados pessoais na empresa."),
      politica_de_privacidade_url: z
        .string()
        .url()
        .max(2048)
        .nullable()
        .optional()
        .describe("O endereço (https://...) da política de privacidade da empresa."),
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
      "`visibilidade` do papel Atendente: \"all\" (vê tudo), \"own_and_unassigned\" (o que é dele e o que não tem dono) ou \"own\" (só o que é dele). " +
      "`devolver_para_a_ia_apos_minutos`: depois de quanto tempo sem sinal de uma pessoa a conversa volta para o agente (null = nunca volta sozinha). " +
      "`conversa_fica_com_quem_atendeu`: quem responde pelo Inbox assume a conversa, e ela volta para a mesma pessoa quando o cliente escreve de novo. " +
      "`ia_espera_apos_resposta_pelo_celular_minutos`: quanto a IA fica calada depois que alguém da equipe responde pelo celular, fora do sistema. " +
      "`assinatura`: o nome de quem fala (o atendente, ou a IA) em negrito, na linha de cima de cada mensagem enviada ao cliente. Nasce desligada. " +
      "Só os campos que VIERAM mudam; pedido igual ao que está gravado responde `ja_estava`. As duas primeiras decisões andam juntas: rodízio sem restringir a visibilidade deixa todo mundo vendo a carteira do colega. " +
      "ATENÇÃO: tudo aqui vale na hora, inclusive para o agente que já está no ar. A assinatura ligada aparece na PRÓXIMA mensagem que o cliente final receber. " +
      "O QUE NÃO FAZ: não define quais atendentes recebem cada NÚMERO (Configurações › Atendimento, depois de o número estar conectado e a equipe ter aceitado o convite) " +
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

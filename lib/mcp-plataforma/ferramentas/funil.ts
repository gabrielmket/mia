/**
 * `plataforma_garantir_funil` — o funil de um cliente, com etapas, passo do
 * agente, campos e motivos. A operação mora em `lib/implantacao/funil.ts`.
 */
import { z } from "zod";

import { LEAD_STAGES } from "@/lib/agent-engine/agent/lead-state";
import { garantirFunil, TETO_DE_ETAPAS, type PedidoDeFunil } from "@/lib/implantacao/funil";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const etapa = z
  .object({
    nome: z.string().trim().min(1).max(80).describe("O que aparece no topo da coluna do quadro."),
    passo: z
      .enum(LEAD_STAGES)
      .nullable()
      .describe(
        'Quando o AGENTE move o negócio para esta etapa: "new" (acabou de chamar), "contacted" (já foi respondido), "qualifying" (entendendo o que precisa), ' +
          '"qualified" (já dá para oferecer), "negotiating" (fechando condições), "won" (FECHOU: esta é a etapa de ganho), "lost" (NÃO FECHOU: esta é a de perda). ' +
          "null = etapa que só pessoas movem. Cada passo vale para UMA etapa só.",
      ),
    probabilidade: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional()
      .describe("Chance de fechamento, de 0 a 100, usada na previsão do funil. Não se aplica às etapas de ganho e de perda."),
    // A régua (1 a 8760 horas inteiras) é a da tela de etapas, upstream 1.70 (#2161).
    prazo_esperado_horas: z
      .number()
      .int()
      .min(1)
      .max(8760)
      .nullable()
      .optional()
      .describe(
        "A janela de ESFRIANDO da etapa: quantas horas INTEIRAS um negócio costuma ficar nela (de 1 a 8760). Passou disso, o radar de risco o marca como esfriando. " +
          "null volta ao padrão do radar (24 h e 72 h). ATENÇÃO: diminuir a janela de uma etapa cheia esfria vários negócios de uma vez na passada seguinte do radar.",
      ),
    cor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'use o formato #rrggbb, ex.: "#12a594"')
      .nullable()
      .optional()
      .describe("A cor da coluna no quadro, em #rrggbb."),
    avisar_na_central: z.boolean().optional().describe("Negócio que ENTRA nesta etapa abre um aviso na Central da equipe."),
  })
  .strict();

const campo = z
  .object({
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/i, 'use letras, números e sublinhado, começando por letra (ex.: "plano_de_interesse")')
      .describe("A chave técnica do campo. É por ela que uma nova chamada atualiza o campo em vez de criar outro."),
    label: z.string().min(1).max(80).describe("O nome do campo como aparece na ficha do negócio."),
    type: z
      .enum(["text", "textarea", "number", "date", "select", "multiselect", "boolean", "email", "phone", "url"])
      .describe("O tipo do campo. `select` e `multiselect` pedem `options`."),
    required: z.boolean().optional().describe("Destaca o campo no formulário. Quem BARRA movimento é `obrigatorio_em`."),
    options: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }).strict())
      .optional()
      .describe('As opções de um campo de escolha: [{ "value": "mensal", "label": "Mensal" }].'),
    obrigatorio_em: z
      .object({
        etapas: z.array(z.string().min(1)).max(50).optional().describe("NOMES das etapas em que entrar já exige o campo preenchido."),
        ao_ganhar: z.boolean().optional(),
        ao_perder: z.boolean().optional(),
      })
      .strict()
      .optional()
      .describe("Quando o campo passa a OBRIGAR: ao entrar em certas etapas, ao ganhar ou ao perder."),
  })
  .strict();

export const FERRAMENTAS_DE_FUNIL: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_funil",
    description:
      "Cria ou ajusta um FUNIL de um cliente, com as etapas na ordem, o passo do agente em cada etapa, os campos personalizados e os motivos de perda e de ganho. " +
      "GARANTIR quer dizer: pode ser chamada de novo com o mesmo pedido sem duplicar nada. A chave é o NOME do funil; cada etapa casa pelo NOME; cada campo pela `key`. " +
      "A resposta diz, por funil, etapa e configuração, se CRIOU, ATUALIZOU ou JÁ ESTAVA. " +
      "COMO FUNCIONA: (1) funil com esse nome não existe → é criado com as etapas do pedido. Toda organização nova nasce com um funil de e-commerce chamado «Pedidos»; " +
      "para transformá-lo no funil do cliente em vez de criar um segundo, mande `adotar_funil_padrao: true` (só funciona se ele ainda não tem negócio). " +
      "(2) funil já existe → as etapas são ajustadas uma a uma, sem trocar os ids (follow-ups e automações continuam apontando para elas). " +
      "ETAPAS: mande a lista COMPLETA, na ordem do quadro, com exatamente uma etapa `passo: \"won\"` e uma `passo: \"lost\"`. " +
      `Até ${TETO_DE_ETAPAS} etapas. Etapa que existe e o pedido não cita NÃO é apagada: fica no quadro, e a resposta avisa. ` +
      "Para tirá-la, `arquivar_etapas_fora_da_lista: true` arquiva as que estão sem negócio (a resposta diz quais não pôde arquivar e por quê). " +
      "CAMPOS e MOTIVOS: os do pedido são acrescentados ou atualizados; os que já existem e o pedido não cita ficam. " +
      "ORDEM RECOMENDADA: crie o funil ANTES de autorizar o agente nele (plataforma_garantir_agente, `funis`), e antes de follow-up ou automação que citem etapa. " +
      "Modelos de funil por tipo de negócio: plataforma_listar_modelos, seção funis. " +
      "O QUE NÃO FAZ: não apaga funil, não move negócio de etapa, não mexe em negócio nenhum.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(80).describe("O nome do funil (ex.: \"Agendamentos\"). É a chave: chamar de novo com o mesmo nome ajusta o mesmo funil."),
      funil_id: z
        .string()
        .uuid()
        .optional()
        .describe("O id de um funil que já existe. Só é preciso para RENOMEAR um funil (o id acha o funil, `nome` é o nome novo)."),
      descricao: z.string().trim().max(280).nullable().optional().describe("Uma frase sobre para que serve o funil."),
      padrao: z.boolean().optional().describe("true faz deste o funil PADRÃO da empresa (para onde vai o negócio criado sem funil escolhido)."),
      funil_de_clientes: z.boolean().optional().describe("true marca este funil como o de quem JÁ É CLIENTE."),
      adotar_funil_padrao: z
        .boolean()
        .optional()
        .describe(
          "Se NÃO existe funil com este nome: em vez de criar um funil novo, renomeia o funil padrão da organização (o «Pedidos» que nasce com ela) e troca as etapas dele. " +
            "Só funciona enquanto o funil padrão não tem negócio. Se o funil com este nome já existe, o campo é ignorado.",
        ),
      etapas: z.array(etapa).min(2).max(TETO_DE_ETAPAS).describe("As etapas, na ordem do quadro. Lista completa, com uma de ganho e uma de perda."),
      arquivar_etapas_fora_da_lista: z
        .boolean()
        .optional()
        .describe("true ARQUIVA as etapas do funil que não estão em `etapas`, desde que estejam sem negócio. Padrão: falso (nada é tirado)."),
      campos: z.array(campo).max(50).optional().describe("Campos personalizados do negócio neste funil."),
      motivos_de_perda: z
        .array(
          z.union([
            z.string().min(1).max(80),
            z.object({ label: z.string().min(1).max(80), categoria: z.string().min(1).max(40).optional() }).strict(),
          ]),
        )
        .max(50)
        .optional()
        .describe('Os motivos de perda oferecidos ao fechar como perdido: texto, ou { "label": "Achou caro", "categoria": "Cliente" }.'),
      motivos_de_ganho: z.array(z.string().min(1).max(80)).max(50).optional().describe("Os motivos de ganho oferecidos ao fechar como ganho."),
      motivo_de_ganho_obrigatorio: z.boolean().optional().describe("true exige o motivo ao fechar como ganho."),
      vocabulario: z
        .object({
          lead: z.string().min(1).max(40).optional(),
          deal: z.string().min(1).max(40).optional(),
          won: z.string().min(1).max(40).optional(),
          lost: z.string().min(1).max(40).optional(),
        })
        .strict()
        .optional()
        .describe('Como este funil chama as coisas: { "lead": "Paciente", "deal": "Agendamento", "won": "Consulta marcada", "lost": "Não marcou" }.'),
      reabertura: z
        .enum(["mesmo_registro", "novo_negocio"])
        .optional()
        .describe("O que acontece quando um negócio encerrado volta: reabre o mesmo, ou nasce um negócio novo."),
      vitoria_e_receita: z.boolean().optional().describe("false para funil em que vencer NÃO é dinheiro entrando (ex.: funil de pré-venda)."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o caso", passo: "qualifying", probabilidade: 20 },
        { nome: "Quer agendar", passo: "qualified", probabilidade: 50 },
        { nome: "Escolhendo horário", passo: "negotiating", probabilidade: 80, prazo_esperado_horas: 48 },
        { nome: "Consulta marcada", passo: "won" },
        { nome: "Não vai marcar", passo: "lost" },
      ],
      campos: [{ key: "procedimento", label: "Procedimento de interesse", type: "text" }],
      motivos_de_perda: ["Achou caro", "Parou de responder"],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirFunil(c, pedido as unknown as PedidoDeFunil);
    },
  },
];

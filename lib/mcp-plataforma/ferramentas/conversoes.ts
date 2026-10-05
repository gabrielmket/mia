/**
 * As ferramentas de CONVERSÕES (docs/fork/conversoes-da-meta.md): o que cada
 * etapa do funil informa à Meta e ao Google Ads, a volta dos leads de formulário
 * e o diagnóstico da Meta. As operações moram em `lib/implantacao/conversoes.ts`.
 *
 * Desde a .72 as regras da Meta são as do upstream (`meta_ads_conversion_rules`,
 * migration 0524): estas ferramentas leem e gravam nelas pela mesma função da
 * tela dele, e os eventos são os da lista dele (todos aceitos pela Meta também em
 * conversa de WhatsApp).
 *
 * Três tamanhos de estrago, como nas automações:
 *
 *   ler e diagnosticar   livre (nenhuma operação)
 *   garantir a regra     montagem (`implantar_configuracao`): a regra nasce
 *                        DESLIGADA e nada sai
 *   ligar                `colocar_no_ar`: o sistema passa a mandar evento de
 *                        cliente para a plataforma de anúncio
 *
 * Credencial (identificador do destino, token, autorização do Google) não entra
 * por ferramenta: continua com uma pessoa, na tela.
 */
import { z } from "zod";

import { VALORES_DE_CATEGORIA } from "@/lib/conversoes/regras-google";
import { EVENTOS_DA_META, VALORES_DE_EVENTO_DA_META } from "@/lib/conversoes/regras-meta";
import {
  diagnosticarConversoesDaMeta,
  garantirConversoesDaMeta,
  garantirConversoesDoGoogle,
  ligarConversoes,
  ligarLeadsDeFormularioDaMeta,
  verConversoes,
  type PedidoDeLigarConversoes,
  type PedidoDeRegrasDaMeta,
  type PedidoDeRegrasDoGoogle,
} from "@/lib/implantacao/conversoes";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const FUNIL = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("Nome ou id do funil. Os funis e as etapas abertas de cada um estão em plataforma_ver_conversoes.");

const ETAPA = z.string().trim().min(1).max(120).describe("Nome ou id de uma etapa ABERTA do funil (nem ganho nem perda).");

export const FERRAMENTAS_DE_CONVERSOES: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_conversoes",
    description:
      "As CONVERSÕES de um cliente: o que o sistema informa de volta à Meta e ao Google Ads para os anúncios aprenderem quem vira cliente. Devolve: " +
      "o estado das duas conexões SEM segredo (conectada, envio ligado, modo de teste; nunca o token); " +
      "se a identidade da Meta está preenchida (o ID da Página ou da conta do WhatsApp Business, sem o qual a Meta recusa a venda vinda de anúncio clique-para-WhatsApp); " +
      "a chave \"leads de formulário da Meta voltam para a Meta\"; " +
      "por funil, cada etapa aberta com a regra da Meta (evento, ligada) e a do Google (nome, ação de conversão, categoria, ligada), mais o evento que o sistema recomendaria para a Meta pelo nome da etapa; " +
      "a lista de eventos padrão da Meta que a régua oferece; os 20 últimos envios com a situação e o motivo; e quantos foram recusados em 7 dias. " +
      "QUANDO USAR: antes de plataforma_garantir_conversoes_da_meta ou _do_google (para ver os funis, as etapas e o que já existe) e depois de ligar, para conferir se os envios estão saindo. " +
      "A compra (negócio ganho) não é regra de etapa: sai sozinha quando a conexão está ligada.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      return verConversoes(c, org.demonstracao);
    },
  },

  {
    name: "plataforma_garantir_conversoes_da_meta",
    description:
      "Grava O QUE CADA ETAPA DO FUNIL INFORMA À META: quando um negócio que veio da Meta entra numa etapa aberta, a Meta recebe um evento padrão, uma vez por negócio e etapa. " +
      `Os eventos são os da régua da tela: ${EVENTOS_DA_META.map((e) => `${e.valor} (${e.rotulo})`).join(", ")}. ` +
      "Com `usar_recomendado: true` o sistema escolhe o evento pelo nome de cada etapa (\"orçamento\", \"proposta\" ou \"cotação\" é InitiateCheckout; \"agend\", \"consulta\", \"visita\" ou \"reunião\" é LeadSubmitted; \"qualific\", \"interess\" ou \"diagnóst\" é QualifiedLead). " +
      "Com `regras` você diz etapa a etapa o evento. Os dois juntos valem: `regras` vence o recomendado na etapa citada. " +
      "A regra NASCE DESLIGADA e esta ferramenta nunca liga nem desliga: para a Meta passar a receber, plataforma_ligar_conversoes. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é a etapa; cada uma responde `criou`, `atualizou` ou `ja_estava`. Etapa que o pedido não cita fica como está. " +
      "O mesmo evento em duas etapas é aceito, com aviso: cada etapa envia o seu, e o negócio que passar pelas duas manda o evento duas vezes. " +
      "Regra LIGADA não é editada por aqui (a mudança valeria no próximo negócio): desligue, ajuste e religue. " +
      "O evento de etapa vai SEM valor (o negócio ainda não foi vendido); a venda vai com o valor quando o negócio é ganho. " +
      "O QUE NÃO FAZ: não liga a regra, não envia nada, não mexe em etapa de ganho nem de perda (ganho é a compra; perda não é conversão) e não recebe o identificador do destino nem o token da Meta, que são credencial e ficam com uma pessoa em Configurações › Conversões.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: FUNIL,
      usar_recomendado: z
        .boolean()
        .optional()
        .describe("true: grava, em cada etapa que tem recomendação pelo nome, o evento recomendado. Etapa sem recomendação fica como está."),
      regras: z
        .array(
          z
            .object({
              etapa: ETAPA,
              evento: z
                .enum(VALORES_DE_EVENTO_DA_META)
                .describe("O evento padrão da Meta: LeadSubmitted, QualifiedLead, InitiateCheckout, AddToCart ou ViewContent."),
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe("As regras, uma por etapa. Sem isto, use usar_recomendado."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      funil: "Agendamentos",
      usar_recomendado: true,
      regras: [{ etapa: "Avaliação agendada", evento: "LeadSubmitted" }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirConversoesDaMeta(c, pedido as unknown as PedidoDeRegrasDaMeta);
    },
  },

  {
    name: "plataforma_garantir_conversoes_do_google",
    description:
      "Grava O QUE CADA ETAPA DO FUNIL INFORMA AO GOOGLE ADS: quando um negócio que veio de anúncio do Google entra numa etapa aberta, o Google recebe a AÇÃO DE CONVERSÃO daquela etapa, uma vez por negócio. " +
      "Cada regra precisa do nome da conversão e do id numérico da ação de conversão, que já tem de existir na conta do Google Ads do cliente (ela é criada no Google Ads, ou pelo botão \"Criar no Google\" da tela Configurações › Conversões). " +
      "A regra NASCE DESLIGADA e esta ferramenta nunca liga nem desliga: para o Google passar a receber, plataforma_ligar_conversoes com `plataforma: \"google\"`. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é a etapa; cada uma responde `criou`, `atualizou` ou `ja_estava`. Etapa que o pedido não cita fica como está. " +
      "Regra LIGADA não é editada por aqui (a mudança valeria no próximo negócio): desligue, ajuste e religue. " +
      "As categorias aceitas estão em plataforma_ver_conversoes (`categorias_do_google`). " +
      "O QUE NÃO FAZ: não cria a ação de conversão na conta do Google, não liga a regra, não envia nada, não mexe na ação da compra (a do negócio ganho, que é da conexão) e não conecta a conta do Google, que é login de uma pessoa na tela.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: FUNIL,
      regras: z
        .array(
          z
            .object({
              etapa: ETAPA,
              nome: z.string().trim().min(1).max(100).describe("O nome da conversão, como aparece nos relatórios. Ex.: Lead qualificado."),
              acao_de_conversao_id: z
                .string()
                .trim()
                .regex(/^[1-9]\d{0,31}$/, "só dígitos, o id numérico da ação de conversão no Google Ads (ex.: 7123456789)")
                .describe("O id numérico da ação de conversão no Google Ads. Só dígitos."),
              categoria: z
                .enum(VALORES_DE_CATEGORIA)
                .optional()
                .describe("Como o Google agrupa a conversão. Ex.: QUALIFIED_LEAD, BOOK_APPOINTMENT, REQUEST_QUOTE. Padrão: DEFAULT."),
              canal: z
                .enum(["todos", "whatsapp", "outros"])
                .optional()
                .describe("Por onde o negócio precisa ter entrado: todos (padrão), whatsapp ou outros."),
              incluir_em_conversoes: z
                .boolean()
                .optional()
                .describe("true (padrão): entra na coluna Conversões do Google, e os lances otimizam por ela."),
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .describe("As regras, uma por etapa."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      funil: "Agendamentos",
      regras: [{ etapa: "Qualificação", nome: "Lead qualificado", acao_de_conversao_id: "7123456789", categoria: "QUALIFIED_LEAD" }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirConversoesDoGoogle(c, pedido as unknown as PedidoDeRegrasDoGoogle);
    },
  },

  {
    name: "plataforma_ligar_conversoes",
    description:
      "LIGA ou desliga as regras de conversão por etapa de um funil, na Meta ou no Google Ads. Ligada, a regra faz o sistema ENVIAR À PLATAFORMA DE ANÚNCIO um evento com dado do cliente final " +
      "(o clique do anúncio ou o identificador do lead e o telefone em forma embaralhada) toda vez que um negócio entrar na etapa. " +
      "Sem `etapas`, vale para todas as etapas do funil que já têm regra; com `etapas`, só para as citadas. Etapa sem regra é recusada: crie antes com plataforma_garantir_conversoes_da_meta ou _do_google. " +
      "Ligar NÃO envia o passado: vale para os negócios que entrarem nas etapas a partir dali. Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "ANTES DE LIGAR: confira as regras em plataforma_ver_conversoes e confirme com o humano, porque é dado de cliente saindo para a conta de anúncios. " +
      "Se a conexão com a plataforma não estiver preenchida e ligada (isso é pela tela), a regra fica ligada e nada sai: a resposta avisa. " +
      "Na empresa de demonstração a regra liga e nada é enviado.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      plataforma: z.enum(["meta", "google"]).describe("meta (a Meta: Facebook e Instagram) ou google (o Google Ads)."),
      funil: FUNIL,
      etapas: z
        .array(ETAPA)
        .max(20)
        .optional()
        .describe("As etapas a ligar ou desligar. Sem isto, todas as etapas do funil que têm regra nesta plataforma."),
      ligada: z.boolean().describe("true liga, false desliga."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, plataforma: "meta", funil: "Agendamentos", ligada: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return ligarConversoes(c, pedido as unknown as PedidoDeLigarConversoes, org.demonstracao);
    },
  },

  {
    name: "plataforma_ligar_leads_de_formulario_da_meta",
    description:
      "LIGA ou desliga a volta dos LEADS DE FORMULÁRIO para a Meta. O sistema recebe os leads dos formulários da Meta (anúncio de cadastro) e guarda o identificador de cada um; " +
      "desligada (o padrão), a Meta nunca fica sabendo o que aconteceu com eles. Ligada, os eventos de etapa com regra ligada e a venda também são enviados à Meta para o lead que veio de formulário, " +
      "pelo identificador do lead, mesmo sem clique em anúncio de WhatsApp. Saem o identificador do lead, o evento, o valor da venda e o telefone e o e-mail em forma embaralhada. " +
      "Ligar NÃO envia o passado: vale para o que acontecer a partir dali. Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "ANTES DE LIGAR: confirme com o humano que a política de privacidade do cliente cobre esse uso, porque é dado de cliente saindo para a conta de anúncios. " +
      "Só tem efeito com a conexão da Meta preenchida e ligada (pela tela) e com regras de etapa ligadas (plataforma_ligar_conversoes); a venda vai mesmo sem regra de etapa. " +
      "Na empresa de demonstração a chave liga e nada é enviado.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      ligada: z.boolean().describe("true liga, false desliga."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, ligada: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      return ligarLeadsDeFormularioDaMeta(c, args.ligada === true, org.demonstracao);
    },
  },

  {
    name: "plataforma_diagnosticar_conversoes_da_meta",
    description:
      "Roda o DIAGNÓSTICO da conexão de conversões da Meta de um cliente, o mesmo do botão \"Testar conexão\" da tela: a Meta aceita o token guardado, o destino de conversões existe e o token o alcança, " +
      "o token tem permissão de envio, há quanto tempo a Meta aceitou um envio, quantos eventos ela recusou nos últimos 7 dias (com o motivo que ela deu) e se o modo de teste está ligado. " +
      "Cada conferência volta com a saúde (ok, atencao, problema), o que significa e o que fazer. " +
      "QUANDO USAR: quando o cliente diz que a Meta parou de receber, e depois de alguém trocar o token ou o destino pela tela. " +
      "É só leitura: faz três consultas à Meta com o token do cliente e duas ao histórico de envios; nenhum evento é enviado e nada é gravado. O token nunca aparece na resposta. " +
      "Se a conexão não existe ou está com o envio desligado, a resposta diz isso e não consulta a Meta.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return diagnosticarConversoesDaMeta(c.admin, c.orgId);
    },
  },
];

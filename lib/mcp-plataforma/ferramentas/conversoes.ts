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
// FORK MIA (MIA-169): as conversões do site (docs/fork/conversoes-da-meta.md, "Conversões do site").
import {
  EVENTOS_DE_SITE_DA_META,
  garantirConversoesDoSite,
  ligarConversoesDoSite,
  testarConversoesDoSite,
  verConversoesDoSite,
  type PedidoDeRegrasDoSite,
  type PedidoDeTesteDoSite,
} from "@/lib/implantacao/conversoes-do-site";

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
      "A compra (negócio ganho) não é regra de etapa: sai sozinha quando a conexão está ligada. " +
      "A seção `site` mostra as CONVERSÕES DO SITE (o cadastro e a assinatura da MIA, só na empresa dona da fonte do cadastro): as regras, se as variáveis do servidor estão configuradas (sim ou não, nunca o valor), se o modo de teste está ligado e os últimos envios do site (situação e motivo, sem dado de pessoa).",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      return { ...(await verConversoes(c, org.demonstracao)), site: await verConversoesDoSite(c) };
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
      "Na empresa de demonstração a regra liga e nada é enviado. " +
      "Com `plataforma: \"site\"` liga as CONVERSÕES DO SITE (só na empresa dona da fonte do cadastro; a demonstração recusa): todas as regras do site das etapas, na Meta e no Google, e a resposta avisa se falta variável no servidor ou se o código de teste ainda está lá.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      plataforma: z
        .enum(["meta", "google", "site"])
        .describe("meta (a Meta: Facebook e Instagram), google (o Google Ads) ou site (as conversões do site, de plataforma_garantir_conversoes_do_site)."),
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
      // FORK MIA (MIA-169): o site tem regras próprias (9170).
      if (pedido.plataforma === "site")
        return ligarConversoesDoSite(c, pedido as unknown as { funil: string; etapas?: string[]; ligada: boolean }, org.demonstracao);
      return ligarConversoes(c, pedido as unknown as PedidoDeLigarConversoes, org.demonstracao);
    },
  },

  // FORK MIA (MIA-169): as conversões do site.
  {
    name: "plataforma_garantir_conversoes_do_site",
    description:
      "Grava as CONVERSÕES DO SITE: o que cada etapa do funil manda quando o cadastro ou a assinatura da MIA andam nele (cadastro concluído, teste, pagamento). " +
      "SÓ na empresa dona da fonte do cadastro (a variável CADASTRO_FONTE_DO_CRM do servidor): em qualquer outra a ferramenta recusa, e o funil de um cliente usa plataforma_garantir_conversoes_da_meta ou _do_google. " +
      `Na Meta o evento é de SITE, no dataset do site, um destes: ${EVENTOS_DE_SITE_DA_META.join(", ")}. No Google Ads é a ação de conversão (id numérico), importada pelo clique. ` +
      "Uma etapa pode ter VÁRIAS regras (ex.: a de assinante manda Subscribe e Purchase à Meta e a ação de compra ao Google). Purchase e Subscribe levam sempre o valor do negócio (`leva_valor`); na regra do Google, `leva_valor: true` manda o valor junto. " +
      "A regra NASCE DESLIGADA: prove com plataforma_testar_conversoes_do_site e ligue com plataforma_ligar_conversoes (`plataforma: \"site\"`). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é (etapa, evento) na Meta e (etapa, ação) no Google; cada regra responde `criou`, `atualizou` ou `ja_estava`. Regra que o pedido não cita fica como está. Regra LIGADA não é editada por aqui: desligue, ajuste e religue. " +
      "O QUE NÃO FAZ: não liga, não envia, não mexe em etapa de ganho nem de perda, não recebe o dataset nem o token do site (são variáveis do servidor) e não conecta o Google Ads (é pela tela).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: FUNIL,
      regras: z
        .array(
          z
            .object({
              etapa: ETAPA,
              plataforma: z.enum(["meta", "google"]).describe("meta (o evento de site no dataset do site) ou google (a ação de conversão do Google Ads)."),
              evento: z
                .enum(EVENTOS_DE_SITE_DA_META)
                .optional()
                .describe(`Só na Meta: ${EVENTOS_DE_SITE_DA_META.join(", ")}.`),
              acao_de_conversao_id: z
                .string()
                .trim()
                .regex(/^[1-9]\d{0,31}$/, "só dígitos, o id numérico da ação de conversão no Google Ads (ex.: 7123456789)")
                .optional()
                .describe("Só no Google: o id numérico da ação de conversão. Só dígitos."),
              leva_valor: z
                .boolean()
                .optional()
                .describe("true: o evento leva o valor do negócio (sem valor, o envio fica pendente com sem_valor). Purchase e Subscribe levam sempre."),
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .describe("As regras. Várias por etapa são aceitas."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      funil: "Vendas",
      regras: [
        { etapa: "Cadastro concluído", plataforma: "meta", evento: "CompleteRegistration" },
        { etapa: "Cadastro concluído", plataforma: "google", acao_de_conversao_id: "7123456789" },
        { etapa: "Em teste", plataforma: "meta", evento: "StartTrial" },
        { etapa: "Assinante", plataforma: "meta", evento: "Purchase" },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirConversoesDoSite(c, pedido as unknown as PedidoDeRegrasDoSite, org.demonstracao);
    },
  },

  {
    name: "plataforma_testar_conversoes_do_site",
    description:
      "PROVA as conversões do site sem cliente de verdade: manda UM evento com a pessoa fictícia Ana Exemplo à Meta, no dataset do site e em MODO DE TESTE (aparece em \"Testar eventos\" do Gerenciador de Eventos e não conta nos anúncios), " +
      "e, com `acao_de_conversao_id`, ao Google Ads SÓ VALIDANDO (validateOnly: o Google confere e nada é importado). " +
      "Recusa sem o código de teste da Meta no servidor (META_TEST_EVENT_CODE): sem ele o evento contaria como real. Só na empresa dona da fonte do cadastro; a demonstração recusa. " +
      "O QUE NÃO FAZ: não grava no livro-razão (o teste não aparece nos envios), não liga nem muda regra e não manda dado de cliente nenhum. Devolve se cada plataforma aceitou e, se não, o que ela respondeu. " +
      "QUANDO USAR: depois de colar as variáveis do site no servidor e antes de ligar as regras (é o aceite). Sem `gclid`, o Google recebe um clique fictício e responde com erro de clique, o que já prova a conexão e a ação.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      evento: z
        .enum(EVENTOS_DE_SITE_DA_META)
        .optional()
        .describe("O evento da Meta a testar. Padrão: CompleteRegistration. Purchase e Subscribe vão com valor, moeda BRL e id do pedido."),
      acao_de_conversao_id: z
        .string()
        .trim()
        .regex(/^[1-9]\d{0,31}$/, "só dígitos, o id numérico da ação de conversão no Google Ads")
        .optional()
        .describe("A ação do Google Ads a validar. Sem isto, o Google não é testado."),
      gclid: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._~-]{1,512}$/, "o gclid como veio na URL do anúncio")
        .optional()
        .describe("O gclid de um clique SEU num anúncio, para a validação completa no Google. Nunca o de um cliente."),
      valor_centavos: z.number().int().min(1).max(10_000_000).optional().describe("O valor do evento, em centavos de BRL. Padrão: 100 (R$ 1,00)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, evento: "Purchase", acao_de_conversao_id: "7123456789" },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return testarConversoesDoSite(c, pedido as unknown as PedidoDeTesteDoSite, org.demonstracao);
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

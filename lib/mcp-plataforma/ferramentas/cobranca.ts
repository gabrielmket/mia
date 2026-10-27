/**
 * FORK MIA (.90) — as ferramentas da JORNADA DE ASSINATURA (a cobrança) no MCP
 * de plataforma (protótipo de 25/10/2026, tela 8; docs/fork/jornada-de-assinatura.md).
 * Nove, e a operação do token segue o estrago:
 *
 *   plataforma_ver_cobranca                 leitura: provedor, modo, aviso, régua, planos, situações
 *   plataforma_garantir_planos              `gerir_planos`: os planos pelo nome e os pacotes de crédito
 *   plataforma_listar_assinaturas           leitura: as empresas por situação
 *   plataforma_ver_assinatura               leitura: uma empresa, com a régua e os módulos
 *   plataforma_atribuir_plano               `gerir_cobranca`: atribui ou troca, como o dono
 *   plataforma_gerar_link_de_pagamento      `gerir_cobranca`: o botão do card Cobrança
 *   plataforma_ajustar_cobranca             `gerir_cobranca`: dar prazo, isentar, voltar à cobrança
 *   plataforma_listar_pedidos_de_cadastro   leitura: os pedidos esperando aprovação
 *   plataforma_decidir_pedido_de_cadastro   `decidir_cadastro`: aprova ou recusa com o motivo
 *
 * O QUE O MCP NÃO FAZ (de propósito, e cada recusa diz o caminho): conectar a
 * chave do provedor ou trocar de provedor (só pela tela, com a chave cifrada);
 * marcar como pago (pagamento só vem do aviso do provedor e da releitura);
 * cancelar a assinatura do cliente (é decisão dele, na tela dele); mudar preço
 * ou tirar módulo de plano assinado (arquiva e cria outro); mudar o modo do
 * cadastro (fica em /admin/cadastro: abre ou fecha a porta da instalação).
 *
 * O dólar do teto de IA só aparece aqui (é a Time quem lê); para o cliente ele
 * vira "cerca de N conversas".
 *
 * Desde a .95 o plano tem também o preço por E-MAIL (`preco_email`, em reais;
 * 9110), ao lado do preço do Broadcast, com as mesmas regras: vale para as
 * empresas do plano sem preço definido à mão, segue o plano na troca e não muda
 * em plano assinado. A leitura da assinatura devolve os dois preços que valem e
 * de onde vem cada um.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { modoDeCadastro } from "@/lib/auth/politica-de-cadastro";
import { lerPacotesAtivos } from "@/lib/carteira/compra-pelo-asaas";
import { gerarLinkDePagamento } from "@/lib/cobranca/checkout";
import { toleranciaDias } from "@/lib/cobranca/configuracao";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { urlDoPainelDaEmpresa } from "@/lib/cobranca/url";
import { lerVisaoGeral, montarChecklist } from "@/lib/cobranca/visao-geral";
import { PRECO_PADRAO_POR_EMAIL_CENTS } from "@/lib/email-marketing/regras";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";
import { moduloLigado } from "@/lib/instalacao/modulos";
// FORK MIA (.91): as empresas que esperam a Time ligar o número oficial.
import { lerEmpresasEsperandoONumero } from "@/lib/onboarding/primeiros-passos-para-a-time";
import { atribuirOuTrocarPlano, darPrazo, tornarIsenta } from "@/lib/planos-mia/acoes-do-dono";
import { conversasEstimadas, MODULOS_DO_PLANO } from "@/lib/planos-mia/catalogo";
import {
  lerDetalheDaEmpresa,
  lerEmpresasDoCadastro,
  lerPedidosDeCadastro,
  type LinhaDaEmpresa,
} from "@/lib/planos-mia/empresas-do-cadastro";
import { garantirPacotesDeCreditos, garantirPlanos } from "@/lib/planos-mia/garantir-planos";
import { lerPlanosComModulos, type PlanoComModulos } from "@/lib/planos-mia/leitura";
import { decidirPedidoDeCadastro } from "@/lib/planos-mia/pedidos-de-cadastro";
import { lerPrecosDaEmpresa } from "@/lib/planos-mia/preco-por-email";
import { SITUACOES } from "@/lib/planos-mia/situacao";

import { recusar } from "../recusa";
import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";
import { ORG_DE_EXEMPLO, ORGANIZACAO } from "./comum";

export const OPERACAO_GERIR_PLANOS = "gerir_planos";
export const OPERACAO_GERIR_COBRANCA = "gerir_cobranca";
export const OPERACAO_DECIDIR_CADASTRO = "decidir_cadastro";

const reais = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);
const centavos = (r: number | null | undefined) =>
  r === null || r === undefined ? r : Math.round(r * 100);

function planoParaAPlataforma(p: PlanoComModulos, assinantes: number) {
  return {
    id: p.id,
    nome: p.nome,
    preco: reais(p.preco_cents),
    intervalo: p.intervalo,
    teste_dias: p.trial_dias,
    pessoas: p.max_assentos,
    numeros: p.max_canais,
    teto_ia_usd: reais(p.teto_ia_usd_cents),
    conversas_estimadas: conversasEstimadas(p.teto_ia_usd_cents),
    modulos: p.modulos,
    preco_broadcast: reais(p.preco_por_mensagem_cents),
    // FORK MIA (.95): o preço por e-mail do plano; null = o padrão (preco_email_padrao).
    preco_email: reais(p.preco_por_email_cents),
    frase: p.frase,
    destaque: p.destaque,
    oferecido: p.oferecido_ao_cliente,
    padrao_no_cadastro: p.padrao_no_cadastro,
    arquivado: p.arquivado_em !== null,
    assinantes,
  };
}

const ORIGEM_DO_PRECO = { combinado: "definido_a_mao", plano: "plano", padrao: "padrao" } as const;

/** FORK MIA (.95): os preços da empresa em reais, com a origem de cada um. */
function precosParaAPlataforma(p: Awaited<ReturnType<typeof lerPrecosDaEmpresa>>) {
  return {
    plano: p.plano,
    mensagem: {
      preco: reais(p.mensagem.cents),
      origem: p.mensagem.origem === null ? null : ORIGEM_DO_PRECO[p.mensagem.origem],
      definido_a_mao: reais(p.mensagem.combinado_cents),
    },
    email: {
      preco: reais(p.email.cents),
      origem: ORIGEM_DO_PRECO[p.email.origem],
      definido_a_mao: reais(p.email.combinado_cents),
    },
  };
}

function linhaParaAPlataforma(l: LinhaDaEmpresa) {
  return {
    organization_id: l.id,
    nome: l.nome,
    origem: l.origem,
    plano: l.plano?.nome ?? null,
    plano_agendado: l.plano_agendado,
    situacao: l.situacao,
    entrou: l.entrou,
    teste_ate: l.teste_ate,
    proximo_aviso: { tipo: l.proximo.tipo, em: l.proximo.em },
    suspensao_em: l.proximo.suspensao_em,
    link_de_pagamento: l.link_de_pagamento ? "aberto" : null,
    primeiros_passos: l.passos,
    // FORK MIA (.91): o "o que falta" do retrato mais novo (o que o cliente viu no Início).
    o_que_falta: l.o_que_falta,
  };
}

/** O plano pelo id ou pelo nome (sem diferença de maiúscula), entre os ativos. */
async function acharPlano(ctx: ContextoDaFerramenta, valor: string): Promise<PlanoComModulos> {
  const planos = (await lerPlanosComModulos(ctx.admin)).filter((p) => p.arquivado_em === null);
  const v = valor.trim().toLocaleLowerCase("pt-BR");
  const achado =
    planos.find((p) => p.id === valor.trim()) ??
    planos.find((p) => p.nome.toLocaleLowerCase("pt-BR") === v);
  if (!achado) {
    recusar(
      `plano não encontrado: "${valor}". Os planos ativos são: ${planos.map((p) => p.nome).join(", ") || "nenhum"}. ` +
        "Crie com plataforma_garantir_planos ou veja em plataforma_ver_cobranca.",
    );
  }
  return achado;
}

async function exigirCobrancaLigada(ctx: ContextoDaFerramenta): Promise<void> {
  if (!(await moduloLigado(ctx.admin, "cobranca"))) {
    recusar(
      "a cobrança está desligada nesta instalação: toda empresa é isenta e não há planos valendo. " +
        "Quem liga é uma pessoa, em Admin › Recursos opcionais › Cobrança dos seus clientes; a chave do provedor entra pela tela (Cobrança › Conexão).",
    );
  }
}

const ator = (ctx: ContextoDaFerramenta) => ({
  userId: ctx.autorUserId,
  tokenId: ctx.tokenId,
  requestId: ctx.requestId,
});

const PLANO_PEDIDO = z.object({
  nome: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe("O nome do plano (é a chave: chamar de novo com o mesmo nome ajusta, não duplica)."),
  preco: z
    .number()
    .min(5)
    .max(1_000_000)
    .describe(
      "Preço por período, em REAIS (ex.: 297). Mínimo R$ 5,00. Não muda depois que alguém assina.",
    ),
  intervalo: z
    .enum(["mes", "ano"])
    .optional()
    .describe('"mes" (padrão) ou "ano". Não muda depois que alguém assina.'),
  teste_dias: z
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .describe("Dias de teste grátis (0 a 90; padrão 14; 0 = entrada paga)."),
  pessoas: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe("Máximo de pessoas na equipe. null = sem limite."),
  numeros: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe("Máximo de números conectados. null = sem limite."),
  teto_ia_usd: z
    .number()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Teto de uso de IA por mês, em DÓLAR (só a plataforma vê; o cliente vê cerca de N conversas). null = sem teto.",
    ),
  modulos: z
    .array(z.enum(MODULOS_DO_PLANO))
    .max(3)
    .optional()
    .describe(
      'Os módulos que o plano liga: "disparador" (Broadcast), "email_marketing", "crm_b2b" (Vendas B2B, exige o módulo da instalação).',
    ),
  preco_broadcast: z
    .number()
    .min(0)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Preço de cada mensagem do Broadcast, em REAIS (ex.: 0.12). Não muda depois que alguém assina.",
    ),
  // FORK MIA (.95): o preço por e-mail do plano (9110), ao lado do do Broadcast.
  preco_email: z
    .number()
    .min(0)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Preço de cada e-mail de marketing aceito pela Amazon, em REAIS (ex.: 0.03). null ou ausente = o padrão do sistema (R$ 0,02). " +
        "Vale para as empresas do plano sem preço definido à mão (plataforma_definir_preco vence). Não muda depois que alguém assina.",
    ),
  frase: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .describe("A frase do cartão na página de preços."),
  destaque: z.boolean().optional().describe('O selo "Mais escolhido" no cartão.'),
  oferecido: z
    .boolean()
    .optional()
    .describe(
      "true (padrão): aparece na página de preços e no cadastro. false: plano escondido, só a Time atribui.",
    ),
  padrao_no_cadastro: z
    .boolean()
    .optional()
    .describe("O plano em que nasce quem não escolhe (entrada pelo Google). Só um."),
});

export const FERRAMENTAS_DE_COBRANCA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_cobranca",
    description:
      "A COBRANÇA DA INSTALAÇÃO numa resposta: se está ligada, o provedor (Asaas ou Stripe) e o modo (teste ou produção), se o aviso de pagamento chega, " +
      "a régua (dias de tolerância), o que falta para a primeira cobrança, os planos com limites, módulos, preço do Broadcast, preço por e-mail (desde a .95), conversas estimadas e quantas " +
      "empresas assinam cada um, quantas empresas há em cada situação, os pacotes de crédito por Pix e o modo do cadastro. A chave do provedor nunca sai. " +
      "O QUE NÃO FAZ: não conecta nem troca a chave do provedor (só pela tela, cifrada).",
    inputSchema: {},
    exemplo: {},
    operacao: null,
    handler: async (ctx) => {
      const ligada = await moduloLigado(ctx.admin, "cobranca");
      const [modo, planos, empresas, pacotes] = await Promise.all([
        modoDeCadastro(),
        lerPlanosComModulos(ctx.admin),
        lerEmpresasDoCadastro(ctx.admin),
        lerPacotesAtivos(ctx.admin),
      ]);
      const assinantes = new Map<string, number>();
      for (const l of empresas)
        if (l.plano) assinantes.set(l.plano.id, (assinantes.get(l.plano.id) ?? 0) + 1);
      const porSituacao = Object.fromEntries(
        SITUACOES.map((s) => [s, empresas.filter((l) => l.situacao === s).length]),
      );
      const base = {
        ligada,
        modo_do_cadastro: modo,
        // FORK MIA (.95): o que vale para o plano que não diz o preço por e-mail.
        preco_email_padrao: reais(PRECO_PADRAO_POR_EMAIL_CENTS),
        planos: planos.map((p) => planoParaAPlataforma(p, assinantes.get(p.id) ?? 0)),
        empresas_por_situacao: porSituacao,
        empresas_por_origem: {
          cadastro: empresas.filter((l) => l.origem === "cadastro").length,
          implantacao: empresas.filter((l) => l.origem === "implantacao").length,
        },
        pacotes_de_creditos: pacotes.map((p) => reais(p.valor_cents)),
      };
      if (!ligada) {
        return {
          ...base,
          aviso:
            "A cobrança está desligada: toda empresa é isenta, os planos não valem e nenhum módulo vem pelo plano. Quem liga é uma pessoa, em Admin › Recursos opcionais.",
        };
      }
      const visao = await lerVisaoGeral(ctx.admin);
      return {
        ...base,
        provedor: visao.provedor,
        modo: visao.modo,
        aviso_de_pagamento: { ultimo_em: visao.ultimoAvisoEm, chega: visao.ultimoAvisoEm !== null },
        ultima_releitura_em: visao.ultimaLeituraEm,
        tolerancia_dias: await toleranciaDias(),
        problemas: visao.problemas,
        o_que_falta: montarChecklist(visao)
          .filter((p) => !p.feito)
          .map((p) => ({ passo: p.titulo, como: p.comoFazer })),
      };
    },
  },
  {
    name: "plataforma_garantir_planos",
    description:
      "Garante os PLANOS pelo nome: preço (em reais), intervalo, dias de teste, pessoas, números, teto de IA (em dólar, só a plataforma vê), módulos " +
      "(disparador, email_marketing, crm_b2b), preço do Broadcast, preço por e-mail (preco_email, desde a .95; ausente = o padrão de R$ 0,02), " +
      "frase e selo do cartão, oferecido ou escondido, e qual é o do cadastro. " +
      "Rodar de novo não duplica. Plano assinado não muda de preço nem perde módulo (nem muda o preço do Broadcast ou o por e-mail): a resposta manda arquivar e criar outro. " +
      "Ligar um módulo num plano vale na hora para as empresas dele. Aceita `pacotes_de_creditos` (em reais): os pacotes da compra de créditos por Pix; " +
      "os que não vierem deixam de ser oferecidos. Precisa da cobrança ligada. O QUE NÃO FAZ: não arquiva plano (arquivar é pela aba Planos do painel).",
    inputSchema: {
      planos: z.array(PLANO_PEDIDO).min(1).max(20).describe("Os planos, cada um pelo nome."),
      pacotes_de_creditos: z
        .array(z.number().min(5).max(100_000))
        .max(10)
        .optional()
        .describe(
          "Os valores dos pacotes de crédito por Pix, em reais (ex.: [100, 250, 500]). Ausente: os pacotes ficam como estão.",
        ),
    },
    exemplo: {
      planos: [
        {
          nome: "Essencial",
          preco: 297,
          teste_dias: 14,
          pessoas: 3,
          numeros: 1,
          teto_ia_usd: 15,
          modulos: [],
          oferecido: true,
        },
        {
          nome: "Profissional",
          preco: 597,
          teste_dias: 14,
          pessoas: 8,
          numeros: 2,
          teto_ia_usd: 40,
          modulos: ["disparador", "email_marketing"],
          preco_broadcast: 0.12,
          preco_email: 0.03,
          oferecido: true,
          padrao_no_cadastro: true,
          destaque: true,
        },
      ],
      pacotes_de_creditos: [100, 250, 500],
    },
    operacao: OPERACAO_GERIR_PLANOS,
    handler: async (ctx, args) => {
      const pedidos = (args.planos as Array<z.infer<typeof PLANO_PEDIDO>>).map((p) => ({
        nome: p.nome,
        preco_cents: Math.round(p.preco * 100),
        intervalo: p.intervalo,
        trial_dias: p.teste_dias,
        max_assentos: p.pessoas,
        max_canais: p.numeros,
        teto_ia_usd_cents: centavos(p.teto_ia_usd),
        modulos: p.modulos,
        preco_por_mensagem_cents: centavos(p.preco_broadcast),
        preco_por_email_cents: centavos(p.preco_email),
        frase: p.frase,
        destaque: p.destaque,
        oferecido_ao_cliente: p.oferecido,
        padrao_no_cadastro: p.padrao_no_cadastro,
      }));
      const r = await garantirPlanos(ctx.admin, pedidos, ator(ctx));
      let pacotes: { ativos: number[]; desativados: number[] } | null = null;
      if (Array.isArray(args.pacotes_de_creditos) && r.recusas.every((x) => x.plano !== "*")) {
        const g = await garantirPacotesDeCreditos(
          ctx.admin,
          (args.pacotes_de_creditos as number[]).map((v) => Math.round(v * 100)),
          ator(ctx),
        );
        pacotes = {
          ativos: g.ativos.map((v) => v / 100),
          desativados: g.desativados.map((v) => v / 100),
        };
      }
      return { ...r, ...(pacotes ? { pacotes_de_creditos: pacotes } : {}) };
    },
  },
  {
    name: "plataforma_listar_assinaturas",
    description:
      "As EMPRESAS POR SITUAÇÃO (em teste, em dia, em atraso, com prazo, suspensa, cancelada, isenta), com plano e plano agendado, origem (cadastro próprio " +
      "ou implantação), fim do teste, o próximo aviso da régua e a data prevista da suspensão, se há link de pagamento em aberto, quantos primeiros passos " +
      "foram feitos e, desde a .91, o \"o que falta\" do último retrato (faltam, total e quantos faltavam ao entrar, a mesma conta do Início do cliente; " +
      "null quando a empresa nunca abriu o bloco). A empresa de demonstração fica de fora. Para os pedidos que ainda não viraram empresa, use plataforma_listar_pedidos_de_cadastro.",
    inputSchema: {
      situacao: z.enum(SITUACOES).optional().describe("Filtra por situação. Ausente: todas."),
      so_cadastro_proprio: z
        .boolean()
        .optional()
        .describe("true: só quem entrou sozinho pelo cadastro (esconde as implantadas pela Time)."),
    },
    exemplo: { situacao: "atraso", so_cadastro_proprio: true },
    operacao: null,
    handler: async (ctx, args) => {
      const linhas = (await lerEmpresasDoCadastro(ctx.admin))
        .filter((l) => !args.so_cadastro_proprio || l.origem === "cadastro")
        .filter((l) => !args.situacao || l.situacao === args.situacao);
      return { total: linhas.length, empresas: linhas.map(linhaParaAPlataforma) };
    },
  },
  {
    name: "plataforma_ver_assinatura",
    description:
      "UMA EMPRESA na cobrança: plano e plano agendado, situação, datas (fim do teste, próxima cobrança, prazo), se há link de pagamento em aberto, a régua " +
      "ponto a ponto (o que já foi e o que vem), quem administra (e-mail mascarado), os primeiros passos e os módulos com a origem (pelo plano ou pela Time). " +
      "Desde a .91, o \"o que falta\" de AGORA (o_que_falta_agora: as contas e cada item com a coluna e quem faz, a mesma régua do Início do cliente). " +
      "Desde a .95, os PREÇOS que valem para a empresa (precos: o da mensagem do Broadcast e o por e-mail, em reais, cada um com a origem: " +
      "definido à mão, o plano ou, no e-mail, o padrão; e o definido à mão, se houver).",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const d = await lerDetalheDaEmpresa(ctx.admin, String(args.organization_id));
      if (!d) recusar("empresa não encontrada. Use plataforma_listar_clientes para achar o id.");
      return {
        ...linhaParaAPlataforma(d),
        administra: d.administra,
        modulos: d.modulos.map((m) => ({
          modulo: m.modulo,
          pelo_plano: m.pelo_plano,
          pela_time: m.pela_time,
        })),
        regua: d.regua,
        o_que_falta_agora: d.o_que_falta_agora,
        // FORK MIA (.95): os dois preços que valem, com a origem de cada um.
        precos: precosParaAPlataforma(await lerPrecosDaEmpresa(ctx.admin, String(args.organization_id))),
      };
    },
  },
  {
    name: "plataforma_atribuir_plano",
    description:
      "Atribui ou troca o PLANO de uma empresa como o dono: empresa isenta passa a pagar (nasce em teste com os dias do plano); quem já tem plano troca: no " +
      "teste vale na hora; depois do teste fica agendado para a renovação (plano negociado não paga diferença). Aceita plano escondido. Recusa com a lista " +
      "do que tirar quando o uso (pessoas, números) não cabe. Os módulos seguem o plano no dia em que ele vale. " +
      "O QUE NÃO FAZ: não cancela a assinatura (é decisão do cliente, na tela dele) nem marca como pago.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      plano: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe("O nome do plano (ou o id). Veja os planos em plataforma_ver_cobranca."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, plano: "Profissional" },
    operacao: OPERACAO_GERIR_COBRANCA,
    handler: async (ctx, args) => {
      await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      await exigirCobrancaLigada(ctx);
      const plano = await acharPlano(ctx, String(args.plano));
      const r = await atribuirOuTrocarPlano(
        ctx.admin,
        String(args.organization_id),
        plano.id,
        ator(ctx),
      );
      if (!r.ok) {
        const oQueTirar = (r.details as { o_que_tirar?: Record<string, number> } | undefined)
          ?.o_que_tirar;
        if (r.code === "uso_acima_do_plano" && oQueTirar) {
          return {
            ok: false,
            erro: "uso_acima_do_plano",
            o_que_tirar: Object.entries(oQueTirar).map(([recurso, n]) => ({
              recurso: recurso === "assentos" ? "pessoas" : "numeros",
              tirar: n,
            })),
            mensagem: `O uso atual não cabe no ${plano.nome}. Revogue acesso em Equipe ou exclua números em Conexões e tente de novo.`,
          };
        }
        recusar(r.message);
      }
      return { ...r, plano: plano.nome };
    },
  },
  {
    name: "plataforma_gerar_link_de_pagamento",
    description:
      "O MESMO botão do card Cobrança: devolve o link da fatura em aberto ou cria um (no teste, em atraso ou cancelada; isenta não tem). No Asaas, a primeira " +
      "vez pede o CPF ou CNPJ de quem paga (`documento`): ele vai direto ao Asaas e não fica guardado. O cliente no provedor nasce com o e-mail de quem " +
      "administra a empresa. O QUE NÃO FAZ: não marca como pago; o pagamento só vem do aviso do provedor e da releitura.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      documento: z
        .string()
        .trim()
        .max(32)
        .optional()
        .describe("CPF ou CNPJ de quem paga, com ou sem máscara. Só na primeira vez, no Asaas."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: OPERACAO_GERIR_COBRANCA,
    redigirParaAuditoria: (args) => ({
      organization_id: args.organization_id,
      documento: args.documento ? "informado" : "ausente",
    }),
    handler: async (ctx, args) => {
      await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      await exigirCobrancaLigada(ctx);
      const orgId = String(args.organization_id);
      const email = await emailDoAdminDaEmpresa(ctx.admin, orgId);
      const r = await gerarLinkDePagamento(ctx.admin, {
        orgId,
        documentoBruto: typeof args.documento === "string" ? args.documento : undefined,
        email,
        chaveIdempotencia: randomUUID(),
        urlDeVolta: urlDoPainelDaEmpresa(),
        actorUserId: ctx.autorUserId,
        requestId: ctx.requestId,
        comoDono: true,
      });
      if (r.ok) return { url: r.url };
      const vivo = (r.details as { link_de_pagamento?: unknown } | undefined)?.link_de_pagamento;
      if (r.code === "pagamento_em_andamento" && typeof vivo === "string") return { url: vivo };
      const frases: Record<string, string> = {
        not_found:
          "Esta empresa é isenta: atribua um plano (plataforma_atribuir_plano) antes de gerar o link.",
        provedor_nao_conectado:
          "O provedor de pagamento não está conectado: uma pessoa conecta em Admin › Cobrança › Conexão.",
        documento_obrigatorio:
          "No Asaas a primeira cobrança pede o CPF ou CNPJ de quem paga: passe `documento`.",
      };
      recusar(frases[r.code] ?? r.message);
    },
  },
  {
    name: "plataforma_ajustar_cobranca",
    description:
      "Ajusta a cobrança de uma empresa: `dar_prazo` até uma data (até 60 dias), `isentar` (não paga e não tem limites; recusa se ainda há assinatura viva " +
      "no provedor) ou `voltar_a_cobranca` (a isenta passa a pagar no `plano` informado, em teste). Dar prazo e isentar reativam na hora quem foi suspenso " +
      "por falta de pagamento. O QUE NÃO FAZ: não cancela no provedor nem marca como pago.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      acao: z
        .enum(["dar_prazo", "isentar", "voltar_a_cobranca"])
        .describe("dar_prazo (com o campo ate), isentar, ou voltar_a_cobranca (com o campo plano)."),
      ate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'use "AAAA-MM-DD"')
        .optional()
        .describe("Com dar_prazo: o último dia do prazo (até 60 dias)."),
      plano: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("Com voltar_a_cobranca: o nome do plano."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, acao: "dar_prazo", ate: "2026-11-15" },
    operacao: OPERACAO_GERIR_COBRANCA,
    handler: async (ctx, args) => {
      await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      await exigirCobrancaLigada(ctx);
      const orgId = String(args.organization_id);
      if (args.acao === "dar_prazo") {
        if (typeof args.ate !== "string") recusar('dar_prazo precisa de `ate` ("AAAA-MM-DD").');
        // O fim daquele dia em São Paulo, como o card faz no fuso de quem clica.
        const r = await darPrazo(
          ctx.admin,
          orgId,
          new Date(`${args.ate}T23:59:59-03:00`),
          ator(ctx),
        );
        if (!r.ok) recusar(r.message);
        return r;
      }
      if (args.acao === "isentar") {
        const r = await tornarIsenta(ctx.admin, orgId, ator(ctx));
        if (!r.ok) recusar(r.message);
        return r;
      }
      if (typeof args.plano !== "string") recusar("voltar_a_cobranca precisa de `plano`.");
      const { data: tem } = await ctx.admin
        .from("cobranca_assinaturas")
        .select("organization_id")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (tem)
        recusar(
          "esta empresa já está na cobrança. Para trocar o plano, use plataforma_atribuir_plano.",
        );
      const plano = await acharPlano(ctx, args.plano);
      const r = await atribuirOuTrocarPlano(ctx.admin, orgId, plano.id, ator(ctx));
      if (!r.ok) recusar(r.message);
      return { ...r, plano: plano.nome };
    },
  },
  {
    name: "plataforma_listar_pedidos_de_cadastro",
    description:
      'Os PEDIDOS DE CADASTRO esperando aprovação (modo do cadastro "com aprovação"): a empresa, quem pediu (e-mail mascarado), o plano escolhido ' +
      "(sem escolha, o do cadastro) e o que a empresa faz. Para aprovar ou recusar, plataforma_decidir_pedido_de_cadastro. " +
      "Desde a .91, também as EMPRESAS que entraram com o Facebook no passo do telefone e esperam a Time ligar o número oficial " +
      "(empresas_esperando_o_numero; a ligação continua à mão, em Admin › Cadastro incorporado).",
    inputSchema: {},
    exemplo: {},
    operacao: null,
    handler: async (ctx) => {
      const [pedidos, modo, esperando] = await Promise.all([
        lerPedidosDeCadastro(ctx.admin),
        modoDeCadastro(),
        // FORK MIA (.91): a empresa no "esperando a Time" do passo do telefone.
        lerEmpresasEsperandoONumero(ctx.admin),
      ]);
      return {
        modo_do_cadastro: modo,
        total: pedidos.length,
        pedidos: pedidos.map((p) => ({
          pedido_id: p.id,
          empresa: p.empresa,
          email: p.email,
          plano: p.plano,
          o_que_faz: p.o_que_faz,
          pedido_em: p.criado_em,
        })),
        empresas_esperando_o_numero: esperando.map((e) => ({
          organization_id: e.organization_id,
          nome: e.nome,
          entrou_com_facebook_em: e.desde,
        })),
      };
    },
  },
  {
    name: "plataforma_decidir_pedido_de_cadastro",
    description:
      "Aprova (cria a empresa no plano escolhido, quem pediu vira administrador e o teste começa) ou recusa um pedido de cadastro, com o `motivo` que vai no " +
      "e-mail para quem pediu. Rodar de novo num pedido decidido devolve a decisão anterior. A conta precisa ter confirmado o e-mail para ser aprovada. " +
      "O QUE NÃO FAZ: não muda o modo do cadastro (fica em /admin/cadastro, porque abre ou fecha a porta da instalação).",
    inputSchema: {
      pedido_id: z
        .string()
        .uuid()
        .describe("O id do pedido (plataforma_listar_pedidos_de_cadastro)."),
      decisao: z
        .enum(["aprovar", "recusar"])
        .describe("aprovar (a empresa nasce no plano escolhido) ou recusar (com o motivo, que vai por e-mail)."),
      motivo: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Com recusar: o motivo, que vai no e-mail para quem pediu."),
    },
    exemplo: { pedido_id: "00000000-0000-4000-8000-0000000000aa", decisao: "aprovar" },
    operacao: OPERACAO_DECIDIR_CADASTRO,
    handler: async (ctx, args) => {
      const r = await decidirPedidoDeCadastro(
        ctx.admin,
        {
          pedidoId: String(args.pedido_id),
          decisao: args.decisao as "aprovar" | "recusar",
          motivo: typeof args.motivo === "string" ? args.motivo : null,
        },
        ator(ctx),
      );
      if (!r.ok) recusar(r.message);
      return r;
    },
  },
];

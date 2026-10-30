/**
 * FORK MIA (.98) · CUPONS, PARCEIROS E REPASSES NO MCP DE PLATAFORMA (protótipo
 * "Cupons e parceiros", aprovado em 27/10/2026; docs/fork/cupons-e-parceiros.md).
 * Seis, e a operação do token segue o estrago:
 *
 *   plataforma_garantir_parceiro    `gerir_cobranca`: cria ou muda pelo CPF ou CNPJ
 *   plataforma_ver_parceiros        leitura: comissões, cupons, clientes, a receber
 *   plataforma_garantir_cupom       `gerir_planos`: cria, muda ou pausa pelo código
 *   plataforma_ver_cupons           leitura: o que dá, usos, situação, o link
 *   plataforma_ver_repasses         leitura: o mês, por parceiro
 *   plataforma_marcar_repasse_pago  `gerir_cobranca`: o Pix feito por fora
 *
 * O QUE O MCP NÃO FAZ (de propósito): mandar dinheiro (a Time faz o Pix); anexar a
 * nota ou o recibo (só pela tela, com o arquivo), e sem o anexo o repasse não vira
 * pago; aplicar cupom em cliente que já pagou ou trocar o parceiro de um cliente
 * (na ficha da empresa, com a verificação em duas etapas); anonimizar parceiro.
 *
 * Os dados do parceiro saem MASCARADOS na leitura (documento e Pix): quem precisa
 * da chave para fazer o Pix abre Admin › Parceiros. A auditoria das chamadas nunca
 * leva o documento nem o Pix (`redigirParaAuditoria`).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { garantirCupom, lerCupomPorCodigo, lerCupons, type CupomComUsos } from "@/lib/cupons/banco";
import { diaCivilFormatado, motivoDoCupom, normalizarCodigo, textoDoBeneficio, textoDoSetup } from "@/lib/cupons/regras";
import { documentoMascarado } from "@/lib/dados-fiscais/regras";
import { env } from "@/lib/env";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { garantirParceiro, type Parceiro } from "@/lib/parceiros/banco";
import { competenciaPadrao, lerParceirosParaATela, lerRepassesParaATela, type ParceiroNaLista } from "@/lib/parceiros/leitura";
import { marcarRepassePago } from "@/lib/parceiros/repasses";
import { pixMascarado } from "@/lib/parceiros/regras";
import { lerPlanosComModulos } from "@/lib/planos-mia/leitura";

import { recusar } from "../recusa";
import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";

const OPERACAO_GERIR_PLANOS = "gerir_planos";
const OPERACAO_GERIR_COBRANCA = "gerir_cobranca";

const reais = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);

async function exigirCobrancaLigada(ctx: ContextoDaFerramenta): Promise<void> {
  if (!(await moduloLigado(ctx.admin, "cobranca"))) {
    recusar("a cobrança está desligada nesta instalação: cupom e parceiro só existem com ela ligada. Quem liga é uma pessoa, em Admin › Recursos opcionais › Cobrança dos seus clientes.");
  }
}

function parceiroParaAPlataforma(p: Parceiro) {
  return {
    id: p.id,
    nome: p.nome,
    tipo_documento: p.tipo_documento,
    documento: p.documento ? documentoMascarado(p.documento) : null,
    email: p.email,
    chave_pix: pixMascarado(p.chave_pix),
    comissao_pct: p.comissao_pct,
    comissao_meses: p.comissao_meses,
    comissao_setup_pct: p.comissao_setup_pct,
    ativo: p.ativo,
    anonimizado: p.anonimizado_em !== null,
  };
}

function linhaDoParceiro(p: ParceiroNaLista, comClientes: boolean) {
  return {
    ...parceiroParaAPlataforma(p),
    cupons: p.cupons,
    clientes: comClientes
      ? p.clientes.map((c) => ({
          organization_id: c.organization_id,
          nome: c.nome,
          plano: c.plano,
          cupom: c.codigo,
          entrou_em: c.entrou_em,
          comissao_fixada: c.termos_fixados ? { pct: c.comissao_pct, meses: c.comissao_meses } : null,
        }))
      : p.clientes.length,
    a_receber_no_proximo_fechamento: reais(p.a_receber_cents),
    pago_pelos_clientes_no_mes: reais(p.pago_no_mes_cents),
  };
}

function situacaoDoCupom(c: CupomComUsos): string {
  const m = motivoDoCupom(c, { planoId: null, usos: c.usos, agora: new Date() });
  return m ?? "ativo";
}

function linhaDoCupom(c: CupomComUsos, nomeDoPlano: Map<string, string>) {
  const base = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return {
    id: c.id,
    codigo: c.codigo,
    o_que_da: textoDoBeneficio(c),
    beneficio: c.beneficio,
    valor: c.valor,
    meses: c.meses,
    setup: textoDoSetup(c),
    setup_tipo: c.setup_tipo,
    setup_valor: c.setup_valor,
    planos: c.planos.map((id) => nomeDoPlano.get(id) ?? id),
    vale_ate: c.vale_ate ? diaCivilFormatado(c.vale_ate) : null,
    limite_de_usos: c.limite_de_usos,
    usos: c.usos,
    situacao: situacaoDoCupom(c),
    parceiro_id: c.parceiro_id,
    comissao_propria_pct: c.comissao_pct,
    link: `${base}/precos?cupom=${c.codigo}`,
  };
}

async function nomesDosPlanos(ctx: ContextoDaFerramenta): Promise<Map<string, string>> {
  return new Map((await lerPlanosComModulos(ctx.admin)).map((p) => [p.id, p.nome]));
}

const PARCEIRO_DE_EXEMPLO = {
  nome: "Parceira Exemplo",
  documento: "529.982.247-25",
  email: "parceira@exemplo.com.br",
  chave_pix: "parceira@exemplo.com.br",
  comissao_pct: 20,
  comissao_meses: 12,
  comissao_setup_pct: 30,
};

export const FERRAMENTAS_DE_CUPONS_E_PARCEIROS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_parceiro",
    description:
      "Cria ou muda um PARCEIRO (quem indica clientes pelos cupons). A chave é o CPF ou CNPJ: a mesma entrada não regrava. Comissão da mensalidade (% e por quantos meses de cada cliente: 6, 12, 24 ou null = enquanto pagar) e do setup de implantação (%, venda única). " +
      "A comissão é sobre o LÍQUIDO: valor pago, menos o imposto (a alíquota de Admin › Cobrança), menos a taxa real do Asaas. Mudar a comissão vale só para os clientes novos: quem já pagou a primeira vez fica com a dele. Depois, crie o cupom com plataforma_garantir_cupom.",
    inputSchema: {
      nome: z.string().trim().min(2).max(120).describe("O nome do parceiro."),
      documento: z.string().trim().min(11).max(20).describe("CPF (recibo) ou CNPJ (nota), com ou sem máscara. É a chave."),
      email: z.string().trim().email().max(160).describe("Para onde vai o extrato do mês."),
      chave_pix: z.string().trim().min(1).max(140).describe("A chave Pix do repasse."),
      comissao_pct: z.number().min(0).max(100).describe("A comissão da mensalidade, em %."),
      comissao_meses: z.union([z.literal(6), z.literal(12), z.literal(24), z.null()]).describe("Por quantos meses de cada cliente; null = enquanto o cliente pagar."),
      comissao_setup_pct: z.number().min(0).max(100).describe("A comissão do setup de implantação, em %. Venda única: paga uma vez."),
      ativo: z.boolean().optional().describe("false pausa o parceiro."),
    },
    exemplo: PARCEIRO_DE_EXEMPLO,
    operacao: OPERACAO_GERIR_COBRANCA,
    // O CPF ou CNPJ e o Pix nunca entram na trilha de auditoria.
    redigirParaAuditoria: (args) => ({ ...args, documento: "[redigido]", chave_pix: "[redigido]", email: "[redigido]" }),
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const r = await garantirParceiro(ctx.admin, args, { ator: ctx.autorUserId });
      if (!r.ok) {
        if (r.motivo === "invalido") recusar(`confira os campos do parceiro: ${Object.keys(r.campos).join(", ")}.`);
        if (r.motivo === "documento_invalido") recusar("o CPF ou CNPJ não confere: os dígitos não batem.");
        if (r.motivo === "documento_de_outro") recusar("este CPF ou CNPJ já é de outro parceiro.");
        if (r.motivo === "anonimizado") recusar("este parceiro foi anonimizado (LGPD) e não muda mais.");
        throw new Error("não consegui gravar o parceiro.");
      }
      if (r.mudou) {
        void audit({
          action: r.criado ? "parceiro.criado" : "parceiro.alterado",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_parceiros",
          resourceId: r.parceiro.id,
          requestId: ctx.requestId,
          metadata: { via: "mcp", token_id: ctx.tokenId, comissao_pct: r.parceiro.comissao_pct, comissao_meses: r.parceiro.comissao_meses, comissao_setup_pct: r.parceiro.comissao_setup_pct },
        });
      }
      return { parceiro: parceiroParaAPlataforma(r.parceiro), criado: r.criado, mudou: r.mudou };
    },
  },
  {
    name: "plataforma_ver_parceiros",
    description:
      "Os parceiros: a comissão da mensalidade (e o prazo), a do setup, os cupons, quantos clientes, o que os clientes pagaram no mês e o que entra no próximo fechamento. Com `parceiro_id`, a lista dos clientes dele, com a comissão fixada de cada um. O documento e a chave Pix saem mascarados: a chave inteira fica em Admin › Parceiros.",
    inputSchema: {
      parceiro_id: z.string().uuid().optional().describe("Só este parceiro, com os clientes dele."),
    },
    operacao: null,
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const todos = await lerParceirosParaATela(ctx.admin);
      if (typeof args.parceiro_id === "string") {
        const p = todos.find((x) => x.id === args.parceiro_id);
        if (!p) recusar(`parceiro não encontrado: ${args.parceiro_id}. Veja a lista com plataforma_ver_parceiros, sem o id.`);
        return { parceiro: linhaDoParceiro(p, true) };
      }
      return { parceiros: todos.map((p) => linhaDoParceiro(p, false)) };
    },
  },
  {
    name: "plataforma_garantir_cupom",
    description:
      "Cria, muda ou pausa um CUPOM pelo CÓDIGO (a mesma entrada não regrava). Dá desconto em % ou em R$ por 1, 3, 6 ou 12 mensalidades (`meses`; null = todas), ou dias grátis (`beneficio: \"dias\"`: o mesmo teste do plano; com plano que já tem teste, vale o maior, sem somar). O desconto no SETUP é separado (`setup_tipo`). `planos`: nomes ou ids. `parceiro_id` é opcional; `comissao_pct` substitui a do parceiro neste cupom. " +
      "`ativo: false` pausa: cupom não se apaga. Mudar um cupom já usado vale para quem entrar daqui para a frente. O link que o parceiro divulga vem na resposta.",
    inputSchema: {
      codigo: z.string().trim().min(3).max(20).describe("Letras e números, sem espaço. Ex.: JOAO10."),
      beneficio: z.enum(["pct", "reais", "dias"]).describe("pct = desconto em %; reais = desconto em R$; dias = dias grátis."),
      valor: z.number().positive().describe("O percentual, os reais ou os dias."),
      meses: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12), z.null()]).optional().describe("Por quantas mensalidades; null = todas. Ignorado nos dias grátis."),
      setup_tipo: z.enum(["nenhum", "pct", "reais"]).optional().describe("O desconto no setup de implantação."),
      setup_valor: z.number().min(0).optional().describe("O percentual ou os reais do desconto no setup."),
      planos: z.array(z.string().trim().min(1)).min(1).max(50).describe("Os planos em que vale: nomes ou ids."),
      vale_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("AAAA-MM-DD, inclusive. null = sem prazo."),
      limite_de_usos: z.number().int().min(1).nullable().optional().describe("Quantas empresas podem usar. null = sem limite."),
      parceiro_id: z.string().uuid().nullable().optional().describe("O parceiro do cupom (plataforma_ver_parceiros)."),
      comissao_pct: z.number().min(0).max(100).nullable().optional().describe("A comissão deste cupom; null = a do parceiro."),
      ativo: z.boolean().optional().describe("false pausa."),
    },
    exemplo: { codigo: "JOAO10", beneficio: "pct", valor: 10, meses: 3, setup_tipo: "pct", setup_valor: 20, planos: ["Profissional"] },
    operacao: OPERACAO_GERIR_PLANOS,
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const todos = await lerPlanosComModulos(ctx.admin);
      const ativos = todos.filter((p) => p.arquivado_em === null);
      const ids = (args.planos as string[]).map((v) => {
        const achado = ativos.find((p) => p.id === v) ?? ativos.find((p) => p.nome.toLocaleLowerCase("pt-BR") === v.toLocaleLowerCase("pt-BR"));
        if (!achado) recusar(`plano não encontrado: "${v}". Os planos ativos são: ${ativos.map((p) => p.nome).join(", ") || "nenhum"}.`);
        return achado.id;
      });
      const codigo = normalizarCodigo(args.codigo);
      const atual = await lerCupomPorCodigo(ctx.admin, codigo);
      const r = await garantirCupom(
        ctx.admin,
        {
          codigo,
          beneficio: args.beneficio,
          valor: args.valor,
          meses: args.beneficio === "dias" ? null : args.meses === undefined ? (atual?.meses ?? null) : args.meses,
          setup_tipo: args.setup_tipo ?? atual?.setup_tipo ?? "nenhum",
          setup_valor: args.setup_valor ?? atual?.setup_valor ?? 0,
          planos: ids,
          vale_ate: args.vale_ate === undefined ? (atual?.vale_ate ?? null) : args.vale_ate,
          limite_de_usos: args.limite_de_usos === undefined ? (atual?.limite_de_usos ?? null) : args.limite_de_usos,
          parceiro_id: args.parceiro_id === undefined ? (atual?.parceiro_id ?? null) : args.parceiro_id,
          comissao_pct: args.comissao_pct === undefined ? (atual?.comissao_pct ?? null) : args.comissao_pct,
          ...(typeof args.ativo === "boolean" ? { ativo: args.ativo } : {}),
        },
        ctx.autorUserId,
      );
      if (!r.ok) {
        if (r.motivo === "invalido") recusar(`confira os campos do cupom: ${Object.entries(r.campos).map(([k, v]) => `${k} (${v})`).join(", ")}.`);
        if (r.motivo === "parceiro_inexistente") recusar("esse parceiro não existe mais. Veja em plataforma_ver_parceiros.");
        if (r.motivo === "plano_inexistente") recusar("um dos planos não existe mais. Veja em plataforma_ver_cobranca.");
        throw new Error("não consegui gravar o cupom.");
      }
      if (r.mudou) {
        void audit({
          action: r.criado ? "cupom.criado" : "cupom.alterado",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_cupons",
          resourceId: r.cupom.id,
          requestId: ctx.requestId,
          metadata: { via: "mcp", token_id: ctx.tokenId, codigo: r.cupom.codigo, beneficio: r.cupom.beneficio, valor: r.cupom.valor, meses: r.cupom.meses, parceiro_id: r.cupom.parceiro_id, ativo: r.cupom.ativo },
        });
      }
      const usos = (await lerCupomPorCodigo(ctx.admin, r.cupom.codigo))?.usos ?? 0;
      return { cupom: linhaDoCupom({ ...r.cupom, usos }, new Map(todos.map((p) => [p.id, p.nome]))), criado: r.criado, mudou: r.mudou };
    },
  },
  {
    name: "plataforma_ver_cupons",
    description:
      "Os cupons: o que cada um dá, o desconto no setup, os planos, a validade, o limite e quantas empresas usam, a situação (ativo, pausado, vencido, esgotado), o parceiro e o link que ele divulga. Com `codigo`, só aquele.",
    inputSchema: {
      codigo: z.string().trim().max(40).optional().describe("Só este cupom."),
    },
    operacao: null,
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const nomes = await nomesDosPlanos(ctx);
      if (typeof args.codigo === "string" && args.codigo !== "") {
        const c = await lerCupomPorCodigo(ctx.admin, args.codigo);
        if (!c) recusar(`não existe o cupom ${normalizarCodigo(args.codigo)}. Veja a lista com plataforma_ver_cupons, sem o código.`);
        return { cupom: linhaDoCupom(c, nomes) };
      }
      return { cupons: (await lerCupons(ctx.admin)).map((c) => linhaDoCupom(c, nomes)) };
    },
  },
  {
    name: "plataforma_ver_repasses",
    description:
      "Os repasses de um mês, por parceiro: as mensalidades e os setups separados (pago, imposto, taxa do Asaas, líquido, comissão), os estornos, o total, se o extrato foi, se a nota ou o recibo está anexado, e o que já foi pago (a data e quem). Sem `competencia`, o último mês fechado pelo calendário. A situação é `aguardando_nota`, `pronto_para_pagar` ou `pago`. A chave Pix sai mascarada.",
    inputSchema: {
      competencia: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("O mês, AAAA-MM. Ex.: 2026-10."),
    },
    operacao: null,
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const competencia = typeof args.competencia === "string" ? `${args.competencia}-01` : competenciaPadrao(new Date());
      const d = await lerRepassesParaATela(ctx.admin, competencia);
      return {
        competencia: competencia.slice(0, 7),
        aliquota_pct: d.config.aliquota_pct,
        calendario: { fecha_no_dia: d.config.dia_fechamento, nota_ate: d.prazos.nota_ate, pix_ate: d.prazos.pix_ate },
        total: reais(d.total_cents),
        repasses: d.repasses.map((r) => ({
          repasse_id: r.id,
          parceiro_id: r.parceiro_id,
          parceiro: r.parceiro,
          chave_pix: pixMascarado(r.chave_pix),
          situacao: r.situacao,
          total: reais(r.total_cents),
          mensalidades: {
            quantas: r.totais.mensalidades,
            pago: reais(r.totais.mensalidades_pago_cents),
            imposto: reais(r.totais.mensalidades_imposto_cents),
            taxa: reais(r.totais.mensalidades_taxa_cents),
            liquido: reais(r.totais.mensalidades_liquido_cents),
            comissao: reais(r.totais.mensalidades_comissao_cents),
          },
          setups: {
            quantos: r.totais.setups,
            pago: reais(r.totais.setups_pago_cents),
            imposto: reais(r.totais.setups_imposto_cents),
            taxa: reais(r.totais.setups_taxa_cents),
            liquido: reais(r.totais.setups_liquido_cents),
            comissao: reais(r.totais.setups_comissao_cents),
          },
          estornos: reais(r.totais.estornos_cents),
          extrato_enviado_em: r.extrato_enviado_em,
          extrato_erro: r.extrato_erro,
          tem_anexo: r.tem_anexo,
          anexo_em: r.anexo_em,
          pago_em: r.pago_em,
          pago_por: r.pago_por,
        })),
      };
    },
  },
  {
    name: "plataforma_marcar_repasse_pago",
    description:
      "Marca um repasse como pago, depois que a Time fez o Pix por fora: grava a data e quem respondeu pelo token. O sistema nunca manda dinheiro. Sem a nota (CNPJ) ou o recibo (CPF) anexado, recusa: o anexo entra só pela tela, em Admin › Parceiros › Repasses do mês. O `repasse_id` vem de plataforma_ver_repasses. Marcar de novo não muda nada.",
    inputSchema: {
      repasse_id: z.string().uuid().describe("O id do repasse (plataforma_ver_repasses)."),
    },
    exemplo: { repasse_id: "00000000-0000-4000-8000-000000000002" },
    operacao: OPERACAO_GERIR_COBRANCA,
    handler: async (ctx, args) => {
      await exigirCobrancaLigada(ctx);
      const r = await marcarRepassePago(ctx.admin, { repasseId: String(args.repasse_id), ator: ctx.autorUserId });
      if (!r.ok) {
        if (r.motivo === "nao_encontrado") recusar(`repasse não encontrado: ${String(args.repasse_id)}. Veja em plataforma_ver_repasses.`);
        if (r.motivo === "sem_anexo") recusar("este repasse ainda não tem a nota ou o recibo anexado. Anexe em Admin › Parceiros › Repasses do mês e marque como pago depois.");
        throw new Error("não consegui marcar o repasse como pago.");
      }
      if (!r.jaEstava) {
        void audit({
          action: "repasse.marcado_pago",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_repasses",
          resourceId: r.repasse.id,
          requestId: ctx.requestId,
          metadata: { via: "mcp", token_id: ctx.tokenId, total_cents: r.repasse.total_cents, competencia: r.repasse.competencia, parceiro_id: r.repasse.parceiro_id },
        });
      }
      return { repasse_id: r.repasse.id, pago_em: r.repasse.pago_em, total: reais(r.repasse.total_cents), ja_estava: r.jaEstava };
    },
  },
];


/**
 * FORK MIA (.109) · o produto no negócio do lado do servidor
 * (lib/produto-no-negocio/servidor.ts), num banco em memória.
 *
 * O preço congelado do catálogo, a soma que vira o valor do negócio, o valor
 * digitado à mão, o negócio antigo que não é tocado, os itens da proposta
 * enviada no bloco, o recálculo depois do envio, a recusa do ganho sem item e as
 * linhas da comanda. Tudo com dado fictício (Clínica Sorriso Exemplo).
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/types";
import {
  gravarItensDoNegocio,
  lerItensDosNegocios,
  lerNegocioComItens,
  linhasDaComandaDoNegocio,
  recalcularValorDoNegocio,
  recusaDoProdutoNoGanho,
} from "@/lib/produto-no-negocio/servidor";
import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

const ORG = "0b0c0d0e-1111-4111-8111-000000000109";
const OUTRA = "0b0c0d0e-1111-4111-8111-000000000209";
const FUNIL = "0b0c0d0e-2222-4222-8222-000000000109";
const NOVO = "0b0c0d0e-3333-4333-8333-000000000001";
const ANTIGO = "0b0c0d0e-3333-4333-8333-000000000002";
const COM_PROPOSTA = "0b0c0d0e-3333-4333-8333-000000000003";
const IMPLANTE = "0b0c0d0e-4444-4444-8444-000000000001";
const LIMPEZA = "0b0c0d0e-4444-4444-8444-000000000002";
const LENTE = "0b0c0d0e-4444-4444-8444-000000000003";
const INATIVO = "0b0c0d0e-4444-4444-8444-000000000004";
const DA_VIZINHA = "0b0c0d0e-4444-4444-8444-000000000005";
const EM_EURO = "0b0c0d0e-4444-4444-8444-000000000006";
const PROPOSTA = "0b0c0d0e-5555-4555-8555-000000000001";
const PROPOSTA_VELHA = "0b0c0d0e-5555-4555-8555-000000000002";
const USUARIO = "0b0c0d0e-6666-4666-8666-000000000109";

const lead = (id: string, ajuste: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  pipeline_id: FUNIL,
  value_cents: null,
  currency: "BRL",
  valor_a_mao: false,
  updated_at: "2026-11-10T12:00:00.000Z",
  ...ajuste,
});

function banco(extras: Record<string, Array<Record<string, unknown>>> = {}) {
  return bancoEmMemoria({
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG, vocabulary: { produto: "Tratamento" }, settings: { pedir_produto_no_ganho: true } },
    ],
    crm_leads: [
      lead(NOVO),
      // De antes dos itens: marca nula e o valor digitado.
      lead(ANTIGO, { value_cents: 340_000, valor_a_mao: null }),
      lead(COM_PROPOSTA, { value_cents: 800_000 }),
    ],
    catalog_products: [
      { id: IMPLANTE, organization_id: ORG, codigo: "IMP-01", nome: "Implante unitário", preco_cents: 450_000, moeda: "BRL", ativo: true },
      { id: LIMPEZA, organization_id: ORG, codigo: "LIM-01", nome: "Limpeza", preco_cents: 22_000, moeda: "BRL", ativo: true },
      { id: LENTE, organization_id: ORG, codigo: "LEN-01", nome: "Lente de contato dental", preco_cents: 140_000, moeda: "BRL", ativo: true },
      { id: INATIVO, organization_id: ORG, codigo: "OLD", nome: "Fora de linha", preco_cents: 1_000, moeda: "BRL", ativo: false },
      { id: DA_VIZINHA, organization_id: OUTRA, codigo: "X", nome: "Da vizinha", preco_cents: 1_000, moeda: "BRL", ativo: true },
      { id: EM_EURO, organization_id: ORG, codigo: "EU", nome: "Em euro", preco_cents: 1_000, moeda: "EUR", ativo: true },
    ],
    mia_itens_do_negocio: [],
    crm_proposals: [
      { id: PROPOSTA, organization_id: ORG, lead_id: COM_PROPOSTA, numero: 12, ano: 2026, status: "enviada", sent_at: "2026-11-09T10:00:00Z", moeda: "BRL" },
      { id: PROPOSTA_VELHA, organization_id: ORG, lead_id: COM_PROPOSTA, numero: 11, ano: 2026, status: "substituida", sent_at: "2026-11-01T10:00:00Z", moeda: "BRL" },
    ],
    crm_proposal_items: [
      { id: "pi-1", organization_id: ORG, proposal_id: PROPOSTA, product_id: LENTE, descricao: "Lente de contato dental", quantidade: 6, preco_unitario_cents: 140_000, desconto_cents: 40_000, position: 1 },
      { id: "pi-velho", organization_id: ORG, proposal_id: PROPOSTA_VELHA, product_id: LENTE, descricao: "Lente (v1)", quantidade: 4, preco_unitario_cents: 140_000, desconto_cents: 0, position: 1 },
    ],
    ...extras,
  });
}

const gravar = (b: ReturnType<typeof banco>, leadId: string, pedido: Parameters<typeof gravarItensDoNegocio>[1]["pedido"]) =>
  gravarItensDoNegocio(b.cliente as never, { organizationId: ORG, leadId, userId: USUARIO, pedido, idioma: "pt-BR" });

const lerLead = (b: ReturnType<typeof banco>, id: string) =>
  (b.db.crm_leads as Array<Record<string, unknown>>).find((l) => l.id === id)!;

async function recusa(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("esperava uma recusa");
}

describe("gravar os itens do negócio", () => {
  it("o preço, o nome e o código saem do catálogo e ficam congelados; o valor vira a soma", async () => {
    const b = banco();
    const r = await gravar(b, NOVO, {
      itens: [
        { product_id: IMPLANTE, quantidade: 2, desconto_cents: 0 },
        { product_id: LIMPEZA, quantidade: 1, desconto_cents: 2_000 },
      ],
      valor: { modo: "soma" },
    });
    expect(r.mudou).toBe(true);
    expect(r.valor).toMatchObject({ modo: "soma", somaCents: 920_000, valorCents: 920_000 });
    expect(lerLead(b, NOVO)).toMatchObject({ value_cents: 920_000, valor_a_mao: false });
    expect(b.db.mia_itens_do_negocio).toHaveLength(2);
    expect(b.db.mia_itens_do_negocio![0]).toMatchObject({
      organization_id: ORG,
      lead_id: NOVO,
      product_id: IMPLANTE,
      nome: "Implante unitário",
      codigo: "IMP-01",
      preco_unitario_cents: 450_000,
      quantidade: 2,
      created_by_user_id: USUARIO,
    });

    // O catálogo muda de preço: o item que já estava no negócio fica com o dele.
    (b.db.catalog_products as Array<Record<string, unknown>>)[0]!.preco_cents = 480_000;
    const depois = await gravar(b, NOVO, {
      itens: [
        { id: String(b.db.mia_itens_do_negocio![0]!.id), quantidade: 3, desconto_cents: 0 },
        { product_id: LIMPEZA, quantidade: 1, desconto_cents: 2_000 },
      ],
      valor: { modo: "soma" },
    });
    expect(depois.itens.find((i) => i.productId === IMPLANTE)).toMatchObject({ precoUnitarioCents: 450_000, quantidade: 3 });
    expect(lerLead(b, NOVO).value_cents).toBe(3 * 450_000 + 20_000);
  });

  it("o que não vem no pedido sai do bloco; sem item, o valor volta a Sem valor", async () => {
    const b = banco();
    await gravar(b, NOVO, { itens: [{ product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 }], valor: { modo: "soma" } });
    const r = await gravar(b, NOVO, { itens: [], valor: { modo: "soma" } });
    expect(b.db.mia_itens_do_negocio).toHaveLength(0);
    expect(r.valor).toMatchObject({ modo: "soma", valorCents: null });
    expect(lerLead(b, NOVO).value_cents).toBeNull();
  });

  // FORK MIA (fusão v1.124): as vendas registradas do upstream (9449/9450).
  it("o último item sai: a rota devolve o negócio às vendas (9167), e com item não chama", async () => {
    const b = banco();
    await gravar(b, NOVO, { itens: [{ product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 }], valor: { modo: "soma" } });
    expect(b.chamadasRpc.filter((c) => c.nome === "fn_mia_valor_do_negocio_volta_as_vendas")).toHaveLength(0);

    await gravar(b, NOVO, { itens: [], valor: { modo: "soma" } });
    expect(b.chamadasRpc.filter((c) => c.nome === "fn_mia_valor_do_negocio_volta_as_vendas")).toEqual([
      { nome: "fn_mia_valor_do_negocio_volta_as_vendas", args: { p_org: ORG, p_lead: NOVO } },
    ]);
  });

  it("o último item sai com o Valor à mão igual: a rota chama a 9167 mesmo sem mudar o valor", async () => {
    const b = banco();
    const aMao = { modo: "a_mao" as const, value_cents: 300_000 };
    await gravar(b, NOVO, { itens: [{ product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 }], valor: aMao });
    expect(lerLead(b, NOVO)).toMatchObject({ value_cents: 300_000, valor_a_mao: true });

    const r = await gravar(b, NOVO, { itens: [], valor: aMao });
    expect(r.mudou).toBe(true);
    expect(b.chamadasRpc.filter((c) => c.nome === "fn_mia_valor_do_negocio_volta_as_vendas")).toEqual([
      { nome: "fn_mia_valor_do_negocio_volta_as_vendas", args: { p_org: ORG, p_lead: NOVO } },
    ]);
  });

  it("negócio sem item que segue sem item e sem mudança: nada é chamado", async () => {
    const b = banco();
    await gravar(b, NOVO, { itens: [], valor: { modo: "soma" } });
    expect(b.chamadasRpc.filter((c) => c.nome === "fn_mia_valor_do_negocio_volta_as_vendas")).toHaveLength(0);
  });

  it("valor digitado à mão: grava a marca e para de somar até alguém pedir a soma", async () => {
    const b = banco();
    await gravar(b, NOVO, {
      itens: [{ product_id: IMPLANTE, quantidade: 1, desconto_cents: 0 }],
      valor: { modo: "a_mao", value_cents: 400_000 },
    });
    expect(lerLead(b, NOVO)).toMatchObject({ value_cents: 400_000, valor_a_mao: true });
    const lido = await lerNegocioComItens(b.cliente as never, ORG, NOVO);
    expect(lido!.valor).toMatchObject({ modo: "a_mao", somaCents: 450_000, valorCents: 400_000, antigo: false });

    await gravar(b, NOVO, { itens: [{ product_id: IMPLANTE, quantidade: 1, desconto_cents: 0 }], valor: { modo: "soma" } });
    expect(lerLead(b, NOVO)).toMatchObject({ value_cents: 450_000, valor_a_mao: false });
  });

  it("o negócio antigo é lido como era (antigo, à mão) e nada é escrito só por ler", async () => {
    const b = banco();
    const lido = await lerNegocioComItens(b.cliente as never, ORG, ANTIGO);
    expect(lido!.valor).toEqual({ modo: "a_mao", antigo: true, somaCents: null, valorCents: 340_000 });
    expect(b.escritas).toHaveLength(0);
  });

  it("repetir o mesmo pedido não escreve nada", async () => {
    const b = banco();
    const pedido = { itens: [{ product_id: LIMPEZA, quantidade: 2, desconto_cents: 0 }], valor: { modo: "soma" as const } };
    await gravar(b, NOVO, pedido);
    const antes = b.escritas.length;
    const r = await gravar(b, NOVO, pedido);
    expect(r.mudou).toBe(false);
    expect(b.escritas.length).toBe(antes);
  });

  it("recusa produto de outra empresa, inativo, em outra moeda, repetido e desconto maior que o item", async () => {
    const b = banco();
    const umItem = (product_id: string, desconto_cents = 0, quantidade = 1) => ({
      itens: [{ product_id, quantidade, desconto_cents }],
      valor: { modo: "soma" as const },
    });
    expect((await recusa(gravar(b, NOVO, umItem(DA_VIZINHA)))).code).toBe("produto_fora_do_catalogo");
    expect((await recusa(gravar(b, NOVO, umItem(INATIVO)))).code).toBe("produto_inativo");
    expect((await recusa(gravar(b, NOVO, umItem(EM_EURO)))).code).toBe("moeda_divergente");
    expect((await recusa(gravar(b, NOVO, umItem(LIMPEZA, 22_001)))).code).toBe("validation_failed");
    expect(
      (
        await recusa(
          gravar(b, NOVO, {
            itens: [
              { product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 },
              { product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 },
            ],
            valor: { modo: "soma" },
          }),
        )
      ).code,
    ).toBe("item_repetido");
    expect((await recusa(gravar(b, "0b0c0d0e-3333-4333-8333-00000000ffff", umItem(LIMPEZA)))).status).toBe(404);
    expect(b.db.mia_itens_do_negocio).toHaveLength(0);
  });
});

describe("os itens da proposta no bloco", () => {
  it("só os da proposta mais recente que saiu, com o número, e eles entram na soma", async () => {
    const b = banco();
    const itens = (await lerItensDosNegocios(b.cliente as never, ORG, [COM_PROPOSTA])).get(COM_PROPOSTA)!;
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ origem: "proposta", nome: "Lente de contato dental", quantidade: 6, proposta: { id: PROPOSTA, numero: 12, ano: 2026 } });
    const lido = await lerNegocioComItens(b.cliente as never, ORG, COM_PROPOSTA);
    expect(lido!.valor).toMatchObject({ modo: "soma", somaCents: 800_000 });
  });

  it("o bloco soma os seus e os da proposta, e a gravação nunca mexe nos da proposta", async () => {
    const b = banco();
    await gravar(b, COM_PROPOSTA, { itens: [{ product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 }], valor: { modo: "soma" } });
    expect(lerLead(b, COM_PROPOSTA).value_cents).toBe(822_000);
    expect(b.escritas.some((e) => e.tabela === "crm_proposal_items")).toBe(false);
  });

  it("depois do envio, o valor volta a ser a soma; o negócio antigo (marca nula) não é tocado", async () => {
    const b = banco();
    await gravar(b, COM_PROPOSTA, { itens: [{ product_id: LIMPEZA, quantidade: 1, desconto_cents: 0 }], valor: { modo: "a_mao", value_cents: 700_000 } });
    // O envio da proposta (upstream) trocou o valor pelo total dela.
    lerLead(b, COM_PROPOSTA).value_cents = 800_000;
    expect(await recalcularValorDoNegocio(b.cliente as never, ORG, COM_PROPOSTA)).toEqual({ ok: true, mudou: true });
    expect(lerLead(b, COM_PROPOSTA)).toMatchObject({ value_cents: 822_000, valor_a_mao: false });

    const antes = b.escritas.length;
    expect(await recalcularValorDoNegocio(b.cliente as never, ORG, ANTIGO)).toEqual({ ok: true, mudou: false });
    expect(b.escritas.length).toBe(antes);
  });
});

describe("pedir o produto ao marcar como ganho, no servidor", () => {
  it("ligado e sem item: recusa com a palavra do funil; com item (ou da proposta), passa", async () => {
    const b = banco();
    const r = await recusaDoProdutoNoGanho(b.cliente as never, { organizationId: ORG, leadId: NOVO, idioma: "pt-BR" });
    expect(r).toEqual({ codigo: "produto_exigido_no_ganho", mensagem: "Escolha pelo menos um tratamento para marcar como ganho." });
    expect(await recusaDoProdutoNoGanho(b.cliente as never, { organizationId: ORG, leadId: COM_PROPOSTA, idioma: "pt-BR" })).toBeNull();
  });

  it("desligado (o padrão dos funis que já existem): nunca recusa", async () => {
    const b = banco({ crm_pipelines: [{ id: FUNIL, organization_id: ORG, vocabulary: {}, settings: {} }] });
    expect(await recusaDoProdutoNoGanho(b.cliente as never, { organizationId: ORG, leadId: NOVO, idioma: "pt-BR" })).toBeNull();
  });
});

describe("as linhas da comanda do ganho", () => {
  it("uma por item, somando o valor do negócio; sem item, nula", async () => {
    const b = banco();
    await gravar(b, NOVO, { itens: [{ product_id: IMPLANTE, quantidade: 1, desconto_cents: 0 }], valor: { modo: "a_mao", value_cents: 500_000 } });
    expect(await linhasDaComandaDoNegocio(b.cliente as never, ORG, NOVO, 500_000)).toEqual([
      { descricao: "Implante unitário", quantidade: 1, precoUnitarioCents: 450_000, descontoCents: 0, totalCents: 450_000 },
      { descricao: "Ajuste do valor digitado à mão", quantidade: 1, precoUnitarioCents: 50_000, descontoCents: 0, totalCents: 50_000 },
    ]);
    expect(await linhasDaComandaDoNegocio(b.cliente as never, ORG, ANTIGO, 340_000)).toBeNull();
  });
});

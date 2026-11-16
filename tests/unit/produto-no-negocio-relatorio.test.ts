/**
 * FORK MIA (.109) · os dois quadros do Relatório de vendas e a comanda do ganho
 * com uma linha por item (lib/produto-no-negocio/relatorio.ts e comanda.ts).
 *
 * Vendidos no mês: quantidade soma unidades, negócios conta cada negócio uma vez
 * por produto, e o total fecha com a Receita do mês (sem produto, ajuste do valor
 * digitado à mão e mensalidade). Tempo até fechar: mediana, média e o aviso com
 * menos de 3 vendas. Dado fictício.
 */
import { describe, expect, it } from "vitest";

import { linhasDaComanda } from "@/lib/produto-no-negocio/comanda";
import type { ItemDoNegocio } from "@/lib/produto-no-negocio/regras";
import { mediana, media, tempoAteFechar, vendidosNoMes, type VendaDoMes } from "@/lib/produto-no-negocio/relatorio";

const CATALOGO = {
  imp: { nome: "Implante unitário", preco: 450_000 },
  cla: { nome: "Clareamento", preco: 120_000 },
  lim: { nome: "Limpeza", preco: 22_000 },
} as const;

function it_(pid: keyof typeof CATALOGO, quantidade = 1, desconto = 0, ajuste: Partial<ItemDoNegocio> = {}): ItemDoNegocio {
  return {
    id: `${pid}-${quantidade}-${desconto}`,
    origem: "negocio",
    productId: pid,
    nome: CATALOGO[pid].nome,
    codigo: null,
    precoUnitarioCents: CATALOGO[pid].preco,
    quantidade,
    descontoCents: desconto,
    moeda: "BRL",
    proposta: null,
    ...ajuste,
  };
}

const NASCEU = "2026-11-01T12:00:00Z";
const diaDepois = (dias: number) => new Date(Date.parse(NASCEU) + dias * 86_400_000).toISOString();

let n = 0;
function venda(itens: ItemDoNegocio[], dias: number, valueCents?: number | null, recurring?: number | null): VendaDoMes {
  const soma = itens.reduce((a, i) => a + Math.max(0, i.precoUnitarioCents * i.quantidade - i.descontoCents), 0);
  return {
    leadId: `lead-${++n}`,
    valueCents: valueCents === undefined ? (itens.length ? soma : null) : valueCents,
    recurringValueCents: recurring ?? null,
    createdAt: NASCEU,
    closedAt: diaDepois(dias),
    itens,
  };
}

describe("vendidos no mês", () => {
  const vendas = [
    venda([it_("imp", 2)], 25),
    venda([it_("imp", 1, 20_000)], 34),
    venda([it_("cla"), it_("lim")], 3, 130_000), // valor à mão abaixo da soma (142.000)
    venda([it_("lim")], 1),
    venda([], 30, 280_000), // negócio de antes, sem item
    venda([it_("cla")], 4, undefined, 9_900), // com mensalidade
  ];
  const v = vendidosNoMes(vendas);

  it("uma linha por produto, pelo valor: quantidade soma unidades, negócios conta cada negócio uma vez", () => {
    expect(v.linhas.map((l) => [l.nome, l.quantidade, l.negocios, l.valorCents])).toEqual([
      ["Implante unitário", 3, 2, 900_000 + 430_000],
      ["Clareamento", 2, 2, 240_000],
      ["Limpeza", 2, 2, 44_000],
    ]);
    expect(v.negociosComItem).toBe(5);
  });

  it("o negócio sem item, o ajuste do valor à mão e a mensalidade fecham o total com a receita", () => {
    expect(v.sem).toEqual({ negocios: 1, valorCents: 280_000 });
    expect(v.ajuste).toEqual({ negocios: 1, valorCents: 130_000 - 142_000 });
    expect(v.recorrente).toEqual({ negocios: 1, valorCents: 9_900 });
    const receita = vendas.reduce((a, x) => a + (x.valueCents ?? 0) + (x.recurringValueCents ?? 0), 0);
    expect(v.total).toEqual({ quantidade: 7, negocios: 6, valorCents: receita });
    const somaDasLinhas =
      v.linhas.reduce((a, l) => a + l.valorCents, 0) + v.sem.valorCents + v.ajuste.valorCents + v.recorrente.valorCents;
    expect(somaDasLinhas).toBe(receita);
  });

  it("o item da proposta digitado à mão agrupa pelo texto; o do catálogo, pelo nome de hoje", () => {
    const r = vendidosNoMes([
      venda([it_("imp", 1, 0, { nomeNoCatalogo: "Implante (novo nome)" })], 5),
      venda([it_("imp", 1, 0, { productId: null, nome: "Implante 1 dente", origem: "proposta" })], 5),
    ]);
    expect(r.linhas.map((l) => l.nome).sort()).toEqual(["Implante (novo nome)", "Implante 1 dente"]);
  });

  it("sem venda, tudo zerado", () => {
    expect(vendidosNoMes([])).toMatchObject({ linhas: [], total: { quantidade: 0, negocios: 0, valorCents: 0 } });
  });
});

describe("tempo até fechar", () => {
  it("mediana e média, da mais lenta para a mais rápida; menos de 3 vendas avisa", () => {
    const t = tempoAteFechar([
      venda([it_("imp")], 21),
      venda([it_("imp")], 34),
      venda([it_("imp")], 28),
      venda([it_("imp"), it_("lim")], 41),
      venda([it_("lim")], 1),
      venda([], 30, 150_000),
    ]);
    expect(t.linhas).toEqual([
      { chave: "p:imp", nome: "Implante unitário", vendas: 4, medianaDias: 31, mediaDias: 31, poucas: false },
      { chave: "p:lim", nome: "Limpeza", vendas: 2, medianaDias: 21, mediaDias: 21, poucas: true },
    ]);
    expect(t.sem).toEqual({ vendas: 1, medianaDias: 30, mediaDias: 30, poucas: true });
  });

  it("a mediana mostra o caso típico; a média sobe com o negócio que se arrasta", () => {
    expect(mediana([2, 3, 4, 90])).toBe(3.5);
    expect(media([2, 3, 4, 90])).toBe(24.75);
    const t = tempoAteFechar([venda([it_("cla")], 2), venda([it_("cla")], 3), venda([it_("cla")], 90)]);
    expect(t.linhas[0]).toMatchObject({ vendas: 3, medianaDias: 3, mediaDias: 31.7, poucas: false });
    expect(t.sem).toBeNull();
  });

  it("o negócio com o mesmo produto em duas linhas conta uma vez; datas que não servem ficam fora", () => {
    const t = tempoAteFechar([
      venda([it_("lim"), it_("lim", 2)], 4),
      { ...venda([it_("lim")], 4), closedAt: null },
      { ...venda([it_("lim")], 4), closedAt: "2026-10-01T00:00:00Z" },
    ]);
    expect(t.linhas[0]).toMatchObject({ vendas: 1, medianaDias: 4 });
  });
});

describe("a comanda do ganho com uma linha por item", () => {
  it("sem item, nula: a comanda segue com a linha única de sempre", () => {
    expect(linhasDaComanda([], 100_000, "Ajuste")).toBeNull();
  });

  it("uma linha por item, com quantidade, preço congelado e desconto, quando o valor é a soma", () => {
    expect(linhasDaComanda([it_("imp", 2), it_("lim", 1, 2_000)], 920_000, "Ajuste")).toEqual([
      { descricao: "Implante unitário", quantidade: 2, precoUnitarioCents: 450_000, descontoCents: 0, totalCents: 900_000 },
      { descricao: "Limpeza", quantidade: 1, precoUnitarioCents: 22_000, descontoCents: 2_000, totalCents: 20_000 },
    ]);
  });

  it("valor à mão acima da soma: uma linha de ajuste; abaixo: desconto a mais, da última para a primeira", () => {
    const acima = linhasDaComanda([it_("cla")], 150_000, "Ajuste do valor digitado à mão")!;
    expect(acima.at(-1)).toEqual({ descricao: "Ajuste do valor digitado à mão", quantidade: 1, precoUnitarioCents: 30_000, descontoCents: 0, totalCents: 30_000 });
    const abaixo = linhasDaComanda([it_("imp"), it_("lim")], 460_000, "Ajuste")!;
    expect(abaixo.map((l) => [l.descontoCents, l.totalCents])).toEqual([
      [0, 450_000],
      [12_000, 10_000],
    ]);
    const muitoAbaixo = linhasDaComanda([it_("imp"), it_("lim")], 400_000, "Ajuste")!;
    expect(muitoAbaixo.map((l) => l.totalCents)).toEqual([400_000, 0]);
    for (const ls of [acima, abaixo, muitoAbaixo]) {
      for (const l of ls) expect(l.totalCents).toBeGreaterThanOrEqual(0);
    }
    expect(muitoAbaixo.reduce((a, l) => a + l.totalCents, 0)).toBe(400_000);
  });

  it("item da proposta com quantidade quebrada vira uma linha com o valor cheio", () => {
    const [l] = linhasDaComanda([it_("cla", 1.5, 0, { origem: "proposta" })], 180_000, "Ajuste")!;
    expect(l).toEqual({ descricao: "Clareamento", quantidade: 1, precoUnitarioCents: 180_000, descontoCents: 0, totalCents: 180_000 });
  });
});

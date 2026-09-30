/**
 * FORK MIA — a ordem da coluna, os filtros do quadro e o histórico de compras.
 */
import { describe, expect, it } from "vitest";

import type { Lead } from "@/lib/types/leads";
import { habitoDosCampos, itensDoPedido, resumirCompras, type Compra } from "./compras";
import {
  aplicarFiltrosDoCartao,
  escreverFiltrosDoCartao,
  lerFiltrosDoCartao,
  preservarParametrosDoCartao,
} from "./filtros";
import { grauDeUrgencia, ordenarColuna } from "./urgencia";
import { pedidoNaReguaDoNegocio, valorCurto } from "./dinheiro";
import type { SinaisDoCartao } from "./tipos";

const agora = new Date(2026, 8, 30, 12, 0);

function sinais(over: Partial<SinaisDoCartao> = {}): SinaisDoCartao {
  return {
    canal: { sigla: "DIRETO", campanha: null },
    bola: null,
    compromisso: null,
    objecao: null,
    tarefasAtrasadas: 0,
    temTarefaFutura: false,
    compras: null,
    pessoa: null,
    contatoNome: null,
    chanceDaEtapa: null,
    ...over,
  };
}

type L = Pick<Lead, "id" | "status" | "value_cents" | "score" | "next_action" | "cartao" | "position_in_stage">;
function lead(id: string, over: Partial<L> = {}): L {
  return { id, status: "open", value_cents: null, score: null, next_action: null, position_in_stage: 1, cartao: sinais(), ...over };
}
const bolaNossa = (desde: string) => ({ com: "nos" as const, quem: "lead" as const, desde, porUsuarioId: null });
const compromisso = (inicio: Date) => ({
  id: "a",
  titulo: "x",
  tipo: null,
  localTipo: null,
  localDetalhe: null,
  inicio: inicio.toISOString(),
  fim: new Date(inicio.getTime() + 3_600_000).toISOString(),
  fuso: "America/Sao_Paulo",
  situacao: "confirmed",
  leadIds: [],
});

describe("urgência", () => {
  const ctx = { esfriando: false, agora };

  it("os degraus, na ordem da legenda", () => {
    expect(grauDeUrgencia(lead("a", { cartao: sinais({ bola: bolaNossa("2026-09-30T10:00:00Z") }) }), ctx)).toBe(0);
    expect(grauDeUrgencia(lead("a", { cartao: sinais({ tarefasAtrasadas: 1 }) }), ctx)).toBe(1);
    expect(grauDeUrgencia(lead("a", { cartao: sinais({ compromisso: compromisso(new Date(2026, 8, 30, 16)) }) }), ctx)).toBe(2);
    expect(grauDeUrgencia(lead("a", { next_action: { label: "x", seq: 1, proposed_at: "" } }), ctx)).toBe(3);
    expect(grauDeUrgencia(lead("a"), { esfriando: true, agora })).toBe(4);
    expect(grauDeUrgencia(lead("a"), ctx)).toBe(5);
    expect(grauDeUrgencia(lead("a", { cartao: sinais({ temTarefaFutura: true }) }), ctx)).toBe(6);
    expect(grauDeUrgencia(lead("a", { status: "won" }), ctx)).toBe(9);
  });

  it("dentro do 'esperando resposta', quem espera há mais tempo sobe; empate total mantém a posição", () => {
    const antigo = lead("antigo", { cartao: sinais({ bola: bolaNossa("2026-09-30T08:00:00Z") }), position_in_stage: 5 });
    const recente = lead("recente", { cartao: sinais({ bola: bolaNossa("2026-09-30T11:00:00Z") }), position_in_stage: 1 });
    const parado = lead("parado", { position_in_stage: 0 });
    expect(ordenarColuna([parado, recente, antigo], "urgencia", { esfriando: new Set(), agora }).map((l) => l.id)).toEqual([
      "antigo",
      "recente",
      "parado",
    ]);
  });

  it("quentes primeiro, valor e manual", () => {
    const a = lead("a", { score: { probability: 30, reason: "", band: "frio", factors: [], at: null }, value_cents: 900, position_in_stage: 2 });
    const b = lead("b", { score: { probability: 80, reason: "", band: "quente", factors: [], at: null }, value_cents: 100, position_in_stage: 3 });
    const c = lead("c", { position_in_stage: 1 });
    const ctxo = { esfriando: new Set<string>(), agora };
    expect(ordenarColuna([a, b, c], "quentes", ctxo).map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(ordenarColuna([a, b, c], "valor", ctxo).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(ordenarColuna([a, b, c], "manual", ctxo).map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
});

describe("filtros do cartão", () => {
  it("lê e escreve só os nossos parâmetros; valor inválido vira sem filtro; ordem padrão fora da URL", () => {
    const f = lerFiltrosDoCartao(new URLSearchParams("canal=META&faixa=quente&ordem=valor"));
    expect(f).toEqual({ canal: "META", faixa: "quente", ordem: "valor" });
    expect(lerFiltrosDoCartao(new URLSearchParams("canal=XYZ&ordem=zzz"))).toEqual({ canal: null, faixa: null, ordem: "urgencia" });
    expect(escreverFiltrosDoCartao("owner=u1", { canal: "FORM", faixa: null, ordem: "urgencia" })).toBe("owner=u1&canal=FORM");
  });

  it("mudar um filtro do upstream NÃO apaga o canal (o defeito que a função existe para impedir)", () => {
    const atual = new URLSearchParams("canal=GOOGLE&ordem=quentes&owner=velho");
    expect(preservarParametrosDoCartao("owner=novo", atual)).toBe("owner=novo&canal=GOOGLE&ordem=quentes");
  });

  it("filtra por canal e por faixa (sem score = 'sem')", () => {
    const quente = { score: { probability: 80, reason: "", band: "quente" as const, factors: [], at: null }, cartao: sinais({ canal: { sigla: "META", campanha: null } }) };
    const semScore = { score: null, cartao: sinais({ canal: { sigla: "SITE", campanha: null } }) };
    expect(aplicarFiltrosDoCartao([quente, semScore], { canal: "META", faixa: null, ordem: "urgencia" })).toEqual([quente]);
    expect(aplicarFiltrosDoCartao([quente, semScore], { canal: null, faixa: "sem", ordem: "urgencia" })).toEqual([semScore]);
  });
});

describe("histórico de compras", () => {
  const compra = (id: string, data: string, valor: number, over: Partial<Compra> = {}): Compra => ({
    id,
    data,
    item: "Studio",
    valorCents: valor,
    moeda: "BRL",
    origem: "negocio_ganho",
    referencia: id,
    contatoId: "c1",
    contatoNome: "Renato",
    empresaId: null,
    negocioId: id,
    pagamento: null,
    finalidade: null,
    ...over,
  });

  it("uma compra: 'Já é cliente', sem intervalo e sem estimativa inventada", () => {
    const r = resumirCompras([compra("a", "2025-06-10T12:00:00Z", 28_900_000)], agora)!;
    expect(r.selo).toBe("cliente");
    expect(r.intervaloMedioDias).toBeNull();
    expect(r.proximaProvavel).toBeNull();
    expect(r.ticketMedioCents).toBe(28_900_000);
  });

  it("duas ou mais: recorrente, ticket médio, intervalo médio e próxima provável (estimativa)", () => {
    const r = resumirCompras(
      [compra("b", "2026-02-18T12:00:00Z", 29_800_000), compra("a", "2025-06-10T12:00:00Z", 28_900_000)],
      agora,
    )!;
    expect(r.selo).toBe("recorrente");
    expect(r.quantidade).toBe(2);
    expect(r.totalCents).toBe(58_700_000);
    expect(r.ticketMedioCents).toBe(29_350_000);
    expect(r.intervaloMedioDias).toBe(253);
    expect(r.compras[0]?.id).toBe("b");
    expect(r.proximaProvavel?.jaPassou).toBe(false);
    expect(r.proximaProvavel?.data.slice(0, 10)).toBe("2026-10-29");
  });

  it("moeda: soma só a principal e avisa que há outra", () => {
    const r = resumirCompras(
      [compra("a", "2026-01-01T00:00:00Z", 100), compra("b", "2026-02-01T00:00:00Z", 200), compra("c", "2026-03-01T00:00:00Z", 999, { moeda: "USD" })],
      agora,
    )!;
    expect(r.moeda).toBe("BRL");
    expect(r.totalCents).toBe(300);
    expect(r.outrasMoedas).toBe(true);
  });

  it("hábito DERIVADO: o item que se repete, o pagamento mais comum, a finalidade dos campos", () => {
    const r = resumirCompras(
      [
        compra("a", "2026-01-01T00:00:00Z", 1, { item: "Studio", pagamento: "À vista" }),
        compra("b", "2026-02-01T00:00:00Z", 1, { item: "studio", pagamento: "À vista", finalidade: "Renda de aluguel" }),
        compra("c", "2026-03-01T00:00:00Z", 1, { item: "Garagem", pagamento: "Boleto" }),
      ],
      agora,
    )!;
    expect(r.habito).toEqual({ oQue: "studio", pagamento: "À vista", finalidade: "Renda de aluguel", derivado: true });
  });

  it("campos do negócio que falam de pagamento e finalidade", () => {
    expect(habitoDosCampos({ forma_de_pagamento: "Financiamento", finalidade: "Morar", unidade: "X" })).toEqual({
      pagamento: "Financiamento",
      finalidade: "Morar",
    });
    expect(habitoDosCampos({ x: "a" }, [{ key: "x", label: "Forma de pagamento" }]).pagamento).toBe("a");
  });

  it("itens do pedido, de qualquer loja; sem itens, nada", () => {
    expect(itensDoPedido({ products: [{ name: "Camiseta" }, { name: "Boné" }] })).toBe("Camiseta, Boné");
    expect(itensDoPedido({ line_items: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }] })).toBe("A, B, C +1");
    expect(itensDoPedido({})).toBeNull();
  });

  it("sem compra nenhuma, nada", () => {
    expect(resumirCompras([], agora)).toBeNull();
  });
});

describe("dinheiro", () => {
  it("valor curto no selo", () => {
    expect(valorCurto(58_700_000, "BRL")).toBe("R$ 587 mil");
    expect(valorCurto(120_000_000, "BRL")).toBe("R$ 1,2 mi");
  });

  it("o pedido entra na régua do negócio (×100) em qualquer moeda", () => {
    expect(pedidoNaReguaDoNegocio(1990, "BRL")).toBe(1990);
    // Guarani não tem centavos: 125.000 na régua da moeda é 12.500.000 na do negócio.
    expect(pedidoNaReguaDoNegocio(125_000, "PYG")).toBe(12_500_000);
  });
});

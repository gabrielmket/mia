/**
 * FORK MIA — O CONSUMO DE IA DA PLATAFORMA NÃO PARA NA MILÉSIMA CHAMADA.
 *
 * O saldo do provedor é `leitura + recargas − consumo`, e o consumo era a soma
 * de `llm_calls` lida com `.limit(100_000)`. O PostgREST corta em 1000 linhas:
 * com 2.500 chamadas no período a soma via 1000, o saldo aparecia maior que o
 * real e o aviso de crédito acabando não disparava.
 *
 *     npx vitest run --project produto lib/ai/custo/consumo-de-ia.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { lerConsumoDeIa, PAGINAS_MAXIMAS_DO_CONSUMO } from "@/lib/ai/custo/consumo-de-ia";
import { saldoDaPlataforma } from "@/lib/ai/custo/saldo-da-plataforma";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const DIA = 86_400_000;
const diasAtras = (agora: number, dias: number) => new Date(agora - dias * DIA).toISOString();

/**
 * `n` chamadas de US$ 0,02, espalhadas por igual DENTRO do intervalo aberto
 * entre `de` e `ate` dias atrás (nenhuma cai em cima da fronteira).
 */
function chamadas(n: number, de: number, ate: number, agora: number): Linha[] {
  const inicio = agora - de * DIA;
  const passo = ((de - ate) * DIA) / (n + 1);
  return Array.from({ length: n }, (_, i) => ({
    id: `chamada-${de}-${ate}-${String(i).padStart(6, "0")}`,
    cost_cents: 2,
    created_at: new Date(inicio + (i + 1) * passo).toISOString(),
  }));
}

describe("o consumo de IA da plataforma", () => {
  it("2.500 chamadas nos últimos 30 dias, 1.000 delas depois da leitura: as duas somas fecham", async () => {
    const agora = Date.now();
    const banco = postgrestComTeto({
      llm_calls: [
        // Fora das duas janelas: não pode entrar em soma nenhuma.
        ...chamadas(400, 40, 31, agora),
        ...chamadas(1_500, 29, 11, agora),
        ...chamadas(1_000, 9, 0, agora),
      ],
    });

    const consumo = await lerConsumoDeIa(banco.cliente as never, {
      desdeLeitura: diasAtras(agora, 10),
      desdeJanela: diasAtras(agora, 30),
    });

    expect(consumo.parcial).toBe(false);
    expect(consumo.consumoDesdeLeituraUsd).toBeCloseTo(20, 6); // 1.000 × US$ 0,02
    expect(consumo.consumoDaJanelaUsd).toBeCloseTo(50, 6); // 2.500 × US$ 0,02
    // 1000 + 1000 + 500, numa leitura só para as duas somas.
    expect(banco.pedidosEm("llm_calls")).toBe(3);
  });

  it("leitura mais antiga que a janela: lê desde a leitura, e a média continua só dos 30 dias", async () => {
    const agora = Date.now();
    const banco = postgrestComTeto({
      llm_calls: [...chamadas(1_300, 59, 31, agora), ...chamadas(1_200, 29, 0, agora)],
    });

    const consumo = await lerConsumoDeIa(banco.cliente as never, {
      desdeLeitura: diasAtras(agora, 60),
      desdeJanela: diasAtras(agora, 30),
    });

    expect(consumo.parcial).toBe(false);
    expect(consumo.consumoDesdeLeituraUsd).toBeCloseTo(50, 6); // as 2.500
    expect(consumo.consumoDaJanelaUsd).toBeCloseTo(24, 6); // só as 1.200 dos 30 dias
  });

  it("controle negativo: a leitura antiga (.limit(100_000)) somava 1000 chamadas de 2.500", async () => {
    const agora = Date.now();
    const banco = postgrestComTeto({ llm_calls: chamadas(2_500, 20, 0, agora) });

    const antiga = await banco.cliente
      .from("llm_calls")
      .select("cost_cents")
      .gte("created_at", diasAtras(agora, 30))
      .limit(100_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const consumoAntigoUsd = (antiga.data ?? []).reduce((s, g) => s + Number(g.cost_cents ?? 0), 0) / 100;
    expect(consumoAntigoUsd).toBeCloseTo(20, 6); // US$ 20,00 no lugar de US$ 50,00

    const certo = await lerConsumoDeIa(banco.cliente as never, {
      desdeLeitura: null,
      desdeJanela: diasAtras(agora, 30),
    });
    expect(certo.consumoDaJanelaUsd).toBeCloseTo(50, 6);
    // Sem leitura registrada não há intervalo: zero, e não o total.
    expect(certo.consumoDesdeLeituraUsd).toBe(0);
  });

  it("acima do teto de páginas: parcial", async () => {
    const agora = Date.now();
    // Página de 10 no dublê para não fabricar 100 mil linhas.
    const banco = postgrestComTeto({ llm_calls: chamadas(1_500, 20, 0, agora) }, { maxRows: 10 });

    const consumo = await lerConsumoDeIa(banco.cliente as never, {
      desdeLeitura: null,
      desdeJanela: diasAtras(agora, 30),
    });

    expect(consumo.parcial).toBe(true);
    expect(banco.pedidosEm("llm_calls")).toBe(PAGINAS_MAXIMAS_DO_CONSUMO);
    expect(consumo.consumoDaJanelaUsd).toBeCloseTo(PAGINAS_MAXIMAS_DO_CONSUMO * 10 * 0.02, 6);
  });

  it("falha de leitura: parcial, para o saldo não sair como se o consumo fosse zero", async () => {
    const agora = Date.now();
    const banco = postgrestComTeto(
      { llm_calls: chamadas(2_500, 20, 0, agora) },
      { falhaEm: (_n, tabela) => (tabela === "llm_calls" ? "statement timeout" : null) },
    );

    const consumo = await lerConsumoDeIa(banco.cliente as never, {
      desdeLeitura: null,
      desdeJanela: diasAtras(agora, 30),
    });

    expect(consumo).toEqual({ consumoDesdeLeituraUsd: 0, consumoDaJanelaUsd: 0, parcial: true });
  });
});

describe("o saldo da plataforma", () => {
  it("leitura de US$ 100,00 e 2.500 chamadas de US$ 0,02 depois dela: sobra US$ 50,00, e não US$ 80,00", async () => {
    const agora = Date.now();
    const banco = postgrestComTeto({
      platform_ai_ledger: [{ tipo: "leitura", amount_usd: 100, occurred_at: diasAtras(agora, 20) }],
      llm_calls: chamadas(2_500, 19, 0, agora),
    });

    const saldo = await saldoDaPlataforma(banco.cliente as never);

    expect(saldo.consumoParcial).toBe(false);
    expect(saldo.saldoUsd).toBeCloseTo(50, 6);
    // US$ 50,00 gastos em 30 dias de média: os US$ 50,00 que sobram duram 30 dias.
    expect(saldo.diasRestantes).toBeCloseTo(30, 3);
  });
});

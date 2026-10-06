/**
 * FORK MIA — O VIGIA DO CRÉDITO DE IA NÃO CALA POR CAUSA DE LEITURA PARCIAL.
 *
 * O saldo é `leitura + recargas − consumo`. Quando a soma do consumo vem
 * parcial (volume acima do teto de leitura, ou falha), o saldo calculado é um
 * TETO: o de verdade é menor. Um vigia que só pergunta "o calculado está acima
 * do limite?" diria que está tudo bem justamente quando não sabe.
 *
 * E o vigia roda de minuto em minuto: ele não pode reler o consumo inteiro a
 * cada rodada.
 *
 *     npx vitest run --project produto lib/ai/custo/aviso-do-credito.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { avisoDoCreditoDeIa } from "@/lib/ai/custo/aviso-do-credito";
import {
  esquecerSaldoDoVigia,
  saldoDaPlataformaParaOVigia,
  VALIDADE_DO_SALDO_DO_VIGIA_MS,
} from "@/lib/ai/custo/saldo-da-plataforma";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const LIMITE = 20;
const saldo = (over: Partial<Parameters<typeof avisoDoCreditoDeIa>[0]> = {}) => ({
  saldoUsd: 100 as number | null,
  diasRestantes: 30 as number | null,
  consumoParcial: false,
  ritmoParcial: false,
  ...over,
});

describe("o que o vigia diz sobre o crédito", () => {
  it("saldo acima do limite e conta inteira: nada a dizer", () => {
    expect(avisoDoCreditoDeIa(saldo(), LIMITE)).toBeNull();
  });

  it("saldo no limite ou abaixo: 'acabando', com a chave de sempre", () => {
    const aviso = avisoDoCreditoDeIa(saldo({ saldoUsd: 12.5, diasRestantes: 3.7 }), LIMITE);

    expect(aviso?.chave).toBe("saldo_baixo");
    expect(aviso?.texto).toContain("Crédito de IA acabando");
    expect(aviso?.texto).toContain("Dura mais ou menos:* 3 dia(s)");
    expect(aviso?.texto).not.toContain("incompleta");
    expect(aviso?.detalhe).toEqual({ saldo_usd: 12.5, consumo_parcial: false });
  });

  it("saldo ACIMA do limite, mas com consumo parcial: não cala, e diz o que fazer", () => {
    const aviso = avisoDoCreditoDeIa(saldo({ saldoUsd: 80, consumoParcial: true }), LIMITE);

    expect(aviso?.chave).toBe("saldo_nao_conferido");
    expect(aviso?.texto).toContain("Não deu para conferir o crédito de IA");
    expect(aviso?.texto).toContain("TETO");
    expect(aviso?.texto).toContain("registre uma leitura");
  });

  it("saldo abaixo do limite COM consumo parcial: 'acabando', e avisa que o real é menor ainda", () => {
    const aviso = avisoDoCreditoDeIa(saldo({ saldoUsd: 15, consumoParcial: true }), LIMITE);

    expect(aviso?.chave).toBe("saldo_baixo");
    expect(aviso?.texto).toContain("O saldo de verdade é MENOR que este");
    expect(aviso?.texto).toContain("conta otimista");
  });

  it("só o ritmo parcial, com o saldo acima do limite: nada (o saldo está certo)", () => {
    expect(avisoDoCreditoDeIa(saldo({ ritmoParcial: true }), LIMITE)).toBeNull();
  });

  it("sem leitura registrada: nada, mesmo com consumo parcial (não é 'acabou', é quem não usa o livro-caixa)", () => {
    expect(avisoDoCreditoDeIa(saldo({ saldoUsd: null, diasRestantes: null, consumoParcial: true }), LIMITE)).toBeNull();
  });

  it("controle negativo: a pergunta antiga (só `saldo <= limite`) calava com US$ 80,00 de teto", () => {
    const parcial = saldo({ saldoUsd: 80, consumoParcial: true });
    const perguntaAntiga = parcial.saldoUsd !== null && parcial.saldoUsd <= LIMITE;

    expect(perguntaAntiga).toBe(false);
    expect(avisoDoCreditoDeIa(parcial, LIMITE)).not.toBeNull();
  });
});

describe("o saldo do vigia tem memória curta", () => {
  const DIA = 86_400_000;

  function banco() {
    const agora = Date.now();
    const chamadas: Linha[] = Array.from({ length: 2_500 }, (_, i) => ({
      id: `chamada-${String(i).padStart(6, "0")}`,
      cost_cents: 2,
      created_at: new Date(agora - 5 * DIA + i * 60_000).toISOString(),
    }));
    return postgrestComTeto({
      platform_ai_ledger: [
        { tipo: "leitura", amount_usd: 100, occurred_at: new Date(agora - 6 * DIA).toISOString() },
      ],
      llm_calls: chamadas,
    });
  }

  beforeEach(() => {
    esquecerSaldoDoVigia();
  });

  it("quinze rodadas de um minuto: UMA leitura do consumo, e não quinze", async () => {
    const db = banco();
    const inicio = Date.now();

    const saldos = [];
    for (let minuto = 0; minuto < 15; minuto++) {
      saldos.push(await saldoDaPlataformaParaOVigia(db.cliente as never, inicio + minuto * 60_000));
    }

    expect(saldos[0]!.saldoUsd).toBeCloseTo(50, 6);
    expect(saldos.every((s) => s === saldos[0])).toBe(true);
    // 1000 + 1000 + 500: as três páginas de UMA leitura.
    expect(db.pedidosEm("llm_calls")).toBe(3);
  });

  it("passada a validade, relê", async () => {
    const db = banco();
    const inicio = Date.now();

    await saldoDaPlataformaParaOVigia(db.cliente as never, inicio);
    await saldoDaPlataformaParaOVigia(db.cliente as never, inicio + VALIDADE_DO_SALDO_DO_VIGIA_MS + 1);

    expect(db.pedidosEm("llm_calls")).toBe(6);
  });
});

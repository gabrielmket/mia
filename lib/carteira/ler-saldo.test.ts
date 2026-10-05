/**
 * FORK MIA — O SALDO DA CARTEIRA NÃO PARA NA MILÉSIMA MENSAGEM.
 *
 * O extrato tem uma linha de débito por mensagem enviada. Com o PostgREST
 * cortando em 1000 linhas, a soma antiga via o crédito e os primeiros 999
 * débitos, e dizia que sobrava dinheiro que já tinha sido gasto: a tela
 * mostrava o saldo errado e a trava do disparo liberava lista sem cobertura.
 *
 *     npx vitest run --project produto lib/carteira/ler-saldo.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { lerSaldoDaCarteira, PAGINAS_MAXIMAS_DO_EXTRATO } from "@/lib/carteira/ler-saldo";
import { derivarSaldo, podeDisparar, type LancamentoDaCarteira } from "@/lib/carteira/saldo";
import { logger } from "@/lib/logger";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";

/**
 * R$ 1.000,00 de crédito e depois `mensagens` débitos de R$ 0,20, na ordem em
 * que aconteceram (o crédito é a linha mais ANTIGA, como numa carteira real).
 */
function extrato(mensagens: number, organizationId = ORG): Linha[] {
  const base = Date.parse("2026-09-01T12:00:00.000Z");
  return [
    {
      id: `${organizationId}-credito`,
      organization_id: organizationId,
      tipo: "credito",
      amount_cents: 100_000,
      occurred_at: new Date(base).toISOString(),
    },
    ...Array.from({ length: mensagens }, (_, i) => ({
      id: `${organizationId}-debito-${String(i).padStart(6, "0")}`,
      organization_id: organizationId,
      tipo: "debito",
      amount_cents: 20,
      occurred_at: new Date(base + (i + 1) * 1_000).toISOString(),
    })),
  ];
}

describe("o saldo da carteira", () => {
  it("3.000 mensagens cobradas: o saldo é R$ 400,00, e não o das primeiras 1000 linhas", async () => {
    const banco = postgrestComTeto({
      tenant_wallet_ledger: [...extrato(3_000), ...extrato(500, OUTRA_ORG)],
    });

    const saldo = await lerSaldoDaCarteira(banco.cliente as never, ORG);

    expect(saldo.erro).toBeNull();
    expect(saldo.truncado).toBe(false);
    expect(saldo).toMatchObject({
      saldo_cents: 40_000,
      creditado_cents: 100_000,
      debitado_cents: 60_000,
      lancamentos: 3_001,
    });
    // 1000 + 1000 + 1000 + 1.
    expect(banco.pedidosEm("tenant_wallet_ledger")).toBe(4);
  });

  it("controle negativo: a leitura antiga (.limit(100_000)) dizia R$ 800,20 e liberava o disparo", async () => {
    const banco = postgrestComTeto({ tenant_wallet_ledger: extrato(3_000) });

    const antiga = await banco.cliente
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", ORG)
      .limit(100_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const saldoAntigo = derivarSaldo((antiga.data ?? []) as unknown as LancamentoDaCarteira[]).saldo_cents;
    // O crédito e 999 débitos: R$ 1.000,00 − R$ 199,80.
    expect(saldoAntigo).toBe(80_020);

    // Uma lista de 3.000 contatos a R$ 0,20 custa R$ 600,00. O saldo de verdade
    // (R$ 400,00) não cobre; o saldo antigo dizia que cobria.
    const lista = { precoPorMensagemCents: 20, destinatarios: 3_000 };
    expect(podeDisparar({ saldoCents: saldoAntigo, ...lista }).pode).toBe(true);
    const certo = await lerSaldoDaCarteira(banco.cliente as never, ORG);
    expect(podeDisparar({ saldoCents: certo.saldo_cents, ...lista })).toMatchObject({
      pode: false,
      motivo: "saldo_insuficiente",
    });
  });

  it("extrato acima do teto de páginas: truncado, e fica registrado", async () => {
    // Página de 10 no dublê para não fabricar 100 mil linhas: 100 páginas de 10
    // cobrem 1.000 lançamentos, e o extrato tem 1.201.
    const banco = postgrestComTeto({ tenant_wallet_ledger: extrato(1_200) }, { maxRows: 10 });

    const saldo = await lerSaldoDaCarteira(banco.cliente as never, ORG);

    expect(saldo.truncado).toBe(true);
    expect(saldo.lancamentos).toBe(PAGINAS_MAXIMAS_DO_EXTRATO * 10);
    expect(banco.pedidosEm("tenant_wallet_ledger")).toBe(PAGINAS_MAXIMAS_DO_EXTRATO);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringContaining("acima do teto de leitura"),
      expect.objectContaining({ organization_id: ORG, no_banco: 1_201 }),
    );
  });

  it("falha de leitura: saldo zero COM o erro dito, para a trava recusar e a tela não mentir", async () => {
    const banco = postgrestComTeto(
      { tenant_wallet_ledger: extrato(3_000) },
      { falhaEm: (pedido) => (pedido === 2 ? "connection reset" : null) },
    );

    const saldo = await lerSaldoDaCarteira(banco.cliente as never, ORG);

    expect(saldo.erro).toBe("connection reset");
    expect(saldo.saldo_cents).toBe(0);
    expect(podeDisparar({ saldoCents: saldo.saldo_cents, precoPorMensagemCents: 20, destinatarios: 1 }).pode).toBe(
      false,
    );
  });

  it("carteira sem lançamento: saldo zero é um fato, sem erro e sem corte", async () => {
    const banco = postgrestComTeto({ tenant_wallet_ledger: [] });

    const saldo = await lerSaldoDaCarteira(banco.cliente as never, ORG);

    expect(saldo).toMatchObject({ saldo_cents: 0, lancamentos: 0, truncado: false, erro: null });
  });
});

/**
 * FORK MIA — O MOTOR LÊ O SALDO UMA VEZ POR RODADA, E PARA NO CENTAVO CERTO.
 *
 * O saldo passou a sair do extrato INTEIRO (`lib/carteira/ler-saldo.ts`), que
 * tem uma linha por mensagem cobrada. O motor o relia a cada mensagem: com uma
 * carteira de 3.000 lançamentos seriam 4 idas ao banco por mensagem, 200 por
 * rodada de 50; com 30 mil, 1.500, e a rodada passaria do minuto do cron.
 *
 * Aqui: uma leitura por rodada, o desconto local do que a própria rodada cobra,
 * e a parada exatamente quando o saldo de verdade acaba (contra um servidor que
 * corta em 1000 linhas, que é onde a soma antiga deixava passar).
 *
 *     npx vitest run --project produto lib/broadcast/motor-saldo-por-rodada.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { rodarCampanha, type CampanhaEmCurso } from "@/lib/broadcast/motor";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const CAMPANHA: CampanhaEmCurso = {
  id: "disparo-1",
  organization_id: ORG,
  template_name: "modelo_de_teste",
  template_language: "pt_BR",
  valores_padrao: {},
  preco_cents: 20,
};

/** R$ 1.000,00 de crédito e `mensagens` débitos antigos de R$ 0,20. */
function extrato(mensagens: number): Linha[] {
  const base = Date.parse("2026-09-01T12:00:00.000Z");
  return [
    { id: "credito", organization_id: ORG, tipo: "credito", amount_cents: 100_000, occurred_at: new Date(base).toISOString() },
    ...Array.from({ length: mensagens }, (_, i) => ({
      id: `debito-${String(i).padStart(6, "0")}`,
      organization_id: ORG,
      tipo: "debito",
      amount_cents: 20,
      occurred_at: new Date(base + (i + 1) * 1_000).toISOString(),
    })),
  ];
}

function naFila(quantos: number): Linha[] {
  return Array.from({ length: quantos }, (_, i) => ({
    id: `destinatario-${String(i).padStart(4, "0")}`,
    organization_id: ORG,
    broadcast_id: CAMPANHA.id,
    contact_id: null,
    phone_e164: `+55119${String(20_000_000 + i)}`,
    valores: {},
    status: "pendente",
  }));
}

const deps = () => ({ enviar: vi.fn(async () => "wamid.teste"), qualidade: async () => "GREEN" as const });

describe("o saldo dentro da rodada", () => {
  it("carteira de 3.001 lançamentos, 30 mensagens: UMA leitura do extrato (4 páginas), e não 30", async () => {
    const banco = postgrestComTeto({ tenant_wallet_ledger: extrato(3_000), broadcast_recipients: naFila(30) });

    const r = await rodarCampanha(banco.cliente as never, CAMPANHA, deps(), 50);

    expect(r).toMatchObject({ enviadas: 30, falhas: 0, cobradoCents: 600, parou: null, restam: 0 });
    // 1000 + 1000 + 1000 + 1: as quatro páginas de UMA leitura.
    expect(banco.pedidosEm("tenant_wallet_ledger")).toBe(4);
    // E cada mensagem virou um débito no extrato.
    expect(banco.tabelas.tenant_wallet_ledger).toHaveLength(3_001 + 30);
  });

  it("saldo de verdade para 5 mensagens (R$ 1,00), 10 na fila: manda 5 e para", async () => {
    // R$ 1.000,00 de crédito, 4.995 mensagens já cobradas: sobram R$ 1,00.
    const banco = postgrestComTeto({ tenant_wallet_ledger: extrato(4_995), broadcast_recipients: naFila(10) });

    const r = await rodarCampanha(banco.cliente as never, CAMPANHA, deps(), 50);

    expect(r).toMatchObject({ enviadas: 5, cobradoCents: 100, parou: "saldo_acabou", restam: 5 });
  });

  it("controle negativo: com a soma antiga (1000 linhas) o mesmo extrato dizia R$ 800,20 e mandaria as 10", async () => {
    const banco = postgrestComTeto({ tenant_wallet_ledger: extrato(4_995) });

    const antiga = await banco.cliente
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", ORG)
      .limit(100_000);

    const saldoAntigo = (antiga.data ?? []).reduce(
      (s, l) => s + (l.tipo === "debito" ? -Number(l.amount_cents) : Number(l.amount_cents)),
      0,
    );
    expect(saldoAntigo).toBe(80_020);
    // Dez mensagens de R$ 0,20 cabem com folga em R$ 800,20: nenhuma parada.
    expect(saldoAntigo).toBeGreaterThanOrEqual(10 * 20);
  });
});

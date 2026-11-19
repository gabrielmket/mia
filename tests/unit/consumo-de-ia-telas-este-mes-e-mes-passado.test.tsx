/**
 * FORK MIA (MIA-44) — "ESTE MÊS" E "MÊS PASSADO" NAS DUAS TELAS DE USO, E AS
 * QUEBRAS POR AGENTE NA ABA USO DO CLIENTE.
 *
 *  1. Os atalhos: "Este mês" e "Mês passado" são os meses de Brasília, pela
 *     mesma conta da rota e do MCP (`mesAtualEAnterior`), e 7/30/90 ficam.
 *  2. `/api/v1/admin/usage?mes=AAAA-MM`: a janela é o mês de Brasília (as 3h
 *     depois da meia-noite UTC do dia 1º ainda são do mês anterior), a série vai
 *     do dia 1 ao último dia do mês, e a fatura do mês passado não soma os dias
 *     deste. `mes` fora do formato é 400.
 *  3. A aba Uso: o botão do mês pede `mes`, o custo de IA sai também em R$, e as
 *     tabelas mostram cada agente, a linha "Sistema" e cada finalidade.
 *
 * Dados fictícios (Academia Alfa e agentes de mentira).
 *
 *     npx vitest run tests/unit/consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { ATALHOS_DE_PERIODO, pedidoDoAtalho } from "@/lib/ai/usage/atalhos-de-periodo";
import { postgrestComTeto } from "@/tests/helpers/postgrest-com-teto";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "admin-da-plataforma" } })),
  falhaDaEscritaDePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/useUsoDoTenant", () => ({ useUsoDoTenant: vi.fn() }));

import { useUsoDoTenant } from "@/hooks/useUsoDoTenant";
import { UsoDoTenant } from "@/components/admin/tenants/UsoDoTenant";

const ACADEMIA = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("os atalhos de período", () => {
  it("7, 30 e 90 dias continuam, e entram Este mês e Mês passado", () => {
    expect(ATALHOS_DE_PERIODO.map((a) => a.valor)).toEqual(["7d", "30d", "90d", "este_mes", "mes_passado"]);
    expect(pedidoDoAtalho("7d")).toEqual({ tipo: "dias", dias: 7 });
    expect(pedidoDoAtalho("90d")).toEqual({ tipo: "dias", dias: 90 });
  });

  it("o mês é o de Brasília: 1º de dezembro às 2h UTC ainda é novembro", () => {
    const agora = new Date("2026-12-01T02:00:00Z");
    expect(pedidoDoAtalho("este_mes", agora)).toEqual({ tipo: "mes", mes: "2026-11" });
    expect(pedidoDoAtalho("mes_passado", agora)).toEqual({ tipo: "mes", mes: "2026-10" });
  });

  it("em janeiro, o mês passado é dezembro do ano anterior", () => {
    expect(pedidoDoAtalho("mes_passado", new Date("2027-01-15T12:00:00Z"))).toEqual({
      tipo: "mes",
      mes: "2026-12",
    });
  });
});

describe("GET /api/v1/admin/usage com mes", () => {
  const pedir = async (busca: string) => {
    const { GET } = await import("@/app/api/v1/admin/usage/route");
    return GET(new NextRequest(`http://localhost/api/v1/admin/usage?${busca}`));
  };

  function banco() {
    const chamada = (id: string, created_at: string, cost_cents: number) => ({
      id,
      organization_id: ACADEMIA,
      created_at,
      input_tokens: 900,
      output_tokens: 100,
      cost_cents,
      purpose: "agent_turn",
      contact_id: null,
    });
    return postgrestComTeto({
      organizations: [{ id: ACADEMIA, display_name: "Academia Alfa", slug: "academia-alfa" }],
      llm_calls: [
        // 30/09 às 23h30 em Brasília: setembro, fora.
        chamada("c1", "2026-10-01T02:30:00Z", 999),
        // 01/10 às 0h30 em Brasília: outubro.
        chamada("c2", "2026-10-01T03:30:00Z", 100),
        // 31/10 às 20h30 e às 23h30 em Brasília: outubro, as duas no dia 31.
        chamada("c3", "2026-10-31T23:30:00Z", 50),
        chamada("c4", "2026-11-01T02:30:00Z", 50),
        // 01/11 às 0h30 em Brasília: novembro, fora.
        chamada("c5", "2026-11-01T03:30:00Z", 999),
      ],
      platform_fx_rates: [
        { dia: "2026-09-30", usd_brl: 5 },
        { dia: "2026-10-20", usd_brl: 6 },
        { dia: "2026-11-05", usd_brl: 7 },
      ],
      platform_openai_spend: [
        { dia: "2026-10-15", usd: 1.5 },
        { dia: "2026-11-02", usd: 9 },
      ],
    });
  }

  it("mes=2026-10: a janela, a série e a fatura são do mês de Brasília", async () => {
    const b = banco();
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);

    const res = await pedir(`mes=2026-10&tenant_id=${ACADEMIA}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        mes: string | null;
        tenants: Array<{ ai_invocations_count: number; ai_cost_cents: number }>;
        series: { ai_cost: Array<{ date: string; cents: number }> };
        fatura: { total_usd: number; dias: number } | null;
        reais: { total: number; dias_sem_cotacao: number };
      };
    };

    expect(data.mes).toBe("2026-10");
    expect(data.tenants[0]).toMatchObject({ ai_invocations_count: 3, ai_cost_cents: 200 });
    // A série é o mês inteiro, do dia 1 ao 31, e as 23h30 do dia 31 ficam no 31.
    expect(data.series.ai_cost).toHaveLength(31);
    expect(data.series.ai_cost[0]).toEqual({ date: "2026-10-01", cents: 100 });
    expect(data.series.ai_cost[30]).toEqual({ date: "2026-10-31", cents: 100 });
    // A fatura de novembro não entra no mês passado.
    expect(data.fatura).toMatchObject({ total_usd: 1.5, dias: 1 });
    // US$ 1,00 no dia 1º pela cotação de 30/09 (5) + US$ 1,00 no dia 31 pela de 20/10 (6).
    expect(data.reais).toMatchObject({ total: 11, dias_sem_cotacao: 0 });
  });

  it("sem mes, as janelas de dias seguem como eram, e mes vem null", async () => {
    const b = banco();
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);

    const res = await pedir(`range=7d&tenant_id=${ACADEMIA}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { mes: string | null; series: { ai_cost: unknown[] } } };
    expect(data.mes).toBeNull();
    expect(data.series.ai_cost).toHaveLength(7);
  });

  it("mes fora do formato: 400, e nada é lido", async () => {
    const b = banco();
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);

    const res = await pedir("mes=2026-13");
    expect(res.status).toBe(400);
    expect(b.pedidosEm("llm_calls")).toBe(0);
  });
});

describe("a aba Uso do cliente", () => {
  const linha = (custo_usd_cents: number, custo_brl: number, chamadas = 1) => ({
    chamadas,
    tokens_entrada: 1_000 * chamadas,
    tokens_saida: 100 * chamadas,
    tokens_do_cache: 400 * chamadas,
    custo_usd_cents,
    custo_brl,
    sem_preco: 0,
  });

  function dados() {
    return {
      dias: 31,
      mes: "2026-10",
      conversas: 4,
      mensagens: 40,
      ia: { chamadas: 6, tokens: 6_600, custo_usd_cents: 600, truncado: false },
      consumo: {
        total: linha(600, 33, 6),
        por_agente: [
          { agent_id: "agente-1", nome: "Agente Recepção", arquivado: false, ...linha(300, 16.5, 3) },
          { agent_id: "agente-2", nome: "Agente Matrículas", arquivado: false, ...linha(100, 5.5, 1) },
        ],
        sistema: linha(200, 11, 2),
        por_finalidade: [
          { finalidade: "agent_turn", ...linha(400, 22, 4) },
          { finalidade: "checkpoint", ...linha(200, 11, 2) },
        ],
        reais: { dias_sem_cotacao: [], ultima_cotacao: { dia: "2026-10-20", usd_brl: 5.5 } },
        truncado: false,
        chamadas_no_banco: 6,
      },
      mensagens_cobradas: { truncado: false, total: 0, totalCentavos: 0, semPreco: [], linhas: [] },
    };
  }

  it("o botão do mês pede mes, e as tabelas mostram cada agente, o Sistema e as finalidades em US$ e R$", () => {
    vi.mocked(useUsoDoTenant).mockReturnValue({ data: dados(), isLoading: false, error: null } as never);
    render(<UsoDoTenant organizationId={ACADEMIA} />);

    // 30 dias é o padrão; os meses entram ao lado.
    expect(vi.mocked(useUsoDoTenant)).toHaveBeenLastCalledWith(ACADEMIA, { tipo: "dias", dias: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    const ultimo = vi.mocked(useUsoDoTenant).mock.calls.at(-1)!;
    expect(ultimo[1]).toMatchObject({ tipo: "mes" });
    expect((ultimo[1] as { mes: string }).mes).toMatch(/^\d{4}-\d{2}$/);
    expect(screen.getByRole("button", { name: "Este mês" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 dias" })).toBeInTheDocument();

    // O card do custo de IA traz o real ao lado do dólar.
    expect(screen.getAllByText(/R\$\s?33,00/).length).toBeGreaterThan(0);

    const recepcao = screen.getByRole("row", { name: /Agente Recepção/ });
    expect(within(recepcao).getByText("US$ 3,00")).toBeInTheDocument();
    expect(within(recepcao).getByText(/R\$\s?16,50/)).toBeInTheDocument();
    // Tokens = entrada + saída; o cache é parte da entrada.
    expect(within(recepcao).getByText("3.300")).toBeInTheDocument();
    expect(within(recepcao).getByText("1.200")).toBeInTheDocument();

    const sistema = screen.getByRole("row", { name: /^Sistema/ });
    expect(within(sistema).getByText("US$ 2,00")).toBeInTheDocument();
    expect(within(sistema).getByText(/R\$\s?11,00/)).toBeInTheDocument();

    expect(screen.getByRole("row", { name: /Agente Matrículas/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /checkpoint/ })).toBeInTheDocument();
  });

  it("dia sem cotação: o real é dito parcial", () => {
    const d = dados();
    d.consumo.reais.dias_sem_cotacao = ["2026-10-02", "2026-10-03"] as never;
    vi.mocked(useUsoDoTenant).mockReturnValue({ data: d, isLoading: false, error: null } as never);
    render(<UsoDoTenant organizationId={ACADEMIA} />);
    expect(screen.getByText(/O valor em R\$ é parcial: dias sem cotação/)).toHaveTextContent(": 2");
  });
});

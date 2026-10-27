/**
 * FORK MIA (.95) · O HUB DE QUEM AINDA NÃO PAGOU A ENTRADA (teste do Gabriel em
 * produção, 27/10/2026; lib/planos-mia/entrada-paga.ts).
 *
 * A empresa recém-criada num plano de entrada paga nasce suspensa até o primeiro
 * pagamento. O hub `/account-suspended` do upstream dizia "Conta suspensa" e
 * "por falta de pagamento". Prova-se aqui: na entrada paga, o topo diz "Falta só
 * o primeiro pagamento" e a LGPD só aparece com pedido; no atraso, tudo como o
 * upstream escreveu (os casos dele seguem em app/account-suspended/page.test.tsx).
 *
 * Nenhum dado daqui é de cliente real.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Hub from "@/lib/cobranca/hub";

const cena = vi.hoisted(() => ({
  B: "00000000-0000-4000-8000-0000000000b5",
  papel: "admin" as "admin" | "agent",
  entradaPendente: true,
  temPedido: false,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    email: "dona@empresa.test",
    is_platform_admin: false,
    support: null,
    idioma: "pt-BR",
    organizations: [{ organization_id: cena.B, organization_name: "Empresa B", role: cena.papel }],
  }),
  orgAtivaSemPortao: async () => ({ orgId: cena.B, name: "Empresa B", role: cena.papel, org_status: "suspended" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: async (_coluna: string, ids: string[]) => ({
          data: ids.map((id) => ({ id, status: "suspended", suspended_kind: "cobranca" })),
          error: null,
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/cobranca/hub", async (original) => ({
  ...(await original<typeof Hub>()),
  lerPainelDoHub: async () => ({
    assinatura: {
      estado: "trial",
      provedor: null,
      assinaturas_vivas: 0,
      link_de_pagamento: null,
      cancela_no_fim: false,
      periodo_pago_desde: null,
      proximo_vencimento: null,
      troca_pagamento_url: null,
      troca_status: null,
      pagamento_inicial_pendente: cena.entradaPendente,
    },
    plano: null,
    checkout: { provedor: "asaas", documentoDoCadastro: null },
    fuso: "America/Sao_Paulo",
  }),
}));
vi.mock("@/lib/planos-mia/entrada-paga", () => ({
  esperaOPrimeiroPagamento: async () => cena.entradaPendente,
  temPedidoDeLgpd: async () => cena.temPedido,
}));
vi.mock("@/lib/branding/saida", () => ({ emailDeSuporte: async () => "suporte@revenda.test" }));
vi.mock("@/app/actions/auth/signOut", () => ({ signOut: vi.fn() }));
vi.mock("@/components/cobranca/PainelDaAssinatura", () => ({
  PainelDaAssinatura: () => <p data-testid="painel">Aguardando o primeiro pagamento.</p>,
}));
vi.mock("@/components/cobranca/AcoesDaAssinatura", () => ({
  AcoesDaAssinatura: () => <button type="button">Pagar agora</button>,
}));
vi.mock("@/app/app/lgpd/requests/RequestsTable", () => ({
  RequestsTable: () => <p data-testid="lgpd-lista">lista</p>,
}));
vi.mock("@/app/app/lgpd/requests/[id]/_client", () => ({
  LgpdRequestDetail: ({ id }: { id: string }) => <p data-testid="lgpd-pedido">{id}</p>,
}));
vi.mock("@/app/onboarding/_components/OutrasOrganizacoes", () => ({
  OutrasOrganizacoes: () => null,
}));

import AccountSuspendedPage from "@/app/account-suspended/page";

async function montar(pedido?: string) {
  return render(await AccountSuspendedPage({ searchParams: Promise.resolve(pedido ? { pedido } : {}) }));
}

afterEach(cleanup);
beforeEach(() => {
  cena.papel = "admin";
  cena.entradaPendente = true;
  cena.temPedido = false;
});

describe("/account-suspended na entrada paga ainda não paga", () => {
  it("⭐ o topo diz 'Falta só o primeiro pagamento', sem 'suspensa' nem 'falta de pagamento'", async () => {
    await montar();
    expect(screen.getByRole("heading", { level: 1, name: "Falta só o primeiro pagamento" })).toBeVisible();
    expect(screen.getByText("Assim que o pagamento for confirmado, a sua conta é liberada na hora.")).toBeVisible();
    expect(screen.queryByText(/Conta suspensa|falta de pagamento/)).toBeNull();
    // O botão de pagar e o cartão do plano continuam lá.
    expect(screen.getByRole("button", { name: "Pagar agora" })).toBeVisible();
    expect(screen.getByTestId("painel")).toHaveTextContent("Aguardando o primeiro pagamento.");
  });

  it("⭐ empresa nova sem pedido de LGPD: o bloco não aparece", async () => {
    await montar();
    expect(screen.queryByRole("heading", { name: "Solicitações LGPD" })).toBeNull();
    expect(screen.queryByTestId("lgpd-lista")).toBeNull();
  });

  it("com pedido de LGPD (ou o link de um), o bloco aparece", async () => {
    cena.temPedido = true;
    await montar();
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
    cleanup();
    cena.temPedido = false;
    const id = "22222222-2222-4222-8222-222222222222";
    await montar(id);
    expect(screen.getByTestId("lgpd-pedido")).toHaveTextContent(id);
  });

  it("quem não administra também lê que falta o primeiro pagamento, e é mandado ao administrador", async () => {
    cena.papel = "agent";
    await montar();
    expect(screen.getByRole("heading", { level: 1, name: "Falta só o primeiro pagamento" })).toBeVisible();
    expect(
      screen.getByText("A conta é liberada assim que o primeiro pagamento for confirmado. Avise o administrador da sua empresa."),
    ).toBeVisible();
  });
});

describe("/account-suspended no atraso de quem já pagou", () => {
  it("⭐ o texto de sempre e a LGPD de sempre (o prazo corre durante a suspensão)", async () => {
    cena.entradaPendente = false;
    await montar();
    expect(screen.getByRole("heading", { level: 1, name: "Conta suspensa" })).toBeVisible();
    expect(
      screen.getByText(
        "A conta foi suspensa por falta de pagamento. Assim que o pagamento for confirmado, tudo volta a funcionar na hora.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("lgpd-lista")).toBeVisible();
  });
});

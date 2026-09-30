import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, resolveActiveOrgMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  resolveActiveOrgMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuth: requireAuthMock,
  resolveActiveOrg: resolveActiveOrgMock,
}));

vi.mock("@/lib/instalacao/modulos", () => ({ modulosLigados: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
// Fork MIA: o hub também lê o que a organização contratou e o modo de venda
// com o client da sessão, que fora de uma requisição não tem cookie.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/modulos/liberacao", () => ({
  modulosDaOrganizacao: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("@/lib/empresas/modo-de-venda", () => ({
  modoDeVendaDaOrganizacao: vi.fn().mockResolvedValue("b2b"),
}));

vi.mock("@/components/shell/NavHub", () => ({
  NavHub: ({ locale }: { locale?: string }) => <div data-testid="ai-hub" data-locale={locale} />,
}));

import AiHubPage from "./page";

afterEach(cleanup);

describe("AiHubPage", () => {
  it("entrega ao hub o idioma resolvido para a pessoa e a organização", async () => {
    requireAuthMock.mockResolvedValue({
      idioma: "es",
      is_platform_admin: false,
      support: false,
    });
    resolveActiveOrgMock.mockResolvedValue({ role: "admin", interface_settings: undefined });

    render(await AiHubPage());

    expect(screen.getByTestId("ai-hub")).toHaveAttribute("data-locale", "es");
  });
});

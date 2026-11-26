/**
 * FORK MIA (MIA-262) — a tela Provedores de IA é da plataforma.
 *
 * Escolher qual IA atende cada parte do sistema (provedor, modelo, chave, Jev,
 * embedding, voz e mapas) é decisão de quem opera a plataforma. A página desvia
 * para /403 quem não escolhe a IA (`escolheIa`): o dono, o admin e o gerente da
 * empresa, e a agência em suporte. Entram o admin da plataforma e a plataforma
 * em suporte com edição, que é a única porta dela para a IA de uma empresa.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireAuthMock, resolveActiveOrgMock, redirectMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  resolveActiveOrgMock: vi.fn(),
  redirectMock: vi.fn((destino: string) => {
    throw new Error(`redirect:${destino}`);
  }),
}));

vi.mock("@/lib/auth/server", () => ({ requireAuth: requireAuthMock, resolveActiveOrg: resolveActiveOrgMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./_components/PainelDeProvedores", () => ({ PainelDeProvedores: () => null }));

import ProvedoresPage from "./page";

const SESSAO = { status: "active", organization_id: "org-1", agency_id: null };
const empresa = { is_platform_admin: false, platform_admin_scope: null, support: null };

beforeEach(() => {
  vi.clearAllMocks();
  resolveActiveOrgMock.mockResolvedValue({ orgId: "org-1", role: "admin" });
});

describe("quem abre Provedores de IA", () => {
  it.each([
    ["o dono / admin da empresa", empresa, "admin"],
    ["o gerente da empresa", empresa, "manager"],
    ["a agência em suporte com edição", { ...empresa, support: { ...SESSAO, access_mode: "full", agency_id: "agencia-1" } }, "admin"],
    ["a plataforma em suporte só leitura", { is_platform_admin: true, platform_admin_scope: "full", support: { ...SESSAO, access_mode: "support_readonly" } }, "admin"],
  ])("%s vai para /403", async (_nome, user, role) => {
    requireAuthMock.mockResolvedValue(user);
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org-1", role });
    await expect(ProvedoresPage()).rejects.toThrow("redirect:/403");
  });

  it.each([
    ["o admin da plataforma", { is_platform_admin: true, platform_admin_scope: "full", support: null }],
    ["a plataforma em suporte com edição", { is_platform_admin: true, platform_admin_scope: "full", support: { ...SESSAO, access_mode: "full" } }],
  ])("%s entra", async (_nome, user) => {
    requireAuthMock.mockResolvedValue(user);
    await expect(ProvedoresPage()).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

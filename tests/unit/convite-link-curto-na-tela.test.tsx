/**
 * FORK MIA (9023) — "COPIAR LINK DO CONVITE" NA TELA DE EQUIPE.
 *
 * A regra mora em `lib/team/link-curto.ts` e é provada em
 * `tests/unit/convite-link-curto.test.ts` (código novo, o anterior morre,
 * auditoria, permissão). Aqui se prova a TELA:
 *
 *  1. Copiar pede um link NOVO ao servidor (a rota do link curto), copia o que
 *     voltou e avisa que o anterior, inclusive o do e-mail, deixou de valer.
 *  2. Navegador que não deixa copiar depois da ida ao servidor (Safari): o
 *     link aparece num diálogo, com o aviso, em vez de sumir.
 *  3. Na lista de convites, quem administra copia o link curto; quem só
 *     gerencia continua copiando o link longo, sem pedir nada ao servidor
 *     (gerar link é poder de quem reenvia e revoga).
 *  4. O resultado da tela Convidar membros mostra o link do e-mail com o botão
 *     de copiar, sem gerar outro.
 *
 * Sem dado de ninguém: e-mails `@exemplo.invalid`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  copiar: vi.fn(async (_texto: string) => true),
  sucesso: vi.fn(),
  erro: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...a: unknown[]) => h.post(...a), get: (...a: unknown[]) => h.get(...a) },
}));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => h.sucesso(...a), error: (...a: unknown[]) => h.erro(...a) } }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (texto: string) => h.copiar(texto) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

import { useCopiarLinkDoConvite } from "@/app/app/team/_components/LinkCurtoDoConvite";
import { TeamInvitesClient } from "@/app/app/team/_components/TeamInvitesClient";
import { LinkCurtoDoEnvio } from "@/app/app/team/invite/_components/LinkCurtoDoEnvio";

const CONVITE = "90239023-5555-4000-8000-000000000001";
const LINK_NOVO = "https://app.exemplo.invalid/c/abcd2345efgh";
const LINK_LONGO = "https://app.exemplo.invalid/team/accept-invite/corpo.assinatura";

function comConsulta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  h.post.mockReset();
  h.get.mockReset();
  h.copiar.mockReset();
  h.copiar.mockResolvedValue(true);
  h.sucesso.mockReset();
  h.erro.mockReset();
  h.post.mockResolvedValue({ data: { id: CONVITE, link_curto: LINK_NOVO, expires_at: "2099-01-01T00:00:00.000Z" } });
});

describe("copiar o link do convite", () => {
  it("⭐ pede um link NOVO ao servidor, copia o que voltou e avisa que o anterior deixou de valer", async () => {
    const { result } = renderHook(() => useCopiarLinkDoConvite(), { wrapper: comConsulta() });
    await act(() => result.current.copiar(CONVITE));

    expect(h.post).toHaveBeenCalledWith(`/api/v1/team/invites/${CONVITE}/link-curto`, {});
    expect(h.copiar).toHaveBeenCalledWith(LINK_NOVO);
    expect(String(h.sucesso.mock.calls[0]?.[0])).toContain("inclusive o do e-mail, deixou de valer");
  });

  it("⭐ navegador que não deixa copiar: o link aparece num diálogo, com o aviso", async () => {
    h.copiar.mockResolvedValue(false);
    const { result } = renderHook(() => useCopiarLinkDoConvite(), { wrapper: comConsulta() });
    await act(() => result.current.copiar(CONVITE));
    expect(h.sucesso).not.toHaveBeenCalled();

    render(createElement(() => result.current.dialogo as never), { wrapper: comConsulta() });
    expect(await screen.findByDisplayValue(LINK_NOVO)).toBeTruthy();
    expect(screen.getByText(/inclusive o do e-mail, deixou de valer/)).toBeTruthy();
  });

  it("servidor recusou (convite vencido, sem permissão): nada é copiado", async () => {
    h.post.mockRejectedValue(new Error("recusado"));
    const { result } = renderHook(() => useCopiarLinkDoConvite(), { wrapper: comConsulta() });
    await act(() => result.current.copiar(CONVITE));
    expect(h.copiar).not.toHaveBeenCalled();
    expect(h.sucesso).not.toHaveBeenCalled();
  });
});

describe("a lista de convites da aba Membros", () => {
  function convitePendenteSemEmail() {
    h.get.mockResolvedValue({
      data: [
        {
          id: CONVITE,
          organization_id: "90239023-0000-4000-8000-00000000000a",
          email: "convidada@exemplo.invalid",
          role: "agent",
          interface_settings: { preset: "completa" },
          invited_by: null,
          inviter_name: "Pessoa Que Administra",
          email_dispatched: false,
          created_at: "2026-10-15T12:00:00.000Z",
          last_sent_at: "2026-10-15T12:00:00.000Z",
          resend_count: 0,
          expires_at: "2099-01-01T00:00:00.000Z",
          accepted_at: null,
          revoked_at: null,
          status: "pendente",
          accept_url: LINK_LONGO,
        },
      ],
    });
  }

  it("⭐ quem administra: \"Copiar link\" gera o link curto", async () => {
    convitePendenteSemEmail();
    render(createElement(TeamInvitesClient, { canManage: true }), { wrapper: comConsulta() });
    fireEvent.click(await screen.findByRole("button", { name: /Copiar link/i }));
    await waitFor(() => expect(h.copiar).toHaveBeenCalledWith(LINK_NOVO));
    expect(h.post).toHaveBeenCalledWith(`/api/v1/team/invites/${CONVITE}/link-curto`, {});
  });

  it("quem só gerencia: copia o link longo, sem pedir link novo ao servidor", async () => {
    convitePendenteSemEmail();
    render(createElement(TeamInvitesClient, { canManage: false }), { wrapper: comConsulta() });
    fireEvent.click(await screen.findByRole("button", { name: /Copiar link/i }));
    await waitFor(() => expect(h.copiar).toHaveBeenCalledWith(LINK_LONGO));
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe("o resultado da tela Convidar membros", () => {
  it("mostra o link do e-mail e copia ESTE, sem gerar outro", async () => {
    render(createElement(LinkCurtoDoEnvio, { link: LINK_NOVO }));
    expect(screen.getByText(LINK_NOVO)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copiar link do convite/i }));
    await waitFor(() => expect(h.copiar).toHaveBeenCalledWith(LINK_NOVO));
    expect(h.post).not.toHaveBeenCalled();
  });
});

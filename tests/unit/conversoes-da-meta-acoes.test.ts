/**
 * FORK MIA — AS AÇÕES DA TELA que continuam nossas nas conversões da Meta
 * (`app/actions/settings/conversoesDaMeta.ts`): a chave dos leads de formulário
 * e o teste de conexão. O portão de cada uma, e que a organização vem SEMPRE da
 * sessão, nunca do que o navegador mandou.
 *
 * Desde a .72 as regras de etapa são gravadas pela ação do upstream
 * (`salvarRegrasDeConversaoMeta.ts`, 0524) e o reenvio é a rota dele.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

const mock = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
  revalidar: vi.fn(),
  diagnosticar: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: mock.user,
  resolveActiveOrg: mock.org,
  mfaEmDivida: mock.mfa,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: mock.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidar }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-request-id": "req-teste" }) }));
vi.mock("@/lib/conversoes-meta/diagnostico", () => ({ diagnosticarConexaoDaMeta: mock.diagnosticar }));

const { definirLeadsDeFormularioDaMeta, testarConexaoDaMeta } = await import("@/app/actions/settings/conversoesDaMeta");

const ORG = "0a000000-0000-4000-8000-000000000001";

let banco: ReturnType<typeof bancoEmMemoria>;

beforeEach(() => {
  vi.clearAllMocks();
  banco = bancoEmMemoria({ mia_conversoes_meta_config: [] });
  mock.user.mockResolvedValue({ id: "pessoa", is_platform_admin: false });
  mock.org.mockResolvedValue({ orgId: ORG, role: "admin" });
  mock.support.mockReturnValue(false);
  mock.mfa.mockResolvedValue(false);
  mock.admin.mockReturnValue(banco.cliente);
  mock.diagnosticar.mockResolvedValue({ itens: [], veredito: "em_ordem", testadoEm: "2026-10-01T00:00:00Z" });
});

/** A ação que ESCREVE passa pelo portão de escrita. */
const ESCRITAS: Array<[string, () => Promise<{ ok: boolean; error?: string }>]> = [
  ["ligar a volta dos leads de formulário", () => definirLeadsDeFormularioDaMeta(true)],
];

describe("o portão das escritas", () => {
  for (const [nome, chamar] of ESCRITAS) {
    it(`${nome}: sem sessão, suporte em modo leitura, papel abaixo de administrador e segundo fator em dívida são recusados`, async () => {
      mock.user.mockResolvedValueOnce(null);
      expect(await chamar()).toEqual({ ok: false, error: "unauthenticated" });

      mock.support.mockReturnValueOnce(true);
      expect(await chamar()).toEqual({ ok: false, error: "forbidden_role" });

      mock.org.mockResolvedValueOnce(null);
      expect(await chamar()).toEqual({ ok: false, error: "forbidden_tenant" });

      for (const papel of ["viewer", "agent", "manager"]) {
        mock.org.mockResolvedValueOnce({ orgId: ORG, role: papel });
        expect(await chamar(), papel).toEqual({ ok: false, error: "forbidden_role" });
      }

      mock.mfa.mockResolvedValueOnce(true);
      expect(await chamar()).toEqual({ ok: false, error: "mfa_required" });

      expect(banco.escritas).toEqual([]);
      expect(banco.chamadasRpc).toEqual([]);
      expect(mock.audit).not.toHaveBeenCalled();
    });
  }

  it("o administrador da plataforma (scope full) passa pelo papel, menos quando está acompanhando um cliente", async () => {
    mock.user.mockResolvedValue({ id: "plataforma", is_platform_admin: true, platform_admin_scope: "full" });
    mock.org.mockResolvedValue({ orgId: ORG, role: "viewer" });
    expect(await definirLeadsDeFormularioDaMeta(true)).toEqual({ ok: true });

    mock.user.mockResolvedValue({
      id: "plataforma",
      is_platform_admin: true,
      platform_admin_scope: "full",
      support: { somenteLeitura: false },
    });
    expect(await definirLeadsDeFormularioDaMeta(false)).toEqual({ ok: false, error: "forbidden_role" });
  });

  it("o acesso só de leitura ao painel de plataforma não escreve (a regra única do upstream, 1.70)", async () => {
    mock.user.mockResolvedValue({ id: "plataforma", is_platform_admin: true, platform_admin_scope: "support_readonly" });
    mock.org.mockResolvedValue({ orgId: ORG, role: "viewer" });
    expect(await definirLeadsDeFormularioDaMeta(true)).toEqual({ ok: false, error: "forbidden_role" });
    expect(banco.escritas).toEqual([]);
  });
});

describe("a chave dos leads de formulário", () => {
  it("grava na organização da SESSÃO, com quem clicou como autor, e revalida a tela", async () => {
    expect(await definirLeadsDeFormularioDaMeta(true)).toEqual({ ok: true });
    expect(banco.tabela("mia_conversoes_meta_config")).toMatchObject([
      { organization_id: ORG, leads_de_formulario: true, atualizada_por: "pessoa" },
    ]);
    expect(mock.audit.mock.calls[0]![0]).toMatchObject({
      action: "conversoes_meta.leads_de_formulario",
      organizationId: ORG,
      requestId: "req-teste",
      metadata: { via: "tela", ligada: true },
    });
    expect(mock.revalidar).toHaveBeenCalledWith("/app/settings/conversoes");
  });

  it("o que o navegador manda é conferido", async () => {
    expect(await definirLeadsDeFormularioDaMeta("sim" as never)).toEqual({ ok: false, error: "validation_failed" });
    expect(banco.escritas).toEqual([]);
  });
});

describe("o teste de conexão", () => {
  it("é leitura: exige o papel, e não a guarda de escrita nem o segundo fator", async () => {
    mock.support.mockReturnValue(true);
    mock.mfa.mockResolvedValue(true);
    expect(await testarConexaoDaMeta()).toMatchObject({ ok: true, diagnostico: { veredito: "em_ordem" } });
    expect(mock.diagnosticar).toHaveBeenCalledWith(banco.cliente, ORG);

    mock.org.mockResolvedValueOnce({ orgId: ORG, role: "manager" });
    expect(await testarConexaoDaMeta()).toEqual({ ok: false, error: "forbidden_role" });
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it("banco fora: a tela recebe \"não consegui ler\", e não um diagnóstico inventado", async () => {
    mock.diagnosticar.mockRejectedValueOnce(new Error("banco fora"));
    expect(await testarConexaoDaMeta()).toEqual({ ok: false, error: "leitura_indisponivel" });
  });
});

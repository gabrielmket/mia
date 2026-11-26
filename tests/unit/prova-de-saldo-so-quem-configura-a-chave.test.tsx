/**
 * FORK MIA (MIA-284): a prova de saldo é uma geração PAGA — e só quem configura
 * a chave (`podeConfigurarChaveDeIa`) a dispara.
 *
 * O defeito: no passo "Treine seu funcionário", o efeito que chama
 * `/api/v1/system/instalacao?provar=1` rodava ANTES do `if (!podeConfigurar)
 * return null`. A tela sumia para o admin da empresa, mas a geração saía com a
 * chave da plataforma a cada visita, sem ninguém ver o resultado.
 *
 * Duas pontas, porque a regra vale no servidor e a tela só não deve pedir:
 *  - o componente não chama a rota sem `podeConfigurar`, e chama com ele;
 *  - a rota, com `provar=1` e sem o portão, não gera nada e responde sem `prova`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/onboarding/chaveDaIa", () => ({ salvarChaveDaIa: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: vi.fn(async () => []) }));
vi.mock("@/lib/instalacao/retrato", () => ({ lerRetratoDaInstalacao: vi.fn() }));
vi.mock("@/lib/instalacao/prova-de-credito", () => ({ provarSaldo: vi.fn() }));
vi.mock("@/lib/ai/credentials", () => ({
  loadCredential: vi.fn(),
  CredentialUnavailableError: class extends Error {},
}));

import { InteligenciaDele, type EstadoDaChave } from "@/app/onboarding/setup-ai/_inteligencia";
import { GET } from "@/app/api/v1/system/instalacao/route";
import { requireRole } from "@/lib/auth/require-role";
import { lerRetratoDaInstalacao, type RetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { provarSaldo } from "@/lib/instalacao/prova-de-credito";
import { loadCredential } from "@/lib/ai/credentials";

const ORG = "11111111-1111-4111-8111-111111111111";

/** A chave da instalação — o caso da MIA gerenciada: a conta é da plataforma. */
const CHAVE_DA_INSTALACAO: EstadoDaChave = {
  origem: "instalacao",
  provedor: "anthropic",
  rotulo: "Anthropic",
  final: "0000",
};

function retrato(): RetratoDaInstalacao {
  return {
    empresa: { nome: "Empresa Exemplo", aindaSemNomeProprio: false },
    inteligencia: {
      provedor: "anthropic",
      rotulo: "Anthropic",
      origemDaChave: "instalacao",
      chaveEmVerificacao: false,
      chaveDaOrg: null,
      modeloCurado: "modelo-exemplo",
      prontaParaPublicar: true,
    },
    whatsapp: { transporteApontado: true, canais: { total: 1, conectados: 1 } },
    email: { configurado: true },
    funil: null,
  };
}

const ADMIN_DA_EMPRESA = { is_platform_admin: false, platform_admin_scope: null, support: null };
const ADMIN_DA_PLATAFORMA = { is_platform_admin: true, platform_admin_scope: "full", support: null };

function autorizar(user: Record<string, unknown>) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG, role: "admin" },
  } as never);
}

function pedir(query = "?provar=1") {
  return GET(new NextRequest(`http://localhost/api/v1/system/instalacao${query}`));
}

describe("tela: a prova só sai para quem configura a chave", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { prova: { feita: true, ok: true } } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("admin da empresa: nada aparece e a rota paga nem é chamada", async () => {
    const { container } = render(<InteligenciaDele inicial={CHAVE_DA_INSTALACAO} podeConfigurar={false} />);
    expect(container).toBeEmptyDOMElement();
    // Dá tempo de um efeito pendente disparar antes de afirmar que não disparou.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin da plataforma: a prova é pedida", async () => {
    render(<InteligenciaDele inicial={CHAVE_DA_INSTALACAO} podeConfigurar />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/instalacao?provar=1"));
  });
});

describe("rota: provar=1 sem o portão não gera nada", () => {
  beforeEach(() => {
    vi.mocked(lerRetratoDaInstalacao).mockResolvedValue(retrato());
    vi.mocked(provarSaldo).mockResolvedValue({ ok: true });
    vi.stubEnv("ANTHROPIC_API_KEY", "chave-ficticia-de-teste");
  });

  afterEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(provarSaldo).mockReset();
    vi.mocked(loadCredential).mockReset();
    vi.unstubAllEnvs();
  });

  it("admin da empresa: responde o retrato, sem `prova`, e o provedor não é tocado", async () => {
    autorizar(ADMIN_DA_EMPRESA);
    const res = await pedir();
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.data.inteligencia.origemDaChave).toBe("instalacao");
    expect(corpo.data).not.toHaveProperty("prova");
    expect(provarSaldo).not.toHaveBeenCalled();
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it("plataforma em suporte também não prova: acompanhar não é operar", async () => {
    autorizar({ ...ADMIN_DA_PLATAFORMA, support: { status: "active", organization_id: ORG } });
    const corpo = await (await pedir()).json();
    expect(corpo.data).not.toHaveProperty("prova");
    expect(provarSaldo).not.toHaveBeenCalled();
  });

  it("admin da plataforma: a prova é feita e volta na resposta", async () => {
    autorizar(ADMIN_DA_PLATAFORMA);
    const corpo = await (await pedir()).json();
    expect(provarSaldo).toHaveBeenCalledTimes(1);
    expect(corpo.data.prova).toEqual({ feita: true, ok: true });
  });

  it("sem `provar`, nada muda para ninguém", async () => {
    autorizar(ADMIN_DA_EMPRESA);
    const corpo = await (await pedir("")).json();
    expect(corpo.data).not.toHaveProperty("prova");
    expect(provarSaldo).not.toHaveBeenCalled();
  });
});

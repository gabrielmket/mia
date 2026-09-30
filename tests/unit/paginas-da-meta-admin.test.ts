/**
 * FORK MIA (.61) — /api/v1/admin/paginas-da-meta: o dono da plataforma decide de
 * qual empresa é cada Página da Meta (migration 9004).
 *
 * O que se prova:
 *
 *   - só admin da plataforma entra (a empresa não se atribui Página);
 *   - a lista mostra o que a conexão da plataforma alcança, com o dono de cada
 *     Página, e mantém as Páginas com dono que o token deixou de alcançar;
 *   - atribuir, trocar (com o dono anterior auditado) e retirar o dono;
 *   - a conexão da plataforma só aponta para empresa que TEM conexão de Meta Ads;
 *   - nenhum token sai na resposta.
 *
 * O gatilho que desliga os formulários da empresa antiga é do banco, e é provado
 * em tests/invariants/paginas-da-meta-por-empresa.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
  plataforma: true,
  auditorias: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => {
    if (!h.plataforma) throw new Error("forbidden");
    return { user: { id: "dono-da-plataforma" } };
  }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => h.banco!.cliente) }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (a: Record<string, unknown>) => void h.auditorias.push(a)),
}));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({
  lerCredencialDeLeitura: vi.fn(async (_db: unknown, org: string) =>
    org === "0a000000-0000-4000-8000-000000000001"
      ? { ok: true, credencial: { accessToken: "TOKEN-DA-AGENCIA", contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
}));

import { DELETE, GET, POST, PUT } from "@/app/api/v1/admin/paginas-da-meta/route";

let banco: ReturnType<typeof bancoEmMemoria>;

function pedido(metodo: string, corpo?: unknown, busca = ""): never {
  const req = new Request(`http://x/api/v1/admin/paginas-da-meta${busca}`, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  }) as Request & { nextUrl?: URL };
  req.nextUrl = new URL(req.url);
  return req as never;
}

beforeEach(() => {
  h.plataforma = true;
  h.auditorias = [];
  banco = bancoEmMemoria({
    organizations: [
      { id: "0a000000-0000-4000-8000-000000000001", display_name: "Time Company", redacted_at: null },
      { id: "0a000000-0000-4000-8000-000000000002", display_name: "Protev", redacted_at: null },
      { id: "0a000000-0000-4000-8000-000000000003", display_name: "Erglares", redacted_at: null },
    ],
    ad_insights_connections: [{ organization_id: "0a000000-0000-4000-8000-000000000001", platform: "meta_ads" }],
    mia_meta_conexao_da_plataforma: [{ id: 1, organizacao_da_conexao: "0a000000-0000-4000-8000-000000000001" }],
    mia_paginas_da_meta: [
      { page_id: "111", organization_id: "0a000000-0000-4000-8000-000000000002", page_name: "Protev", atribuida_em: "x" },
      { page_id: "444", organization_id: "0a000000-0000-4000-8000-000000000003", page_name: "Saiu do token", atribuida_em: "x" },
    ],
  });
  h.banco = banco;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL) => {
      const url = new URL(String(entrada));
      if (url.pathname.endsWith("/me/accounts")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "111", name: "Protev", access_token: "TOKEN-P111" },
              { id: "222", name: "Castelo Butantã", access_token: "TOKEN-P222" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET", () => {
  it("só o dono da plataforma entra", async () => {
    h.plataforma = false;
    expect((await GET()).status).toBe(403);
    expect((await POST(pedido("POST", { page_id: "222", organization_id: "0a000000-0000-4000-8000-000000000002" }))).status).toBe(403);
  });

  it("lista as Páginas da conexão com o dono, e as com dono que saíram do token", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain("TOKEN-");
    const { data } = JSON.parse(texto) as {
      data: { paginas: Array<{ id: string; organizacao: string | null; alcancada: boolean }> };
    };
    expect(data.paginas).toEqual([
      { id: "111", nome: "Protev", organization_id: "0a000000-0000-4000-8000-000000000002", organizacao: "Protev", alcancada: true },
      { id: "222", nome: "Castelo Butantã", organization_id: null, organizacao: null, alcancada: true },
      {
        id: "444",
        nome: "Saiu do token",
        organization_id: "0a000000-0000-4000-8000-000000000003",
        organizacao: "Erglares",
        alcancada: false,
      },
    ]);
  });
});

describe("POST e DELETE: o dono de cada Página", () => {
  it("atribui a Página sem dono e audita na empresa que a recebeu", async () => {
    const r = await POST(pedido("POST", { page_id: "222", page_name: "Castelo", organization_id: "0a000000-0000-4000-8000-000000000003" }));
    expect(r.status).toBe(200);
    expect(banco.tabela("mia_paginas_da_meta").find((p) => p.page_id === "222")).toMatchObject({
      organization_id: "0a000000-0000-4000-8000-000000000003",
      atribuida_por: "dono-da-plataforma",
    });
    expect(h.auditorias[0]).toMatchObject({
      action: "platform.pagina_da_meta_atribuida",
      organizationId: "0a000000-0000-4000-8000-000000000003",
      metadata: { page_id: "222", dono_anterior: null },
    });
  });

  it("trocar o dono mantém UMA linha por Página e audita o dono anterior", async () => {
    await POST(pedido("POST", { page_id: "111", organization_id: "0a000000-0000-4000-8000-000000000003" }));
    const linhas = banco.tabela("mia_paginas_da_meta").filter((p) => p.page_id === "111");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ organization_id: "0a000000-0000-4000-8000-000000000003" });
    expect(h.auditorias[0]).toMatchObject({ metadata: { dono_anterior: "0a000000-0000-4000-8000-000000000002" } });
  });

  it("empresa inexistente e id de Página inválido são recusados", async () => {
    expect((await POST(pedido("POST", { page_id: "222", organization_id: "7a1b2c3d-0000-4000-8000-000000000000" }))).status).toBe(404);
    expect((await POST(pedido("POST", { page_id: "abc", organization_id: "0a000000-0000-4000-8000-000000000002" }))).status).toBe(422);
  });

  it("retirar o dono apaga a linha e audita na empresa que perdeu a Página", async () => {
    const r = await DELETE(pedido("DELETE", undefined, "?page_id=111"));
    expect(r.status).toBe(200);
    expect(banco.tabela("mia_paginas_da_meta").some((p) => p.page_id === "111")).toBe(false);
    expect(h.auditorias[0]).toMatchObject({
      action: "platform.pagina_da_meta_retirada",
      organizationId: "0a000000-0000-4000-8000-000000000002",
    });
  });
});

describe("PUT: a conexão da plataforma", () => {
  it("só aponta para empresa que tem conexão de Meta Ads", async () => {
    const r = await PUT(pedido("PUT", { organizacao_da_conexao: "0a000000-0000-4000-8000-000000000002" }));
    expect(r.status).toBe(422);
    expect(banco.tabela("mia_meta_conexao_da_plataforma")[0]).toMatchObject({
      organizacao_da_conexao: "0a000000-0000-4000-8000-000000000001",
    });
  });

  it("aceita a empresa com conexão, e aceita nenhuma", async () => {
    expect((await PUT(pedido("PUT", { organizacao_da_conexao: null }))).status).toBe(200);
    expect(banco.tabela("mia_meta_conexao_da_plataforma")[0]).toMatchObject({
      organizacao_da_conexao: null,
    });
    expect((await PUT(pedido("PUT", { organizacao_da_conexao: "0a000000-0000-4000-8000-000000000001" }))).status).toBe(200);
    expect(h.auditorias.map((a) => a.action)).toEqual([
      "platform.conexao_da_meta_escolhida",
      "platform.conexao_da_meta_escolhida",
    ]);
  });
});

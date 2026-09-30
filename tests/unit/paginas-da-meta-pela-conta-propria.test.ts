/**
 * FORK MIA (.64, migration 9008) — /api/v1/leads-da-meta/paginas/escolha: a
 * empresa com conta PRÓPRIA da Meta escolhe as Páginas dela.
 *
 * O que se prova aqui (a rota e a regra de quem escolhe):
 *
 *   - com conta própria, a lista é o que o token DELA alcança, cada Página com o
 *     estado; a de outra empresa aparece travada, sem o id nem o nome da outra;
 *   - ⭐ a empresa assume DUAS Páginas, com o nome vindo da Meta;
 *   - ⭐ assumir a Página de outra empresa é recusado com a frase do suporte (e
 *     quando o banco recusa, a frase é a mesma);
 *   - ⭐ sem conta própria, a empresa não assume; o token da AGÊNCIA colado nela
 *     (o mesmo, ou outro do mesmo usuário do sistema) também não abre a escolha;
 *     sem conseguir conferir na Meta, falha fechado;
 *   - ⭐ soltar chama a função do banco com a empresa da SESSÃO, fecha os avisos
 *     dos formulários desligados e audita;
 *   - nenhum token sai na resposta.
 *
 * A prova de que o banco segura o mesmo com o papel sem RLS é
 * tests/invariants/paginas-da-meta-pela-conta-propria.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
  papel: "admin" as string,
  auditorias: [] as Array<Record<string, unknown>>,
  /** O token de conexão de cada empresa (ausente = sem conexão). */
  tokens: {} as Record<string, string>,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (minimo: string) => {
    const rank: Record<string, number> = { viewer: 1, agent: 2, manager: 3, admin: 4 };
    if (rank[h.papel]! < rank[minimo]!) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
      };
    }
    return { ok: true, user: { id: "user-1" }, org: { orgId: "org-1", role: h.papel } };
  }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => h.banco!.cliente) }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({
  lerCredencialDeLeitura: vi.fn(async (_db: unknown, org: string) =>
    h.tokens[org]
      ? { ok: true, credencial: { accessToken: h.tokens[org], contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
  existeConexaoDeLeitura: vi.fn(async (_db: unknown, org: string) => ({
    conectada: Boolean(h.tokens[org]),
    contaPadrao: null,
  })),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (a: Record<string, unknown>) => void h.auditorias.push(a)),
}));

import { DELETE, GET, POST } from "@/app/api/v1/leads-da-meta/paginas/escolha/route";
import { montarEscolha } from "@/lib/leads-da-meta/autoatendimento";
import { PAGINA_JA_LIGADA_A_OUTRA_EMPRESA } from "@/lib/leads-da-meta/mensagens";

const AGENCIA = "org-agencia";

/** De quem é cada token na Meta (`GET /me`). */
let identidades: Record<string, string> = {};
/** O que cada token alcança (`GET /me/accounts`). */
let alcance: Record<string, Array<{ id: string; name: string }>> = {};
let meFalha = false;
let chamadasNaMeta: string[] = [];

let banco: ReturnType<typeof bancoEmMemoria>;

function pedido(metodo: string, corpo?: unknown, busca = ""): never {
  const req = new Request(`http://x/api/v1/leads-da-meta/paginas/escolha${busca}`, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  }) as Request & { nextUrl?: URL };
  req.nextUrl = new URL(req.url);
  return req as never;
}

beforeEach(() => {
  h.papel = "admin";
  h.auditorias = [];
  h.tokens = { "org-1": "TOKEN-DA-CLINICA", [AGENCIA]: "TOKEN-DA-AGENCIA" };
  identidades = { "TOKEN-DA-CLINICA": "su-clinica", "TOKEN-DA-AGENCIA": "su-agencia" };
  alcance = {
    "TOKEN-DA-CLINICA": [
      { id: "111", name: "Clínica Centro" },
      { id: "222", name: "Clínica Bairro" },
      { id: "444", name: "Clínica Norte" },
      { id: "999", name: "Página do vizinho" },
    ],
  };
  meFalha = false;
  chamadasNaMeta = [];
  banco = bancoEmMemoria({
    mia_meta_conexao_da_plataforma: [{ id: 1, organizacao_da_conexao: AGENCIA }],
    mia_paginas_da_meta: [
      {
        page_id: "222",
        organization_id: "org-1",
        page_name: "Clínica Bairro",
        origem: "conta_propria",
      },
      { page_id: "333", organization_id: "org-1", page_name: "Atribuída", origem: "plataforma" },
      {
        page_id: "999",
        organization_id: "org-2",
        page_name: "Página do vizinho",
        origem: "plataforma",
      },
    ],
  });
  h.banco = banco;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL, init?: RequestInit) => {
      const url = new URL(String(entrada));
      chamadasNaMeta.push(url.pathname);
      const token = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
      ).replace(/^Bearer /, "");
      if (url.pathname.endsWith("/me/accounts")) {
        const data = (alcance[token] ?? []).map((p) => ({ ...p, access_token: `PT-${p.id}` }));
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      if (url.pathname.endsWith("/me")) {
        if (meFalha) return new Response("gateway", { status: 503 });
        return new Response(JSON.stringify({ id: identidades[token] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 100, message: "rota inesperada" } }), {
        status: 400,
      });
    }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function corpo<T>(r: Response): Promise<{ texto: string; data: T }> {
  const texto = await r.text();
  return { texto, data: (JSON.parse(texto) as { data: T }).data };
}

type Escolha = {
  modo: string;
  motivo: string | null;
  erro: { falha: string } | null;
  paginas: Array<{
    id: string;
    nome: string;
    estado: string;
    origem: string | null;
    alcancada: boolean;
  }>;
};

describe("GET: o que a empresa com conta própria vê", () => {
  it("as Páginas que o token DELA alcança, cada uma com o estado; nada da outra empresa", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const { texto, data } = await corpo<Escolha>(r);
    expect(data.modo).toBe("conta_propria");
    expect(data.paginas).toEqual([
      {
        id: "333",
        nome: "Atribuída",
        estado: "desta_empresa",
        origem: "plataforma",
        alcancada: false,
      },
      {
        id: "222",
        nome: "Clínica Bairro",
        estado: "desta_empresa",
        origem: "conta_propria",
        alcancada: true,
      },
      { id: "111", nome: "Clínica Centro", estado: "livre", origem: null, alcancada: true },
      { id: "444", nome: "Clínica Norte", estado: "livre", origem: null, alcancada: true },
      {
        id: "999",
        nome: "Página do vizinho",
        estado: "de_outra_empresa",
        origem: null,
        alcancada: true,
      },
    ]);
    expect(texto).not.toContain("org-2");
    expect(texto).not.toContain("TOKEN-");
    expect(texto).not.toContain("PT-");
  });

  it("sem conexão própria: quem escolhe é a plataforma, e a Meta nem é consultada", async () => {
    delete h.tokens["org-1"];
    const { data } = await corpo<Escolha>(await GET());
    expect(data).toMatchObject({ modo: "plataforma", motivo: "sem_conexao_propria", paginas: [] });
    expect(chamadasNaMeta).toEqual([]);
  });

  it("⭐ o token da agência colado na empresa não abre a escolha", async () => {
    h.tokens["org-1"] = "TOKEN-DA-AGENCIA";
    const { data } = await corpo<Escolha>(await GET());
    expect(data).toMatchObject({ modo: "plataforma", motivo: "conta_da_plataforma", paginas: [] });
    expect(chamadasNaMeta).toEqual([]);
  });

  it("⭐ nem OUTRO token do mesmo usuário do sistema da agência", async () => {
    identidades["TOKEN-DA-CLINICA"] = "su-agencia";
    const { data } = await corpo<Escolha>(await GET());
    expect(data).toMatchObject({ modo: "plataforma", motivo: "conta_da_plataforma", paginas: [] });
    expect(chamadasNaMeta.some((c) => c.endsWith("/me/accounts"))).toBe(false);
  });

  it("sem conseguir conferir de quem é o token: a escolha não abre (falha fechado)", async () => {
    meFalha = true;
    const { data } = await corpo<Escolha>(await GET());
    expect(data.modo).toBe("indefinido");
    expect(data.paginas).toEqual([]);
    expect(data.erro).not.toBeNull();
  });

  it("a empresa da própria agência escolhe sem comparação nenhuma", async () => {
    h.tokens = { "org-1": "TOKEN-DA-AGENCIA" };
    banco.tabela("mia_meta_conexao_da_plataforma")[0]!.organizacao_da_conexao = "org-1";
    alcance["TOKEN-DA-AGENCIA"] = [{ id: "111", name: "Clínica Centro" }];
    const { data } = await corpo<Escolha>(await GET());
    expect(data.modo).toBe("conta_propria");
    expect(chamadasNaMeta.some((c) => c.endsWith("/me"))).toBe(false);
  });

  it("só admin", async () => {
    h.papel = "manager";
    expect((await GET()).status).toBe(403);
  });
});

describe("POST: assumir", () => {
  it("⭐ a empresa com conta própria assume DUAS Páginas, com o nome da Meta", async () => {
    expect((await POST(pedido("POST", { page_id: "111" }))).status).toBe(200);
    expect((await POST(pedido("POST", { page_id: "444" }))).status).toBe(200);
    const minhas = banco
      .tabela("mia_paginas_da_meta")
      .filter((p) => p.organization_id === "org-1" && p.origem === "conta_propria")
      .map((p) => ({ page_id: p.page_id, page_name: p.page_name, atribuida_por: p.atribuida_por }));
    expect(minhas).toEqual([
      { page_id: "222", page_name: "Clínica Bairro", atribuida_por: undefined },
      { page_id: "111", page_name: "Clínica Centro", atribuida_por: "user-1" },
      { page_id: "444", page_name: "Clínica Norte", atribuida_por: "user-1" },
    ]);
    expect(h.auditorias.map((a) => [a.action, a.organizationId])).toEqual([
      ["leads_da_meta.pagina_assumida", "org-1"],
      ["leads_da_meta.pagina_assumida", "org-1"],
    ]);
  });

  it("⭐ a Página de outra empresa é recusada com a frase do suporte, sem dizer qual", async () => {
    const r = await POST(pedido("POST", { page_id: "999" }));
    expect(r.status).toBe(409);
    const texto = await r.text();
    expect(JSON.parse(texto).error.message).toBe(PAGINA_JA_LIGADA_A_OUTRA_EMPRESA);
    expect(texto).not.toContain("org-2");
    expect(banco.tabela("mia_paginas_da_meta").find((p) => p.page_id === "999")).toMatchObject({
      organization_id: "org-2",
    });
    expect(banco.escritas.filter((e) => e.tabela === "mia_paginas_da_meta")).toEqual([]);
  });

  it("⭐ quando o BANCO recusa (outra empresa no meio do caminho), a frase é a mesma", async () => {
    const de = banco.cliente.from;
    banco.cliente.from = ((t: string) => {
      const q = de(t) as Record<string, unknown>;
      if (t === "mia_paginas_da_meta") {
        q.insert = async () => ({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      return q;
    }) as typeof banco.cliente.from;
    const r = await POST(pedido("POST", { page_id: "111" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toBe(PAGINA_JA_LIGADA_A_OUTRA_EMPRESA);
  });

  it("⭐ sem conta própria, a empresa não assume Página", async () => {
    delete h.tokens["org-1"];
    const r = await POST(pedido("POST", { page_id: "111" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("sem_conta_propria");
    expect(banco.escritas).toEqual([]);
  });

  it("⭐ com o token da agência colado, também não", async () => {
    h.tokens["org-1"] = "TOKEN-DA-AGENCIA";
    alcance["TOKEN-DA-AGENCIA"] = [{ id: "111", name: "Clínica Centro" }];
    expect((await POST(pedido("POST", { page_id: "111" }))).status).toBe(403);
    expect(banco.escritas).toEqual([]);
  });

  it("Página que o token da empresa não alcança na Meta é recusada", async () => {
    const r = await POST(pedido("POST", { page_id: "555" }));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("pagina_fora_do_alcance");
    expect(banco.escritas).toEqual([]);
  });

  it("id que não é da Meta é recusado antes de tudo", async () => {
    expect((await POST(pedido("POST", { page_id: "abc" }))).status).toBe(422);
    expect(chamadasNaMeta).toEqual([]);
  });

  it("só admin", async () => {
    h.papel = "manager";
    expect((await POST(pedido("POST", { page_id: "111" }))).status).toBe(403);
  });
});

describe("DELETE: soltar", () => {
  function respostaDoBanco(data: unknown) {
    const rpc = vi.fn(async () => ({ data, error: null }));
    banco.cliente.rpc = rpc as unknown as typeof banco.cliente.rpc;
    return rpc;
  }

  it("⭐ solta pela função do banco, com a empresa da SESSÃO, fecha os avisos e audita", async () => {
    const rpc = respostaDoBanco({ solta: true, formularios: ["f-1", "f-2"] });
    const r = await DELETE(pedido("DELETE", undefined, "?page_id=222"));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ page_id: "222", formularios_desligados: 2 });
    expect(rpc).toHaveBeenCalledWith("fn_mia_soltar_pagina_da_meta", {
      p_organization_id: "org-1",
      p_page_id: "222",
    });
    const avisos = banco.escritas.filter((e) => e.tabela === "agent_inbox_items");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.payload).toMatchObject({ status: "resolved" });
    expect(h.auditorias[0]).toMatchObject({
      action: "leads_da_meta.pagina_solta",
      organizationId: "org-1",
      metadata: { page_id: "222", formularios_desligados: 2 },
    });
  });

  it("a Página atribuída pela plataforma não é solta pela empresa", async () => {
    respostaDoBanco({ solta: false, motivo: "atribuida_pela_plataforma" });
    const r = await DELETE(pedido("DELETE", undefined, "?page_id=333"));
    expect(r.status).toBe(403);
    expect(h.auditorias).toEqual([]);
  });

  it("a Página que não é da empresa: 404, nada muda", async () => {
    respostaDoBanco({ solta: false, motivo: "nao_e_da_empresa" });
    expect((await DELETE(pedido("DELETE", undefined, "?page_id=999"))).status).toBe(404);
    expect(banco.escritas).toEqual([]);
  });

  it("soltar não depende da conexão ainda existir", async () => {
    delete h.tokens["org-1"];
    respostaDoBanco({ solta: true, formularios: [] });
    expect((await DELETE(pedido("DELETE", undefined, "?page_id=222"))).status).toBe(200);
  });
});

describe("montarEscolha, pura", () => {
  it("a mesma Página duas vezes na Meta aparece uma vez; dono antigo sem origem é da plataforma", () => {
    const lista = montarEscolha(
      "org-1",
      [
        { id: "1", nome: "B" },
        { id: "1", nome: "B" },
      ],
      [{ page_id: "1", organization_id: "org-1", origem: null, page_name: "B" }],
    );
    expect(lista).toEqual([
      { id: "1", nome: "B", estado: "desta_empresa", origem: "plataforma", alcancada: true },
    ]);
  });
});

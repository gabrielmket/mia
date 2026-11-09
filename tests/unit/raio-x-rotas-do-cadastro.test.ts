/**
 * FORK MIA (.107) · AS ROTAS PÚBLICAS DO RAIO-X POR CADASTRO, pelo que a pessoa
 * de fora (e o formulário do site) recebe de volta.
 *
 *  - o CADASTRO: formulário → 303 para a página de conexão; JSON → 201 com o
 *    link (CORS só para o site); já usou → 303 para /raio-x/entrar (JSON 409);
 *    inválido com `retorno_erro` → 303 de volta com `?erro=`; sem ele, a página
 *    simples de erro (400); a armadilha também volta como erro;
 *  - ENTRAR: a resposta é a MESMA exista ou não a conta, e o pedido de fora do
 *    app é recusado;
 *  - CONFIRMAR: certo grava o cookie HttpOnly, Secure e SameSite=Lax; errado e
 *    e-mail sem conta respondem igual;
 *  - a ÁREA: sem cookie, 401; de fora do app, 403.
 *
 * Banco em memória e o cadastro dublado; dado fictício.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {
    banco: undefined as unknown as { cliente: unknown; db: Record<string, Array<Record<string, unknown>>> },
    desfecho: null as unknown,
    cadastros: [] as unknown[],
    emails: [] as Array<{ para: string; tipo: string }>,
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: async () => false }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/raio-x/cadastrar", () => ({
  cadastrar: vi.fn(async (_admin: unknown, valor: unknown) => {
    h.cadastros.push(valor);
    return h.desfecho;
  }),
}));
vi.mock("@/lib/raio-x/emails", async (original) => ({
  ...(await original<typeof import("@/lib/raio-x/emails")>()),
  enviarEmailDoRaioX: vi.fn(async (para: string, _montar: unknown, tipo: string) => {
    h.emails.push({ para, tipo });
    return true;
  }),
}));

const { env } = await import("@/lib/env");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");
const cadastro = await import("@/app/api/v1/publico/raio-x/cadastro/route");
const entrar = await import("@/app/api/v1/publico/raio-x/entrar/route");
const confirmar = await import("@/app/api/v1/publico/raio-x/entrar/confirmar/route");
const nova = await import("@/app/api/v1/publico/raio-x/minha-area/nova/route");
const { criarCodigoDeAcesso } = await import("@/lib/raio-x/contas");

const APP = new URL(env.NEXT_PUBLIC_APP_URL).origin;
const CONTA = { id: "e9152e90-5555-4000-8000-0000000106e1", email: "ricardo@garagemmodelo.com.br", nome: "Ricardo Exemplo", telefone: "5531900002202", crm_lead_id: null, crm_enviado_em: null, crm_erro: null, asaas_cliente_id: null, ultimo_acesso_em: null, created_at: "2026-11-06T15:00:00.000Z" };

const FORM = new URLSearchParams({
  nome: "Ricardo Exemplo",
  email: "ricardo@garagemmodelo.com.br",
  telefone: "(31) 90000-2202",
  whatsapp: "(31) 90000-1101",
  empresa: "Garagem Modelo Veículos",
  segmento: "revenda_de_veiculos",
  quem_atende: "humano",
  abre: "08:00",
  fecha: "18:00",
  sabado_ate: "",
  aceite: "sim",
  site: "",
  retorno_erro: "https://iamia.com.br/raio-x",
});

function postar(rota: { POST: (r: NextRequest) => Promise<Response> }, caminho: string, corpo: string, headers: Record<string, string>) {
  return rota.POST(new NextRequest(`${APP}${caminho}`, { method: "POST", body: corpo, headers }));
}
const doForm = (form: URLSearchParams, headers: Record<string, string> = {}) =>
  postar(cadastro, "/api/v1/publico/raio-x/cadastro", form.toString(), { "content-type": "application/x-www-form-urlencoded", origin: "https://iamia.com.br", ...headers });
const doJson = (corpo: unknown, origem = "https://iamia.com.br") =>
  postar(cadastro, "/api/v1/publico/raio-x/cadastro", JSON.stringify(corpo), { "content-type": "application/json", origin: origem });

beforeEach(() => {
  h.banco = bancoEmMemoria({ mia_raio_x_contas: [{ ...CONTA }] }) as never;
  h.cadastros = [];
  h.emails = [];
  h.desfecho = {
    tipo: "criado",
    conta: CONTA,
    raioX: { id: "e9152e90-2222-4000-8000-0000000106e1" },
    codigo: "K7PQ2M9X",
    link: `${APP}/raio-x/K7PQ2M9X`,
    aceiteId: "aceite-1",
    termoVersao: "v1",
    prontoParaParear: true,
    lead: { ok: true, leadId: "lead-1", organizationId: "org-time" },
    emailSaiu: true,
  };
});

describe("o cadastro", () => {
  it("⭐ formulário: 303 para a página de conexão do raio-X", async () => {
    const r = await doForm(FORM);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${APP}/raio-x/K7PQ2M9X`);
    expect(h.cadastros).toHaveLength(1);
  });

  it("JSON do site: 201 com o link, e o CORS só para iamia.com.br", async () => {
    const r = await doJson(Object.fromEntries(FORM));
    expect(r.status).toBe(201);
    expect(((await r.json()) as { data: { link: string } }).data.link).toBe(`${APP}/raio-x/K7PQ2M9X`);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://iamia.com.br");
    const deFora = await doJson(Object.fromEntries(FORM), "https://golpe.invalid");
    expect(deFora.headers.get("access-control-allow-origin")).toBeNull();
    const previo = await cadastro.OPTIONS(new NextRequest(`${APP}/api/v1/publico/raio-x/cadastro`, { method: "OPTIONS", headers: { origin: "https://www.iamia.com.br" } }));
    expect(previo.status).toBe(204);
    expect(previo.headers.get("access-control-allow-origin")).toBe("https://www.iamia.com.br");
  });

  it("⭐ já usou a grátis: formulário 303 para /raio-x/entrar?email=…&motivo=ja_usou; JSON 409 com o motivo", async () => {
    h.desfecho = { tipo: "ja_usou", conta: CONTA, raioXId: "rx-antigo", lead: { ok: true, leadId: "lead-1", organizationId: "org-time" } };
    const r = await doForm(FORM);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${APP}/raio-x/entrar?email=ricardo%40garagemmodelo.com.br&motivo=ja_usou`);
    const j = await doJson(Object.fromEntries(FORM));
    expect(j.status).toBe(409);
    expect(((await j.json()) as { error: { details: { motivo: string } } }).error.details.motivo).toBe("ja_usou");
  });

  it("⭐ inválido com retorno_erro: 303 de volta ao site com ?erro=<campos>, sem chamar o cadastro", async () => {
    const ruim = new URLSearchParams(FORM);
    ruim.set("nome", "Ricardo");
    ruim.set("aceite", "");
    const r = await doForm(ruim);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://iamia.com.br/raio-x?erro=nome%2Caceite");
    expect(h.cadastros).toHaveLength(0);
  });

  it("inválido sem retorno_erro (ou com um de fora): a página simples de erro do sistema", async () => {
    const ruim = new URLSearchParams(FORM);
    ruim.set("email", "ricardo-arroba");
    ruim.set("retorno_erro", "https://golpe.invalid/");
    const r = await doForm(ruim);
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("Confira o e-mail.");
  });

  it("a armadilha preenchida volta como erro e não cadastra nada", async () => {
    const robo = new URLSearchParams(FORM);
    robo.set("site", "https://spam.invalid");
    const r = await doForm(robo);
    expect(r.headers.get("location")).toBe("https://iamia.com.br/raio-x?erro=site");
    expect(h.cadastros).toHaveLength(0);
  });
});

describe("entrar sem senha", () => {
  const pedir = (email: string, origem = APP) =>
    postar(entrar, "/api/v1/publico/raio-x/entrar", JSON.stringify({ email }), { "content-type": "application/json", origin: origem });

  it("⭐ a resposta é a MESMA exista ou não a conta (e só quem tem conta recebe o e-mail)", async () => {
    const comConta = await pedir("ricardo@garagemmodelo.com.br");
    const semConta = await pedir("ninguem@garagemmodelo.com.br");
    expect(comConta.status).toBe(200);
    expect(semConta.status).toBe(comConta.status);
    expect(((await semConta.json()) as { data: unknown }).data).toEqual(((await comConta.json()) as { data: unknown }).data);
    await new Promise((pronto) => setTimeout(pronto, 0));
    expect(h.emails).toEqual([{ para: "ricardo@garagemmodelo.com.br", tipo: "codigo" }]);
  });

  it("o pedido de fora do próprio app é recusado", async () => {
    expect((await pedir("ricardo@garagemmodelo.com.br", "https://golpe.invalid")).status).toBe(403);
  });

  it("⭐ confirmar: o certo grava o cookie HttpOnly, Secure, SameSite=Lax; o errado e o e-mail sem conta respondem igual", async () => {
    const { codigo } = (await criarCodigoDeAcesso(h.banco.cliente as never, CONTA.email))!;
    const tentar = (email: string, c: string) =>
      postar(confirmar, "/api/v1/publico/raio-x/entrar/confirmar", JSON.stringify({ email, codigo: c }), { "content-type": "application/json", origin: APP });
    const errado = await tentar(CONTA.email, codigo === "000000" ? "111111" : "000000");
    const ninguem = await tentar("ninguem@garagemmodelo.com.br", codigo);
    expect(errado.status).toBe(400);
    expect(ninguem.status).toBe(400);
    expect(((await ninguem.json()) as { error: { message: string } }).error.message).toBe(((await errado.json()) as { error: { message: string } }).error.message);
    const certo = await tentar(CONTA.email, codigo);
    expect(certo.status).toBe(200);
    const cookie = certo.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^mia_raio_x_area=v1\./);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });
});

describe("a área confere a sessão e a origem", () => {
  it("sem cookie, 401; de fora do app, 403", async () => {
    const semCookie = await postar(nova, "/api/v1/publico/raio-x/minha-area/nova", JSON.stringify({ tipo: "avulsa", aceite: true }), { "content-type": "application/json", origin: APP });
    expect(semCookie.status).toBe(401);
    const deFora = await postar(nova, "/api/v1/publico/raio-x/minha-area/nova", JSON.stringify({ tipo: "avulsa", aceite: true }), { "content-type": "application/json", origin: "https://golpe.invalid" });
    expect(deFora.status).toBe(403);
  });
});

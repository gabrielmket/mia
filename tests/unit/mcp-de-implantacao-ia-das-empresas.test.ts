/**
 * FORK MIA (MIA-218) · `plataforma_ver_ia_das_empresas`, pelo servidor inteiro
 * (tools/list, a conferência dos argumentos, o handler e a resposta), sobre o
 * banco em memória dos testes do MCP de implantação.
 *
 * A régua é a de verdade (`iaDasEmpresas` e `contarEmpresas`, MIA-217); só a
 * leitura do `.env` da instalação entra fixa: a instalação daqui tem chave da
 * OpenAI e de nenhum outro provedor.
 *
 * Cinco empresas fictícias, uma de cada caso:
 *   Clínica Exemplo   segue a plataforma (OpenAI), chave da instalação
 *   Academia Beta     escolha própria na Anthropic, sem chave nenhuma        → sem chave
 *   Loja Gama         escolha própria no Google, chave própria validada
 *   Escola Épsilon    escolha própria no Google, chave própria NÃO validada  → sem chave
 *   Studio Delta      suspensa, Anthropic sem chave: aparece, não conta
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, OUTRA_ORG } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
// A instalação tem chave da OpenAI, e só dela.
// A chave (cifrada) da credencial fictícia nunca pode sair na resposta.
const CHAVE_CIFRADA = "cifra-ficticia-0000";
vi.mock("@/lib/ai/ia-da-empresa", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/ia-da-empresa")>();
  return {
    ...real,
    iaDasEmpresas: (admin: Parameters<typeof real.iaDasEmpresas>[0]) =>
      real.iaDasEmpresas(admin, (p: string) => p === "openai"),
  };
});

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");

const GAMA = "0a000000-0000-4000-8000-0000000000c3";
const EPSILON = "0a000000-0000-4000-8000-0000000000c5";
const DELTA = "0a000000-0000-4000-8000-0000000000c4";

let cenario: ReturnType<typeof cenarioDaImplantacao>;

function empresa(id: string, nome: string, extra: Record<string, unknown>) {
  return { id, display_name: nome, status: "active", settings: {}, ia_segue_a_plataforma: false, ...extra };
}

beforeEach(() => {
  cenario = cenarioDaImplantacao();
  const db = cenario.banco.db;
  const clinica = db.organizations!.find((o) => o.id === ORG)!;
  clinica.settings = { llm: { provider: "openai", default_model: "gpt-ficticio" } };
  clinica.ia_segue_a_plataforma = true;
  db.organizations!.push(
    empresa(OUTRA_ORG, "Academia Beta", { settings: { llm: { provider: "anthropic" } } }),
    empresa(GAMA, "Loja Gama", { settings: { llm: { provider: "google", default_model: "gemini-ficticio" } } }),
    empresa(EPSILON, "Escola Épsilon", { settings: { llm: { provider: "google" } } }),
    empresa(DELTA, "Studio Delta", { status: "suspended", settings: { llm: { provider: "anthropic" } } }),
  );
  db.ai_provider_credentials = [
    {
      id: "cred-1",
      organization_id: GAMA,
      provider: "google",
      is_active: true,
      validated_at: "2026-11-01T00:00:00Z",
      api_key_encrypted: CHAVE_CIFRADA,
    },
    // cadastrada e nunca validada: não é chave utilizável
    { id: "cred-2", organization_id: EPSILON, provider: "google", is_active: true, validated_at: null },
    // validada, mas desativada
    { id: "cred-3", organization_id: OUTRA_ORG, provider: "anthropic", is_active: false, validated_at: "2026-11-01T00:00:00Z" },
  ];
  estado.cliente = cenario.cliente;
});

async function chamar(args: Record<string, unknown>) {
  const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
  const r = await mcp.chamar("plataforma_ver_ia_das_empresas", args);
  await mcp.fechar();
  return r;
}

type Linha = {
  organization_id: string;
  empresa: string | null;
  status: string | null;
  operante: boolean;
  origem: string;
  provedor: string;
  provedor_nome: string;
  modelo: string | null;
  chave: string | null;
};
type Resposta = { contagem: { seguem: number; propria: number; sem_chave: number }; total: number; empresas: Linha[] };

describe("a lista", () => {
  it("está lá, só lê, a lista tem 135 (134 + esta), e não há ferramenta de trocar a IA", async () => {
    expect(FERRAMENTAS).toHaveLength(135);
    expect(FERRAMENTAS.find((f) => f.name === "plataforma_ver_ia_das_empresas")?.operacao).toBeNull();
    // Trocar o modelo é ato de pessoa, com MFA, no painel.
    const trocas = FERRAMENTAS.filter((f) => /^plataforma_(trocar|mudar|definir|configurar|escolher)_(.*_)?(ia|modelo|modelos|provedor|provedores)(_|$)/.test(f.name));
    expect(trocas.map((f) => f.name)).toEqual([]);

    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const nomes = (await mcp.listar()).map((t) => t.name);
    await mcp.fechar();
    expect(nomes).toContain("plataforma_ver_ia_das_empresas");
  });
});

describe("plataforma_ver_ia_das_empresas", () => {
  it("⭐ todas: a origem, o par e de onde sai a chave de cada uma, as sem chave primeiro", async () => {
    const r = await chamar({});
    expect(r.erro, r.texto).toBe(false);
    const d = r.dados as unknown as Resposta;

    expect(d.total).toBe(5);
    // As três sem chave primeiro (em ordem de nome), depois as outras.
    expect(d.empresas.map((e) => e.empresa)).toEqual([
      "Academia Beta",
      "Escola Épsilon",
      "Studio Delta",
      "Clínica Exemplo",
      "Loja Gama",
    ]);
    const de = (id: string) => d.empresas.find((e) => e.organization_id === id)!;
    expect(de(ORG)).toMatchObject({
      origem: "plataforma",
      provedor: "openai",
      modelo: "gpt-ficticio",
      chave: "instalacao",
      operante: true,
    });
    expect(de(GAMA)).toMatchObject({ origem: "propria", provedor: "google", modelo: "gemini-ficticio", chave: "propria" });
    // Credencial desativada não vale; sem chave da Anthropic na instalação.
    expect(de(OUTRA_ORG)).toMatchObject({ origem: "propria", provedor: "anthropic", modelo: null, chave: null });
    // Credencial nunca validada não vale.
    expect(de(EPSILON)).toMatchObject({ provedor: "google", chave: null });
    expect(de(DELTA)).toMatchObject({ status: "suspended", operante: false, chave: null });
    // O nome que a pessoa reconhece vem junto do id.
    expect(de(ORG).provedor_nome).not.toBe("");
  });

  it("a contagem é só das operantes: a suspensa aparece na lista e não conta", async () => {
    const d = (await chamar({})).dados as unknown as Resposta;
    expect(d.contagem).toEqual({ seguem: 1, propria: 3, sem_chave: 2 });
  });

  it("nunca devolve a chave em si", async () => {
    const r = await chamar({});
    expect(r.texto).not.toContain(CHAVE_CIFRADA);
    expect(r.texto).not.toMatch(/api_key|encrypted|secret/i);
  });

  it("so_sem_chave: só as que não respondem com IA; a contagem continua a da instalação inteira", async () => {
    const d = (await chamar({ so_sem_chave: true })).dados as unknown as Resposta;
    expect(d.empresas.map((e) => e.organization_id).sort()).toEqual([OUTRA_ORG, DELTA, EPSILON].sort());
    expect(d.empresas.every((e) => e.chave === null)).toBe(true);
    expect(d.total).toBe(3);
    expect(d.contagem).toEqual({ seguem: 1, propria: 3, sem_chave: 2 });
  });

  it("organization_id: só aquela empresa", async () => {
    const d = (await chamar({ organization_id: GAMA })).dados as unknown as Resposta;
    expect(d.empresas).toHaveLength(1);
    expect(d.empresas[0]).toMatchObject({ empresa: "Loja Gama", chave: "propria" });
  });

  it("empresa que não existe: a recusa diz onde achar o id", async () => {
    const r = await chamar({ organization_id: "0a000000-0000-4000-8000-0000000000ff" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Não existe organização com o id 0a000000-0000-4000-8000-0000000000ff");
    expect(r.texto).toContain("plataforma_listar_clientes");
  });

  it("argumento errado: a recusa ensina, com o exemplo que passa", async () => {
    const r = await chamar({ so_sem_chave: "sim" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("so_sem_chave");
    expect(r.texto).toContain("Exemplo de chamada válida");
  });

  it("a leitura das credenciais falhou: erro, e não uma lista com cara de \"ninguém tem chave\"", async () => {
    const fromReal = cenario.cliente.from.bind(cenario.cliente);
    cenario.cliente.from = ((tabela: string) =>
      tabela === "ai_provider_credentials"
        ? { select: () => ({ eq: () => ({ not: async () => ({ data: null, error: { message: "fora do ar" } }) }) }) }
        : fromReal(tabela)) as typeof cenario.cliente.from;
    const r = await chamar({});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não consegui ler a IA das empresas");
  });
});

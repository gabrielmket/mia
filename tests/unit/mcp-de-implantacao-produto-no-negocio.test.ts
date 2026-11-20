/**
 * FORK MIA (.109) · O PRODUTO NO NEGÓCIO NO MCP DE PLATAFORMA
 * (lib/mcp-plataforma/ferramentas/produto-no-negocio.ts; docs/fork/produto-no-negocio.md).
 *
 * Duas ferramentas, as duas `implantar_configuracao`: configurar a palavra e as
 * duas opções de UM funil, e garantir a palavra do segmento nos funis do cliente
 * sem atropelar palavra escolhida. A leitura é a de plataforma_ver_funis, que
 * passa a trazer `produto_no_negocio`. A lista vai de 115 para 117 (118 com a da lista de espera, MIA-18; 119 com a do consumo de IA, MIA-44).
 *
 * Banco em memória, dado fictício.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auditados: [] as Array<{ action: string; metadata?: Record<string, unknown> }> }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: { action: string; metadata?: Record<string, unknown> }) => {
    h.auditados.push(e);
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTA_POR_NOME, FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");

const ORG = "0b0c0d0e-1111-4111-8111-000000000119";
const COMERCIAL = "0b0c0d0e-2222-4222-8222-000000000001";
const POS_VENDA = "0b0c0d0e-2222-4222-8222-000000000002";
const ARQUIVADO = "0b0c0d0e-2222-4222-8222-000000000003";
const AUTOR = "0b0c0d0e-6666-4666-8666-000000000119";

const NOMES = ["plataforma_configurar_produto_no_negocio", "plataforma_garantir_palavra_do_segmento"];

function banco() {
  return bancoEmMemoria({
    organizations: [{ id: ORG, display_name: "Clínica Sorriso Exemplo", status: "active", settings: {}, locale: "pt-BR" }],
    crm_pipelines: [
      { id: COMERCIAL, organization_id: ORG, name: "Comercial · Avaliações", position: 1, is_archived: false, vocabulary: { lead: "Paciente", deal: "Tratamento", won: "Fechado" }, settings: {} },
      { id: POS_VENDA, organization_id: ORG, name: "Pós-venda", position: 2, is_archived: false, vocabulary: { produto: "Procedimento" }, settings: { vitoria_e_receita: false } },
      { id: ARQUIVADO, organization_id: ORG, name: "Antigo", position: 3, is_archived: true, vocabulary: {}, settings: {} },
    ],
    crm_stages: [],
  });
}

const ctx = (b: ReturnType<typeof banco>) => ({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: "t", requestId: "r" });
const chamar = (nome: string, b: ReturnType<typeof banco>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(b), args) as Promise<Record<string, unknown>>;
const funil = (b: ReturnType<typeof banco>, id: string) =>
  (b.db.crm_pipelines as Array<Record<string, unknown>>).find((f) => f.id === id)!;

beforeEach(() => {
  h.auditados = [];
});

describe("as duas do produto no negócio", () => {
  it("estão na lista, e a lista tem 126 (115 da .108 + as duas da .109 + a da lista de espera, MIA-18 + a do consumo de IA, MIA-44 + as três da 1.117, MIA-67 + as duas da 1.118, MIA-79 + as duas da MIA-103)", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.has(n), n).toBe(true);
    expect(FERRAMENTAS).toHaveLength(126);
  });

  it("as duas são montagem (implantar_configuracao) e o exemplo de cada uma vale no próprio schema", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.get(n)!.operacao).toBe("implantar_configuracao");
  });
});

describe("plataforma_configurar_produto_no_negocio", () => {
  it("grava a palavra e as duas opções pela porta da tela, e repetir responde ja_estava", async () => {
    const b = banco();
    const r = await chamar("plataforma_configurar_produto_no_negocio", b, {
      organization_id: ORG,
      funil: "Comercial · Avaliações",
      palavra: "Tratamento",
      pedir_no_ganho: true,
      mostrar_valor_recorrente: false,
    });
    expect(r.antes).toMatchObject({ palavra: null, pedir_no_ganho: false, mostrar_valor_recorrente: true });
    expect(r.depois).toMatchObject({ palavra: "Tratamento", pedir_no_ganho: true, mostrar_valor_recorrente: false });
    expect(r.ja_estava).toBe(false);
    // O resto do vocabulário e do settings fica como estava (a mescla da tela).
    expect(funil(b, COMERCIAL).vocabulary).toEqual({ lead: "Paciente", deal: "Tratamento", won: "Fechado", produto: "Tratamento" });
    expect(funil(b, COMERCIAL).settings).toEqual({ pedir_produto_no_ganho: true, mostrar_valor_recorrente: false });
    expect(h.auditados.map((a) => a.action)).toEqual(["funil.produto_no_negocio_configurado"]);

    const de_novo = await chamar("plataforma_configurar_produto_no_negocio", b, { organization_id: ORG, funil: COMERCIAL, palavra: "Tratamento" });
    expect(de_novo.ja_estava).toBe(true);
    expect(h.auditados).toHaveLength(1);
  });

  it('"" volta ao padrão do sistema; pedido vazio e funil arquivado recusam', async () => {
    const b = banco();
    const r = await chamar("plataforma_configurar_produto_no_negocio", b, { organization_id: ORG, funil: "Pós-venda", palavra: "" });
    expect(r.depois).toMatchObject({ palavra: null, palavra_vale: "Produto ou serviço (o padrão do sistema)" });
    await expect(chamar("plataforma_configurar_produto_no_negocio", b, { organization_id: ORG, funil: "Pós-venda" })).rejects.toThrow(
      /Informe ao menos um campo/,
    );
    await expect(
      chamar("plataforma_configurar_produto_no_negocio", b, { organization_id: ORG, funil: "Antigo", pedir_no_ganho: true }),
    ).rejects.toThrow(/Não achei o funil/);
  });
});

describe("plataforma_garantir_palavra_do_segmento", () => {
  it("clínica: preenche os funis sem palavra, renomeia o negócio que repete e mantém a palavra escolhida", async () => {
    const b = banco();
    const r = await chamar("plataforma_garantir_palavra_do_segmento", b, { organization_id: ORG, segmento: "clinica" });
    expect(r.palavra).toBe("Tratamento");
    expect(r.mantidos).toEqual(["Pós-venda"]);
    expect(funil(b, COMERCIAL).vocabulary).toMatchObject({ produto: "Tratamento", deal: "Plano de tratamento" });
    expect(funil(b, POS_VENDA).vocabulary).toEqual({ produto: "Procedimento" });
    // O arquivado fica de fora.
    expect(funil(b, ARQUIVADO).vocabulary).toEqual({});
    expect(h.auditados.map((a) => a.action)).toEqual(["funil.palavra_do_segmento_garantida"]);

    const de_novo = await chamar("plataforma_garantir_palavra_do_segmento", b, { organization_id: ORG, segmento: "clinica" });
    expect(de_novo.ja_estava).toBe(true);
  });

  it("sobrescrever troca a palavra escolhida; a lista de funis limita o alcance", async () => {
    const b = banco();
    const r = await chamar("plataforma_garantir_palavra_do_segmento", b, {
      organization_id: ORG,
      segmento: "escritorio",
      funis: ["Pós-venda"],
      sobrescrever: true,
    });
    expect((r.funis as Array<{ nome: string; desfecho: string }>).map((f) => [f.nome, f.desfecho])).toEqual([["Pós-venda", "atualizou"]]);
    expect(funil(b, POS_VENDA).vocabulary).toEqual({ produto: "Serviço" });
    expect(funil(b, COMERCIAL).vocabulary).not.toHaveProperty("produto");
  });
});

describe("plataforma_ver_funis traz o produto no negócio de cada funil", () => {
  it("a palavra (ou o padrão) e as duas opções", async () => {
    const b = banco();
    const r = (await chamar("plataforma_ver_funis", b, { organization_id: ORG })) as { funis: Array<Record<string, unknown>> };
    const porNome = new Map(r.funis.map((f) => [f.nome, f.produto_no_negocio]));
    expect(porNome.get("Comercial · Avaliações")).toEqual({
      palavra: null,
      palavra_vale: "Produto ou serviço (o padrão do sistema)",
      pedir_no_ganho: false,
      mostrar_valor_recorrente: true,
    });
    expect(porNome.get("Pós-venda")).toMatchObject({ palavra: "Procedimento" });
  });
});

/**
 * FORK MIA — AS LEITURAS DO MCP DE PLATAFORMA NÃO PARAM NA LINHA 1000.
 *
 * ## O defeito
 *
 * Quatro leituras do MCP de plataforma pediam `.limit(5000)` e contavam o que
 * vinha. O PostgREST corta toda resposta em 1000 linhas sem avisar, então quem
 * implanta um cliente com catálogo ou com obrigações grandes lia números de
 * 1000 linhas com cara de total:
 *
 *  · o checklist (`plataforma_ver_implantacao`) dizia "1.000 produtos" para um
 *    catálogo de 2.500, e contava as obrigações só entre 1000;
 *  · `plataforma_ver_catalogo` dizia `total: 1000`, a busca só olhava os 1000
 *    primeiros por nome, e não havia `pular` que alcançasse o resto;
 *  · `plataforma_ver_obrigacoes` tirava os contadores das 1000 mais antigas.
 *
 * ## Como se prova
 *
 * O cenário é o dos testes do MCP de implantação, com o banco em memória
 * cortando em 1000 linhas (`maxRows`), como o servidor. O controle negativo faz
 * a leitura antiga contra o mesmo banco.
 *
 * A prova contra o Postgres de verdade é a dos invariantes
 * (`tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts` e
 * `tests/invariants/obrigacoes-pelo-mcp.test.ts`).
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  OUTRA_ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => ({ ok: false, motivo: "sem_conexao" }) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

async function preparar() {
  // O teto do PostgREST de produção: é ele que os números têm de atravessar.
  const cenario = cenarioDaImplantacao({ maxRows: 1000 });
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  const chamar = async (nome: string, args: Record<string, unknown> = {}) => {
    const r = await mcp.chamar(nome, { organization_id: ORG, ...args });
    expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
    return r.dados;
  };
  return { ...cenario, chamar, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}

const numero = (i: number) => String(i).padStart(5, "0");

function produto(i: number, over: Linha = {}): Linha {
  return {
    id: `produto-${numero(i)}`,
    organization_id: ORG,
    codigo: `COD-${numero(i)}`,
    nome: `Produto ${numero(i)}`,
    descricao: "Descrição do produto.",
    marca: null,
    categoria: null,
    preco_cents: 1_000,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: false,
    quantidade: null,
    ativo: true,
    origem: "implantacao",
    imagem_url: null,
    fotos: [],
    updated_at: "2026-09-01T12:00:00.000Z",
    ...over,
  };
}

/** Uma atividade mensal com a próxima data no passado: vencida, em qualquer dia de hoje. */
function obrigacao(i: number, over: Linha = {}): Linha {
  return {
    id: `obrigacao-${numero(i)}`,
    organization_id: ORG,
    tipo_id: null,
    nome: `Relatório mensal ${numero(i)}`,
    nome_curto: null,
    categoria: "atividade",
    lead_id: null,
    empresa_id: null,
    contact_id: null,
    quem_entrega: "nos",
    recorrencia: "mensal",
    recorrencia_meses: null,
    validade_meses: null,
    avisos_dias: [],
    dias_sem_resposta: null,
    pedido_em: null,
    prazo_em: null,
    cobrado_em: null,
    recebido_em: null,
    valido_ate: null,
    renovado_em: null,
    proxima_em: "2020-01-15",
    feita_em: null,
    ciclo: 1,
    arquivo_path: null,
    arquivo_nome: null,
    arquivo_mime: null,
    arquivo_bytes: null,
    responsavel_user_id: null,
    observacao: null,
    origem: "mcp",
    chave_natural: `chave-${numero(i)}`,
    sem_aviso_antes_de: null,
    arquivado_em: null,
    created_at: new Date(Date.parse("2026-01-01T12:00:00.000Z") + i * 1_000).toISOString(),
    updated_at: "2026-09-01T12:00:00.000Z",
    ...over,
  };
}

type Area = { area: string; dados: Record<string, unknown>; pronto: string[] };
const areaDe = (dados: Record<string, unknown>, chave: string) =>
  (dados.areas as Area[]).find((a) => a.area === chave)!;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

describe("o checklist da implantação", () => {
  it("catálogo de 2.500 produtos: 2.500 no total, 2.000 ativos, 300 ativos sem descrição", async () => {
    const c = await preparar();
    c.tabela("catalog_products").push(
      // 1.700 ativos com descrição, 200 com descrição nula, 100 com descrição vazia, 500 inativos.
      ...Array.from({ length: 1_700 }, (_, i) => produto(i)),
      ...Array.from({ length: 200 }, (_, i) => produto(2_000 + i, { descricao: null })),
      ...Array.from({ length: 100 }, (_, i) => produto(3_000 + i, { descricao: "" })),
      ...Array.from({ length: 500 }, (_, i) => produto(4_000 + i, { ativo: false, descricao: null })),
      // De outra organização: não entra.
      ...Array.from({ length: 300 }, (_, i) => produto(9_000 + i, { organization_id: OUTRA_ORG })),
    );

    const produtos = areaDe(await c.chamar("plataforma_ver_implantacao"), "produtos");

    expect(produtos.dados).toEqual({ total: 2_500, ativos: 2_000, sem_descricao: 300 });
    expect(produtos.pronto.join(" ")).toContain("2500 produtos no catálogo, 2000 ativo(s).");
  });

  it("2.500 obrigações e 1.200 tipos: os contadores somam 2.500, e os tipos são contados no banco", async () => {
    const c = await preparar();
    c.tabela("mia_obrigacoes").push(...Array.from({ length: 2_500 }, (_, i) => obrigacao(i)));
    c.tabela("mia_obrigacoes_tipos").push(
      ...Array.from({ length: 1_200 }, (_, i) => ({
        id: `tipo-${numero(i)}`,
        organization_id: ORG,
        nome: `Tipo ${numero(i)}`,
        arquivado_em: null,
      })),
    );

    const area = areaDe(await c.chamar("plataforma_ver_implantacao"), "obrigacoes");

    expect(area.dados.tipos_no_catalogo).toBe(1_200);
    expect(area.dados.contadores).toMatchObject({ total: 2_500, vencidos: 2_500 });
  });

  it("controle negativo: as leituras antigas (.limit(5000)) viam 1000 produtos e 1000 obrigações", async () => {
    const c = await preparar();
    c.tabela("catalog_products").push(...Array.from({ length: 2_500 }, (_, i) => produto(i)));
    c.tabela("mia_obrigacoes").push(...Array.from({ length: 2_500 }, (_, i) => obrigacao(i)));
    const db = c.cliente as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (c: string, v: string) => { limit: (n: number) => PromiseLike<{ data: Linha[] | null }> } };
      };
    };

    const produtos = await db.from("catalog_products").select("id, ativo, descricao").eq("organization_id", ORG).limit(5000);
    const obrigacoes = await db.from("mia_obrigacoes").select("id").eq("organization_id", ORG).limit(5000);

    expect(produtos.data).toHaveLength(1_000);
    expect(obrigacoes.data).toHaveLength(1_000);
  });
});

describe("plataforma_ver_catalogo", () => {
  it("2.500 produtos: o total é 2.500, e `pular` alcança o que vinha depois do milésimo", async () => {
    const c = await preparar();
    c.tabela("catalog_products").push(...Array.from({ length: 2_500 }, (_, i) => produto(i)));

    const primeira = await c.chamar("plataforma_ver_catalogo");
    expect(primeira).toMatchObject({ total: 2_500, devolvidos: 200, proxima_pagina: { pular: 200 } });
    expect(primeira.catalogo_cortado).toBeUndefined();

    const ultima = await c.chamar("plataforma_ver_catalogo", { pular: 2_400 });
    expect(ultima).toMatchObject({ total: 2_500, devolvidos: 100 });
    expect(ultima.proxima_pagina).toBeUndefined();
    expect((ultima.produtos as Linha[]).at(-1)).toMatchObject({ codigo: "COD-02499" });
  });

  it("a busca acha o produto que está depois do milésimo por nome", async () => {
    const c = await preparar();
    c.tabela("catalog_products").push(
      ...Array.from({ length: 2_499 }, (_, i) => produto(i)),
      // "Zíper" fica no fim da ordem por nome: fora das 1000 primeiras linhas.
      produto(9_999, { nome: "Zíper invisível de teste", codigo: "ZIP-1" }),
    );

    const achado = await c.chamar("plataforma_ver_catalogo", { busca: "zíper" });

    expect(achado).toMatchObject({ total: 1, devolvidos: 1 });
    expect((achado.produtos as Linha[])[0]).toMatchObject({ codigo: "ZIP-1" });
  });

  it("acima do teto de leitura (10 mil): diz que cortou e quantos há no banco", async () => {
    const c = await preparar();
    c.tabela("catalog_products").push(...Array.from({ length: 10_001 }, (_, i) => produto(i)));

    const lido = await c.chamar("plataforma_ver_catalogo");

    expect(lido).toMatchObject({ total: 10_000, catalogo_cortado: true });
    expect(String(lido.aviso)).toContain("10001 no banco");
  });
});

describe("plataforma_ver_obrigacoes", () => {
  it("2.500 obrigações vencidas: os contadores e o `de` são 2.500", async () => {
    const c = await preparar();
    c.tabela("mia_obrigacoes").push(
      ...Array.from({ length: 2_500 }, (_, i) => obrigacao(i)),
      ...Array.from({ length: 300 }, (_, i) => obrigacao(9_000 + i, { organization_id: OUTRA_ORG })),
    );

    const retrato = await c.chamar("plataforma_ver_obrigacoes", { situacao: "vencidas" });

    expect(retrato.contadores).toMatchObject({ total: 2_500, vencidos: 2_500 });
    expect(retrato).toMatchObject({ de: 2_500 });
    expect(retrato.lista_cortada).toBeUndefined();
  });

  it("acima do teto de leitura (5 mil): diz que cortou, em vez de dar o retrato por inteiro", async () => {
    const c = await preparar();
    c.tabela("mia_obrigacoes").push(...Array.from({ length: 5_001 }, (_, i) => obrigacao(i)));

    const retrato = await c.chamar("plataforma_ver_obrigacoes", { situacao: "todas" });

    expect(retrato).toMatchObject({ lista_cortada: true, de: 5_000 });
    expect(String(retrato.aviso)).toContain("5001 no banco");
  });
});

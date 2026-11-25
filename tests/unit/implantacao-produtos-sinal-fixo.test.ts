/**
 * FORK MIA — `garantirProdutos` (MCP de implantação) leva a porta do sinal fixo.
 *
 * O upstream 1.119 (#3480, catálogo de serviços) pôs no PATCH de
 * `app/api/v1/products/[id]/route.ts` uma regra: com o módulo de serviços
 * ligado, o preço de um serviço (ou variação dele) não fica abaixo do sinal
 * FIXO da família. O MCP atualiza o preço de produto que já existe, então o
 * espelho em `lib/implantacao/produtos.ts` levou a mesma regra. Este arquivo
 * prova os quatro caminhos, no modelo de `app/api/v1/products/[id]/route.test.ts`:
 *
 *  - módulo desligado (o padrão do fork): o sinal nem é consultado;
 *  - preço novo abaixo do sinal: o item sai `recusado` e nada é gravado;
 *  - preço igual ou acima do sinal: grava;
 *  - a conferência do sinal falha: a chamada lança e nada é gravado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/instalacao/modulos", () => ({
  moduloLigado: vi.fn(async () => false),
  modulosLigados: vi.fn(async () => []),
}));
vi.mock("@/lib/catalogo/servicos-supabase", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sinaisFixosQueTravamPreco: vi.fn(async () => new Map()),
}));

const { moduloLigado } = await import("@/lib/instalacao/modulos");
const { MODULO_SERVICOS, sinaisFixosQueTravamPreco } = await import("@/lib/catalogo/servicos-supabase");
const { garantirProdutos } = await import("@/lib/implantacao/produtos");

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const CODIGO = "CORTE-01";

/** O que o `update` gravou nesta chamada (vazio = nada foi gravado). */
let gravados: Array<Record<string, unknown>> = [];

/**
 * Um `catalog_products` com um produto só, já cadastrado com preço 50.000
 * centavos. Responde às três formas que o caminho do produto existente usa:
 * a lista paginada de códigos, a leitura das linhas atuais e o update.
 */
function adminFalso(): SupabaseClient {
  const atual = {
    id: ID,
    codigo: CODIGO,
    nome: "Corte",
    descricao: null,
    marca: null,
    categoria: null,
    capacidade: null,
    preco_cents: 50_000,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: false,
    quantidade: 0,
    ativo: true,
    origem: "implantacao",
    imagem_url: null,
    fotos: [],
    updated_at: "2026-11-19T00:00:00Z",
  };
  return {
    from(tabela: string) {
      expect(tabela).toBe("catalog_products");
      return {
        select() {
          const filtro = {
            eq: () => filtro,
            order: () => filtro,
            // A lista de códigos: uma página com o produto, depois a página vazia.
            range: async (de: number) => ({ data: de === 0 ? [{ codigo: CODIGO }] : [], error: null }),
            // As linhas atuais dos que já existem.
            in: async () => ({ data: [atual], error: null }),
          };
          return filtro;
        },
        update(patch: Record<string, unknown>) {
          const filtro = {
            eq: () => filtro,
            then: (ok: (v: { error: null }) => unknown) => {
              gravados.push(patch);
              return Promise.resolve({ error: null }).then(ok);
            },
          };
          return filtro;
        },
        insert: async () => {
          throw new Error("este teste só cobre o produto que já existe");
        },
      };
    },
  } as unknown as SupabaseClient;
}

function implantacao() {
  return { admin: adminFalso(), orgId: ORG_ID, autorUserId: "u-1", requestId: "r-1" };
}

beforeEach(() => {
  gravados = [];
  vi.mocked(moduloLigado).mockReset().mockResolvedValue(false);
  vi.mocked(sinaisFixosQueTravamPreco).mockReset().mockResolvedValue(new Map());
});

describe("garantirProdutos — o preço do produto que já existe contra o sinal fixo do serviço", () => {
  it("módulo desligado: o sinal não é consultado e o preço novo grava", async () => {
    const r = await garantirProdutos(implantacao(), [{ codigo: CODIGO, nome: "Corte", preco_cents: 10_000 }]);
    expect(moduloLigado).toHaveBeenCalledWith(expect.anything(), MODULO_SERVICOS);
    expect(sinaisFixosQueTravamPreco).not.toHaveBeenCalled();
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(gravados).toEqual([{ preco_cents: 10_000 }]);
  });

  it("⭐ módulo ligado: preço abaixo do sinal fixo sai recusado, e nada é gravado", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(true);
    vi.mocked(sinaisFixosQueTravamPreco).mockResolvedValue(new Map([[ID, 30_000]]));
    const r = await garantirProdutos(implantacao(), [{ codigo: CODIGO, nome: "Corte", preco_cents: 29_999 }]);
    expect(sinaisFixosQueTravamPreco).toHaveBeenCalledWith(expect.anything(), ORG_ID, [ID]);
    expect(r.itens[0]).toMatchObject({ desfecho: "recusado", motivo: expect.stringMatching(/sinal fixo/) });
    expect(r.recusados).toBe(1);
    expect(gravados).toEqual([]);
  });

  it("módulo ligado: preço igual ao sinal grava", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(true);
    vi.mocked(sinaisFixosQueTravamPreco).mockResolvedValue(new Map([[ID, 30_000]]));
    const r = await garantirProdutos(implantacao(), [{ codigo: CODIGO, nome: "Corte", preco_cents: 30_000 }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(gravados).toEqual([{ preco_cents: 30_000 }]);
  });

  it("módulo ligado: preço acima do sinal grava", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(true);
    vi.mocked(sinaisFixosQueTravamPreco).mockResolvedValue(new Map([[ID, 30_000]]));
    const r = await garantirProdutos(implantacao(), [{ codigo: CODIGO, nome: "Corte", preco_cents: 45_000 }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(gravados).toEqual([{ preco_cents: 45_000 }]);
  });

  it("módulo ligado: a conferência do sinal falha, a chamada lança e nada é gravado", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(true);
    vi.mocked(sinaisFixosQueTravamPreco).mockRejectedValue(new Error("boom"));
    await expect(
      garantirProdutos(implantacao(), [{ codigo: CODIGO, nome: "Corte", preco_cents: 45_000 }]),
    ).rejects.toThrow(/não consegui conferir o sinal fixo dos serviços: boom/);
    expect(gravados).toEqual([]);
  });
});

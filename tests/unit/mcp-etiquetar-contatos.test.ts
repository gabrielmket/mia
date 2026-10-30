/**
 * FORK MIA (.97) — `plataforma_etiquetar_contatos`: a mesma função da tela de
 * Contatos, pelo MCP de plataforma.
 *
 * Quem entra no filtro é o `listContactsHandler` (coberto pelos testes da lista);
 * aqui se prende a escrita: a organização, o filtro esquecido, o que não pode mudar
 * (anonimizado) e o andar por partes.
 *
 *     npx vitest run --project produto tests/unit/mcp-etiquetar-contatos.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";
import { etiquetarContatos, TETO_POR_CHAMADA } from "@/lib/implantacao/etiquetar-contatos";
import { FERRAMENTAS_DE_ETIQUETAS_E_MEMORIA } from "@/lib/mcp-plataforma/ferramentas/etiquetas-e-memoria";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

vi.mock("@/app/api/v1/contacts/_handler", () => ({ listContactsHandler: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const AUTOR = "55555555-5555-4555-8555-555555555555";

function contato(id: string, tags: string[], over: Linha = {}): Linha {
  return { id, organization_id: ORG, tags, is_anonymized: false, ...over };
}

function cenario(contatos: Linha[], total = contatos.length) {
  const banco = postgrestComTeto({ contacts: contatos });
  // A lista de mentira só fatia: o filtro de verdade é testado na lista.
  vi.mocked(listContactsHandler).mockImplementation(async (_db, _ctx, raw, _so, opcoes) => {
    if (opcoes?.comTotal) return { contacts: [], cursor: null, has_more: false, total };
    const de = raw.cursor ? Number(raw.cursor) : 0;
    const limite = Number(raw.limit);
    const pagina = banco.tabelas.contacts!.slice(de, de + limite);
    const proximo = de + limite;
    const temMais = proximo < banco.tabelas.contacts!.length;
    return { contacts: pagina as never, cursor: temMais ? String(proximo) : null, has_more: temMais };
  });
  return { banco, c: { admin: banco.cliente as never, orgId: ORG, autorUserId: AUTOR, requestId: REQ } };
}

const tagsDe = (banco: ReturnType<typeof postgrestComTeto>, id: string) =>
  banco.tabelas.contacts!.find((l) => l.id === id)?.tags;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plataforma_etiquetar_contatos", () => {
  it("põe a etiqueta em minúsculas, sem repetir em quem já tem", async () => {
    const { banco, c } = cenario([contato("c-1", ["vip"]), contato("c-2", ["lista de outubro"])]);

    const r = await etiquetarContatos(c, { etiqueta: "Lista de Outubro", filtro: { origem: "import_csv" } });

    expect(r).toMatchObject({ total_do_filtro: 2, processados: 2, alterados: 1, ja_estavam: 1, continua: false });
    expect(tagsDe(banco, "c-1")).toEqual(["vip", "lista de outubro"]);
    expect(tagsDe(banco, "c-2")).toEqual(["lista de outubro"]);
  });

  it("repetir não muda nada", async () => {
    const { banco, c } = cenario([contato("c-1", [])]);

    await etiquetarContatos(c, { etiqueta: "x", toda_a_base: true });
    const r = await etiquetarContatos(c, { etiqueta: "x", toda_a_base: true });

    expect(r).toMatchObject({ alterados: 0, ja_estavam: 1 });
    expect(tagsDe(banco, "c-1")).toEqual(["x"]);
  });

  it("remover tira a etiqueta sem olhar maiúscula", async () => {
    const { banco, c } = cenario([contato("c-1", ["vip", "outra"])]);

    const r = await etiquetarContatos(c, { etiqueta: "VIP", acao: "remover", toda_a_base: true });

    expect(r).toMatchObject({ alterados: 1 });
    expect(tagsDe(banco, "c-1")).toEqual(["outra"]);
  });

  it("apenas_contar não grava", async () => {
    const { banco, c } = cenario([contato("c-1", [])], 565);

    const r = await etiquetarContatos(c, { etiqueta: "x", filtro: { etiquetas: ["vip"] }, apenas_contar: true });

    expect(r).toEqual({ total_do_filtro: 565, gravou_algo: false });
    expect(banco.escritas).toHaveLength(0);
  });

  it("sem filtro recusa: um filtro esquecido não vira a base inteira", async () => {
    const { banco, c } = cenario([contato("c-1", [])]);

    await expect(etiquetarContatos(c, { etiqueta: "x" })).rejects.toBeInstanceOf(Recusa);
    await expect(etiquetarContatos(c, { etiqueta: "x", filtro: { etiquetas: [] } })).rejects.toBeInstanceOf(Recusa);
    expect(banco.escritas).toHaveLength(0);
  });

  it("etiqueta vazia recusa", async () => {
    const { c } = cenario([]);
    await expect(etiquetarContatos(c, { etiqueta: "   ", toda_a_base: true })).rejects.toBeInstanceOf(Recusa);
  });

  it("anonimizado não é tocado (LGPD)", async () => {
    const { banco, c } = cenario([contato("c-1", [], { is_anonymized: true })]);

    const r = await etiquetarContatos(c, { etiqueta: "x", toda_a_base: true });

    expect(r).toMatchObject({ alterados: 0, anonimizados_ignorados: 1 });
    expect(banco.escritas).toHaveLength(0);
  });

  it("acima do teto da chamada: para com o cursor, e a repetição termina o resto", async () => {
    const contatos = Array.from({ length: TETO_POR_CHAMADA + 50 }, (_, i) => contato(`c-${i}`, []));
    const { c } = cenario(contatos);

    const primeira = await etiquetarContatos(c, { etiqueta: "x", toda_a_base: true });
    expect(primeira).toMatchObject({ processados: TETO_POR_CHAMADA, alterados: TETO_POR_CHAMADA, continua: true });

    const segunda = await etiquetarContatos(c, {
      etiqueta: "x",
      toda_a_base: true,
      cursor: (primeira as { cursor: string }).cursor,
    });
    expect(segunda).toMatchObject({ processados: 50, alterados: 50, continua: false, cursor: null });
  });

  it("a organização da gravação é a do cliente, e a lista lê a mesma", async () => {
    const { c } = cenario([contato("c-1", [])]);

    await etiquetarContatos(c, { etiqueta: "x", toda_a_base: true });

    expect(vi.mocked(listContactsHandler).mock.calls[0]![1]).toMatchObject({ organization_id: ORG });
  });

  it("a ferramenta pede a operação de base, e o exemplo só conta", () => {
    const ferramenta = FERRAMENTAS_DE_ETIQUETAS_E_MEMORIA.find((f) => f.name === "plataforma_etiquetar_contatos");
    expect(ferramenta?.operacao).toBe("importar_base");
    expect(ferramenta?.exemplo).toMatchObject({ apenas_contar: true });
  });
});

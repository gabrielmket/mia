/**
 * FORK MIA — UM LOTE DE 100 IDS PODE DEVOLVER MAIS DE 1000 LINHAS. MEDIDO.
 *
 * `buscaEmLotes` (do upstream) quebra a lista de ids em lotes de 100 para o
 * `.in()` caber na URL. Isso limita o PEDIDO, não a RESPOSTA: numa tabela com
 * várias linhas por id, um lote só passa de 1000 linhas, e o PostgREST corta ali
 * sem avisar.
 *
 * A medição: 100 negócios com 15 documentos cada são 1.500 obrigações num lote.
 * Com o `buscaEmLotes` chegam 1.000; os negócios que ficaram depois do corte
 * aparecem sem documento nenhum.
 *
 *     npx vitest run --project produto lib/leitura/em-lotes-sem-teto.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { contarComprasParaOQuadro } from "@/lib/cartoes/compras-servidor";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const negocio = (i: number) => `negocio-${String(i).padStart(4, "0")}`;

/** `porNegocio` documentos para cada um dos `negocios` negócios. */
function obrigacoes(negocios: number, porNegocio: number): Linha[] {
  return Array.from({ length: negocios * porNegocio }, (_, i) => ({
    id: `obrigacao-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    lead_id: negocio(Math.floor(i / porNegocio)),
    arquivado_em: null,
  }));
}

const idsDosNegocios = (quantos: number) => Array.from({ length: quantos }, (_, i) => negocio(i));

describe("ler por lista de ids, em lotes", () => {
  it("a medição: 100 negócios × 15 documentos = 1.500 linhas num lote, e o buscaEmLotes traz 1.000", async () => {
    const banco = postgrestComTeto({ mia_obrigacoes: obrigacoes(100, 15) });

    const antiga = await buscaEmLotes<Linha>(idsDosNegocios(100), (lote) =>
      banco.cliente.from("mia_obrigacoes").select("id, lead_id").eq("organization_id", ORG).in("lead_id", lote),
    );

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    // Um lote só (100 ids), uma ida, e 500 documentos a menos, sem erro nenhum.
    expect(banco.pedidosEm("mia_obrigacoes")).toBe(1);
    const negociosComDocumento = new Set(antiga.data.map((l) => l.lead_id));
    // 1.000 linhas ÷ 15 por negócio: os últimos 33 negócios ficaram sem NENHUM documento.
    expect(negociosComDocumento.size).toBe(67);
  });

  it("o mesmo lote, lido até o fim: os 1.500 documentos, dos 100 negócios", async () => {
    const banco = postgrestComTeto({ mia_obrigacoes: obrigacoes(100, 15) });

    const lida = await buscaEmLotesSemTeto<Linha>(idsDosNegocios(100), (lote, contagem) =>
      banco.cliente.from("mia_obrigacoes").select("id, lead_id", contagem).eq("organization_id", ORG).in("lead_id", lote),
    );

    expect(lida).toMatchObject({ error: null, truncado: false });
    expect(lida.data).toHaveLength(1_500);
    expect(new Set(lida.data.map((l) => l.id)).size).toBe(1_500);
    expect(new Set(lida.data.map((l) => l.lead_id)).size).toBe(100);
    // Duas idas: 1000 + 500.
    expect(banco.pedidosEm("mia_obrigacoes")).toBe(2);
  });

  it("o lote que cabe numa página custa a MESMA ida de antes", async () => {
    const banco = postgrestComTeto({ mia_obrigacoes: obrigacoes(250, 3) });

    const lida = await buscaEmLotesSemTeto<Linha>(idsDosNegocios(250), (lote, contagem) =>
      banco.cliente.from("mia_obrigacoes").select("id, lead_id", contagem).eq("organization_id", ORG).in("lead_id", lote),
    );

    expect(lida.data).toHaveLength(750);
    // 250 ids = 3 lotes, uma ida cada: a contagem da primeira página prova o fim.
    expect(banco.pedidosEm("mia_obrigacoes")).toBe(3);
  });

  it("lista vazia: nenhuma ida ao banco", async () => {
    const banco = postgrestComTeto({ mia_obrigacoes: obrigacoes(10, 2) });

    const lida = await buscaEmLotesSemTeto<Linha>([], (lote, contagem) =>
      banco.cliente.from("mia_obrigacoes").select("id", contagem).in("lead_id", lote),
    );

    expect(lida).toEqual({ data: [], error: null, truncado: false });
    expect(banco.pedidos).toEqual([]);
  });

  it("um lote que falha: devolve o erro, e não as linhas dos outros lotes", async () => {
    const banco = postgrestComTeto(
      { mia_obrigacoes: obrigacoes(250, 3) },
      { falhaEm: (pedido) => (pedido === 2 ? "statement timeout" : null) },
    );

    const lida = await buscaEmLotesSemTeto<Linha>(idsDosNegocios(250), (lote, contagem) =>
      banco.cliente.from("mia_obrigacoes").select("id", contagem).eq("organization_id", ORG).in("lead_id", lote),
    );

    expect(lida).toEqual({ data: [], error: { message: "statement timeout" }, truncado: false });
  });
});

describe("as compras no cartão do quadro", () => {
  it("100 pessoas com 12 pedidos cada: cada uma aparece com as 12 compras (e não as que couberam em 1000 linhas)", async () => {
    const pessoas = Array.from({ length: 100 }, (_, i) => `contato-${String(i).padStart(4, "0")}`);
    const banco = postgrestComTeto({
      contacts: [],
      crm_leads: [],
      orders: pessoas.flatMap((contactId, p) =>
        Array.from({ length: 12 }, (_, i) => ({
          id: `pedido-${String(p).padStart(4, "0")}-${String(i).padStart(2, "0")}`,
          organization_id: ORG,
          contact_id: contactId,
          status: "paid",
          total_cents: 10_000,
          currency: "BRL",
        })),
      ),
    });

    const compras = await contarComprasParaOQuadro(banco.cliente as never, ORG, { contatoIds: pessoas, empresaIds: [] });

    expect(compras.porContato.size).toBe(100);
    for (const contactId of pessoas) {
      expect(compras.porContato.get(contactId)).toMatchObject({ quantidade: 12, totalCents: 120_000 });
    }
  });
});

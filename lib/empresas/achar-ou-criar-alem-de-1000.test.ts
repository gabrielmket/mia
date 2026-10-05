/**
 * FORK MIA — A EMPRESA QUE JÁ EXISTE É ACHADA, MESMO DEPOIS DA MILÉSIMA.
 *
 * `acharOuCriarEmpresa` lia as empresas da organização com `.limit(5_000)` e
 * comparava os nomes em memória. O PostgREST corta em 1000 linhas sem avisar:
 * a partir da 1001ª empresa, o nome que já existia não era achado e nascia uma
 * ficha repetida, que é exatamente o defeito que este módulo existe para
 * evitar ("Padaria do Zé" pela quinta vez, e ninguém percebe).
 *
 *     npx vitest run --project produto lib/empresas/achar-ou-criar-alem-de-1000.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { acharOuCriarEmpresa, nomeComparavel } from "@/lib/empresas/achar-ou-criar";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";

function empresa(i: number, over: Linha = {}): Linha {
  return {
    id: `empresa-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    nome: `Comércio Fictício ${i} Ltda`,
    mesclada_em: null,
    ...over,
  };
}

const base = (quantas: number, extras: Linha[] = []) =>
  postgrestComTeto({ crm_empresas: [...Array.from({ length: quantas }, (_, i) => empresa(i)), ...extras] });

describe("achar ou criar a empresa que o cliente disse", () => {
  it("2.500 empresas, e a dita é a 2.400ª: acha a que existe e não cria outra", async () => {
    const banco = base(2_500);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "comercio ficticio 2399");

    expect(r).toEqual({ ok: true, empresaId: "empresa-002399", criada: false, nome: "Comércio Fictício 2399 Ltda" });
    expect(banco.escritas).toEqual([]);
    expect(banco.tabelas.crm_empresas).toHaveLength(2_500);
  });

  it("controle negativo: a leitura antiga (.limit(5_000)) via 1000 empresas, não achava a 2.400ª e criaria a repetida", async () => {
    const banco = base(2_500);

    const antiga = await banco.cliente
      .from("crm_empresas")
      .select("id, nome")
      .eq("organization_id", ORG)
      .is("mesclada_em", null)
      .limit(5_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const comparavel = nomeComparavel("comercio ficticio 2399");
    expect((antiga.data ?? []).some((e) => nomeComparavel(String(e.nome)) === comparavel)).toBe(false);
  });

  it("nome que não existe entre 2.500: cria, com o nome como a pessoa disse", async () => {
    const banco = base(2_500);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Oficina Nova do Bairro");

    expect(r).toMatchObject({ ok: true, criada: true, nome: "Oficina Nova do Bairro" });
    expect(banco.escritas).toEqual([{ tabela: "crm_empresas", op: "insert", linhas: 1, recusada: false }]);
  });

  it("ficha já fundida (lápide) não casa, nem depois da milésima", async () => {
    const banco = base(2_000, [empresa(9_000, { nome: "Padaria Antiga", mesclada_em: "2026-09-01T12:00:00.000Z" })]);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "padaria antiga");

    expect(r).toMatchObject({ ok: true, criada: true });
  });

  it("acima do teto de leitura e sem achar: NÃO cria (não dá para provar que não existe)", async () => {
    // 5.001 empresas vivas; a dita NÃO está entre as 5.000 lidas (ordem por id).
    const banco = base(5_001);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Empresa Que Pode Estar na 5001");

    expect(r).toEqual({ ok: false, motivo: "erro", detalhe: "lista de empresas acima do teto de leitura" });
    expect(banco.escritas).toEqual([]);
  });

  it("acima do teto de leitura, mas a dita está entre as lidas: devolve a que existe", async () => {
    const banco = base(5_001);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "COMÉRCIO FICTÍCIO 42");

    expect(r).toMatchObject({ ok: true, criada: false, empresaId: "empresa-000042" });
  });

  it("leitura que falha no meio: erro, e nenhuma empresa criada", async () => {
    const banco = postgrestComTeto(
      { crm_empresas: Array.from({ length: 2_500 }, (_, i) => empresa(i)) },
      { falhaEm: (pedido) => (pedido === 2 ? "statement timeout" : null) },
    );

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Oficina Nova do Bairro");

    expect(r).toEqual({ ok: false, motivo: "erro", detalhe: "statement timeout" });
    expect(banco.escritas).toEqual([]);
  });
});

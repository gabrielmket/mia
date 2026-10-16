/**
 * FORK MIA — A EMPRESA QUE JÁ EXISTE É ACHADA, MESMO DEPOIS DA MILÉSIMA.
 *
 * `acharOuCriarEmpresa` lia as empresas da organização com `.limit(5_000)` e
 * comparava os nomes em memória. O PostgREST corta em 1000 linhas sem avisar:
 * a partir da 1001ª empresa, o nome que já existia não era achado e nascia uma
 * ficha repetida, que é exatamente o defeito que este módulo existe para
 * evitar ("Padaria do Zé" pela quinta vez, e ninguém percebe).
 *
 * Desde a .79 (empresa única) a leitura é em `companies` (o cadastro do
 * upstream) e a criação é pela porta `fn_mia_gravar_empresa` (9034), imitada
 * aqui pelo `rpc` do dublê. Nome PARECIDO usa a existente (decisão do
 * protótipo: "o agente sempre usa a existente").
 *
 *     npx vitest run --project produto lib/empresas/achar-ou-criar-alem-de-1000.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { acharOuCriarEmpresa, nomeComparavel } from "@/lib/empresas/achar-ou-criar";
import { postgrestComTeto, type Linha, type OpcoesDoDuble } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";

function empresa(i: number, over: Linha = {}): Linha {
  return {
    id: `empresa-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    trade_name: `Comércio Fictício ${i} Ltda`,
    legal_name: null,
    normalized_cnpj: null,
    created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    ...over,
  };
}

/** A porta da 9034, no que importa aqui: cria a empresa com o nome dito. */
const gravarEmpresa: NonNullable<OpcoesDoDuble["rpc"]> = (nome, args, tabelas, escritas) => {
  if (nome !== "fn_mia_gravar_empresa") return { data: null, error: { message: `rpc inesperada: ${nome}` } };
  const dados = args.p_dados as { nome: string };
  const id = `nova-${(tabelas.companies ?? []).length + 1}`;
  (tabelas.companies ??= []).push({ id, organization_id: args.p_organization_id, trade_name: dados.nome, legal_name: null, normalized_cnpj: null });
  escritas.push({ tabela: "companies", op: "insert", linhas: 1, recusada: false });
  return { data: { id, criada: true }, error: null };
};

const base = (quantas: number, extras: Linha[] = [], opcoes: OpcoesDoDuble = {}) =>
  postgrestComTeto({ companies: [...Array.from({ length: quantas }, (_, i) => empresa(i)), ...extras] }, { rpc: gravarEmpresa, ...opcoes });

describe("achar ou criar a empresa que o cliente disse", () => {
  it("2.500 empresas, e a dita é a 2.400ª: acha a que existe e não cria outra", async () => {
    const banco = base(2_500);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "comercio ficticio 2399");

    expect(r).toEqual({ ok: true, empresaId: "empresa-002399", criada: false, nome: "Comércio Fictício 2399 Ltda" });
    expect(banco.escritas).toEqual([]);
    expect(banco.tabelas.companies).toHaveLength(2_500);
  });

  it("controle negativo: a leitura antiga (.limit(5_000)) via 1000 empresas, não achava a 2.400ª e criaria a repetida", async () => {
    const banco = base(2_500);

    const antiga = await banco.cliente.from("companies").select("id, trade_name").eq("organization_id", ORG).limit(5_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const comparavel = nomeComparavel("comercio ficticio 2399");
    expect((antiga.data ?? []).some((e) => nomeComparavel(String(e.trade_name)) === comparavel)).toBe(false);
  });

  it("nome que não existe entre 2.500: cria pela porta da 9034, com o nome como a pessoa disse", async () => {
    const banco = base(2_500);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Oficina Nova do Bairro");

    expect(r).toMatchObject({ ok: true, criada: true, nome: "Oficina Nova do Bairro" });
    expect(banco.escritas).toEqual([{ tabela: "companies", op: "insert", linhas: 1, recusada: false }]);
  });

  it("nome PARECIDO com uma que existe: usa a existente (o agente não cria a segunda ficha)", async () => {
    const banco = base(10, [empresa(9_000, { id: "trigo", trade_name: "Padaria Trigo Dourado" })]);

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Trigo Dourado Panificadora");

    expect(r).toEqual({ ok: true, empresaId: "trigo", criada: false, nome: "Padaria Trigo Dourado", parecida: true });
    expect(banco.escritas).toEqual([]);
  });

  it("empresa juntada a outra saiu do cadastro (a lápide mora ao lado): o nome dela não casa", async () => {
    const banco = postgrestComTeto(
      {
        companies: Array.from({ length: 2_000 }, (_, i) => empresa(i)),
        mia_companies_mescladas: [{ id: "antiga", organization_id: ORG, nome: "Padaria Antiga", mesclada_com: "empresa-000001" }],
      },
      { rpc: gravarEmpresa },
    );

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "padaria antiga");

    expect(r).toMatchObject({ ok: true, criada: true });
  });

  it("acima do teto de leitura e sem achar: NÃO cria (não dá para provar que não existe)", async () => {
    // 5.001 empresas; a dita NÃO está entre as 5.000 lidas (ordem por id).
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
    const banco = base(2_500, [], { falhaEm: (pedido) => (pedido === 2 ? "statement timeout" : null) });

    const r = await acharOuCriarEmpresa(banco.cliente as never, ORG, "Oficina Nova do Bairro");

    expect(r).toEqual({ ok: false, motivo: "erro", detalhe: "statement timeout" });
    expect(banco.escritas).toEqual([]);
  });
});

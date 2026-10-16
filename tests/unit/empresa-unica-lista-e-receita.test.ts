/**
 * FORK MIA (.79) · EMPRESA ÚNICA — a lista da tela, o "parece a mesma" e a
 * consulta à Receita (protótipo aprovado em 15/10/2026).
 *
 * O que se mede aqui:
 *   · "parece a mesma" com os casos que o protótipo mediu (nome sem CNPJ não
 *     bloqueia: a tela avisa, o agente usa a existente, a lista marca);
 *   · a lista lê TODAS as empresas (cadastro único, `companies`) e os quatro
 *     filtros valem para a organização inteira, não para a página;
 *   · a consulta à Receita: a trava da demonstração vem ANTES da rede, e o
 *     quadro de sócios não é guardado.
 *
 * A prova das regras no banco de verdade é tests/invariants/empresa-unica.test.ts.
 * Todo dado é fictício.
 *
 *     npx vitest run --project produto tests/unit/empresa-unica-lista-e-receita.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import type { BrasilApiClient } from "@/lib/brasil-api/client";
import { casaComABusca, montarListaDeEmpresas } from "@/lib/empresas/lista";
import { duplicadasPossiveis, pareceAMesma, saoParecidas } from "@/lib/empresas/parecida";
import { consultarReceita, semSocios } from "@/lib/empresas/receita";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "33333333-3333-4333-8333-333333333333";
const OUTRA = "44444444-4444-4444-8444-444444444444";

describe("parece a mesma empresa? (empresa sem CNPJ)", () => {
  it.each([
    ["Trigo Dourado Panificadora", "Padaria Trigo Dourado", true],
    ["Sabor da Serra Restaurante", "Restaurante Sabor da Serra", true],
    // Uma palavra que conta só ("sul" tem três letras): basta ela.
    ["Rota Sul", "Transportes Rota Sul Ltda", true],
    ["Rota Norte", "Transportes Rota Sul", false],
    ["Transportes Rota Sul", "Rota Sul Transportes ME", true],
    ["Studio Lumi", "Mercadinho Boa Praça", false],
    ["Padaria", "Padaria Trigo Dourado", true],
    ["Ltda", "Padaria Trigo Dourado", false],
  ])("%s x %s → %s", (novo, existente, esperado) => {
    expect(pareceAMesma(novo, existente)).toBe(esperado);
  });

  it("a lista pergunta nos dois sentidos", () => {
    expect(pareceAMesma("Padaria Trigo Dourado", "Trigo")).toBe(false);
    expect(saoParecidas("Padaria Trigo Dourado", "Trigo Dourado")).toBe(true);
  });

  it("só a empresa SEM CNPJ vira possível duplicada; duas com CNPJ são empresas diferentes", () => {
    const dup = duplicadasPossiveis([
      { id: "a", nome: "Padaria Trigo Dourado", cnpj: null },
      { id: "b", nome: "Trigo Dourado Panificadora", cnpj: "11222333000181" },
      { id: "c", nome: "Transportes Rota Sul", cnpj: "11222333000262" },
      { id: "d", nome: "Rota Sul Transportes", cnpj: "11222333000343" },
    ]);
    expect([...dup.keys()].sort()).toEqual(["a", "b"]);
    expect(dup.get("a")!.id).toBe("b");
    expect(dup.get("b")!.id).toBe("a");
  });

  it("a busca casa nome, razão social e os dígitos do CNPJ", () => {
    const e = { nome: "Padaria Trigo Dourado", razao_social: "Trigo Dourado Alimentos Ltda", cnpj: "11.222.333/0001-81" };
    expect(casaComABusca(e, "trigo")).toBe(true);
    expect(casaComABusca(e, "ALIMENTOS")).toBe(true);
    expect(casaComABusca({ ...e, cnpj: "11222333000181" }, "222.333")).toBe(true);
    expect(casaComABusca(e, "oficina")).toBe(false);
    expect(casaComABusca(e, "   ")).toBe(true);
  });
});

function empresa(id: string, nome: string, cnpj: string | null, over: Linha = {}): Linha {
  return {
    id,
    organization_id: ORG,
    trade_name: nome,
    legal_name: null,
    cnpj: cnpj ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : null,
    normalized_cnpj: cnpj,
    extra: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function cenario(): Record<string, Linha[]> {
  return {
    companies: [
      empresa("e-trigo", "Padaria Trigo Dourado", null),
      empresa("e-trigo-2", "Trigo Dourado Panificadora", null),
      empresa("e-rota", "Transportes Rota Sul", "11222333000181"),
      empresa("e-lumi", "Studio Lumi", null),
      { ...empresa("e-vizinha", "Padaria da Vizinha", null), organization_id: OUTRA },
    ],
    crm_leads: [
      { id: "n1", organization_id: ORG, empresa_id: "e-rota", status: "open" },
      { id: "n2", organization_id: ORG, empresa_id: "e-rota", status: "open" },
      { id: "n3", organization_id: ORG, empresa_id: "e-lumi", status: "won" },
      { id: "n4", organization_id: OUTRA, empresa_id: "e-vizinha", status: "open" },
    ],
    company_people: [
      { id: "v1", organization_id: ORG, company_id: "e-rota", person_id: "p-ana", is_primary: false },
      { id: "v2", organization_id: ORG, company_id: "e-rota", person_id: "p-joao", is_primary: true },
      { id: "v3", organization_id: ORG, company_id: "e-trigo", person_id: "p-ana", is_primary: true },
    ],
    contacts: [
      { id: "c1", organization_id: ORG, person_id: "p-ana", name: "Ana Prado", display_name: null, is_merged_into: null, is_anonymized: false },
      { id: "c2", organization_id: ORG, person_id: "p-joao", name: "João Silva", display_name: null, is_merged_into: null, is_anonymized: false },
      // O segundo número do João: a pessoa conta UMA vez.
      { id: "c3", organization_id: ORG, person_id: "p-joao", name: "João S.", display_name: null, is_merged_into: null, is_anonymized: false },
    ],
    mia_obrigacoes: [],
  };
}

const lista = (filtro: "todas" | "abertos" | "semcnpj" | "dup", extra: { busca?: string; limit?: number; offset?: number } = {}) =>
  montarListaDeEmpresas(postgrestComTeto(cenario()).cliente as never, ORG, {
    filtro,
    limit: extra.limit ?? 50,
    offset: extra.offset ?? 0,
    busca: extra.busca,
    hoje: "2026-10-15" as never,
  });

describe("a lista de empresas da tela (cadastro único)", () => {
  it("todas: só as da organização, em ordem de nome, com pessoas, negócios abertos e quem parece quem", async () => {
    const r = await lista("todas");
    expect(r.total_da_organizacao).toBe(4);
    expect(r.linhas.map((l) => l.nome)).toEqual([
      "Padaria Trigo Dourado",
      "Studio Lumi",
      "Transportes Rota Sul",
      "Trigo Dourado Panificadora",
    ]);
    const rota = r.linhas.find((l) => l.id === "e-rota")!;
    expect(rota.negocios_abertos).toBe(2);
    // O principal vem primeiro; cada pessoa uma vez, pelo primeiro nome.
    expect(rota.pessoas).toEqual({ total: 2, nomes: ["João", "Ana"] });
    // O CNPJ da empresa única vem em dígitos; a tela formata.
    expect(rota.cnpj).toBe("11222333000181");
    expect(rota.parece_com).toBeNull();
    expect(r.linhas.find((l) => l.id === "e-trigo")!.parece_com).toEqual({ id: "e-trigo-2", nome: "Trigo Dourado Panificadora" });
    // A mesma pessoa (Ana) está em duas empresas.
    expect(r.linhas.find((l) => l.id === "e-trigo")!.pessoas.nomes).toEqual(["Ana"]);
  });

  it("os filtros valem para a organização inteira", async () => {
    expect((await lista("abertos")).linhas.map((l) => l.id)).toEqual(["e-rota"]);
    expect((await lista("semcnpj")).linhas.map((l) => l.id)).toEqual(["e-trigo", "e-lumi", "e-trigo-2"]);
    expect((await lista("dup")).linhas.map((l) => l.id)).toEqual(["e-trigo", "e-trigo-2"]);
  });

  it("a página corta DEPOIS do filtro, e o total diz quantas passaram", async () => {
    const r = await lista("semcnpj", { limit: 1, offset: 1 });
    expect(r.total).toBe(3);
    expect(r.linhas.map((l) => l.id)).toEqual(["e-lumi"]);
  });

  it("a busca entra antes do filtro", async () => {
    const r = await lista("todas", { busca: "dourado" });
    expect(r.linhas.map((l) => l.id)).toEqual(["e-trigo", "e-trigo-2"]);
  });
});

describe("a consulta à Receita (só pela tela, nunca na demonstração)", () => {
  const cnpj = "11.222.333/0001-81";
  const dbQue = (demonstracao: boolean | "erro") => ({
    rpc: vi.fn(async (nome: string) => {
      expect(nome).toBe("fn_mia_e_demonstracao");
      return demonstracao === "erro" ? { data: null, error: { message: "falhou" } } : { data: demonstracao, error: null };
    }),
  });
  const receitaQueResponde = (): BrasilApiClient & { lookupCnpj: ReturnType<typeof vi.fn> } => ({
    lookupCnpj: vi.fn(async () => ({
      ok: true as const,
      data: { cnpj: "11222333000181", razao_social: "TRANSPORTES ROTA SUL LTDA", nome_fantasia: "Rota Sul", uf: "MG" } as never,
      raw: { cnpj: "11222333000181", razao_social: "TRANSPORTES ROTA SUL LTDA", qsa: [{ nome_socio: "FULANO", cnpj_cpf_do_socio: "***123456**" }] },
    })),
  });

  it("empresa de demonstração: recusa ANTES de qualquer chamada de rede", async () => {
    const receita = receitaQueResponde();
    const r = await consultarReceita(dbQue(true) as never, ORG, cnpj, receita);
    expect(r).toMatchObject({ ok: false, motivo: "demonstracao" });
    expect(receita.lookupCnpj).not.toHaveBeenCalled();
  });

  it("não deu para confirmar que não é demonstração: também não consulta (falha fechada)", async () => {
    const receita = receitaQueResponde();
    const r = await consultarReceita(dbQue("erro") as never, ORG, cnpj, receita);
    expect(r).toMatchObject({ ok: false, motivo: "demonstracao" });
    expect(receita.lookupCnpj).not.toHaveBeenCalled();
  });

  it("CNPJ sem os 14 números: nem pergunta a trava", async () => {
    const db = dbQue(false);
    const r = await consultarReceita(db as never, ORG, "123", receitaQueResponde());
    expect(r).toMatchObject({ ok: false, motivo: "cnpj_invalido" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("empresa de verdade: consulta, devolve os campos e guarda a resposta SEM o quadro de sócios", async () => {
    const receita = receitaQueResponde();
    const r = await consultarReceita(dbQue(false) as never, ORG, cnpj, receita);
    expect(receita.lookupCnpj).toHaveBeenCalledWith("11222333000181");
    expect(r).toMatchObject({ ok: true, cnpj: "11.222.333/0001-81", normalizado: "11222333000181" });
    if (!r.ok) throw new Error("devia ter consultado");
    expect(r.campos).toMatchObject({ legal_name: "TRANSPORTES ROTA SUL LTDA", trade_name: "Rota Sul", state: "MG" });
    expect(r.bruta).not.toHaveProperty("qsa");
    expect(r.bruta).toMatchObject({ razao_social: "TRANSPORTES ROTA SUL LTDA" });
  });

  it("não encontrado e recusa da Receita viram frases da tela", async () => {
    const naoAchou: BrasilApiClient = { lookupCnpj: async () => ({ ok: false, code: "not_found", message: "x", status: 404 }) };
    const recusou: BrasilApiClient = { lookupCnpj: async () => ({ ok: false, code: "upstream_error", message: "x", status: 429 }) };
    expect(await consultarReceita(dbQue(false) as never, ORG, cnpj, naoAchou)).toMatchObject({ ok: false, motivo: "nao_encontrado" });
    expect(await consultarReceita(dbQue(false) as never, ORG, cnpj, recusou)).toMatchObject({
      ok: false,
      motivo: "falhou",
      mensagem: expect.stringContaining("alguns minutos"),
    });
  });

  it("semSocios tira só o qsa", () => {
    expect(semSocios({ a: 1, qsa: [] })).toEqual({ a: 1 });
    expect(semSocios(null)).toBeNull();
    expect(semSocios([1])).toBeNull();
  });
});

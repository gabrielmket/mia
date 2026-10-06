/**
 * FORK MIA — "NÃO CONSEGUI CONTAR" NÃO É "NÃO HÁ NENHUM".
 *
 * As contagens no banco (`count: "exact", head: true`) passam por
 * `contagemDaResposta`. Três casos: a contagem veio; o cliente ignorou a opção
 * e trouxe as linhas (o adaptador de Postgres dos invariantes do MCP, que não
 * tem teto de linhas); e não veio nada, que NÃO pode virar zero.
 *
 *     npx vitest run --project produto lib/leitura/contagem-da-resposta.test.ts
 */
import { describe, expect, it } from "vitest";

import { contagemDaResposta } from "@/lib/leitura/contagem-da-resposta";
import { contarNoBanco } from "@/lib/mcp-plataforma/contar";

describe("ler a contagem de uma resposta", () => {
  it("o PostgREST de verdade: `count` e nenhum corpo", () => {
    expect(contagemDaResposta({ count: 2_500, data: null })).toBe(2_500);
  });

  it("zero contado é zero, e não ausência", () => {
    expect(contagemDaResposta({ count: 0, data: null })).toBe(0);
  });

  it("cliente que ignora a opção e devolve as linhas (o adaptador dos invariantes): conta as linhas", () => {
    expect(contagemDaResposta({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] })).toBe(3);
    expect(contagemDaResposta({ count: null, data: [] })).toBe(0);
  });

  it("a contagem manda sobre as linhas, quando as duas vêm", () => {
    expect(contagemDaResposta({ count: 2_500, data: [{ id: "a" }] })).toBe(2_500);
  });

  it("nem contagem nem linhas: null, e NÃO zero", () => {
    expect(contagemDaResposta({ count: null, data: null })).toBeNull();
    expect(contagemDaResposta({})).toBeNull();
  });
});

describe("contar no banco (o checklist do MCP)", () => {
  const resposta = (r: { count?: number | null; data?: unknown; error?: { message: string } | null }) =>
    Promise.resolve({ error: null, ...r });

  it("devolve a contagem do banco", async () => {
    await expect(contarNoBanco(resposta({ count: 2_500, data: null }), "os produtos")).resolves.toBe(2_500);
  });

  it("aceita o cliente que devolve as linhas no lugar da contagem", async () => {
    await expect(contarNoBanco(resposta({ data: [{ id: "a" }, { id: "b" }] }), "os produtos")).resolves.toBe(2);
  });

  it("sem contagem e sem linhas: LANÇA, em vez de dizer que o catálogo está vazio", async () => {
    await expect(contarNoBanco(resposta({ count: null, data: null }), "os produtos")).rejects.toThrow(
      "não consegui contar os produtos: o banco não devolveu a contagem",
    );
  });

  it("erro do banco: LANÇA com o motivo", async () => {
    await expect(
      contarNoBanco(resposta({ count: null, data: null, error: { message: "statement timeout" } }), "os produtos"),
    ).rejects.toThrow("não consegui contar os produtos: statement timeout");
  });
});

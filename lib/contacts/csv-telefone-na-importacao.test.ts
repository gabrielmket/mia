/**
 * FORK MIA (.97) — A PLANILHA `name,phone,email` PERDIA O TELEFONE.
 *
 * Medido em produção em 29/10/2026: 565 linhas, 332 contatos gravados (os que
 * tinham e-mail), TODOS com `phone_number` vazio, e as linhas só com telefone de
 * fora. A causa está na primeira função deste caminho: `phone` não estava entre
 * os apelidos do cabeçalho. A coluna era ignorada em silêncio, a linha só com
 * telefone virava "linha sem telefone nem e-mail", e a linha com e-mail entrava
 * sem o número.
 *
 * Os telefones abaixo são fictícios, no formato exato que a planilha trazia.
 *
 *     npx vitest run --project produto lib/contacts/csv-telefone-na-importacao.test.ts
 */
import { describe, expect, it } from "vitest";

import { mapHeader, mapLinha, parseCsv } from "./csv";

const PLANILHA = [
  "name,phone,email",
  "Ana Teste,+5511900000001,ana@example.invalid",
  "Bia Teste,+55 (31) 900000002,",
  "Caio Teste,,caio@example.invalid",
].join("\n");

function lerPlanilha(texto: string) {
  const [cabecalho, ...linhas] = parseCsv(texto);
  const { indices, motivo } = mapHeader(cabecalho!);
  expect(motivo).toBeNull();
  return linhas.map((celulas) => mapLinha(celulas, indices));
}

describe("a planilha com o cabeçalho name,phone,email", () => {
  it("reconhece a coluna phone", () => {
    expect(mapHeader(["name", "phone", "email"]).indices).toEqual({ name: 0, phone_number: 1, email: 2 });
  });

  it("grava o telefone das linhas com e-mail, sem perder o e-mail", () => {
    const [ana] = lerPlanilha(PLANILHA);
    expect(ana).toEqual({
      contato: { name: "Ana Teste", phone_number: "+5511900000001", email: "ana@example.invalid" },
      motivo: null,
    });
  });

  it("aceita o telefone com espaço e parênteses, e a linha só com telefone entra", () => {
    const [, bia] = lerPlanilha(PLANILHA);
    expect(bia).toEqual({ contato: { name: "Bia Teste", phone_number: "+5531900000002" }, motivo: null });
  });

  it("a linha só com e-mail continua entrando", () => {
    const [, , caio] = lerPlanilha(PLANILHA);
    expect(caio).toEqual({ contato: { name: "Caio Teste", email: "caio@example.invalid" }, motivo: null });
  });
});

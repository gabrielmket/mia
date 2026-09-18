import { describe, expect, it } from "vitest";

import { apenasDigitos, empresaCreateSchema } from "./empresas";

/**
 * O CADASTRO DE EMPRESA NÃO PODE SER DIFÍCIL DE SALVAR.
 *
 * Quem cadastra está com o cliente na linha. Um formulário que recusa o nome
 * porque o CNPJ veio com pontuação, ou porque o dígito verificador não bate,
 * transforma "anotar o cliente novo" numa tarefa para depois — e a tarefa para
 * depois não acontece. Por outro lado, guardar o documento com máscara faria
 * `12.345.678/0001-90` e `12345678000190` serem duas empresas diferentes no
 * índice único, que é exatamente a duplicata que a tabela existe para evitar.
 *
 *     npx vitest run lib/schemas/empresas.test.ts
 */

describe("a ficha da empresa", () => {
  it("salva só com o nome — o resto chega depois", () => {
    const r = empresaCreateSchema.safeParse({ nome: "Padaria do Zé" });
    expect(
      r.success,
      "exigir mais que o nome adia o cadastro, e o cadastro adiado não acontece",
    ).toBe(true);
  });

  it("RECUSA nome vazio ou só espaço — é o único campo que identifica", () => {
    expect(empresaCreateSchema.safeParse({ nome: "   " }).success).toBe(false);
    expect(empresaCreateSchema.safeParse({}).success).toBe(false);
  });

  it("guarda o CNPJ sem máscara, venha como vier", () => {
    const r = empresaCreateSchema.safeParse({ nome: "X", cnpj: "12.345.678/0001-90" });
    expect(r.success).toBe(true);
    expect(
      r.success && r.data.cnpj,
      "com máscara no banco, o mesmo CNPJ digitado de dois jeitos vira duas empresas e o índice único não vê a duplicata",
    ).toBe("12345678000190");
  });

  it("RECUSA CNPJ com contagem errada de dígitos, mas NÃO confere dígito verificador", () => {
    expect(empresaCreateSchema.safeParse({ nome: "X", cnpj: "123" }).success).toBe(false);
    // DV propositalmente inválido: 14 dígitos passa.
    expect(
      empresaCreateSchema.safeParse({ nome: "X", cnpj: "11111111111111" }).success,
      "recusar por dígito verificador pararia o cadastro inteiro por causa do campo menos urgente da ficha",
    ).toBe(true);
  });

  it("aceita e-mail em branco — o campo é opcional, não um obstáculo", () => {
    expect(empresaCreateSchema.safeParse({ nome: "X", email: "" }).success).toBe(true);
    expect(empresaCreateSchema.safeParse({ nome: "X", email: "nao-e-email" }).success).toBe(false);
  });

  it("apenasDigitos limpa qualquer pontuação", () => {
    expect(apenasDigitos("12.345.678/0001-90")).toBe("12345678000190");
    expect(apenasDigitos("")).toBe("");
  });
});

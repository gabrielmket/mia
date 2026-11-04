/**
 * FORK MIA (.101) · OS TRECHOS ANONIMIZADOS DO RAIO-X (lib/raio-x/anonimizar.ts,
 * decisão 7): curtos, sem telefone, e-mail ou documento, nomes por [nome].
 * Dado fictício.
 */
import { describe, expect, it } from "vitest";

import {
  TAMANHO_DO_BALAO,
  anonimizarTexto,
  balaoAnonimizado,
  tirarIdentificadores,
  trechoCurto,
} from "@/lib/raio-x/anonimizar";

describe("os identificadores saem", () => {
  it("telefone em toda forma comum", () => {
    for (const tel of ["(31) 90000-1101", "+55 31 900000002", "31900001101", "90000-1101", "+5531900000002"]) {
      expect(tirarIdentificadores(`me liga no ${tel} por favor`), tel).toBe("me liga no [telefone] por favor");
    }
  });

  it("e-mail, CPF, CNPJ, CEP, placa e link", () => {
    expect(tirarIdentificadores("manda para ricardo.exemplo@exemplo.com.br")).toBe("manda para [e-mail]");
    expect(tirarIdentificadores("meu cpf 123.456.789-09")).toBe("meu cpf [documento]");
    expect(tirarIdentificadores("cnpj 12.345.678/0001-95")).toBe("cnpj [documento]");
    expect(tirarIdentificadores("cep 30130-010")).toBe("cep [cep]");
    expect(tirarIdentificadores("a placa é ABC1D23")).toBe("a placa é [placa]");
    expect(tirarIdentificadores("veja https://exemplo.com/carro?id=9")).toBe("veja [link]");
  });

  it("número curto de conversa fica (preço, ano, quilometragem)", () => {
    expect(tirarIdentificadores("Aceita meu Gol 2015 na troca? 98 mil km, R$ 89.900")).toBe(
      "Aceita meu Gol 2015 na troca? 98 mil km, R$ 89.900",
    );
  });
});

describe("os nomes viram [nome]", () => {
  it("o nome de perfil do cliente, em qualquer caixa", () => {
    expect(anonimizarTexto("aqui é o ricardo, tudo bem?", ["Ricardo Exemplo"])).toBe("aqui é o [nome], tudo bem?");
  });

  it("o nome depois de um gatilho, com o sobrenome junto", () => {
    expect(anonimizarTexto("Oi Josefina Sobrenomerara, tudo bem?")).toBe("Oi [nome], tudo bem?");
    expect(anonimizarTexto("Boa tarde! Me chamo Genoveva e quero saber o valor")).toBe(
      "Boa tarde! Me chamo [nome] e quero saber o valor",
    );
  });

  it("sem a flag de caixa: 'oi tudo bem' não perde a palavra seguinte", () => {
    expect(anonimizarTexto("oi tudo bem? ainda tem o carro?")).toBe("oi tudo bem? ainda tem o carro?");
  });

  it("prenome comum no meio da frase", () => {
    expect(anonimizarTexto("Falei com a Fernanda ontem e com o Ricardo")).toBe("Falei com a [nome] ontem e com o [nome]");
  });

  it("palavra comum com maiúscula fica", () => {
    expect(anonimizarTexto("Vi o anúncio do Polo no Instagram")).toBe("Vi o anúncio do Polo no Instagram");
  });
});

describe("o trecho é curto", () => {
  it("corta em palavra, com reticência, sem passar do tamanho", () => {
    const longo = "Bom dia, gostaria de saber se o carro ainda está disponível e se vocês aceitam troca. ".repeat(5);
    const t = trechoCurto(longo);
    expect(t.length).toBeLessThanOrEqual(TAMANHO_DO_BALAO);
    expect(t.endsWith("…")).toBe(true);
  });

  it("não deixa meio marcador no corte", () => {
    const t = trechoCurto(`${"a".repeat(170)} [telefone] fim`, 180);
    expect(t).not.toMatch(/\[[^\]]*…$/);
  });

  it("o balão limpa ANTES de cortar (cortar antes deixaria meio telefone)", () => {
    const b = balaoAnonimizado(`${"x ".repeat(85)}meu número é (31) 90000-1101`, []);
    expect(b).not.toMatch(/\d{4}/);
  });
});

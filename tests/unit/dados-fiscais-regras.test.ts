/**
 * FORK MIA (.96) — as regras dos dados fiscais (lib/dados-fiscais/regras.ts):
 * em nome de quem sai a cobrança e a nota. O que se prova:
 *   - empresa (CNPJ, inclusive o alfanumérico) e pessoa física (CPF), com o
 *     dígito verificador conferido e o tamanho do tipo;
 *   - o endereço obrigatório, o CEP de 8 números, a UF da lista;
 *   - o WhatsApp vira dígitos com o país; obrigatório só quando pedido;
 *   - a pessoa física não leva inscrição;
 *   - "Falta preencher" na ordem da tela.
 */
import { describe, expect, it } from "vitest";

import {
  conferirDadosFiscais,
  documentoMascarado,
  enderecoEmUmaLinha,
  faltasDosDadosFiscais,
  formatarCep,
  formatarDocumento,
  telefoneNormalizado,
} from "@/lib/dados-fiscais/regras";

const PJ = {
  tipo: "pj",
  documento: "11.222.333/0001-81",
  razao_social: "Clínica Exemplo Odontologia Ltda",
  cep: "30130-010",
  logradouro: "Avenida Afonso Pena",
  numero: "1500",
  complemento: "Sala 803",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "mg",
  inscricao_municipal: "123456",
  inscricao_estadual: "",
  telefone: "(31) 98888-0000",
};

describe("conferir os dados fiscais", () => {
  it("⭐ empresa: o CNPJ sai sem máscara, a UF em maiúscula, o CEP só com números, o WhatsApp com o país", () => {
    const r = conferirDadosFiscais(PJ, { exigeTelefone: true });
    expect(r).toEqual({
      ok: true,
      dados: {
        tipo: "pj",
        documento: "11222333000181",
        razao_social: "Clínica Exemplo Odontologia Ltda",
        cep: "30130010",
        logradouro: "Avenida Afonso Pena",
        numero: "1500",
        complemento: "Sala 803",
        bairro: "Centro",
        cidade: "Belo Horizonte",
        uf: "MG",
        inscricao_municipal: "123456",
        inscricao_estadual: null,
        telefone: "5531988880000",
      },
    });
  });

  it("pessoa física: CPF de 11 números e nenhuma inscrição, mesmo que a tela mande", () => {
    const r = conferirDadosFiscais({ ...PJ, tipo: "pf", documento: "529.982.247-25", razao_social: "Fulana de Tal" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.documento).toBe("52998224725");
      expect(r.dados.inscricao_municipal).toBeNull();
      expect(r.dados.inscricao_estadual).toBeNull();
    }
  });

  it("o CNPJ alfanumérico da Receita vale", () => {
    expect(conferirDadosFiscais({ ...PJ, documento: "12.ABC.345/01DE-35" }).ok).toBe(true);
  });

  it("dígito errado, CPF no lugar de CNPJ ou CNPJ no lugar de CPF: recusa o documento", () => {
    expect(conferirDadosFiscais({ ...PJ, documento: "11.222.333/0001-80" })).toMatchObject({ ok: false, campos: { documento: "invalido" } });
    expect(conferirDadosFiscais({ ...PJ, documento: "529.982.247-25" })).toMatchObject({ ok: false, campos: { documento: "invalido" } });
    expect(conferirDadosFiscais({ ...PJ, tipo: "pf" })).toMatchObject({ ok: false, campos: { documento: "invalido" } });
  });

  it("endereço incompleto: cada campo volta, e a frase segue a ordem da tela", () => {
    const r = conferirDadosFiscais({ ...PJ, documento: "", cep: "301", logradouro: " ", bairro: "", uf: "XX" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(faltasDosDadosFiscais(r.campos)).toEqual(["CPF ou CNPJ válido", "CEP", "rua", "bairro", "UF"]);
    }
  });

  it("o WhatsApp é obrigatório só quando pedido; um número que não é telefone é recusado", () => {
    expect(conferirDadosFiscais({ ...PJ, telefone: "" }).ok).toBe(true);
    expect(conferirDadosFiscais({ ...PJ, telefone: "" }, { exigeTelefone: true })).toMatchObject({ ok: false, campos: { telefone: "obrigatorio" } });
    expect(conferirDadosFiscais({ ...PJ, telefone: "123" })).toMatchObject({ ok: false, campos: { telefone: "invalido" } });
    expect(telefoneNormalizado("+55 31 98888-0000")).toBe("5531988880000");
    expect(telefoneNormalizado("3133334444")).toBe("553133334444");
  });

  it("sem tipo: recusa (a tela sempre manda empresa ou pessoa física)", () => {
    expect(conferirDadosFiscais({ ...PJ, tipo: undefined })).toMatchObject({ ok: false, campos: { tipo: "obrigatorio" } });
  });
});

describe("como os dados aparecem", () => {
  it("documento, CEP e endereço formatados; o documento mascarado esconde o meio", () => {
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
    expect(formatarCep("30130010")).toBe("30130-010");
    expect(documentoMascarado("11222333000181")).toBe("11.***.***/0001-81");
    expect(documentoMascarado("52998224725")).toBe("***.982.***-25");
    expect(
      enderecoEmUmaLinha({ logradouro: "Rua A", numero: "10", complemento: null, bairro: "Centro", cidade: "BH", uf: "MG", cep: "30130010" }),
    ).toBe("Rua A, 10 · Centro · BH/MG · 30130-010");
  });
});

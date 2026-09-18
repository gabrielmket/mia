import { describe, expect, it } from "vitest";

import { buildComponents } from "./build-components";
import { comNomeDeArquivo, comoMidia, idDeMidia, separarNomeDoArquivo } from "./midia-por-id";
import type { TemplateContract } from "./template-contract";

/**
 * MANDAR ARQUIVO SEM HOSPEDAR ARQUIVO.
 *
 * Para mandar uma imagem numa campanha, o operador precisava antes publicá-la
 * numa URL que os servidores da Meta conseguissem baixar. Quem não tem site
 * vira refém de um hospedeiro qualquer; quem tem, usa o link do Drive — que
 * devolve HTML em vez da imagem. Nos dois casos o erro (`131053`) chega DEPOIS
 * do disparo, com o crédito já gasto.
 *
 * O que estas provas seguram é a compatibilidade: a URL PRECISA continuar
 * funcionando exatamente como antes. Quem já monta campanha com link não pode
 * descobrir numa terça-feira que o campo mudou de idioma.
 *
 *     npx vitest run lib/channels/meta/midia-por-id.test.ts
 */

const contratoDeImagem: TemplateContract = {
  slots: [{ address: { kind: "header" }, key: "1", expects: "image" }],
} as unknown as TemplateContract;

const contratoDeDocumento: TemplateContract = {
  slots: [{ address: { kind: "header" }, key: "1", expects: "document" }],
} as unknown as TemplateContract;

describe("o valor do slot", () => {
  it("reconhece o id e devolve só ele", () => {
    expect(idDeMidia("meta-media:1234567890")).toBe("1234567890");
  });

  it("recusa id VAZIO — pior que URL nenhuma", () => {
    expect(
      idDeMidia("meta-media:"),
      "o envio sairia com {id: \"\"} e a Meta responderia um erro de parâmetro que não menciona mídia em lugar nenhum",
    ).toBeNull();
  });

  it("não confunde URL com id", () => {
    expect(idDeMidia("https://exemplo.com/foto.jpg")).toBeNull();
  });

  it("separa o nome do arquivo quando ele vem grudado", () => {
    expect(separarNomeDoArquivo("meta-media:123|proposta.pdf")).toEqual({
      valor: "meta-media:123",
      filename: "proposta.pdf",
    });
    expect(separarNomeDoArquivo("meta-media:123")).toEqual({
      valor: "meta-media:123",
      filename: null,
    });
  });

  it("monta e desmonta o mesmo valor", () => {
    const v = comNomeDeArquivo(comoMidia("999"), "contrato.pdf");
    const { valor, filename } = separarNomeDoArquivo(v);
    expect(idDeMidia(valor)).toBe("999");
    expect(filename).toBe("contrato.pdf");
  });
});

describe("o envio montado", () => {
  it("usa {id} quando o valor é um arquivo subido", () => {
    const comps = buildComponents(contratoDeImagem, { "header:1": "meta-media:777" });
    const p = (comps[0] as { parameters: Array<{ image: unknown }> }).parameters[0];
    expect(p!.image).toEqual({ id: "777" });
  });

  it("CONTINUA usando {link} quando é URL — quem já monta assim não perde nada", () => {
    const comps = buildComponents(
      contratoDeImagem,
      { "header:1": "https://exemplo.com/foto.jpg" },
    );
    const p = (comps[0] as { parameters: Array<{ image: unknown }> }).parameters[0];
    expect(
      p!.image,
      "o caminho antigo quebrou: toda campanha montada com link pararia de sair sem ninguém ter mexido nela",
    ).toEqual({ link: "https://exemplo.com/foto.jpg" });
  });

  it("leva o NOME no documento — anexo sem nome é anexo que ninguém abre", () => {
    const comps = buildComponents(
      contratoDeDocumento,
      { "header:1": "meta-media:555|proposta.pdf" },
    );
    const p = (comps[0] as { parameters: Array<{ document: unknown }> }).parameters[0];
    expect(p!.document).toEqual({ id: "555", filename: "proposta.pdf" });
  });

  it("documento por URL também aceita nome", () => {
    const comps = buildComponents(
      contratoDeDocumento,
      { "header:1": "https://exemplo.com/a.pdf|tabela.pdf" },
    );
    const p = (comps[0] as { parameters: Array<{ document: unknown }> }).parameters[0];
    expect(p!.document).toEqual({ link: "https://exemplo.com/a.pdf", filename: "tabela.pdf" });
  });
});

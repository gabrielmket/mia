/**
 * B2C NÃO VÊ EMPRESA — e B2B não perde nada (item C2).
 *
 * ── O que isto serve ──────────────────────────────────────────────────────
 *
 * A entidade empresa (0255, 0262, 0263) existe para quem vende PARA empresa.
 * Numa academia, numa clínica ou num salão a cliente é a pessoa, e ali a
 * entidade vira uma aba que ninguém abre, um campo em branco em todo cadastro
 * e — o que custa de verdade — uma IA que pergunta "de qual empresa você é?" a
 * alguém que quer marcar uma aula experimental.
 *
 * A tela sobrando o operador ignora. A pergunta errada o CLIENTE lê.
 *
 * ── O que estes casos protegem ────────────────────────────────────────────
 *
 * O risco desta feature é o OPOSTO do óbvio: não é deixar de esconder, é
 * esconder demais. Uma organização B2B que perdesse a aba por um valor não
 * carregado não reportaria "sumiu" — ela simplesmente deixaria de achar. Por
 * isso metade dos casos aqui mede que NADA some.
 */
import { describe, expect, it } from "vitest";

import {
  CAPACIDADES_DE_EMPRESA,
  lerModoDeVenda,
  mostraEmpresas,
  MODO_PADRAO,
  TELA_DE_EMPRESAS,
} from "@/lib/empresas/modo-de-venda";
import { destinosDaInterface } from "@/lib/navigation/interface";

const temEmpresas = (destinos: Array<{ href: string }>) =>
  destinos.some((d) => d.href === TELA_DE_EMPRESAS);

describe("o modo de venda da organização", () => {
  it("o padrão é o que NÃO tira nada de ninguém", () => {
    expect(
      MODO_PADRAO,
      "o padrão tem de ser o modo que mostra: um deploy que escondesse a aba " +
        "por padrão sumiria com uma tela sem ninguém pedir, e sumir é a mudança " +
        "que o usuário não reporta — ele só deixa de achar",
    ).toBe("b2b");
    expect(mostraEmpresas(MODO_PADRAO)).toBe(true);
  });

  it("lê o que está gravado, e não quebra com o que não está", () => {
    expect(lerModoDeVenda({ modo_de_venda: "b2c" })).toBe("b2c");
    expect(lerModoDeVenda({ modo_de_venda: "b2b" })).toBe("b2b");

    // `settings` editado à mão não pode derrubar o layout inteiro de /app.
    for (const lixo of [null, undefined, 42, "b2c", { modo_de_venda: "B2C" }, {}]) {
      expect(lerModoDeVenda(lixo), `lixo aceito: ${JSON.stringify(lixo)}`).toBe("b2b");
    }
  });
});

describe("a aba Empresas no menu", () => {
  it("some para quem vende direto para pessoas", () => {
    const destinos = destinosDaInterface(null, false, "admin", undefined, "b2c");
    expect(temEmpresas(destinos)).toBe(false);
  });

  it("fica para quem vende para empresas", () => {
    const destinos = destinosDaInterface(null, false, "admin", undefined, "b2b");
    expect(temEmpresas(destinos)).toBe(true);
  });

  it("NÃO some quando o modo não foi informado", () => {
    // O caso perigoso: o layout não carregou o valor, e a organização B2B perde
    // a aba sem ninguém ter mexido em nada. Mesma regra dos módulos.
    const destinos = destinosDaInterface(null, false, "admin", undefined, undefined);
    expect(
      temEmpresas(destinos),
      "esconder por não saber tira a tela de quem a usa",
    ).toBe(true);
  });

  it("o admin de PLATAFORMA continua vendo, mesmo num tenant B2C", () => {
    // É ele quem configura o modo, e precisa achar a tela para conferir o que o
    // cliente vê — a mesma regra que os módulos já aplicam.
    const destinos = destinosDaInterface(null, true, "admin", undefined, "b2c");
    expect(temEmpresas(destinos)).toBe(true);
  });

  it("esconder a aba não derruba mais nada do menu", () => {
    // Um filtro escrito com o `href` errado esvaziaria a barra inteira, e o
    // sintoma seria indistinguível de um problema de permissão.
    const comEmpresa = destinosDaInterface(null, false, "admin", undefined, "b2b");
    const semEmpresa = destinosDaInterface(null, false, "admin", undefined, "b2c");
    expect(semEmpresa.length).toBe(comEmpresa.length - 1);
    expect(
      semEmpresa.map((d) => d.href),
      "só a aba Empresas pode ter saído",
    ).toEqual(comEmpresa.map((d) => d.href).filter((h) => h !== TELA_DE_EMPRESAS));
  });

  it("a constante do href é a MESMA do catálogo de navegação", () => {
    // Duas cópias divergem na primeira renomeação, e o sintoma é a tela
    // VOLTANDO a aparecer para quem não a quer, em silêncio.
    const todos = destinosDaInterface(null, true, "admin");
    expect(
      todos.some((d) => d.href === TELA_DE_EMPRESAS),
      `\`${TELA_DE_EMPRESAS}\` não existe no catálogo de navegação — a rota foi ` +
        "renomeada e o modo B2C parou de esconder qualquer coisa",
    ).toBe(true);
  });
});

describe("as capacidades de empresa", () => {
  it("a lista não está vazia, e a que importa está nela", () => {
    // Lista vazia faria o filtro da rota passar tudo adiante sem sintoma —
    // exatamente o modo de falha que desliga a feature em silêncio.
    expect(CAPACIDADES_DE_EMPRESA.length).toBeGreaterThan(0);
    expect(CAPACIDADES_DE_EMPRESA).toContain("crm_registrar_empresa_do_contato");
  });

  it("toda capacidade listada existe de verdade no catálogo", async () => {
    // Nome errado aqui não quebra nada: ele simplesmente não filtra, e a IA de
    // uma academia continua oferecendo a pergunta sobre empresa.
    const { TOOL_CATALOG } = await import("@/lib/mcp/tools/catalog");
    const nomes = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const c of CAPACIDADES_DE_EMPRESA) {
      expect(nomes.has(c), `\`${c}\` não existe no catálogo de capacidades`).toBe(true);
    }
  });
});

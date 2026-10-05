/**
 * FORK MIA — o produto que entrou pela IMPLANTAÇÃO se edita na tela.
 *
 * O upstream 1.73 (#2288) pôs o botão Editar na tela Produtos, com uma regra
 * conservadora: `origem` que não seja "manual" nem "planilha" é tratada como
 * integração, e abre o formulário SOMENTE LEITURA com o aviso de que a próxima
 * sincronização sobrescreve (`sincronizadoDeOrigem`).
 *
 * O fork grava duas origens que o upstream não conhece: a do MCP de plataforma
 * (`plataforma_garantir_produtos`) e a das empresas de demonstração. Nenhuma é
 * integração. Sem a lista de `lib/catalogo/origens-do-fork.ts`, todo cliente
 * implantado por ferramenta ficaria com o catálogo inteiro trancado na tela.
 *
 * A lista não pode importar as constantes de quem grava (são módulos de
 * servidor, e a régua é lida por um componente de navegador), então os textos
 * estão repetidos lá. Este arquivo é o que impede a cópia de envelhecer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const { sincronizadoDeOrigem } = await import("@/lib/catalogo/edicao-do-produto");
const { ORIGENS_DO_FORK } = await import("@/lib/catalogo/origens-do-fork");
const { ORIGEM_DO_PRODUTO_DA_SEMENTE } = await import("@/lib/demonstracao/semente/aplicar");
const { ORIGEM_DA_IMPLANTACAO } = await import("@/lib/implantacao/produtos");

describe("a origem do produto e o botão Editar", () => {
  it("⭐ o que a implantação e a demonstração gravam NÃO é integração: o formulário abre editável", () => {
    expect(sincronizadoDeOrigem(ORIGEM_DA_IMPLANTACAO)).toBe(false);
    expect(sincronizadoDeOrigem(ORIGEM_DO_PRODUTO_DA_SEMENTE)).toBe(false);
  });

  it("a lista do fork é exatamente o que os dois escritores gravam, nos dois sentidos", () => {
    expect([...ORIGENS_DO_FORK].sort()).toEqual([ORIGEM_DO_PRODUTO_DA_SEMENTE, ORIGEM_DA_IMPLANTACAO].sort());
  });

  it("CONTROLE: a régua do upstream segue de pé (integração tranca; manual, planilha e vazio não)", () => {
    expect(sincronizadoDeOrigem("nuvemshop")).toBe(true);
    expect(sincronizadoDeOrigem("mercado_livre")).toBe(true);
    expect(sincronizadoDeOrigem("manual")).toBe(false);
    expect(sincronizadoDeOrigem("planilha")).toBe(false);
    expect(sincronizadoDeOrigem("")).toBe(false);
  });

  it("a lista continua sem import: ela chega ao navegador junto da régua", () => {
    const fonte = readFileSync(path.join(process.cwd(), "lib/catalogo/origens-do-fork.ts"), "utf8");
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\(/);
  });
});

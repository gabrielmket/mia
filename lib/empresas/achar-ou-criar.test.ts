import { describe, expect, it } from "vitest";

import { nomeComparavel } from "./achar-ou-criar";

/**
 * "PADARIA DO ZÉ LTDA" E "padaria do ze" SÃO O MESMO CLIENTE.
 *
 * O agente pergunta de qual empresa o cliente é e recebe texto livre. Se cada
 * grafia virasse uma ficha, a entidade empresa perderia a única coisa que a
 * justifica: poder responder quanto já vendemos para AQUELE cliente.
 *
 * E o erro é assimétrico — é por isso que a comparação é frouxa:
 *
 *  • Frouxo demais junta duas empresas parecidas. Aparece na ficha, alguém
 *    percebe, e separa; o histórico está todo lá.
 *  • Rígido demais cria "Padaria do Zé" pela quinta vez. NINGUÉM percebe: cinco
 *    fichas com uma conversa cada parecem cinco clientes — e a pergunta
 *    agregada passa a responder errado para sempre.
 *
 *     npx vitest run lib/empresas/achar-ou-criar.test.ts
 */

describe("o nome comparável", () => {
  it("junta as grafias que uma pessoa usaria para a MESMA empresa", () => {
    const esperado = nomeComparavel("Padaria do Zé");
    for (const variante of [
      "padaria do ze",
      "PADARIA DO ZÉ",
      "Padaria do Zé LTDA",
      "  Padaria   do  Zé  ",
      "Padaria do Zé ME",
    ]) {
      expect(
        nomeComparavel(variante),
        `"${variante}" viraria uma empresa separada — e a quinta conversa criaria a quinta ficha`,
      ).toBe(esperado);
    }
  });

  it("NÃO junta empresas que são mesmo diferentes", () => {
    expect(nomeComparavel("Padaria do Zé")).not.toBe(nomeComparavel("Padaria do João"));
    expect(nomeComparavel("Auto Peças Silva")).not.toBe(nomeComparavel("Auto Peças Souza"));
  });

  it("tira a pontuação que só atrapalha", () => {
    expect(nomeComparavel("J.H.S. Biomateriais")).toBe(nomeComparavel("JHS Biomateriais"));
  });

  it("devolve vazio para o que não identifica empresa nenhuma", () => {
    // É o que faz a ferramenta recusar em vez de criar uma ficha que ninguém
    // consegue procurar depois.
    expect(nomeComparavel("  ")).toBe("");
    expect(nomeComparavel("...")).toBe("");
    expect(nomeComparavel("ltda")).toBe("");
  });
});

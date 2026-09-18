import { describe, expect, it } from "vitest";

import { modeloDaPlataforma } from "./modelo-da-plataforma";

/**
 * A ESCOLHA DA PLATAFORMA NÃO PODE IMPEDIR UM CLIENTE DE ENTRAR NO AR.
 *
 * Este arquivo decide qual cérebro o agente usa, e a decisão é nossa. Mas ele
 * está no caminho da PRIMEIRA PUBLICAÇÃO de todo cliente novo — e aí a regra
 * que importa é outra: se a configuração não existe, se a migration ainda não
 * subiu, se a leitura falhou, o sistema volta ao comportamento de antes.
 *
 * Ausência faz cair para trás. Uma escolha nossa que ficou para depois nunca
 * pode virar cliente sem agente no ar.
 *
 *     npx vitest run lib/ai/modelo-da-plataforma.test.ts
 */

function admin(resposta: { data?: unknown; error?: unknown } | (() => never)) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (typeof resposta === "function") resposta();
            return resposta as { data: unknown; error: unknown };
          },
        }),
      }),
    }),
  } as never;
}

describe("o modelo escolhido no painel", () => {
  it("devolve o par quando alguém decidiu", async () => {
    const r = await modeloDaPlataforma(
      admin({ data: { provider: "openai", model_id: "gpt-4.1" }, error: null }),
    );
    expect(r).toEqual({ provider: "openai", modelId: "gpt-4.1" });
  });

  it("devolve null quando a linha não existe — e aí vale a escolha automática", async () => {
    expect(await modeloDaPlataforma(admin({ data: null, error: null }))).toBeNull();
  });

  it("devolve null com par pela metade, em vez de endereçar um provedor sem modelo", async () => {
    expect(
      await modeloDaPlataforma(admin({ data: { provider: "openai", model_id: null }, error: null })),
      "meio par publicaria no provedor certo com modelo nenhum",
    ).toBeNull();
  });

  it("NÃO lança quando a tabela nem existe — a migration pode não ter subido ainda", async () => {
    const r = await modeloDaPlataforma(
      admin(() => {
        throw new Error('relation "platform_ia" does not exist');
      }),
    );
    expect(
      r,
      "a exceção subiu: a primeira publicação de um cliente novo falharia por causa de uma tabela de configuração NOSSA",
    ).toBeNull();
  });

  it("devolve null em erro de leitura, em vez de propagar", async () => {
    expect(
      await modeloDaPlataforma(admin({ data: null, error: { message: "timeout" } })),
    ).toBeNull();
  });
});

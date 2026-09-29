import { describe, expect, it } from "vitest";

import { iaDoAgenteNovo, modeloDaPlataforma } from "./modelo-da-plataforma";

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

/**
 * FORK MIA — o par com que nasce o agente criado pelo CLIENTE, que não escolhe
 * IA. `platform_ia` responde pelo `maybeSingle`; `ai_models` pela lista.
 */
function adminComCatalogo(opcoes: {
  plataforma: { provider: string; model_id: string } | null;
  catalogo: Record<string, Array<Record<string, unknown>>>;
}) {
  const provedoresLidos: string[] = [];
  const cliente = {
    from: (tabela: string) => ({
      select: () => ({
        eq: (_coluna: string, valor: string) => {
          if (tabela === "platform_ia") {
            return { maybeSingle: async () => ({ data: opcoes.plataforma, error: null }) };
          }
          provedoresLidos.push(valor);
          return { is: async () => ({ data: opcoes.catalogo[valor] ?? [], error: null }) };
        },
      }),
    }),
  } as never;
  return { cliente, provedoresLidos };
}

const MODELO_BOM = {
  model_id: "gpt-5.6-terra",
  is_default_for_provider: true,
  supports_tools: true,
  input_price_per_million_cents: 200,
  output_price_per_million_cents: 1200,
};

describe("o cérebro do agente novo do cliente", () => {
  it("o par do painel vence, sem ler o catálogo", async () => {
    const { cliente, provedoresLidos } = adminComCatalogo({
      plataforma: { provider: "openai", model_id: "gpt-5.6-terra" },
      catalogo: {},
    });
    expect(await iaDoAgenteNovo(cliente, "anthropic")).toEqual({ provider: "openai", model: "gpt-5.6-terra" });
    expect(provedoresLidos).toEqual([]);
  });

  it("sem par no painel, vale o provedor da organização e a escolha do catálogo", async () => {
    const { cliente, provedoresLidos } = adminComCatalogo({
      plataforma: null,
      catalogo: { openai: [MODELO_BOM] },
    });
    expect(await iaDoAgenteNovo(cliente, "openai")).toEqual({ provider: "openai", model: "gpt-5.6-terra" });
    expect(provedoresLidos).toEqual(["openai"]);
  });

  it("catálogo vazio devolve null — a tela diz que é pendência nossa, e não inventa modelo", async () => {
    const { cliente } = adminComCatalogo({ plataforma: null, catalogo: {} });
    expect(await iaDoAgenteNovo(cliente, "openai")).toBeNull();
  });
});

/**
 * A régua única "qual IA vale para a empresa e se ela tem chave" (MIA-217, 9172).
 *
 * As funções puras recebem a leitura do `.env` por parâmetro: cada caso diz qual
 * chave a instalação tem, sem depender do ambiente de quem roda o teste.
 */
import { describe, expect, it } from "vitest";

import {
  chaveUtilizavel,
  contarEmpresas,
  iaDaLinha,
  iaDasEmpresas,
  recusaDaPlataformaSemChave,
  recusaDoPadraoSemChave,
} from "./ia-da-empresa";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const soOpenai = (p: string) => p === "openai";
const nenhuma = () => false;
const VALIDADA = "2026-11-01T00:00:00Z";

describe("chaveUtilizavel — a mesma régua do turno", () => {
  it.each([
    ["chave própria ativa e validada", "anthropic", [{ provider: "anthropic", is_active: true, validated_at: VALIDADA }], nenhuma, "propria"],
    ["chave própria NÃO validada não conta", "anthropic", [{ provider: "anthropic", is_active: true, validated_at: null }], nenhuma, null],
    ["chave própria desativada não conta", "anthropic", [{ provider: "anthropic", is_active: false, validated_at: VALIDADA }], nenhuma, null],
    ["chave própria de OUTRO provedor não conta", "anthropic", [{ provider: "openai", is_active: true, validated_at: VALIDADA }], nenhuma, null],
    ["sem própria, a da instalação", "openai", [], soOpenai, "instalacao"],
    ["a própria vence a da instalação", "openai", [{ provider: "openai", is_active: true, validated_at: VALIDADA }], soOpenai, "propria"],
    ["Anthropic sem chave em lugar nenhum (o retrato da produção)", "anthropic", [], soOpenai, null],
    ["a assinatura sem login cai na reserva da OpenAI", "openai-assinatura", [], soOpenai, "instalacao"],
    ["a assinatura com login é própria", "openai-assinatura", [{ provider: "openai-assinatura", is_active: true, validated_at: VALIDADA }], nenhuma, "propria"],
    ["a assinatura sem login e sem OpenAI fica sem chave", "openai-assinatura", [], nenhuma, null],
  ] as const)("%s", (_caso, provider, credenciais, instalacao, esperado) => {
    expect(chaveUtilizavel(provider, credenciais, instalacao)).toBe(esperado);
  });
});

describe("recusaDoPadraoSemChave — a trava da tela Provedores de IA", () => {
  it("com chave, nada a recusar", () => {
    expect(recusaDoPadraoSemChave({ provider: "openai", chave: "instalacao", alvo: "empresa" })).toBeNull();
    expect(recusaDoPadraoSemChave({ provider: "openai", chave: "propria", alvo: "funcao" })).toBeNull();
  });

  it("o padrão da empresa sem chave: o nome do provedor e a saída", () => {
    expect(recusaDoPadraoSemChave({ provider: "anthropic", chave: null, alvo: "empresa" })).toBe(
      "Não dá para salvar: Anthropic (Claude) não tem chave nesta instalação e esta empresa não cadastrou uma. " +
        "Escolha um provedor com chave, ou deixe a empresa seguindo a IA da plataforma.",
    );
  });

  it("uma função sem chave fala da função", () => {
    const texto = recusaDoPadraoSemChave({ provider: "anthropic", chave: null, alvo: "funcao" });
    expect(texto).toContain("Anthropic (Claude) não tem chave nesta instalação");
    expect(texto).toContain("esta função ficaria sem IA");
  });

  it("provedor fora da lista aparece pelo id, sem quebrar", () => {
    expect(recusaDoPadraoSemChave({ provider: "desconhecido", chave: null, alvo: "empresa" })).toContain(
      "desconhecido não tem chave",
    );
  });
});

describe("recusaDaPlataformaSemChave — a trava do cartão do admin", () => {
  it("provedor com chave da instalação passa", () => {
    expect(recusaDaPlataformaSemChave({ provider: "openai", seguem: 14, chaveDaInstalacao: soOpenai })).toBeNull();
  });

  it("provedor sem chave da instalação é recusado, contando quem ficaria sem IA", () => {
    expect(recusaDaPlataformaSemChave({ provider: "anthropic", seguem: 14, chaveDaInstalacao: soOpenai })).toBe(
      "Não dá para salvar: Anthropic (Claude) não tem chave nesta instalação. " +
        "As 14 empresas que seguem a plataforma ficariam sem IA. Escolha um provedor com chave.",
    );
    expect(recusaDaPlataformaSemChave({ provider: "anthropic", seguem: 1, chaveDaInstalacao: soOpenai })).toContain(
      "A empresa que segue a plataforma ficaria sem IA.",
    );
  });

  it("sem ninguém seguindo, ainda recusa: as empresas novas nasceriam sem IA", () => {
    expect(recusaDaPlataformaSemChave({ provider: "anthropic", seguem: 0, chaveDaInstalacao: soOpenai })).toContain(
      "As empresas novas ficariam sem IA.",
    );
  });

  it("'automático' (par vazio) só passa sem ninguém seguindo", () => {
    expect(recusaDaPlataformaSemChave({ provider: null, seguem: 0, chaveDaInstalacao: soOpenai })).toBeNull();
    expect(recusaDaPlataformaSemChave({ provider: null, seguem: 3, chaveDaInstalacao: soOpenai })).toBe(
      "Escolha um modelo: 3 empresas seguem a plataforma e ficariam com o padrão antigo do produto.",
    );
    expect(recusaDaPlataformaSemChave({ provider: null, seguem: 1, chaveDaInstalacao: soOpenai })).toBe(
      "Escolha um modelo: 1 empresa segue a plataforma e ficaria com o padrão antigo do produto.",
    );
  });
});

describe("iaDaLinha — a leitura de uma linha de organizations", () => {
  it("quem segue a plataforma: origem plataforma, e a chave do par", () => {
    const ia = iaDaLinha(
      { id: "org-1", settings: { llm: { provider: "openai", default_model: "gpt-5.6-luna" } }, ia_segue_a_plataforma: true },
      [],
      soOpenai,
    );
    expect(ia).toEqual({
      organizationId: "org-1",
      provider: "openai",
      modelId: "gpt-5.6-luna",
      origem: "plataforma",
      chave: "instalacao",
    });
  });

  it("escolha própria sem chave: a empresa está sem IA", () => {
    const ia = iaDaLinha(
      { id: "org-2", settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } }, ia_segue_a_plataforma: false },
      [],
      soOpenai,
    );
    expect(ia.origem).toBe("propria");
    expect(ia.chave).toBeNull();
  });

  it("settings sem llm cai na mesma queda do turno, sem lançar", () => {
    const ia = iaDaLinha({ id: "org-3", settings: null, ia_segue_a_plataforma: null }, [], soOpenai);
    expect(ia).toMatchObject({ provider: "anthropic", modelId: null, origem: "propria", chave: null });
  });
});

describe("contarEmpresas — o que o cartão do admin mostra", () => {
  const empresa = (
    origem: "plataforma" | "propria",
    chave: "propria" | "instalacao" | null,
    status: string | null = "active",
  ) => ({ organizationId: "x", provider: "openai", modelId: "m", origem, chave, status });

  it("conta só as que operam", () => {
    expect(
      contarEmpresas([
        empresa("plataforma", "instalacao"),
        empresa("plataforma", "instalacao"),
        empresa("propria", "propria"),
        empresa("propria", null),
        empresa("plataforma", null, "suspended"),
      ]),
    ).toEqual({ seguem: 2, propria: 2, sem_chave: 1 });
  });

  it("leitura que falhou continua null — nunca vira zero", () => {
    expect(contarEmpresas(null)).toBeNull();
  });
});

describe("iaDasEmpresas — o lote que a saúde, o relatório e o MCP leem", () => {
  type Admin = Parameters<typeof iaDasEmpresas>[0];
  // O banco em memória com o teto de 1000 linhas por resposta, como o PostgREST.
  const banco = (organizations: Linha[], ai_provider_credentials: Linha[]) =>
    bancoEmMemoria({ organizations, ai_provider_credentials }, {}, { maxRows: 1000 });

  /** O mesmo cliente, com a página que começa em `de` da tabela `alvo` falhando. */
  const comPaginaQueFalha = (cliente: ReturnType<typeof banco>["cliente"], alvo: string, de: number) =>
    ({
      from: (tabela: string) => {
        const q = cliente.from(tabela) as Record<string, (...a: unknown[]) => unknown>;
        const range = q.range!;
        q.range = (inicio: unknown, fim: unknown) =>
          tabela === alvo && inicio === de
            ? { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "fora do ar" } }).then(ok) }
            : range(inicio, fim);
        return q;
      },
    }) as unknown as Admin;

  it("traz nome e operante, sem outra leitura", async () => {
    const { cliente } = banco(
      [
        { id: "a", status: "active", display_name: "Empresa A", settings: { llm: { provider: "openai", default_model: "m" } }, ia_segue_a_plataforma: true },
        { id: "b", status: "suspended", display_name: null, settings: { llm: { provider: "anthropic" } }, ia_segue_a_plataforma: false },
      ],
      [{ id: "c1", organization_id: "b", provider: "anthropic", is_active: true, validated_at: VALIDADA }],
    );
    expect(await iaDasEmpresas(cliente as unknown as Admin, soOpenai)).toEqual([
      { organizationId: "a", provider: "openai", modelId: "m", origem: "plataforma", chave: "instalacao", status: "active", nome: "Empresa A", operante: true, jevSemChave: false },
      { organizationId: "b", provider: "anthropic", modelId: null, origem: "propria", chave: "propria", status: "suspended", nome: null, operante: false, jevSemChave: false },
    ]);
  });

  it("FORK MIA (MIA-262): o Jev ligado sem chave validada da origem dele aparece no lote", async () => {
    const ACEITE = { em: "2026-09-20T12:00:00.000Z", por: "00000000-0000-4000-8000-000000000001" };
    const { cliente } = banco(
      [
        { id: "a", status: "active", display_name: "Empresa A", settings: { llm: { provider: "openai" }, jev: { ligado: true, aceite: ACEITE } }, ia_segue_a_plataforma: false },
        { id: "b", status: "active", display_name: "Empresa B", settings: { llm: { provider: "openai" }, jev: { ligado: true, aceite: ACEITE } }, ia_segue_a_plataforma: false },
        { id: "c", status: "active", display_name: "Empresa C", settings: { llm: { provider: "openai" }, jev: { ligado: true, origem: "openrouter", aceite: ACEITE } }, ia_segue_a_plataforma: false },
      ],
      [
        { id: "c1", organization_id: "a", provider: "openai", is_active: true, validated_at: VALIDADA },
        { id: "c2", organization_id: "b", provider: "openai", is_active: true, validated_at: VALIDADA },
        { id: "c3", organization_id: "b", provider: "typesafe", is_active: true, validated_at: VALIDADA },
        { id: "c4", organization_id: "c", provider: "typesafe", is_active: true, validated_at: VALIDADA },
      ],
    );
    const lote = await iaDasEmpresas(cliente as unknown as Admin, soOpenai);
    expect(lote?.map((e) => [e.organizationId, e.jevSemChave])).toEqual([
      ["a", true],
      ["b", false],
      // A origem é a OpenRouter, e a empresa só tem a chave da TypeSafe.
      ["c", true],
    ]);
  });

  describe("mais de 1000 linhas: o lote inteiro, em páginas (MIA-235)", () => {
    const N = 2345;
    const id = (i: number) => `0a000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    // Ímpar segue a plataforma (OpenAI, chave da instalação). Par tem escolha
    // própria na Anthropic e, quando não é múltiplo de 3, duas chaves próprias
    // (Anthropic e Google): 1564 credenciais, mais de uma página também. Toda
    // décima está suspensa.
    function fixtura() {
      const orgs: Linha[] = [];
      const creds: Linha[] = [];
      for (let i = 1; i <= N; i++) {
        const segue = i % 2 === 1;
        orgs.push({
          id: id(i),
          status: i % 10 === 0 ? "suspended" : "active",
          display_name: `Academia Alfa ${i}`,
          settings: { llm: { provider: segue ? "openai" : "anthropic" } },
          ia_segue_a_plataforma: segue,
        });
        if (!segue && i % 3 !== 0) {
          for (const provider of ["anthropic", "google"]) {
            creds.push({ id: `${id(i)}-${provider}`, organization_id: id(i), provider, is_active: true, validated_at: VALIDADA });
          }
        }
      }
      // Ruído que a leitura filtra no banco: desativada e nunca validada.
      creds.push({ id: "zz-1", organization_id: id(6), provider: "anthropic", is_active: false, validated_at: VALIDADA });
      creds.push({ id: "zz-2", organization_id: id(12), provider: "anthropic", is_active: true, validated_at: null });
      // Fora de ordem no banco: a ordem do lote vem do `order("id")`, não da inserção.
      return banco(orgs.reverse(), creds.reverse());
    }

    it("todas as empresas, na ordem do id, sem repetir nem pular", async () => {
      const lote = await iaDasEmpresas(fixtura().cliente as unknown as Admin, soOpenai);
      expect(lote).not.toBeNull();
      expect(lote).toHaveLength(N);
      expect(new Set(lote!.map((e) => e.organizationId)).size).toBe(N);
      expect(lote![0]!.nome).toBe("Academia Alfa 1");
      expect(lote![N - 1]!.nome).toBe(`Academia Alfa ${N}`);
      // A chave própria de quem está depois da linha 1000 das credenciais chegou.
      expect(lote!.find((e) => e.nome === "Academia Alfa 2344")!.chave).toBe("propria");
    });

    it("contarEmpresas conta o lote inteiro", async () => {
      const lote = await iaDasEmpresas(fixtura().cliente as unknown as Admin, soOpenai);
      // Das 2111 que operam: 1173 seguem (ímpares) e 938 têm escolha própria
      // (pares); das próprias, as 312 múltiplas de 6 estão sem chave.
      expect(contarEmpresas(lote)).toEqual({ seguem: 1173, propria: 938, sem_chave: 312 });
    });

    it("erro em qualquer página vira null, nunca um recorte", async () => {
      const { cliente } = fixtura();
      for (const [tabela, de] of [
        ["organizations", 0],
        ["organizations", 1000],
        ["organizations", 2000],
        ["ai_provider_credentials", 0],
        ["ai_provider_credentials", 1000],
      ] as const) {
        expect(await iaDasEmpresas(comPaginaQueFalha(cliente, tabela, de), soOpenai), `${tabela} @${de}`).toBeNull();
      }
    });
  });

  it("falha de leitura vira null, nunca lista vazia", async () => {
    const { cliente } = banco([], []);
    expect(await iaDasEmpresas(comPaginaQueFalha(cliente, "organizations", 0), soOpenai)).toBeNull();
    expect(await iaDasEmpresas(comPaginaQueFalha(cliente, "ai_provider_credentials", 0), soOpenai)).toBeNull();
  });
});

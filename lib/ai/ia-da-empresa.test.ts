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
  recusaDaPlataformaSemChave,
  recusaDoPadraoSemChave,
} from "./ia-da-empresa";

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

/**
 * FORK MIA — a régua da trava da IA, sozinha (lib/ai/trava-da-ia.ts).
 *
 * Cada porta do servidor chama estas funções; o teste das portas mora em
 * tests/unit/trava-da-ia-portas.test.ts. Aqui fica a régua: qual IA vale para
 * uma versão nova, o que some de um patch, o que pode ir ao ar.
 */
import { describe, expect, it } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

import {
  configDoRoteador,
  escolheIa,
  iaAtualDoAgente,
  iaDaCopia,
  iaPodeIrAoAr,
  semCamposDaIa,
  travarIaDaVersaoNova,
} from "./trava-da-ia";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "22222222-2222-4222-8222-222222222222";
const CRED = "33333333-3333-4333-8333-333333333333";

const CLIENTE = { is_platform_admin: false, support: null };
const PLATAFORMA = { is_platform_admin: true, support: null };
/** Admin de plataforma DENTRO da conta do cliente: acompanhar não é operar. */
const PLATAFORMA_EM_SUPORTE = {
  is_platform_admin: true,
  support: { status: "active" } as unknown as (typeof PLATAFORMA)["support"],
};

const ATAQUE = { provider: "anthropic", model: "claude-opus-4-7", credential_id: null, operator_model: "o3-pro" };

function versao(n: number, model: string, extra: Record<string, unknown> = {}) {
  return {
    id: `v${n}`,
    organization_id: ORG,
    agent_id: AGENTE,
    version_number: n,
    provider: "openai",
    model,
    credential_id: CRED,
    operator_model: null,
    ...extra,
  };
}

function banco(opts: { noAr?: string | null; versoes?: Record<string, unknown>[]; par?: [string, string] | null }) {
  return bancoEmMemoria({
    ai_agents: [{ id: AGENTE, organization_id: ORG, published_version_id: opts.noAr ?? null }],
    ai_agent_versions: opts.versoes ?? [],
    platform_ia: opts.par === null ? [] : [{ id: 1, provider: (opts.par ?? ["openai", "luna"])[0], model_id: (opts.par ?? ["openai", "luna"])[1] }],
    organizations: [{ id: ORG, settings: { llm: { provider: "openai" } } }],
  });
}

describe("quem escolhe a IA", () => {
  it("só o admin de plataforma fora de suporte", () => {
    expect(escolheIa(PLATAFORMA)).toBe(true);
    expect(escolheIa(CLIENTE)).toBe(false);
    expect(escolheIa(PLATAFORMA_EM_SUPORTE)).toBe(false);
    // Fixture sem o campo é cliente, nunca plataforma: ausência não autoriza.
    expect(escolheIa({} as typeof CLIENTE)).toBe(false);
  });
});

describe("a IA atual do agente", () => {
  it("é a da versão no ar, mesmo havendo versão mais nova", async () => {
    const { cliente } = banco({ noAr: "v2", versoes: [versao(2, "luna"), versao(3, "terra")] });
    expect((await iaAtualDoAgente(cliente as never, ORG, AGENTE))?.model).toBe("luna");
  });

  it("sem versão no ar, é a da versão mais nova", async () => {
    const { cliente } = banco({ versoes: [versao(1, "terra"), versao(4, "luna"), versao(2, "sol")] });
    expect((await iaAtualDoAgente(cliente as never, ORG, AGENTE))?.model).toBe("luna");
  });

  it("não atravessa organização", async () => {
    const { cliente } = banco({ versoes: [versao(1, "luna", { organization_id: "outra" })] });
    expect(await iaAtualDoAgente(cliente as never, ORG, AGENTE)).toBeNull();
  });
});

describe("versão nova", () => {
  it("do cliente herda a IA atual do agente e IGNORA o corpo (o ataque)", async () => {
    const { cliente } = banco({ noAr: "v2", versoes: [versao(2, "luna")] });
    const r = await travarIaDaVersaoNova(
      cliente as never,
      { user: CLIENTE, orgId: ORG, agenteDeReferencia: AGENTE },
      { system_prompt: "oi", ...ATAQUE },
    );
    expect(r).toEqual({
      ok: true,
      corpo: { system_prompt: "oi", provider: "openai", model: "luna", credential_id: CRED, operator_model: null },
    });
  });

  it("do cliente, para agente novo, nasce com o par da plataforma e a chave da instalação", async () => {
    const { cliente } = banco({ par: ["openai", "luna"] });
    const r = await travarIaDaVersaoNova(
      cliente as never,
      { user: CLIENTE, orgId: ORG, agenteDeReferencia: null },
      ATAQUE,
    );
    expect(r.ok && r.corpo).toEqual({ provider: "openai", model: "luna", credential_id: null, operator_model: null });
  });

  it("sem par possível, recusa dizendo de quem é a pendência", async () => {
    const { cliente } = banco({ par: null }); // e ai_models vazia: nenhum modelo no catálogo
    const r = await travarIaDaVersaoNova(
      cliente as never,
      { user: CLIENTE, orgId: ORG, agenteDeReferencia: null },
      ATAQUE,
    );
    expect(r.ok).toBe(false);
  });

  it("CONTROLE: a plataforma grava o que escolheu", async () => {
    const { cliente } = banco({ noAr: "v2", versoes: [versao(2, "luna")] });
    const r = await travarIaDaVersaoNova(
      cliente as never,
      { user: PLATAFORMA, orgId: ORG, agenteDeReferencia: AGENTE },
      ATAQUE,
    );
    expect(r.ok && r.corpo).toEqual(ATAQUE);
  });
});

describe("patch de versão existente", () => {
  it("do cliente perde os quatro campos da IA e mantém o resto", () => {
    expect(semCamposDaIa(CLIENTE, { system_prompt: "novo", ...ATAQUE })).toEqual({ system_prompt: "novo" });
  });

  it("CONTROLE: o da plataforma fica inteiro", () => {
    expect(semCamposDaIa(PLATAFORMA, { system_prompt: "novo", ...ATAQUE })).toEqual({ system_prompt: "novo", ...ATAQUE });
  });
});

describe("pôr no ar", () => {
  const cenario = () => banco({ noAr: "v5", versoes: [versao(3, "terra"), versao(5, "luna")], par: ["openai", "luna"] });

  it("o cliente não põe no ar versão antiga com outro modelo", async () => {
    const { cliente } = cenario();
    expect(
      await iaPodeIrAoAr(cliente as never, { user: CLIENTE, orgId: ORG, agentId: AGENTE, versao: versao(3, "terra") }),
    ).toBe(false);
  });

  it("o cliente põe no ar versão com a IA atual, ou com o par da plataforma sem Operador próprio", async () => {
    const { cliente } = cenario();
    expect(
      await iaPodeIrAoAr(cliente as never, { user: CLIENTE, orgId: ORG, agentId: AGENTE, versao: versao(6, "luna") }),
    ).toBe(true);
    expect(
      await iaPodeIrAoAr(cliente as never, {
        user: CLIENTE,
        orgId: ORG,
        agentId: AGENTE,
        versao: versao(7, "luna", { credential_id: null }),
      }),
    ).toBe(true);
    expect(
      await iaPodeIrAoAr(cliente as never, {
        user: CLIENTE,
        orgId: ORG,
        agentId: AGENTE,
        versao: versao(8, "luna", { credential_id: null, operator_model: "o3-pro" }),
      }),
    ).toBe(false);
  });

  it("CONTROLE: a plataforma põe no ar o que quiser", async () => {
    const { cliente } = cenario();
    expect(
      await iaPodeIrAoAr(cliente as never, { user: PLATAFORMA, orgId: ORG, agentId: AGENTE, versao: versao(3, "terra") }),
    ).toBe(true);
  });
});

describe("duplicar e roteador", () => {
  it("a cópia do cliente leva a IA atual da origem; a da plataforma, nada imposto", async () => {
    const { cliente } = banco({ noAr: "v5", versoes: [versao(5, "luna"), versao(6, "terra", { status: "draft" })] });
    expect((await iaDaCopia(cliente as never, { user: CLIENTE, orgId: ORG, agentId: AGENTE }))?.model).toBe("luna");
    expect(await iaDaCopia(cliente as never, { user: PLATAFORMA, orgId: ORG, agentId: AGENTE })).toBeNull();
  });

  it("roteador novo do cliente nasce no Automático; o existente não troca de classificador", () => {
    const pedido = { classifier_model: "o3-pro", classifier_provider: "openai", sticky: false };
    expect(configDoRoteador(CLIENTE, pedido, null)).toEqual({
      sticky: false,
      classifier_model: null,
      classifier_provider: null,
    });
    expect(configDoRoteador(CLIENTE, pedido, { classifier_model: "mini" })).toEqual({ sticky: false });
    expect(configDoRoteador(PLATAFORMA, pedido, null)).toEqual(pedido);
    expect(configDoRoteador(PLATAFORMA, undefined, null)).toBeUndefined();
  });
});

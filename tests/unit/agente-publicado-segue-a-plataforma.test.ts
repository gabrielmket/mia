/**
 * FORK MIA (MIA-309) — O AGENTE PUBLICADO SEGUE A TROCA DE MODELO DA PLATAFORMA.
 *
 * A prova da seção 3 do desenho da MIA-285, pela carga da versão de verdade
 * (`agent-config.ts`, com o banco de mentira devolvendo a linha):
 *
 *  1. empresa que segue a plataforma, com a versão publicada em outro modelo:
 *     o agente responde no par da plataforma, sem a credencial da versão;
 *  2. empresa com escolha própria: a versão fica intacta;
 *  3. a plataforma em outro provedor: o modelo do operador e a reserva saem;
 *  4. o turno com a versão presa a uma credencial: o resolvedor usa a chave da
 *     instalação no provedor da plataforma, e não a credencial da versão.
 *
 * E a conta que o MCP e a trava de `/admin/modelo-de-ia` fazem com a mesma
 * regra. Nenhum dado real: empresas, chaves e modelos fictícios.
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: () => Buffer.from(""),
  decryptKey: () => "chave-propria-da-empresa",
}));

import {
  loadAgentVersionConfig,
  loadPublishedAgentConfig,
  loadPublishedAgentConfigById,
  overrideLlmDoAgente,
} from "@/lib/agent-engine/agent/agent-config";
import { reservaDeModeloDaVersao } from "@/lib/agent-engine/agent/reserva-do-modelo-da-versao";
import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import {
  agenteSegueAPlataforma,
  agentesForaDoPar,
  agentesQueSeguemEUsamFoto,
  type AgentePublicado,
} from "@/lib/ai/agente-segue-a-plataforma";

const ORG = "0e309000-0000-4000-8000-000000000001";
const CHAVE_DA_VERSAO = "0e309000-0000-4000-8000-000000000004";

/** A versão publicada: gravada num par antigo, presa a uma credencial, com operador e reserva. */
const VERSAO = {
  agent_id: "a1",
  version_id: "v1",
  agent_name: "Recepção",
  system_prompt: "p",
  provider: "openai",
  model: "modelo-antigo",
  credential_id: CHAVE_DA_VERSAO,
  operator_model: "modelo-do-operador",
  reserve_provider: "openrouter",
  reserve_model: "modelo-de-reserva",
  max_steps: 8,
  history_message_window: 30,
  history_token_window: 8000,
  handoff_keywords: null,
  handoff_tool_enabled: true,
  tool_ids: null,
  version_created_by: null,
  agent_created_by: null,
  active_kb_version_id: null,
  config: {},
  followup: null,
};

const PLATAFORMA_OPENAI = { provider: "openai", default_model: "modelo-da-plataforma", enabled_models: [] };
const PLATAFORMA_ANTHROPIC = { provider: "anthropic", default_model: "modelo-novo-da-plataforma" };

function bancoCom(linha: Record<string, unknown>): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [linha] }) } as unknown as pg.Pool;
}

describe("a carga da versão pede a IA da plataforma no mesmo select", () => {
  it("os três carregadores levam a coluna, presa à empresa do agente e a quem segue", async () => {
    for (const carregar of [
      (db: pg.Pool) => loadPublishedAgentConfig(db, ORG, "numero-1"),
      (db: pg.Pool) => loadPublishedAgentConfigById(db, ORG, "a1"),
      (db: pg.Pool) => loadAgentVersionConfig(db, ORG, "a1", "v1"),
    ]) {
      const db = bancoCom(VERSAO);
      await carregar(db);
      const [sql] = (db.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(sql).toMatch(/as ia_da_plataforma/);
      expect(sql).toMatch(/o\.id = a\.organization_id/);
      expect(sql).toMatch(/o\.ia_segue_a_plataforma is true/);
      // Sem par escolhido na plataforma, não há o que seguir (o gatilho da 9172 também não mexe).
      expect(sql).toMatch(/from platform_ia p where p\.id = 1 and p\.provider is not null and p\.model_id is not null/);
    }
  });
});

describe("1. a empresa que segue a plataforma", () => {
  it("⭐ com a versão em outro modelo, responde no modelo da plataforma e sem a credencial da versão", async () => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: PLATAFORMA_OPENAI }), ORG, "n1");
    expect(cfg).toMatchObject({ provider: "openai", model: "modelo-da-plataforma", credentialId: null });
    // Mesmo provedor: o modelo do operador e a reserva continuam valendo.
    expect(cfg).toMatchObject({
      operatorModel: "modelo-do-operador",
      reserveProvider: "openrouter",
      reserveModel: "modelo-de-reserva",
    });
  });

  it("o teste no editor (a versão pelo id) usa o mesmo par do atendimento", async () => {
    const linha = { ...VERSAO, ia_da_plataforma: PLATAFORMA_OPENAI };
    const doEditor = await loadAgentVersionConfig(bancoCom(linha), ORG, "a1", "v1");
    const doRoteador = await loadPublishedAgentConfigById(bancoCom(linha), ORG, "a1");
    expect(doEditor).toMatchObject({ provider: "openai", model: "modelo-da-plataforma", credentialId: null });
    expect(doRoteador).toMatchObject({ provider: "openai", model: "modelo-da-plataforma", credentialId: null });
  });

  it("o resto da versão fica como está", async () => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: PLATAFORMA_OPENAI }), ORG, "n1");
    expect(cfg).toMatchObject({ agentId: "a1", versionId: "v1", systemPrompt: "p", maxSteps: 8, historyTokenWindow: 8000 });
  });

  it.each([
    ["sem provedor", { default_model: "x" }],
    ["sem modelo", { provider: "openai" }],
    ["modelo em branco", { provider: "openai", default_model: "  " }],
    ["jsonb torto", "openai"],
  ])("`settings.llm` pela metade (%s) não troca nada: a versão é a melhor informação", async (_caso, llm) => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: llm }), ORG, "n1");
    expect(cfg).toMatchObject({ provider: "openai", model: "modelo-antigo", credentialId: CHAVE_DA_VERSAO });
  });
});

describe("2. a empresa com escolha própria", () => {
  it.each([
    ["a coluna vem nula", { ...VERSAO, ia_da_plataforma: null }],
    ["a coluna não veio (linha de antes)", VERSAO],
  ])("⭐ a versão fica intacta: %s", async (_caso, linha) => {
    const cfg = await loadPublishedAgentConfig(bancoCom(linha), ORG, "n1");
    expect(cfg).toMatchObject({
      provider: "openai",
      model: "modelo-antigo",
      credentialId: CHAVE_DA_VERSAO,
      operatorModel: "modelo-do-operador",
      reserveProvider: "openrouter",
      reserveModel: "modelo-de-reserva",
    });
  });
});

describe("3. a plataforma em outro provedor", () => {
  it("⭐ o modelo do operador e a reserva saem: foram escolhidos ao lado do par antigo", async () => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: PLATAFORMA_ANTHROPIC }), ORG, "n1");
    expect(cfg).toMatchObject({
      provider: "anthropic",
      model: "modelo-novo-da-plataforma",
      credentialId: null,
      operatorModel: null,
      reserveProvider: null,
      reserveModel: null,
    });
    // Sem reserva, nenhum degrau: o comportamento de quem não configurou nada.
    expect(reservaDeModeloDaVersao(cfg!)).toBeUndefined();
  });

  it("a regra pura não muda o objeto de entrada", () => {
    const entrada = { provider: "openai", model: "m", credentialId: "c", operatorModel: "o", reserveProvider: "r", reserveModel: "rm" };
    const saida = agenteSegueAPlataforma(entrada, PLATAFORMA_ANTHROPIC);
    expect(entrada).toEqual({ provider: "openai", model: "m", credentialId: "c", operatorModel: "o", reserveProvider: "r", reserveModel: "rm" });
    expect(saida).not.toBe(entrada);
  });
});

describe("4. o turno com a versão presa à credencial", () => {
  /** O pool do resolvedor: a 1ª consulta é o `settings.llm` da empresa, a 2ª a credencial. */
  function poolDoResolvedor(credencial: boolean) {
    const consultas: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        consultas.push({ sql, params });
        if (consultas.length === 1) return { rows: [{ llm: PLATAFORMA_ANTHROPIC }] };
        return { rows: credencial ? [{ id: CHAVE_DA_VERSAO, api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" }] : [] };
      },
    } as unknown as pg.Pool;
    return { pool, consultas };
  }

  it("⭐ quem segue: a chave é a da instalação, no provedor da plataforma; a credencial da versão nem é pedida", async () => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: PLATAFORMA_ANTHROPIC }), ORG, "n1");
    const override = overrideLlmDoAgente(cfg!, reservaDeModeloDaVersao(cfg!));
    expect(override).toEqual({ provider: "anthropic", credentialId: null });

    const { pool, consultas } = poolDoResolvedor(false);
    const ia = await resolveOrgLlmConfig(pool, { anthropicApiKey: "chave-da-instalacao" }, ORG, override);
    expect(ia).toMatchObject({ provider: "anthropic", apiKey: "chave-da-instalacao", origemDaChave: "chave_da_instalacao" });
    // A busca da credencial foi pelo PROVEDOR, nunca pelo id preso à versão.
    expect(consultas[1]!.params).toEqual([ORG, "anthropic"]);
    expect(consultas.flatMap((c) => c.params)).not.toContain(CHAVE_DA_VERSAO);
  });

  it("escolha própria: o turno continua indo atrás da credencial presa à versão", async () => {
    const cfg = await loadPublishedAgentConfig(bancoCom({ ...VERSAO, ia_da_plataforma: null }), ORG, "n1");
    const override = overrideLlmDoAgente(cfg!, reservaDeModeloDaVersao(cfg!));
    expect(override).toMatchObject({ provider: "openai", credentialId: CHAVE_DA_VERSAO });

    const { pool, consultas } = poolDoResolvedor(true);
    const ia = await resolveOrgLlmConfig(pool, { openaiApiKey: "chave-da-instalacao" }, ORG, override);
    expect(ia).toMatchObject({ apiKey: "chave-propria-da-empresa", origemDaChave: "credencial_da_organizacao" });
    expect(consultas[1]!.params).toEqual([ORG, CHAVE_DA_VERSAO]);
  });
});

describe("a conta da plataforma, com a mesma regra", () => {
  const SEGUE = { organizationId: "org-segue", origem: "plataforma" as const, provider: "openai", modelId: "modelo-da-plataforma", operante: true };
  const PROPRIA = { organizationId: "org-propria", origem: "propria" as const, provider: "google", modelId: "modelo-da-empresa", operante: true };
  const SUSPENSA = { organizationId: "org-suspensa", origem: "plataforma" as const, provider: "openai", modelId: "modelo-da-plataforma", operante: false };
  const agente = (organizationId: string, provider: string, model: string, usaFoto = false): AgentePublicado => ({
    organizationId,
    provider,
    model,
    usaFoto,
  });

  it("⭐ quem segue dá zero fora do par, mesmo com a versão gravada em outro modelo e outro provedor", () => {
    const conta = agentesForaDoPar(
      [SEGUE, PROPRIA],
      [
        agente("org-segue", "openai", "modelo-antigo"),
        agente("org-segue", "anthropic", "outro-modelo"),
        agente("org-propria", "google", "modelo-da-empresa"),
        agente("org-propria", "google", "um-modelo-diferente"),
        agente("org-de-fora", "openai", "x"),
      ],
    );
    expect(conta.get("org-segue")).toEqual({ publicados: 2, foraDoPar: 0 });
    // Escolha própria: o agente noutro modelo aparece (pode ser de propósito).
    expect(conta.get("org-propria")).toEqual({ publicados: 2, foraDoPar: 1 });
    expect(conta.has("org-de-fora")).toBe(false);
  });

  it("quem segue sem modelo em vigor conta o agente como fora do par (a regra não troca nada)", () => {
    const conta = agentesForaDoPar([{ ...SEGUE, modelId: null }], [agente("org-segue", "openai", "modelo-antigo")]);
    expect(conta.get("org-segue")).toEqual({ publicados: 1, foraDoPar: 1 });
  });

  it("os agentes que leem foto, só das empresas que seguem e operam", () => {
    expect(
      agentesQueSeguemEUsamFoto(
        [SEGUE, PROPRIA, SUSPENSA],
        [
          agente("org-segue", "openai", "m", true),
          agente("org-segue", "openai", "m", false),
          agente("org-propria", "google", "m", true),
          agente("org-suspensa", "openai", "m", true),
        ],
      ),
    ).toBe(1);
  });
});

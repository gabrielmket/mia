/**
 * FORK MIA (MIA-309) · O AGENTE PUBLICADO SEGUE A PLATAFORMA — contra o
 * Postgres nascido do baseline.
 *
 * A carga da versão (`lib/agent-engine/agent/agent-config.ts`) lê, ao lado das
 * colunas da versão, a subconsulta `COLUNA_DA_IA_DA_PLATAFORMA`
 * (`lib/ai/agente-segue-a-plataforma.ts`): o `settings.llm` da empresa quando
 * ela segue a plataforma e `platform_ia` tem par, senão `null`. A unidade
 * (`tests/unit/agente-publicado-segue-a-plataforma.test.ts`) prova a regra com
 * banco de mentira; aqui o banco é de verdade, para pegar erro de coluna, de
 * alias (`a.organization_id`) ou de gatilho que o mock não vê. Um caso por item:
 *
 *  1. empresa que segue + `platform_ia` com par: os três carregadores (pelo
 *     número, pelo id do agente e pela versão) devolvem o par da plataforma,
 *     sem a credencial da versão, e com outro provedor sem o operador e sem a
 *     reserva;
 *  2. trocar `platform_ia` muda a carga seguinte (o gatilho da 9172 propaga e a
 *     subconsulta lê o novo); no mesmo provedor da versão, o operador e a
 *     reserva ficam;
 *  3. empresa de escolha própria (`ia_segue_a_plataforma = false`): o par, a
 *     credencial e o operador da versão;
 *  4. `platform_ia` sem par (instalação nova, CI): a versão, mesmo para quem
 *     segue.
 *
 * O banco é novo por arquivo (`vitest.db.config.ts`), então o `platform_ia`
 * daqui não vaza para os outros arquivos; o `afterAll` o esvazia mesmo assim.
 * Os nomes são os fictícios do repositório.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  loadAgentVersionConfig,
  loadPublishedAgentConfig,
  loadPublishedAgentConfigById,
} from "@/lib/agent-engine/agent/agent-config";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const P = "a0de0309-0000-4000-8000";
const id = (n: number) => `${P}-${String(n).padStart(12, "0")}`;

/** A empresa que segue a plataforma e a de escolha própria, cada uma com um agente publicado. */
const SEGUE = { org: id(1), sessao: id(2), agente: id(3), versao: id(4) };
const PROPRIA = { org: id(11), sessao: id(12), agente: id(13), versao: id(14) };

/** O par da versão: o que vale para quem não segue. */
const DA_VERSAO = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  operador: "claude-haiku-4-5",
  reserva: { provider: "anthropic", model: "claude-haiku-4-5" },
};
const PLATAFORMA = { provider: "openai", model: "gpt-5.6-luna" };

async function definirPlataforma(provider: string | null, model: string | null): Promise<void> {
  await pool.query(
    `insert into public.platform_ia (id, provider, model_id) values (1, $1, $2)
     on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id`,
    [provider, model],
  );
}

async function montar(
  e: typeof SEGUE,
  nome: string,
  slug: string,
  opcoes: { segue: boolean; settings: Record<string, unknown> },
): Promise<string> {
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name, status, settings, ia_segue_a_plataforma)
     values ($1, $2, $3, $4, 'active', $5::jsonb, $6)`,
    [e.org, slug, `${nome} LTDA`, nome, JSON.stringify(opcoes.settings), opcoes.segue],
  );
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.ai_provider_credentials
       (organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
     values ($1, $2, 'chave da versão', '\\x00', '\\x00', '\\x00', '0309', true, now())
     returning id`,
    [e.org, DA_VERSAO.provider],
  );
  const credencial = rows[0]!.id;
  await pool.query(
    `insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`,
    [e.sessao, e.org, `${slug}-sessao`],
  );
  await pool.query(
    `insert into public.ai_agents (id, organization_id, name, system_prompt) values ($1, $2, 'Atendente', 'system')`,
    [e.agente, e.org],
  );
  await pool.query(
    `insert into public.ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        operator_enabled, operator_model, reserve_provider, reserve_model, channel_session_id, status)
     values ($1, $2, $3, 1, 'system', $4, $5, $6, true, $7, $8, $9, $10, 'published')`,
    [
      e.versao,
      e.org,
      e.agente,
      DA_VERSAO.provider,
      DA_VERSAO.model,
      credencial,
      DA_VERSAO.operador,
      DA_VERSAO.reserva.provider,
      DA_VERSAO.reserva.model,
      e.sessao,
    ],
  );
  await pool.query(`update public.ai_agents set published_version_id = $1 where id = $2`, [e.versao, e.agente]);
  return credencial;
}

/** As três portas da carga, na mesma empresa. */
async function asTresCargas(e: typeof SEGUE) {
  const cargas = await Promise.all([
    loadPublishedAgentConfig(pool, e.org, e.sessao),
    loadPublishedAgentConfigById(pool, e.org, e.agente),
    loadAgentVersionConfig(pool, e.org, e.agente, e.versao),
  ]);
  for (const c of cargas) expect(c).not.toBeNull();
  return cargas.map((c) => ({
    provider: c!.provider,
    model: c!.model,
    credentialId: c!.credentialId,
    operatorModel: c!.operatorModel,
    reserveProvider: c!.reserveProvider ?? null,
    reserveModel: c!.reserveModel ?? null,
  }));
}

let credencialDaPropria = "";

beforeAll(async () => {
  // A plataforma escolhe ANTES de a empresa nascer: o gatilho da 9172 já a
  // grava no par da plataforma, como acontece em produção.
  await definirPlataforma(PLATAFORMA.provider, PLATAFORMA.model);
  await montar(SEGUE, "Academia Alfa", "mia-309-segue", { segue: true, settings: {} });
  credencialDaPropria = await montar(PROPRIA, "Construtora Delta", "mia-309-propria", {
    segue: false,
    settings: { llm: { provider: "openrouter", default_model: "modelo-da-delta" } },
  });
});

beforeEach(async () => {
  await definirPlataforma(PLATAFORMA.provider, PLATAFORMA.model);
});

afterAll(async () => {
  await definirPlataforma(null, null);
  await pool.end();
});

describe("1 · quem segue responde no par da plataforma", () => {
  it("⭐ as três cargas devolvem o par de platform_ia, sem a credencial da versão; outro provedor tira operador e reserva", async () => {
    const { rows } = await pool.query<{ provider: string; modelo: string }>(
      `select settings->'llm'->>'provider' as provider, settings->'llm'->>'default_model' as modelo
         from public.organizations where id = $1`,
      [SEGUE.org],
    );
    expect(rows[0]).toEqual({ provider: PLATAFORMA.provider, modelo: PLATAFORMA.model });

    for (const carga of await asTresCargas(SEGUE)) {
      expect(carga).toEqual({
        provider: PLATAFORMA.provider,
        model: PLATAFORMA.model,
        credentialId: null,
        operatorModel: null,
        reserveProvider: null,
        reserveModel: null,
      });
    }
  });
});

describe("2 · trocar platform_ia troca a carga seguinte", () => {
  it("no mesmo provedor da versão: o modelo novo, sem a credencial, e o operador e a reserva ficam", async () => {
    await definirPlataforma("anthropic", "claude-haiku-5-5");
    for (const carga of await asTresCargas(SEGUE)) {
      expect(carga).toEqual({
        provider: "anthropic",
        model: "claude-haiku-5-5",
        credentialId: null,
        operatorModel: DA_VERSAO.operador,
        reserveProvider: DA_VERSAO.reserva.provider,
        reserveModel: DA_VERSAO.reserva.model,
      });
    }
  });
});

describe("3 · escolha própria fica na versão", () => {
  it("⭐ ia_segue_a_plataforma = false: o par, a credencial, o operador e a reserva da versão", async () => {
    for (const carga of await asTresCargas(PROPRIA)) {
      expect(carga).toEqual({
        provider: DA_VERSAO.provider,
        model: DA_VERSAO.model,
        credentialId: credencialDaPropria,
        operatorModel: DA_VERSAO.operador,
        reserveProvider: DA_VERSAO.reserva.provider,
        reserveModel: DA_VERSAO.reserva.model,
      });
    }
  });
});

describe("4 · platform_ia sem par", () => {
  it("instalação nova (ninguém escolheu na plataforma): quem segue também fica na versão", async () => {
    await definirPlataforma(null, null);
    for (const carga of await asTresCargas(SEGUE)) {
      expect(carga.provider).toBe(DA_VERSAO.provider);
      expect(carga.model).toBe(DA_VERSAO.model);
      expect(carga.credentialId).not.toBeNull();
      expect(carga.operatorModel).toBe(DA_VERSAO.operador);
    }
  });
});

/**
 * FORK MIA (MIA-337) · AS EMPRESAS DE CHAVE PRÓPRIA PASSAM À IA DA PLATAFORMA
 * — contra o Postgres nascido do baseline (migration 9176; desenho na MIA-285,
 * ponto 1, opção A).
 *
 * `fn_mia_chave_propria_passa_a_plataforma` pega, por dado, a empresa fora da
 * demonstração, com escolha própria e credencial `openai` ativa e validada;
 * desativa as `openai`, passa a empresa a seguir a plataforma, põe o teto de
 * `ai_budgets` em 3000 centavos de dólar no modo `avisar` e audita. Um caso por
 * item:
 *
 *  1. o baseline já rodou a passagem e gravou a marca;
 *  2. das quatro (openai + typesafe + versão presa à credencial; demonstração;
 *     já segue a plataforma; chave desativada), só a primeira muda; a typesafe
 *     e a versão publicada ficam; a segunda execução não muda nada;
 *  3. o turno da primeira: `resolveOrgLlmConfig` devolve a chave da instalação
 *     no padrão do painel e no agente (pela carga da versão e com a credencial
 *     da versão); o teto é o novo; o Jev continua achando a typesafe;
 *  4. o teto: sem linha, nasce com o teto explícito; saindo de `bloquear`,
 *     vira `avisar` e a carência zera;
 *  5. a guarda (o bloco 3 da migration, lido do arquivo): roda uma vez e grava
 *     a marca; quem escolhe chave própria depois fica;
 *  6. a função não é alcançável por anon nem authenticated.
 *
 * O banco é novo por arquivo (`vitest.db.config.ts`). Os nomes são os
 * fictícios do repositório.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAgentVersionConfig, loadPublishedAgentConfigById } from "@/lib/agent-engine/agent/agent-config";
import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { credencialEmUsoPeloJev } from "@/lib/ai/decisao/credencial";

import { numero, uuid, valor } from "./cobranca-helpers";
import { sql } from "./gov-helpers";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const P = "a0de9176-0000-4000-8000";
let sequencia = 0;
const novoId = () => uuid(P, ++sequencia);

const PLATAFORMA = { provider: "openai", model: "gpt-5.6-luna" };
/** O modelo próprio delas (o desenho achou 2 versões noutro modelo). */
const MODELO_PROPRIO = "gpt-5.4-mini";
const INSTALACAO = { openaiApiKey: "sk-teste-da-instalacao" };
const ACAO = "ai.chave_propria_passou_a_plataforma";

/** O bloco "uma vez só" da migration, como está no arquivo (seção 3). */
const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations-mia/20261127200000_9176_chave_propria_passa_a_plataforma.sql"),
  "utf8",
);
const GUARDA = (() => {
  const m = MIGRATION.match(/-- ── 3\. uma vez só[\s\S]*?(do \$\$[\s\S]*?end \$\$;)/);
  if (!m) throw new Error("o bloco 3 (uma vez só) da 9176 não foi achado no arquivo");
  return m[1]!;
})();

function definirPlataforma(provider: string, model: string): void {
  sql(`insert into public.platform_ia (id, provider, model_id) values (1, '${provider}', '${model}')
       on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id;`);
}

interface Empresa {
  org: string;
  credenciais: Record<string, string>;
}

function nascer(
  nome: string,
  opcoes: { segue: boolean; demonstracao?: boolean; modelo?: string },
): Empresa {
  const org = novoId();
  const settings = JSON.stringify({ llm: { provider: "openai", default_model: opcoes.modelo ?? MODELO_PROPRIO } });
  sql(`insert into public.organizations
         (id, slug, legal_name, display_name, status, settings, ia_segue_a_plataforma, demonstracao)
       values ('${org}', 'ia-9176-${sequencia}', '${nome} LTDA', '${nome}', 'active', '${settings}'::jsonb,
               ${opcoes.segue}, ${opcoes.demonstracao ?? false});`);
  return { org, credenciais: {} };
}

function credencial(e: Empresa, provider: string, opcoes: { ativa?: boolean; validada?: boolean } = {}): string {
  const id = novoId();
  sql(`insert into public.ai_provider_credentials
         (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
       values ('${id}', '${e.org}', '${provider}', 'chave ${provider}', '\\x00', '\\x00', '\\x00', '9176',
               ${opcoes.ativa ?? true}, ${opcoes.validada === false ? "null" : "now()"});`);
  e.credenciais[provider] = id;
  return id;
}

function teto(e: Empresa, centavos: number, modo: string, efetivoEm: string | null = null): void {
  sql(`insert into public.ai_budgets (organization_id, monthly_limit_cents, enforcement_mode, enforcement_effective_at)
       values ('${e.org}', ${centavos}, '${modo}', ${efetivoEm === null ? "null" : `'${efetivoEm}'`});`);
}

/** Um agente publicado com a versão presa à credencial (o caso das 4 em produção). */
function agentePreso(e: Empresa, credencialId: string): { agente: string; versao: string } {
  const sessao = novoId();
  const agente = novoId();
  const versao = novoId();
  sql(`insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
         values ('${sessao}', '${e.org}', 'ia-9176-sessao-${sequencia}', 'WORKING', '\\x00'::bytea);
       insert into public.ai_agents (id, organization_id, name, system_prompt)
         values ('${agente}', '${e.org}', 'Atendente', 'system');
       insert into public.ai_agent_versions
         (id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, channel_session_id, status)
         values ('${versao}', '${e.org}', '${agente}', 1, 'system', 'openai', '${MODELO_PROPRIO}', '${credencialId}', '${sessao}', 'published');
       update public.ai_agents set published_version_id = '${versao}' where id = '${agente}';`);
  return { agente, versao };
}

/** O estado que a passagem pode mudar, numa linha. */
function estado(e: Empresa): string {
  return valor(`select o.ia_segue_a_plataforma::text
                       || '|' || coalesce(o.settings->'llm'->>'provider', '∅') || '/' || coalesce(o.settings->'llm'->>'default_model', '∅')
                       || '|' || coalesce((select string_agg(c.provider || ':' || c.is_active::text || ':' || (c.validated_at is not null)::text, ',' order by c.provider)
                                             from public.ai_provider_credentials c where c.organization_id = o.id), '∅')
                       || '|' || coalesce((select b.monthly_limit_cents || ':' || b.enforcement_mode
                                             from public.ai_budgets b where b.organization_id = o.id), '∅')
                  from public.organizations o where o.id = '${e.org}';`);
}

function auditorias(e: Empresa): number {
  return numero(`select count(*) from public.api_audit_log where organization_id = '${e.org}' and action = '${ACAO}';`);
}

function metadata(e: Empresa): Record<string, unknown> {
  return JSON.parse(
    valor(`select metadata::text from public.api_audit_log where organization_id = '${e.org}' and action = '${ACAO}';`),
  ) as Record<string, unknown>;
}

function passar(): number {
  return numero(`select public.fn_mia_chave_propria_passa_a_plataforma();`);
}

// O par da plataforma vale para o arquivo todo: o gatilho da 9172 o grava em
// quem passa a seguir.
beforeAll(() => {
  definirPlataforma(PLATAFORMA.provider, PLATAFORMA.model);
});

afterAll(async () => {
  await pool.end();
});

describe("1 · o baseline já rodou a passagem", () => {
  it("a marca está gravada em platform_ia", () => {
    expect(valor(`select (chaves_proprias_passaram_em is not null)::text from public.platform_ia where id = 1;`)).toBe("true");
  });
});

describe("2 · só a empresa de chave própria passa", () => {
  let alfa: Empresa;
  let beta: Empresa;
  let vita: Empresa;
  let delta: Empresa;
  let versaoDaAlfa: { agente: string; versao: string };
  let antes: Record<string, string>;

  beforeAll(() => {
    // A de chave própria: openai e typesafe, teto 'off' e a versão presa à chave.
    alfa = nascer("Academia Alfa", { segue: false });
    credencial(alfa, "openai");
    credencial(alfa, "typesafe");
    teto(alfa, 5000, "off");
    versaoDaAlfa = agentePreso(alfa, alfa.credenciais.openai!);

    // Demonstração, com a mesma chave: fica.
    beta = nascer("Academia Beta", { segue: false, demonstracao: true });
    credencial(beta, "openai");

    // Já segue a plataforma (e tem chave openai): fica.
    vita = nascer("Vita Odonto", { segue: true });
    credencial(vita, "openai");

    // Escolha própria com a chave já desativada: fica.
    delta = nascer("Construtora Delta", { segue: false });
    credencial(delta, "openai", { ativa: false });

    antes = { beta: estado(beta), vita: estado(vita), delta: estado(delta) };
  });

  it("⭐ a Alfa passa: a openai desativada (validada ainda), segue a plataforma, teto em US$ 30 'avisar', typesafe ativa", () => {
    expect(estado(alfa)).toBe(`false|openai/${MODELO_PROPRIO}|openai:true:true,typesafe:true:true|5000:off`);

    expect(passar()).toBeGreaterThanOrEqual(1);

    expect(estado(alfa)).toBe(`true|openai/${PLATAFORMA.model}|openai:false:true,typesafe:true:true|3000:avisar`);
    expect(valor(`select alarm_threshold_pct::text from public.ai_budgets where organization_id = '${alfa.org}';`)).toBe("80");
  });

  it("⭐ a demonstração, a que já segue e a de chave desativada não mudam nem são auditadas", () => {
    expect({ beta: estado(beta), vita: estado(vita), delta: estado(delta) }).toEqual(antes);
    expect([auditorias(beta), auditorias(vita), auditorias(delta)]).toEqual([0, 0, 0]);
  });

  it("⭐ uma linha de auditoria, com o par, o teto e as credenciais de antes (de onde sai a volta)", () => {
    expect(auditorias(alfa)).toBe(1);
    expect(metadata(alfa)).toEqual({
      migration: "9176",
      antes: { provider: "openai", default_model: MODELO_PROPRIO, enabled_models: null },
      depois: { provider: PLATAFORMA.provider, default_model: PLATAFORMA.model },
      teto_antes: {
        monthly_limit_cents: 5000,
        enforcement_mode: "off",
        alarm_threshold_pct: 80,
        enforcement_effective_at: null,
      },
      teto_depois: { monthly_limit_cents: 3000, enforcement_mode: "avisar" },
      credenciais_desativadas: [alfa.credenciais.openai],
    });
  });

  it("a versão publicada não muda (provedor, modelo e credencial gravados ficam)", () => {
    expect(
      valor(`select provider || '|' || model || '|' || credential_id::text || '|' || status
               from public.ai_agent_versions where id = '${versaoDaAlfa.versao}';`),
    ).toBe(`openai|${MODELO_PROPRIO}|${alfa.credenciais.openai}|published`);
  });

  it("⭐ a segunda execução não muda nada nem audita", () => {
    const depois = { alfa: estado(alfa), beta: estado(beta), vita: estado(vita), delta: estado(delta) };
    expect(passar()).toBe(0);
    expect({ alfa: estado(alfa), beta: estado(beta), vita: estado(vita), delta: estado(delta) }).toEqual(depois);
    expect(auditorias(alfa)).toBe(1);
  });

  describe("3 · o turno da Alfa depois da passagem", () => {
    it("⭐ o padrão do painel (sem override): chave da instalação, no par da plataforma, com o teto novo", async () => {
      const config = await resolveOrgLlmConfig(pool, INSTALACAO, alfa.org);
      expect(config.origemDaChave).toBe("chave_da_instalacao");
      expect(config.apiKey).toBe(INSTALACAO.openaiApiKey);
      expect(config.provider).toBe(PLATAFORMA.provider);
      expect(config.defaultModel).toBe(PLATAFORMA.model);
      expect(config.orcamento.modo).toBe("avisar");
      expect(config.orcamento.tetoCents).toBe(3000);
    });

    it("⭐ o agente (pela carga da versão): o par da plataforma, sem a credencial da versão, e a chave da instalação", async () => {
      const cargas = await Promise.all([
        loadPublishedAgentConfigById(pool, alfa.org, versaoDaAlfa.agente),
        loadAgentVersionConfig(pool, alfa.org, versaoDaAlfa.agente, versaoDaAlfa.versao),
      ]);
      for (const carga of cargas) {
        expect(carga).not.toBeNull();
        expect([carga!.provider, carga!.model, carga!.credentialId]).toEqual([PLATAFORMA.provider, PLATAFORMA.model, null]);
        const config = await resolveOrgLlmConfig(pool, INSTALACAO, alfa.org, {
          provider: carga!.provider,
          credentialId: carga!.credentialId,
        });
        expect(config.origemDaChave).toBe("chave_da_instalacao");
      }
    });

    it("mesmo com a credencial da versão no override, a desativada não vale: chave da instalação", async () => {
      const config = await resolveOrgLlmConfig(pool, INSTALACAO, alfa.org, {
        provider: "openai",
        credentialId: alfa.credenciais.openai,
      });
      expect(config.origemDaChave).toBe("chave_da_instalacao");
      expect(config.apiKey).toBe(INSTALACAO.openaiApiKey);
    });

    it("⭐ o Jev continua achando a typesafe da Alfa", async () => {
      const { rows } = await pool.query<{ id: string; provider: string; is_active: boolean; validated_at: string | null; created_at: string }>(
        `select id, provider, is_active, validated_at::text as validated_at, created_at::text as created_at
           from public.ai_provider_credentials where organization_id = $1`,
        [alfa.org],
      );
      expect(credencialEmUsoPeloJev(rows)?.id).toBe(alfa.credenciais.typesafe);
    });
  });
});

describe("4 · o teto", () => {
  it("sem linha em ai_budgets: nasce com 3000 'avisar' (nunca o DEFAULT 5000), e teto_antes nulo na auditoria", () => {
    const e = nascer("Construtora Delta", { segue: false });
    credencial(e, "openai");
    passar();
    expect(estado(e)).toBe(`true|openai/${PLATAFORMA.model}|openai:false:true|3000:avisar`);
    expect(metadata(e).teto_antes).toBeNull();
  });

  it("saindo de 'bloquear': vira 'avisar' e a carência zera (a regra do desarme)", () => {
    const e = nascer("Vita Odonto", { segue: false });
    credencial(e, "openai");
    teto(e, 2000, "bloquear", "2026-11-01T00:00:00Z");
    passar();
    expect(
      valor(`select monthly_limit_cents || ':' || enforcement_mode || ':' || coalesce(enforcement_effective_at::text, '∅')
               from public.ai_budgets where organization_id = '${e.org}';`),
    ).toBe("3000:avisar:∅");
    expect((metadata(e).teto_antes as Record<string, unknown>).enforcement_mode).toBe("bloquear");
  });

  it("todas as openai ativas saem, validadas ou não; as já desativadas ficam fora da lista", () => {
    const e = nascer("Academia Alfa", { segue: false });
    const validada = credencial(e, "openai");
    const naoValidada = novoId();
    const desligada = novoId();
    sql(`insert into public.ai_provider_credentials
           (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
         values ('${naoValidada}', '${e.org}', 'openai', 'chave em teste', '\\x00', '\\x00', '\\x00', '9176', true, null),
                ('${desligada}', '${e.org}', 'openai', 'chave antiga', '\\x00', '\\x00', '\\x00', '9176', false, now());`);
    passar();
    expect(numero(`select count(*) from public.ai_provider_credentials where organization_id = '${e.org}' and is_active;`)).toBe(0);
    expect([...(metadata(e).credenciais_desativadas as string[])].sort()).toEqual([validada, naoValidada].sort());
  });
});

describe("5 · a guarda: uma vez só", () => {
  it("⭐ sem a marca, o bloco da migration passa quem cabe e grava a marca; quem escolhe chave própria depois fica", () => {
    sql(`update public.platform_ia set chaves_proprias_passaram_em = null where id = 1;`);

    const antesDaImplantacao = nascer("Academia Beta", { segue: false });
    credencial(antesDaImplantacao, "openai");

    sql(GUARDA);
    expect(estado(antesDaImplantacao).startsWith("true|")).toBe(true);
    expect(valor(`select (chaves_proprias_passaram_em is not null)::text from public.platform_ia where id = 1;`)).toBe("true");

    // Depois da implantação, uma empresa escolhe chave própria. A próxima
    // implantação roda o baseline de novo, e ela não volta.
    const depoisDaImplantacao = nascer("Construtora Delta", { segue: false });
    credencial(depoisDaImplantacao, "openai");
    const escolha = estado(depoisDaImplantacao);

    sql(GUARDA);
    expect(estado(depoisDaImplantacao)).toBe(escolha);
    expect(auditorias(depoisDaImplantacao)).toBe(0);
  });
});

describe("6 · fora do alcance da sessão", () => {
  it("anon e authenticated não executam a função", () => {
    expect(
      valor(`select has_function_privilege('anon', 'public.fn_mia_chave_propria_passa_a_plataforma()', 'execute')::text || '|' ||
                    has_function_privilege('authenticated', 'public.fn_mia_chave_propria_passa_a_plataforma()', 'execute')::text;`),
    ).toBe("false|false");
  });
});

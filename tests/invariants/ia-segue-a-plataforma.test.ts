/**
 * A IA DE TODA EMPRESA SEGUE A DA PLATAFORMA — contra o Postgres nascido do
 * baseline (migration 9172, MIA-217; desenho na MIA-216).
 *
 * `organizations.ia_segue_a_plataforma` diz quem segue `platform_ia`, e dois
 * gatilhos nossos mantêm `settings.llm` igual ao par da plataforma para quem
 * segue. O que só o banco prova, um caso por item:
 *
 *  1. empresa nova nasce seguindo, com o par da plataforma (e o seed do
 *     upstream não a devolve para a Anthropic);
 *  2. trocar `platform_ia` muda TODAS as que seguem, deixa intacta a de escolha
 *     própria e grava uma auditoria por empresa alterada;
 *  3. escrever outro par numa que segue volta para a plataforma; deixar de
 *     seguir na mesma escrita mantém a escolha;
 *  4. com molde de IA (9096), a empresa nova nasce com o molde e não segue;
 *  5. o conserto: passa a seguir só quem está no padrão semeado sem chave, no
 *     par da plataforma sem chave ou sem provedor; quem escolheu fica; a
 *     segunda execução não muda nada nem audita;
 *  6. o turno (`resolveOrgLlmConfig`) sem provedor no jsonb cai na plataforma,
 *     e não na Anthropic.
 *
 * Toda criação de empresa é feita como `service_role`, o papel do cadastro e
 * das rotas de servidor. Os nomes são os fictícios do repositório.
 */
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";

import { comoServidor, numero, uuid, valor } from "./cobranca-helpers";
import { sql } from "./gov-helpers";

const P = "a0de9172-0000-4000-8000";
let sequencia = 100;

const PLATAFORMA = { provider: "openai", model: "gpt-5.6-luna" };

function definirPlataforma(provider: string | null, model: string | null): void {
  const p = provider === null ? "null" : `'${provider}'`;
  const m = model === null ? "null" : `'${model}'`;
  sql(`insert into public.platform_ia (id, provider, model_id) values (1, ${p}, ${m})
       on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id;`);
}

/** A empresa nova, criada COMO O SERVIDOR CRIA. `segue` explícito = a coluna no insert. */
function nascer(nome: string, opcoes: { settings?: Record<string, unknown>; segue?: boolean } = {}): string {
  const id = uuid(P, ++sequencia);
  const settings = `'${JSON.stringify(opcoes.settings ?? {})}'::jsonb`;
  const colunaSegue = opcoes.segue === undefined ? "" : ", ia_segue_a_plataforma";
  const valorSegue = opcoes.segue === undefined ? "" : `, ${opcoes.segue}`;
  sql(
    comoServidor(`insert into public.organizations (id, slug, legal_name, display_name, status, settings${colunaSegue})
       values ('${id}', 'ia-9172-${sequencia}', '${nome} LTDA', '${nome}', 'active', ${settings}${valorSegue})`),
  );
  return id;
}

function llm(org: string): string {
  return valor(`select coalesce(settings->'llm'->>'provider', '∅') || '|' || coalesce(settings->'llm'->>'default_model', '∅')
                  from public.organizations where id = '${org}';`);
}

function segue(org: string): string {
  return valor(`select ia_segue_a_plataforma::text from public.organizations where id = '${org}';`);
}

function auditorias(org: string, acao: string): number {
  return numero(`select count(*) from public.api_audit_log where organization_id = '${org}' and action = '${acao}';`);
}

function credencial(org: string, provider: string): void {
  sql(`insert into public.ai_provider_credentials
         (organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
       values ('${org}', '${provider}', 'chave própria', '\\x00', '\\x00', '\\x00', '9172', true, now());`);
}

beforeEach(() => {
  sql(`update public.platform_settings set molde_de_ia_org_id = null where id = 1;`);
  definirPlataforma(PLATAFORMA.provider, PLATAFORMA.model);
});

afterAll(() => {
  sql(`update public.platform_settings set molde_de_ia_org_id = null where id = 1;`);
  definirPlataforma(null, null);
});

describe("1 · empresa nova nasce seguindo a plataforma", () => {
  it("⭐ nasce com ia_segue_a_plataforma e o par de platform_ia, não o padrão do produto", () => {
    const nova = nascer("Academia Alfa");
    expect(segue(nova)).toBe("true");
    expect(llm(nova)).toBe("openai|gpt-5.6-luna");
  });

  it("o resto de settings que o cadastro mandou fica", () => {
    const nova = nascer("Academia Alfa", { settings: { security: { mfa_required: true } } });
    expect(valor(`select settings->'security'->>'mfa_required' from public.organizations where id = '${nova}';`)).toBe("true");
  });

  it("sem par na plataforma (instalação nova): nasce como antes, seguindo, e recebe o par quando a plataforma escolher", () => {
    definirPlataforma(null, null);
    const nova = nascer("Academia Alfa");
    expect(segue(nova)).toBe("true");
    expect(llm(nova).startsWith("anthropic|")).toBe(true);

    definirPlataforma("openrouter", "openai/gpt-5-mini");
    expect(llm(nova)).toBe("openrouter|openai/gpt-5-mini");
  });
});

describe("2 · trocar platform_ia troca em todas as que seguem", () => {
  it("⭐ muda as que seguem, não toca a de escolha própria, e audita uma vez por empresa", () => {
    const a = nascer("Academia Alfa");
    const b = nascer("Academia Alfa");
    const propria = nascer("Construtora Delta", {
      settings: { llm: { provider: "openrouter", default_model: "modelo-da-delta" } },
      segue: false,
    });
    expect(llm(propria)).toBe("openrouter|modelo-da-delta");

    definirPlataforma("anthropic", "claude-haiku-5-5");

    expect(llm(a)).toBe("anthropic|claude-haiku-5-5");
    expect(llm(b)).toBe("anthropic|claude-haiku-5-5");
    expect(llm(propria)).toBe("openrouter|modelo-da-delta");
    expect(auditorias(a, "ai.padrao_seguiu_a_plataforma")).toBe(1);
    expect(auditorias(b, "ai.padrao_seguiu_a_plataforma")).toBe(1);
    expect(auditorias(propria, "ai.padrao_seguiu_a_plataforma")).toBe(0);
    expect(
      valor(`select metadata->'antes'->>'provider' || '>' || (metadata->'depois'->>'provider')
               from public.api_audit_log where organization_id = '${a}' and action = 'ai.padrao_seguiu_a_plataforma';`),
    ).toBe("openai>anthropic");
  });

  it("regravar o mesmo par não reescreve ninguém nem audita de novo", () => {
    const a = nascer("Academia Alfa");
    definirPlataforma(PLATAFORMA.provider, PLATAFORMA.model);
    expect(auditorias(a, "ai.padrao_seguiu_a_plataforma")).toBe(0);
  });

  it("par vazio ('automático') não apaga o par de ninguém", () => {
    const a = nascer("Academia Alfa");
    definirPlataforma(null, null);
    expect(llm(a)).toBe("openai|gpt-5.6-luna");
  });

  it("enabled_models sem o modelo novo sai (vazio = todos); com ele, fica", () => {
    const sem = nascer("Academia Alfa");
    const com = nascer("Academia Alfa");
    sql(`update public.organizations set settings = jsonb_set(settings, '{llm,enabled_models}', '["gpt-5.6-luna"]')
          where id = '${sem}';
         update public.organizations set settings = jsonb_set(settings, '{llm,enabled_models}', '["gpt-5.6-luna", "claude-haiku-5-5"]')
          where id = '${com}';`);
    definirPlataforma("anthropic", "claude-haiku-5-5");
    expect(valor(`select (settings->'llm' ? 'enabled_models')::text from public.organizations where id = '${sem}';`)).toBe("false");
    expect(valor(`select (settings->'llm' ? 'enabled_models')::text from public.organizations where id = '${com}';`)).toBe("true");
  });
});

describe("3 · quem segue só deixa de seguir pela coluna", () => {
  it("⭐ gravar outro par numa empresa que segue (onboarding, script) volta para a plataforma", () => {
    const a = nascer("Academia Alfa");
    sql(
      comoServidor(`update public.organizations
                       set settings = jsonb_set(settings, '{llm}', '{"provider":"anthropic","default_model":"claude-sonnet-5"}')
                     where id = '${a}'`),
    );
    expect(llm(a)).toBe("openai|gpt-5.6-luna");
  });

  it("deixar de seguir e gravar o par na MESMA escrita (o PATCH da tela) mantém a escolha", () => {
    const a = nascer("Vita Odonto");
    sql(
      comoServidor(`update public.organizations
                       set settings = jsonb_set(settings, '{llm}', '{"provider":"anthropic","default_model":"claude-sonnet-5"}'),
                           ia_segue_a_plataforma = false
                     where id = '${a}'`),
    );
    expect(segue(a)).toBe("false");
    expect(llm(a)).toBe("anthropic|claude-sonnet-5");
  });

  it("voltar a seguir põe o par da plataforma na hora", () => {
    const a = nascer("Vita Odonto", { settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } }, segue: false });
    sql(comoServidor(`update public.organizations set ia_segue_a_plataforma = true where id = '${a}'`));
    expect(llm(a)).toBe("openai|gpt-5.6-luna");
  });
});

describe("4 · com molde de IA, vence o molde", () => {
  it("⭐ a empresa nova nasce com o padrão do molde e NÃO segue a plataforma", () => {
    const molde = nascer("Construtora Delta", {
      settings: { llm: { provider: "openrouter", default_model: "modelo-do-molde" } },
      segue: false,
    });
    sql(`insert into public.platform_settings (id, molde_de_ia_org_id) values (1, '${molde}')
         on conflict (id) do update set molde_de_ia_org_id = excluded.molde_de_ia_org_id;`);

    const nova = nascer("Academia Alfa");
    expect(segue(nova)).toBe("false");
    expect(llm(nova)).toBe("openrouter|modelo-do-molde");

    // E a troca da plataforma não a alcança.
    definirPlataforma("anthropic", "claude-haiku-5-5");
    expect(llm(nova)).toBe("openrouter|modelo-do-molde");
  });
});

describe("5 · o conserto das empresas que já existem", () => {
  it("⭐ passa a seguir só quem não escolheu; quem escolheu fica; a segunda execução não muda nada", () => {
    // Como as empresas de antes da 9172: coluna false.
    const alfa = nascer("Academia Alfa", {
      settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } },
      segue: false,
    });
    const vita = nascer("Vita Odonto", {
      settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } },
      segue: false,
    });
    credencial(vita, "anthropic");
    const delta = nascer("Construtora Delta", {
      settings: { llm: { provider: "openai", default_model: "gpt-5.4-mini" } },
      segue: false,
    });
    credencial(delta, "openai");
    // B: já no par da plataforma, sem chave própria daquele provedor.
    const noPar = nascer("Academia Alfa", {
      settings: { llm: { provider: "openai", default_model: "gpt-5.6-luna" } },
      segue: false,
    });
    // C: sem provedor nenhum (o seed só roda no insert; o update tira o par).
    const semNada = nascer("Academia Alfa", { segue: false });
    sql(`update public.organizations set settings = '{}'::jsonb where id = '${semNada}';`);

    const mudaram = numero(`select public.fn_mia_ia_segue_a_plataforma_conserto();`);
    expect(mudaram).toBeGreaterThanOrEqual(3);

    expect([segue(alfa), llm(alfa)]).toEqual(["true", "openai|gpt-5.6-luna"]);
    expect([segue(noPar), llm(noPar)]).toEqual(["true", "openai|gpt-5.6-luna"]);
    expect([segue(semNada), llm(semNada)]).toEqual(["true", "openai|gpt-5.6-luna"]);
    expect([segue(vita), llm(vita)]).toEqual(["false", "anthropic|claude-sonnet-5"]);
    expect([segue(delta), llm(delta)]).toEqual(["false", "openai|gpt-5.4-mini"]);

    const acao = "ai.padrao_passou_a_seguir_a_plataforma";
    expect(auditorias(alfa, acao)).toBe(1);
    expect(auditorias(vita, acao)).toBe(0);
    expect(auditorias(delta, acao)).toBe(0);
    expect(
      valor(`select (metadata->>'condicao') || '|' || (metadata->'antes'->>'provider') || '|' || (metadata->'depois'->>'default_model')
                    || '|' || (metadata->>'migration')
               from public.api_audit_log where organization_id = '${alfa}' and action = '${acao}';`),
    ).toBe("A|anthropic|gpt-5.6-luna|9172");
    expect(valor(`select metadata->>'condicao' from public.api_audit_log where organization_id = '${noPar}' and action = '${acao}';`)).toBe("B");
    expect(valor(`select metadata->>'condicao' from public.api_audit_log where organization_id = '${semNada}' and action = '${acao}';`)).toBe("C");

    // A segunda execução não muda nada nem audita.
    expect(numero(`select public.fn_mia_ia_segue_a_plataforma_conserto();`)).toBe(0);
    expect(auditorias(alfa, acao)).toBe(1);
  });

  it("chave própria cadastrada e NÃO validada também é escolha: fica", () => {
    const tentou = nascer("Vita Odonto", {
      settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } },
      segue: false,
    });
    sql(`insert into public.ai_provider_credentials
           (organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
         values ('${tentou}', 'anthropic', 'chave em teste', '\\x00', '\\x00', '\\x00', '9172', true, null);`);
    sql(`select public.fn_mia_ia_segue_a_plataforma_conserto();`);
    expect(segue(tentou)).toBe("false");
  });

  it("a migration deixou o default em true (quem nasce depois segue)", () => {
    expect(
      valor(`select column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'organizations' and column_name = 'ia_segue_a_plataforma';`),
    ).toBe("true");
  });

  it("as funções novas não são alcançáveis por anon nem authenticated", () => {
    for (const fn of [
      "fn_mia_ia_segue_a_plataforma()",
      "fn_mia_platform_ia_propaga()",
      "fn_mia_ia_segue_a_plataforma_conserto()",
      "fn_mia_llm_com_o_par(jsonb, text, text)",
    ]) {
      expect(
        valor(`select has_function_privilege('anon', 'public.${fn}', 'execute')::text || '|' ||
                      has_function_privilege('authenticated', 'public.${fn}', 'execute')::text;`),
        fn,
      ).toBe("false|false");
    }
  });
});

describe("6 · o turno sem provedor no jsonb cai na plataforma", () => {
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
    max: 1,
  });
  afterAll(async () => {
    await pool.end();
  });

  it("⭐ resolveOrgLlmConfig devolve o par de platform_ia, e não o 'anthropic' do .catch", async () => {
    const org = nascer("Construtora Delta", { segue: false });
    sql(`update public.organizations set settings = '{"llm": {"params": {}}}'::jsonb where id = '${org}';`);

    const config = await resolveOrgLlmConfig(pool, { openaiApiKey: "sk-teste-da-instalacao" }, org);
    expect(config.provider).toBe("openai");
    expect(config.defaultModel).toBe("gpt-5.6-luna");
    expect(config.orcamentoIndisponivelPorque).toBeNull();
  });

  it("com provedor no jsonb, vale o da empresa (a plataforma não passa por cima)", async () => {
    const org = nascer("Construtora Delta", {
      settings: { llm: { provider: "openai", default_model: "gpt-5.4-mini" } },
      segue: false,
    });
    const config = await resolveOrgLlmConfig(pool, { openaiApiKey: "sk-teste-da-instalacao" }, org);
    expect(config.defaultModel).toBe("gpt-5.4-mini");
  });
});

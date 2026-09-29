import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

/**
 * FORK MIA — migration 9002: a IA dos agentes é da plataforma também no BANCO.
 *
 * O PostgREST é exposto ao navegador por construção, e o admin da empresa fala
 * com ele direto, com o próprio JWT, sem passar por rota nenhuma do Next. As
 * políticas do upstream deixam esse admin escrever em `ai_agent_versions`,
 * `ai_agents`, `ai_routers`, `ai_purpose_bindings` e `ai_provider_credentials`
 * — e na MIA provedor, modelo e chave são escolha da plataforma. Os gatilhos
 * `trg_mia_trava_ia_*` fecham isso só para a sessão de cliente.
 *
 * Cada recusa vem em par com o controle que prova que a trava não passou do
 * ponto: o mesmo admin continua editando o prompt; o dono da plataforma, o
 * servidor (`service_role`) e o motor (conexão direta) continuam trocando a IA.
 * E o último caso sabota o gatilho para provar que é ele quem segura.
 *
 * Tudo dentro de `begin … rollback`: nenhum caso deixa rastro para o seguinte.
 */

const PLATAFORMA = "eeeeeeee-9002-4000-8000-000000000001";
const AGENTE = "eeeeeeee-9002-4000-8000-000000000010";
const CRED = "eeeeeeee-9002-4000-8000-000000000020";
const V_ANTIGA = "eeeeeeee-9002-4000-8000-000000000031";
const V_NO_AR = "eeeeeeee-9002-4000-8000-000000000032";
const V_RASCUNHO = "eeeeeeee-9002-4000-8000-000000000033";
const ROTEADOR = "eeeeeeee-9002-4000-8000-000000000040";

function semear(): void {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${PLATAFORMA}', 'plataforma-9002@invariant.test')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${PLATAFORMA}', '${GOV_ORG}', 'admin', now()) on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, reason)
      values ('${PLATAFORMA}', '${PLATAFORMA}', 'invariante 9002') on conflict do nothing;

    insert into public.platform_ia (id, provider, model_id) values (1, 'openai', 'modelo-da-plataforma')
      on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id;

    insert into public.ai_provider_credentials
      (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, validated_at)
      values ('${CRED}', '${GOV_ORG}', 'openai', 'Chave da plataforma 9002',
              '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, '9002', now())
      on conflict do nothing;

    insert into public.ai_agents (id, organization_id, name, system_prompt, kind)
      values ('${AGENTE}', '${GOV_ORG}', 'Agente 9002', 'prompt do cadastro', 'mcp_agent')
      on conflict do nothing;
    insert into public.ai_agent_versions
      (id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, channel_session_id, status)
    values
      ('${V_ANTIGA}',   '${GOV_ORG}', '${AGENTE}', 1, 'v1', 'openai', 'modelo-antigo', '${CRED}', '${GOV_SESSION}', 'superseded'),
      ('${V_NO_AR}',    '${GOV_ORG}', '${AGENTE}', 2, 'v2', 'openai', 'modelo-atual',  '${CRED}', '${GOV_SESSION}', 'published'),
      ('${V_RASCUNHO}', '${GOV_ORG}', '${AGENTE}', 3, 'v3', 'openai', 'modelo-atual',  '${CRED}', '${GOV_SESSION}', 'draft')
    on conflict do nothing;
    update public.ai_agents set published_version_id = '${V_NO_AR}' where id = '${AGENTE}';

    -- Como na produção (medido em 29/09): authenticated tem escrita nestas duas.
    grant select, insert, update, delete on public.ai_purpose_bindings to authenticated;
    grant select, insert, update, delete on public.ai_routers to authenticated;
    insert into public.ai_routers (id, organization_id, name, channel_session_id, is_active, config)
      values ('${ROTEADOR}', '${GOV_ORG}', 'Roteador 9002', '${GOV_SESSION}', false, '{"sticky": true}')
      on conflict do nothing;
  `);
}

type Papel = "authenticated" | "service_role" | "postgres";

interface Tentativa {
  /** Linhas escritas; `null` quando o banco recusou. */
  linhas: number | null;
  erro: string;
}

/**
 * Roda a escrita COMO o papel, com os claims que o PostgREST põe (sub + role),
 * e desfaz. `prefixo` roda antes da troca de papel, como `postgres`.
 */
function tentar(papel: Papel, sub: string | null, dml: string, prefixo = ""): Tentativa {
  const claims = JSON.stringify(sub ? { sub, role: papel } : { role: papel });
  const troca =
    papel === "postgres"
      ? ""
      : `set local role ${papel};
         select set_config('request.jwt.claims', '${claims}', true);`;
  try {
    const out = sql(`
      begin;
      ${prefixo}
      ${troca}
      with w as (${dml} returning 1) select 'LINHAS=' || count(*) from w;
      rollback;
    `);
    const m = out.match(/LINHAS=(\d+)/);
    if (!m) throw new Error(`saída inesperada: ${out}`);
    return { linhas: Number(m[1]), erro: "" };
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? String(e);
    return { linhas: null, erro: stderr };
  }
}

const recusadoPelaTrava = (t: Tentativa) =>
  t.linhas === null && /ia_da_plataforma/.test(t.erro);

const NOVA_VERSAO = (provider: string, model: string, credencial: string | null) => `
  insert into public.ai_agent_versions
    (organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, channel_session_id, status)
  values ('${GOV_ORG}', '${AGENTE}', 99, 'nova', '${provider}', '${model}',
          ${credencial ? `'${credencial}'` : "null"}, '${GOV_SESSION}', 'draft')`;

beforeAll(semear);

describe("9002 — o admin da EMPRESA não troca a IA pelo PostgREST", () => {
  it("não troca o modelo de um rascunho", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agent_versions set model = 'modelo-do-cliente' where id = '${V_RASCUNHO}'`);
    expect(recusadoPelaTrava(t), t.erro).toBe(true);
  });

  it("não troca a chave nem o modelo do Operador", () => {
    for (const set of ["credential_id = null", "operator_model = 'modelo-do-cliente'", "provider = 'anthropic'"]) {
      const t = tentar("authenticated", GOV_ADMIN,
        `update public.ai_agent_versions set ${set} where id = '${V_RASCUNHO}'`);
      expect(recusadoPelaTrava(t), `${set}: ${t.erro}`).toBe(true);
    }
  });

  it("CONTROLE: continua editando o prompt do mesmo rascunho", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agent_versions set system_prompt = 'editado' where id = '${V_RASCUNHO}'`);
    expect(t.linhas, t.erro).toBe(1);
  });

  it("não cria versão com outro modelo", () => {
    const t = tentar("authenticated", GOV_ADMIN, NOVA_VERSAO("openai", "modelo-do-cliente", CRED));
    expect(recusadoPelaTrava(t), t.erro).toBe(true);
  });

  it("CONTROLE: cria versão com a IA atual do agente, ou com o par da plataforma", () => {
    expect(tentar("authenticated", GOV_ADMIN, NOVA_VERSAO("openai", "modelo-atual", CRED)).linhas).toBe(1);
    expect(tentar("authenticated", GOV_ADMIN, NOVA_VERSAO("openai", "modelo-da-plataforma", null)).linhas).toBe(1);
  });

  it("não põe no ar uma versão antiga com outro modelo mexendo no ponteiro", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agents set published_version_id = '${V_ANTIGA}' where id = '${AGENTE}'`);
    expect(recusadoPelaTrava(t), t.erro).toBe(true);
  });

  it("CONTROLE: põe no ar o rascunho que tem a IA atual", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agents set published_version_id = '${V_RASCUNHO}' where id = '${AGENTE}'`);
    expect(t.linhas, t.erro).toBe(1);
  });

  it("não troca o modelo do cadastro nem o modelo de voz; o prompt continua dele", () => {
    const modelo = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agents set model = 'anthropic/claude-opus-4-7' where id = '${AGENTE}'`);
    expect(recusadoPelaTrava(modelo), modelo.erro).toBe(true);
    const voz = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agents set config = config || '{"voice_model":"gpt-realtime-mini"}' where id = '${AGENTE}'`);
    expect(recusadoPelaTrava(voz), voz.erro).toBe(true);
    const prompt = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agents set system_prompt = 'dele' where id = '${AGENTE}'`);
    expect(prompt.linhas, prompt.erro).toBe(1);
  });

  it("não mexe na chave da plataforma: nem endereço, nem apagar, nem criar", () => {
    const endereco = tentar("authenticated", GOV_ADMIN,
      `update public.ai_provider_credentials set provider = 'custom', base_url = 'https://atacante.example/v1' where id = '${CRED}'`);
    expect(recusadoPelaTrava(endereco), endereco.erro).toBe(true);
    const apagar = tentar("authenticated", GOV_ADMIN,
      `delete from public.ai_provider_credentials where id = '${CRED}'`);
    expect(recusadoPelaTrava(apagar), apagar.erro).toBe(true);
  });

  it("não escolhe o modelo de um ponto", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `insert into public.ai_purpose_bindings (organization_id, purpose, provider, model_id)
       values ('${GOV_ORG}', 'compaction', 'openai', 'modelo-do-cliente')`);
    expect(recusadoPelaTrava(t), t.erro).toBe(true);
  });

  it("roteador: o novo nasce no Automático e o existente não troca de classificador", () => {
    const out = sql(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_ADMIN}","role":"authenticated"}', true);
      insert into public.ai_routers (organization_id, name, channel_session_id, is_active, config)
        values ('${GOV_ORG}', 'novo', '${GOV_SESSION}', false,
                '{"classifier_model":"modelo-do-cliente","classifier_provider":"openai"}')
        returning 'CONFIG=' || coalesce(config ->> 'classifier_model', 'nulo') || '/' || coalesce(config ->> 'classifier_provider', 'nulo');
      rollback;
    `);
    expect(out).toContain("CONFIG=nulo/nulo");

    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_routers set config = config || '{"classifier_model":"modelo-do-cliente"}' where id = '${ROTEADOR}'`);
    expect(recusadoPelaTrava(t), t.erro).toBe(true);
  });

  it("o padrão de IA da empresa: a RLS já barra, e o gatilho segura se ela abrir", () => {
    const hoje = tentar("authenticated", GOV_ADMIN,
      `update public.organizations set settings = jsonb_set(coalesce(settings, '{}'), '{llm}', '{"provider":"anthropic"}') where id = '${GOV_ORG}'`);
    expect(hoje.linhas, hoje.erro).toBe(0);

    // O dia em que o upstream deixar outro papel escrever em organizations.
    const aberta = tentar("authenticated", GOV_ADMIN,
      `update public.organizations set settings = jsonb_set(coalesce(settings, '{}'), '{llm}', '{"provider":"anthropic"}') where id = '${GOV_ORG}'`,
      `create policy tmp_9002_upstream_abriu on public.organizations for update to authenticated using (true) with check (true);`);
    expect(recusadoPelaTrava(aberta), aberta.erro).toBe(true);
  });
});

describe("9002 — quem escolhe a IA continua escolhendo", () => {
  it("o dono da plataforma troca modelo, ponteiro e ponto pelo PostgREST", () => {
    expect(tentar("authenticated", PLATAFORMA,
      `update public.ai_agent_versions set model = 'modelo-novo' where id = '${V_RASCUNHO}'`).linhas).toBe(1);
    expect(tentar("authenticated", PLATAFORMA,
      `update public.ai_agents set published_version_id = '${V_ANTIGA}' where id = '${AGENTE}'`).linhas).toBe(1);
    expect(tentar("authenticated", PLATAFORMA,
      `insert into public.ai_purpose_bindings (organization_id, purpose, provider, model_id)
       values ('${GOV_ORG}', 'compaction', 'openai', 'modelo-novo')`).linhas).toBe(1);
  });

  it("o servidor (service_role) passa sem ser tocado", () => {
    expect(tentar("service_role", null,
      `update public.ai_agent_versions set model = 'modelo-novo' where id = '${V_RASCUNHO}'`).linhas).toBe(1);
    expect(tentar("service_role", null,
      `update public.ai_provider_credentials set base_url = 'https://proxy.interno/v1' where id = '${CRED}'`).linhas).toBe(1);
  });

  it("o motor (conexão direta) passa sem ser tocado", () => {
    expect(tentar("postgres", null,
      `update public.ai_agent_versions set model = 'modelo-novo' where id = '${V_RASCUNHO}'`).linhas).toBe(1);
  });
});

describe("9002 — o instrumento enxerga o buraco quando a trava some", () => {
  it("sem o gatilho, o mesmo admin da empresa troca o modelo (controle negativo)", () => {
    const t = tentar("authenticated", GOV_ADMIN,
      `update public.ai_agent_versions set model = 'modelo-do-cliente' where id = '${V_RASCUNHO}'`,
      `drop trigger trg_mia_trava_ia_versao on public.ai_agent_versions;`);
    expect(t.linhas, t.erro).toBe(1);
  });

  it("as funções da trava não são chamáveis por RPC", () => {
    const out = sql(`
      select 'EXPOSTAS=' || count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and (p.proname like 'fn_mia_trava_ia_%' or p.proname in ('fn_mia_escrita_de_cliente', 'fn_mia_ia_permitida'))
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
              or has_function_privilege('anon', p.oid, 'EXECUTE'));
    `);
    expect(out).toContain("EXPOSTAS=0");
  });
});

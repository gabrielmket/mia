import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (MIA-169, migration 9170) · AS REGRAS DE CONVERSÃO DO SITE, no
 * Postgres de verdade.
 *
 * O que se prova:
 *  - os CHECKs nossos: os 4 eventos de site (e nenhum outro), um destino por
 *    regra (Meta com evento, Google com ação só de dígitos), Purchase e
 *    Subscribe sempre com `leva_valor`;
 *  - VÁRIAS regras por etapa, mas uma por (etapa, evento) e por (etapa, ação);
 *  - a FK composta: a etapa é da MESMA empresa, e apagar a etapa leva a regra;
 *  - `enabled` nasce falso, e o gatilho de `configured_at` com o contrato da
 *    trava da 0524 (mudar destino ou valor, ou religar, carimba agora; desligar
 *    e o resto não mexem);
 *  - a chave no livro-razão do upstream: `MetaEtapa:<id da regra>` entra em
 *    `ad_conversion_dispatches` e `fn_solicitar_reenvio_conversao` aceita o
 *    reenvio pelo retrato, sem mudança no upstream;
 *  - exclusiva do servidor: RLS ligada com ZERO políticas, o administrador da
 *    PRÓPRIA empresa e anon recebem `permission denied` em select, insert,
 *    update e delete; o service_role lê (controle positivo);
 *  - a migration aplicada de novo não falha nem mexe nas linhas.
 *
 * Dado fictício: empresas e etapas inventadas.
 */
const ORG = "e9170e91-0000-4000-8000-00000000000a";
const OUTRA = "e9170e91-0000-4000-8000-00000000000b";
const ADMIN = "e9170e91-1111-4000-8000-00000000000a";
const FUNIL = "e9170e91-2222-4000-8000-00000000000a";
const FUNIL_OUTRA = "e9170e91-2222-4000-8000-00000000000b";
const CADASTRO = "e9170e91-3333-4000-8000-0000000000a1";
const ASSINANTE = "e9170e91-3333-4000-8000-0000000000a2";
const DESCARTAVEL = "e9170e91-3333-4000-8000-0000000000a3";
const ETAPA_DA_OUTRA = "e9170e91-3333-4000-8000-0000000000b1";
const REGRA = "e9170e91-4444-4000-8000-000000000001";
const CONTATO = "e9170e91-5555-4000-8000-000000000001";
const LEAD = "e9170e91-6666-4000-8000-000000000001";

const MIGRATION = join(__dirname, "..", "..", "supabase", "migrations-mia", "20261124180000_9170_regras_de_conversao_do_site.sql");

/** Roda um comando no papel pedido e devolve o SQLSTATE da recusa, ou `passou`. */
function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9170', 'passou', false);
        exception when others then
          perform set_config('inv.r9170', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9170');
    `),
  );
}

const regra = (cols: string, vals: string) => `insert into public.mia_regras_de_conversao_do_site (organization_id, stage_id, ${cols}) values ('${ORG}', ${vals})`;
const um = (q: string) => lastLine(sql(q));

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ADMIN}', 'regras-9170@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'regras-9170-a', 'Site A', 'Site A'),
      ('${OUTRA}', 'regras-9170-b', 'Site B', 'Site B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN}', '${ORG}', 'admin', now()) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${FUNIL}', '${ORG}', 'Vendas', 'vendas-9170-a'),
      ('${FUNIL_OUTRA}', '${OUTRA}', 'Vendas', 'vendas-9170-b')
      on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won) values
      ('${CADASTRO}', '${ORG}', '${FUNIL}', 'Cadastro concluído', 'cadastro-9170', 1000, false),
      ('${ASSINANTE}', '${ORG}', '${FUNIL}', 'Assinante', 'assinante-9170', 2000, false),
      ('${DESCARTAVEL}', '${ORG}', '${FUNIL}', 'Descartável', 'descartavel-9170', 3000, false),
      ('${ETAPA_DA_OUTRA}', '${OUTRA}', '${FUNIL_OUTRA}', 'Cadastro concluído', 'cadastro-9170-b', 1000, false)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, name, phone_number, email, source_metadata)
      values ('${CONTATO}', '${ORG}', 'Pessoa de teste', '+5500900009170', 'pessoa@exemplo.invalid', '{}'::jsonb)
      on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status)
      values ('${LEAD}', '${ORG}', '${FUNIL}', '${CADASTRO}', '${CONTATO}', 'Negócio de teste', 'open')
      on conflict (id) do nothing;
    insert into public.mia_regras_de_conversao_do_site (id, organization_id, stage_id, plataforma, evento_meta, configured_at)
      values ('${REGRA}', '${ORG}', '${CADASTRO}', 'meta_ads', 'CompleteRegistration', now() - interval '1 day')
      on conflict (id) do nothing;
  `);
});

describe("os CHECKs e as unicidades", () => {
  it("⭐ só os 4 eventos de site, um destino por regra, e Purchase/Subscribe com valor", () => {
    expect(tentar("postgres", regra("plataforma, evento_meta", `'${ASSINANTE}', 'meta_ads', 'LeadSubmitted'`))).toBe("23514");
    expect(tentar("postgres", regra("plataforma, evento_meta, google_acao_id", `'${ASSINANTE}', 'meta_ads', 'StartTrial', '7000000001'`))).toBe("23514");
    expect(tentar("postgres", regra("plataforma", `'${ASSINANTE}', 'google_ads'`))).toBe("23514");
    expect(tentar("postgres", regra("plataforma, google_acao_id", `'${ASSINANTE}', 'google_ads', 'AW-123'`))).toBe("23514");
    expect(tentar("postgres", regra("plataforma, evento_meta, leva_valor", `'${ASSINANTE}', 'meta_ads', 'Purchase', false`))).toBe("23514");
    expect(tentar("postgres", regra("plataforma, evento_meta, leva_valor", `'${ASSINANTE}', 'meta_ads', 'Subscribe', false`))).toBe("23514");
  });

  it("⭐ várias regras por etapa, uma por (etapa, evento) e por (etapa, ação)", () => {
    expect(tentar("postgres", regra("plataforma, evento_meta, leva_valor", `'${ASSINANTE}', 'meta_ads', 'Subscribe', true`))).toBe("passou");
    expect(tentar("postgres", regra("plataforma, evento_meta, leva_valor", `'${ASSINANTE}', 'meta_ads', 'Purchase', true`))).toBe("passou");
    expect(tentar("postgres", regra("plataforma, google_acao_id, leva_valor", `'${ASSINANTE}', 'google_ads', '7000000013', true`))).toBe("passou");
    expect(tentar("postgres", regra("plataforma, evento_meta, leva_valor", `'${ASSINANTE}', 'meta_ads', 'Purchase', true`))).toBe("23505");
    expect(tentar("postgres", regra("plataforma, google_acao_id", `'${ASSINANTE}', 'google_ads', '7000000013'`))).toBe("23505");
    expect(um(`select count(*) from public.mia_regras_de_conversao_do_site where stage_id = '${ASSINANTE}';`)).toBe("3");
  });

  it("a etapa tem de ser da MESMA empresa, e apagar a etapa leva a regra", () => {
    expect(tentar("postgres", regra("plataforma, evento_meta", `'${ETAPA_DA_OUTRA}', 'meta_ads', 'StartTrial'`))).toBe("23503");
    sql(regra("plataforma, evento_meta", `'${DESCARTAVEL}', 'meta_ads', 'StartTrial'`) + ";");
    sql(`delete from public.crm_stages where id = '${DESCARTAVEL}';`);
    expect(um(`select count(*) from public.mia_regras_de_conversao_do_site where stage_id = '${DESCARTAVEL}';`)).toBe("0");
  });
});

describe("enabled e configured_at", () => {
  it("⭐ nasce desligada, e o gatilho carimba configured_at como a trava da 0524", () => {
    const carimbo = () =>
      Number(um(`select extract(epoch from configured_at)::float8 from public.mia_regras_de_conversao_do_site where id = '${REGRA}';`));
    expect(um(`select enabled::text from public.mia_regras_de_conversao_do_site where id = '${REGRA}';`)).toBe("false");
    const antes = carimbo();
    expect(antes).toBeLessThan(Date.now() / 1000 - 3600);

    // Ligar carimba agora: ligar não despeja o histórico do funil.
    sql(`update public.mia_regras_de_conversao_do_site set enabled = true where id = '${REGRA}';`);
    const ligada = carimbo();
    expect(ligada).toBeGreaterThan(antes);

    // Desligar, e mexer só no carimbo à mão, não mexem: o gatilho guarda o de antes.
    sql(`update public.mia_regras_de_conversao_do_site set enabled = false where id = '${REGRA}';`);
    sql(`update public.mia_regras_de_conversao_do_site set configured_at = now() - interval '2 days' where id = '${REGRA}';`);
    expect(carimbo()).toBe(ligada);

    // Mudar o destino carimba de novo.
    sql(`update public.mia_regras_de_conversao_do_site set evento_meta = 'StartTrial' where id = '${REGRA}';`);
    expect(carimbo()).toBeGreaterThan(ligada);
  });
});

describe("a chave no livro-razão do upstream", () => {
  it("⭐ `MetaEtapa:<id da regra>` entra no livro-razão e o reenvio pelo retrato é aceito", () => {
    sql(`
      insert into public.ad_conversion_dispatches
        (organization_id, lead_id, platform, event_name, status, reason, event_id, event_occurred_at, meta_event_name)
      values ('${ORG}', '${LEAD}', 'meta_ads', 'MetaEtapa:${REGRA}', 'error', 'recusado_pela_plataforma',
              '${LEAD}:MetaEtapa:${REGRA}', now() - interval '1 hour', 'CompleteRegistration');
    `);
    expect(um(`select public.fn_solicitar_reenvio_conversao('${ORG}', '${LEAD}', 'MetaEtapa:${REGRA}')::text;`)).toBe("true");
    expect(
      um(`select count(*) from public.event_log where entity_id = '${LEAD}' and event_type = 'ad_conversion.retry_requested' and payload->>'event_name' = 'MetaEtapa:${REGRA}';`),
    ).toBe("1");
  });
});

describe("só o servidor lê e escreve", () => {
  it("RLS ligada e nenhuma política", () => {
    expect(um(`select relrowsecurity::text from pg_class where oid = 'public.mia_regras_de_conversao_do_site'::regclass;`)).toBe("true");
    expect(um(`select count(*) from pg_policy where polrelid = 'public.mia_regras_de_conversao_do_site'::regclass;`)).toBe("0");
  });

  it("⭐ o administrador da PRÓPRIA empresa e anon recebem permission denied; o service_role lê", () => {
    for (const papel of ["authenticated", "anon"] as const) {
      expect(tentar(papel, `perform 1 from public.mia_regras_de_conversao_do_site where organization_id = '${ORG}'`)).toBe("42501");
      expect(tentar(papel, regra("plataforma, evento_meta", `'${CADASTRO}', 'meta_ads', 'StartTrial'`))).toBe("42501");
      expect(tentar(papel, `update public.mia_regras_de_conversao_do_site set enabled = true where id = '${REGRA}'`)).toBe("42501");
      expect(tentar(papel, `delete from public.mia_regras_de_conversao_do_site where id = '${REGRA}'`)).toBe("42501");
    }
    expect(um(`set role service_role; select count(*) from public.mia_regras_de_conversao_do_site where id = '${REGRA}';`)).toBe("1");
  });
});

describe("a migration aplicada de novo", () => {
  it("não falha e não mexe nas linhas", () => {
    const antes = um(`select count(*) from public.mia_regras_de_conversao_do_site where organization_id = '${ORG}';`);
    sql(readFileSync(MIGRATION, "utf8"));
    expect(um(`select count(*) from public.mia_regras_de_conversao_do_site where organization_id = '${ORG}';`)).toBe(antes);
  });
});

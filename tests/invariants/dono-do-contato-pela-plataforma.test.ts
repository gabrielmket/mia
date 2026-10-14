/**
 * 9022 · O DONO DO CONTATO PELA PLATAFORMA — a função do fork
 * `fn_mia_definir_dono_do_contato_pela_plataforma`, no Postgres de verdade.
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. CONTROLE NEGATIVO: a porta do upstream (`fn_definir_carteira_do_cliente`,
 *    0622) RECUSA o ator do MCP de plataforma (o criador do token, que não é
 *    membro da empresa). É por isso que a 9022 existe; sem esta prova, a função
 *    nova poderia ser só um segundo caminho para o que já passava.
 * 2. Com um token de plataforma vivo, que carrega `importar_base` e foi criado
 *    por um admin de plataforma de escopo cheio, a função grava o trio do dono
 *    (`carteira_*`, origem `importacao`) e adota, na mesma transação, os
 *    negócios ABERTOS sem dono daquele contato. Negócio com dono não muda.
 * 3. O corpo copiado é o mesmo do upstream: dono `viewer` e contato de outra
 *    empresa são recusados com as MESMAS frases da porta do upstream.
 * 4. O ator: token sem a operação, revogado, vencido, ou cujo criador deixou de
 *    ser admin de plataforma, é recusado (42501). E só o `service_role` executa.
 *
 * Organização própria (namespace `ecececec-`) para não encostar nas fixtures
 * dos outros arquivos. Nenhum dado de cliente real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "ecececec-0000-4000-8000-000000000001";
const OUTRA_ORG = "ecececec-0000-4000-8000-000000000002";
const ADMIN_DA_PLATAFORMA = "ecececec-1111-4000-8000-000000000001"; // cria o token; NÃO é membro da empresa
const EX_ADMIN = "ecececec-1111-4000-8000-000000000002"; // criou um token e deixou de ser admin de plataforma
const VENDEDORA = "ecececec-1111-4000-8000-000000000003"; // agent da empresa: pode ser dona
const SO_LE = "ecececec-1111-4000-8000-000000000004"; // viewer: não conta
const GERENTE = "ecececec-1111-4000-8000-000000000005"; // manager membro: o ator da porta do upstream

const TOKEN_VIVO = "ecececec-2222-4000-8000-000000000001";
const TOKEN_SEM_IMPORTAR = "ecececec-2222-4000-8000-000000000002";
const TOKEN_REVOGADO = "ecececec-2222-4000-8000-000000000003";
const TOKEN_VENCIDO = "ecececec-2222-4000-8000-000000000004";
const TOKEN_DO_EX_ADMIN = "ecececec-2222-4000-8000-000000000005";

const PIPELINE = "ecececec-5555-4000-8000-000000000001";
const ETAPA = "ecececec-5555-4000-8000-000000000002";
const CONTATO = "ecececec-3333-4000-8000-000000000001";
const CONTATO_DO_UPSTREAM = "ecececec-3333-4000-8000-000000000002";
const CONTATO_ALHEIO = "ecececec-3333-4000-8000-000000000003";
const NEGOCIO_SEM_DONO = "ecececec-4444-4000-8000-000000000001";
const NEGOCIO_COM_DONO = "ecececec-4444-4000-8000-000000000002";
const NEGOCIO_DO_UPSTREAM = "ecececec-4444-4000-8000-000000000003";

/** Chama a função do fork como o MCP chama: `service_role`. Devolve o stderr quando recusa. */
function pelaPlataforma(token: string, contato: string, dono: string | null, org = ORG): string {
  try {
    sql(`
      set role service_role;
      select public.fn_mia_definir_dono_do_contato_pela_plataforma('${org}', '${token}', '${contato}', ${dono ? `'${dono}'` : "null"}, 'importacao');
    `);
    return "";
  } catch (err) {
    return ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
  }
}

/** A porta do upstream, com o ator que se pedir. */
function pelaPortaDoUpstream(ator: string, contato: string, dono: string): string {
  try {
    sql(`
      set role service_role;
      select public.fn_definir_carteira_do_cliente('${ORG}', '${ator}', '${contato}', '${dono}', 'importacao');
    `);
    return "";
  } catch (err) {
    return ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
  }
}

function trioDe(contato: string): string {
  return lastLine(
    sql(
      `select coalesce(carteira_user_id::text, 'NULL') || '|' || coalesce(carteira_origem, 'NULL') || '|' || (carteira_definida_em is not null)::text from public.contacts where id = '${contato}';`,
    ),
  );
}

function donoDoNegocio(negocio: string): string {
  return lastLine(sql(`select coalesce(owner_user_id::text, 'NULL') from public.crm_leads where id = '${negocio}';`));
}

describe("9022 · o dono do contato pela plataforma", () => {
  beforeAll(() => {
    sql(`
      insert into auth.users (id, email) values
        ('${ADMIN_DA_PLATAFORMA}', 'admin-plataforma-9022@invariant.test'),
        ('${EX_ADMIN}', 'ex-admin-9022@invariant.test'),
        ('${VENDEDORA}', 'vendedora-9022@invariant.test'),
        ('${SO_LE}', 'leitor-9022@invariant.test'),
        ('${GERENTE}', 'gerente-9022@invariant.test')
      on conflict (id) do nothing;

      insert into public.platform_admins (user_id, granted_by, reason, scope) values
        ('${ADMIN_DA_PLATAFORMA}', '${ADMIN_DA_PLATAFORMA}', 'invariante 9022', 'full'),
        ('${EX_ADMIN}', '${ADMIN_DA_PLATAFORMA}', 'invariante 9022', 'full')
      on conflict (user_id) do nothing;
      update public.platform_admins set revoked_at = null, revoked_by = null, scope = 'full' where user_id = '${ADMIN_DA_PLATAFORMA}';
      update public.platform_admins set revoked_at = now(), revoked_by = '${ADMIN_DA_PLATAFORMA}', revoke_reason = 'saiu'
        where user_id = '${EX_ADMIN}';

      insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason, expires_at, revoked_at, revoked_by) values
        ('${TOKEN_VIVO}', 'vivo', 'dskp_aaa', '\\x01', '{importar_base}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, null, null),
        ('${TOKEN_SEM_IMPORTAR}', 'sem importar', 'dskp_bbb', '\\x02', '{implantar_configuracao}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, null, null),
        ('${TOKEN_REVOGADO}', 'revogado', 'dskp_ccc', '\\x03', '{importar_base}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, now(), '${ADMIN_DA_PLATAFORMA}'),
        ('${TOKEN_VENCIDO}', 'vencido', 'dskp_ddd', '\\x04', '{importar_base}', '${ADMIN_DA_PLATAFORMA}', 'invariante', now() - interval '1 day', null, null),
        ('${TOKEN_DO_EX_ADMIN}', 'do ex-admin', 'dskp_eee', '\\x05', '{importar_base}', '${EX_ADMIN}', 'invariante', null, null, null)
      on conflict (id) do nothing;

      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG}', 'dono-9022', 'Dono 9022 Org', 'Dono 9022'),
        ('${OUTRA_ORG}', 'dono-9022-outra', 'Outra 9022 Org', 'Outra 9022')
      on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${VENDEDORA}', '${ORG}', 'agent', now()),
        ('${SO_LE}', '${ORG}', 'viewer', now()),
        ('${GERENTE}', '${ORG}', 'manager', now())
      on conflict (user_id, organization_id) do nothing;

      insert into public.crm_pipelines (id, organization_id, name, slug) values
        ('${PIPELINE}', '${ORG}', 'Dono 9022', 'dono-9022')
      on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${ETAPA}', '${ORG}', '${PIPELINE}', 'Novo', 'novo', 9000)
      on conflict (id) do nothing;

      insert into public.contacts (id, organization_id, display_name) values
        ('${CONTATO}', '${ORG}', 'Contato 9022'),
        ('${CONTATO_DO_UPSTREAM}', '${ORG}', 'Contato do upstream 9022'),
        ('${CONTATO_ALHEIO}', '${OUTRA_ORG}', 'Contato alheio 9022')
      on conflict (id) do nothing;
      update public.contacts set carteira_user_id = null, carteira_origem = null, carteira_definida_em = null
        where id in ('${CONTATO}', '${CONTATO_DO_UPSTREAM}', '${CONTATO_ALHEIO}');

      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id) values
        ('${NEGOCIO_SEM_DONO}', '${ORG}', '${PIPELINE}', '${ETAPA}', 'sem dono 9022', '${CONTATO}'),
        ('${NEGOCIO_DO_UPSTREAM}', '${ORG}', '${PIPELINE}', '${ETAPA}', 'do upstream 9022', '${CONTATO_DO_UPSTREAM}')
      on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, owner_user_id, owner_kind) values
        ('${NEGOCIO_COM_DONO}', '${ORG}', '${PIPELINE}', '${ETAPA}', 'com dono 9022', '${CONTATO}', '${GERENTE}', 'user')
      on conflict (id) do nothing;
    `);
  });

  afterAll(() => {
    sql(`
      delete from public.crm_leads where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.contacts where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.crm_stages where organization_id = '${ORG}';
      delete from public.crm_pipelines where organization_id = '${ORG}';
      delete from public.user_organizations where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.organizations where id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.platform_api_tokens where id in
        ('${TOKEN_VIVO}', '${TOKEN_SEM_IMPORTAR}', '${TOKEN_REVOGADO}', '${TOKEN_VENCIDO}', '${TOKEN_DO_EX_ADMIN}');
      delete from public.platform_admins where user_id in ('${ADMIN_DA_PLATAFORMA}', '${EX_ADMIN}');
      delete from auth.users where id in ('${ADMIN_DA_PLATAFORMA}', '${EX_ADMIN}', '${VENDEDORA}', '${SO_LE}', '${GERENTE}');
    `);
  });

  it("⭐ CONTROLE NEGATIVO: a porta do upstream recusa o ator do MCP de plataforma (não é membro da empresa)", () => {
    expect(pelaPortaDoUpstream(ADMIN_DA_PLATAFORMA, CONTATO, VENDEDORA)).toContain("carteira_permissao_negada");
    expect(trioDe(CONTATO)).toBe("NULL|NULL|false");
  });

  it("⭐ com o token vivo: grava o trio com a origem `importacao` e adota o negócio aberto SEM dono; o que tem dono não muda", () => {
    expect(pelaPlataforma(TOKEN_VIVO, CONTATO, VENDEDORA)).toBe("");
    expect(trioDe(CONTATO)).toBe(`${VENDEDORA}|importacao|true`);
    expect(donoDoNegocio(NEGOCIO_SEM_DONO)).toBe(VENDEDORA);
    expect(donoDoNegocio(NEGOCIO_COM_DONO)).toBe(GERENTE);
  });

  it("o mesmo efeito da porta do upstream (chamada pelo gerente membro) num contato equivalente", () => {
    expect(pelaPortaDoUpstream(GERENTE, CONTATO_DO_UPSTREAM, VENDEDORA)).toBe("");
    expect(trioDe(CONTATO_DO_UPSTREAM)).toBe(trioDe(CONTATO));
    expect(donoDoNegocio(NEGOCIO_DO_UPSTREAM)).toBe(donoDoNegocio(NEGOCIO_SEM_DONO));
  });

  it("o corpo copiado recusa com as frases do upstream: dono que só lê, e contato de outra empresa", () => {
    expect(pelaPlataforma(TOKEN_VIVO, CONTATO, SO_LE)).toContain("carteira_dono_invalido");
    expect(pelaPlataforma(TOKEN_VIVO, CONTATO_ALHEIO, VENDEDORA)).toContain("carteira_contato_de_outra_organizacao");
    expect(trioDe(CONTATO_ALHEIO)).toBe("NULL|NULL|false");
  });

  it("o ator: token sem `importar_base`, revogado, vencido, ou de quem deixou de ser admin de plataforma, é recusado", () => {
    for (const token of [TOKEN_SEM_IMPORTAR, TOKEN_REVOGADO, TOKEN_VENCIDO]) {
      expect(pelaPlataforma(token, CONTATO_ALHEIO, VENDEDORA, OUTRA_ORG), token).toContain("dono_sem_token_de_plataforma");
    }
    expect(pelaPlataforma(TOKEN_DO_EX_ADMIN, CONTATO_ALHEIO, VENDEDORA, OUTRA_ORG)).toContain("dono_sem_admin_de_plataforma");
    expect(pelaPlataforma("ecececec-2222-4000-8000-0000000000ff", CONTATO_ALHEIO, VENDEDORA, OUTRA_ORG)).toContain(
      "dono_sem_token_de_plataforma",
    );
  });

  it("só o `service_role` executa: a sessão autenticada não alcança a função", () => {
    let erro = "";
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GERENTE}"}', false);
        select public.fn_mia_definir_dono_do_contato_pela_plataforma('${ORG}', '${TOKEN_VIVO}', '${CONTATO}', '${VENDEDORA}', 'importacao');
      `);
    } catch (err) {
      erro = ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
    }
    expect(erro).toContain("permission denied for function fn_mia_definir_dono_do_contato_pela_plataforma");
  });
});

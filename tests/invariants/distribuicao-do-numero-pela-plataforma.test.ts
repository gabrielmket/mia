/**
 * 9045 · A DISTRIBUIÇÃO DE UM NÚMERO PELA PLATAFORMA — a função do fork
 * `fn_mia_distribuicao_do_numero_pela_plataforma`, no Postgres de verdade (.83).
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. CONTROLE NEGATIVO: a porta do upstream (`fn_set_channel_routing`, 0663)
 *    RECUSA o ator do MCP de plataforma: sem sessão de gerente membro
 *    (`routing_forbidden`). É por isso que a 9045 existe.
 * 2. Com um token de plataforma vivo, que carrega `implantar_configuracao` e foi
 *    criado por um admin de plataforma de escopo cheio, a função grava a regra
 *    do número com as colunas da 0663 (modo e destino padrão) e os responsáveis
 *    da 0228, e devolve a resposta na forma da porta do upstream.
 * 3. O mesmo efeito da porta do upstream (chamada por um gerente membro) num
 *    número equivalente: a linha gravada é igual.
 * 4. O corpo copiado recusa com as mensagens do upstream: quem só lê, número
 *    arquivado, número de outra empresa, modo inventado. E `reset` apaga a regra.
 * 5. A regra gravada aqui convive com o gatilho do upstream: tirar da equipe o
 *    destino padrão solta o vínculo (`fn_routing_member_revoked`, 0663).
 * 6. O ator: token sem a operação, revogado, vencido, ou cujo criador deixou de
 *    ser admin de plataforma, é recusado (42501). E só o `service_role` executa.
 *
 * Organização própria (namespace `edededed-`) para não encostar nas fixtures
 * dos outros arquivos. Nenhum dado de cliente real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "edededed-0000-4000-8000-000000000001";
const OUTRA_ORG = "edededed-0000-4000-8000-000000000002";
const ADMIN_DA_PLATAFORMA = "edededed-1111-4000-8000-000000000001"; // cria o token; NÃO é membro da empresa
const EX_ADMIN = "edededed-1111-4000-8000-000000000002";
const ANA = "edededed-1111-4000-8000-000000000003"; // agent
const BRUNO = "edededed-1111-4000-8000-000000000004"; // agent
const SO_LE = "edededed-1111-4000-8000-000000000005"; // viewer
const GERENTE = "edededed-1111-4000-8000-000000000006"; // manager membro: o ator da porta do upstream

const TOKEN_VIVO = "edededed-2222-4000-8000-000000000001";
const TOKEN_SEM_MONTAR = "edededed-2222-4000-8000-000000000002";
const TOKEN_REVOGADO = "edededed-2222-4000-8000-000000000003";
const TOKEN_VENCIDO = "edededed-2222-4000-8000-000000000004";
const TOKEN_DO_EX_ADMIN = "edededed-2222-4000-8000-000000000005";

const NUMERO = "edededed-3333-4000-8000-000000000001";
const NUMERO_DO_UPSTREAM = "edededed-3333-4000-8000-000000000002";
const NUMERO_ARQUIVADO = "edededed-3333-4000-8000-000000000003";
const NUMERO_ALHEIO = "edededed-3333-4000-8000-000000000004";

function arr(ids: string[]): string {
  return `array[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]`;
}

/** Chama a função do fork como o MCP chama: `service_role`. Devolve o stdout, ou o stderr quando recusa. */
function pelaPlataforma(
  token: string,
  numero: string,
  usuarios: string[],
  opcoes: { reset?: boolean; modo?: string | null; destino?: string | null; org?: string } = {},
): { ok: boolean; saida: string } {
  try {
    const saida = sql(`
      set role service_role;
      select public.fn_mia_distribuicao_do_numero_pela_plataforma(
        '${opcoes.org ?? ORG}', '${token}', '${numero}', ${arr(usuarios)}, ${opcoes.reset === true},
        ${opcoes.modo ? `'${opcoes.modo}'` : "null"}, ${opcoes.destino ? `'${opcoes.destino}'` : "null"});
    `);
    return { ok: true, saida: lastLine(saida) };
  } catch (err) {
    return { ok: false, saida: ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ") };
  }
}

/**
 * A porta do upstream, como a tela a chama: papel `authenticated` (é o único que
 * a executa), com o ator que se pedir (aal1, sem fator TOTP). `null` = sessão sem
 * usuário nenhum, que é o que o token de plataforma teria a oferecer.
 */
function pelaPortaDoUpstream(ator: string | null, numero: string, usuarios: string[], modo: string | null, destino: string | null): { ok: boolean; saida: string } {
  try {
    const saida = sql(`
      set role authenticated;
      ${ator ? `select set_config('request.jwt.claims', '{"sub":"${ator}","aal":"aal1"}', false);` : ""}
      select public.fn_set_channel_routing('${ORG}', '${numero}', ${arr(usuarios)}, false,
        ${modo ? `'${modo}'` : "null"}, ${destino ? `'${destino}'` : "null"});
    `);
    return { ok: true, saida: lastLine(saida) };
  } catch (err) {
    return { ok: false, saida: ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ") };
  }
}

/** A regra gravada do número: "modo|destino|responsáveis ordenados", ou "SEM REGRA". */
function regraDe(numero: string): string {
  const linha = lastLine(
    sql(`
      select coalesce((
        select coalesce(p.distribution_mode, 'NULL') || '|' || coalesce(p.default_assignee_user_id::text, 'NULL') || '|' ||
               coalesce((select string_agg(r.user_id::text, ',' order by r.user_id) from public.channel_routing_responsibles r where r.policy_id = p.id), '')
          from public.channel_routing_policies p
         where p.channel_session_id = '${numero}'
      ), 'SEM REGRA');
    `),
  );
  return linha;
}

describe("9045 · a distribuição de um número pela plataforma", () => {
  beforeAll(() => {
    sql(`
      insert into auth.users (id, email) values
        ('${ADMIN_DA_PLATAFORMA}', 'admin-plataforma-9045@invariant.test'),
        ('${EX_ADMIN}', 'ex-admin-9045@invariant.test'),
        ('${ANA}', 'ana-9045@invariant.test'),
        ('${BRUNO}', 'bruno-9045@invariant.test'),
        ('${SO_LE}', 'leitora-9045@invariant.test'),
        ('${GERENTE}', 'gerente-9045@invariant.test')
      on conflict (id) do nothing;

      insert into public.platform_admins (user_id, granted_by, reason, scope) values
        ('${ADMIN_DA_PLATAFORMA}', '${ADMIN_DA_PLATAFORMA}', 'invariante 9045', 'full'),
        ('${EX_ADMIN}', '${ADMIN_DA_PLATAFORMA}', 'invariante 9045', 'full')
      on conflict (user_id) do nothing;
      update public.platform_admins set revoked_at = null, revoked_by = null, scope = 'full' where user_id = '${ADMIN_DA_PLATAFORMA}';
      update public.platform_admins set revoked_at = now(), revoked_by = '${ADMIN_DA_PLATAFORMA}', revoke_reason = 'saiu'
        where user_id = '${EX_ADMIN}';

      insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason, expires_at, revoked_at, revoked_by) values
        ('${TOKEN_VIVO}', 'vivo', 'dskp_9a1', '\\x11', '{implantar_configuracao}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, null, null),
        ('${TOKEN_SEM_MONTAR}', 'sem montar', 'dskp_9a2', '\\x12', '{importar_base}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, null, null),
        ('${TOKEN_REVOGADO}', 'revogado', 'dskp_9a3', '\\x13', '{implantar_configuracao}', '${ADMIN_DA_PLATAFORMA}', 'invariante', null, now(), '${ADMIN_DA_PLATAFORMA}'),
        ('${TOKEN_VENCIDO}', 'vencido', 'dskp_9a4', '\\x14', '{implantar_configuracao}', '${ADMIN_DA_PLATAFORMA}', 'invariante', now() - interval '1 day', null, null),
        ('${TOKEN_DO_EX_ADMIN}', 'do ex-admin', 'dskp_9a5', '\\x15', '{implantar_configuracao}', '${EX_ADMIN}', 'invariante', null, null, null)
      on conflict (id) do nothing;

      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG}', 'distribuicao-9045', 'Distribuicao 9045 Org', 'Distribuicao 9045'),
        ('${OUTRA_ORG}', 'distribuicao-9045-outra', 'Outra 9045 Org', 'Outra 9045')
      on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${ANA}', '${ORG}', 'agent', now()),
        ('${BRUNO}', '${ORG}', 'agent', now()),
        ('${SO_LE}', '${ORG}', 'viewer', now()),
        ('${GERENTE}', '${ORG}', 'manager', now())
      on conflict (user_id, organization_id) do nothing;

      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
        ('${NUMERO}', '${ORG}', 'distribuicao-9045-a', '\\x00'::bytea),
        ('${NUMERO_DO_UPSTREAM}', '${ORG}', 'distribuicao-9045-b', '\\x00'::bytea),
        ('${NUMERO_ARQUIVADO}', '${ORG}', 'distribuicao-9045-c', '\\x00'::bytea),
        ('${NUMERO_ALHEIO}', '${OUTRA_ORG}', 'distribuicao-9045-d', '\\x00'::bytea)
      on conflict do nothing;
      update public.channel_sessions set archived_at = now() where id = '${NUMERO_ARQUIVADO}';
    `);
  });

  afterAll(() => {
    sql(`
      delete from public.channel_routing_policies where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.event_log where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.channel_sessions where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.user_organizations where organization_id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.organizations where id in ('${ORG}', '${OUTRA_ORG}');
      delete from public.platform_api_tokens where id in
        ('${TOKEN_VIVO}', '${TOKEN_SEM_MONTAR}', '${TOKEN_REVOGADO}', '${TOKEN_VENCIDO}', '${TOKEN_DO_EX_ADMIN}');
      delete from public.platform_admins where user_id in ('${ADMIN_DA_PLATAFORMA}', '${EX_ADMIN}');
      delete from auth.users where id in ('${ADMIN_DA_PLATAFORMA}', '${EX_ADMIN}', '${ANA}', '${BRUNO}', '${SO_LE}', '${GERENTE}');
    `);
  });

  it("⭐ CONTROLE NEGATIVO: a porta do upstream recusa o ator do MCP de plataforma (sem sessão de gerente membro)", () => {
    const pelaPlataformaSemSessao = pelaPortaDoUpstream(null, NUMERO, [ANA], "round_robin", ANA);
    expect(pelaPlataformaSemSessao.ok).toBe(false);
    expect(pelaPlataformaSemSessao.saida).toContain("routing_forbidden");
    const peloAdminNaoMembro = pelaPortaDoUpstream(ADMIN_DA_PLATAFORMA, NUMERO, [ANA], "round_robin", ANA);
    expect(peloAdminNaoMembro.saida).toContain("routing_forbidden");
    expect(regraDe(NUMERO)).toBe("SEM REGRA");
  });

  it("⭐ com o token vivo: grava modo, destino e responsáveis, e responde na forma da porta do upstream", () => {
    const r = pelaPlataforma(TOKEN_VIVO, NUMERO, [ANA, BRUNO, ANA], { modo: "round_robin", destino: ANA });
    expect(r.ok, r.saida).toBe(true);
    expect(regraDe(NUMERO)).toBe(`round_robin|${ANA}|${[ANA, BRUNO].sort().join(",")}`);
    const resposta = JSON.parse(r.saida) as Record<string, unknown>;
    expect(resposta).toMatchObject({ channel_session_id: NUMERO, mode: "restricted", distribution_mode: "round_robin", default_assignee_user_id: ANA });
  });

  it("o mesmo efeito da porta do upstream (chamada pelo gerente membro) num número equivalente", () => {
    const r = pelaPortaDoUpstream(GERENTE, NUMERO_DO_UPSTREAM, [ANA, BRUNO], "round_robin", ANA);
    expect(r.ok, r.saida).toBe(true);
    expect(regraDe(NUMERO_DO_UPSTREAM)).toBe(regraDe(NUMERO));
  });

  it("o corpo copiado recusa com as mensagens do upstream", () => {
    expect(pelaPlataforma(TOKEN_VIVO, NUMERO, [SO_LE]).saida).toContain("routing_invalid_members");
    expect(pelaPlataforma(TOKEN_VIVO, NUMERO, [ANA], { modo: "round_robin", destino: SO_LE }).saida).toContain("routing_invalid_members");
    expect(pelaPlataforma(TOKEN_VIVO, NUMERO, [ANA], { modo: "inventado" }).saida).toContain("routing_invalid_mode");
    expect(pelaPlataforma(TOKEN_VIVO, NUMERO_ARQUIVADO, [ANA]).saida).toContain("routing_channel_not_found");
    expect(pelaPlataforma(TOKEN_VIVO, NUMERO_ALHEIO, [ANA]).saida).toContain("routing_channel_not_found");
    // Nenhuma recusa mexeu na regra que já estava.
    expect(regraDe(NUMERO)).toBe(`round_robin|${ANA}|${[ANA, BRUNO].sort().join(",")}`);
    expect(regraDe(NUMERO_ARQUIVADO)).toBe("SEM REGRA");
  });

  it("tirar da equipe o destino padrão solta o vínculo (o gatilho do upstream alcança a regra gravada aqui)", () => {
    sql(`update public.user_organizations set revoked_at = now() where organization_id = '${ORG}' and user_id = '${ANA}';`);
    try {
      expect(regraDe(NUMERO)).toBe(`round_robin|NULL|${BRUNO}`);
    } finally {
      sql(`update public.user_organizations set revoked_at = null where organization_id = '${ORG}' and user_id = '${ANA}';`);
    }
  });

  it("`reset` apaga a regra do número: volta a valer a organização", () => {
    const r = pelaPlataforma(TOKEN_VIVO, NUMERO, [], { reset: true });
    expect(r.ok, r.saida).toBe(true);
    expect(regraDe(NUMERO)).toBe("SEM REGRA");
    expect(JSON.parse(r.saida)).toMatchObject({ mode: "legacy_unconfigured", user_ids: [] });
  });

  it("o ator: token sem `implantar_configuracao`, revogado, vencido, ou de quem deixou de ser admin de plataforma, é recusado", () => {
    for (const token of [TOKEN_SEM_MONTAR, TOKEN_REVOGADO, TOKEN_VENCIDO]) {
      expect(pelaPlataforma(token, NUMERO, [ANA]).saida, token).toContain("distribuicao_sem_token_de_plataforma");
    }
    expect(pelaPlataforma(TOKEN_DO_EX_ADMIN, NUMERO, [ANA]).saida).toContain("distribuicao_sem_admin_de_plataforma");
    expect(pelaPlataforma("edededed-2222-4000-8000-0000000000ff", NUMERO, [ANA]).saida).toContain("distribuicao_sem_token_de_plataforma");
    expect(regraDe(NUMERO)).toBe("SEM REGRA");
  });

  it("só o `service_role` executa: a sessão autenticada não alcança a função", () => {
    let erro = "";
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GERENTE}"}', false);
        select public.fn_mia_distribuicao_do_numero_pela_plataforma('${ORG}', '${TOKEN_VIVO}', '${NUMERO}', ${arr([ANA])}, false, null, null);
      `);
    } catch (err) {
      erro = ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
    }
    expect(erro).toContain("permission denied for function fn_mia_distribuicao_do_numero_pela_plataforma");
  });
});

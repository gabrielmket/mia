/**
 * 9023 · O LINK CURTO DO CONVITE — a coluna `team_invites.codigo_curto_hash`,
 * o índice único, a constraint de forma e o gatilho que zera o hash quando o
 * convite morre, no Postgres de verdade.
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. Só o HASH entra na coluna: 64 hex minúsculos. Um código cru (12
 *    caracteres) gravado por engano é recusado (23514). CONTROLE: o hash passa.
 * 2. O índice é ÚNICO onde não é nulo: dois convites com o mesmo hash são
 *    recusados (23505), e vários sem link curto convivem.
 * 3. O link curto morre com o convite: aceitar ou revogar zera o hash na
 *    MESMA escrita, inclusive a revogação em massa ao marcar a empresa como
 *    demonstração (9010). CONTROLE: mexer em outra coluna não zera.
 *    CONTROLE NEGATIVO: com o gatilho desligado, revogar deixa o hash lá — é
 *    o gatilho, e não outra coisa, que faz o trabalho.
 * 4. A consulta da rota curta (as mesmas condições de `resolverLinkCurto`)
 *    acha o pendente e não acha o revogado.
 * 5. Permissões: `anon` não lê a coluna, e a função do gatilho não é
 *    executável por `anon` nem `authenticated`.
 *
 * Organização própria (namespace `e9023e90-`) para não encostar nas fixtures
 * dos outros arquivos. Nenhum dado de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "e9023e90-0000-4000-8000-000000000001";
const ORG_DEMO = "e9023e90-0000-4000-8000-000000000002";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const H4 = "4".repeat(64);
const H5 = "5".repeat(64);
const H6 = "6".repeat(64);

/** Roda um comando e devolve o SQLSTATE da recusa, ou `passou`. Nada fica gravado quando recusa. */
function tentar(comando: string): string {
  return lastLine(
    sql(`
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9023', 'passou', false);
        exception when others then
          perform set_config('inv.r9023', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9023');
    `),
  );
}

function convite(email: string, hash: string | null, org = ORG): string {
  return `insert into public.team_invites (organization_id, email, role, expires_at, codigo_curto_hash)
    values ('${org}', '${email}', 'agent', now() + interval '15 days', ${hash ? `'${hash}'` : "null"})`;
}

function hashDe(email: string): string {
  return lastLine(sql(`select coalesce(codigo_curto_hash, 'NULO') from public.team_invites where email = '${email}';`));
}

/** As condições de `resolverLinkCurto` (lib/team/link-curto.ts), como o service_role as roda. */
function achaPeloHash(hash: string): string {
  return lastLine(
    sql(`
      set role service_role;
      select count(*)::text from public.team_invites
       where codigo_curto_hash = '${hash}' and accepted_at is null and revoked_at is null;
    `),
  );
}

describe("9023 · o link curto do convite", () => {
  beforeAll(() => {
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG}', 'link-curto-9023', 'Link Curto 9023 Org', 'Link Curto 9023'),
        ('${ORG_DEMO}', 'link-curto-9023-demo', 'Demo 9023 Org', 'Demo 9023')
      on conflict (id) do nothing;
    `);
  });

  it("a coluna, o índice único parcial e a constraint existem, com nome nosso", () => {
    expect(
      lastLine(
        sql(`select data_type || '|' || is_nullable from information_schema.columns
              where table_schema = 'public' and table_name = 'team_invites' and column_name = 'codigo_curto_hash';`),
      ),
    ).toBe("text|YES");
    const indice = lastLine(
      sql(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'team_invites_mia_codigo_curto_hash_idx';`),
    );
    expect(indice).toContain("CREATE UNIQUE INDEX");
    expect(indice).toContain("WHERE (codigo_curto_hash IS NOT NULL)");
    expect(
      lastLine(sql(`select count(*)::text from pg_constraint where conname = 'team_invites_mia_codigo_curto_hash_formato';`)),
    ).toBe("1");
  });

  it("⭐ só o hash entra: código cru e hex maiúsculo são recusados (23514); CONTROLE: 64 hex minúsculos passam", () => {
    expect(tentar(convite("cru-9023@invariant.test", "abcd2345efgh"))).toBe("23514");
    expect(tentar(convite("maiusculo-9023@invariant.test", "A".repeat(64)))).toBe("23514");
    expect(tentar(convite("curto-9023@invariant.test", "a".repeat(63)))).toBe("23514");
    expect(
      lastLine(
        sql(`select count(*)::text from public.team_invites
              where email in ('cru-9023@invariant.test', 'maiusculo-9023@invariant.test', 'curto-9023@invariant.test');`),
      ),
    ).toBe("0");
    // CONTROLE: a forma certa passa (o instrumento não recusa tudo).
    expect(tentar(convite("hash-9023@invariant.test", H1))).toBe("passou");
    expect(hashDe("hash-9023@invariant.test")).toBe(H1);
  });

  it("⭐ o mesmo hash em dois convites é recusado (23505); vários convites sem link curto convivem", () => {
    expect(tentar(convite("primeiro-9023@invariant.test", H2))).toBe("passou");
    expect(tentar(convite("segundo-9023@invariant.test", H2))).toBe("23505");
    expect(tentar(convite("sem-link-a-9023@invariant.test", null))).toBe("passou");
    expect(tentar(convite("sem-link-b-9023@invariant.test", null))).toBe("passou");
  });

  it("⭐ aceitar zera o hash na mesma escrita, e a consulta da rota curta deixa de achar", () => {
    sql(convite("aceita-9023@invariant.test", H3));
    expect(achaPeloHash(H3)).toBe("1");
    // CONTROLE: mexer em outra coluna não zera.
    sql(`update public.team_invites set email_dispatched = true where email = 'aceita-9023@invariant.test';`);
    expect(hashDe("aceita-9023@invariant.test")).toBe(H3);

    sql(`update public.team_invites set accepted_at = now() where email = 'aceita-9023@invariant.test';`);
    expect(hashDe("aceita-9023@invariant.test")).toBe("NULO");
    expect(achaPeloHash(H3)).toBe("0");
  });

  it("⭐ revogar zera o hash; CONTROLE NEGATIVO: com o gatilho desligado, o hash ficaria", () => {
    sql(convite("revogada-9023@invariant.test", H4));
    sql(`update public.team_invites set revoked_at = now() where email = 'revogada-9023@invariant.test';`);
    expect(hashDe("revogada-9023@invariant.test")).toBe("NULO");
    expect(achaPeloHash(H4)).toBe("0");

    // Sem o gatilho, a mesma escrita deixa o hash para trás: é ele que faz o trabalho.
    const semGatilho = lastLine(
      sql(`
        begin;
        alter table public.team_invites disable trigger trg_mia_link_curto_morre_com_o_convite;
        ${convite("controle-9023@invariant.test", H5)};
        update public.team_invites set revoked_at = now() where email = 'controle-9023@invariant.test';
        select coalesce(codigo_curto_hash, 'NULO') from public.team_invites where email = 'controle-9023@invariant.test';
        rollback;
      `).replace(/\n?ROLLBACK$/, ""),
    );
    expect(semGatilho).toBe(H5);
    // E o gatilho voltou (o rollback desfez o `disable`).
    expect(
      lastLine(sql(`select tgenabled::text from pg_trigger where tgname = 'trg_mia_link_curto_morre_com_o_convite';`)),
    ).toBe("O");
  });

  it("convite que já nasce revogado não guarda hash", () => {
    sql(`insert into public.team_invites (organization_id, email, role, expires_at, revoked_at, codigo_curto_hash)
         values ('${ORG}', 'nasce-revogada-9023@invariant.test', 'agent', now() + interval '1 day', now(), '${"7".repeat(64)}');`);
    expect(hashDe("nasce-revogada-9023@invariant.test")).toBe("NULO");
  });

  it("⭐ marcar a empresa como demonstração (9010) revoga os pendentes E zera o link curto deles", () => {
    sql(convite("demo-9023@invariant.test", H6, ORG_DEMO));
    expect(achaPeloHash(H6)).toBe("1");
    sql(`update public.organizations set demonstracao = true where id = '${ORG_DEMO}';`);
    expect(
      lastLine(sql(`select (revoked_at is not null)::text from public.team_invites where email = 'demo-9023@invariant.test';`)),
    ).toBe("true");
    expect(hashDe("demo-9023@invariant.test")).toBe("NULO");
    expect(achaPeloHash(H6)).toBe("0");
  });

  it("anon não lê a coluna; a função do gatilho não é executável por anon nem authenticated", () => {
    expect(
      lastLine(
        sql(`select has_column_privilege('anon', 'public.team_invites', 'codigo_curto_hash', 'SELECT')::text || ',' ||
                    has_function_privilege('anon', 'public.fn_mia_link_curto_morre_com_o_convite()', 'EXECUTE')::text || ',' ||
                    has_function_privilege('authenticated', 'public.fn_mia_link_curto_morre_com_o_convite()', 'EXECUTE')::text;`),
      ),
    ).toBe("false,false,false");
  });
});

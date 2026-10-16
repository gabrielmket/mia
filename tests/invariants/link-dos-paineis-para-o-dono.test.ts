/**
 * 9031 · O LINK DOS PAINÉIS PARA O DONO (`mia_paineis_links`) no Postgres de
 * verdade.
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. SÓ O SERVIDOR: RLS ligada e NENHUMA política; `authenticated` e `anon` não
 *    leem nem escrevem nem a linha da PRÓPRIA empresa (`permission denied`, o
 *    contrato mais estreito, e não zero linhas). CONTROLE: o `service_role`
 *    grava e lê. É a prova que `rls-completude-varredura` cobra da tabela.
 * 2. O que o banco GARANTE sozinho: só o hash na coluna do token (um token cru
 *    gravado por engano é recusado), os painéis são os doze prontos sem
 *    repetição, o período é um dos cinco, "para quem" não é vazio, e o hash é
 *    único.
 * 3. O FUNIL é da mesma empresa (chave composta), e apagar o funil solta o link
 *    para o principal, sem apagar o link.
 * 4. O ACESSO conta só em link VIVO: revogado ou vencido não soma; e só a
 *    plataforma executa a função.
 *
 * Organizações próprias (namespace `e9031e90-`). Nenhum dado de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG_A = "e9031e90-0000-4000-8000-00000000000a";
const ORG_B = "e9031e90-0000-4000-8000-00000000000b";
const GESTOR_A = "e9031e90-1111-4000-8000-00000000000a";
const FUNIL_A = "e9031e90-2222-4000-8000-00000000000a";
const FUNIL_A2 = "e9031e90-2222-4000-8000-0000000000a2";
const FUNIL_B = "e9031e90-2222-4000-8000-00000000000b";
const LINK = "e9031e90-3333-4000-8000-000000000001";
const LINK_REVOGADO = "e9031e90-3333-4000-8000-000000000002";
const LINK_VENCIDO = "e9031e90-3333-4000-8000-000000000003";
const LINK_DO_FUNIL = "e9031e90-3333-4000-8000-000000000004";

const H = (c: string) => c.repeat(64);

/** Roda um comando no papel pedido e devolve o SQLSTATE da recusa, ou `passou`. */
function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${GESTOR_A}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9031', 'passou', false);
        exception when others then
          perform set_config('inv.r9031', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9031');
    `),
  );
}

function link(id: string, hash: string, extra = ""): string {
  return `insert into public.mia_paineis_links (id, organization_id, para_quem, paineis, token_hash${extra ? ", " + extra.split("=")[0] : ""})
    values ('${id}', '${ORG_A}', 'Dono', array['resultado','meta'], '${hash}'${extra ? ", " + extra.split("=").slice(1).join("=") : ""})`;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${GESTOR_A}', 'link-9031-a@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'link-9031-a', 'Link A', 'Link A'),
      ('${ORG_B}', 'link-9031-b', 'Link B', 'Link B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${GESTOR_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${FUNIL_A}', '${ORG_A}', 'Vendas A', 'vendas-9031-a'),
      ('${FUNIL_A2}', '${ORG_A}', 'Pós-venda A', 'pos-9031-a'),
      ('${FUNIL_B}', '${ORG_B}', 'Vendas B', 'vendas-9031-b');
    ${link(LINK, H("1"))};
    ${link(LINK_REVOGADO, H("2"), "revoked_at=now()")};
    insert into public.mia_paineis_links (id, organization_id, para_quem, paineis, token_hash, created_at, expires_at)
      values ('${LINK_VENCIDO}', '${ORG_A}', 'Vencido', array['resultado'], '${H("3")}', now() - interval '100 days', now() - interval '10 days');
    insert into public.mia_paineis_links (id, organization_id, para_quem, paineis, token_hash, pipeline_id)
      values ('${LINK_DO_FUNIL}', '${ORG_A}', 'Do funil', array['funil'], '${H("4")}', '${FUNIL_A2}');
  `);
});

describe("só o servidor lê e escreve", () => {
  it("RLS ligada e nenhuma política", () => {
    expect(
      lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.mia_paineis_links'::regclass;`)),
    ).toBe("true");
    expect(
      lastLine(sql(`select count(*) from pg_policy where polrelid = 'public.mia_paineis_links'::regclass;`)),
    ).toBe("0");
  });

  it("⭐ o gestor da PRÓPRIA empresa não lê nem escreve pela sessão (permission denied, não zero linhas)", () => {
    expect(tentar("authenticated", `perform 1 from public.mia_paineis_links where organization_id = '${ORG_A}'`)).toBe("42501");
    expect(tentar("authenticated", link("e9031e90-3333-4000-8000-0000000000f1", H("5")))).toBe("42501");
    expect(tentar("authenticated", `update public.mia_paineis_links set revoked_at = now() where id = '${LINK}'`)).toBe("42501");
    expect(tentar("authenticated", `delete from public.mia_paineis_links where id = '${LINK}'`)).toBe("42501");
  });

  it("anon também não", () => {
    expect(tentar("anon", `perform 1 from public.mia_paineis_links`)).toBe("42501");
  });

  it("CONTROLE: o service_role grava e lê", () => {
    expect(tentar("service_role", link("e9031e90-3333-4000-8000-0000000000f2", H("6")))).toBe("passou");
    expect(
      lastLine(sql(`set role service_role; select count(*) from public.mia_paineis_links where organization_id = '${ORG_A}';`)),
    ).toBe("5");
  });
});

describe("o que o banco garante sozinho", () => {
  it("só o hash entra na coluna do token: um token cru é recusado (23514)", () => {
    expect(tentar("postgres", link("e9031e90-3333-4000-8000-0000000000f3", "abcdefghjkmnpqrstvwxyz12"))).toBe("23514");
  });

  it("o hash é único (23505)", () => {
    expect(tentar("postgres", link("e9031e90-3333-4000-8000-0000000000f4", H("1")))).toBe("23505");
  });

  it("painéis: os doze prontos, sem repetir, ao menos um (23514)", () => {
    const comPaineis = (id: string, lista: string) =>
      `insert into public.mia_paineis_links (id, organization_id, para_quem, paineis, token_hash)
        values ('${id}', '${ORG_A}', 'Dono', ${lista}, '${H(id.slice(-1))}')`;
    expect(tentar("postgres", comPaineis("e9031e90-3333-4000-8000-0000000000a7", "array['custo_da_ia']"))).toBe("23514");
    expect(tentar("postgres", comPaineis("e9031e90-3333-4000-8000-0000000000a8", "array['resultado','resultado']"))).toBe("23514");
    expect(tentar("postgres", comPaineis("e9031e90-3333-4000-8000-0000000000a9", "'{}'::text[]"))).toBe("23514");
    // CONTROLE: os doze juntos passam.
    expect(
      tentar(
        "postgres",
        comPaineis(
          "e9031e90-3333-4000-8000-0000000000ab",
          "array['resultado','meta','funil','origem','perdas','atendimento','resposta','agenda','followup','anuncios','previsao','assuntos']",
        ),
      ),
    ).toBe("passou");
  });

  it("período é um dos cinco, e 'para quem' não é vazio (23514)", () => {
    expect(tentar("postgres", link("e9031e90-3333-4000-8000-0000000000f5", H("7"), "periodo='ontem'"))).toBe("23514");
    expect(
      tentar(
        "postgres",
        `insert into public.mia_paineis_links (organization_id, para_quem, paineis, token_hash)
          values ('${ORG_A}', '   ', array['meta'], '${H("8")}')`,
      ),
    ).toBe("23514");
  });

  it("⭐ o funil é da mesma empresa (23503), e apagar o funil solta o link sem apagá-lo", () => {
    expect(tentar("postgres", link("e9031e90-3333-4000-8000-0000000000f6", H("9"), `pipeline_id='${FUNIL_B}'`))).toBe("23503");
    sql(`delete from public.crm_pipelines where id = '${FUNIL_A2}';`);
    expect(
      lastLine(sql(`select coalesce(pipeline_id::text, 'nulo') || ':' || organization_id from public.mia_paineis_links where id = '${LINK_DO_FUNIL}';`)),
    ).toBe(`nulo:${ORG_A}`);
  });

  it("vale 90 dias por padrão", () => {
    expect(
      lastLine(sql(`select extract(day from (expires_at - created_at))::int from public.mia_paineis_links where id = '${LINK}';`)),
    ).toBe("90");
  });
});

describe("o acesso", () => {
  it("⭐ conta só em link vivo: revogado e vencido não somam", () => {
    sql(`
      set role service_role;
      select public.fn_mia_paineis_link_acessado('${LINK}');
      select public.fn_mia_paineis_link_acessado('${LINK}');
      select public.fn_mia_paineis_link_acessado('${LINK_REVOGADO}');
      select public.fn_mia_paineis_link_acessado('${LINK_VENCIDO}');
    `);
    const linhas = sql(`
      select id || ':' || acessos || ':' || (last_used_at is not null)
        from public.mia_paineis_links
       where id in ('${LINK}', '${LINK_REVOGADO}', '${LINK_VENCIDO}') order by id;
    `).split("\n");
    expect(linhas).toEqual([`${LINK}:2:true`, `${LINK_REVOGADO}:0:false`, `${LINK_VENCIDO}:0:false`]);
  });

  it("só a plataforma executa a contagem", () => {
    expect(tentar("authenticated", `perform public.fn_mia_paineis_link_acessado('${LINK}')`)).toBe("42501");
    expect(tentar("anon", `perform public.fn_mia_paineis_link_acessado('${LINK}')`)).toBe("42501");
  });
});

/**
 * 9160 e 9161 · O PRODUTO NO NEGÓCIO no Postgres de verdade (FORK MIA .109,
 * docs/fork/produto-no-negocio.md).
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. `mia_itens_do_negocio` é lida por QUALQUER papel da própria empresa (o
 *    cartão do quadro mostra a linha do item) e escrita só pelo servidor:
 *    `authenticated` não grava, `anon` não lê. (O isolamento entre duas
 *    empresas, nas duas direções, está em `rls-tabelas-da-mia.test.ts`.)
 *    CONTROLE: o `service_role` grava.
 * 2. O que o banco GARANTE sozinho: quantidade de 1 a 99, preço não negativo,
 *    desconto que não passa do item, moeda em ISO, um produto por negócio, e a
 *    empresa do item igual à do negócio e à do produto (o servidor escreve pelo
 *    service_role, que ignora RLS: a trava é do gatilho).
 * 3. O preço e o nome ficam: apagar o produto do catálogo solta a referência e o
 *    item fica com o que tinha; apagar o negócio leva os itens.
 * 4. `crm_leads.valor_a_mao`: o negócio novo nasce FALSO (soma); a coluna aceita
 *    nulo, que é o "de antes dos itens".
 * 5. 9161: o motor dos relatórios montados agrupa por produto também o negócio
 *    sem proposta, pelos itens do próprio negócio.
 *
 * Organização própria (namespace `e9160e90-`). Dado fictício.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "e9160e90-0000-4000-8000-00000000000a";
const VIZINHA = "e9160e90-0000-4000-8000-00000000000b";
const ATENDENTE = "e9160e90-1111-4000-8000-00000000000a";
const FUNIL = "e9160e90-2222-4000-8000-00000000000a";
const ETAPA = "e9160e90-2222-4000-8000-0000000000aa";
const NEGOCIO = "e9160e90-3333-4000-8000-00000000000a";
const SEM_PROPOSTA = "e9160e90-3333-4000-8000-00000000000c";
const DA_VIZINHA = "e9160e90-3333-4000-8000-00000000000b";
const IMPLANTE = "e9160e90-4444-4000-8000-00000000000a";
const LIMPEZA = "e9160e90-4444-4000-8000-00000000000c";
const PRODUTO_DA_VIZINHA = "e9160e90-4444-4000-8000-00000000000b";

function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${ATENDENTE}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9160', 'passou', false);
        exception when others then
          perform set_config('inv.r9160', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9160');
    `),
  );
}

const item = (lead: string, produto: string | null) =>
  `insert into public.mia_itens_do_negocio (organization_id, lead_id, product_id, nome, preco_unitario_cents, quantidade, desconto_cents)
     values ('${ORG}', '${lead}', ${produto ? `'${produto}'` : "null"}, 'Item Exemplo', 45000, 1, 0)`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ATENDENTE}', 'produto-9160@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'produto-9160', 'Clínica Sorriso Exemplo', 'Clínica Sorriso Exemplo'),
             ('${VIZINHA}', 'produto-9160-b', 'Loja Exemplo', 'Loja Exemplo')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ATENDENTE}', '${ORG}', 'agent', now()) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${ORG}', 'Funil 9160', 'funil-9160')
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${ETAPA}', '${ORG}', '${FUNIL}', 'Avaliação', 'avaliacao-9160', 1000) on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
      values ('${NEGOCIO}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Paciente Ana Exemplo'),
             ('${SEM_PROPOSTA}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Paciente Bruno Exemplo')
      on conflict (id) do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('e9160e90-2222-4000-8000-00000000000b', '${VIZINHA}', 'Funil vizinho', 'funil-9160-b') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('e9160e90-2222-4000-8000-0000000000bb', '${VIZINHA}', 'e9160e90-2222-4000-8000-00000000000b', 'Novo', 'novo-9160-b', 1000)
      on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
      values ('${DA_VIZINHA}', '${VIZINHA}', 'e9160e90-2222-4000-8000-00000000000b', 'e9160e90-2222-4000-8000-0000000000bb', 'Cliente Exemplo')
      on conflict (id) do nothing;
    insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents)
      values ('${IMPLANTE}', '${ORG}', 'IMP-01', 'Implante unitário', 450000),
             ('${LIMPEZA}', '${ORG}', 'LIM-01', 'Limpeza', 22000),
             ('${PRODUTO_DA_VIZINHA}', '${VIZINHA}', 'X-01', 'Da vizinha', 1000)
      on conflict (id) do nothing;
    insert into public.mia_itens_do_negocio (organization_id, lead_id, product_id, nome, codigo, preco_unitario_cents, quantidade)
      values ('${ORG}', '${NEGOCIO}', '${IMPLANTE}', 'Implante unitário', 'IMP-01', 450000, 2),
             ('${ORG}', '${SEM_PROPOSTA}', '${LIMPEZA}', 'Limpeza', 'LIM-01', 22000, 1);
  `);
});

describe("quem lê e quem escreve", () => {
  it("RLS ligada, com uma política de leitura", () => {
    expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.mia_itens_do_negocio'::regclass;`))).toBe("true");
    expect(lastLine(sql(`select count(*) from pg_policy where polrelid = 'public.mia_itens_do_negocio'::regclass and polcmd = 'r';`))).toBe("1");
  });

  it("o atendente (agent) da empresa lê os itens (controle positivo)", () => {
    expect(
      lastLine(
        sql(`
          set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${ATENDENTE}"}', false);
          select count(*) from public.mia_itens_do_negocio where organization_id = '${ORG}';
        `),
      ),
    ).toBe("2");
  });

  it("⭐ authenticated não escreve nem na própria empresa; anon nem lê (42501)", () => {
    expect(tentar("authenticated", item(NEGOCIO, LIMPEZA))).toBe("42501");
    expect(tentar("authenticated", `update public.mia_itens_do_negocio set quantidade = 3 where lead_id = '${NEGOCIO}'`)).toBe("42501");
    expect(tentar("authenticated", `delete from public.mia_itens_do_negocio where lead_id = '${NEGOCIO}'`)).toBe("42501");
    expect(tentar("anon", `perform 1 from public.mia_itens_do_negocio`)).toBe("42501");
  });

  it("CONTROLE: o service_role grava", () => {
    expect(tentar("service_role", `update public.mia_itens_do_negocio set quantidade = 3 where lead_id = '${NEGOCIO}'`)).toBe("passou");
  });
});

describe("o que o banco garante sozinho", () => {
  it.each([
    ["quantidade 0", `update public.mia_itens_do_negocio set quantidade = 0 where lead_id = '${NEGOCIO}'`],
    ["quantidade 100", `update public.mia_itens_do_negocio set quantidade = 100 where lead_id = '${NEGOCIO}'`],
    ["preço negativo", `update public.mia_itens_do_negocio set preco_unitario_cents = -1 where lead_id = '${NEGOCIO}'`],
    ["desconto maior que o item", `update public.mia_itens_do_negocio set desconto_cents = 9999999 where lead_id = '${NEGOCIO}'`],
    ["moeda fora do ISO", `update public.mia_itens_do_negocio set moeda = 'brl' where lead_id = '${NEGOCIO}'`],
    ["nome em branco", `update public.mia_itens_do_negocio set nome = '  ' where lead_id = '${NEGOCIO}'`],
  ])("recusa %s (23514)", (_nome, comando) => {
    expect(tentar("postgres", comando)).toBe("23514");
  });

  it("um produto por negócio (23505)", () => {
    expect(tentar("postgres", item(NEGOCIO, IMPLANTE))).toBe("23505");
  });

  it("⭐ a empresa do item é a do negócio e a do produto (23514)", () => {
    expect(tentar("postgres", item(DA_VIZINHA, LIMPEZA))).toBe("23514");
    expect(tentar("postgres", item(NEGOCIO, PRODUTO_DA_VIZINHA))).toBe("23514");
  });
});

describe("o preço e o nome ficam", () => {
  it("apagar o produto do catálogo solta a referência e o item fica com o preço e o nome", () => {
    sql(`delete from public.catalog_products where id = '${IMPLANTE}';`);
    expect(
      lastLine(
        sql(`select coalesce(product_id::text, '-') || ',' || nome || ',' || preco_unitario_cents
               from public.mia_itens_do_negocio where lead_id = '${NEGOCIO}';`),
      ),
    ).toBe("-,Implante unitário,450000");
  });
});

describe("o valor digitado à mão", () => {
  it("o negócio novo nasce falso (soma); a coluna aceita nulo (de antes dos itens)", () => {
    expect(lastLine(sql(`select valor_a_mao::text from public.crm_leads where id = '${NEGOCIO}';`))).toBe("false");
    expect(lastLine(sql(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'crm_leads' and column_name = 'valor_a_mao';`))).toBe("YES");
  });
});

describe("9161 · o produto do negócio nos relatórios montados", () => {
  it("o negócio sem proposta cai no grupo do produto pelos itens do próprio negócio", () => {
    expect(
      lastLine(
        sql(`select l.dims -> 'produto'
               from public.fn_mia_relatorio_linhas('${ORG}', 'negocios', '-infinity'::timestamptz, 'infinity'::timestamptz,
                                                   '{}'::jsonb, now(), 'America/Sao_Paulo') l
              where l.registro = '${SEM_PROPOSTA}';`),
      ),
    ).toBe('["Limpeza"]');
  });

  it("produto apagado do catálogo fica com o nome de quando entrou", () => {
    expect(
      lastLine(
        sql(`select l.dims -> 'produto'
               from public.fn_mia_relatorio_linhas('${ORG}', 'negocios', '-infinity'::timestamptz, 'infinity'::timestamptz,
                                                   '{}'::jsonb, now(), 'America/Sao_Paulo') l
              where l.registro = '${NEGOCIO}';`),
      ),
    ).toBe('["Implante unitário"]');
  });

  it("apagar o negócio leva os itens", () => {
    sql(`delete from public.crm_leads where id = '${SEM_PROPOSTA}';`);
    expect(lastLine(sql(`select count(*) from public.mia_itens_do_negocio where lead_id = '${SEM_PROPOSTA}';`))).toBe("0");
  });
});

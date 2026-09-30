import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * FORK MIA (.61, migration 9004) — CADA PÁGINA DA META É DE UMA EMPRESA, NO BANCO.
 *
 * A invariante: **todo formulário ATIVO é de uma Página atribuída à MESMA
 * empresa.** A tela e as rotas conferem isso, mas quem grava é o service_role
 * (rotas e rotina), que passa por cima de RLS. Então a prova é com o papel que
 * NÃO tem RLS: `postgres`. Se o gatilho não segura aqui, não segura em lugar
 * nenhum.
 *
 * O que se mede, cada um com controle positivo:
 *
 *   1. formulário ativo de Página de OUTRA empresa é recusado (42501);
 *   2. formulário ativo de Página SEM dono é recusado;
 *   3. formulário ativo de Página da própria empresa passa;
 *   4. desligado passa sempre, mas religar exige a Página;
 *   5. uma Página não tem dois donos;
 *   6. a Página muda de dono: os formulários ativos da empresa antiga desligam,
 *      com o motivo gravado; retirar o dono desliga todos;
 *   7. a rotina continua gravando a última leitura (o gatilho não a trava);
 *   8. o gestor lê as Páginas da própria empresa e ZERO das outras, e não as
 *      atribui a si mesmo.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test (LGPD).
 */

const ORG_A = "90049004-0000-4000-8000-00000000000a";
const ORG_B = "90049004-0000-4000-8000-00000000000b";
const GESTOR_A = "90049004-1111-4000-8000-00000000000a";
const GESTOR_B = "90049004-1111-4000-8000-00000000000b";

const PAGINA_A = "700000000001";
const PAGINA_B = "700000000002";
const PAGINA_SEM_DONO = "700000000003";

function semear(org: string, gestor: string, tag: string): string {
  return `
    insert into auth.users (id, email) values ('${gestor}', 'mia-paginas-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'mia-paginas-${tag}', 'MIA Paginas ${tag}', 'MIA Paginas ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${gestor}', '${org}', 'manager', now())
      on conflict do nothing;
  `;
}

/** A linha da saída que começa com `marca` (o psql imprime BEGIN, DO, ROLLBACK no meio). */
function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/**
 * Roda `dml` numa transação desfeita no fim e devolve o SQLSTATE do erro, ou
 * `"passou"`. Cada caso parte do mesmo estado semeado.
 */
function tentar(dml: string): string {
  const saida = sql(`
    begin;
    do $$
    begin
      begin
        ${dml};
        perform set_config('inv.r', 'passou', true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

/** Roda o script numa transação desfeita; a consulta final devolve `'M:' || valor`. */
function medir(script: string): string {
  return linhaMarcada(sql(`begin;\n${script}\nrollback;`), "M:");
}

const formulario = (org: string, pagina: string, form: string, ativo = true) =>
  `insert into public.mia_leads_da_meta_formularios (organization_id, page_id, form_id, ativo)
     values ('${org}', '${pagina}', '${form}', ${ativo})`;

beforeAll(() => {
  sql(
    semear(ORG_A, GESTOR_A, "a") +
      semear(ORG_B, GESTOR_B, "b") +
      `
      insert into public.mia_paginas_da_meta (page_id, organization_id, page_name)
        values ('${PAGINA_A}', '${ORG_A}', 'Página da A'),
               ('${PAGINA_B}', '${ORG_B}', 'Página da B')
        on conflict (page_id) do nothing;
      ${formulario(ORG_A, PAGINA_A, "form-a-1")} on conflict do nothing;
      ${formulario(ORG_B, PAGINA_B, "form-b-1")} on conflict do nothing;
    `,
  );
});

describe("formulário ativo só de Página da própria empresa", () => {
  it("Página de OUTRA empresa: recusado, mesmo pelo papel sem RLS", () => {
    expect(tentar(formulario(ORG_A, PAGINA_B, "form-intruso"))).toBe("42501");
  });

  it("Página SEM dono: recusado", () => {
    expect(tentar(formulario(ORG_A, PAGINA_SEM_DONO, "form-orfao"))).toBe("42501");
  });

  it("controle positivo: Página da própria empresa passa", () => {
    expect(tentar(formulario(ORG_A, PAGINA_A, "form-a-2"))).toBe("passou");
  });

  it("mover um formulário ativo para a Página do vizinho é recusado", () => {
    expect(
      tentar(
        `update public.mia_leads_da_meta_formularios set page_id = '${PAGINA_B}'
          where organization_id = '${ORG_A}' and form_id = 'form-a-1'`,
      ),
    ).toBe("42501");
  });

  it("desligado passa sempre; religar exige a Página", () => {
    expect(tentar(formulario(ORG_A, PAGINA_B, "form-desligado", false))).toBe("passou");
    expect(
      tentar(
        `${formulario(ORG_A, PAGINA_B, "form-desligado", false)};
         update public.mia_leads_da_meta_formularios set ativo = true
          where organization_id = '${ORG_A}' and form_id = 'form-desligado'`,
      ),
    ).toBe("42501");
  });

  it("a rotina grava a última leitura sem esbarrar no gatilho", () => {
    expect(
      tentar(
        `update public.mia_leads_da_meta_formularios
            set ultima_leitura_em = now(), ultimo_status = 'sem_novos'
          where organization_id = '${ORG_A}' and form_id = 'form-a-1'`,
      ),
    ).toBe("passou");
  });
});

describe("uma Página, um dono", () => {
  it("a mesma Página não é atribuída a duas empresas", () => {
    expect(
      tentar(
        `insert into public.mia_paginas_da_meta (page_id, organization_id)
           values ('${PAGINA_A}', '${ORG_B}')`,
      ),
    ).toBe("23505");
  });

  it("id de Página que não é da Meta é recusado", () => {
    expect(
      tentar(
        `insert into public.mia_paginas_da_meta (page_id, organization_id)
           values ('pagina-inventada', '${ORG_A}')`,
      ),
    ).toBe("23514");
  });

  it("trocar o dono desliga os formulários da empresa antiga, com o motivo", () => {
    const r = medir(`
      update public.mia_paginas_da_meta set organization_id = '${ORG_B}' where page_id = '${PAGINA_A}';
      select 'M:' || f.ativo::text || ',' || coalesce(f.ultimo_status, '') || ',' || coalesce(f.ultimo_motivo, '')
        from public.mia_leads_da_meta_formularios f
       where f.organization_id = '${ORG_A}' and f.form_id = 'form-a-1';
    `);
    expect(r).toBe("false,erro,pagina_nao_e_da_empresa");
  });

  it("controle positivo: o formulário do dono atual naquela Página não é tocado", () => {
    const r = medir(`
      update public.mia_paginas_da_meta set organization_id = '${ORG_B}' where page_id = '${PAGINA_A}';
      insert into public.mia_leads_da_meta_formularios (organization_id, page_id, form_id, ativo)
        values ('${ORG_B}', '${PAGINA_A}', 'form-b-na-pagina-a', true);
      -- Reatribuir ao MESMO dono dispara o gatilho de novo: o formulário dele fica.
      update public.mia_paginas_da_meta set organization_id = '${ORG_B}' where page_id = '${PAGINA_A}';
      select 'M:' || ativo::text from public.mia_leads_da_meta_formularios
       where organization_id = '${ORG_B}' and form_id = 'form-b-na-pagina-a';
    `);
    expect(r).toBe("true");
  });

  it("atribuir pela primeira vez desliga o que outra empresa tinha ligado ali", () => {
    // O caso da .60: formulário ativo gravado antes de existir dono. A migration
    // desliga no deploy; aqui se prova que o gatilho faria o mesmo sozinho.
    const r = medir(`
      alter table public.mia_leads_da_meta_formularios
        disable trigger trg_mia_formulario_da_meta_so_da_pagina_da_empresa;
      ${formulario(ORG_B, PAGINA_SEM_DONO, "form-legado")};
      alter table public.mia_leads_da_meta_formularios
        enable trigger trg_mia_formulario_da_meta_so_da_pagina_da_empresa;
      insert into public.mia_paginas_da_meta (page_id, organization_id)
        values ('${PAGINA_SEM_DONO}', '${ORG_A}');
      select 'M:' || ativo::text || ',' || coalesce(ultimo_motivo, '')
        from public.mia_leads_da_meta_formularios
       where organization_id = '${ORG_B}' and form_id = 'form-legado';
    `);
    expect(r).toBe("false,pagina_nao_e_da_empresa");
  });

  it("retirar o dono desliga todos os formulários ativos da Página", () => {
    const r = medir(`
      delete from public.mia_paginas_da_meta where page_id = '${PAGINA_B}';
      select 'M:' || count(*) from public.mia_leads_da_meta_formularios
       where page_id = '${PAGINA_B}' and ativo;
    `);
    expect(r).toBe("0");
  });
});

describe("quem lê as Páginas", () => {
  it("o gestor de A lê a Página de A e ZERO da de B", () => {
    expect(
      countAs(GESTOR_A, `select count(*) from public.mia_paginas_da_meta where page_id = '${PAGINA_A}';`),
    ).toBe(1);
    expect(
      countAs(GESTOR_A, `select count(*) from public.mia_paginas_da_meta where page_id = '${PAGINA_B}';`),
    ).toBe(0);
  });

  it("a outra direção: o gestor de B não lê a de A", () => {
    expect(
      countAs(GESTOR_B, `select count(*) from public.mia_paginas_da_meta where organization_id = '${ORG_A}';`),
    ).toBe(0);
    expect(
      countAs(GESTOR_B, `select count(*) from public.mia_paginas_da_meta where organization_id = '${ORG_B}';`),
    ).toBe(1);
  });

  it("o gestor não atribui Página a si mesmo: escrita é só da plataforma", () => {
    expect(() =>
      sql(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GESTOR_A}"}', true);
        insert into public.mia_paginas_da_meta (page_id, organization_id)
          values ('${PAGINA_SEM_DONO}', '${ORG_A}');
        rollback;
      `),
    ).toThrow(/permission denied/);
  });
});

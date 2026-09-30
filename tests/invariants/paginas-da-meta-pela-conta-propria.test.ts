import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (.64, migration 9008) — A EMPRESA COM CONTA PRÓPRIA DA META ESCOLHE
 * AS PÁGINAS DELA, E NUNCA A DE OUTRA EMPRESA. NO BANCO.
 *
 * A rota confere na Meta que o token da empresa alcança a Página e recusa a de
 * outra empresa com a frase da tela; mas quem grava é o service_role, que passa
 * por cima de RLS. A prova é com `postgres`, o papel sem RLS: se o gatilho não
 * segura aqui, não segura em lugar nenhum.
 *
 * O que se mede, cada um com controle:
 *
 *   1. a empresa com conexão própria assume DUAS Páginas (origem `conta_propria`);
 *   2. assumir a Página de outra empresa é recusado — por insert (a chave), por
 *      upsert e por update (o gatilho);
 *   3. a empresa SEM conexão própria não assume; a plataforma continua atribuindo
 *      a ela (controle);
 *   4. soltar desliga os formulários dela na Página, com o motivo `pagina_solta`,
 *      e não toca o que é de outra empresa; a Página atribuída pela plataforma
 *      não é solta pela empresa;
 *   5. a plataforma transfere a Página que a empresa assumiu, e os formulários
 *      da empresa antiga desligam (gatilho da 9004);
 *   6. só o service_role executa a função de soltar;
 *   7. (9009) desconectar a conta própria solta as Páginas que a empresa
 *      assumiu, mantém a da plataforma, e reconectar deixa assumir de novo.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test (LGPD).
 */

const ORG_PROPRIA = "90089008-0000-4000-8000-00000000000a";
const ORG_VIZINHA = "90089008-0000-4000-8000-00000000000b";
const ORG_SEM_CONTA = "90089008-0000-4000-8000-00000000000c";
const GESTOR = "90089008-1111-4000-8000-00000000000a";

const PAGINA_1 = "800000000001";
const PAGINA_2 = "800000000002";
const PAGINA_DA_VIZINHA = "800000000003";
const PAGINA_LIVRE = "800000000004";
const PAGINA_DA_PLATAFORMA = "800000000005";

function empresa(org: string, tag: string): string {
  return `
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'mia-9008-${tag}', 'MIA 9008 ${tag}', 'MIA 9008 ${tag}')
      on conflict (id) do nothing;
  `;
}

/** A conexão própria de Meta Ads: o token cifrado não importa aqui, só a linha. */
function conexao(org: string): string {
  return `
    insert into public.ad_insights_connections (organization_id, platform, access_token_encrypted)
      values ('${org}', 'meta_ads', '\\x00'::bytea);
  `;
}

function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/** Roda `dml` numa transação desfeita e devolve o SQLSTATE do erro, ou `"passou"`. */
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

const assumir = (org: string, pagina: string) =>
  `insert into public.mia_paginas_da_meta (page_id, organization_id, page_name, origem)
     values ('${pagina}', '${org}', 'Página ${pagina}', 'conta_propria')`;

const formulario = (org: string, pagina: string, form: string) =>
  `insert into public.mia_leads_da_meta_formularios (organization_id, page_id, form_id, ativo)
     values ('${org}', '${pagina}', '${form}', true)`;

beforeAll(() => {
  sql(
    empresa(ORG_PROPRIA, "propria") +
      empresa(ORG_VIZINHA, "vizinha") +
      empresa(ORG_SEM_CONTA, "sem-conta") +
      conexao(ORG_PROPRIA) +
      conexao(ORG_VIZINHA) +
      `
      insert into auth.users (id, email) values ('${GESTOR}', 'mia-9008@invariant.test')
        on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at)
        values ('${GESTOR}', '${ORG_PROPRIA}', 'admin', now())
        on conflict do nothing;
      insert into public.mia_paginas_da_meta (page_id, organization_id, page_name, origem)
        values ('${PAGINA_DA_VIZINHA}', '${ORG_VIZINHA}', 'Página da vizinha', 'conta_propria'),
               ('${PAGINA_DA_PLATAFORMA}', '${ORG_PROPRIA}', 'Atribuída pela plataforma', 'plataforma')
        on conflict (page_id) do nothing;
      ${formulario(ORG_VIZINHA, PAGINA_DA_VIZINHA, "form-da-vizinha")} on conflict do nothing;
      ${formulario(ORG_PROPRIA, PAGINA_DA_PLATAFORMA, "form-na-da-plataforma")} on conflict do nothing;
    `,
  );
});

describe("a empresa com conta própria assume as Páginas dela", () => {
  it("⭐ assume DUAS Páginas, e as duas ficam com a origem da conta própria", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      ${assumir(ORG_PROPRIA, PAGINA_2)};
      select 'M:' || string_agg(page_id || '=' || origem, ',' order by page_id)
        from public.mia_paginas_da_meta
       where organization_id = '${ORG_PROPRIA}' and origem = 'conta_propria';
    `);
    expect(r).toBe(`${PAGINA_1}=conta_propria,${PAGINA_2}=conta_propria`);
  });

  it("com a Página assumida, o formulário ativo dela passa (a regra da 9004 continua)", () => {
    expect(
      tentar(
        `${assumir(ORG_PROPRIA, PAGINA_1)}; ${formulario(ORG_PROPRIA, PAGINA_1, "form-novo")}`,
      ),
    ).toBe("passou");
  });

  it("o dono antigo, de antes da 9008, é da plataforma", () => {
    expect(
      medir(`
        insert into public.mia_paginas_da_meta (page_id, organization_id)
          values ('${PAGINA_LIVRE}', '${ORG_SEM_CONTA}');
        select 'M:' || origem from public.mia_paginas_da_meta where page_id = '${PAGINA_LIVRE}';
      `),
    ).toBe("plataforma");
  });

  it("origem inventada é recusada", () => {
    expect(
      tentar(
        `insert into public.mia_paginas_da_meta (page_id, organization_id, origem)
           values ('${PAGINA_LIVRE}', '${ORG_PROPRIA}', 'a_empresa_quis')`,
      ),
    ).toBe("23514");
  });
});

describe("a Página de outra empresa não se assume", () => {
  it("⭐ insert da Página que já tem dono: recusado pela chave", () => {
    expect(tentar(assumir(ORG_PROPRIA, PAGINA_DA_VIZINHA))).toBe("23505");
  });

  it("⭐ upsert que tomaria a Página: recusado pelo gatilho", () => {
    expect(
      tentar(`${assumir(ORG_PROPRIA, PAGINA_DA_VIZINHA)}
        on conflict (page_id) do update
          set organization_id = excluded.organization_id, origem = excluded.origem`),
    ).toBe("42501");
  });

  it("⭐ update que troca o dono com a origem da conta própria: recusado", () => {
    expect(
      tentar(
        `update public.mia_paginas_da_meta
            set organization_id = '${ORG_PROPRIA}', origem = 'conta_propria'
          where page_id = '${PAGINA_DA_VIZINHA}'`,
      ),
    ).toBe("42501");
  });

  it("e o formulário da vizinha segue ligado depois da tentativa", () => {
    expect(
      medir(`
        select 'M:' || ativo::text from public.mia_leads_da_meta_formularios
         where organization_id = '${ORG_VIZINHA}' and form_id = 'form-da-vizinha';
      `),
    ).toBe("true");
  });
});

describe("sem conexão própria, só a plataforma atribui", () => {
  it("⭐ a empresa sem conta própria não assume Página", () => {
    expect(tentar(assumir(ORG_SEM_CONTA, PAGINA_LIVRE))).toBe("42501");
  });

  it("controle: a plataforma atribui a mesma Página a ela", () => {
    expect(
      tentar(
        `insert into public.mia_paginas_da_meta (page_id, organization_id, origem)
           values ('${PAGINA_LIVRE}', '${ORG_SEM_CONTA}', 'plataforma')`,
      ),
    ).toBe("passou");
  });

  it("a empresa que desconecta não converte Página da plataforma em conta própria", () => {
    expect(
      tentar(`
        delete from public.ad_insights_connections where organization_id = '${ORG_PROPRIA}';
        update public.mia_paginas_da_meta set origem = 'conta_propria'
         where page_id = '${PAGINA_DA_PLATAFORMA}'`),
    ).toBe("42501");
  });
});

describe("soltar a Página", () => {
  it("⭐ desliga os formulários dela ali com o motivo, e o dono sai", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      ${formulario(ORG_PROPRIA, PAGINA_1, "form-a-soltar")};
      -- Em comando próprio: dentro do mesmo SELECT as subconsultas enxergariam o
      -- retrato de ANTES da função.
      create temp table resposta on commit drop as
        select public.fn_mia_soltar_pagina_da_meta('${ORG_PROPRIA}', '${PAGINA_1}') as j;
      select 'M:' || (select j->>'solta' from resposta)
        || ',' || (select ativo::text || ',' || coalesce(ultimo_motivo, '')
                     from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_PROPRIA}' and form_id = 'form-a-soltar')
        || ',' || (select count(*) from public.mia_paginas_da_meta where page_id = '${PAGINA_1}');
    `);
    expect(r).toBe("true,false,pagina_solta,0");
  });

  it("devolve quais formulários desligou (a rota fecha os avisos deles)", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_2)};
      ${formulario(ORG_PROPRIA, PAGINA_2, "form-2")};
      select 'M:' || jsonb_array_length(
        public.fn_mia_soltar_pagina_da_meta('${ORG_PROPRIA}', '${PAGINA_2}')->'formularios');
    `);
    expect(r).toBe("1");
  });

  it("a empresa não solta a Página da vizinha, e nada da vizinha muda", () => {
    const r = medir(`
      select 'M:' || (public.fn_mia_soltar_pagina_da_meta('${ORG_PROPRIA}', '${PAGINA_DA_VIZINHA}')->>'motivo')
        || ',' || (select organization_id::text from public.mia_paginas_da_meta where page_id = '${PAGINA_DA_VIZINHA}')
        || ',' || (select ativo::text from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_VIZINHA}' and form_id = 'form-da-vizinha');
    `);
    expect(r).toBe(`nao_e_da_empresa,${ORG_VIZINHA},true`);
  });

  it("a Página atribuída pela plataforma não é solta pela empresa", () => {
    const r = medir(`
      select 'M:' || (public.fn_mia_soltar_pagina_da_meta('${ORG_PROPRIA}', '${PAGINA_DA_PLATAFORMA}')->>'motivo')
        || ',' || (select count(*) from public.mia_paginas_da_meta where page_id = '${PAGINA_DA_PLATAFORMA}')
        || ',' || (select ativo::text from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_PROPRIA}' and form_id = 'form-na-da-plataforma');
    `);
    expect(r).toBe("atribuida_pela_plataforma,1,true");
  });

  it("só o service_role executa a função de soltar", () => {
    expect(() =>
      sql(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GESTOR}"}', true);
        select public.fn_mia_soltar_pagina_da_meta('${ORG_PROPRIA}', '${PAGINA_DA_PLATAFORMA}');
        rollback;
      `),
    ).toThrow(/permission denied/);
  });
});

describe("a plataforma continua mandando em qualquer Página", () => {
  it("⭐ transfere a Página que a vizinha assumiu; o formulário da vizinha desliga", () => {
    const r = medir(`
      update public.mia_paginas_da_meta
         set organization_id = '${ORG_PROPRIA}', origem = 'plataforma'
       where page_id = '${PAGINA_DA_VIZINHA}';
      select 'M:' || (select origem from public.mia_paginas_da_meta where page_id = '${PAGINA_DA_VIZINHA}')
        || ',' || (select ativo::text || ',' || coalesce(ultimo_motivo, '')
                     from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_VIZINHA}' and form_id = 'form-da-vizinha');
    `);
    expect(r).toBe("plataforma,false,pagina_nao_e_da_empresa");
  });

  it("a empresa não escreve direto na tabela: a escrita é do servidor", () => {
    expect(() =>
      sql(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GESTOR}"}', true);
        ${assumir(ORG_PROPRIA, PAGINA_LIVRE)};
        rollback;
      `),
    ).toThrow(/permission denied/);
  });
});

/**
 * FORK MIA (.65, migration 9009) — DESCONECTAR A CONTA PRÓPRIA SOLTA AS PÁGINAS
 * QUE A EMPRESA ASSUMIU. Decisão do Gabriel: "solta a página, o usuário pode
 * conectar e desconectar". A tela desconecta com um DELETE em
 * `ad_insights_connections`; o gatilho vale para esse e qualquer outro caminho.
 */
describe("desconectar a conta própria solta as Páginas que a empresa assumiu (9009)", () => {
  const desconectar = (org: string) =>
    `delete from public.ad_insights_connections
      where organization_id = '${org}' and platform = 'meta_ads'`;

  it("⭐ solta as de conta própria, com o motivo nos formulários, e mantém a da plataforma", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      ${assumir(ORG_PROPRIA, PAGINA_2)};
      ${formulario(ORG_PROPRIA, PAGINA_1, "form-desconectar-1")};
      ${formulario(ORG_PROPRIA, PAGINA_2, "form-desconectar-2")};
      ${desconectar(ORG_PROPRIA)};
      select 'M:' || (select string_agg(page_id || '=' || origem, ',' order by page_id)
                        from public.mia_paginas_da_meta where organization_id = '${ORG_PROPRIA}')
        || '|' || (select string_agg(form_id || '=' || ativo::text || '/' || coalesce(ultimo_motivo, ''),
                                     ',' order by form_id)
                     from public.mia_leads_da_meta_formularios where organization_id = '${ORG_PROPRIA}');
    `);
    expect(r).toBe(
      `${PAGINA_DA_PLATAFORMA}=plataforma|` +
        "form-desconectar-1=false/pagina_solta,form-desconectar-2=false/pagina_solta," +
        "form-na-da-plataforma=true/",
    );
  });

  it("controle: com a conexão de pé, as Páginas assumidas continuam da empresa", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      select 'M:' || count(*) from public.mia_paginas_da_meta
       where organization_id = '${ORG_PROPRIA}' and origem = 'conta_propria';
    `);
    expect(r).toBe("1");
  });

  it("não toca as Páginas nem os formulários de outra empresa", () => {
    const r = medir(`
      ${desconectar(ORG_PROPRIA)};
      select 'M:' || (select organization_id::text || '/' || origem from public.mia_paginas_da_meta
                       where page_id = '${PAGINA_DA_VIZINHA}')
        || ',' || (select ativo::text from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_VIZINHA}' and form_id = 'form-da-vizinha');
    `);
    expect(r).toBe(`${ORG_VIZINHA}/conta_propria,true`);
  });

  it("apagar a conexão do Google Ads não solta Página da Meta", () => {
    const r = medir(`
      insert into public.ad_insights_connections (organization_id, platform, access_token_encrypted)
        values ('${ORG_PROPRIA}', 'google_ads', '\x00'::bytea);
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      delete from public.ad_insights_connections
       where organization_id = '${ORG_PROPRIA}' and platform = 'google_ads';
      select 'M:' || origem from public.mia_paginas_da_meta where page_id = '${PAGINA_1}';
    `);
    expect(r).toBe("conta_propria");
  });

  it("sem reconectar, assumir de novo continua recusado (a regra da 9008 segura)", () => {
    expect(
      tentar(`${assumir(ORG_PROPRIA, PAGINA_1)}; ${desconectar(ORG_PROPRIA)}; ${assumir(ORG_PROPRIA, PAGINA_1)}`),
    ).toBe("42501");
  });

  it("⭐ reconectar deixa assumir de novo e religar o formulário", () => {
    const r = medir(`
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      ${formulario(ORG_PROPRIA, PAGINA_1, "form-volta")};
      ${desconectar(ORG_PROPRIA)};
      ${conexao(ORG_PROPRIA)}
      ${assumir(ORG_PROPRIA, PAGINA_1)};
      update public.mia_leads_da_meta_formularios
         set ativo = true, ultimo_motivo = null
       where organization_id = '${ORG_PROPRIA}' and form_id = 'form-volta';
      select 'M:' || (select origem from public.mia_paginas_da_meta where page_id = '${PAGINA_1}')
        || ',' || (select ativo::text from public.mia_leads_da_meta_formularios
                    where organization_id = '${ORG_PROPRIA}' and form_id = 'form-volta');
    `);
    expect(r).toBe("conta_propria,true");
  });

  it("apagar a empresa inteira (a conexão sai em cascata) não trava no gatilho", () => {
    expect(tentar(`delete from public.organizations where id = '${ORG_VIZINHA}'`)).toBe("passou");
  });

  it("a função do gatilho não é chamável por sessão", () => {
    expect(
      medir(`
        select 'M:' || (has_function_privilege('authenticated',
                          'public.fn_mia_soltar_paginas_ao_desconectar_a_meta()', 'EXECUTE')
                        or has_function_privilege('anon',
                          'public.fn_mia_soltar_paginas_ao_desconectar_a_meta()', 'EXECUTE'))::text;
      `),
    ).toBe("false");
  });
});

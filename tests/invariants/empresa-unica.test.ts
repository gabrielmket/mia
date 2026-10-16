import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * FORK MIA (.79, migrations 9032 a 9034) · EMPRESA ÚNICA, provada no banco.
 *
 * O protótipo aprovado em 15/10/2026 decidiu as regras; aqui cada uma é medida
 * no Postgres de verdade, com o papel e o `auth.uid()` que a rota usa:
 *
 *   1. as três tabelas ao lado de `companies` só se LEEM pela sessão, e só as
 *      da própria organização; `crm_empresas` (aposentada) também só se lê;
 *   2. o atendente cria e edita empresa pela porta `fn_mia_gravar_empresa`, e
 *      continua SEM insert direto em `companies` (a regra do upstream, 0448);
 *      CNPJ repetido é recusado com o id da que já existe; leitor não grava;
 *   3. a pessoa em várias empresas, com papel em cada uma; um principal por
 *      empresa; vários números = uma pessoa; o espelho do contato (empresa do
 *      cartão, cargo, papel, principal) acompanha o vínculo;
 *   4. quem escreve no contato do jeito de antes vira vínculo;
 *   5. negócio novo herda a empresa do cartão; empresa de outra organização,
 *      recusada;
 *   6. excluir (gestor; recusa com negócio aberto), mesclar (quem estava nas
 *      duas fica com um vínculo; a perdedora vira lápide), separar número e a
 *      anonimização (LGPD);
 *   7. a cópia da 9033 roda de novo (o baseline é reaplicado a cada implantação)
 *      sem perder nem duplicar nada.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test.
 */
const ORG = "90329032-0000-4000-8000-000000000001";
const OUTRA = "90329032-0000-4000-8000-000000000002";
const AGENTE = "90329032-1111-4000-8000-000000000001";
const GESTOR = "90329032-1111-4000-8000-000000000002";
const LEITOR = "90329032-1111-4000-8000-000000000003";
const VIZINHO = "90329032-1111-4000-8000-000000000004";
const HELENA_1 = "90329032-2222-4000-8000-000000000001";
const HELENA_2 = "90329032-2222-4000-8000-000000000002";
const ROGERIO = "90329032-2222-4000-8000-000000000003";
const MARINA = "90329032-2222-4000-8000-000000000004";
const VERA_1 = "90329032-2222-4000-8000-000000000005";
const VERA_2 = "90329032-2222-4000-8000-000000000006";
const FUNIL = "90329032-3333-4000-8000-000000000001";
const ETAPA = "90329032-3333-4000-8000-000000000002";

const RAIZ = path.resolve(__dirname, "..", "..");

let PADARIA = "";
let MERCADINHO = "";
let DA_VIZINHA = "";

/** Um script como a sessão de `usuario` (o caminho exato do PostgREST). */
function como(usuario: string, script: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
    ${script}
  `);
}

const ultima = (saida: string) => saida.split("\n").filter(Boolean).at(-1) ?? "";

/** Tenta um comando e devolve `sqlstate|mensagem|detalhe` (ou `passou`). Sempre desfeito. */
function tentar(usuario: string | null, comando: string): string {
  const saida = sql(`
    begin;
    ${usuario ? `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${usuario}"}', true);` : ""}
    do $inv$
    declare e text; m text; d text;
    begin
      begin
        execute $cmd$${comando}$cmd$;
        perform set_config('inv.r', 'passou', true);
      exception when others then
        get stacked diagnostics e = returned_sqlstate, m = message_text, d = pg_exception_detail;
        perform set_config('inv.r', e || '|' || m || '|' || coalesce(d, ''), true);
      end;
    end $inv$;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return (saida.split("\n").find((l) => l.startsWith("R:")) ?? "").slice(2);
}

function gravar(usuario: string, dados: Record<string, unknown>, id: string | null = null): string {
  const json = JSON.stringify(dados).replace(/'/g, "''");
  return ultima(
    como(usuario, `select (public.fn_mia_gravar_empresa('${ORG}', ${id ? `'${id}'` : "null"}, '${json}'::jsonb))->>'id';`),
  );
}

function vincular(usuario: string, contato: string, empresa: string, dados: Record<string, unknown> = {}): void {
  como(usuario, `select public.fn_mia_vincular_pessoa('${ORG}', '${contato}', '${empresa}', '${JSON.stringify(dados)}'::jsonb);`);
}

/** O espelho do contato: empresa do cartão | papel | cargo | principal. */
function espelho(contato: string): string {
  return sql(`
    select coalesce(c.trade_name, '-') || '|' || coalesce(ct.papel_na_empresa, '-') || '|' || coalesce(ct.cargo, '-') || '|' || ct.principal_na_empresa
      from public.contacts ct left join public.companies c on c.id = ct.empresa_id
     where ct.id = '${contato}';
  `);
}

const pessoa = (contato: string) => sql(`select coalesce(person_id::text, '-') from public.contacts where id = '${contato}';`);
const vinculosDe = (contato: string) =>
  sql(`
    select coalesce(string_agg(c.trade_name || ':' || coalesce(cp.papel, '-') || ':' || cp.is_primary, ',' order by c.trade_name), '-')
      from public.company_people cp join public.companies c on c.id = cp.company_id
     where cp.person_id = (select person_id from public.contacts where id = '${contato}');
  `);

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${AGENTE}', 'agente-9032@invariant.test'),
      ('${GESTOR}', 'gestor-9032@invariant.test'),
      ('${LEITOR}', 'leitor-9032@invariant.test'),
      ('${VIZINHO}', 'vizinho-9032@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'mia-9032', 'MIA 9032', 'MIA 9032'),
      ('${OUTRA}', 'mia-9032-vizinha', 'MIA 9032 Vizinha', 'MIA 9032 Vizinha')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENTE}', '${ORG}', 'agent', now()),
      ('${GESTOR}', '${ORG}', 'manager', now()),
      ('${LEITOR}', '${ORG}', 'viewer', now()),
      ('${VIZINHO}', '${OUTRA}', 'admin', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, name, display_name, phone_number) values
      ('${HELENA_1}', '${ORG}', 'Helena Teste', 'Helena', '+5510900000101'),
      ('${HELENA_2}', '${ORG}', 'Helena Teste', 'Helena', '+5510900000109'),
      ('${ROGERIO}', '${ORG}', 'Rogerio Teste', 'Rogerio', '+5510900000700'),
      ('${MARINA}', '${ORG}', 'Marina Teste', 'Marina', '+5510900000801'),
      ('${VERA_1}', '${ORG}', 'Vera Teste', 'Vera', '+5510900000901'),
      ('${VERA_2}', '${ORG}', 'Vera Teste', 'Vera', '+5510900000909')
      on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${ORG}', 'Funil 9032', 'funil-9032')
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${ETAPA}', '${ORG}', '${FUNIL}', 'Novo', 'novo-9032', 1000) on conflict do nothing;
  `);
  PADARIA = gravar(AGENTE, { nome: "Padaria Trigo 9032", cnpj: "00.111.222/0001-00", site: "trigo.exemplo", tags: ["padaria"] });
  MERCADINHO = gravar(AGENTE, { nome: "Mercadinho Praca 9032" });
  DA_VIZINHA = ultima(
    como(VIZINHO, `select (public.fn_mia_gravar_empresa('${OUTRA}', null, '{"nome":"Empresa Vizinha 9032"}'::jsonb))->>'id';`),
  );
});

describe("1 · as tabelas ao lado de companies", () => {
  it("RLS ligada nas três, e a sessão só lê as da própria organização", () => {
    expect(
      sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class
            where relnamespace = 'public'::regnamespace
              and relname in ('mia_companies_extra', 'mia_companies_mescladas', 'mia_companies_de_para');`),
    ).toBe("mia_companies_de_para:true,mia_companies_extra:true,mia_companies_mescladas:true");
    expect(countAs(AGENTE, `select count(*) from public.mia_companies_extra where company_id = '${PADARIA}';`)).toBe(1);
    expect(countAs(VIZINHO, `select count(*) from public.mia_companies_extra where company_id = '${PADARIA}';`)).toBe(0);
  });

  it("nenhuma escrita direta da sessão nelas, nem em crm_empresas (aposentada)", () => {
    for (const comando of [
      `insert into public.mia_companies_extra (company_id, organization_id, site) values ('${MERCADINHO}', '${ORG}', 'x')`,
      `update public.mia_companies_extra set site = 'y' where company_id = '${PADARIA}'`,
      `insert into public.mia_companies_mescladas (id, organization_id, nome, motivo) values (gen_random_uuid(), '${ORG}', 'x', 'mesclagem')`,
      `insert into public.mia_companies_de_para (crm_empresa_id, organization_id, como) values (gen_random_uuid(), '${ORG}', 'lapide')`,
      `insert into public.crm_empresas (organization_id, nome) values ('${ORG}', 'pelo caminho antigo')`,
    ]) {
      expect(tentar(GESTOR, comando).split("|")[0], comando).toBe("42501");
    }
    // Ler crm_empresas continua possível (a entrega 5 é quem a tira de vez).
    expect(tentar(GESTOR, `select count(*) from public.crm_empresas`)).toBe("passou");
  });
});

describe("2 · criar e editar empresa", () => {
  it("o atendente cria pela porta: CNPJ formatado e normalizado, autoria, e o que é só nosso ao lado", () => {
    expect(
      sql(`select c.trade_name || '|' || c.cnpj || '|' || c.normalized_cnpj || '|' || c.created_by || '|' || x.site || '|' || x.tags::text
             from public.companies c join public.mia_companies_extra x on x.company_id = c.id where c.id = '${PADARIA}';`),
    ).toBe(`Padaria Trigo 9032|00.111.222/0001-00|00111222000100|${AGENTE}|trigo.exemplo|{padaria}`);
  });

  it("e continua SEM insert direto em companies (a regra do upstream)", () => {
    expect(writeCountAs(AGENTE, `insert into public.companies (organization_id, trade_name) values ('${ORG}', 'direto')`)).toBe(0);
  });

  it("CNPJ repetido é recusado, com o id da que já existe no detalhe", () => {
    expect(tentar(AGENTE, `select public.fn_mia_gravar_empresa('${ORG}', null, '{"nome":"Outra","cnpj":"00111222000100"}'::jsonb)`)).toBe(
      `23505|cnpj_ja_cadastrado|${PADARIA}`,
    );
    expect(tentar(AGENTE, `select public.fn_mia_gravar_empresa('${ORG}', null, '{"nome":"Curto","cnpj":"123"}'::jsonb)`)).toMatch(
      /^22023\|cnpj_invalido/,
    );
  });

  it("leitor não grava; quem é de outra organização também não", () => {
    expect(tentar(LEITOR, `select public.fn_mia_gravar_empresa('${ORG}', null, '{"nome":"Do leitor"}'::jsonb)`)).toMatch(/^42501\|insufficient_role/);
    expect(tentar(VIZINHO, `select public.fn_mia_gravar_empresa('${ORG}', null, '{"nome":"Do vizinho"}'::jsonb)`)).toMatch(/^42501\|/);
  });

  it("editar pela porta muda só o que veio", () => {
    gravar(AGENTE, { observacoes: "Entrega às terças" }, PADARIA);
    expect(
      sql(`select c.trade_name || '|' || x.site || '|' || x.observacoes from public.companies c
             join public.mia_companies_extra x on x.company_id = c.id where c.id = '${PADARIA}';`),
    ).toBe("Padaria Trigo 9032|trigo.exemplo|Entrega às terças");
  });

  it("no servidor (sem sessão), a autoria é a que a rota disser em criado_por", () => {
    const id = ultima(sql(`select (public.fn_mia_gravar_empresa('${ORG}', null, '{"nome":"Pelo MCP 9032","criado_por":"${GESTOR}"}'::jsonb))->>'id';`));
    expect(sql(`select created_by from public.companies where id = '${id}';`)).toBe(GESTOR);
  });
});

describe("3 · a pessoa em várias empresas", () => {
  it("vincular com papel e principal; dois números viram uma pessoa e mostram a mesma empresa", () => {
    vincular(AGENTE, HELENA_1, PADARIA, { papel: "decisor", cargo: "Socia", principal: true });
    expect(sql(`select is_decision_maker from public.company_people where company_id = '${PADARIA}' and person_id = (select person_id from public.contacts where id = '${HELENA_1}');`)).toBe("t");
    como(AGENTE, `select public.fn_mia_juntar_numeros('${ORG}', '${HELENA_1}', '${HELENA_2}');`);
    expect(pessoa(HELENA_2)).toBe(pessoa(HELENA_1));
    expect(espelho(HELENA_2)).toBe("Padaria Trigo 9032|decisor|Socia|true");
  });

  it("a mesma pessoa em duas empresas, com papel em cada; o cartão é o que se pediu", () => {
    vincular(AGENTE, ROGERIO, PADARIA, { papel: "influenciador", cargo: "Contador externo" });
    vincular(AGENTE, ROGERIO, MERCADINHO, { papel: "financeiro", cargo: "Contador externo", no_cartao: true, principal: true });
    expect(vinculosDe(ROGERIO)).toBe("Mercadinho Praca 9032:financeiro:true,Padaria Trigo 9032:influenciador:false");
    expect(espelho(ROGERIO)).toBe("Mercadinho Praca 9032|financeiro|Contador externo|true");
  });

  it("um principal por empresa: quem vira principal tira o de antes", () => {
    vincular(AGENTE, ROGERIO, PADARIA, { principal: true });
    expect(sql(`select count(*) from public.company_people where company_id = '${PADARIA}' and is_primary;`)).toBe("1");
    expect(espelho(HELENA_1)).toBe("Padaria Trigo 9032|decisor|Socia|false");
    expect(
      tentar(null, `update public.company_people set is_primary = true where company_id = '${PADARIA}' and person_id = (select person_id from public.contacts where id = '${HELENA_1}')`),
    ).toBe("passou");
    // A gravação direta no vínculo também passa pela regra (o gatilho tira o de
    // antes); o índice único parcial é a rede por baixo dele.
    expect(
      sql(`select count(*) from pg_indexes where schemaname = 'public' and indexname = 'company_people_mia_um_principal_uidx';`),
    ).toBe("1");
  });

  it("papel fora da lista fechada é recusado, na porta e na coluna", () => {
    expect(tentar(AGENTE, `select public.fn_mia_vincular_pessoa('${ORG}', '${MARINA}', '${PADARIA}', '{"papel":"chefe"}'::jsonb)`)).toMatch(
      /^22023\|papel_invalido/,
    );
    expect(tentar(null, `update public.company_people set papel = 'chefe' where company_id = '${PADARIA}'`).split("|")[0]).toBe("23514");
  });

  it("vincular contato de outra organização ou empresa de outra organização: recusado", () => {
    expect(tentar(AGENTE, `select public.fn_mia_vincular_pessoa('${ORG}', '${MARINA}', '${DA_VIZINHA}', '{}'::jsonb)`)).toMatch(
      /^P0002\|empresa_nao_encontrada/,
    );
  });
});

describe("4 · o jeito de antes (escrever no contato) vira vínculo", () => {
  it("contato que JÁ NASCE com empresa (insert direto): ganha pessoa e vínculo, e o espelho fica de pé", () => {
    // O defeito que este caso pegou: os gatilhos AFTER da mesma linha disparam
    // em ordem de nome, e o "ganhou pessoa" lia o NEW da hora do insert (sem
    // pessoa), apagando a empresa que o tradutor tinha acabado de ligar.
    const NOVO = "90329032-2222-4000-8000-000000000099";
    sql(`insert into public.contacts (id, organization_id, name, display_name, empresa_id, cargo, papel_na_empresa, principal_na_empresa)
           values ('${NOVO}', '${ORG}', 'Nasce Com Empresa', 'Nasce', '${MERCADINHO}', 'Gerente', 'financeiro', false);`);
    expect(espelho(NOVO)).toBe("Mercadinho Praca 9032|financeiro|Gerente|false");
    expect(vinculosDe(NOVO)).toBe("Mercadinho Praca 9032:financeiro:false");
    expect(pessoa(NOVO)).not.toBe("-");
  });

  it("empresa no contato = vínculo e cartão; 'sem empresa' = sai o vínculo do cartão", () => {
    sql(`update public.contacts set empresa_id = '${MERCADINHO}', cargo = 'Compradora' where id = '${MARINA}';`);
    expect(vinculosDe(MARINA)).toBe("Mercadinho Praca 9032:-:false");
    expect(sql(`select job_title from public.company_people where company_id = '${MERCADINHO}' and person_id = (select person_id from public.contacts where id = '${MARINA}');`)).toBe("Compradora");
    sql(`update public.contacts set empresa_id = null where id = '${MARINA}';`);
    expect(vinculosDe(MARINA)).toBe("-");
    expect(espelho(MARINA)).toBe("-|-|-|false");
  });
});

describe("5 · o negócio e a empresa", () => {
  it("negócio novo sem empresa herda a do cartão; contato sem empresa fica sem", () => {
    sql(`
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id) values
        ('90329032-4444-4000-8000-000000000001', '${ORG}', '${FUNIL}', '${ETAPA}', 'Pão do mês', '${HELENA_2}'),
        ('90329032-4444-4000-8000-000000000002', '${ORG}', '${FUNIL}', '${ETAPA}', 'Sem empresa', '${MARINA}'),
        ('90329032-4444-4000-8000-000000000003', '${ORG}', '${FUNIL}', '${ETAPA}', 'Contabilidade', '${ROGERIO}');
    `);
    expect(sql(`select (select trade_name from public.companies where id = l.empresa_id) from public.crm_leads l where id = '90329032-4444-4000-8000-000000000001';`)).toBe(
      "Padaria Trigo 9032",
    );
    expect(sql(`select coalesce(empresa_id::text, '-') from public.crm_leads where id = '90329032-4444-4000-8000-000000000002';`)).toBe("-");
    expect(sql(`select empresa_id from public.crm_leads where id = '90329032-4444-4000-8000-000000000003';`)).toBe(MERCADINHO);
  });

  it("negócio com empresa de outra organização: recusado", () => {
    expect(
      tentar(null, `update public.crm_leads set empresa_id = '${DA_VIZINHA}' where id = '90329032-4444-4000-8000-000000000002'`),
    ).toMatch(/^23503\|negocio_com_empresa_de_outra_organizacao/);
  });
});

describe("6 · excluir, mesclar, separar, anonimizar", () => {
  it("excluir é do gestor, e recusa quando há negócio aberto (diz quantos)", () => {
    expect(tentar(AGENTE, `select public.fn_mia_excluir_empresa('${ORG}', '${PADARIA}')`)).toMatch(/^42501\|insufficient_role/);
    expect(tentar(GESTOR, `select public.fn_mia_excluir_empresa('${ORG}', '${PADARIA}')`)).toBe("P0001|empresa_com_negocio_aberto|1");
  });

  it("mesclar: quem estava nas duas fica com um vínculo, o cartão e os negócios vão para a vencedora, a perdedora vira lápide", () => {
    expect(tentar(AGENTE, `select public.fn_mesclar_empresas('${ORG}', '${PADARIA}', '${MERCADINHO}')`)).toMatch(/^42501\|/);
    como(GESTOR, `select public.fn_mesclar_empresas('${ORG}', '${PADARIA}', '${MERCADINHO}');`);
    expect(sql(`select count(*) from public.companies where id = '${MERCADINHO}';`)).toBe("0");
    expect(sql(`select nome || '>' || mesclada_com || '>' || motivo from public.mia_companies_mescladas where id = '${MERCADINHO}';`)).toBe(
      `Mercadinho Praca 9032>${PADARIA}>mesclagem`,
    );
    expect(vinculosDe(ROGERIO)).toBe("Padaria Trigo 9032:influenciador:true");
    expect(espelho(ROGERIO).split("|")[0]).toBe("Padaria Trigo 9032");
    expect(sql(`select empresa_id from public.crm_leads where id = '90329032-4444-4000-8000-000000000003';`)).toBe(PADARIA);
  });

  it("separar um número: vira outra pessoa e leva uma cópia dos vínculos", () => {
    como(AGENTE, `select public.fn_mia_separar_numero('${ORG}', '${HELENA_2}');`);
    expect(pessoa(HELENA_2)).not.toBe(pessoa(HELENA_1));
    expect(vinculosDe(HELENA_2)).toBe(vinculosDe(HELENA_1));
    expect(espelho(HELENA_2).split("|")[0]).toBe("Padaria Trigo 9032");
  });

  it("anonimizar: com outro número vivo o vínculo fica; o único número, o vínculo sai", () => {
    vincular(AGENTE, VERA_1, PADARIA, { papel: "usuario" });
    como(AGENTE, `select public.fn_mia_juntar_numeros('${ORG}', '${VERA_1}', '${VERA_2}');`);
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${VERA_1}';`);
    expect(vinculosDe(VERA_2)).toBe("Padaria Trigo 9032:usuario:false");

    const pessoaDoRogerio = pessoa(ROGERIO);
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${ROGERIO}';`);
    expect(sql(`select count(*) from public.company_people where person_id = '${pessoaDoRogerio}';`)).toBe("0");
  });

  it("excluir sem negócio aberto: as pessoas ficam sem empresa e os negócios encerrados ficam no histórico", () => {
    sql(`update public.crm_leads set status = 'won', closed_at = now() where organization_id = '${ORG}';`);
    const r = ultima(como(GESTOR, `select public.fn_mia_excluir_empresa('${ORG}', '${PADARIA}')::text;`));
    expect(r).toContain("pessoas_sem_empresa");
    expect(sql(`select count(*) from public.companies where id = '${PADARIA}';`)).toBe("0");
    expect(espelho(HELENA_1)).toBe("-|-|-|false");
    expect(sql(`select count(*) || '|' || count(*) filter (where empresa_id is null) from public.crm_leads where organization_id = '${ORG}';`)).toBe(
      "3|3",
    );
  });
});

describe("7 · a cópia da 9033 roda de novo sem perder nem duplicar", () => {
  it("linha que sobrou no cadastro antigo é copiada uma vez; a segunda passada não muda nada", () => {
    const LEGADO = "90329032-5555-4000-8000-000000000001";
    sql(`insert into public.crm_empresas (id, organization_id, nome, cnpj) values ('${LEGADO}', '${ORG}', 'Legado 9032', '55666777000188') on conflict do nothing;`);
    const copia = readFileSync(
      path.join(RAIZ, "supabase/migrations-mia/20261015200000_9033_empresa_unica_copia_dos_dados.sql"),
      "utf8",
    );
    const contar = () =>
      sql(`select (select count(*) from public.companies) || '|' || (select count(*) from public.mia_companies_de_para)
                  || '|' || (select count(*) from public.company_people) || '|' || (select count(*) from public.people);`);

    sql(copia);
    expect(sql(`select c.trade_name || '|' || c.normalized_cnpj || '|' || d.como from public.companies c
                  join public.mia_companies_de_para d on d.company_id = c.id where d.crm_empresa_id = '${LEGADO}';`)).toBe(
      "Legado 9032|55666777000188|copiada",
    );
    const antes = contar();
    sql(copia);
    expect(contar()).toBe(antes);
    // Toda chave que apontava para empresa aponta para companies (fora a da
    // própria tabela velha, `mesclada_com`, que se aposenta com ela).
    expect(
      sql(`select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.crm_empresas'::regclass
              and conrelid <> 'public.crm_empresas'::regclass;`),
    ).toBe("0");
  });
});

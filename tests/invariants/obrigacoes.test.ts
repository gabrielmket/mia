import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * FORK MIA (migration 9018) — DOCUMENTOS E OBRIGAÇÕES COM VENCIMENTO.
 *
 * O que se prova no banco, com o baseline e o baseline-mia aplicados:
 *
 *   1. ISOLAMENTO: quem é de uma empresa não lê nem grava as obrigações da
 *      outra, nas cinco tabelas, nos dois sentidos. É a prova que a varredura
 *      `rls-completude-varredura` exige (`PROVA_PROPRIA`).
 *   2. PAPEL: `viewer` lê e não grava; `agent` grava item; o catálogo é de
 *      `manager`; aviso ninguém da sessão grava; item de negócio que a pessoa
 *      não enxerga também não aparece.
 *   3. O ITEM PRECISA DE DONO, e o que perde todos os donos sai, com o arquivo
 *      na fila de remoção.
 *   4. O PRÓXIMO CICLO nasce numa transação: o que terminou vai ao histórico.
 *   5. CADA GATILHO UMA VEZ por regra, item, ciclo e data medida; o aviso
 *      segurado não emite evento até ser solto.
 *   6. A PROPOSTA DO AGENTE não marca recebido: só a confirmação de uma pessoa.
 *   7. LGPD: anonimizar o contato leva os itens dele, e todo arquivo vai para a
 *      fila de remoção.
 *   8. A DEMONSTRAÇÃO NÃO ENVIA: o gatilho de obrigação vira evento, e a porta
 *      por onde a mensagem sairia continua fechada.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test, telefones +5500.
 */

const ORG_A = "90189018-0000-4000-8000-00000000000a";
const ORG_B = "90189018-0000-4000-8000-00000000000b";
const DEMO = "90189018-0000-4000-8000-00000000000d";

const LEITOR = "90189018-1111-4000-8000-000000000001";
const AGENTE_1 = "90189018-1111-4000-8000-000000000002";
const AGENTE_2 = "90189018-1111-4000-8000-000000000003";
const GESTOR_A = "90189018-1111-4000-8000-000000000004";
const GESTOR_B = "90189018-1111-4000-8000-000000000005";

const FUNIL_A = "90189018-5555-4000-8000-00000000000a";
const ETAPA_A = "90189018-5555-4000-8000-00000000001a";
const EMPRESA_A = "90189018-7777-4000-8000-00000000000a";
const EMPRESA_B = "90189018-7777-4000-8000-00000000000b";
const EMPRESA_DEMO = "90189018-7777-4000-8000-00000000000d";
const CONTATO_A = "90189018-3333-4000-8000-00000000000a";
const NEGOCIO_LIVRE = "90189018-6666-4000-8000-000000000001";
const NEGOCIO_DO_AGENTE_2 = "90189018-6666-4000-8000-000000000002";

const TIPO_A = "90189018-aaaa-4000-8000-00000000000a";
const TIPO_B = "90189018-aaaa-4000-8000-00000000000b";
const ITEM_DA_EMPRESA = "90189018-8888-4000-8000-000000000001";
const ITEM_DO_CONTATO = "90189018-8888-4000-8000-000000000002";
const ITEM_DO_NEGOCIO_LIVRE = "90189018-8888-4000-8000-000000000003";
const ITEM_DO_NEGOCIO_DO_AGENTE_2 = "90189018-8888-4000-8000-000000000004";
const ATIVIDADE = "90189018-8888-4000-8000-000000000005";
const ITEM_B = "90189018-8888-4000-8000-00000000000b";
const ITEM_DEMO = "90189018-8888-4000-8000-00000000000d";
const REGRA_A = "90189018-9999-4000-8000-00000000000a";
const REGRA_B = "90189018-9999-4000-8000-00000000000b";
const REGRA_DEMO = "90189018-9999-4000-8000-00000000000d";

const TABELAS = [
  "mia_obrigacoes_tipos",
  "mia_obrigacoes",
  "mia_obrigacoes_ciclos",
  "mia_obrigacoes_propostas",
  "mia_obrigacoes_avisos",
] as const;

function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/** Roda o script numa transação desfeita; a consulta final devolve `'M:' || valor`. */
function medir(script: string): string {
  return linhaMarcada(sql(`begin;\n${script}\nrollback;`), "M:");
}

const comoCliente = (usuario: string) => `
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', true);
`;

/**
 * Roda `dml` numa transação desfeita e devolve o SQLSTATE do erro, `"passou"`,
 * ou `"0 linhas"` quando a escrita não alcançou linha nenhuma (a RLS de UPDATE
 * e DELETE não dá erro: ela esconde a linha).
 */
function tentar(dml: string, antes = ""): string {
  const saida = sql(`
    begin;
    ${antes}
    do $$
    declare n int;
    begin
      begin
        with w as (${dml} returning 1) select count(*) into n from w;
        perform set_config('inv.r', case when n = 0 then '0 linhas' else 'passou' end, true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    reset role;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

/** Chama uma função numa transação desfeita e devolve o SQLSTATE do erro ou `"passou"`. */
function chamar(chamada: string, antes = ""): string {
  const saida = sql(`
    begin;
    ${antes}
    do $$
    begin
      begin
        perform ${chamada};
        perform set_config('inv.r', 'passou', true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    reset role;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

const documento = (id: string, org: string, vinculo: string, valor: string, extra = "", colunas = "") =>
  `insert into public.mia_obrigacoes (id, organization_id, nome, categoria, recorrencia, validade_meses, ${vinculo}${colunas})
     values ('${id}', '${org}', 'Alvará de funcionamento', 'documento', 'anual', 12, '${valor}'${extra})`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${LEITOR}', 'mia-9018-leitor@invariant.test'),
      ('${AGENTE_1}', 'mia-9018-agente-1@invariant.test'),
      ('${AGENTE_2}', 'mia-9018-agente-2@invariant.test'),
      ('${GESTOR_A}', 'mia-9018-gestor-a@invariant.test'),
      ('${GESTOR_B}', 'mia-9018-gestor-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, demonstracao) values
      ('${ORG_A}', 'mia-9018-a', 'MIA 9018 A', 'MIA 9018 A', false),
      ('${ORG_B}', 'mia-9018-b', 'MIA 9018 B', 'MIA 9018 B', false),
      ('${DEMO}', 'mia-9018-demo', 'MIA 9018 Demo', 'MIA 9018 Demo', true)
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${LEITOR}', '${ORG_A}', 'viewer', now()),
      ('${AGENTE_1}', '${ORG_A}', 'agent', now()),
      ('${AGENTE_2}', '${ORG_A}', 'agent', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${GESTOR_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${FUNIL_A}', '${ORG_A}', 'Serviços 9018', 'servicos-9018') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${ETAPA_A}', '${ORG_A}', '${FUNIL_A}', 'Novo', 'novo', 1000) on conflict do nothing;
    insert into public.crm_empresas (id, organization_id, nome) values
      ('${EMPRESA_A}', '${ORG_A}', 'Empresa 9018 A'),
      ('${EMPRESA_B}', '${ORG_B}', 'Empresa 9018 B'),
      ('${EMPRESA_DEMO}', '${DEMO}', 'Empresa 9018 Demo')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A}', '${ORG_A}', 'Contato 9018 A')
      on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id) values
      ('${NEGOCIO_LIVRE}', '${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'Negócio sem dono 9018', null),
      ('${NEGOCIO_DO_AGENTE_2}', '${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'Negócio do agente 2 · 9018', '${AGENTE_2}')
      on conflict (id) do nothing;

    insert into public.mia_obrigacoes_tipos (id, organization_id, pipeline_id, nome, categoria, recorrencia, validade_meses) values
      ('${TIPO_A}', '${ORG_A}', '${FUNIL_A}', 'Alvará de funcionamento', 'documento', 'anual', 12),
      ('${TIPO_B}', '${ORG_B}', null, 'Alvará de funcionamento', 'documento', 'anual', 12)
      on conflict (id) do nothing;

    ${documento(ITEM_DA_EMPRESA, ORG_A, "empresa_id", EMPRESA_A, ", date '2025-10-14', date '2026-10-13'", ", recebido_em, valido_ate")} on conflict (id) do nothing;
    ${documento(ITEM_DO_CONTATO, ORG_A, "contact_id", CONTATO_A)} on conflict (id) do nothing;
    ${documento(ITEM_DO_NEGOCIO_LIVRE, ORG_A, "lead_id", NEGOCIO_LIVRE)} on conflict (id) do nothing;
    ${documento(ITEM_DO_NEGOCIO_DO_AGENTE_2, ORG_A, "lead_id", NEGOCIO_DO_AGENTE_2)} on conflict (id) do nothing;
    insert into public.mia_obrigacoes (id, organization_id, nome, categoria, recorrencia, avisos_dias, lead_id, proxima_em, feita_em)
      values ('${ATIVIDADE}', '${ORG_A}', 'Relatório mensal', 'atividade', 'mensal', '{5,2}', '${NEGOCIO_LIVRE}', date '2026-10-05', date '2026-09-04')
      on conflict (id) do nothing;
    ${documento(ITEM_B, ORG_B, "empresa_id", EMPRESA_B)} on conflict (id) do nothing;
    ${documento(ITEM_DEMO, DEMO, "empresa_id", EMPRESA_DEMO, ", date '2025-10-14', date '2026-10-13'", ", recebido_em, valido_ate")} on conflict (id) do nothing;

    insert into public.automation_rules (id, organization_id, name, trigger_event, actions, is_active) values
      ('${REGRA_A}', '${ORG_A}', 'Alvará vencendo', 'obrigacao.documento_vencendo', '[]'::jsonb, true),
      ('${REGRA_B}', '${ORG_B}', 'Alvará vencendo', 'obrigacao.documento_vencendo', '[]'::jsonb, true),
      ('${REGRA_DEMO}', '${DEMO}', 'Alvará vencendo', 'obrigacao.documento_vencendo', '[]'::jsonb, true)
      on conflict (id) do nothing;

    -- Uma linha em cada tabela filha, nas duas empresas: sem isto, "zero do
    -- vizinho" não provaria nada.
    insert into public.mia_obrigacoes_ciclos (organization_id, obrigacao_id, ciclo, como, recebido_em, valido_ate) values
      ('${ORG_A}', '${ITEM_DO_NEGOCIO_DO_AGENTE_2}', 1, 'recebido', date '2024-10-01', date '2025-10-01'),
      ('${ORG_A}', '${ITEM_DO_CONTATO}', 1, 'recebido', date '2024-10-01', date '2025-10-01'),
      ('${ORG_B}', '${ITEM_B}', 1, 'recebido', date '2024-10-01', date '2025-10-01')
      on conflict do nothing;
    insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo, arquivo_nome, situacao) values
      ('${ORG_A}', '${ITEM_DO_CONTATO}', 1, 'alvara.pdf', 'recusada'),
      ('${ORG_B}', '${ITEM_B}', 1, 'alvara.pdf', 'recusada');
    insert into public.mia_obrigacoes_avisos (organization_id, obrigacao_id, regra_id, gatilho, ciclo, ancora) values
      ('${ORG_A}', '${ITEM_DO_CONTATO}', '${REGRA_A}', 'obrigacao.documento_vencendo', 1, date '2020-01-01'),
      ('${ORG_B}', '${ITEM_B}', '${REGRA_B}', 'obrigacao.documento_vencendo', 1, date '2020-01-01')
      on conflict do nothing;
  `);
});

describe("isolamento: quem é de uma empresa não lê as obrigações da outra", () => {
  it("a semente existe nas duas empresas (sem isto, zero do vizinho não prova nada)", () => {
    for (const tabela of TABELAS) {
      expect(
        sql(`select count(distinct organization_id) from public.${tabela} where organization_id in ('${ORG_A}','${ORG_B}');`),
        tabela,
      ).toBe("2");
    }
  });

  for (const tabela of TABELAS) {
    it(`${tabela}: A lê as próprias e ZERO de B`, () => {
      expect(countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`)).toBeGreaterThanOrEqual(1);
      expect(countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBe(0);
    });

    it(`${tabela}: B lê as próprias e ZERO de A (a outra direção)`, () => {
      expect(countAs(GESTOR_B, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBeGreaterThanOrEqual(1);
      expect(countAs(GESTOR_B, `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`)).toBe(0);
    });

    it(`${tabela}: a tabela inteira, sem filtro, é só a da própria empresa`, () => {
      expect(countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id <> '${ORG_A}';`)).toBe(0);
    });

    it(`${tabela}: quem não entrou não lê nada`, () => {
      expect(() => sql(`set role anon; select count(*) from public.${tabela};`)).toThrow(/permission denied/);
    });
  }

  it("⭐ gravar no vizinho é recusado: item, tipo, histórico e proposta", () => {
    const antes = comoCliente(GESTOR_A);
    expect(tentar(documento("90189018-8888-4000-8000-0000000000f1", ORG_B, "empresa_id", EMPRESA_B), antes)).toBe("42501");
    expect(
      tentar(`insert into public.mia_obrigacoes_tipos (organization_id, nome, categoria) values ('${ORG_B}', 'Intruso', 'documento')`, antes),
    ).toBe("42501");
    expect(
      tentar(
        `insert into public.mia_obrigacoes_ciclos (organization_id, obrigacao_id, ciclo, como) values ('${ORG_B}', '${ITEM_B}', 7, 'recebido')`,
        antes,
      ),
    ).toBe("42501");
    expect(
      tentar(
        `insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo) values ('${ORG_B}', '${ITEM_B}', 1)`,
        antes,
      ),
    ).toBe("42501");
    expect(tentar(`update public.mia_obrigacoes set observacao = 'intruso' where id = '${ITEM_B}'`, antes)).toBe("0 linhas");
    expect(tentar(`delete from public.mia_obrigacoes where id = '${ITEM_B}'`, antes)).toBe("0 linhas");
  });

  it("⭐ nem pendurar no item do vizinho um histórico ou uma proposta com a própria empresa na linha", () => {
    const antes = comoCliente(GESTOR_A);
    expect(
      tentar(
        `insert into public.mia_obrigacoes_ciclos (organization_id, obrigacao_id, ciclo, como) values ('${ORG_A}', '${ITEM_B}', 7, 'recebido')`,
        antes,
      ),
    ).toBe("42501");
    expect(
      tentar(
        `insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo) values ('${ORG_A}', '${ITEM_B}', 1)`,
        antes,
      ),
    ).toBe("42501");
  });
});

describe("papel: quem lê, quem grava", () => {
  const novo = "90189018-8888-4000-8000-0000000000f2";

  it("viewer LÊ os itens (controle positivo da recusa de escrita)", () => {
    expect(countAs(LEITOR, `select count(*) from public.mia_obrigacoes where id = '${ITEM_DA_EMPRESA}';`)).toBe(1);
  });

  it("⭐ viewer não grava item: nem cria, nem altera, nem apaga", () => {
    const antes = comoCliente(LEITOR);
    expect(tentar(documento(novo, ORG_A, "empresa_id", EMPRESA_A), antes)).toBe("42501");
    expect(tentar(`update public.mia_obrigacoes set recebido_em = current_date where id = '${ITEM_DA_EMPRESA}'`, antes)).toBe("0 linhas");
    expect(tentar(`delete from public.mia_obrigacoes where id = '${ITEM_DA_EMPRESA}'`, antes)).toBe("0 linhas");
  });

  it("agent grava item (controle)", () => {
    const antes = comoCliente(AGENTE_1);
    expect(tentar(documento(novo, ORG_A, "empresa_id", EMPRESA_A), antes)).toBe("passou");
    expect(tentar(`update public.mia_obrigacoes set pedido_em = current_date where id = '${ITEM_DA_EMPRESA}'`, antes)).toBe("passou");
  });

  it("⭐ o catálogo de tipos é de manager: agent lê e não grava", () => {
    const tipo = `insert into public.mia_obrigacoes_tipos (organization_id, pipeline_id, nome, categoria) values ('${ORG_A}', '${FUNIL_A}', 'Licença sanitária', 'documento')`;
    expect(countAs(AGENTE_1, `select count(*) from public.mia_obrigacoes_tipos where id = '${TIPO_A}';`)).toBe(1);
    expect(tentar(tipo, comoCliente(AGENTE_1))).toBe("42501");
    expect(tentar(`update public.mia_obrigacoes_tipos set validade_meses = 24 where id = '${TIPO_A}'`, comoCliente(AGENTE_1))).toBe("0 linhas");
    expect(tentar(tipo, comoCliente(GESTOR_A))).toBe("passou");
  });

  it("⭐ aviso só o servidor grava: a sessão nem tem o privilégio", () => {
    const aviso = `insert into public.mia_obrigacoes_avisos (organization_id, obrigacao_id, regra_id, gatilho, ciclo, ancora)
                   values ('${ORG_A}', '${ITEM_DA_EMPRESA}', '${REGRA_A}', 'obrigacao.documento_vencido', 1, current_date)`;
    expect(tentar(aviso, comoCliente(GESTOR_A))).toBe("42501");
    expect(tentar(`delete from public.mia_obrigacoes_avisos where organization_id = '${ORG_A}'`, comoCliente(GESTOR_A))).toBe("42501");
    expect(tentar(aviso)).toBe("passou");
  });

  it("⭐ item de negócio que a pessoa não enxerga também não aparece para ela", () => {
    const doNegocio = `select count(*) from public.mia_obrigacoes where id = '${ITEM_DO_NEGOCIO_DO_AGENTE_2}';`;
    // O negócio é do agente 2: o agente 1 não vê o negócio, logo não vê o item.
    expect(countAs(AGENTE_1, `select count(*) from public.crm_leads where id = '${NEGOCIO_DO_AGENTE_2}';`)).toBe(0);
    expect(countAs(AGENTE_1, doNegocio)).toBe(0);
    expect(countAs(AGENTE_2, doNegocio)).toBe(1);
    expect(countAs(GESTOR_A, doNegocio)).toBe(1);
    // O histórico segue o item.
    const historico = `select count(*) from public.mia_obrigacoes_ciclos where obrigacao_id = '${ITEM_DO_NEGOCIO_DO_AGENTE_2}';`;
    expect(countAs(AGENTE_1, historico)).toBe(0);
    expect(countAs(AGENTE_2, historico)).toBe(1);
    // E o agente 1 não altera nem pendura item no negócio que não vê.
    expect(tentar(`update public.mia_obrigacoes set observacao = 'x' where id = '${ITEM_DO_NEGOCIO_DO_AGENTE_2}'`, comoCliente(AGENTE_1))).toBe("0 linhas");
    expect(tentar(documento(novo, ORG_A, "lead_id", NEGOCIO_DO_AGENTE_2), comoCliente(AGENTE_1))).toBe("42501");
  });

  it("o item do negócio sem dono, o da empresa e o do contato, o agente 1 vê (controle)", () => {
    expect(
      countAs(
        AGENTE_1,
        `select count(*) from public.mia_obrigacoes where id in ('${ITEM_DO_NEGOCIO_LIVRE}', '${ITEM_DA_EMPRESA}', '${ITEM_DO_CONTATO}');`,
      ),
    ).toBe(3);
  });

  it("as funções: gatilho ninguém chama; disparar é só do servidor; fechar ciclo é da sessão", () => {
    const acl = sql(`
      select string_agg(p.proname || ':' ||
               has_function_privilege('anon', p.oid, 'execute')::text || ':' ||
               has_function_privilege('authenticated', p.oid, 'execute')::text, ' ' order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'fn_mia_obrigac%';
    `);
    expect(acl.split(" ")).toEqual([
      "fn_mia_obrigacao_arquivo_orfao:false:false",
      "fn_mia_obrigacao_disparar:false:false",
      "fn_mia_obrigacao_exige_dono:false:false",
      "fn_mia_obrigacao_fechar_ciclo:false:true",
      "fn_mia_obrigacao_sem_dono_sai:false:false",
      "fn_mia_obrigacoes_do_contato_anonimizado:false:false",
      "fn_mia_obrigacoes_seguem_a_empresa_mesclada:false:false",
      "fn_mia_obrigacoes_seguem_o_contato_mesclado:false:false",
    ]);
    expect(
      sql(`select bool_and(has_function_privilege('service_role', p.oid, 'execute'))::text
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fn_mia_obrigacao_disparar', 'fn_mia_obrigacao_fechar_ciclo');`),
    ).toBe("true");
  });

  it("o bucket dos arquivos é privado, com teto de 25 MB e sem policy de leitura para a sessão", () => {
    expect(sql(`select public::text || '|' || file_size_limit::text from storage.buckets where id = 'mia-obrigacoes';`)).toBe("false|26214400");
    expect(
      sql(`select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual, '') || coalesce(with_check, '')) like '%mia-obrigacoes%';`),
    ).toBe("0");
  });
});

describe("o item e os donos dele", () => {
  it("⭐ item sem negócio, empresa nem contato não nasce", () => {
    expect(
      tentar(`insert into public.mia_obrigacoes (organization_id, nome, categoria) values ('${ORG_A}', 'Solto', 'documento')`),
    ).toBe("23514");
  });

  it("cada categoria só guarda as datas dela, e o arquivo fica no espaço da empresa", () => {
    expect(
      tentar(`insert into public.mia_obrigacoes (organization_id, nome, categoria, empresa_id, valido_ate)
              values ('${ORG_A}', 'Relatório', 'atividade', '${EMPRESA_A}', current_date)`),
    ).toBe("23514");
    expect(
      tentar(`insert into public.mia_obrigacoes (organization_id, nome, categoria, empresa_id, proxima_em)
              values ('${ORG_A}', 'Alvará', 'documento', '${EMPRESA_A}', current_date)`),
    ).toBe("23514");
    expect(
      tentar(`update public.mia_obrigacoes set arquivo_path = '${ORG_B}/x/y.pdf' where id = '${ITEM_DA_EMPRESA}'`),
    ).toBe("23514");
    expect(
      tentar(`update public.mia_obrigacoes set arquivo_path = '${ORG_A}/x/y.pdf' where id = '${ITEM_DA_EMPRESA}'`),
    ).toBe("passou");
  });

  it("um nome de tipo por funil; arquivado, o nome fica livre de novo", () => {
    const repetido = `insert into public.mia_obrigacoes_tipos (organization_id, pipeline_id, nome, categoria)
                      values ('${ORG_A}', '${FUNIL_A}', '  alvará DE funcionamento ', 'documento')`;
    expect(tentar(repetido)).toBe("23505");
    expect(
      medir(`
        update public.mia_obrigacoes_tipos set arquivado_em = now() where id = '${TIPO_A}';
        ${repetido};
        select 'M:' || count(*) from public.mia_obrigacoes_tipos where organization_id = '${ORG_A}' and pipeline_id = '${FUNIL_A}';
      `),
    ).toBe("2");
  });

  it("a chave natural da importação não repete dentro da empresa", () => {
    expect(
      medir(`
        update public.mia_obrigacoes set chave_natural = 'alvara|empresa:x' where id = '${ITEM_DA_EMPRESA}';
        do $$ begin
          begin
            update public.mia_obrigacoes set chave_natural = 'alvara|empresa:x' where id = '${ITEM_DO_CONTATO}';
            perform set_config('inv.r', 'passou', true);
          exception when unique_violation then perform set_config('inv.r', 'repetida', true); end;
        end $$;
        select 'M:' || current_setting('inv.r');
      `),
    ).toBe("repetida");
  });

  it("⭐ o item que perde o último dono sai, e o arquivo dele vai para a fila de remoção", () => {
    const caminho = `${ORG_A}/${ITEM_DO_NEGOCIO_LIVRE}/sem-dono.pdf`;
    expect(
      medir(`
        update public.mia_obrigacoes set recebido_em = current_date, arquivo_path = '${caminho}', arquivo_nome = 'a.pdf'
         where id = '${ITEM_DO_NEGOCIO_LIVRE}';
        delete from public.crm_leads where id = '${NEGOCIO_LIVRE}';
        select 'M:' || (select count(*) from public.mia_obrigacoes where id in ('${ITEM_DO_NEGOCIO_LIVRE}', '${ATIVIDADE}'))
                    || '|' || (select count(*) from public.storage_redaction_queue
                                where bucket = 'mia-obrigacoes' and object_path = '${caminho}' and status = 'pending');
      `),
    ).toBe("0|1");
  });

  it("o item com outro dono fica: apagar o negócio não leva o que também é da empresa", () => {
    expect(
      medir(`
        update public.mia_obrigacoes set empresa_id = '${EMPRESA_A}' where id = '${ITEM_DO_NEGOCIO_LIVRE}';
        delete from public.crm_leads where id = '${NEGOCIO_LIVRE}';
        select 'M:' || coalesce(lead_id::text, 'sem negócio') || '|' || empresa_id from public.mia_obrigacoes where id = '${ITEM_DO_NEGOCIO_LIVRE}';
      `),
    ).toBe(`sem negócio|${EMPRESA_A}`);
  });

  it("trocar o arquivo sem ir ao histórico põe o antigo na fila; o que foi ao histórico continua guardado", () => {
    const antigo = `${ORG_A}/${ITEM_DA_EMPRESA}/antigo.pdf`;
    const novo = `${ORG_A}/${ITEM_DA_EMPRESA}/novo.pdf`;
    expect(
      medir(`
        update public.mia_obrigacoes set arquivo_path = '${antigo}' where id = '${ITEM_DA_EMPRESA}';
        update public.mia_obrigacoes set arquivo_path = '${novo}' where id = '${ITEM_DA_EMPRESA}';
        select 'M:' || count(*) from public.storage_redaction_queue where bucket = 'mia-obrigacoes' and object_path = '${antigo}';
      `),
    ).toBe("1");
    expect(
      medir(`
        update public.mia_obrigacoes set arquivo_path = '${antigo}' where id = '${ITEM_DA_EMPRESA}';
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2027-10-13',
                 null, '{"path":"${novo}","nome":"novo.pdf","mime":"application/pdf","bytes":"10"}'::jsonb);
        select 'M:' || (select count(*) from public.storage_redaction_queue where bucket = 'mia-obrigacoes' and object_path = '${antigo}')
                    || '|' || (select arquivo_path from public.mia_obrigacoes_ciclos where obrigacao_id = '${ITEM_DA_EMPRESA}' and ciclo = 1);
      `),
    ).toBe(`0|${antigo}`);
  });

  it("a ficha mesclada leva os itens: contato e empresa", () => {
    const outroContato = "90189018-3333-4000-8000-0000000000c2";
    const outraEmpresa = "90189018-7777-4000-8000-0000000000c2";
    expect(
      medir(`
        insert into public.contacts (id, organization_id, display_name) values ('${outroContato}', '${ORG_A}', 'Contato que fica 9018');
        update public.contacts set is_merged_into = '${outroContato}' where id = '${CONTATO_A}';
        insert into public.crm_empresas (id, organization_id, nome) values ('${outraEmpresa}', '${ORG_A}', 'Empresa que fica 9018');
        update public.crm_empresas set mesclada_com = '${outraEmpresa}', mesclada_em = now() where id = '${EMPRESA_A}';
        select 'M:' || (select contact_id from public.mia_obrigacoes where id = '${ITEM_DO_CONTATO}')
                    || '|' || (select empresa_id from public.mia_obrigacoes where id = '${ITEM_DA_EMPRESA}');
      `),
    ).toBe(`${outroContato}|${outraEmpresa}`);
  });
});

describe("o próximo ciclo nasce sozinho, e o anterior vai para o histórico", () => {
  const retrato = (id: string) => `
    select 'M:' || o.ciclo || '|' || coalesce(o.recebido_em::text, '-') || '|' || coalesce(o.valido_ate::text, '-')
           || '|' || coalesce(o.renovado_em::text, '-') || '|' || coalesce(o.pedido_em::text, '-')
           || '|' || coalesce(o.proxima_em::text, '-') || '|' || coalesce(o.feita_em::text, '-')
           || '|' || (select count(*) from public.mia_obrigacoes_ciclos c where c.obrigacao_id = o.id)
      from public.mia_obrigacoes o where o.id = '${id}';
  `;

  it("o primeiro recebimento não cria histórico: o item segue no ciclo 1", () => {
    expect(
      medir(`
        update public.mia_obrigacoes set pedido_em = date '2026-09-22', prazo_em = date '2026-09-29' where id = '${ITEM_DO_NEGOCIO_LIVRE}';
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DO_NEGOCIO_LIVRE}', 1, 'recebido', date '2026-10-01', date '2027-10-01');
        ${retrato(ITEM_DO_NEGOCIO_LIVRE)}
      `),
    ).toBe("1|2026-10-01|2027-10-01|-|-|-|-|0");
  });

  it("⭐ receber a versão nova: o ciclo anterior vai ao histórico com as datas dele, e o item segue no ciclo 2", () => {
    expect(
      medir(`
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2027-10-13');
        ${retrato(ITEM_DA_EMPRESA)}
      `),
    ).toBe("2|2026-10-01|2027-10-13|2026-10-01|-|-|-|1");
    expect(
      medir(`
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2027-10-13');
        select 'M:' || ciclo || '|' || como || '|' || recebido_em || '|' || valido_ate
          from public.mia_obrigacoes_ciclos where obrigacao_id = '${ITEM_DA_EMPRESA}';
      `),
    ).toBe("1|recebido|2025-10-14|2026-10-13");
  });

  it("recebido sem válido até: fica recebido, sem validade", () => {
    expect(
      medir(`
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DO_NEGOCIO_LIVRE}', 1, 'recebido', date '2026-10-01', null);
        ${retrato(ITEM_DO_NEGOCIO_LIVRE)}
      `),
    ).toBe("1|2026-10-01|-|-|-|-|-|0");
  });

  it("⭐ marcar feita: a atividade ganha a próxima data e o ciclo feito vai ao histórico", () => {
    expect(
      medir(`
        select public.fn_mia_obrigacao_fechar_ciclo('${ATIVIDADE}', 1, 'feita', date '2026-10-01', null, date '2026-11-05');
        ${retrato(ATIVIDADE)}
      `),
    ).toBe("2|-|-|-|-|2026-11-05|2026-10-01|1");
  });

  it("⭐ duas pessoas confirmando o mesmo ciclo: a segunda é recusada, em vez de fechar o ciclo seguinte", () => {
    expect(
      medir(`
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2027-10-13');
        do $$ begin
          begin
            perform public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2028-10-13');
            perform set_config('inv.r', 'passou', true);
          exception when others then perform set_config('inv.r', sqlstate, true); end;
        end $$;
        select 'M:' || current_setting('inv.r') || '|' || ciclo || '|' || valido_ate from public.mia_obrigacoes where id = '${ITEM_DA_EMPRESA}';
      `),
    ).toBe("40001|2|2027-10-13");
  });

  it("a função recusa a categoria errada, o item que não existe e a chamada sem dia", () => {
    expect(chamar(`public.fn_mia_obrigacao_fechar_ciclo('${ATIVIDADE}', 1, 'recebido', current_date)`)).toBe("22023");
    expect(chamar(`public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'feita', current_date)`)).toBe("22023");
    expect(chamar(`public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'arquivar', current_date)`)).toBe("22023");
    expect(chamar(`public.fn_mia_obrigacao_fechar_ciclo('90189018-8888-4000-8000-0000000000ff', 1, 'recebido', current_date)`)).toBe("P0002");
    expect(chamar(`public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', null)`)).toBe("22004");
  });

  it("⭐ vale a régua de quem chama: viewer e empresa vizinha não fecham ciclo; agent fecha", () => {
    const fechar = `public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DA_EMPRESA}', 1, 'recebido', date '2026-10-01', date '2027-10-13')`;
    expect(chamar(fechar, comoCliente(LEITOR))).toBe("P0002");
    expect(chamar(fechar, comoCliente(GESTOR_B))).toBe("P0002");
    expect(chamar(fechar, comoCliente(AGENTE_1))).toBe("passou");
    expect(sql(`select ciclo from public.mia_obrigacoes where id = '${ITEM_DA_EMPRESA}';`)).toBe("1");
  });
});

describe("cada gatilho dispara uma vez por regra, item, ciclo e data medida", () => {
  const disparar = (ancora: string, ciclo = 1, segurar = false, gatilho = "obrigacao.documento_vencendo") =>
    `public.fn_mia_obrigacao_disparar('${ORG_A}', '${ITEM_DA_EMPRESA}', '${REGRA_A}', '${gatilho}', ${ciclo}, date '${ancora}',
       '{"nome":"Alvará de funcionamento","dias":30}'::jsonb, ${segurar})`;
  const eventos = `(select count(*) from public.event_log where organization_id = '${ORG_A}' and entity_id = '${ITEM_DA_EMPRESA}' and event_type like 'obrigacao.%')`;

  it("⭐ a primeira chamada emite o evento dirigido à regra; a segunda, com a mesma data, não emite nada", () => {
    expect(
      medir(`
        select set_config('inv.a', coalesce(${disparar("2026-10-13")}::text, 'nulo'), true);
        select set_config('inv.b', coalesce(${disparar("2026-10-13")}::text, 'nulo'), true);
        select 'M:' || (current_setting('inv.a') <> 'nulo')::text || '|' || current_setting('inv.b') || '|' || ${eventos}
               || '|' || (select count(*) from public.mia_obrigacoes_avisos where obrigacao_id = '${ITEM_DA_EMPRESA}' and ancora = date '2026-10-13');
      `),
    ).toBe("true|nulo|1|1");
  });

  it("o evento leva o gatilho, o item como entidade e a regra a que se dirige", () => {
    expect(
      medir(`
        select set_config('inv.a', ${disparar("2026-10-13")}::text, true);
        select 'M:' || e.event_type || '|' || e.entity_kind || '|' || e.entity_id || '|' || (e.payload->>'rule_id') || '|' || (e.payload->>'dias')
               || '|' || e.status || '|' || (a.event_id = e.id)::text || '|' || (a.disparado_em is not null)::text
          from public.event_log e
          join public.mia_obrigacoes_avisos a on a.event_id = e.id
         where e.id = current_setting('inv.a')::uuid;
      `),
    ).toBe(`obrigacao.documento_vencendo|mia_obrigacao|${ITEM_DA_EMPRESA}|${REGRA_A}|30|pending|true|true`);
  });

  it("⭐ renovou (ciclo novo, validade nova): o aviso volta a valer; outro gatilho e outra regra contam à parte", () => {
    const outraRegra = "90189018-9999-4000-8000-0000000000a2";
    expect(
      medir(`
        insert into public.automation_rules (id, organization_id, name, trigger_event, actions, is_active)
          values ('${outraRegra}', '${ORG_A}', 'Outra', 'obrigacao.documento_vencendo', '[]'::jsonb, true);
        select ${disparar("2026-10-13")};
        select ${disparar("2027-10-13", 2)};
        select ${disparar("2026-10-13", 1, false, "obrigacao.documento_vencido")};
        select public.fn_mia_obrigacao_disparar('${ORG_A}', '${ITEM_DA_EMPRESA}', '${outraRegra}', 'obrigacao.documento_vencendo', 1, date '2026-10-13');
        -- as quatro de novo: nenhuma emite
        select ${disparar("2026-10-13")};
        select ${disparar("2027-10-13", 2)};
        select ${disparar("2026-10-13", 1, false, "obrigacao.documento_vencido")};
        select public.fn_mia_obrigacao_disparar('${ORG_A}', '${ITEM_DA_EMPRESA}', '${outraRegra}', 'obrigacao.documento_vencendo', 1, date '2026-10-13');
        select 'M:' || ${eventos};
      `),
    ).toBe("4");
  });

  it("⭐ aviso segurado não emite evento; solto, emite uma vez só", () => {
    const naoEnviado = (segurar: boolean) => disparar("2026-09-26", 1, segurar, "obrigacao.documento_nao_enviado");
    expect(
      medir(`
        select set_config('inv.a', coalesce(${naoEnviado(true)}::text, 'nulo'), true);
        select set_config('inv.b', coalesce(${naoEnviado(true)}::text, 'nulo'), true);
        select set_config('inv.c', ${eventos}::text || '|' || (select segurado::text || '|' || (event_id is null)::text
                 from public.mia_obrigacoes_avisos where obrigacao_id = '${ITEM_DA_EMPRESA}' and gatilho = 'obrigacao.documento_nao_enviado'), true);
        select set_config('inv.d', (${naoEnviado(false)} is not null)::text, true);
        select set_config('inv.e', coalesce(${naoEnviado(false)}::text, 'nulo'), true);
        select 'M:' || current_setting('inv.a') || '|' || current_setting('inv.b') || '|' || current_setting('inv.c')
               || '|' || current_setting('inv.d') || '|' || current_setting('inv.e') || '|' || ${eventos}
               || '|' || (select segurado::text from public.mia_obrigacoes_avisos
                           where obrigacao_id = '${ITEM_DA_EMPRESA}' and gatilho = 'obrigacao.documento_nao_enviado');
      `),
    ).toBe("nulo|nulo|0|true|true|true|nulo|1|false");
  });

  it("a sessão do cliente não dispara aviso: a função é só do servidor", () => {
    expect(chamar(disparar("2026-10-13"), comoCliente(GESTOR_A))).toBe("42501");
  });

  it("apagar a regra leva a trava dela; apagar o item leva as dele", () => {
    expect(
      medir(`
        select ${disparar("2026-10-13")};
        delete from public.automation_rules where id = '${REGRA_A}';
        select 'M:' || count(*) from public.mia_obrigacoes_avisos where regra_id = '${REGRA_A}';
      `),
    ).toBe("0");
  });
});

describe("a proposta do agente de IA não marca recebido", () => {
  const proposta = (id: string) =>
    `insert into public.mia_obrigacoes_propostas (id, organization_id, obrigacao_id, ciclo, contact_id, arquivo_nome, arquivo_mime, situacao)
       values ('${id}', '${ORG_A}', '${ITEM_DO_NEGOCIO_LIVRE}', 1, '${CONTATO_A}', 'alvara-2026.pdf', 'application/pdf', 'pendente')`;
  const P1 = "90189018-bbbb-4000-8000-000000000001";
  const P2 = "90189018-bbbb-4000-8000-000000000002";

  it("⭐ com a proposta gravada, o item continua como estava: sem recebimento, sem arquivo, no mesmo ciclo", () => {
    expect(
      medir(`
        update public.mia_obrigacoes set pedido_em = date '2026-09-26' where id = '${ITEM_DO_NEGOCIO_LIVRE}';
        ${proposta(P1)};
        select 'M:' || coalesce(recebido_em::text, 'não recebido') || '|' || coalesce(arquivo_path, 'sem arquivo') || '|' || ciclo || '|' || pedido_em
               || '|' || (select count(*) from public.mia_obrigacoes_ciclos c where c.obrigacao_id = o.id)
          from public.mia_obrigacoes o where o.id = '${ITEM_DO_NEGOCIO_LIVRE}';
      `),
    ).toBe("não recebido|sem arquivo|1|2026-09-26|0");
  });

  it("uma proposta pendente por item", () => {
    expect(
      medir(`
        ${proposta(P1)};
        do $$ begin
          begin
            ${proposta(P2)};
            perform set_config('inv.r', 'passou', true);
          exception when unique_violation then perform set_config('inv.r', 'já há uma pendente', true); end;
        end $$;
        select 'M:' || current_setting('inv.r');
      `),
    ).toBe("já há uma pendente");
  });

  it("⭐ quem marca recebido é a pessoa: a confirmação fecha o ciclo e decide a proposta", () => {
    expect(
      medir(`
        ${proposta(P1)};
        ${comoCliente(AGENTE_1)}
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DO_NEGOCIO_LIVRE}', 1, 'recebido', date '2026-10-01', date '2027-10-01',
                 null, null, '${AGENTE_1}', '${P1}');
        reset role;
        select 'M:' || o.recebido_em || '|' || p.situacao || '|' || p.decidida_por_user_id
          from public.mia_obrigacoes o join public.mia_obrigacoes_propostas p on p.obrigacao_id = o.id
         where p.id = '${P1}';
      `),
    ).toBe(`2026-10-01|confirmada|${AGENTE_1}`);
  });

  it("recebido por outro caminho, a proposta pendente fica superada (e não confirmada)", () => {
    expect(
      medir(`
        ${proposta(P1)};
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DO_NEGOCIO_LIVRE}', 1, 'recebido', date '2026-10-01', null);
        select 'M:' || situacao from public.mia_obrigacoes_propostas where id = '${P1}';
      `),
    ).toBe("superada");
  });
});

describe("LGPD: anonimizar o contato leva os itens e os arquivos", () => {
  const TITULAR = "90189018-3333-4000-8000-0000000000e1";
  const VIZINHO = "90189018-3333-4000-8000-0000000000e2";
  const NEGOCIO_DO_TITULAR = "90189018-6666-4000-8000-0000000000e1";
  const DO_TITULAR = "90189018-8888-4000-8000-0000000000e1";
  const DO_NEGOCIO_DO_TITULAR = "90189018-8888-4000-8000-0000000000e2";
  const DO_VIZINHO = "90189018-8888-4000-8000-0000000000e3";
  const arquivo = (nome: string) => `${ORG_A}/lgpd/${nome}.pdf`;

  const cenario = `
    insert into public.contacts (id, organization_id, display_name) values
      ('${TITULAR}', '${ORG_A}', 'Titular 9018'), ('${VIZINHO}', '${ORG_A}', 'Vizinho 9018');
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
      values ('${NEGOCIO_DO_TITULAR}', '${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'Negócio do titular 9018', '${TITULAR}');
    insert into public.mia_obrigacoes (id, organization_id, nome, categoria, contact_id, lead_id, recebido_em, arquivo_path, arquivo_nome, observacao) values
      ('${DO_TITULAR}', '${ORG_A}', 'CNH', 'documento', '${TITULAR}', null, date '2026-01-10', '${arquivo("cnh-atual")}', 'cnh.pdf', 'documento pessoal'),
      ('${DO_NEGOCIO_DO_TITULAR}', '${ORG_A}', 'Contrato assinado', 'documento', null, '${NEGOCIO_DO_TITULAR}', date '2026-02-10', '${arquivo("contrato")}', 'contrato.pdf', 'assinado em cartório'),
      ('${DO_VIZINHO}', '${ORG_A}', 'CNH', 'documento', '${VIZINHO}', null, date '2026-03-10', '${arquivo("cnh-do-vizinho")}', 'cnh.pdf', 'do vizinho');
    insert into public.mia_obrigacoes_ciclos (organization_id, obrigacao_id, ciclo, como, recebido_em, arquivo_path, arquivo_nome) values
      ('${ORG_A}', '${DO_TITULAR}', 1, 'recebido', date '2021-01-10', '${arquivo("cnh-antiga")}', 'cnh-antiga.pdf'),
      ('${ORG_A}', '${DO_NEGOCIO_DO_TITULAR}', 1, 'recebido', date '2025-02-10', '${arquivo("contrato-antigo")}', 'contrato-antigo.pdf');
    insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo, contact_id, arquivo_nome, situacao) values
      ('${ORG_A}', '${DO_TITULAR}', 1, '${TITULAR}', 'cnh-nova.pdf', 'pendente'),
      ('${ORG_A}', '${DO_NEGOCIO_DO_TITULAR}', 1, '${TITULAR}', 'contrato-novo.pdf', 'pendente');
  `;
  const anonimizar = `update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${TITULAR}';`;
  const naFila = (nome: string) =>
    `(select count(*) from public.storage_redaction_queue where bucket = 'mia-obrigacoes' and object_path = '${arquivo(nome)}' and status = 'pending')`;

  it("⭐ os itens ligados à pessoa saem inteiros, com o histórico e as propostas", () => {
    expect(
      medir(`
        ${cenario}
        ${anonimizar}
        select 'M:' || (select count(*) from public.mia_obrigacoes where id = '${DO_TITULAR}')
               || '|' || (select count(*) from public.mia_obrigacoes_ciclos where obrigacao_id = '${DO_TITULAR}')
               || '|' || (select count(*) from public.mia_obrigacoes_propostas where contact_id = '${TITULAR}');
      `),
    ).toBe("0|0|0");
  });

  it("⭐ os dos negócios dela ficam como registro do negócio, sem arquivo e sem texto livre", () => {
    expect(
      medir(`
        ${cenario}
        ${anonimizar}
        select 'M:' || o.nome || '|' || o.recebido_em || '|' || coalesce(o.arquivo_path, '-') || '|' || coalesce(o.arquivo_nome, '-')
               || '|' || coalesce(o.observacao, '-')
               || '|' || (select coalesce(c.arquivo_path, '-') || '/' || coalesce(c.arquivo_nome, '-')
                            from public.mia_obrigacoes_ciclos c where c.obrigacao_id = o.id)
          from public.mia_obrigacoes o where o.id = '${DO_NEGOCIO_DO_TITULAR}';
      `),
    ).toBe("Contrato assinado|2026-02-10|-|-|-|-/-");
  });

  it("⭐ todo arquivo vai para a fila de remoção: o do ciclo em vigor e os do histórico", () => {
    expect(
      medir(`
        ${cenario}
        ${anonimizar}
        select 'M:' || ${naFila("cnh-atual")} || ${naFila("cnh-antiga")} || ${naFila("contrato")} || ${naFila("contrato-antigo")};
      `),
    ).toBe("1111");
  });

  it("controle: o que é de outra pessoa não é tocado, e sem anonimizar nada acontece", () => {
    expect(
      medir(`
        ${cenario}
        ${anonimizar}
        select 'M:' || arquivo_path || '|' || observacao || '|' || ${naFila("cnh-do-vizinho")}
          from public.mia_obrigacoes where id = '${DO_VIZINHO}';
      `),
    ).toBe(`${arquivo("cnh-do-vizinho")}|do vizinho|0`);
    expect(
      medir(`
        ${cenario}
        update public.contacts set display_name = 'Titular 9018 renomeado' where id = '${TITULAR}';
        select 'M:' || (select count(*) from public.mia_obrigacoes where id = '${DO_TITULAR}') || '|' || ${naFila("cnh-atual")};
      `),
    ).toBe("1|0");
  });
});

describe("a empresa de demonstração não envia", () => {
  const SESSAO_DEMO = "90189018-2222-4000-8000-00000000000d";
  const SESSAO_REAL = "90189018-2222-4000-8000-00000000000a";
  const CONTATO_DEMO = "90189018-3333-4000-8000-00000000000d";
  const CONVERSA_DEMO = "90189018-4444-4000-8000-00000000000d";
  const CONVERSA_REAL = "90189018-4444-4000-8000-00000000000a";

  const cenario = `
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status, archived_at) values
      ('${SESSAO_DEMO}', '${DEMO}', 'mia-9018-demo', '\\x00'::bytea, 'STOPPED', now()),
      ('${SESSAO_REAL}', '${ORG_A}', 'mia-9018-real', '\\x00'::bytea, 'STOPPED', null);
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO_DEMO}', '${DEMO}', 'Contato Demo 9018', '+5500901890180');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id) values
      ('${CONVERSA_DEMO}', '${DEMO}', '${CONTATO_DEMO}', '${SESSAO_DEMO}'),
      ('${CONVERSA_REAL}', '${ORG_A}', '${CONTATO_A}', '${SESSAO_REAL}');
  `;
  const mensagem = (org: string, conversa: string, sessao: string, contato: string) =>
    `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
       values ('${org}', '${conversa}', '${sessao}', '${contato}', 'text', 'outbound', 'queued', 'Seu alvará vence em 12 dias.', 'user')`;

  it("⭐ o gatilho de obrigação vira evento na demonstração, e a mensagem que a regra mandaria é recusada na porta", () => {
    expect(
      medir(`
        ${cenario}
        select set_config('inv.evento', (public.fn_mia_obrigacao_disparar('${DEMO}', '${ITEM_DEMO}', '${REGRA_DEMO}',
                 'obrigacao.documento_vencendo', 1, date '2026-10-13') is not null)::text, true);
        do $$ begin
          begin
            ${mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO)};
            perform set_config('inv.r', 'passou', true);
          exception when others then perform set_config('inv.r', sqlstate || '|' || (sqlerrm like '%organizacao_de_demonstracao%')::text, true); end;
        end $$;
        select 'M:' || current_setting('inv.evento') || '|' || current_setting('inv.r')
               || '|' || (select count(*) from public.messages where organization_id = '${DEMO}' and direction = 'outbound' and status in ('queued', 'sending'));
      `),
    ).toBe("true|42501|true|0");
  });

  it("⭐ regra de obrigação que avisaria o grupo do time nem liga na demonstração; na empresa de verdade, liga", () => {
    const regra = (org: string) =>
      `insert into public.automation_rules (organization_id, name, trigger_event, actions, is_active)
         values ('${org}', 'Avisar o grupo', 'obrigacao.documento_vencido', '[{"type":"notify_group","config":{}}]'::jsonb, true)`;
    expect(tentar(regra(DEMO))).toBe("42501");
    expect(tentar(regra(ORG_A))).toBe("passou");
  });

  it("controle: a mesma mensagem, numa empresa de verdade, entra na fila", () => {
    expect(
      medir(`
        ${cenario}
        do $$ begin
          begin
            ${mensagem(ORG_A, CONVERSA_REAL, SESSAO_REAL, CONTATO_A)};
            perform set_config('inv.r', 'passou', true);
          exception when others then perform set_config('inv.r', sqlstate, true); end;
        end $$;
        select 'M:' || current_setting('inv.r');
      `),
    ).toBe("passou");
  });

  it("marcar pedido, receber e marcar feita na demonstração só mexem no banco: nenhum evento nasce do ato", () => {
    expect(
      medir(`
        update public.mia_obrigacoes set pedido_em = date '2026-09-26', prazo_em = date '2026-10-03' where id = '${ITEM_DEMO}';
        select public.fn_mia_obrigacao_fechar_ciclo('${ITEM_DEMO}', 1, 'recebido', date '2026-10-01', date '2027-10-13');
        select 'M:' || count(*) from public.event_log where organization_id = '${DEMO}' and entity_id = '${ITEM_DEMO}';
      `),
    ).toBe("0");
  });
});

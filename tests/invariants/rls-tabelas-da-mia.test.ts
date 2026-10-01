import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * ISOLAMENTO DAS TABELAS DA MIA — a prova comportamental que a varredura
 * `rls-completude-varredura.test.ts` exige de toda tabela com `organization_id`.
 *
 * Arquivo NOSSO, e não linhas em `TABLES` (`rls-isolation.test.ts`): aquela lista
 * é do upstream e entra da sincronização como ele a escreveu (docs/FORK-MIA.md,
 * regra 1). A varredura aponta para cá em `PROVA_PROPRIA`, uma entrada por tabela.
 *
 * Até 28/09/2026 nenhuma destas oito tinha prova nenhuma: o gate de banco nunca
 * tinha aplicado o `baseline-mia.sql`, então a varredura não as enxergava.
 *
 * O caminho é o da produção: `set role authenticated` + `request.jwt.claims`.
 * Conectar como `postgres` não mediria nada (rolbypassrls). As contagens são das
 * DUAS direções, e cada uma tem controle positivo — zero linhas do vizinho só
 * vale quando as próprias aparecem.
 *
 * O usuário semeado é `manager`: a leitura de carteira e preço exige esse piso
 * (é dinheiro do cliente), e o de destinatários exige `agent`. Um `agent` aqui
 * reprovaria o controle positivo por ACERTO da policy — e a "correção" natural
 * seria afrouxá-la.
 */

const ORG_A = "90019001-0000-4000-8000-00000000000a";
const ORG_B = "90019001-0000-4000-8000-00000000000b";
const GESTOR_A = "90019001-1111-4000-8000-00000000000a";
const GESTOR_B = "90019001-1111-4000-8000-00000000000b";

/** As que a sessão do cliente LÊ. `meta_onboardings` é só do servidor e vai à parte. */
const LIDAS_PELO_CLIENTE = [
  "sales_targets",
  "tenant_wallet_ledger",
  "tenant_broadcast_pricing",
  "organization_modules",
  "broadcasts",
  "broadcast_recipients",
  "crm_empresas",
  // .60 — os leads dos formulários da Meta (migration 9003): gerente lê, só o
  // servidor escreve.
  "mia_leads_da_meta_config",
  "mia_leads_da_meta_formularios",
  "mia_leads_da_meta_leituras",
  "mia_leads_da_meta_recebidos",
  // .61 — o dono de cada Página da Meta (migration 9004): gerente lê as da
  // própria empresa, só a plataforma atribui.
  "mia_paginas_da_meta",
  // 9017 — as conversões da Meta por etapa: gerente lê, só o servidor escreve.
  "mia_conversoes_meta_regras",
  "mia_conversoes_meta_config",
  // 9011 — a agenda do Outlook: dono da conta ou gerente lê, só o servidor escreve.
  "mia_agenda_microsoft_conexoes",
  "mia_agenda_microsoft_calendarios",
  "mia_agenda_microsoft_eventos",
  // 9014 — o vínculo do compromisso com o evento do Outlook.
  "mia_agenda_microsoft_compromissos",
  // 9015 — os tipos de agendamento que são reunião do Teams.
  "mia_agenda_tipos_com_teams",
] as const;

/**
 * As que SÓ A PLATAFORMA escreve (a policy é `for select` e a escrita é do
 * service_role). O grant de escrita a `authenticated` não pode existir: além de
 * mentir sobre o contrato, ele faz `fn_aplicar_travas_de_suporte` tratar a
 * tabela como gravável pela sessão.
 */
const SO_A_PLATAFORMA_ESCREVE = [
  "tenant_wallet_ledger",
  "tenant_broadcast_pricing",
  "organization_modules",
  "broadcast_recipients",
  "mia_leads_da_meta_config",
  "mia_leads_da_meta_formularios",
  "mia_leads_da_meta_leituras",
  "mia_leads_da_meta_recebidos",
  "mia_paginas_da_meta",
  // 9017 — as conversões da Meta por etapa: gerente lê, só o servidor escreve.
  "mia_conversoes_meta_regras",
  "mia_conversoes_meta_config",
  // 9011 — a agenda do Outlook: dono da conta ou gerente lê, só o servidor escreve.
  "mia_agenda_microsoft_conexoes",
  "mia_agenda_microsoft_calendarios",
  "mia_agenda_microsoft_eventos",
  // 9014 — o vínculo do compromisso com o evento do Outlook.
  "mia_agenda_microsoft_compromissos",
  // 9015 — os tipos de agendamento que são reunião do Teams.
  "mia_agenda_tipos_com_teams",
] as const;

/** As que a sessão do cliente ESCREVE, cada uma com a linha que tentaria gravar no vizinho. */
const ESCRITAS_PELO_CLIENTE: ReadonlyArray<{ tabela: string; insertNoVizinho: string }> = [
  {
    tabela: "sales_targets",
    insertNoVizinho: `insert into public.sales_targets (organization_id, periodo, metrica, alvo_quantidade)
                      values ('${ORG_B}', date '2031-01-01', 'reunioes', 7)`,
  },
  {
    tabela: "broadcasts",
    insertNoVizinho: `insert into public.broadcasts (organization_id, nome, template_name, template_language)
                      values ('${ORG_B}', 'intrusa', 'tpl', 'pt_BR')`,
  },
  {
    tabela: "crm_empresas",
    insertNoVizinho: `insert into public.crm_empresas (organization_id, nome) values ('${ORG_B}', 'Intrusa Ltda')`,
  },
];

function semear(org: string, gestor: string, tag: string): string {
  // Sem PII real: nomes e e-mails sintéticos (LGPD).
  return `
    insert into auth.users (id, email) values ('${gestor}', 'mia-rls-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'mia-rls-${tag}', 'MIA RLS ${tag}', 'MIA RLS ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${gestor}', '${org}', 'manager', now())
      on conflict do nothing;
    insert into public.sales_targets (organization_id, periodo, metrica, alvo_quantidade)
      values ('${org}', date '2030-01-01', 'reunioes', 10);
    insert into public.tenant_wallet_ledger (organization_id, tipo, amount_cents, ref_kind, ref_id)
      values ('${org}', 'credito', 10000, 'recarga_manual', 'mia-rls-${tag}');
    insert into public.tenant_broadcast_pricing (organization_id, preco_por_mensagem_cents)
      values ('${org}', 12);
    insert into public.organization_modules (organization_id, modulo)
      values ('${org}', 'disparador');
    with b as (
      insert into public.broadcasts (organization_id, nome, template_name, template_language)
        values ('${org}', 'campanha ${tag}', 'tpl_${tag}', 'pt_BR')
        returning id
    )
    insert into public.broadcast_recipients (organization_id, broadcast_id, phone_e164)
      select '${org}', b.id, '+550000000000${tag === "a" ? "1" : "2"}' from b;
    insert into public.crm_empresas (organization_id, nome) values ('${org}', 'Empresa ${tag}');
    insert into public.meta_onboardings (waba_id, organization_id) values ('mia-rls-waba-${tag}', '${org}');
    insert into public.mia_leads_da_meta_config (organization_id, ativo) values ('${org}', true);
    -- .61 (9004): formulário ativo só existe para Página da própria empresa, e o
    -- id de Página é só dígitos, como a Meta os devolve.
    insert into public.mia_paginas_da_meta (page_id, organization_id, page_name)
      values ('${tag === "a" ? "90040001" : "90040002"}', '${org}', 'Página ${tag}');
    with f as (
      insert into public.mia_leads_da_meta_formularios (organization_id, page_id, form_id)
        values ('${org}', '${tag === "a" ? "90040001" : "90040002"}', 'form-${tag}')
        returning id
    ), l as (
      insert into public.mia_leads_da_meta_leituras (organization_id, formulario_id, status)
        select '${org}', f.id, 'sem_novos' from f
        returning 1
    )
    insert into public.mia_leads_da_meta_recebidos (organization_id, chave_do_lead, formulario_id, desfecho)
      select '${org}', 'chave-${tag}', f.id, 'recusado' from f;
    -- 9017: a regra de uma etapa aberta e a chave dos leads de formulário.
    with fn as (
      insert into public.crm_pipelines (organization_id, name, slug)
        values ('${org}', 'Funil 9017 ${tag}', 'funil-9017-${tag}')
        returning id
    ), et as (
      insert into public.crm_stages (organization_id, pipeline_id, name, slug, position)
        select '${org}', fn.id, 'Qualificação', 'qualificacao-9017-${tag}', 1000 from fn
        returning id
    )
    insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento)
      select '${org}', et.id, 'lead_qualificado' from et;
    insert into public.mia_conversoes_meta_config (organization_id, leads_de_formulario) values ('${org}', true);
    -- 9011: a conta do Outlook do gestor, uma agenda e um evento de ocupação.
    with c as (
      insert into public.mia_agenda_microsoft_conexoes (organization_id, user_id, conta_email, microsoft_user_id, status)
        values ('${org}', '${gestor}', 'mia-rls-${tag}@invariant.test', 'ms-${tag}', 'healthy')
        returning id
    ), k as (
      insert into public.mia_agenda_microsoft_calendarios (organization_id, conexao_id, calendario_externo_id, nome, papel, conta_como_ocupado)
        select '${org}', c.id, 'cal-${tag}', 'Calendário', 'owner', true from c
        returning conexao_id
    )
    insert into public.mia_agenda_microsoft_eventos (organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim)
      select '${org}', k.conexao_id, 'cal-${tag}', 'ev-${tag}', timestamptz '2030-01-02 10:00+00', timestamptz '2030-01-02 11:00+00' from k;
    -- 9014: um compromisso publicado no Outlook.
    with ap as (
      insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, owner_user_id)
        values ('${org}', 'Compromisso ${tag}', timestamptz '2030-01-03 10:00+00', timestamptz '2030-01-03 11:00+00', '${gestor}')
        returning id
    )
    insert into public.mia_agenda_microsoft_compromissos (appointment_id, organization_id, evento_id)
      select ap.id, '${org}', 'ev-pub-${tag}' from ap;
    -- 9015: um tipo de agendamento Teams.
    with tp as (
      insert into public.calendar_event_types (organization_id, name, slug, location_kind, location_details)
        values ('${org}', 'Reunião Teams ${tag}', 'reuniao-teams-mia-${tag}', 'video_link', 'Microsoft Teams')
        returning id
    )
    insert into public.mia_agenda_tipos_com_teams (event_type_id, organization_id)
      select tp.id, '${org}' from tp;
  `;
}

/**
 * Tenta a escrita como `authenticated` com o JWT de `usuario`. Devolve quantas
 * linhas a escrita alcançou, ou `"recusada"` quando o banco a barrou (42501:
 * falta de privilégio OU `with check` da RLS). Qualquer outro erro sobe.
 */
function escreverComo(usuario: string, dml: string): number | "recusada" {
  const saida = sql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${usuario}"}', true);
    do $$
    declare n int;
    begin
      begin
        with w as (${dml} returning 1) select count(*) into n from w;
      exception when insufficient_privilege then
        n := -1;
      end;
      perform set_config('inv.escrita', n::text, true);
    end $$;
    select current_setting('inv.escrita');
    rollback;
  `);
  const linhas = saida.split("\n").filter((l) => /^-?\d+$/.test(l.trim()));
  const n = Number(linhas[linhas.length - 1]);
  if (Number.isNaN(n)) throw new Error(`saída inesperada do psql: ${saida}`);
  return n === -1 ? "recusada" : n;
}

beforeAll(() => {
  sql(semear(ORG_A, GESTOR_A, "a") + semear(ORG_B, GESTOR_B, "b"));
});

describe("tabelas da MIA: quem é de uma organização não lê a outra", () => {
  it("a semente existe nas duas organizações (sem isto, zero do vizinho não prova nada)", () => {
    for (const tabela of [...LIDAS_PELO_CLIENTE, "meta_onboardings"]) {
      expect(
        Number(
          lastLine(
            sql(`select count(distinct organization_id) from public.${tabela}
                  where organization_id in ('${ORG_A}','${ORG_B}');`),
          ),
        ),
        `semente de ${tabela}`,
      ).toBe(2);
    }
  });

  for (const tabela of LIDAS_PELO_CLIENTE) {
    it(`${tabela}: A lê as próprias e ZERO de B`, () => {
      expect(countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`)).toBeGreaterThanOrEqual(1);
      expect(countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBe(0);
    });

    it(`${tabela}: B lê as próprias e ZERO de A (a outra direção)`, () => {
      expect(countAs(GESTOR_B, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBeGreaterThanOrEqual(1);
      expect(countAs(GESTOR_B, `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`)).toBe(0);
    });

    it(`${tabela}: a tabela inteira, sem filtro, é só a da própria organização`, () => {
      expect(
        countAs(GESTOR_A, `select count(*) from public.${tabela} where organization_id <> '${ORG_A}';`),
      ).toBe(0);
    });
  }

  it("meta_onboardings: a sessão do cliente não lê NADA — nem a linha amarrada à própria organização", () => {
    // Só o servidor lê (a amarração é ato humano no /admin, pelo service_role).
    // Sem privilégio de SELECT o banco recusa a consulta inteira, em vez de
    // devolver zero linhas: é o contrato mais estreito, e é o que se mede.
    expect(() =>
      countAs(GESTOR_A, `select count(*) from public.meta_onboardings where organization_id = '${ORG_A}';`),
    ).toThrow(/permission denied/);
  });

  it("mia_meta_conexao_da_plataforma: a sessão do cliente não lê qual empresa empresta a conexão", () => {
    // Configuração da instalação (9004), exclusiva do servidor, como
    // `platform_ia`. Nem o gestor sabe de quem é o token que lê as Páginas dele.
    expect(() =>
      countAs(GESTOR_A, `select count(*) from public.mia_meta_conexao_da_plataforma;`),
    ).toThrow(/permission denied/);
  });
});

describe("tabelas da MIA: a escrita respeita a organização", () => {
  for (const tabela of SO_A_PLATAFORMA_ESCREVE) {
    it(`${tabela}: authenticated não tem privilégio de escrita — só a plataforma grava`, () => {
      const privilegios = lastLine(
        sql(`select has_table_privilege('authenticated', 'public.${tabela}', 'insert')::text || ','
                 || has_table_privilege('authenticated', 'public.${tabela}', 'update')::text || ','
                 || has_table_privilege('authenticated', 'public.${tabela}', 'delete')::text;`),
      );
      expect(privilegios).toBe("false,false,false");
    });

    it(`${tabela}: nem na PRÓPRIA organização o cliente grava`, () => {
      expect(
        escreverComo(GESTOR_A, `update public.${tabela} set organization_id = organization_id where organization_id = '${ORG_A}'`),
      ).toBe("recusada");
    });
  }

  for (const { tabela, insertNoVizinho } of ESCRITAS_PELO_CLIENTE) {
    it(`${tabela}: A não insere linha na organização B`, () => {
      expect(escreverComo(GESTOR_A, insertNoVizinho)).toBe("recusada");
    });

    it(`${tabela}: A não alcança linha de B com update nem delete`, () => {
      expect(
        escreverComo(GESTOR_A, `update public.${tabela} set organization_id = organization_id where organization_id = '${ORG_B}'`),
      ).toBe(0);
      expect(escreverComo(GESTOR_A, `delete from public.${tabela} where organization_id = '${ORG_B}'`)).toBe(0);
    });

    it(`${tabela}: controle positivo — A atualiza a própria linha`, () => {
      expect(
        escreverComo(GESTOR_A, `update public.${tabela} set organization_id = organization_id where organization_id = '${ORG_A}'`),
      ).toBeGreaterThanOrEqual(1);
    });
  }
});

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * FORK MIA (MIA-244) — AS LEITURAS DO `ver_meus_leads` E DO `ver_minha_rotina`
 * PELA SESSÃO, nos três papéis, contra o Postgres de verdade (papel
 * `authenticated` com o JWT de cada pessoa, como o PostgREST faz).
 *
 * A suspeita do diagnóstico da MIA-239 era que alguma leitura do Radar
 * (`cron_jobs`, `followup_enrollments`, agentes...) RECUSASSE pela RLS no turno
 * do assistente, que roda com o cliente da sessão. Não recusa: a RLS FILTRA,
 * não lança. Este arquivo prende isso para os três papéis (administrador,
 * gestor e atendente), e prende o recorte de cada um:
 *
 *   - administrador e gestor contam todos os negócios abertos da empresa; o
 *     atendente, os dele e os sem dono (o modo padrão "own_and_unassigned");
 *   - o recorte por funil e por data de criação (a pergunta "quantos chegaram no
 *     funil Comercial") vale igual nos três;
 *   - as tarefas concluídas (`done`) contam pela sessão, cada um as suas;
 *   - nenhuma tabela que o Radar lê dá erro de permissão para os três papéis;
 *   - outra empresa vê zero.
 *
 * As causas de verdade (o Radar que lançava e levava a ferramenta junto, e a
 * contagem presa no teto de 1.000 linhas do PostgREST) estão provadas em
 * `tests/unit/assistente-leads-e-tarefas-por-periodo.test.ts`.
 *
 * Dado fictício: Academia Alfa, Ana Exemplo. Nenhum dado real.
 */

const ORG = "92440000-0000-4000-8000-00000000000a";
const OUTRA = "92440000-0000-4000-8000-00000000000b";
const ADMIN = "92440000-1111-4000-8000-0000000000a1";
const GESTOR = "92440000-1111-4000-8000-0000000000a2";
const ANA = "92440000-1111-4000-8000-0000000000a3";
const BETO = "92440000-1111-4000-8000-0000000000a4";
const DE_FORA = "92440000-1111-4000-8000-0000000000b1";
const COMERCIAL = "92440000-2222-4000-8000-000000000001";
const POS_VENDA = "92440000-2222-4000-8000-000000000002";
const ETAPA_COMERCIAL = "92440000-3333-4000-8000-000000000001";
const ETAPA_POS = "92440000-3333-4000-8000-000000000002";

const TABELAS_DO_RADAR = [
  "crm_pipelines",
  "crm_stages",
  "ai_agents",
  "cron_jobs",
  "followup_enrollments",
  "conversations",
  "contacts",
  "calendar_appointments",
  "demandas",
  "demanda_conversas",
  "crm_proposals",
  "agent_inbox_items",
] as const;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'mia244-admin@invariant.test'),
      ('${GESTOR}', 'mia244-gestor@invariant.test'),
      ('${ANA}', 'mia244-ana@invariant.test'),
      ('${BETO}', 'mia244-beto@invariant.test'),
      ('${DE_FORA}', 'mia244-fora@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'academia-alfa-9244', 'Academia Alfa', 'Academia Alfa'),
      ('${OUTRA}', 'outra-9244', 'Outra Empresa', 'Outra Empresa')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN}', '${ORG}', 'admin', now()),
      ('${GESTOR}', '${ORG}', 'manager', now()),
      ('${ANA}', '${ORG}', 'agent', now()),
      ('${BETO}', '${ORG}', 'agent', now()),
      ('${DE_FORA}', '${OUTRA}', 'admin', now())
      on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${COMERCIAL}', '${ORG}', 'Comercial', 'comercial-9244'),
      ('${POS_VENDA}', '${ORG}', 'Pós-venda', 'pos-venda-9244');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${ETAPA_COMERCIAL}', '${ORG}', '${COMERCIAL}', 'Novo', 'novo-comercial-9244', 100),
      ('${ETAPA_POS}', '${ORG}', '${POS_VENDA}', 'Novo', 'novo-pos-9244', 100);
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, owner_user_id, owner_kind, assigned_at, source, created_at) values
      ('${ORG}', '${COMERCIAL}', '${ETAPA_COMERCIAL}', 'Plano anual', '${ANA}', 'user', now(), 'meta_ads', now()),
      ('${ORG}', '${COMERCIAL}', '${ETAPA_COMERCIAL}', 'Plano mensal', '${ANA}', 'user', now(), 'whatsapp', now()),
      ('${ORG}', '${COMERCIAL}', '${ETAPA_COMERCIAL}', 'Avaliação física', '${BETO}', 'user', now(), 'site', now()),
      ('${ORG}', '${COMERCIAL}', '${ETAPA_COMERCIAL}', 'Aula experimental', '${BETO}', 'user', now(), 'site', now() - interval '40 days');
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, source, created_at) values
      ('${ORG}', '${POS_VENDA}', '${ETAPA_POS}', 'Renovação', 'manual', now());
    insert into public.crm_tasks (organization_id, title, status, assigned_to, created_by) values
      ('${ORG}', 'Ligar para a aluna nova', 'done', '${ANA}', '${ANA}'),
      ('${ORG}', 'Mandar a grade de horários', 'done', '${ANA}', '${ANA}'),
      ('${ORG}', 'Confirmar a avaliação', 'pending', '${ANA}', '${ANA}'),
      ('${ORG}', 'Revisar os planos', 'done', '${BETO}', '${BETO}');
  `);
});

const ABERTOS = `select count(*) from public.crm_leads where organization_id = '${ORG}' and status = 'open';`;
const CHEGARAM_NO_COMERCIAL = `select count(*) from public.crm_leads
  where organization_id = '${ORG}' and pipeline_id = '${COMERCIAL}'
    and created_at >= now() - interval '1 day' and created_at < now() + interval '1 day';`;
const CONCLUIDAS_HOJE = `select count(*) from public.crm_tasks
  where organization_id = '${ORG}' and status = 'done'
    and updated_at >= now() - interval '1 day' and updated_at < now() + interval '1 day'`;

describe("ver_meus_leads pela sessão: cada papel conta o que vê, sem erro", () => {
  it("administrador e gestor contam todos os abertos da empresa", () => {
    expect(countAs(ADMIN, ABERTOS)).toBe(5);
    expect(countAs(GESTOR, ABERTOS)).toBe(5);
  });

  it("a atendente conta os dela e os sem dono, nunca os do colega", () => {
    expect(countAs(ANA, ABERTOS)).toBe(3);
    expect(countAs(ANA, `select count(*) from public.crm_leads where organization_id = '${ORG}' and owner_user_id = '${BETO}';`)).toBe(0);
  });

  it("o recorte por funil e por data de criação vale nos três papéis", () => {
    expect(countAs(ADMIN, CHEGARAM_NO_COMERCIAL)).toBe(3);
    expect(countAs(GESTOR, CHEGARAM_NO_COMERCIAL)).toBe(3);
    expect(countAs(ANA, CHEGARAM_NO_COMERCIAL)).toBe(2);
  });

  it("os funis, pelo nome, aparecem para os três papéis", () => {
    for (const quem of [ADMIN, GESTOR, ANA]) {
      expect(countAs(quem, `select count(*) from public.crm_pipelines where organization_id = '${ORG}' and name = 'Comercial';`)).toBe(1);
    }
  });

  it("nenhuma tabela que o Radar lê recusa a sessão, em nenhum dos três papéis", () => {
    for (const quem of [ADMIN, GESTOR, ANA]) {
      for (const tabela of TABELAS_DO_RADAR) {
        // `countAs` lança se o psql sair com erro (42501 incluído).
        expect(countAs(quem, `select count(*) from public.${tabela} where organization_id = '${ORG}';`), `${tabela}`).toBeGreaterThanOrEqual(0);
      }
      expect(countAs(quem, `select count(settings) from public.organizations where id = '${ORG}';`)).toBe(1);
    }
  });

  it("outra empresa vê zero", () => {
    expect(countAs(DE_FORA, ABERTOS)).toBe(0);
    expect(countAs(DE_FORA, `${CONCLUIDAS_HOJE};`)).toBe(0);
  });
});

describe("ver_minha_rotina pela sessão: as tarefas concluídas hoje", () => {
  it("a atendente conta as dela", () => {
    expect(countAs(ANA, `${CONCLUIDAS_HOJE} and assigned_to = '${ANA}';`)).toBe(2);
  });

  it("administrador e gestor contam as da equipe", () => {
    expect(countAs(ADMIN, `${CONCLUIDAS_HOJE};`)).toBe(3);
    expect(countAs(GESTOR, `${CONCLUIDAS_HOJE};`)).toBe(3);
  });
});

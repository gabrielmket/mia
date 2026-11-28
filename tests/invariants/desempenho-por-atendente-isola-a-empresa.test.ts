/**
 * MIA-361 · ponto 3 · A CONTA POR ATENDENTE (`fn_attendant_metrics`, a tabela
 * da tela Desempenho) FILTRA A EMPRESA EM TODA LEITURA E CONTA A JANELA PEDIDA.
 *
 * ─── Por que isto importa mais do que parece ────────────────────────────────
 *
 * A função é SECURITY INVOKER: pela sessão, a RLS de cada tabela já esconde a
 * outra empresa (provado em `tests/invariants/gov-8-metrics.test.ts`). Mas a
 * rota `/api/v1/metrics/attendants` também aceita o token da empresa (MCP de
 * dentro, `resolveAuthDual`), e por ele o cliente é o de SERVIÇO: não há RLS, e
 * a única coisa que separa as empresas é o `p_org` dentro da função. Aqui a
 * chamada é como `postgres` (o mesmo efeito do service_role: a RLS não entra).
 *
 * O cenário que pegaria um filtro faltando: a Ana Exemplo trabalha em DUAS
 * empresas (a Academia Alfa e outra), com negócios ganhos e perdidos,
 * conversas, primeira resposta, ligações e negócios abertos nas duas. A conta
 * da Academia Alfa tem de trazer só o da Academia Alfa, em cada uma das seis
 * leituras (negócios, conversas, mensagens da primeira resposta, ligações, o
 * funil e o recorte por etiqueta).
 *
 * A JANELA é meia-aberta, `[p_from, p_to)`: o ganho exatamente em `p_from`
 * conta, o de `p_to` não, a conversa atribuída antes de `p_from` não conta. A
 * rota manda `p_to = agora` e `p_from = agora − 30 dias` quando a tela não
 * passa período (a tela diz "nos últimos 30 dias"): a régua da rota está em
 * `tests/unit/periodo-do-desempenho-e-da-evolucao.test.ts`.
 *
 * Namespace `e9361aaa-` (exclusivo deste arquivo). Dados fictícios.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG_A = "e9361aaa-0000-4000-8000-00000000000a";
const ORG_B = "e9361aaa-0000-4000-8000-00000000000b";
const ANA = "e9361aaa-1111-4000-8000-000000000001";
const BETO = "e9361aaa-1111-4000-8000-000000000002";
const SESSAO_A = "e9361aaa-4444-4000-8000-00000000000a";
const SESSAO_B = "e9361aaa-4444-4000-8000-00000000000b";
const FUNIL_A = "e9361aaa-2222-4000-8000-00000000000a";
const FUNIL_B = "e9361aaa-2222-4000-8000-00000000000b";
const ETAPA_A = "e9361aaa-3333-4000-8000-00000000000a";
const ETAPA_B = "e9361aaa-3333-4000-8000-00000000000b";
const CONTATO_A1 = "e9361aaa-6666-4000-8000-0000000000a1";
const CONTATO_A2 = "e9361aaa-6666-4000-8000-0000000000a2";
const CONTATO_A3 = "e9361aaa-6666-4000-8000-0000000000a3";
const CONV_A1 = "e9361aaa-7777-4000-8000-0000000000a1";
const CONV_A_ANTES = "e9361aaa-7777-4000-8000-0000000000a2";
const CONV_A_FORNECEDOR = "e9361aaa-7777-4000-8000-0000000000a3";

const DE = "2026-10-01T00:00:00+00";
const ATE = "2026-10-31T00:00:00+00";
const DENTRO = "2026-10-10T12:00:00+00";

interface LinhaDoAtendente {
  user_id: string;
  won: number;
  lost: number;
  conversations_handled: number;
  avg_first_response_seconds: number | null;
  median_first_response_seconds: number | null;
  calls_answered: number;
  call_seconds: number;
}
interface Resposta {
  attendants: LinhaDoAtendente[];
  funnel: Array<{ stage_id: string; count: number }>;
  excluded_conversations: number;
}

/** Como a plataforma (sem RLS): só o `p_org` separa as empresas. */
function conta(org: string, extra = "null, null"): Resposta {
  return JSON.parse(
    lastLine(sql(`select public.fn_attendant_metrics('${org}'::uuid, '${DE}', '${ATE}', ${extra})::text;`)),
  ) as Resposta;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ANA}', 'mia361-ana@invariant.test'),
      ('${BETO}', 'mia361-beto@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'mia361-academia-alfa-desempenho', 'Academia Alfa', 'Academia Alfa'),
      ('${ORG_B}', 'mia361-outra-desempenho', 'Outra Empresa', 'Outra Empresa')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ANA}', '${ORG_A}', 'manager', now()),
      ('${ANA}', '${ORG_B}', 'agent', now()),
      ('${BETO}', '${ORG_B}', 'agent', now())
      on conflict do nothing;

    do $m361$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO_A}', '${ORG_A}', 'mia361-a', '\\x00'::bytea);
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO_B}', '${ORG_B}', 'mia361-b', '\\x00'::bytea);
    exception when unique_violation then null; end $m361$;

    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${FUNIL_A}', '${ORG_A}', 'Matrículas', 'matriculas-m361'),
      ('${FUNIL_B}', '${ORG_B}', 'Vendas', 'vendas-m361')
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${ETAPA_A}', '${ORG_A}', '${FUNIL_A}', 'Aula experimental', 'aula-m361', 1000),
      ('${ETAPA_B}', '${ORG_B}', '${FUNIL_B}', 'Proposta', 'proposta-m361', 1000)
      on conflict do nothing;

    insert into public.contacts (id, organization_id, display_name, tags) values
      ('${CONTATO_A1}', '${ORG_A}', 'Contato fictício A1', '{}'),
      ('${CONTATO_A2}', '${ORG_A}', 'Contato fictício A2', '{}'),
      ('${CONTATO_A3}', '${ORG_A}', 'Fornecedor fictício', array['Fornecedor'])
      on conflict do nothing;

    -- NEGÓCIOS da Ana na Academia Alfa: ganho em p_from (conta), ganho no meio
    -- (conta), perdido no meio (conta), ganho em p_to (NÃO conta), um aberto.
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id, closed_at, lost_reason) values
      ('${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A ganho no início', 'won', '${ANA}', '${DE}', null),
      ('${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A ganho', 'won', '${ANA}', '${DENTRO}', null),
      ('${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A perdido', 'lost', '${ANA}', '${DENTRO}', 'price'),
      ('${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A ganho no fim', 'won', '${ANA}', '${ATE}', null);
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id) values
      ('${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A aberto', 'open', '${ANA}');

    -- NEGÓCIOS da Ana (e do Beto) na OUTRA empresa: números que não podem aparecer em A.
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id, closed_at, lost_reason)
      select '${ORG_B}', '${FUNIL_B}', '${ETAPA_B}', 'B ganho '||g, 'won', '${ANA}', '${DENTRO}', null from generate_series(1,5) g;
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id, closed_at, lost_reason)
      select '${ORG_B}', '${FUNIL_B}', '${ETAPA_B}', 'B perdido '||g, 'lost', '${ANA}', '${DENTRO}', 'price' from generate_series(1,3) g;
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id, closed_at, lost_reason)
      values ('${ORG_B}', '${FUNIL_B}', '${ETAPA_B}', 'B ganho do Beto', 'won', '${BETO}', '${DENTRO}', null);
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, owner_user_id)
      select '${ORG_B}', '${FUNIL_B}', '${ETAPA_B}', 'B aberto '||g, 'open', '${ANA}' from generate_series(1,7) g;

    -- CONVERSAS na Academia Alfa: uma atribuída na janela (resposta em 60 s),
    -- uma atribuída ANTES da janela (não conta), uma de fornecedor (o recorte).
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assigned_at, assignee_kind) values
      ('${CONV_A1}', '${ORG_A}', '${CONTATO_A1}', '${SESSAO_A}', 'claimed', '${ANA}', '${DENTRO}', 'user'),
      ('${CONV_A_ANTES}', '${ORG_A}', '${CONTATO_A2}', '${SESSAO_A}', 'claimed', '${ANA}', '2026-09-30T23:59:59+00', 'user'),
      ('${CONV_A_FORNECEDOR}', '${ORG_A}', '${CONTATO_A3}', '${SESSAO_A}', 'claimed', '${ANA}', '${DENTRO}', 'user')
      on conflict do nothing;
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, sent_via, sent_by_user_id, sent_at) values
      ('${ORG_A}', '${CONV_A1}', '${SESSAO_A}', '${CONTATO_A1}', 'text', 'inbound', 'crm', null, '2026-10-10T12:00:00+00'),
      ('${ORG_A}', '${CONV_A1}', '${SESSAO_A}', '${CONTATO_A1}', 'text', 'outbound', 'user', '${ANA}', '2026-10-10T12:01:00+00'),
      ('${ORG_A}', '${CONV_A_FORNECEDOR}', '${SESSAO_A}', '${CONTATO_A3}', 'text', 'inbound', 'crm', null, '2026-10-10T12:00:00+00'),
      ('${ORG_A}', '${CONV_A_FORNECEDOR}', '${SESSAO_A}', '${CONTATO_A3}', 'text', 'outbound', 'user', '${ANA}', '2026-10-12T12:00:00+00');

    -- CONVERSAS da Ana na OUTRA empresa: quatro, cada uma respondida em 600 s.
    do $m361c$
    declare i int; v_contato uuid; v_conversa uuid;
    begin
      for i in 1..4 loop
        insert into public.contacts (organization_id, display_name) values ('${ORG_B}', 'Contato fictício B' || i)
          returning id into v_contato;
        insert into public.conversations (organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assigned_at, assignee_kind)
          values ('${ORG_B}', v_contato, '${SESSAO_B}', 'claimed', '${ANA}', '${DENTRO}', 'user')
          returning id into v_conversa;
        insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, sent_via, sent_by_user_id, sent_at) values
          ('${ORG_B}', v_conversa, '${SESSAO_B}', v_contato, 'text', 'inbound', 'crm', null, '2026-10-10T12:00:00+00'),
          ('${ORG_B}', v_conversa, '${SESSAO_B}', v_contato, 'text', 'outbound', 'user', '${ANA}', '2026-10-10T12:10:00+00');
      end loop;
    end $m361c$;

    -- LIGAÇÕES atendidas: uma da Ana em A (30 s), duas da Ana em B (999 s cada).
    insert into public.voice_calls (organization_id, channel_session_id, wacalls_call_id, direction, peer_phone, status, owner_user_id, answered_at, duration_ms) values
      ('${ORG_A}', '${SESSAO_A}', 'mia361-a-1', 'inbound', '5511900000001', 'ended', '${ANA}', '${DENTRO}', 30000),
      ('${ORG_B}', '${SESSAO_B}', 'mia361-b-1', 'inbound', '5511900000002', 'ended', '${ANA}', '${DENTRO}', 999000),
      ('${ORG_B}', '${SESSAO_B}', 'mia361-b-2', 'inbound', '5511900000003', 'ended', '${ANA}', '${DENTRO}', 999000)
      on conflict do nothing;
  `);
});

describe("⭐ a conta da Academia Alfa traz só a Academia Alfa (sem RLS, só o p_org)", () => {
  it("uma linha, a da Ana, com os números de A em cada leitura", () => {
    const r = conta(ORG_A);
    expect(r.attendants.map((a) => a.user_id)).toEqual([ANA]);
    expect(r.attendants[0]).toMatchObject({
      won: 2, // o de p_from conta; o de p_to não
      lost: 1,
      conversations_handled: 2, // a atribuída antes da janela não conta
      calls_answered: 1,
      call_seconds: 30,
    });
    // A primeira resposta: 60 s (A1) e 2 dias (o fornecedor), nunca os 600 s de B.
    expect(r.attendants[0]!.avg_first_response_seconds).toBeCloseTo((60 + 172_800) / 2, 3);
    expect(r.attendants[0]!.median_first_response_seconds).toBeCloseTo((60 + 172_800) / 2, 3);
  });

  it("o funil: só etapas de A, e só o aberto de A", () => {
    const r = conta(ORG_A);
    const ids = r.funnel.map((e) => e.stage_id);
    expect(ids).toContain(ETAPA_A);
    expect(ids).not.toContain(ETAPA_B);
    expect(r.funnel.reduce((s, e) => s + e.count, 0)).toBe(1);
    const daOutra = lastLine(
      sql(`select count(*) from public.crm_stages where organization_id <> '${ORG_A}' and id = any(array[${ids.map((i) => `'${i}'::uuid`).join(",") || "null::uuid"}]);`),
    );
    expect(daOutra).toBe("0");
  });

  it("filtrando a Ana (p_owner), o mesmo: a Ana de B não entra", () => {
    const r = conta(ORG_A, `'${ANA}'::uuid, null`);
    expect(r.attendants).toHaveLength(1);
    expect(r.attendants[0]).toMatchObject({ won: 2, lost: 1, conversations_handled: 2, calls_answered: 1 });
  });

  it("o recorte por etiqueta lê só os contatos de A", () => {
    const r = conta(ORG_A, `null, 'fornecedor'`);
    expect(r.excluded_conversations).toBe(1);
    expect(r.attendants[0]).toMatchObject({ conversations_handled: 1 });
    expect(r.attendants[0]!.avg_first_response_seconds).toBeCloseTo(60, 3);
  });

  it("CONTROLE: a outra empresa tem os números dela (o cenário tinha o que vazar)", () => {
    const r = conta(ORG_B);
    const ana = r.attendants.find((a) => a.user_id === ANA);
    expect(ana).toMatchObject({ won: 5, lost: 3, conversations_handled: 4, calls_answered: 2, call_seconds: 1998 });
    expect(ana!.avg_first_response_seconds).toBeCloseTo(600, 3);
    expect(r.attendants.map((a) => a.user_id)).toContain(BETO);
    expect(r.funnel.reduce((s, e) => s + e.count, 0)).toBe(7);
  });
});

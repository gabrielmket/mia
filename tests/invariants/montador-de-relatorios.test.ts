/**
 * 9040 a 9042 · O MONTADOR DE RELATÓRIOS no Postgres de verdade.
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * As decisões do protótipo aprovado em 15/10/2026 ("Quem vê e quem faz") viram
 * RLS e gatilho, e cada uma tem as DUAS pontas: quem pode (controle positivo) e
 * quem não pode (controle negativo). Zero linhas do vizinho só vale quando as
 * próprias aparecem.
 *
 * 1. O RELATÓRIO SALVO: todo membro cria os próprios (o dono é quem cria, mesmo
 *    que o pedido diga outro); o "só para mim" de outra pessoa não aparece para
 *    ninguém, nem para o administrador; o compartilhado aparece para a equipe;
 *    só gestor e administrador compartilham (42501 para o atendente, na criação
 *    e na passagem); quem criou e o administrador editam e apagam o
 *    compartilhado, o atendente não (zero linhas); dono e empresa não mudam;
 *    configuração fora do catálogo do motor não entra (23514); outra empresa e
 *    `anon` não leem.
 * 2. O PAINEL e os ITENS: o item segue o painel; quem não edita o painel não
 *    põe item nele; só entra no painel o relatório que a pessoa enxerga; o
 *    item nunca cruza empresa (chave composta); apagar o relatório tira-o do
 *    painel.
 * 3. O REGISTRO DAS EXPORTAÇÕES: só gestor e administrador leem e gravam, cada
 *    um a sua; ninguém altera nem apaga.
 * 4. O FUNIL DOS PRONTOS: todo membro lê; só gestor escolhe.
 * 5. O MOTOR (9041): produto do negócio (o das propostas, sem as canceladas),
 *    filtro com vários valores (e "__sem" dentro da lista), funil e só-receita
 *    de um valor só, a meta em cada grupo de tempo, o funil com a soma, o
 *    responsável no follow-up e o agente pelo nome nas conversas.
 * 6. A LISTA por trás do número: o mesmo número do grupo, "Outros" pelos
 *    dobrados, a célula, a etapa do funil, a RLS de quem pergunta, sem valores
 *    o valor some, e o limite.
 * 7. O LINK DO DONO para o painel do usuário (9042): ou os prontos, ou o
 *    painel; apagar o painel apaga o link.
 *
 * Organizações próprias (namespace `e9040e90-`). Nenhum dado de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

const ORG_A = "e9040e90-0000-4000-8000-00000000000a";
const ORG_B = "e9040e90-0000-4000-8000-00000000000b";
const ADMIN_A = "e9040e90-1111-4000-8000-0000000000a0";
const GESTOR_A = "e9040e90-1111-4000-8000-0000000000a1";
const AT1 = "e9040e90-1111-4000-8000-0000000000a2";
const AT2 = "e9040e90-1111-4000-8000-0000000000a3";
const GESTOR_B = "e9040e90-1111-4000-8000-0000000000b1";

const R_GESTOR_PRIV = "e9040e90-2222-4000-8000-000000000001";
const R_GESTOR_COMP = "e9040e90-2222-4000-8000-000000000002";
const R_AT1_PRIV = "e9040e90-2222-4000-8000-000000000003";
const R_DE_B = "e9040e90-2222-4000-8000-0000000000b1";
const P_GESTOR_COMP = "e9040e90-3333-4000-8000-000000000001";
const P_AT1 = "e9040e90-3333-4000-8000-000000000002";
const P_PARA_LINK = "e9040e90-3333-4000-8000-000000000003";
const I_COMP = "e9040e90-3333-4000-8000-0000000000c1";
const I_AT1 = "e9040e90-3333-4000-8000-0000000000c2";

const FUNIL = "e9040e90-4444-4000-8000-000000000001";
const E1 = "e9040e90-4444-4000-8000-0000000000e1";
const E2 = "e9040e90-4444-4000-8000-0000000000e2";
const EW = "e9040e90-4444-4000-8000-0000000000e3";
const EL = "e9040e90-4444-4000-8000-0000000000e4";
const C = (n: number) => `e9040e90-5555-4000-8000-00000000000${n}`;
const L = (n: number) => `e9040e90-6666-4000-8000-00000000000${n}`;
const SESSAO = "e9040e90-7777-4000-8000-000000000001";
const CV1 = "e9040e90-7777-4000-8000-0000000000c1";
const CV2 = "e9040e90-7777-4000-8000-0000000000c2";
const AGENTE = "e9040e90-8888-4000-8000-000000000001";
const AGORA = "2026-10-15 12:00:00-03";

/** Uma escrita como `usuario` (`anon`, `service_role` ou o uuid de alguém): `n:<linhas>` ou o SQLSTATE. */
function executar(usuario: string, dml: string): string {
  const papel = usuario === "anon" || usuario === "service_role" ? usuario : "authenticated";
  const claims =
    papel === "authenticated"
      ? `select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);`
      : "";
  return lastLine(
    sql(`
      set role ${papel};
      ${claims}
      do $$
      declare n int;
      begin
        begin
          ${dml};
          get diagnostics n = row_count;
          perform set_config('inv.r9040', 'n:' || n, false);
        exception when others then
          perform set_config('inv.r9040', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9040');
    `),
  );
}

/** O jsonb de uma função do motor, como `postgres` (a plataforma) ou como `usuario`. */
function json(chamada: string, usuario?: string): Record<string, unknown> {
  const prefixo = usuario
    ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);`
    : "";
  return JSON.parse(lastLine(sql(`${prefixo} select (${chamada})::text;`))) as Record<string, unknown>;
}

type Grupo = { chave: string; n: number; rotulo: string | null; valores: Record<string, number | null>; meta_cents?: number | null };
const grupos = (r: Record<string, unknown>) => r.grupos as Grupo[];
const nDe = (r: Record<string, unknown>, chave: string) => grupos(r).find((g) => g.chave === chave)?.n;

const A = `'${ORG_A}'::uuid`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'montador-admin-a@invariant.test'),
      ('${GESTOR_A}', 'montador-gestor-a@invariant.test'),
      ('${AT1}', 'montador-at1@invariant.test'),
      ('${AT2}', 'montador-at2@invariant.test'),
      ('${GESTOR_B}', 'montador-gestor-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, timezone, currency) values
      ('${ORG_A}', 'montador-9040-a', 'Montador A', 'Montador A', 'America/Sao_Paulo', 'BRL'),
      ('${ORG_B}', 'montador-9040-b', 'Montador B', 'Montador B', 'America/Sao_Paulo', 'BRL')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${AT1}', '${ORG_A}', 'agent', now()),
      ('${AT2}', '${ORG_A}', 'agent', now()),
      ('${GESTOR_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    -- Os relatórios e os painéis, gravados pela plataforma (dono resolvido no servidor).
    insert into public.mia_relatorios (id, organization_id, nome, fonte, medida, dim1, compartilhado, created_by) values
      ('${R_GESTOR_PRIV}', '${ORG_A}', 'Do gestor, só dele', 'negocios', 'qtd', 'origem', false, '${GESTOR_A}'),
      ('${R_GESTOR_COMP}', '${ORG_A}', 'Do gestor, da equipe', 'negocios', 'soma', 'mes', true, '${GESTOR_A}'),
      ('${R_AT1_PRIV}', '${ORG_A}', 'Do atendente, só dele', 'conversas', 'qtd', 'quem', false, '${AT1}'),
      ('${R_DE_B}', '${ORG_B}', 'Da outra empresa', 'negocios', 'qtd', null, true, '${GESTOR_B}');
    insert into public.mia_paineis_usuario (id, organization_id, nome, compartilhado, created_by) values
      ('${P_GESTOR_COMP}', '${ORG_A}', 'Painel da equipe', true, '${GESTOR_A}'),
      ('${P_AT1}', '${ORG_A}', 'Painel do atendente', false, '${AT1}'),
      ('${P_PARA_LINK}', '${ORG_A}', 'Painel do dono', true, '${GESTOR_A}');
    insert into public.mia_paineis_usuario_itens (id, organization_id, painel_id, relatorio_id, pronto, tamanho, posicao) values
      ('${I_COMP}', '${ORG_A}', '${P_GESTOR_COMP}', '${R_GESTOR_COMP}', null, 'G', 1),
      ('${I_AT1}', '${ORG_A}', '${P_AT1}', '${R_AT1_PRIV}', null, 'M', 1);
  `);

  // O CRM de A: um funil, cinco negócios, dois produtos em propostas, conversas e régua.
  sql(`
    update public.crm_pipelines set is_default = false where organization_id = '${ORG_A}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values
      ('${FUNIL}', '${ORG_A}', 'Vendas', 'vendas-9040', true);
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost) values
      ('${E1}', '${ORG_A}', '${FUNIL}', 'Entrada', 'entrada-9040', 1000, false, false),
      ('${E2}', '${ORG_A}', '${FUNIL}', 'Proposta', 'proposta-9040', 2000, false, false),
      ('${EW}', '${ORG_A}', '${FUNIL}', 'Fechou', 'fechou-9040', 3000, true, false),
      ('${EL}', '${ORG_A}', '${FUNIL}', 'Perdeu', 'perdeu-9040', 4000, false, true);
    insert into public.contacts (id, organization_id, display_name, phone_number, carteira_user_id, created_at) values
      ('${C(1)}', '${ORG_A}', 'Contato Um', '+5531900000001', '${AT1}', '2026-10-02 10:00-03'),
      ('${C(2)}', '${ORG_A}', 'Contato Dois', '+5531900000002', '${AT2}', '2026-10-02 10:00-03'),
      ('${C(3)}', '${ORG_A}', 'Contato Três', null, null, '2026-10-02 10:00-03');
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status, value_cents, currency,
      owner_user_id, source, created_at, closed_at, lost_reason, lost_from_stage_id) values
      ('${L(1)}', '${ORG_A}', '${FUNIL}', '${E1}', '${C(1)}', 'N1', 'open', 1000, 'BRL', '${AT1}', 'meta_ads', '2026-10-05 10:00-03', null, null, null),
      ('${L(2)}', '${ORG_A}', '${FUNIL}', '${E2}', '${C(2)}', 'N2', 'open', 2000, 'BRL', '${AT2}', 'google_ads', '2026-10-06 10:00-03', null, null, null),
      ('${L(3)}', '${ORG_A}', '${FUNIL}', '${EW}', '${C(3)}', 'N3', 'won', 5000, 'BRL', '${GESTOR_A}', 'meta_ads', '2026-09-20 10:00-03', '2026-10-07 10:00-03', null, null),
      ('${L(4)}', '${ORG_A}', '${FUNIL}', '${EW}', '${C(1)}', 'N4', 'won', 3000, 'BRL', '${AT1}', '', '2026-10-01 10:00-03', '2026-10-09 10:00-03', null, null),
      ('${L(5)}', '${ORG_A}', '${FUNIL}', '${EL}', '${C(2)}', 'N5', 'lost', 700, 'BRL', null, 'indicacao', '2026-10-01 10:00-03', '2026-10-08 10:00-03', 'price', '${E2}');
    insert into public.sales_targets (organization_id, periodo, metrica, alvo_cents) values
      ('${ORG_A}', '2026-10-01', 'receita_total', 310000);

    insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents) values
      ('e9040e90-9999-4000-8000-000000000001', '${ORG_A}', 'IMPL', 'Implante', 450000),
      ('e9040e90-9999-4000-8000-000000000002', '${ORG_A}', 'CLAR', 'Clareamento', 120000);
    insert into public.crm_proposals (id, organization_id, lead_id, contact_id, status, titulo) values
      ('e9040e90-9999-4000-8000-0000000000a1', '${ORG_A}', '${L(1)}', '${C(1)}', 'enviada', 'P1'),
      ('e9040e90-9999-4000-8000-0000000000a2', '${ORG_A}', '${L(3)}', '${C(3)}', 'aceita', 'P2'),
      ('e9040e90-9999-4000-8000-0000000000a3', '${ORG_A}', '${L(2)}', '${C(2)}', 'cancelada', 'P3');
    insert into public.crm_proposal_items (organization_id, proposal_id, product_id, descricao, preco_unitario_cents, position) values
      ('${ORG_A}', 'e9040e90-9999-4000-8000-0000000000a1', 'e9040e90-9999-4000-8000-000000000001', 'Implante', 450000, 1),
      ('${ORG_A}', 'e9040e90-9999-4000-8000-0000000000a1', 'e9040e90-9999-4000-8000-000000000002', 'Clareamento', 120000, 2),
      ('${ORG_A}', 'e9040e90-9999-4000-8000-0000000000a2', 'e9040e90-9999-4000-8000-000000000001', 'Implante', 450000, 1),
      ('${ORG_A}', 'e9040e90-9999-4000-8000-0000000000a3', 'e9040e90-9999-4000-8000-000000000002', 'Clareamento', 120000, 1);

    insert into public.ai_agents (id, organization_id, name, system_prompt) values
      ('${AGENTE}', '${ORG_A}', 'Íris', 'teste');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}', '${ORG_A}', 'montador-9040-a', '\\x00'::bytea);
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, active_ai_agent_id, created_at, last_inbound_at) values
      ('${CV1}', '${ORG_A}', '${C(1)}', '${SESSAO}', 'open', '${AGENTE}', '2026-10-03 10:00-03', '2026-10-03 10:00-03'),
      ('${CV2}', '${ORG_A}', '${C(2)}', '${SESSAO}', 'open', null, '2026-10-04 10:00-03', '2026-10-04 10:00-03');
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, sent_via, sent_by_user_id, sent_at, external_id) values
      ('${ORG_A}', '${CV1}', '${SESSAO}', '${C(1)}', 'text', 'inbound', 'oi', 'crm', null, '2026-10-03 10:00:00-03', 'montador-9040-m1'),
      ('${ORG_A}', '${CV1}', '${SESSAO}', '${C(1)}', 'text', 'outbound', 'ola', 'ai', null, '2026-10-03 10:00:20-03', 'montador-9040-m2'),
      ('${ORG_A}', '${CV2}', '${SESSAO}', '${C(2)}', 'text', 'inbound', 'oi', 'crm', null, '2026-10-04 10:00:00-03', 'montador-9040-m3'),
      ('${ORG_A}', '${CV2}', '${SESSAO}', '${C(2)}', 'text', 'outbound', 'ola', 'crm', '${AT1}', '2026-10-04 10:05:00-03', 'montador-9040-m4');

    insert into public.followup_flow_versions (id, organization_id, graph) values
      ('e9040e90-aaaa-4000-8000-000000000001', '${ORG_A}', '{}');
    insert into public.followup_flow_pointers (id, organization_id, name, status, active_version_id) values
      ('e9040e90-aaaa-4000-8000-000000000002', '${ORG_A}', 'Sem resposta', 'active', 'e9040e90-aaaa-4000-8000-000000000001');
    insert into public.followup_enrollments (id, organization_id, pointer_id, version_id, contact_id, current_node_id, status, outcome, started_at) values
      ('e9040e90-aaaa-4000-8000-000000000003', '${ORG_A}', 'e9040e90-aaaa-4000-8000-000000000002', 'e9040e90-aaaa-4000-8000-000000000001', '${C(1)}', 'fim', 'completed', 'replied', '2026-10-05 10:00-03');
    insert into public.followup_enrollment_events (organization_id, enrollment_id, event_type) values
      ('${ORG_A}', 'e9040e90-aaaa-4000-8000-000000000003', 'action_sent');
  `);
});

describe("o relatório salvo: quem vê", () => {
  it("⭐ o atendente vê o compartilhado e não vê o 'só para mim' de ninguém (controle positivo e negativo)", () => {
    expect(countAs(AT2, `select count(*) from public.mia_relatorios where id = '${R_GESTOR_COMP}';`)).toBe(1);
    expect(countAs(AT2, `select count(*) from public.mia_relatorios where id in ('${R_GESTOR_PRIV}', '${R_AT1_PRIV}');`)).toBe(0);
    expect(countAs(AT1, `select count(*) from public.mia_relatorios where id = '${R_AT1_PRIV}';`)).toBe(1);
  });

  it("⭐ o 'só para mim' é só da pessoa: nem o administrador o vê", () => {
    expect(countAs(ADMIN_A, `select count(*) from public.mia_relatorios where id = '${R_AT1_PRIV}';`)).toBe(0);
    expect(countAs(ADMIN_A, `select count(*) from public.mia_relatorios where id = '${R_GESTOR_COMP}';`)).toBe(1);
  });

  it("outra empresa não vê nada de A, e vê o dela", () => {
    expect(countAs(GESTOR_B, `select count(*) from public.mia_relatorios where organization_id = '${ORG_A}';`)).toBe(0);
    expect(countAs(GESTOR_B, `select count(*) from public.mia_relatorios where id = '${R_DE_B}';`)).toBe(1);
  });

  it("anon não lê a tabela (permission denied, não zero linhas)", () => {
    expect(executar("anon", `perform 1 from public.mia_relatorios limit 1`)).toBe("42501");
  });
});

describe("o relatório salvo: quem faz", () => {
  it("⭐ todo membro cria o próprio, e o dono é quem cria (mesmo que o pedido diga outro)", () => {
    const id = "e9040e90-2222-4000-8000-0000000000d1";
    expect(
      executar(AT2, `insert into public.mia_relatorios (id, organization_id, nome, fonte, medida, created_by)
                     values ('${id}', '${ORG_A}', 'Meu', 'contatos', 'qtd', '${GESTOR_A}')`),
    ).toBe("n:1");
    expect(lastLine(sql(`select created_by from public.mia_relatorios where id = '${id}';`))).toBe(AT2);
  });

  it("⭐ só gestor e administrador compartilham: o atendente é recusado (42501) ao criar e ao passar", () => {
    expect(
      executar(AT1, `insert into public.mia_relatorios (organization_id, nome, fonte, medida, compartilhado)
                     values ('${ORG_A}', 'Quero mostrar', 'negocios', 'qtd', true)`),
    ).toBe("42501");
    expect(executar(AT1, `update public.mia_relatorios set compartilhado = true where id = '${R_AT1_PRIV}'`)).toBe("42501");
    // Controle positivo: o atendente edita o próprio; o gestor compartilha.
    expect(executar(AT1, `update public.mia_relatorios set nome = 'Do atendente, renomeado' where id = '${R_AT1_PRIV}'`)).toBe("n:1");
    expect(
      executar(GESTOR_A, `insert into public.mia_relatorios (organization_id, nome, fonte, medida, compartilhado)
                          values ('${ORG_A}', 'Para a equipe', 'negocios', 'qtd', true)`),
    ).toBe("n:1");
  });

  it("⭐ o compartilhado: quem criou e o administrador editam; o atendente não (zero linhas)", () => {
    expect(executar(AT2, `update public.mia_relatorios set nome = 'mexi' where id = '${R_GESTOR_COMP}'`)).toBe("n:0");
    expect(executar(AT2, `delete from public.mia_relatorios where id = '${R_GESTOR_COMP}'`)).toBe("n:0");
    expect(executar(ADMIN_A, `update public.mia_relatorios set nome = 'Ajuste do admin' where id = '${R_GESTOR_COMP}'`)).toBe("n:1");
    expect(executar(GESTOR_A, `update public.mia_relatorios set nome = 'Do gestor, da equipe' where id = '${R_GESTOR_COMP}'`)).toBe("n:1");
  });

  it("o atendente copia o compartilhado (a cópia é dele, e aponta para o original)", () => {
    const id = "e9040e90-2222-4000-8000-0000000000d2";
    expect(
      executar(AT2, `insert into public.mia_relatorios (id, organization_id, nome, fonte, medida, dim1, copiado_de)
                     values ('${id}', '${ORG_A}', 'Cópia de Do gestor', 'negocios', 'soma', 'mes', '${R_GESTOR_COMP}')`),
    ).toBe("n:1");
    expect(countAs(AT2, `select count(*) from public.mia_relatorios where id = '${id}' and copiado_de = '${R_GESTOR_COMP}';`)).toBe(1);
  });

  it("dono e empresa não mudam depois de criados", () => {
    expect(executar(GESTOR_A, `update public.mia_relatorios set created_by = '${AT1}' where id = '${R_GESTOR_PRIV}'`)).toBe("42501");
  });

  it("⭐ configuração fora do catálogo do motor não entra (23514)", () => {
    const base = `insert into public.mia_relatorios (organization_id, nome, fonte, medida, dim1, dim2, filtros)`;
    expect(executar(GESTOR_A, `${base} values ('${ORG_A}', 'x', 'negocios', 'nao_existe', null, null, '{}')`)).toBe("23514");
    expect(executar(GESTOR_A, `${base} values ('${ORG_A}', 'x', 'negocios', 'qtd', 'origem', 'origem', '{}')`)).toBe("23514");
    expect(executar(GESTOR_A, `${base} values ('${ORG_A}', 'x', 'conversas', 'qtd', null, null, '{"produto":"a"}')`)).toBe("23514");
    expect(executar(GESTOR_A, `${base} values ('${ORG_A}', 'x', 'negocios', 'chegaram', 'etapa', null, '{}')`)).toBe("23514");
    // Controle: a 9041 pôs o produto no catálogo dos negócios.
    expect(executar(GESTOR_A, `${base} values ('${ORG_A}', 'Por produto', 'negocios', 'qtd', 'produto', null, '{"produto":["Implante"]}')`)).toBe("n:1");
  });
});

describe("o painel e os itens", () => {
  it("⭐ o atendente vê o painel compartilhado e o item dele; não vê o painel 'só para mim' de outro", () => {
    expect(countAs(AT2, `select count(*) from public.mia_paineis_usuario_itens where id = '${I_COMP}';`)).toBe(1);
    expect(countAs(AT2, `select count(*) from public.mia_paineis_usuario where id = '${P_AT1}';`)).toBe(0);
    expect(countAs(AT2, `select count(*) from public.mia_paineis_usuario_itens where id = '${I_AT1}';`)).toBe(0);
  });

  it("⭐ quem não edita o painel não põe item nele (42501); quem criou põe", () => {
    expect(
      executar(AT2, `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, pronto, posicao)
                     values ('${ORG_A}', '${P_GESTOR_COMP}', 'funil', 2)`),
    ).toBe("42501");
    expect(
      executar(GESTOR_A, `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, pronto, posicao)
                          values ('${ORG_A}', '${P_GESTOR_COMP}', 'funil', 2)`),
    ).toBe("n:1");
    expect(executar(AT2, `update public.mia_paineis_usuario_itens set tamanho = 'P' where id = '${I_COMP}'`)).toBe("n:0");
  });

  it("⭐ só entra no painel o relatório que a pessoa enxerga", () => {
    expect(
      executar(AT1, `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, relatorio_id, posicao)
                     values ('${ORG_A}', '${P_AT1}', '${R_GESTOR_PRIV}', 2)`),
    ).toBe("42501");
    expect(
      executar(AT1, `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, relatorio_id, posicao)
                     values ('${ORG_A}', '${P_AT1}', '${R_GESTOR_COMP}', 2)`),
    ).toBe("n:1");
  });

  it("o item nunca cruza empresa (chave composta), e o mesmo relatório não entra duas vezes", () => {
    expect(
      executar("service_role", `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, relatorio_id, posicao)
                                values ('${ORG_A}', '${P_GESTOR_COMP}', '${R_DE_B}', 9)`),
    ).toBe("23503");
    expect(
      executar("service_role", `insert into public.mia_paineis_usuario_itens (organization_id, painel_id, relatorio_id, posicao)
                                values ('${ORG_A}', '${P_GESTOR_COMP}', '${R_GESTOR_COMP}', 9)`),
    ).toBe("23505");
  });

  it("apagar o relatório tira-o dos painéis", () => {
    const r = "e9040e90-2222-4000-8000-0000000000d3";
    sql(`
      insert into public.mia_relatorios (id, organization_id, nome, fonte, medida, created_by)
        values ('${r}', '${ORG_A}', 'Vai sumir', 'contatos', 'qtd', '${GESTOR_A}');
      insert into public.mia_paineis_usuario_itens (organization_id, painel_id, relatorio_id, posicao)
        values ('${ORG_A}', '${P_GESTOR_COMP}', '${r}', 5);
    `);
    expect(executar(GESTOR_A, `delete from public.mia_relatorios where id = '${r}'`)).toBe("n:1");
    expect(lastLine(sql(`select count(*) from public.mia_paineis_usuario_itens where relatorio_id = '${r}';`))).toBe("0");
  });

  it("o painel segue a mesma regra do relatório: o atendente não compartilha", () => {
    expect(
      executar(AT1, `insert into public.mia_paineis_usuario (organization_id, nome, compartilhado) values ('${ORG_A}', 'Meu painel', true)`),
    ).toBe("42501");
    expect(executar(AT1, `insert into public.mia_paineis_usuario (organization_id, nome) values ('${ORG_A}', 'Meu painel')`)).toBe("n:1");
  });
});

describe("o registro das exportações", () => {
  const exportar = (quem: string) =>
    `insert into public.mia_relatorios_exportacoes (organization_id, user_id, tipo, relatorio_nome, fonte, linhas, separador)
     values ('${ORG_A}', '${quem}', 'lista', 'Por que perdemos', 'negocios', 38, ';')`;

  it("⭐ o atendente não grava nem lê; o gestor grava a SUA e lê", () => {
    expect(executar(AT1, exportar(AT1))).toBe("42501");
    expect(executar(GESTOR_A, exportar(GESTOR_A))).toBe("n:1");
    expect(executar(GESTOR_A, exportar(ADMIN_A))).toBe("42501");
    expect(countAs(GESTOR_A, `select count(*) from public.mia_relatorios_exportacoes where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(AT1, `select count(*) from public.mia_relatorios_exportacoes;`)).toBe(0);
    expect(countAs(GESTOR_B, `select count(*) from public.mia_relatorios_exportacoes where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("⭐ ninguém altera nem apaga uma exportação (permission denied)", () => {
    expect(executar(GESTOR_A, `update public.mia_relatorios_exportacoes set linhas = 0`)).toBe("42501");
    expect(executar(ADMIN_A, `delete from public.mia_relatorios_exportacoes`)).toBe("42501");
  });
});

describe("o funil dos prontos", () => {
  it("só gestor escolhe; todo membro lê", () => {
    expect(
      executar(AT1, `insert into public.mia_relatorios_da_empresa (organization_id, pipeline_id) values ('${ORG_A}', '${FUNIL}')`),
    ).toBe("42501");
    expect(
      executar(GESTOR_A, `insert into public.mia_relatorios_da_empresa (organization_id, pipeline_id) values ('${ORG_A}', '${FUNIL}')`),
    ).toBe("n:1");
    expect(countAs(AT1, `select count(*) from public.mia_relatorios_da_empresa where organization_id = '${ORG_A}';`)).toBe(1);
  });
});

describe("o motor do montador (9041)", () => {
  const motor = (args: string, usuario?: string) => json(`public.fn_mia_relatorio(${args})`, usuario);

  it("⭐ o produto do negócio: o das propostas, sem as canceladas; dois produtos contam em cada um", () => {
    const r = motor(`${A}, 'negocios', array['qtd'], 'produto', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(nDe(r, "Implante")).toBe(2);
    expect(nDe(r, "Clareamento")).toBe(1);
    // N2 (só a proposta cancelada), N4 e N5 não têm produto.
    expect(nDe(r, "__sem")).toBe(3);
    expect((r.total as { n: number }).n).toBe(5);
  });

  it("⭐ filtro com vários valores: qualquer um passa, e '__sem' vale dentro da lista", () => {
    const umOuOutro = motor(`${A}, 'negocios', array['qtd'], null, null, '{"origem":["meta_ads","google_ads"]}', 'mes', null, null, true, false, '${AGORA}'`);
    expect((umOuOutro.total as { n: number }).n).toBe(3);
    const comSem = motor(`${A}, 'negocios', array['qtd'], null, null, '{"origem":["meta_ads","__sem"]}', 'mes', null, null, true, false, '${AGORA}'`);
    expect((comSem.total as { n: number }).n).toBe(3);
    const deUm = motor(`${A}, 'negocios', array['qtd'], null, null, '{"origem":["indicacao"]}', 'mes', null, null, true, false, '${AGORA}'`);
    expect((deUm.filtros as Record<string, unknown>).origem).toBe("indicacao");
  });

  it("funil e só-receita são de um valor só (22023)", () => {
    expect(
      executar("service_role", `perform public.fn_mia_relatorio(${A}, 'negocios', array['qtd'], null, null, '{"funil":["${FUNIL}"]}', 'mes')`),
    ).toBe("22023");
  });

  it("⭐ a meta em cada grupo de tempo: o mês inteiro no mês, a semana proporcional", () => {
    const porMes = motor(`${A}, 'negocios', array['soma'], 'mes', null, '{"situacao":"ganho"}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(grupos(porMes).find((g) => g.chave === "2026-10")?.meta_cents).toBe(310000);
    const porSemana = motor(`${A}, 'negocios', array['soma'], 'semana', null, '{"situacao":"ganho"}', 'mes', null, null, true, false, '${AGORA}'`);
    // A semana de 28/09 tem 4 dias de outubro (sem meta em setembro): 4 × 10.000.
    expect(grupos(porSemana).find((g) => g.chave === "2026-09-28")?.meta_cents).toBe(40000);
    expect(grupos(porSemana).find((g) => g.chave === "2026-10-05")?.meta_cents).toBe(70000);
    const semValores = motor(`${A}, 'negocios', array['soma'], 'mes', null, '{"situacao":"ganho"}', 'mes', null, null, false, false, '${AGORA}'`);
    expect(grupos(semValores).find((g) => g.chave === "2026-10")?.meta_cents).toBeNull();
  });

  it("⭐ o funil com a soma de quem chegou", () => {
    const r = motor(`${A}, 'negocios', array['chegaram','soma'], 'etapa', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(grupos(r).map((g) => [g.rotulo, g.n, g.valores.soma])).toEqual([
      ["Entrada", 5, 11700],
      ["Proposta", 4, 10700],
      ["Fechou", 2, 8000],
    ]);
  });

  it("follow-up: o responsável é o dono do contato", () => {
    const r = motor(`${A}, 'followup', array['qtd'], 'resp', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(nDe(r, AT1)).toBe(1);
  });

  it("⭐ conversas: quem atendeu é a pessoa que respondeu, ou o agente pelo nome", () => {
    const r = motor(`${A}, 'conversas', array['qtd'], 'resp', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    const agente = grupos(r).find((g) => g.chave === `ia:${AGENTE}`);
    expect(agente?.n).toBe(1);
    expect(agente?.rotulo).toBe("Íris");
    expect(nDe(r, AT1)).toBe(1);
  });
});

describe("a lista por trás do número", () => {
  type Lista = { n: number; total: { n: number; valores: Record<string, number | null> }; linhas: Array<{ registro: string; valor_cents: number | null; detalhe: Record<string, string | null> }> };
  const lista = (args: string, usuario?: string) =>
    json(`public.fn_mia_relatorio_lista(${args})`, usuario) as unknown as Lista;
  const pedido = (extra: string) =>
    `${A}, 'negocios', array['qtd','soma'], 'origem', null, '{}', 'mes', null, null, ${extra}`;

  it("⭐ o mesmo número do grupo, com quem é cada um e onde abrir no CRM", () => {
    const grafico = json(`public.fn_mia_relatorio(${A}, 'negocios', array['qtd','soma'], 'origem', null, '{}', 'mes', null, null, true, false, '${AGORA}')`);
    const l = lista(pedido(`'meta_ads', null, null, null, false, 50, 0, true, '${AGORA}'`));
    expect(l.n).toBe(nDe(grafico, "meta_ads"));
    expect(l.total.valores.soma).toBe(grupos(grafico).find((g) => g.chave === "meta_ads")?.valores.soma);
    const n1 = l.linhas.find((x) => x.registro === L(1))!;
    expect(n1.detalhe.contato).toBe("Contato Um");
    expect(n1.detalhe.link).toBe(`/app/leads/${L(1)}`);
  });

  it("'Outros' pelos dobrados, a célula e a etapa do funil", () => {
    expect(lista(pedido(`'__outros', null, array['google_ads','indicacao'], null, false, 50, 0, true, '${AGORA}'`)).n).toBe(2);
    const celula = lista(
      `${A}, 'negocios', array['qtd'], 'origem', 'situacao', '{}', 'mes', null, null, 'meta_ads', 'ganho', null, null, false, 50, 0, true, '${AGORA}'`,
    );
    expect(celula.linhas.map((x) => x.registro)).toEqual([L(3)]);
    const etapa = lista(
      `${A}, 'negocios', array['chegaram','soma'], 'etapa', null, '{}', 'mes', null, null, '${E2}', null, null, null, true, 50, 0, true, '${AGORA}'`,
    );
    expect(etapa.n).toBe(4);
    expect(etapa.total.valores.soma).toBe(10700);
  });

  it("⭐ a RLS de quem pergunta: o atendente vê os dele e os sem dono; outra empresa é recusada", () => {
    const tudo = `${A}, 'negocios', array['qtd'], null, null, '{}', 'mes', null, null, null, null, null, null, false, 50, 0, true, '${AGORA}'`;
    expect(lista(tudo).n).toBe(5);
    expect(lista(tudo, AT1).n).toBeLessThan(5);
    expect(executar(GESTOR_B, `perform public.fn_mia_relatorio_lista(${tudo})`)).toBe("42501");
    expect(executar("anon", `perform public.fn_mia_relatorio_lista(${tudo})`)).toBe("42501");
  });

  it("sem valores, o valor some de cada linha; e o limite é de 1 a 20.000", () => {
    const semValor = lista(pedido(`'meta_ads', null, null, null, false, 50, 0, false, '${AGORA}'`));
    expect(semValor.linhas.every((x) => x.valor_cents === null)).toBe(true);
    expect(executar("service_role", `perform public.fn_mia_relatorio_lista(${pedido(`null, null, null, null, false, 20001, 0, true, null`)})`)).toBe("22023");
  });
});

describe("o link do dono para o painel do usuário (9042)", () => {
  const link = (id: string, painel: string | null, paineis: string) =>
    `insert into public.mia_paineis_links (id, organization_id, para_quem, paineis, painel_id, token_hash)
     values ('${id}', '${ORG_A}', 'Dono', '${paineis}', ${painel ? `'${painel}'` : "null"}, repeat('${id.slice(-1)}', 64))`;

  it("⭐ ou os prontos, ou o painel do usuário com a lista vazia", () => {
    expect(executar("service_role", link("e9040e90-bbbb-4000-8000-00000000000a", P_PARA_LINK, "{}"))).toBe("n:1");
    expect(executar("service_role", link("e9040e90-bbbb-4000-8000-00000000000b", P_PARA_LINK, "{resultado}"))).toBe("23514");
    expect(executar("service_role", link("e9040e90-bbbb-4000-8000-00000000000c", null, "{}"))).toBe("23514");
    expect(executar("service_role", link("e9040e90-bbbb-4000-8000-00000000000d", null, "{resultado}"))).toBe("n:1");
  });

  it("a regra mantém o nome da 9031 (o baseline não a recria por cima)", () => {
    expect(
      lastLine(sql(`select pg_get_constraintdef(oid) like '%painel_id%' from pg_constraint where conname = 'mia_paineis_links_paineis';`)),
    ).toBe("t");
  });

  it("apagar o painel apaga o link dele", () => {
    sql(`delete from public.mia_paineis_usuario where id = '${P_PARA_LINK}';`);
    expect(lastLine(sql(`select count(*) from public.mia_paineis_links where painel_id = '${P_PARA_LINK}';`))).toBe("0");
  });
});

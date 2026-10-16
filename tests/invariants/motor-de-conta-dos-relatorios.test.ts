/**
 * 9030 · O MOTOR DE CONTA DOS RELATÓRIOS (`fn_mia_relatorio`) no Postgres de
 * verdade.
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. O CATÁLOGO do banco é o mesmo de `lib/paineis/catalogo.ts`: a tela e o MCP
 *    só oferecem o que o banco aceita.
 * 2. A REGRA DE DATA do protótipo, no FUSO da empresa: ganho e perdido pela data
 *    em que fecharam, aberto pela de entrada; o negócio criado às 23h30 de 30/09
 *    em São Paulo é de setembro, e o de 00h30 de 01/10 é de outubro. A troca de
 *    funil (motivo `moved_to_another_pipeline`) não é perda.
 * 3. SEM O TETO DE 1000 LINHAS: 1.205 negócios somam 1.205.
 * 4. ETIQUETAS: o negócio com duas conta em cada uma, e o total conta uma vez.
 * 5. "SEM …" sempre presente e nunca em "Outros"; mais de 12 grupos dobram em
 *    "Outros", recalculado sobre as linhas.
 * 6. O FUNIL "chegaram": o perdido chegou até a etapa de onde saiu.
 * 7. A META: o alvo do mês, a fração e o quanto do mês correu; sem valores, o
 *    alvo e a soma somem e a fração fica.
 * 8. QUEM VÊ O QUÊ, pela RLS (o motor é `security invoker`): o atendente vê os
 *    negócios e as conversas que já vê no CRM; o gestor, a empresa; quem é de
 *    outra empresa é recusado (42501); `anon` não executa; a plataforma
 *    (`service_role`) vê a empresa pedida e só ela. Anúncios, só gestor.
 * 9. CONVERSAS: quem atendeu (agente, equipe, sem resposta) e o tempo até a
 *    primeira resposta.
 * 10. A SITUAÇÃO DA OBRIGAÇÃO no banco é a mesma de `lib/obrigacoes/situacao.ts`
 *     numa matriz de casos.
 * 11. O PERÍODO ANTERIOR e a agenda de "Este mês" até o fim do mês.
 *
 * Organizações próprias (namespace `e9030e90-`). Nenhum dado de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { situacao } from "@/lib/obrigacoes/situacao";
import type { ItemParaSituacao } from "@/lib/obrigacoes/tipos";
import { CATALOGO_DO_MOTOR, FONTES } from "@/lib/paineis/catalogo";

import { lastLine, sql } from "./gov-helpers";

const ORG_A = "e9030e90-0000-4000-8000-00000000000a";
const ORG_B = "e9030e90-0000-4000-8000-00000000000b";
const ORG_C = "e9030e90-0000-4000-8000-00000000000c";
const GESTOR_A = "e9030e90-1111-4000-8000-00000000000a";
const ATENDENTE_A = "e9030e90-1111-4000-8000-0000000000a2";
const GESTOR_B = "e9030e90-1111-4000-8000-00000000000b";
const FUNIL_A = "e9030e90-2222-4000-8000-00000000000a";
const FUNIL_B = "e9030e90-2222-4000-8000-00000000000b";
const FUNIL_C = "e9030e90-2222-4000-8000-00000000000c";
const E1 = "e9030e90-3333-4000-8000-000000000001";
const E2 = "e9030e90-3333-4000-8000-000000000002";
const E3 = "e9030e90-3333-4000-8000-000000000003";
const E4 = "e9030e90-3333-4000-8000-000000000004";
const E5 = "e9030e90-3333-4000-8000-000000000005";
const EB = "e9030e90-3333-4000-8000-0000000000b1";
const EC = "e9030e90-3333-4000-8000-0000000000c1";
const SESSAO_A = "e9030e90-4444-4000-8000-00000000000a";
const AGORA = "2026-10-15 12:00:00-03";

/** O jsonb do motor, como texto, chamado como `postgres` (a plataforma). */
function motor(args: string): Record<string, unknown> {
  return JSON.parse(lastLine(sql(`select public.fn_mia_relatorio(${args})::text;`))) as Record<string, unknown>;
}

/** O mesmo, como `authenticated` com o JWT de `usuario`. */
function motorComo(usuario: string, args: string): Record<string, unknown> {
  return JSON.parse(
    lastLine(
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
        select public.fn_mia_relatorio(${args})::text;
      `),
    ),
  ) as Record<string, unknown>;
}

/** O SQLSTATE da recusa, ou `passou`. `papel` é `authenticated:<uuid>`, `anon` ou `service_role`. */
function tentar(papel: string, chamada: string): string {
  const [role, usuario] = papel.split(":");
  return lastLine(
    sql(`
      set role ${role};
      ${usuario ? `select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);` : ""}
      do $$
      begin
        begin
          perform ${chamada};
          perform set_config('inv.r9030', 'passou', false);
        exception when others then
          perform set_config('inv.r9030', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9030');
    `),
  );
}

type Grupo = { chave: string; n: number; n_ok: number; sem: boolean; outros: boolean; rotulo: string | null; valores: Record<string, number | null> };

function grupos(r: Record<string, unknown>): Grupo[] {
  return r.grupos as Grupo[];
}
function n(r: Record<string, unknown>, chave: string): number | undefined {
  return grupos(r).find((g) => g.chave === chave)?.n;
}
function total(r: Record<string, unknown>): { n: number; valores: Record<string, number | null> } {
  return r.total as { n: number; valores: Record<string, number | null> };
}

const NEGOCIO = (
  id: string,
  org: string,
  funil: string,
  etapa: string,
  status: string,
  valor: number | null,
  dono: string | null,
  origem: string,
  tags: string,
  criado: string,
  fechado: string | null,
  motivo: string | null = null,
  saiuDe: string | null = null,
  moeda = "BRL",
  previsto: string | null = null,
) =>
  `('${id}','${org}','${funil}','${etapa}','${id.slice(-4)}','${status}',${valor ?? "null"},'${moeda}',${dono ? `'${dono}'` : "null"},'${origem}','${tags}','${criado}',${fechado ? `'${fechado}'` : "null"},${motivo ? `'${motivo}'` : "null"},${saiuDe ? `'${saiuDe}'` : "null"},${previsto ? `'${previsto}'` : "null"})`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${GESTOR_A}', 'motor-gestor-a@invariant.test'),
      ('${ATENDENTE_A}', 'motor-atendente-a@invariant.test'),
      ('${GESTOR_B}', 'motor-gestor-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, timezone, currency) values
      ('${ORG_A}', 'motor-9030-a', 'Motor A', 'Motor A', 'America/Sao_Paulo', 'BRL'),
      ('${ORG_B}', 'motor-9030-b', 'Motor B', 'Motor B', 'America/Sao_Paulo', 'BRL'),
      ('${ORG_C}', 'motor-9030-c', 'Motor C', 'Motor C', 'America/Sao_Paulo', 'BRL')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${ATENDENTE_A}', '${ORG_A}', 'agent', now()),
      ('${GESTOR_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    update public.crm_pipelines set is_default = false where organization_id in ('${ORG_A}','${ORG_B}','${ORG_C}');
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default, vocabulary) values
      ('${FUNIL_A}', '${ORG_A}', 'Pacientes', 'pacientes-9030', true, '{"compromisso_plural":"Avaliações"}'),
      ('${FUNIL_B}', '${ORG_B}', 'Vendas', 'vendas-9030', true, '{}'),
      ('${FUNIL_C}', '${ORG_C}', 'Volume', 'volume-9030', true, '{}');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost, win_probability) values
      ('${E1}', '${ORG_A}', '${FUNIL_A}', 'Novo contato', 'novo-9030', 1000, false, false, 10),
      ('${E2}', '${ORG_A}', '${FUNIL_A}', 'Avaliação marcada', 'avaliacao-9030', 2000, false, false, 40),
      ('${E3}', '${ORG_A}', '${FUNIL_A}', 'Orçamento', 'orcamento-9030', 3000, false, false, null),
      ('${E4}', '${ORG_A}', '${FUNIL_A}', 'Fechou', 'fechou-9030', 4000, true, false, null),
      ('${E5}', '${ORG_A}', '${FUNIL_A}', 'Não fechou', 'perdeu-9030', 5000, false, true, null),
      ('${EB}', '${ORG_B}', '${FUNIL_B}', 'Entrada', 'entrada-9030', 1000, false, false, 10),
      ('${EC}', '${ORG_C}', '${FUNIL_C}', 'Entrada', 'entrada-9030-c', 1000, false, false, 10);

    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, value_cents, currency,
      owner_user_id, source, tags, created_at, closed_at, lost_reason, lost_from_stage_id, expected_close_date) values
      ${[
        NEGOCIO("e9030e90-5555-4000-8000-000000000001", ORG_A, FUNIL_A, E1, "open", 100000, ATENDENTE_A, "meta_ads", "{Implante,Urgente}", "2026-10-10 12:00-03", null, null, null, "BRL", "2026-11-05"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000002", ORG_A, FUNIL_A, E2, "open", 200000, ATENDENTE_A, "google_ads", "{Implante}", "2026-10-11 12:00-03", null),
        NEGOCIO("e9030e90-5555-4000-8000-000000000003", ORG_A, FUNIL_A, E3, "open", 300000, GESTOR_A, "meta_ads", "{}", "2026-10-01 00:30-03", null, null, null, "BRL", "2026-10-20"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000004", ORG_A, FUNIL_A, E1, "open", null, null, "", "{}", "2026-09-30 23:30-03", null),
        NEGOCIO("e9030e90-5555-4000-8000-000000000005", ORG_A, FUNIL_A, E4, "won", 500000, GESTOR_A, "meta_ads", "{}", "2026-09-01 10:00-03", "2026-10-05 10:00-03"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000006", ORG_A, FUNIL_A, E4, "won", 250000, ATENDENTE_A, "indicacao", "{}", "2026-10-01 10:00-03", "2026-10-11 10:00-03"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000007", ORG_A, FUNIL_A, E4, "won", 900000, GESTOR_A, "site", "{}", "2026-10-02 10:00-03", "2026-10-12 10:00-03", null, null, "USD"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000008", ORG_A, FUNIL_A, E5, "lost", 80000, ATENDENTE_A, "meta_ads", "{}", "2026-10-01 10:00-03", "2026-10-08 10:00-03", "price", E2),
        NEGOCIO("e9030e90-5555-4000-8000-000000000009", ORG_A, FUNIL_A, E5, "lost", 70000, null, "google_ads", "{}", "2026-10-01 10:00-03", "2026-10-09 10:00-03", "no_response"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000010", ORG_A, FUNIL_A, E5, "lost", 70000, null, "google_ads", "{}", "2026-10-01 10:00-03", "2026-10-09 10:00-03", "moved_to_another_pipeline"),
        NEGOCIO("e9030e90-5555-4000-8000-000000000011", ORG_A, FUNIL_A, E1, "open", 1000, null, "manual", "{}", "2026-06-01 10:00-03", null),
        NEGOCIO("e9030e90-5555-4000-8000-0000000000b1", ORG_B, FUNIL_B, EB, "open", 999999, GESTOR_B, "meta_ads", "{}", "2026-10-10 12:00-03", null),
      ].join(",\n      ")};

    insert into public.sales_targets (organization_id, periodo, metrica, alvo_cents) values
      ('${ORG_A}', '2026-10-01', 'receita_total', 1000000),
      ('${ORG_A}', '2026-09-01', 'receita_total', 600000);

    -- C: volume (1.205 abertos) e origens demais (14 nomes e um sem origem).
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, status, value_cents, source, created_at)
      select '${ORG_C}', '${FUNIL_C}', '${EC}', 'volume ' || g, 'open', 100,
             case when g <= 140 then 'origem_' || lpad((((g - 1) % 14) + 1)::text, 2, '0') when g = 141 then '' else 'massa' end,
             timestamptz '2026-10-05 10:00-03' + (g || ' seconds')::interval
        from generate_series(1, 1205) g;
  `);

  // Conversas, agenda, régua, obrigações e anúncios de A.
  sql(`
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO_A}', '${ORG_A}', 'motor-9030-a', '\\x00'::bytea);
    insert into public.contacts (id, organization_id, display_name, source, created_at) values
      ('e9030e90-6666-4000-8000-000000000001', '${ORG_A}', 'C1', 'meta_ads', '2026-10-03 10:00-03'),
      ('e9030e90-6666-4000-8000-000000000002', '${ORG_A}', 'C2', 'google_ads', '2026-10-04 10:00-03'),
      ('e9030e90-6666-4000-8000-000000000003', '${ORG_A}', 'C3', 'indicacao', '2026-10-05 10:00-03');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assignee_kind, tags, created_at, last_inbound_at) values
      ('e9030e90-7777-4000-8000-000000000001', '${ORG_A}', 'e9030e90-6666-4000-8000-000000000001', '${SESSAO_A}', 'open', null, null, '{Implante,Preço}', '2026-10-03 10:00-03', '2026-10-03 10:00-03'),
      ('e9030e90-7777-4000-8000-000000000002', '${ORG_A}', 'e9030e90-6666-4000-8000-000000000002', '${SESSAO_A}', 'open', '${ATENDENTE_A}', 'user', '{Preço}', '2026-10-04 10:00-03', '2026-10-04 10:00-03'),
      ('e9030e90-7777-4000-8000-000000000003', '${ORG_A}', 'e9030e90-6666-4000-8000-000000000003', '${SESSAO_A}', 'open', '${GESTOR_A}', 'user', '{}', '2026-10-05 10:00-03', '2026-10-05 10:00-03');
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, sent_via, sent_by_user_id, sent_at, external_id) values
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000001', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000001', 'text', 'inbound', 'oi', 'crm', null, '2026-10-03 10:00:00-03', 'motor-9030-m1'),
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000001', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000001', 'text', 'outbound', 'ola', 'ai', null, '2026-10-03 10:00:12-03', 'motor-9030-m2'),
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000002', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000002', 'text', 'inbound', 'oi', 'crm', null, '2026-10-04 10:00:00-03', 'motor-9030-m3'),
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000002', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000002', 'text', 'outbound', 'ola', 'ai', null, '2026-10-04 10:00:10-03', 'motor-9030-m4'),
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000002', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000002', 'text', 'outbound', 'equipe', 'crm', '${ATENDENTE_A}', '2026-10-04 10:07:00-03', 'motor-9030-m5'),
      ('${ORG_A}', 'e9030e90-7777-4000-8000-000000000003', '${SESSAO_A}', 'e9030e90-6666-4000-8000-000000000003', 'text', 'inbound', 'oi', 'crm', null, '2026-10-05 10:00:00-03', 'motor-9030-m6');
    insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, status, cancelled_at, owner_user_id, created_by_kind, created_by_user_id) values
      ('${ORG_A}', 'A1', '2026-10-06 10:00-03', '2026-10-06 11:00-03', 'completed', null, '${GESTOR_A}', 'user', '${ATENDENTE_A}'),
      ('${ORG_A}', 'A2', '2026-10-07 10:00-03', '2026-10-07 11:00-03', 'no_show', null, '${GESTOR_A}', 'user', '${ATENDENTE_A}'),
      ('${ORG_A}', 'A3', '2026-10-28 10:00-03', '2026-10-28 11:00-03', 'confirmed', null, '${GESTOR_A}', 'user', null),
      ('${ORG_A}', 'A4', '2026-10-08 10:00-03', '2026-10-08 11:00-03', 'cancelled', '2026-10-07 10:00-03', null, 'user', null);
    insert into public.ad_conversion_dispatches (organization_id, lead_id, platform, event_name, status, attempted_at) values
      ('${ORG_A}', 'e9030e90-5555-4000-8000-000000000003', 'meta_ads', 'QualifiedLead', 'error', '2026-10-11 10:00-03'),
      ('${ORG_A}', 'e9030e90-5555-4000-8000-000000000002', 'google_ads', 'Etapa:${E2}', 'sent', '2026-10-12 10:00-03'),
      ('${ORG_A}', 'e9030e90-5555-4000-8000-000000000001', 'meta_ads', 'Purchase', 'skipped', '2026-10-12 10:00-03')
      on conflict do nothing;
  `);
});

const A = `'${ORG_A}'::uuid`;

describe("o catálogo do banco é o da tela", () => {
  it("fontes, medidas, agrupamentos e filtros iguais aos de lib/paineis/catalogo.ts", () => {
    const doBanco = JSON.parse(lastLine(sql("select public.fn_mia_relatorio_catalogo()::text;"))) as Record<string, unknown>;
    for (const fonte of FONTES) {
      const b = doBanco[fonte] as { medidas: string[]; dims: string[]; filtros: string[]; futuro: boolean };
      const t = CATALOGO_DO_MOTOR[fonte];
      expect(b.medidas, `${fonte}.medidas`).toEqual([...t.medidas]);
      expect(b.dims, `${fonte}.dims`).toEqual([...t.dims]);
      expect(b.filtros, `${fonte}.filtros`).toEqual([...t.filtros]);
      expect(b.futuro, `${fonte}.futuro`).toBe(t.futuro);
    }
    expect(Object.keys(doBanco).filter((k) => !k.startsWith("_")).sort()).toEqual([...FONTES].sort());
  });
});

describe("a regra de data, no fuso da empresa", () => {
  const r = () => motor(`${A}, 'negocios', array['qtd','soma','tfechar'], 'situacao', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);

  it("⭐ 23h30 de 30/09 em São Paulo é setembro; 00h30 de 01/10 é outubro", () => {
    const res = r();
    // Abertos de outubro: N1, N2 e N3 (N4 entrou às 23h30 de 30/09; o Velho, em junho).
    expect(n(res, "aberto")).toBe(3);
    expect((res.janela as Record<string, string>).de).toBe("2026-10-01");
  });

  it("ganho conta pela data em que fechou (G1 entrou em setembro e fechou em outubro)", () => {
    expect(n(r(), "ganho")).toBe(3);
  });

  it("a troca de funil não é perda", () => {
    expect(n(r(), "perdido")).toBe(2);
  });

  it("dinheiro só na moeda da empresa, e o resto dito em fora_da_moeda", () => {
    const res = r();
    const ganho = grupos(res).find((g) => g.chave === "ganho")!;
    expect(ganho.valores.soma).toBe(750000);
    expect(res.fora_da_moeda).toBe(1);
    // Do primeiro contato ao fechamento, média dos ganhos: (34 + 10 + 10) / 3.
    expect(ganho.valores.tfechar).toBe(18);
  });
});

describe("sem o teto de 1000 linhas", () => {
  it("⭐ 1.205 negócios somam 1.205, e a soma do valor é a de todos", () => {
    const res = motor(`'${ORG_C}'::uuid, 'negocios', array['qtd','soma'], null, null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(total(res).n).toBe(1205);
    expect(total(res).valores.soma).toBe(120500);
  });
});

describe("etiquetas, Sem e Outros", () => {
  it("o negócio com duas etiquetas conta em cada uma; o total conta uma vez", () => {
    const res = motor(`${A}, 'negocios', array['qtd'], 'etiqueta', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(n(res, "Implante")).toBe(2);
    expect(n(res, "Urgente")).toBe(1);
    expect(n(res, "__sem")).toBe(6);
    expect(total(res).n).toBe(8);
  });

  it("'Sem origem' aparece mesmo com zero", () => {
    const res = motor(`${A}, 'negocios', array['qtd'], 'origem', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    const sem = grupos(res).find((g) => g.chave === "__sem");
    expect(sem).toBeDefined();
    expect(sem!.n).toBe(0);
  });

  it("⭐ mais de 12 grupos: 11 ficam (o Sem entre eles), o resto vira Outros, recalculado", () => {
    const res = motor(`'${ORG_C}'::uuid, 'negocios', array['qtd'], 'origem', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    const gs = grupos(res);
    expect(gs).toHaveLength(12);
    expect(gs.at(-1)!.chave).toBe("__sem");
    expect(gs.at(-1)!.n).toBe(1);
    const outros = gs.find((g) => g.outros)!;
    expect(outros.chave).toBe("__outros");
    // 15 origens com nome (14 + "massa"), cabem 10 + Outros + Sem: 5 dobradas, de 10 negócios cada.
    expect((res.dobrados as string[]).length).toBe(5);
    expect(outros.n).toBe(50);
    expect(gs.reduce((s, g) => s + g.n, 0)).toBe(1205);
  });
});

describe("o funil 'chegaram'", () => {
  it("cada etapa conta quem chegou até ela; o perdido, até a etapa de onde saiu", () => {
    const res = motor(`${A}, 'negocios', array['chegaram'], 'etapa', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(grupos(res).map((g) => [g.rotulo, g.n])).toEqual([
      ["Novo contato", 8],
      ["Avaliação marcada", 6],
      ["Orçamento", 4],
      ["Fechou", 3],
    ]);
    expect((res.funil as Record<string, unknown>).nome).toBe("Pacientes");
  });
});

describe("a meta do mês", () => {
  it("⭐ o alvo do mês, a fração do realizado e quanto do mês correu", () => {
    const res = motor(`${A}, 'negocios', array['soma'], null, null, '{"situacao":"ganho","so_receita":true}', 'mes', null, null, true, false, '${AGORA}'`);
    const meta = res.meta as Record<string, number | boolean | null>;
    expect(meta.alvo_cents).toBe(1000000);
    expect(meta.fracao).toBe(0.75);
    expect(meta.corrido).toBeCloseTo(15 / 31, 3);
    expect(meta.proporcional).toBe(false);
  });

  it("em 30 dias a meta é proporcional aos dias de cada mês", () => {
    const res = motor(`${A}, 'negocios', array['soma'], null, null, '{"situacao":"ganho"}', '30', null, null, true, false, '${AGORA}'`);
    // 16/09 a 15/10: 15/30 de 600.000 + 15/31 de 1.000.000.
    expect((res.meta as Record<string, number>).alvo_cents).toBe(783871);
  });

  it("⭐ sem valores: o alvo e a soma somem, a fração fica", () => {
    const res = motor(`${A}, 'negocios', array['soma','prev'], null, null, '{"situacao":"ganho"}', 'mes', null, null, false, false, '${AGORA}'`);
    const meta = res.meta as Record<string, number | null>;
    expect(meta.alvo_cents).toBeNull();
    expect(meta.fracao).toBe(0.75);
    expect(total(res).valores.soma).toBeNull();
    expect(total(res).valores.prev).toBeNull();
    expect(res.valores).toBe(false);
  });
});

describe("quem vê o quê", () => {
  const args = `${A}, 'negocios', array['qtd','soma'], null, null, '{}', 'mes', null, null, true, false, '${AGORA}'`;

  it("⭐ o gestor vê a empresa; o atendente, os dele e os sem dono (a RLS do CRM)", () => {
    expect(total(motorComo(GESTOR_A, args)).n).toBe(8);
    const doAtendente = total(motorComo(ATENDENTE_A, args));
    // N1, N2, G2, P1 (dele) e P2 (sem dono); N3, G1 e G3 são do gestor.
    expect(doAtendente.n).toBe(5);
    expect(doAtendente.valores.soma).toBe(700000);
  });

  it("⭐ quem é de outra empresa é recusado com 42501, e não recebe zeros", () => {
    expect(tentar(`authenticated:${GESTOR_B}`, `public.fn_mia_relatorio(${args})`)).toBe("42501");
  });

  it("anon não executa o motor", () => {
    expect(tentar("anon", `public.fn_mia_relatorio(${args})`)).toBe("42501");
  });

  it("a plataforma (service_role) vê a empresa pedida e só ela", () => {
    const res = JSON.parse(
      lastLine(sql(`set role service_role; select public.fn_mia_relatorio(${args})::text;`)),
    ) as Record<string, unknown>;
    expect(total(res).n).toBe(8);
    // O 999.999 é de B: não entra em nenhuma conta de A.
    expect(total(res).valores.soma).not.toBe(999999);
    expect(total(res).valores.soma).toBe(1500000);
  });

  it("anúncios: o atendente é recusado; o gestor vê o que foi informado (o que nem saiu fica de fora)", () => {
    const anuncios = `${A}, 'anuncios', array['qtd','aceito'], 'plataforma', null, '{}', 'mes', null, null, true, false, '${AGORA}'`;
    expect(tentar(`authenticated:${ATENDENTE_A}`, `public.fn_mia_relatorio(${anuncios})`)).toBe("42501");
    const res = motorComo(GESTOR_A, anuncios);
    expect(n(res, "meta_ads")).toBe(1);
    expect(n(res, "google_ads")).toBe(1);
    expect(total(res).valores.aceito).toBe(50);
  });

  it("o definer de anúncios não é executável por anon", () => {
    expect(
      tentar("anon", `public.fn_mia_relatorio_linhas_de_anuncios(${A}, '-infinity', 'infinity')`),
    ).toBe("42501");
  });
});

describe("conversas", () => {
  it("quem atendeu e quanto o cliente esperou", () => {
    const res = motor(`${A}, 'conversas', array['qtd','tresp','resolv'], 'quem', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(grupos(res).map((g) => [g.chave, g.n])).toEqual([
      ["agente", 1],
      ["equipe", 1],
      ["sem_resposta", 1],
    ]);
    const porChave = Object.fromEntries(grupos(res).map((g) => [g.chave, g.valores]));
    expect(porChave.agente!.tresp).toBe(12);
    expect(porChave.equipe!.tresp).toBe(420);
    expect(total(res).valores.resolv).toBe(33.3);
  });

  it("o atendente vê as conversas que vê no Inbox", () => {
    const res = motorComo(ATENDENTE_A, `${A}, 'conversas', array['qtd'], null, null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(total(res).n).toBe(2);
  });
});

describe("agenda e período anterior", () => {
  it("'Este mês' na agenda vai até o fim do mês (dia marcado)", () => {
    const res = motor(`${A}, 'agenda', array['qtd','comp'], 'situacao', null, '{}', 'mes', null, null, true, false, '${AGORA}'`);
    expect(total(res).n).toBe(4);
    expect(n(res, "confirmado")).toBe(1);
    expect(total(res).valores.comp).toBe(50);
    expect((res.janela as Record<string, string>).ate).toBe("2026-10-31");
  });

  it("comparar: o mesmo trecho do mês passado", () => {
    const res = motor(`${A}, 'negocios', array['qtd'], 'situacao', null, '{}', 'mes', null, null, true, true, '${AGORA}'`);
    const anterior = res.anterior as { janela: Record<string, string>; total: { n: number } };
    expect(anterior.janela.de).toBe("2026-09-01");
    expect(anterior.janela.ate).toBe("2026-09-15");
  });
});

describe("a situação da obrigação no banco é a de lib/obrigacoes/situacao.ts", () => {
  it("⭐ a mesma resposta numa matriz de casos", () => {
    const hoje = "2026-10-15";
    const dias = (d: number) => {
      const t = new Date(Date.UTC(2026, 9, 15) + d * 86_400_000);
      return t.toISOString().slice(0, 10);
    };
    const casos: ItemParaSituacao[] = [];
    for (const avisos of [[], [30, 15, 7], [7]]) {
      for (const valido of [null, -5, 0, 5, 7, 8, 29, 30, 31, 90]) {
        for (const recebido of [null, -40]) {
          for (const pedido of [null, -50, -10]) {
            casos.push({
              categoria: "documento",
              valido_ate: valido === null ? null : dias(valido),
              recebido_em: recebido === null ? null : dias(recebido),
              pedido_em: pedido === null ? null : dias(pedido),
              proxima_em: null,
              feita_em: null,
              avisos_dias: avisos,
            } as unknown as ItemParaSituacao);
          }
        }
      }
      for (const proxima of [null, -3, 0, 6, 7, 8, 30, 31, 120]) {
        for (const feita of [null, -20]) {
          casos.push({
            categoria: "atividade",
            proxima_em: proxima === null ? null : dias(proxima),
            feita_em: feita === null ? null : dias(feita),
            valido_ate: null,
            recebido_em: null,
            pedido_em: null,
            avisos_dias: avisos,
          } as unknown as ItemParaSituacao);
        }
      }
    }
    const lit = (v: string | null) => (v ? `'${v}'::date` : "null::date");
    const valores = casos
      .map(
        (c, i) =>
          `(${i}, public.fn_mia_obrigacao_situacao('${c.categoria}', ${lit(c.proxima_em)}, ${lit(c.feita_em)}, ${lit(c.valido_ate)}, ${lit(c.recebido_em)}, ${lit(c.pedido_em)}, '{${(c.avisos_dias as number[]).join(",")}}'::int[], '${hoje}'::date))`,
      )
      .join(",");
    const linhas = sql(`select v.i || ':' || v.s from (values ${valores}) v(i, s) order by v.i;`).split("\n");
    expect(linhas).toHaveLength(casos.length);
    const divergencias = linhas.filter((l) => {
      const [i, s] = l.split(":");
      return situacao(casos[Number(i)]!, hoje) !== s;
    });
    expect(divergencias).toEqual([]);
  });
});

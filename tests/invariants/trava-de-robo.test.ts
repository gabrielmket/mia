/**
 * 9153, 9154 e 9171 · A TRAVA DE ROBÔ no Postgres de verdade (FORK MIA .108,
 * docs/fork/trava-de-robo.md; o ritmo de máquina, MIA-210, na 9171).
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. As duas tabelas são lidas pelo GERENTE da própria empresa e escritas só
 *    pelo servidor: `authenticated` não tem privilégio de escrita, `anon` não lê.
 *    (O isolamento entre duas empresas, nas duas direções, está em
 *    `rls-tabelas-da-mia.test.ts`.) CONTROLE: o `service_role` grava.
 * 2. O que o banco GARANTE sozinho: a faixa de cada limite da configuração (as
 *    mesmas de `lib/trava-de-robo/config.ts`), o padrão LIGADA, o motivo fechado
 *    ('robo', 'teto'), os sinais em lista, e que o TETO não perde negócio, não
 *    encerra e não etiqueta. Na 9171: os quatro campos do ritmo nascem com o
 *    padrão (LIGADO, 6 giros, 60 s, 8 s) e as faixas são as do código. O registro
 *    do ritmo cabe nas CHECKs da 9154 como estão (motivo 'teto', sinal 'ritmo').
 * 3. O registro é auditoria: apagar o contato ou a conversa solta a referência
 *    (on delete set null) e o registro fica.
 *
 * Organização e contatos próprios (namespace `e9153e90-`). Dado fictício.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "e9153e90-0000-4000-8000-00000000000a";
const GESTOR = "e9153e90-1111-4000-8000-00000000000a";
const CONTATO = "e9153e90-3333-4000-8000-00000000000a";
const SESSAO = "e9153e90-4444-4000-8000-00000000000a";
const CONVERSA = "e9153e90-5555-4000-8000-00000000000a";

function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${GESTOR}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9153', 'passou', false);
        exception when others then
          perform set_config('inv.r9153', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9153');
    `),
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${GESTOR}', 'trava-9153@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'trava-9153', 'Clínica Exemplo 9153', 'Clínica Exemplo 9153') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${GESTOR}', '${ORG}', 'manager', now()) on conflict do nothing;
    insert into public.contacts (id, organization_id, name)
      values ('${CONTATO}', '${ORG}', 'Operadora Exemplo') on conflict (id) do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}', '${ORG}', 'trava-9153', '\\x00'::bytea) on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'closed') on conflict (id) do nothing;
    insert into public.mia_trava_de_robo_config (organization_id) values ('${ORG}') on conflict (organization_id) do nothing;
    insert into public.mia_travas_de_robo (organization_id, contact_id, conversation_id, motivo, mensagens_de_robo, respostas_da_ia, conversa_encerrada, etiqueta_aplicada)
      values ('${ORG}', '${CONTATO}', '${CONVERSA}', 'robo', 3, 3, true, true);
  `);
});

describe("quem lê e quem escreve", () => {
  it("RLS ligada nas duas, com a política de leitura do gerente", () => {
    for (const t of ["mia_trava_de_robo_config", "mia_travas_de_robo"]) {
      expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.${t}'::regclass;`)), t).toBe("true");
      expect(lastLine(sql(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass and polcmd = 'r';`)), t).toBe("1");
    }
  });

  it("o gerente da empresa lê as duas (controle positivo)", () => {
    expect(tentar("authenticated", `perform 1 from public.mia_trava_de_robo_config where organization_id = '${ORG}'`)).toBe("passou");
    expect(
      lastLine(
        sql(`
          set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${GESTOR}"}', false);
          select count(*) from public.mia_travas_de_robo where organization_id = '${ORG}';
        `),
      ),
    ).toBe("1");
  });

  it("⭐ authenticated não escreve nem na própria empresa; anon nem lê (42501)", () => {
    expect(tentar("authenticated", `update public.mia_trava_de_robo_config set ligada = false where organization_id = '${ORG}'`)).toBe("42501");
    expect(tentar("authenticated", `insert into public.mia_travas_de_robo (organization_id, motivo) values ('${ORG}', 'robo')`)).toBe("42501");
    expect(tentar("authenticated", `delete from public.mia_travas_de_robo where organization_id = '${ORG}'`)).toBe("42501");
    expect(tentar("anon", `perform 1 from public.mia_trava_de_robo_config`)).toBe("42501");
    expect(tentar("anon", `perform 1 from public.mia_travas_de_robo`)).toBe("42501");
  });

  it("CONTROLE: o service_role grava", () => {
    expect(tentar("service_role", `update public.mia_trava_de_robo_config set teto_respostas = 40 where organization_id = '${ORG}'`)).toBe("passou");
    expect(tentar("service_role", `insert into public.mia_travas_de_robo (organization_id, motivo) values ('${ORG}', 'teto')`)).toBe("passou");
  });
});

describe("o que o banco garante sozinho", () => {
  it("a configuração nasce LIGADA, com os padrões da especificação", () => {
    expect(
      lastLine(
        sql(`select ligada::text || ',' || janela_minutos || ',' || mensagens_para_disparar || ',' || teto_respostas || ',' || teto_janela_minutos
               from public.mia_trava_de_robo_config where organization_id = '${ORG}';`),
      ),
    ).toMatch(/^true,15,3,(30|40),60$/);
  });

  it("9171 · o ritmo de máquina nasce LIGADO, com 6 giros, 60 s e 8 s", () => {
    expect(
      lastLine(
        sql(`select ritmo_ligado::text || ',' || ritmo_giros || ',' || ritmo_latencia_maxima_segundos || ',' || ritmo_variacao_segundos
               from public.mia_trava_de_robo_config where organization_id = '${ORG}';`),
      ),
    ).toBe("true,6,60,8");
    for (const coluna of ["ritmo_ligado", "ritmo_giros", "ritmo_latencia_maxima_segundos", "ritmo_variacao_segundos"]) {
      expect(
        lastLine(
          sql(`select is_nullable from information_schema.columns
                where table_schema = 'public' and table_name = 'mia_trava_de_robo_config' and column_name = '${coluna}';`),
        ),
        coluna,
      ).toBe("NO");
    }
  });

  it.each([
    ["ritmo_giros", 4],
    ["ritmo_giros", 30],
    ["ritmo_latencia_maxima_segundos", 10],
    ["ritmo_latencia_maxima_segundos", 300],
    ["ritmo_variacao_segundos", 2],
    ["ritmo_variacao_segundos", 60],
  ])("9171 · CONTROLE: a ponta da faixa passa: %s = %s", (campo, valor) => {
    expect(tentar("postgres", `update public.mia_trava_de_robo_config set ${campo} = ${valor} where organization_id = '${ORG}'`)).toBe("passou");
  });

  it("9171 · o registro do ritmo (motivo 'teto', sinal 'ritmo') cabe nas CHECKs da 9154 como estão", () => {
    expect(
      tentar(
        "postgres",
        `insert into public.mia_travas_de_robo (organization_id, motivo, sinais, mensagens_de_robo, respostas_da_ia, duracao_segundos)
           values ('${ORG}', 'teto', '[{"mensagem_id":"${CONTATO}","sinais":["ritmo"]}]'::jsonb, 6, 6, 193)`,
      ),
    ).toBe("passou");
    expect(
      lastLine(sql(`select count(*) from pg_constraint where conrelid = 'public.mia_travas_de_robo'::regclass and contype = 'c';`)),
    ).toBe("5");
  });

  it.each([
    ["janela_minutos", 0],
    ["mensagens_para_disparar", 1],
    ["repeticao_janela_minutos", 5],
    ["repeticoes_anteriores", 0],
    ["velocidade_minimo_de_caracteres", 10],
    ["velocidade_caracteres_por_segundo", 2],
    ["teto_respostas", 4],
    ["teto_janela_minutos", 2000],
    ["ritmo_giros", 3],
    ["ritmo_giros", 31],
    ["ritmo_latencia_maxima_segundos", 9],
    ["ritmo_latencia_maxima_segundos", 301],
    ["ritmo_variacao_segundos", 1],
    ["ritmo_variacao_segundos", 61],
  ])("limite fora da faixa é recusado: %s = %s (23514)", (campo, valor) => {
    expect(tentar("postgres", `update public.mia_trava_de_robo_config set ${campo} = ${valor} where organization_id = '${ORG}'`)).toBe("23514");
  });

  it("o motivo é fechado e os sinais são uma lista (23514)", () => {
    expect(tentar("postgres", `insert into public.mia_travas_de_robo (organization_id, motivo) values ('${ORG}', 'outro')`)).toBe("23514");
    expect(
      tentar("postgres", `insert into public.mia_travas_de_robo (organization_id, motivo, sinais) values ('${ORG}', 'robo', '{"a":1}'::jsonb)`),
    ).toBe("23514");
  });

  it("⭐ o teto não perde negócio, não encerra e não etiqueta (23514)", () => {
    expect(
      tentar(
        "postgres",
        `insert into public.mia_travas_de_robo (organization_id, motivo, negocios_afetados) values ('${ORG}', 'teto', array['${CONTATO}']::uuid[])`,
      ),
    ).toBe("23514");
    expect(tentar("postgres", `insert into public.mia_travas_de_robo (organization_id, motivo, conversa_encerrada) values ('${ORG}', 'teto', true)`)).toBe(
      "23514",
    );
    expect(tentar("postgres", `insert into public.mia_travas_de_robo (organization_id, motivo, etiqueta_aplicada) values ('${ORG}', 'teto', true)`)).toBe(
      "23514",
    );
  });
});

describe("o registro é auditoria", () => {
  it("apagar a conversa e o contato solta as referências, e o registro fica", () => {
    sql(`
      delete from public.messages where conversation_id = '${CONVERSA}';
      delete from public.conversations where id = '${CONVERSA}';
      delete from public.contacts where id = '${CONTATO}';
    `);
    expect(
      lastLine(
        sql(`select count(*) from public.mia_travas_de_robo
              where organization_id = '${ORG}' and motivo = 'robo' and contact_id is null and conversation_id is null;`),
      ),
    ).toBe("1");
  });
});

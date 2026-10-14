import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (migration 9021) — o `idle` do Outlook limpa o erro de rodada passada.
 *
 * O upstream consertou isto em `fn_google_appointment` na 0578 (#2467): a ação
 * `idle` é o executor dizendo "convergiu, não há nada a enviar e nada falhou
 * nesta rodada". Um erro guardado ali é de uma rodada anterior, e mantê-lo deixa
 * a tela da agenda dizendo "não publicou" sobre um compromisso que está em dia.
 * O clone do Outlook (`fn_mia_agenda_microsoft_compromisso`, 9014) copiava o
 * `idle` antigo do Google; a 9021 leva o conserto para ele.
 *
 * O CONTROLE NEGATIVO roda o corpo da 9014 (o de antes) numa transação desfeita
 * e mostra o erro sobrevivendo; sem ele, "o erro sumiu" poderia vir de outra
 * coisa e o teste afirmaria o conserto sem medi-lo.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test.
 */

const ORG = "90210000-0000-4000-8000-0000000000aa";
const PESSOA = "90210000-1111-4000-8000-0000000000aa";
const CONEXAO = "90210000-4444-4000-8000-0000000000aa";
const CAL = "90210000-5555-4000-8000-0000000000aa";
const AP = "90210000-7777-4000-8000-0000000000aa";

const PASTA = join(process.cwd(), "supabase", "migrations-mia");
const MIGRATION_9014 = readFileSync(join(PASTA, "20261001140000_9014_agenda_microsoft_publicacao.sql"), "utf8");

/** A função da 9014 como ela era: o `idle` só adia a próxima tentativa. */
/** A linha que começa com `M:` (o `rollback` final imprime depois dela). */
function linhaMarcada(saida: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith("M:"));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(2).trim();
}

const FUNCAO_DA_9014 = /create or replace function public\.fn_mia_agenda_microsoft_compromisso\([\s\S]*?\n\$\$;/.exec(
  MIGRATION_9014,
)?.[0];

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${PESSOA}', 'mia-9021-idle@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-9021-idle', 'MIA 9021', 'MIA 9021') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${PESSOA}', '${ORG}', 'manager', now()) on conflict do nothing;
    insert into public.mia_agenda_microsoft_conexoes (id, organization_id, user_id, conta_email, microsoft_user_id, status)
      values ('${CONEXAO}', '${ORG}', '${PESSOA}', 'pessoa-9021@empresa.invariant.test', 'oid-9021', 'healthy')
      on conflict (id) do nothing;
    insert into public.mia_agenda_microsoft_calendarios (id, organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, conta_como_ocupado, destino)
      values ('${CAL}', '${ORG}', '${CONEXAO}', 'cal-9021', 'Calendário', true, 'owner', true, true)
      on conflict (id) do nothing;
    insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, owner_user_id)
      values ('${AP}', '${ORG}', 'Idle 9021', now() + interval '2 days', now() + interval '2 days 1 hour', '${PESSOA}')
      on conflict (id) do nothing;
  `);
});

/**
 * Reserva, grava um erro "de rodada passada" e chama o `idle` com a reserva e as
 * revisões que o executor mandaria. Tudo numa transação desfeita; `antes` roda
 * primeiro (o controle negativo troca a função ali). Devolve o erro que sobrou.
 */
function erroDepoisDoIdle(antes = ""): string {
  return linhaMarcada(
    sql(`
      begin;
      ${antes}
      do $$
      declare r jsonb;
      begin
        r := public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP}', 'claim');
        update public.mia_agenda_microsoft_compromissos
           set erro = 'A publicação falhou na rodada anterior.'
         where appointment_id = '${AP}';
        perform public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP}', 'idle', jsonb_build_object(
          'claim', r->'claim',
          'revision', r->'appointment'->>'revision',
          'local_revision', r->'appointment'->>'local_revision',
          'event_id', r->'mirror'->>'event_id',
          'connection_id', r->'mirror'->>'connection_id',
          'calendar_id', r->'mirror'->>'calendar_id'));
      end $$;
      select 'M:' || coalesce(erro, 'nulo') || '|' || (proxima_tentativa_em > now())::text
        from public.mia_agenda_microsoft_compromissos where appointment_id = '${AP}';
      rollback;
    `),
  );
}

describe("o idle do Outlook (9021)", () => {
  it("⭐ convergiu sem falha: o erro de rodada passada some, e a próxima tentativa é adiada", () => {
    expect(erroDepoisDoIdle()).toBe("nulo|true");
  });

  it("⭐ CONTROLE NEGATIVO: com o corpo da 9014 (o de antes), o erro velho sobrevive ao idle", () => {
    expect(FUNCAO_DA_9014, "não achei a função na migration 9014").toBeDefined();
    expect(FUNCAO_DA_9014).not.toContain("set erro = null,\n             proxima_tentativa_em");
    expect(erroDepoisDoIdle(FUNCAO_DA_9014)).toBe("A publicação falhou na rodada anterior.|true");
  });

  it("a ação de erro continua gravando o erro (o idle não engole a falha desta rodada)", () => {
    const r = linhaMarcada(
      sql(`
        begin;
        do $$
        declare r jsonb;
        begin
          r := public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP}', 'claim');
          perform public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP}', 'error', jsonb_build_object(
            'claim', r->'claim',
            'revision', r->'appointment'->>'revision',
            'local_revision', r->'appointment'->>'local_revision',
            'event_id', r->'mirror'->>'event_id',
            'connection_id', r->'mirror'->>'connection_id',
            'calendar_id', r->'mirror'->>'calendar_id',
            'message', 'Falhou agora.'));
        end $$;
        select 'M:' || coalesce(erro, 'nulo') from public.mia_agenda_microsoft_compromissos where appointment_id = '${AP}';
        rollback;
      `),
    );
    expect(r).toBe("Falhou agora.");
  });
});

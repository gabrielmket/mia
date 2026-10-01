import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * A agenda do Outlook no banco (FORK MIA, migrations 9011, 9014 e 9015;
 * docs/fork/agenda-microsoft.md). Provado num Postgres de verdade:
 *
 *  - um destino por pessoa ENTRE Google e Outlook, inclusive contra o destino
 *    automático do primeiro catálogo do Google (que roda sem sessão);
 *  - a ocupação do Outlook chega com as colunas da do Google e respeita "não
 *    conta como ocupado";
 *  - a publicação pega o compromisso novo de quem tem destino no Outlook, a
 *    reserva cria o vínculo, e o já publicado no Google não é tocado;
 *  - o tipo Teams de quem publica no Google vira "Teams indisponível" uma vez.
 */

const ORG = "90110000-0000-4000-8000-0000000000aa";
const PESSOA = "90110000-1111-4000-8000-0000000000aa";
const CONEXAO_G = "90110000-2222-4000-8000-0000000000aa";
const CAL_G = "90110000-3333-4000-8000-0000000000aa";
const CONEXAO_M = "90110000-4444-4000-8000-0000000000aa";
const CAL_M = "90110000-5555-4000-8000-0000000000aa";
const CAL_M_LEITURA = "90110000-5555-4000-8000-0000000000bb";
const TIPO_TEAMS = "90110000-6666-4000-8000-0000000000aa";
const AP_NOVO = "90110000-7777-4000-8000-0000000000aa";
const AP_NO_GOOGLE = "90110000-7777-4000-8000-0000000000bb";
const AP_TEAMS = "90110000-7777-4000-8000-0000000000cc";

/** Roda como a pessoa (sessão com JWT, aal2). Devolve a última linha. */
function comoAPessoa(corpo: string): string {
  return lastLine(
    sql(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${PESSOA}","aal":"aal2","role":"authenticated"}', true);
      ${corpo}
      commit;
    `),
  );
}

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${PESSOA}', 'mia-ms-agenda@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-ms-agenda', 'MIA MS', 'MIA MS') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${PESSOA}', '${ORG}', 'manager', now()) on conflict do nothing;

    insert into public.calendar_connections (id, organization_id, user_id, provider, account_email, status)
      values ('${CONEXAO_G}', '${ORG}', '${PESSOA}', 'google_calendar', 'pessoa@gmail.invariant.test', 'healthy')
      on conflict (id) do nothing;
    insert into public.calendar_connection_calendars (id, organization_id, connection_id, external_calendar_id, name, is_primary, access_role, counts_for_conflicts, is_destination)
      values ('${CAL_G}', '${ORG}', '${CONEXAO_G}', 'pessoa@gmail.invariant.test', 'Pessoal', true, 'owner', true, false)
      on conflict (id) do nothing;

    insert into public.mia_agenda_microsoft_conexoes (id, organization_id, user_id, conta_email, microsoft_user_id, status)
      values ('${CONEXAO_M}', '${ORG}', '${PESSOA}', 'pessoa@empresa.invariant.test', 'oid-1', 'healthy')
      on conflict (id) do nothing;
    insert into public.mia_agenda_microsoft_calendarios (id, organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, conta_como_ocupado, reunioes_permitidas)
      values ('${CAL_M}', '${ORG}', '${CONEXAO_M}', 'cal-padrao', 'Calendário', true, 'owner', true, array['teamsForBusiness']),
             ('${CAL_M_LEITURA}', '${ORG}', '${CONEXAO_M}', 'cal-feriados', 'Feriados', false, 'reader', false, array[]::text[])
      on conflict (id) do nothing;

    insert into public.mia_agenda_microsoft_eventos (organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim)
      values ('${ORG}', '${CONEXAO_M}', 'cal-padrao', 'ev-ocupa', timestamptz '2031-05-05 13:00+00', timestamptz '2031-05-05 14:00+00'),
             ('${ORG}', '${CONEXAO_M}', 'cal-feriados', 'ev-feriado', timestamptz '2031-05-05 00:00+00', timestamptz '2031-05-06 00:00+00')
      on conflict do nothing;

    insert into public.calendar_event_types (id, organization_id, name, slug, location_kind, location_details, default_owner_user_id)
      values ('${TIPO_TEAMS}', '${ORG}', 'Reunião Teams', 'reuniao-teams-ms-inv', 'video_link', 'Microsoft Teams', '${PESSOA}')
      on conflict (id) do nothing;
    insert into public.mia_agenda_tipos_com_teams (event_type_id, organization_id) values ('${TIPO_TEAMS}', '${ORG}') on conflict do nothing;
  `);
});

describe("um destino por pessoa entre Google e Outlook", () => {
  it("escolher o Outlook como destino tira o destino do Google, e o contrário também", () => {
    const revG = valor(`select calendar_selection_revision from public.calendar_connections where id = '${CONEXAO_G}';`);
    const revM = valor(`select revisao_da_escolha from public.mia_agenda_microsoft_conexoes where id = '${CONEXAO_M}';`);
    comoAPessoa(`select public.fn_mia_agenda_selecao('${ORG}',
      '{"google":[{"connection_id":"${CONEXAO_G}","revision":"${revG}"}],"microsoft":[{"connection_id":"${CONEXAO_M}","revision":"${revM}"}]}'::jsonb,
      array['${CAL_G}']::uuid[], array['${CAL_M}']::uuid[], 'microsoft', '${CAL_M}');`);
    expect(valor(`select destino from public.mia_agenda_microsoft_calendarios where id = '${CAL_M}';`)).toBe("t");
    expect(valor(`select is_destination from public.calendar_connection_calendars where id = '${CAL_G}';`)).toBe("f");
    expect(valor(`select counts_for_conflicts from public.calendar_connection_calendars where id = '${CAL_G}';`)).toBe("t");
  });

  it("o destino automático do Google (sem sessão) não toma o do Outlook", () => {
    sql(`update public.calendar_connection_calendars set is_destination = true where id = '${CAL_G}';`);
    expect(valor(`select is_destination from public.calendar_connection_calendars where id = '${CAL_G}';`)).toBe("f");
    expect(valor(`select destino from public.mia_agenda_microsoft_calendarios where id = '${CAL_M}';`)).toBe("t");
  });

  it("agenda só-leitura do Outlook nunca é destino", () => {
    let recusa = "";
    try {
      // Numa transação que não chega ao fim: tira o destino de escrita (para a
      // chave de um destino por conexão não responder antes) e tenta o só-leitura.
      sql(`
        begin;
        update public.mia_agenda_microsoft_calendarios set destino = false where id = '${CAL_M}';
        update public.mia_agenda_microsoft_calendarios set destino = true where id = '${CAL_M_LEITURA}';
        commit;
      `);
    } catch (e) {
      const erro = e as { stderr?: Buffer | string; message?: string };
      recusa = `${erro.stderr?.toString() ?? ""} ${erro.message ?? ""}`;
    }
    expect(recusa).toContain("microsoft_destino_sem_escrita");
    expect(valor(`select destino from public.mia_agenda_microsoft_calendarios where id = '${CAL_M_LEITURA}';`)).toBe("f");
  });
});

describe("a ocupação do Outlook", () => {
  it("chega com as colunas da do Google e respeita 'não conta como ocupado'", () => {
    const linhas = sql(`
      select count(*) || '|' || min(starts_at)::text || '|' || min(connection_status)
        from public.fn_mia_agenda_ocupacao_microsoft_do_dono('${ORG}', '${PESSOA}', timestamptz '2031-05-05 00:00+00', timestamptz '2031-05-06 00:00+00');
    `);
    const [n, inicio, situacao] = lastLine(linhas).split("|");
    expect(n).toBe("1");
    expect(inicio).toContain("2031-05-05 13:00");
    expect(situacao).toBe("healthy");
  });
});

describe("a publicação no Outlook", () => {
  beforeAll(() => {
    sql(`
      insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, owner_user_id)
        values ('${AP_NOVO}', '${ORG}', 'Novo', now() + interval '2 days', now() + interval '2 days 1 hour', '${PESSOA}'),
               ('${AP_NO_GOOGLE}', '${ORG}', 'No Google', now() + interval '3 days', now() + interval '3 days 1 hour', '${PESSOA}')
        on conflict (id) do nothing;
      update public.calendar_appointments set google_event_id = 'deskcommappnogoogle', google_connection_id = '${CONEXAO_G}', google_calendar_id = 'pessoa@gmail.invariant.test'
       where id = '${AP_NO_GOOGLE}';
    `);
  });

  it("pega o compromisso novo de quem publica no Outlook e não o que já está no Google", () => {
    const ids = sql(`select id from public.fn_mia_agenda_microsoft_a_publicar(200) where organization_id = '${ORG}';`);
    expect(ids).toContain(AP_NOVO);
    expect(ids).not.toContain(AP_NO_GOOGLE);
  });

  it("a reserva cria o vínculo com o destino e devolve a reserva; a segunda espera", () => {
    const r = valor(`select public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP_NOVO}', 'claim')->'mirror'->>'calendar_id';`);
    expect(r).toBe("cal-padrao");
    expect(valor(`select escrita_pendente::text from public.mia_agenda_microsoft_compromissos where appointment_id = '${AP_NOVO}';`)).toBe(
      '{"reserva": true}',
    );
    expect(valor(`select coalesce(public.fn_mia_agenda_microsoft_compromisso('${ORG}', '${AP_NOVO}', 'claim')::text, 'nulo');`)).toBe("nulo");
  });
});

describe("Teams de quem publica no Google", () => {
  it("vira 'Teams indisponível' uma vez", () => {
    // Destino de volta para o Google: o tipo Teams desta pessoa fica sem Teams.
    sql(`
      update public.mia_agenda_microsoft_calendarios set destino = false where id = '${CAL_M}';
      insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, owner_user_id, event_type_id, location_kind, created_at)
        values ('${AP_TEAMS}', '${ORG}', 'Reunião Teams', now() + interval '4 days', now() + interval '4 days 1 hour', '${PESSOA}', '${TIPO_TEAMS}', 'video_link', now() - interval '10 minutes')
        on conflict (id) do nothing;
    `);
    sql(`select public.fn_mia_agenda_microsoft_teams_sem_outlook(200);`);
    expect(valor(`select teams_estado || '|' || teams_erro from public.mia_agenda_microsoft_compromissos where appointment_id = '${AP_TEAMS}';`)).toBe(
      "falhou|sem_destino",
    );
    expect(valor(`select public.fn_mia_agenda_microsoft_teams_sem_outlook(200);`)).toBe("0");
  });
});

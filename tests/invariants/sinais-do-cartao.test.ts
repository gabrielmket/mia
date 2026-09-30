import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (migration 9012) — `fn_mia_sinais_do_cartao`: a objeção aberta e
 * quem mandou a última mensagem, por contato, para o cartão do funil.
 *
 * O que se mede, cada um com controle:
 *
 *   1. a objeção é o retrato do ÚLTIMO checkpoint (o anterior não vaza), e um
 *      retrato vazio devolve lista vazia (a objeção foi respondida);
 *   2. quem mandou é a ÚLTIMA saída do contato — a mensagem que falhou não
 *      conta —, com `sent_via` e `sent_by_user_id`;
 *   3. `security invoker`: um membro da empresa A, pedindo contatos de A e de B,
 *      recebe só o de A; pedindo pela empresa B, não recebe nada;
 *   4. nem `anon` nem `PUBLIC` executam a função; `authenticated` executa.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test (LGPD).
 */

const ORG_A = "90129012-0000-4000-8000-00000000000a";
const ORG_B = "90129012-0000-4000-8000-00000000000b";
const MEMBRO_A = "90129012-1111-4000-8000-00000000000a";
const SESSAO_A = "90129012-2222-4000-8000-00000000000a";
const SESSAO_B = "90129012-2222-4000-8000-00000000000b";
const CONTATO_A = "90129012-3333-4000-8000-00000000000a";
const CONTATO_A_VAZIO = "90129012-3333-4000-8000-00000000000c";
const CONTATO_B = "90129012-3333-4000-8000-00000000000b";
const CONVERSA_A = "90129012-4444-4000-8000-00000000000a";
const CONVERSA_B = "90129012-4444-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_A}', 'mia-9012-a@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'mia-9012-a', 'MIA 9012 A', 'MIA 9012 A'),
      ('${ORG_B}', 'mia-9012-b', 'MIA 9012 B', 'MIA 9012 B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_A}', '${ORG_A}', 'agent', now()) on conflict do nothing;
    do $s$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
        ('${SESSAO_A}', '${ORG_A}', 'mia-9012-a', '\\x00'::bytea),
        ('${SESSAO_B}', '${ORG_B}', 'mia-9012-b', '\\x00'::bytea);
    exception when unique_violation then null; end $s$;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A}', '${ORG_A}', 'Contato 9012 A'),
      ('${CONTATO_A_VAZIO}', '${ORG_A}', 'Contato 9012 A vazio'),
      ('${CONTATO_B}', '${ORG_B}', 'Contato 9012 B')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA_A}', '${ORG_A}', '${CONTATO_A}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_B}', '${ORG_B}', '${CONTATO_B}', '${SESSAO_B}', 'open')
      on conflict do nothing;

    -- retratos da IA: o antigo tinha "preço"; o último, "parcela" e "distância".
    insert into public.lead_checkpoints (organization_id, contact_id, objections, created_at) values
      ('${ORG_A}', '${CONTATO_A}', '["preço"]', now() - interval '2 hours'),
      ('${ORG_A}', '${CONTATO_A}', '["distância", "parcela"]', now() - interval '1 hour'),
      ('${ORG_A}', '${CONTATO_A_VAZIO}', '["preço"]', now() - interval '2 hours'),
      ('${ORG_A}', '${CONTATO_A_VAZIO}', '[]', now() - interval '1 hour'),
      ('${ORG_B}', '${CONTATO_B}', '["segredo da B"]', now());

    -- mensagens de saída: a IA respondeu, depois uma pessoa; a mais nova falhou.
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_by_user_id, sent_at) values
      ('${ORG_A}', '${CONVERSA_A}', '${SESSAO_A}', '${CONTATO_A}', 'text', 'outbound', 'sent', 'a', 'ai', null, now() - interval '3 hours'),
      ('${ORG_A}', '${CONVERSA_A}', '${SESSAO_A}', '${CONTATO_A}', 'text', 'outbound', 'sent', 'b', 'crm', '${MEMBRO_A}', now() - interval '2 hours'),
      ('${ORG_A}', '${CONVERSA_A}', '${SESSAO_A}', '${CONTATO_A}', 'text', 'outbound', 'failed', 'c', 'ai', null, now() - interval '1 hour'),
      ('${ORG_A}', '${CONVERSA_A}', '${SESSAO_A}', '${CONTATO_A}', 'text', 'inbound', 'received', 'd', 'crm', null, now()),
      ('${ORG_B}', '${CONVERSA_B}', '${SESSAO_B}', '${CONTATO_B}', 'text', 'outbound', 'sent', 'e', 'ai', null, now());
  `);
});

function linhas(saida: string): string[][] {
  return saida
    .split("\n")
    .filter((l) => l.startsWith("L|"))
    .map((l) => l.slice(2).split("|"));
}

describe("fn_mia_sinais_do_cartao", () => {
  it("a objeção é o ÚLTIMO retrato, e quem mandou é a última saída que não falhou", () => {
    const r = linhas(
      sql(`
        select 'L|' || contact_id || '|' || coalesce(objecoes::text, '-') || '|' || coalesce(ultima_saida_via, '-') || '|' || coalesce(ultima_saida_por::text, '-')
          from public.fn_mia_sinais_do_cartao('${ORG_A}', array['${CONTATO_A}', '${CONTATO_A_VAZIO}']::uuid[])
         order by contact_id;
      `),
    );
    expect(r).toEqual([
      [CONTATO_A, '["distância", "parcela"]', "crm", MEMBRO_A],
      [CONTATO_A_VAZIO, "[]", "-", "-"],
    ]);
  });

  it("security invoker: o membro da empresa A não vê o contato da B, nem pedindo pela B", () => {
    const comoMembro = (org: string) =>
      linhas(
        sql(`
          set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${MEMBRO_A}"}', false);
          select 'L|' || contact_id from public.fn_mia_sinais_do_cartao('${org}', array['${CONTATO_A}', '${CONTATO_B}']::uuid[]);
        `),
      ).map((l) => l[0]);
    expect(comoMembro(ORG_A)).toEqual([CONTATO_A]);
    expect(comoMembro(ORG_B)).toEqual([]);
    // Controle: como dono (postgres, sem RLS), a B existe — o vazio acima é a RLS, não a falta de dado.
    expect(
      linhas(sql(`select 'L|' || contact_id from public.fn_mia_sinais_do_cartao('${ORG_B}', array['${CONTATO_B}']::uuid[]);`)),
    ).toEqual([[CONTATO_B]]);
  });

  it("anon e PUBLIC não executam; authenticated executa", () => {
    const privilegio = (papel: string) =>
      sql(
        `select has_function_privilege('${papel}', 'public.fn_mia_sinais_do_cartao(uuid, uuid[])', 'EXECUTE');`,
      );
    expect(privilegio("anon")).toBe("f");
    expect(privilegio("authenticated")).toBe("t");
    expect(
      sql(`
        select count(*) from pg_proc p, aclexplode(p.proacl) a
         where p.oid = 'public.fn_mia_sinais_do_cartao(uuid, uuid[])'::regprocedure and a.grantee = 0;
      `),
    ).toBe("0");
  });

  it("é security invoker e não escreve (stable)", () => {
    expect(
      sql(`
        select p.prosecdef::text || '|' || p.provolatile::text
          from pg_proc p where p.oid = 'public.fn_mia_sinais_do_cartao(uuid, uuid[])'::regprocedure;
      `),
    ).toBe("false|s");
  });
});

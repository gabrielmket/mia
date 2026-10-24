import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9050, 9051) — O ASSISTENTE DA MIA NO BANCO: quem vê o quê, o
 * chamado que nasce como a plataforma espera, a retenção e a LGPD.
 *
 * Contra o Postgres de verdade (o molde do baseline + baseline-mia), com o papel
 * `authenticated` e o JWT de cada pessoa, como o PostgREST faz:
 *
 *   - cada pessoa vê só o próprio histórico; o administrador vê só a PERGUNTA
 *     marcada sem resposta (nunca a resposta); outra empresa vê zero; anon nada;
 *   - pela sessão, ninguém apaga o histórico nem reescreve o texto (o limite do
 *     dia conta as perguntas) e ninguém grava resumo da manhã ou resposta da Time;
 *   - a configuração é só leitura pela sessão; a base própria, só o administrador;
 *   - o chamado nasce da própria pessoa, "novo", sem resposta e sem print, e a
 *     marca de demonstração vem da EMPRESA (o pedido não decide);
 *   - a retenção apaga o vencido e deixa o recente; o print sai para a fila;
 *   - anonimizar o contato apaga o texto das mensagens que o citam, e só delas;
 *   - (9052) a lista `contatos` vira o índice `mia_assistente_citacoes`, por
 *     igualdade, que o acesso do titular lê; só o servidor o lê.
 */

const ORG_A = "90509050-0000-4000-8000-00000000000a";
const ORG_B = "90509050-0000-4000-8000-00000000000b";
const ORG_D = "90509050-0000-4000-8000-00000000000d";
const ADMIN_A = "90509050-1111-4000-8000-0000000000a1";
const AT1 = "90509050-1111-4000-8000-0000000000a2";
const AT2 = "90509050-1111-4000-8000-0000000000a3";
const ADMIN_B = "90509050-1111-4000-8000-0000000000b1";
const USR_D = "90509050-1111-4000-8000-0000000000d1";
const CONV_AT1 = "90509050-2222-4000-8000-000000000001";
const MSG_PERGUNTA_SEM = "90509050-3333-4000-8000-000000000001";
const MSG_RESPOSTA = "90509050-3333-4000-8000-000000000002";
const MSG_PERGUNTA_OK = "90509050-3333-4000-8000-000000000003";
const TITULAR = "90509050-4444-4000-8000-000000000001";
const VIZINHO = "90509050-4444-4000-8000-000000000002";

/** Uma escrita como `usuario` (`anon` ou o uuid de alguém): `n:<linhas>` ou o SQLSTATE. */
function executar(usuario: string, dml: string): string {
  const papel = usuario === "anon" ? "anon" : "authenticated";
  const claims = papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);` : "";
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
          perform set_config('inv.r9050', 'n:' || n, false);
        exception when others then
          perform set_config('inv.r9050', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9050');
    `),
  );
}

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

beforeAll(() => {
  // Sem PII real: nomes e telefones sintéticos (LGPD).
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'assistente-admin-a@invariant.test'),
      ('${AT1}', 'assistente-at1@invariant.test'),
      ('${AT2}', 'assistente-at2@invariant.test'),
      ('${ADMIN_B}', 'assistente-admin-b@invariant.test'),
      ('${USR_D}', 'assistente-usr-d@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'assistente-9050-a', 'Assistente A', 'Assistente A'),
      ('${ORG_B}', 'assistente-9050-b', 'Assistente B', 'Assistente B'),
      ('${ORG_D}', 'assistente-9050-d', 'Assistente Demo', 'Assistente Demo')
      on conflict (id) do nothing;
    update public.organizations set demonstracao = true where id = '${ORG_D}';
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${AT1}', '${ORG_A}', 'agent', now()),
      ('${AT2}', '${ORG_A}', 'agent', now()),
      ('${ADMIN_B}', '${ORG_B}', 'admin', now()),
      ('${USR_D}', '${ORG_D}', 'agent', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${TITULAR}', '${ORG_A}', 'Titular Sintético', '+5500000009051'),
      ('${VIZINHO}', '${ORG_A}', 'Vizinho Sintético', '+5500000009052');
    insert into public.mia_assistente_conversas (id, organization_id, user_id, titulo) values
      ('${CONV_AT1}', '${ORG_A}', '${AT1}', 'Por que a IA não respondeu?');
    insert into public.mia_assistente_mensagens (id, organization_id, conversa_id, user_id, tipo, texto, sem_resposta, contatos) values
      ('${MSG_PERGUNTA_SEM}', '${ORG_A}', '${CONV_AT1}', '${AT1}', 'pergunta', 'Dá para mandar PDF?', true, '{}'),
      ('${MSG_RESPOSTA}', '${ORG_A}', '${CONV_AT1}', '${AT1}', 'resposta', 'A Titular Sintético espera desde as 18h.', false, '{${TITULAR}}'),
      ('${MSG_PERGUNTA_OK}', '${ORG_A}', '${CONV_AT1}', '${AT1}', 'pergunta', 'E o Vizinho Sintético?', false, '{${VIZINHO}}');
  `);
});

describe("9050 · o histórico: cada pessoa vê o seu; o administrador, só a pergunta sem resposta", () => {
  it("quem perguntou vê as três mensagens da conversa (controle positivo)", () => {
    expect(countAs(AT1, `select count(*) from public.mia_assistente_mensagens where conversa_id = '${CONV_AT1}';`)).toBe(3);
    expect(countAs(AT1, `select count(*) from public.mia_assistente_conversas where id = '${CONV_AT1}';`)).toBe(1);
  });

  it("outra pessoa da MESMA empresa não vê nada da conversa", () => {
    expect(countAs(AT2, `select count(*) from public.mia_assistente_mensagens where conversa_id = '${CONV_AT1}';`)).toBe(0);
    expect(countAs(AT2, `select count(*) from public.mia_assistente_conversas where id = '${CONV_AT1}';`)).toBe(0);
  });

  it("o administrador vê SÓ a pergunta sem resposta: nem a resposta, nem a outra pergunta, nem a conversa", () => {
    expect(countAs(ADMIN_A, `select count(*) from public.mia_assistente_mensagens where id = '${MSG_PERGUNTA_SEM}';`)).toBe(1);
    expect(
      countAs(ADMIN_A, `select count(*) from public.mia_assistente_mensagens where id in ('${MSG_RESPOSTA}', '${MSG_PERGUNTA_OK}');`),
    ).toBe(0);
    expect(countAs(ADMIN_A, `select count(*) from public.mia_assistente_conversas where id = '${CONV_AT1}';`)).toBe(0);
  });

  it("outra empresa vê zero, mesmo o administrador dela", () => {
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_mensagens where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("anon não lê nenhuma tabela do assistente", () => {
    for (const tabela of [
      "mia_assistente_citacoes",
      "mia_assistente_config",
      "mia_assistente_conhecimento",
      "mia_assistente_conversas",
      "mia_assistente_mensagens",
      "mia_assistente_preferencias",
      "mia_chamados",
    ]) {
      expect(executar("anon", `perform 1 from public.${tabela} limit 1`), tabela).toBe("42501");
    }
  });
});

describe("9052 · as citações: o índice da lista de contatos, só do servidor", () => {
  it("cada contato da lista vira uma citação, pelo gatilho", () => {
    expect(valor(`select count(*) from public.mia_assistente_citacoes where mensagem_id = '${MSG_RESPOSTA}' and contact_id = '${TITULAR}';`)).toBe("1");
    expect(valor(`select count(*) from public.mia_assistente_citacoes where mensagem_id = '${MSG_PERGUNTA_OK}' and contact_id = '${VIZINHO}';`)).toBe("1");
  });

  it("mudar a lista muda as citações; um id de outra empresa não vira linha", () => {
    sql(`update public.mia_assistente_mensagens set contatos = '{${VIZINHO},90509050-4444-4000-8000-0000000000ff}' where id = '${MSG_PERGUNTA_SEM}';`);
    expect(valor(`select count(*) from public.mia_assistente_citacoes where mensagem_id = '${MSG_PERGUNTA_SEM}';`)).toBe("1");
    sql(`update public.mia_assistente_mensagens set contatos = '{}' where id = '${MSG_PERGUNTA_SEM}';`);
    expect(valor(`select count(*) from public.mia_assistente_citacoes where mensagem_id = '${MSG_PERGUNTA_SEM}';`)).toBe("0");
  });

  it("a sessão não lê as citações, nem quem perguntou", () => {
    expect(executar(AT1, `perform 1 from public.mia_assistente_citacoes limit 1`)).toBe("42501");
  });
});

describe("9050 · pela sessão ninguém apaga nem reescreve o histórico", () => {
  it("a pessoa grava a própria pergunta (controle positivo) e não grava em conversa de outra", () => {
    expect(
      executar(
        AT1,
        `insert into public.mia_assistente_mensagens (organization_id, conversa_id, user_id, tipo, texto)
         values ('${ORG_A}', '${CONV_AT1}', '${AT1}', 'pergunta', 'Como estão meus leads?')`,
      ),
    ).toBe("n:1");
    expect(
      executar(
        AT2,
        `insert into public.mia_assistente_mensagens (organization_id, conversa_id, user_id, tipo, texto)
         values ('${ORG_A}', '${CONV_AT1}', '${AT2}', 'pergunta', 'intrusa')`,
      ),
    ).toBe("42501");
  });

  it("resumo da manhã e resposta da Time não nascem pela sessão", () => {
    for (const tipo of ["resumo_da_manha", "resposta_do_chamado"]) {
      expect(
        executar(
          AT1,
          `insert into public.mia_assistente_mensagens (organization_id, conversa_id, user_id, tipo, texto)
           values ('${ORG_A}', '${CONV_AT1}', '${AT1}', '${tipo}', 'forjado')`,
        ),
        tipo,
      ).toBe("42501");
    }
  });

  it("apagar a própria pergunta é recusado (o limite do dia conta as perguntas)", () => {
    expect(executar(AT1, `delete from public.mia_assistente_mensagens where id = '${MSG_PERGUNTA_OK}'`)).toBe("42501");
  });

  it("marcar sem resposta passa; reescrever o texto, não", () => {
    expect(executar(AT1, `update public.mia_assistente_mensagens set sem_resposta = true where id = '${MSG_PERGUNTA_OK}'`)).toBe("n:1");
    expect(executar(AT1, `update public.mia_assistente_mensagens set texto = 'outro' where id = '${MSG_PERGUNTA_OK}'`)).toBe("42501");
    sql(`update public.mia_assistente_mensagens set sem_resposta = false where id = '${MSG_PERGUNTA_OK}';`);
  });
});

describe("9050 · a configuração e a base própria", () => {
  it("a configuração é só leitura pela sessão, até para o administrador", () => {
    sql(`insert into public.mia_assistente_config (organization_id, perguntas_por_pessoa_por_dia) values ('${ORG_A}', 50) on conflict do nothing;`);
    expect(countAs(AT1, `select count(*) from public.mia_assistente_config where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_config where organization_id = '${ORG_A}';`)).toBe(0);
    expect(
      executar(ADMIN_A, `update public.mia_assistente_config set perguntas_por_pessoa_por_dia = 1000 where organization_id = '${ORG_A}'`),
    ).toBe("42501");
  });

  it("a base própria: o administrador escreve, o atendente lê e não escreve", () => {
    expect(
      executar(
        ADMIN_A,
        `insert into public.mia_assistente_conhecimento (organization_id, titulo, texto)
         values ('${ORG_A}', 'Aprovação', 'Acima de R$ 10 mil passa pela gestora.')`,
      ),
    ).toBe("n:1");
    expect(
      executar(
        AT1,
        `insert into public.mia_assistente_conhecimento (organization_id, titulo, texto) values ('${ORG_A}', 'Atalho', 'x')`,
      ),
    ).toBe("42501");
    expect(countAs(AT1, `select count(*) from public.mia_assistente_conhecimento where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_conhecimento where organization_id = '${ORG_A}';`)).toBe(0);
  });
});

describe("9050 · o chamado nasce como a plataforma espera", () => {
  it("o pedido não escolhe autor, situação, resposta, número nem print", () => {
    expect(
      executar(
        AT1,
        `insert into public.mia_chamados (organization_id, user_id, tipo, texto, situacao, resposta, numero, print_path, demonstracao)
         values ('${ORG_A}', '${AT2}', 'erro', 'O botão de salvar não funciona.', 'resolvido', 'forjada', 1, '${ORG_A}/x/y.png', true)`,
      ),
    ).toBe("n:1");
    const linha = valor(
      `select user_id || '|' || situacao || '|' || coalesce(resposta, '<nulo>') || '|' || (numero > 1000)::text || '|' ||
              coalesce(print_path, '<nulo>') || '|' || demonstracao::text
         from public.mia_chamados where organization_id = '${ORG_A}' and texto = 'O botão de salvar não funciona.';`,
    );
    expect(linha).toBe(`${AT1}|novo|<nulo>|true|<nulo>|false`);
  });

  it("na empresa de demonstração, a marca vem da empresa: o chamado não sai", () => {
    expect(
      executar(USR_D, `insert into public.mia_chamados (organization_id, tipo, texto) values ('${ORG_D}', 'pedido', 'Pedido da demonstração.')`),
    ).toBe("n:1");
    expect(valor(`select demonstracao::text from public.mia_chamados where organization_id = '${ORG_D}';`)).toBe("true");
  });

  it("quem abriu e o administrador da empresa leem; o colega e a outra empresa não", () => {
    const q = `select count(*) from public.mia_chamados where organization_id = '${ORG_A}';`;
    expect(countAs(AT1, q)).toBe(1);
    expect(countAs(ADMIN_A, q)).toBe(1);
    expect(countAs(AT2, q)).toBe(0);
    expect(countAs(ADMIN_B, q)).toBe(0);
  });

  it("responder é da plataforma: a sessão não altera o chamado", () => {
    expect(executar(ADMIN_A, `update public.mia_chamados set situacao = 'resolvido' where organization_id = '${ORG_A}'`)).toBe("42501");
  });
});

describe("9051 · a retenção do assistente", () => {
  it("apaga a mensagem vencida e a conversa que ficou vazia; o recente fica; o print do chamado vencido vai para a fila", () => {
    sql(`
      insert into public.mia_assistente_conversas (id, organization_id, user_id, titulo, created_at, ultima_em) values
        ('90509050-2222-4000-8000-0000000000aa', '${ORG_A}', '${AT2}', 'Antiga', now() - interval '120 days', now() - interval '120 days');
      insert into public.mia_assistente_mensagens (organization_id, conversa_id, user_id, tipo, texto, created_at) values
        ('${ORG_A}', '90509050-2222-4000-8000-0000000000aa', '${AT2}', 'pergunta', 'antiga', now() - interval '120 days');
      insert into public.mia_chamados (organization_id, user_id, tipo, texto, situacao, respondido_em, print_path) values
        ('${ORG_B}', '${ADMIN_B}', 'duvida', 'Chamado de um ano atrás.', 'resolvido', now() - interval '400 days', '${ORG_B}/velho/print.png');
    `);
    const r = JSON.parse(valor(`select public.fn_mia_expurgar_assistente_vencido(90, 5000)::text;`)) as Record<string, number>;
    expect(r.mensagens).toBeGreaterThanOrEqual(1);
    expect(r.chamados).toBeGreaterThanOrEqual(1);
    expect(valor(`select count(*) from public.mia_assistente_conversas where id = '90509050-2222-4000-8000-0000000000aa';`)).toBe("0");
    expect(valor(`select count(*) from public.mia_assistente_mensagens where conversa_id = '${CONV_AT1}';`)).toBe("4");
    expect(
      valor(`select count(*) from public.storage_redaction_queue where bucket = 'mia-assistente' and object_path = '${ORG_B}/velho/print.png';`),
    ).toBe("1");
  });

  it("o piso de 30 dias vale mesmo pedindo menos", () => {
    sql(`
      insert into public.mia_assistente_mensagens (organization_id, conversa_id, user_id, tipo, texto, created_at) values
        ('${ORG_A}', '${CONV_AT1}', '${AT1}', 'pergunta', 'de dez dias', now() - interval '10 days');
    `);
    sql(`select public.fn_mia_expurgar_assistente_vencido(1, 5000);`);
    expect(valor(`select count(*) from public.mia_assistente_mensagens where texto = 'de dez dias';`)).toBe("1");
  });

  it("só o servidor executa a retenção", () => {
    expect(executar(ADMIN_A, `perform public.fn_mia_expurgar_assistente_vencido(90, 10)`)).toBe("42501");
  });
});

describe("9050 e 9051 · as migrations são idempotentes", () => {
  it("aplicar as duas migrations duas vezes por cima do baseline não dá erro nem duplica", () => {
    const pasta = path.resolve(__dirname, "../../supabase/migrations-mia");
    for (const nome of [
      "20261024200000_9050_assistente_da_mia.sql",
      "20261024200100_9051_assistente_na_lgpd_e_na_retencao.sql",
      "20261024230000_9052_citacoes_do_assistente_por_igualdade.sql",
    ]) {
      const migration = readFileSync(path.join(pasta, nome), "utf8");
      sql(migration);
      sql(migration);
    }
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_mensagens' and policyname like 'mia_%';`)).toBe("4");
    expect(valor(`select count(*) from storage.buckets where id = 'mia-assistente';`)).toBe("1");
    // A cura da 9051 não estraga o que já foi curado.
    expect(valor(`select count(*) from public.mia_assistente_mensagens where id = '${MSG_PERGUNTA_OK}';`)).toBe("1");
  });
});

describe("9051 · anonimizar o contato alcança o histórico do assistente", () => {
  it("a mensagem que cita o titular perde o texto; a que cita outro contato fica", () => {
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${TITULAR}', gen_random_uuid());`);
    const depois = valor(
      `select texto || '|' || (array_length(contatos, 1) is null)::text from public.mia_assistente_mensagens where id = '${MSG_RESPOSTA}';`,
    );
    expect(depois).toBe("Conteúdo removido: um contato citado aqui foi anonimizado.|true");
    // (9052) a citação do titular sai junto; a do vizinho fica.
    expect(valor(`select count(*) from public.mia_assistente_citacoes where contact_id = '${TITULAR}';`)).toBe("0");
    expect(valor(`select count(*) from public.mia_assistente_citacoes where contact_id = '${VIZINHO}';`)).toBe("1");
    expect(valor(`select texto from public.mia_assistente_mensagens where id = '${MSG_PERGUNTA_OK}';`)).toBe("E o Vizinho Sintético?");
  });
});

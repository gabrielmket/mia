import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * FORK MIA (.89, migrations 9060 a 9065) — O DISPARO DE E-MAIL MARKETING NO BANCO.
 *
 * O que se prova com o baseline e o baseline-mia aplicados:
 *
 *   1. ISOLAMENTO: as treze tabelas novas, nos dois sentidos, e por papel (o
 *      consentimento é lido por atendente; o resto, por gestor). É a prova que
 *      `rls-completude-varredura` exige (`PROVA_PROPRIA`).
 *   2. SÓ O SERVIDOR GRAVA: `authenticated` não insere nem altera nada, nem na
 *      própria empresa; as funções do motor não são dele.
 *   3. A DEMONSTRAÇÃO NÃO ENVIA: campanha agendada ou enviando e teste são
 *      recusados no banco (42501), com o controle na empresa de verdade.
 *   4. A SUPRESSÃO DE E-MAIL SÓ ACRESCENTA: ninguém apaga nem troca o endereço;
 *      só a própria pessoa volta (`fn_mia_email_voltar_a_receber`), e nunca
 *      depois de rejeição; a exclusão da empresa leva tudo.
 *   5. LGPD: anonimizar o contato apaga o endereço legível do envio e a origem e
 *      a evidência do consentimento; o hash e o veto da supressão ficam.
 *   6. O DÉBITO: por lote terminado, uma vez só (idempotente), e o lote que ainda
 *      tem e-mail saindo não é cobrado.
 *   7. A REIVINDICAÇÃO do worker marca os pendentes como "enviando", no lote.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test.
 */

const ORG_A = "90609060-0000-4000-8000-00000000000a";
const ORG_B = "90609060-0000-4000-8000-00000000000b";
const DEMO = "90609060-0000-4000-8000-00000000000d";
const ORG_C = "90609060-0000-4000-8000-00000000000c";

const AGENTE_A = "90609060-1111-4000-8000-000000000001";
const GESTOR_A = "90609060-1111-4000-8000-000000000002";
const GESTOR_B = "90609060-1111-4000-8000-000000000003";

const CONTATO_A = "90609060-3333-4000-8000-00000000000a";
const CONTATO_B = "90609060-3333-4000-8000-00000000000b";
const REMETENTE = (o: string) => `90609060-4444-4000-8000-0000000000${o}`;
const SEGMENTO = (o: string) => `90609060-5555-4000-8000-0000000000${o}`;
const CAMPANHA = (o: string) => `90609060-6666-4000-8000-0000000000${o}`;
const DEST = (o: string) => `90609060-7777-4000-8000-0000000000${o}`;
const LINK = (o: string) => `90609060-8888-4000-8000-0000000000${o}`;

const TABELAS = [
  "mia_email_config",
  "mia_email_dominios",
  "mia_email_remetentes",
  "mia_email_textos_de_consentimento",
  "mia_email_consentimentos",
  "mia_segmentos",
  "mia_email_modelos",
  "mia_email_campanhas",
  "mia_email_testes",
  "mia_email_destinatarios",
  "mia_email_links",
  "mia_email_cliques",
  "mia_email_eventos",
] as const;

const DO_ATENDENTE = new Set(["mia_email_textos_de_consentimento", "mia_email_consentimentos"]);

function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/** Roda o script numa transação desfeita; a consulta final devolve `'M:' || valor`. */
function medir(script: string): string {
  return linhaMarcada(sql(`begin;\n${script}\nrollback;`), "M:");
}

/**
 * O mesmo, com várias marcas. Cada medida num comando PRÓPRIO: dentro de um
 * comando só, a subconsulta enxerga a foto do começo dele, e o efeito de uma
 * função chamada ali mesmo não aparece.
 */
function medirVarios(script: string, marcas: readonly string[]): string {
  const saida = sql(`begin;\n${script}\nrollback;`);
  return marcas.map((m) => linhaMarcada(saida, m)).join("/");
}

/** Os campos que a confirmação grava: sem eles, campanha fora do rascunho viola a 9062. */
const CONFIRMADA = `confirmada_por = '90609060-1111-4000-8000-000000000002', confirmada_em = now(), declaracao_base_legal = 'Declarado no teste.'`;

const comoCliente = (usuario: string) => `
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', true);
`;

/** Roda `dml` numa transação desfeita e devolve o SQLSTATE, `"passou"` ou `"0 linhas"`. */
function tentar(dml: string, antes = ""): string {
  const saida = sql(`
    begin;
    ${antes}
    do $$
    declare n int;
    begin
      begin
        with w as (${dml} returning 1) select count(*) into n from w;
        perform set_config('inv.r', case when n = 0 then '0 linhas' else 'passou' end, true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    reset role;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

/** Chama uma função numa transação desfeita e devolve o SQLSTATE do erro ou `"passou"`. */
function chamar(chamada: string, antes = ""): string {
  const saida = sql(`
    begin;
    ${antes}
    do $$
    begin
      begin
        perform ${chamada};
        perform set_config('inv.r', 'passou', true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    reset role;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

/** A semente de uma empresa: uma linha em cada uma das treze tabelas. */
function semente(org: string, o: string, contato: string): string {
  return `
    insert into public.mia_email_config (organization_id, rodape_razao_social) values ('${org}', 'Empresa ${o} 9060') on conflict do nothing;
    insert into public.mia_email_dominios (organization_id, dominio) values ('${org}', 'envio-${o}.invariant.test') on conflict do nothing;
    insert into public.mia_email_remetentes (id, organization_id, nome_exibicao, local, padrao) values ('${REMETENTE(o)}', '${org}', 'Equipe ${o}', 'contato', true) on conflict do nothing;
    insert into public.mia_email_textos_de_consentimento (organization_id, versao, texto) values ('${org}', 'v-${o}', 'Quero receber.') on conflict do nothing;
    insert into public.mia_email_consentimentos (organization_id, contact_id, email_hash, tipo, ocorrido_em, origem, texto_aceito, evidencia, registrado_pelo)
      values ('${org}', '${contato}', 'hash-${o}', 'aceite', now(), 'Formulário do site', 'Quero receber.', 'protocolo 1', 'ficha');
    insert into public.mia_segmentos (id, organization_id, nome, recorte) values ('${SEGMENTO(o)}', '${org}', 'Clientes ${o}', '{"com_alguma_tag":["cliente"]}') on conflict do nothing;
    insert into public.mia_email_modelos (organization_id, chave, nome) values ('${org}', 'novidades-${o}', 'Novidades') on conflict do nothing;
    insert into public.mia_email_campanhas (id, organization_id, nome, assunto) values ('${CAMPANHA(o)}', '${org}', 'Campanha ${o}', 'Oi') on conflict do nothing;
    insert into public.mia_email_testes (organization_id, campanha_id, versao, para) values ('${org}', '${CAMPANHA(o)}', 1, array['equipe-${o}@invariant.test']);
    insert into public.mia_email_destinatarios (id, organization_id, campanha_id, contact_id, email, email_hash, status, ses_message_id)
      values ('${DEST(o)}', '${org}', '${CAMPANHA(o)}', '${contato}', 'pessoa-${o}@invariant.test', 'hash-${o}', 'entregue', 'ses-9060-${o}') on conflict do nothing;
    insert into public.mia_email_links (id, organization_id, campanha_id, ordem, url) values ('${LINK(o)}', '${org}', '${CAMPANHA(o)}', 0, 'https://invariant.test/${o}') on conflict do nothing;
    insert into public.mia_email_cliques (organization_id, destinatario_id, link_id) values ('${org}', '${DEST(o)}', '${LINK(o)}');
    insert into public.mia_email_eventos (organization_id, destinatario_id, tipo, aviso_id, ocorrido_em) values ('${org}', '${DEST(o)}', 'entrega', 'aviso-9060-${o}', now()) on conflict do nothing;
  `;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${AGENTE_A}', 'mia-9060-agente-a@invariant.test'),
      ('${GESTOR_A}', 'mia-9060-gestor-a@invariant.test'),
      ('${GESTOR_B}', 'mia-9060-gestor-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, demonstracao) values
      ('${ORG_A}', 'mia-9060-a', 'MIA 9060 A', 'MIA 9060 A', false),
      ('${ORG_B}', 'mia-9060-b', 'MIA 9060 B', 'MIA 9060 B', false),
      ('${DEMO}', 'mia-9060-demo', 'MIA 9060 Demo', 'MIA 9060 Demo', true)
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENTE_A}', '${ORG_A}', 'agent', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${GESTOR_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name, email) values
      ('${CONTATO_A}', '${ORG_A}', 'Contato 9060 A', 'pessoa-a@invariant.test'),
      ('${CONTATO_B}', '${ORG_B}', 'Contato 9060 B', 'pessoa-b@invariant.test')
      on conflict (id) do nothing;
    ${semente(ORG_A, "0a", CONTATO_A)}
    ${semente(ORG_B, "0b", CONTATO_B)}
  `);
});

describe("isolamento: as treze tabelas, nos dois sentidos", () => {
  it("a semente existe nas duas empresas (sem isto, zero do vizinho não prova nada)", () => {
    for (const tabela of TABELAS) {
      expect(
        sql(
          `select count(distinct organization_id) from public.${tabela} where organization_id in ('${ORG_A}','${ORG_B}');`,
        ),
        tabela,
      ).toBe("2");
    }
  });

  for (const tabela of TABELAS) {
    it(`${tabela}: A lê as próprias e ZERO de B, e B o mesmo ao contrário`, () => {
      expect(
        countAs(
          GESTOR_A,
          `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        countAs(
          GESTOR_A,
          `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`,
        ),
      ).toBe(0);
      expect(
        countAs(
          GESTOR_B,
          `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`,
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        countAs(
          GESTOR_B,
          `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
        ),
      ).toBe(0);
      expect(
        countAs(
          GESTOR_A,
          `select count(*) from public.${tabela} where organization_id <> '${ORG_A}';`,
        ),
      ).toBe(0);
    });

    it(`${tabela}: quem não entrou não lê nada`, () => {
      expect(() => sql(`set role anon; select count(*) from public.${tabela};`)).toThrow(
        /permission denied/,
      );
    });

    it(`${tabela}: o papel decide (${DO_ATENDENTE.has(tabela) ? "atendente lê" : "atendente não lê; é de gestor"})`, () => {
      const viu = countAs(
        AGENTE_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
      );
      if (DO_ATENDENTE.has(tabela)) expect(viu).toBeGreaterThanOrEqual(1);
      else expect(viu).toBe(0);
    });
  }
});

describe("só o servidor grava", () => {
  it("⭐ authenticated não insere nem altera, nem na própria empresa, nem como gestor", () => {
    const antes = comoCliente(GESTOR_A);
    expect(
      tentar(
        `insert into public.mia_email_campanhas (organization_id, nome) values ('${ORG_A}', 'Intrusa')`,
        antes,
      ),
    ).toBe("42501");
    expect(
      tentar(
        `update public.mia_email_campanhas set status = 'enviando' where organization_id = '${ORG_A}'`,
        antes,
      ),
    ).toBe("42501");
    expect(
      tentar(
        `insert into public.mia_email_consentimentos (organization_id, email_hash, tipo, ocorrido_em, registrado_pelo) values ('${ORG_A}', 'x', 'aceite', now(), 'ficha')`,
        antes,
      ),
    ).toBe("42501");
    expect(
      tentar(
        `delete from public.mia_email_destinatarios where organization_id = '${ORG_A}'`,
        antes,
      ),
    ).toBe("42501");
  });

  it("as funções do motor não são de quem está logado", () => {
    const antes = comoCliente(GESTOR_A);
    expect(chamar(`public.fn_mia_email_cobrar('${CAMPANHA("0a")}')`, antes)).toBe("42501");
    expect(
      chamar(`public.fn_mia_email_reivindicar('${CAMPANHA("0a")}', gen_random_uuid(), 10)`, antes),
    ).toBe("42501");
    expect(chamar(`public.fn_mia_email_voltar_a_receber('${ORG_A}', 'hash-0a')`, antes)).toBe(
      "42501",
    );
  });
});

describe("a demonstração não envia", () => {
  it("⭐ campanha agendada ou enviando e teste são recusados (42501); o rascunho pode", () => {
    expect(
      tentar(
        `insert into public.mia_email_campanhas (organization_id, nome) values ('${DEMO}', 'Rascunho de venda')`,
      ),
    ).toBe("passou");
    expect(
      tentar(
        `insert into public.mia_email_campanhas (organization_id, nome, status, confirmada_por, confirmada_em, declaracao_base_legal) values ('${DEMO}', 'Saindo', 'agendada', '${GESTOR_A}', now(), 'Declarado no teste.')`,
      ),
    ).toBe("42501");
    expect(
      medir(`
        insert into public.mia_email_campanhas (id, organization_id, nome) values ('90609060-6666-4000-8000-0000000000dd', '${DEMO}', 'Rascunho');
        do $$ begin
          begin
            update public.mia_email_campanhas set status = 'enviando', ${CONFIRMADA} where id = '90609060-6666-4000-8000-0000000000dd';
            perform set_config('inv.r', 'passou', true);
          exception when others then perform set_config('inv.r', sqlstate, true);
          end;
        end $$;
        select 'M:' || current_setting('inv.r');
      `),
    ).toBe("42501");
    expect(
      medir(`
        insert into public.mia_email_campanhas (id, organization_id, nome) values ('90609060-6666-4000-8000-0000000000de', '${DEMO}', 'Rascunho');
        do $$ begin
          begin
            insert into public.mia_email_testes (organization_id, campanha_id, versao, para) values ('${DEMO}', '90609060-6666-4000-8000-0000000000de', 1, array['x@invariant.test']);
            perform set_config('inv.r', 'passou', true);
          exception when others then perform set_config('inv.r', sqlstate, true);
          end;
        end $$;
        select 'M:' || current_setting('inv.r');
      `),
    ).toBe("42501");
  });

  it("controle: na empresa de verdade, agendar e testar passam", () => {
    expect(
      tentar(
        `update public.mia_email_campanhas set status = 'agendada', ${CONFIRMADA} where id = '${CAMPANHA("0a")}'`,
      ),
    ).toBe("passou");
    expect(
      tentar(
        `insert into public.mia_email_testes (organization_id, campanha_id, versao, para) values ('${ORG_A}', '${CAMPANHA("0a")}', 1, array['x@invariant.test'])`,
      ),
    ).toBe("passou");
  });
});

describe("a supressão de e-mail só acrescenta", () => {
  const supressao = (org: string, hash: string, motivo: string, tipo = "email") =>
    `insert into public.campaign_suppressions (organization_id, recipient_address_hash, tipo_de_endereco, motivo, source) values ('${org}', '${hash}', '${tipo}', ${motivo === "null" ? "null" : `'${motivo}'`}, 'sistema');`;

  it("⭐ ninguém apaga o endereço de e-mail da lista, nem troca o hash; a linha de telefone segue como era", () => {
    expect(
      tentar(
        `delete from public.campaign_suppressions where recipient_address_hash = 'h-apagar'`,
        supressao(ORG_A, "h-apagar", "descadastro"),
      ),
    ).toBe("42501");
    expect(
      tentar(
        `update public.campaign_suppressions set recipient_address_hash = 'outro' where recipient_address_hash = 'h-trocar'`,
        supressao(ORG_A, "h-trocar", "descadastro"),
      ),
    ).toBe("42501");
    expect(
      tentar(
        `delete from public.campaign_suppressions where recipient_address_hash = 'h-telefone'`,
        supressao(ORG_A, "h-telefone", "null", "telefone"),
      ),
    ).toBe("passou");
    // Soltar o contato e a cauda (o que a anonimização do upstream faz) continua livre.
    expect(
      tentar(
        `update public.campaign_suppressions set address_tail = null, reason = null where recipient_address_hash = 'h-soltar'`,
        supressao(ORG_A, "h-soltar", "descadastro"),
      ),
    ).toBe("passou");
  });

  it("só a própria pessoa volta (pela função), e rejeição não volta", () => {
    expect(
      medirVarios(
        `
        ${supressao(ORG_A, "h-volta", "descadastro")}
        ${supressao(ORG_A, "h-rejeitado", "rejeicao")}
        select 'A:' || public.fn_mia_email_voltar_a_receber('${ORG_A}', 'h-volta');
        select 'B:' || public.fn_mia_email_voltar_a_receber('${ORG_A}', 'h-rejeitado');
        select 'C:' || (select string_agg(recipient_address_hash, ',') from public.campaign_suppressions
          where organization_id = '${ORG_A}' and recipient_address_hash in ('h-volta', 'h-rejeitado'));
      `,
        ["A:", "B:", "C:"],
      ),
    ).toBe("1/0/h-rejeitado");
  });

  it("a exclusão da empresa leva a lista junto (cascata)", () => {
    expect(
      medir(`
        insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_C}', 'mia-9060-c', 'MIA 9060 C', 'MIA 9060 C');
        ${supressao(ORG_C, "h-da-empresa", "descadastro")}
        delete from public.organizations where id = '${ORG_C}';
        select 'M:' || (select count(*) from public.campaign_suppressions where organization_id = '${ORG_C}');
      `),
    ).toBe("0");
  });
});

describe("LGPD: anonimizar apaga o legível e mantém o veto", () => {
  it("⭐ o envio perde o endereço e o contato, o consentimento perde origem e evidência, e o hash e a supressão ficam", () => {
    const r = medir(`
      insert into public.campaign_suppressions (organization_id, contact_id, recipient_address_hash, tipo_de_endereco, motivo, source, address_tail)
        values ('${ORG_A}', '${CONTATO_A}', 'hash-0a', 'email', 'descadastro', 'sistema', 'p***@invariant.test')
        on conflict do nothing;
      update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CONTATO_A}';
      select 'M:' ||
        (select coalesce(email, '∅') || ',' || coalesce(contact_id::text, '∅') || ',' || email_hash from public.mia_email_destinatarios where id = '${DEST("0a")}') || '|' ||
        (select coalesce(origem, '∅') || ',' || coalesce(evidencia, '∅') || ',' || coalesce(texto_aceito, '∅') || ',' || coalesce(contact_id::text, '∅') || ',' || email_hash
           from public.mia_email_consentimentos where organization_id = '${ORG_A}' and email_hash = 'hash-0a' limit 1) || '|' ||
        (select count(*) from public.campaign_suppressions where organization_id = '${ORG_A}' and recipient_address_hash = 'hash-0a');
    `);
    expect(r).toBe("∅,∅,hash-0a|∅,∅,∅,∅,hash-0a|1");
  });

  it("controle: o contato de outra empresa não é tocado", () => {
    const r = medir(`
      update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CONTATO_A}';
      select 'M:' || (select coalesce(email, '∅') from public.mia_email_destinatarios where id = '${DEST("0b")}');
    `);
    expect(r).toBe("pessoa-0b@invariant.test");
  });
});

describe("o débito por lote e a reivindicação do worker", () => {
  const LOTE_1 = "90609060-9999-4000-8000-000000000001";
  const LOTE_2 = "90609060-9999-4000-8000-000000000002";
  const C = "90609060-6666-4000-8000-0000000000c1";
  const montar = `
    insert into public.mia_email_campanhas (id, organization_id, nome) values ('${C}', '${ORG_A}', 'Cobrança 9060');
    insert into public.mia_email_destinatarios (organization_id, campanha_id, email_hash, status, lote_id, ses_message_id, cobrado_cents) values
      ('${ORG_A}', '${C}', 'c-1', 'enviado', '${LOTE_1}', 'ses-c-1', 2),
      ('${ORG_A}', '${C}', 'c-2', 'rejeitado', '${LOTE_1}', 'ses-c-2', 2),
      ('${ORG_A}', '${C}', 'c-3', 'falhou', '${LOTE_1}', null, 2),
      ('${ORG_A}', '${C}', 'c-4', 'enviado', '${LOTE_2}', 'ses-c-4', 2),
      ('${ORG_A}', '${C}', 'c-5', 'enviando', '${LOTE_2}', null, 2);
  `;

  it("⭐ cobra o lote terminado pelo que a Amazon aceitou, uma vez só; o lote com e-mail saindo espera", () => {
    const r = medirVarios(
      `
      ${montar}
      select 'A:' || public.fn_mia_email_cobrar('${C}');
      select 'B:' || public.fn_mia_email_cobrar('${C}');
      select 'C:' || (select count(*) || ':' || coalesce(sum(amount_cents), 0) from public.tenant_wallet_ledger
          where organization_id = '${ORG_A}' and ref_kind = 'email_lote' and ref_id in ('${LOTE_1}', '${LOTE_2}'));
      select 'D:' || (select count(*) from public.mia_email_destinatarios where campanha_id = '${C}' and cobrado);
    `,
      ["A:", "B:", "C:", "D:"],
    );
    // Lote 1: dois aceitos (o rejeitado depois do aceite também conta), a falha não; lote 2 ainda tem e-mail saindo.
    expect(r).toBe("4/0/1:4/2");
  });

  it("a reivindicação marca até o limite como enviando, no lote, e não pega a mesma linha duas vezes", () => {
    const r = medirVarios(
      `
      insert into public.mia_email_campanhas (id, organization_id, nome) values ('${C}', '${ORG_A}', 'Fila 9060');
      insert into public.mia_email_destinatarios (organization_id, campanha_id, email_hash) values
        ('${ORG_A}', '${C}', 'f-1'), ('${ORG_A}', '${C}', 'f-2'), ('${ORG_A}', '${C}', 'f-3');
      select 'A:' || (select count(*) from public.fn_mia_email_reivindicar('${C}', '${LOTE_1}', 2));
      select 'B:' || (select count(*) from public.fn_mia_email_reivindicar('${C}', '${LOTE_2}', 5));
      select 'C:' || (select count(*) from public.mia_email_destinatarios where campanha_id = '${C}' and status = 'enviando' and lote_id = '${LOTE_1}');
    `,
      ["A:", "B:", "C:"],
    );
    expect(r).toBe("2/1/2");
  });
});

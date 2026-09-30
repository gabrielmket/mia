import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (.62, migration 9005) — o que a 9005 garante NO BANCO.
 *
 *   1. UM aviso de leitura parada aberto por formulário na Central
 *      (`uq_mia_aviso_de_leitura_da_meta_aberto`): a segunda rodada que chega
 *      junto é recusada (23505), mesmo pelo papel sem RLS; com o primeiro
 *      resolvido, o problema novo abre outro; `ack` conta como aberto; o índice
 *      não toca nos avisos dos OUTROS `ref_kind` (canal caído, caso parado);
 *   2. `tempo_real` só aceita `assinado` ou `recusado` (ou nulo, não tentado);
 *   3. `recebidos.via` só aceita `consulta` ou `tempo_real`, e nasce `consulta`
 *      (o que a .61 gravou continua valendo);
 *   4. o contador de falhas nasce zero.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test (LGPD).
 */

const ORG = "90059005-0000-4000-8000-00000000000a";
const GESTOR = "90059005-1111-4000-8000-00000000000a";
const PAGINA = "700000009005";
const FORM_A = "90059005-2222-4000-8000-00000000000a";
const FORM_B = "90059005-2222-4000-8000-00000000000b";

/** A linha da saída que começa com `marca` (o psql imprime BEGIN, DO, ROLLBACK no meio). */
function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/** Roda `dml` numa transação desfeita e devolve o SQLSTATE do erro, ou `"passou"`. */
function tentar(dml: string): string {
  const saida = sql(`
    begin;
    do $$
    begin
      begin
        ${dml};
        perform set_config('inv.r', 'passou', true);
      exception when others then
        perform set_config('inv.r', sqlstate, true);
      end;
    end $$;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

const aviso = (ref: string, status = "open", refKind = "mia_leads_da_meta_formulario") =>
  `insert into public.agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id, status)
     values ('${ORG}', 'other', 'critical', 'Os leads pararam', '${refKind}', '${ref}', '${status}')`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${GESTOR}', 'mia-9005@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-9005', 'MIA 9005', 'MIA 9005')
      on conflict (id) do nothing;
    insert into public.mia_paginas_da_meta (page_id, organization_id, page_name)
      values ('${PAGINA}', '${ORG}', 'Página 9005')
      on conflict (page_id) do nothing;
    insert into public.mia_leads_da_meta_formularios (id, organization_id, page_id, form_id, ativo)
      values ('${FORM_A}', '${ORG}', '${PAGINA}', 'form-9005-a', true),
             ('${FORM_B}', '${ORG}', '${PAGINA}', 'form-9005-b', true)
      on conflict do nothing;
  `);
});

describe("um aviso aberto por formulário na Central", () => {
  it("o segundo aviso aberto do MESMO formulário é recusado, mesmo sem RLS", () => {
    expect(tentar(`${aviso(FORM_A)}; ${aviso(FORM_A)}`)).toBe("23505");
  });

  it("controle positivo: formulários diferentes, um aviso cada", () => {
    expect(tentar(`${aviso(FORM_A)}; ${aviso(FORM_B)}`)).toBe("passou");
  });

  it("com o primeiro resolvido, o problema novo abre outro", () => {
    expect(tentar(`${aviso(FORM_A, "resolved")}; ${aviso(FORM_A)}`)).toBe("passou");
  });

  it("visto (`ack`) e não resolvido ainda conta como aberto", () => {
    expect(tentar(`${aviso(FORM_A, "ack")}; ${aviso(FORM_A)}`)).toBe("23505");
  });

  it("o índice não toca nos avisos de outro `ref_kind`", () => {
    expect(tentar(`${aviso(FORM_A, "open", "lead")}; ${aviso(FORM_A, "open", "lead")}`)).toBe(
      "passou",
    );
  });
});

describe("as colunas da 9005", () => {
  it("tempo_real só aceita assinado ou recusado", () => {
    const pondo = (valor: string) =>
      tentar(`update public.mia_leads_da_meta_formularios set tempo_real = ${valor} where id = '${FORM_A}'`);
    expect(pondo("'assinado'")).toBe("passou");
    expect(pondo("'recusado'")).toBe("passou");
    expect(pondo("null")).toBe("passou");
    expect(pondo("'talvez'")).toBe("23514");
  });

  it("recebidos.via nasce consulta e só aceita os dois caminhos", () => {
    const recebido = (via: string | null) =>
      `insert into public.mia_leads_da_meta_recebidos (organization_id, chave_do_lead, desfecho${via ? ", via" : ""})
         values ('${ORG}', md5(random()::text), 'criado'${via ? `, '${via}'` : ""})`;
    expect(tentar(recebido(null))).toBe("passou");
    expect(tentar(recebido("tempo_real"))).toBe("passou");
    expect(tentar(recebido("pombo_correio"))).toBe("23514");
    const via = linhaMarcada(
      sql(`begin; ${recebido(null)}; select 'M:' || via from public.mia_leads_da_meta_recebidos
             where organization_id = '${ORG}' order by recebido_em desc limit 1; rollback;`),
      "M:",
    );
    expect(via).toBe("consulta");
  });

  it("o contador de falhas nasce zero", () => {
    const falhas = linhaMarcada(
      sql(`select 'M:' || falhas_seguidas from public.mia_leads_da_meta_formularios where id = '${FORM_B}';`),
      "M:",
    );
    expect(falhas).toBe("0");
  });
});

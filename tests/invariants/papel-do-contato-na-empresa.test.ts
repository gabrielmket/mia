import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (migration 9013) — o papel do contato na empresa e o principal.
 *
 *   1. o vocabulário é fechado no banco: papel fora da lista é recusado (23514);
 *      nulo é aceito (não informado);
 *   2. anonimizar o contato zera papel e principal (gatilho NOSSO da 0264,
 *      redefinido aqui), junto com cargo e empresa — e o controle: sem anonimizar,
 *      nada muda.
 *
 * Sem PII: nomes sintéticos.
 */
const ORG = "90139013-0000-4000-8000-00000000000a";
const EMPRESA = "90139013-5555-4000-8000-00000000000a";
const PESSOA = "90139013-3333-4000-8000-00000000000a";
const CONTROLE = "90139013-3333-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-9013', 'MIA 9013', 'MIA 9013') on conflict (id) do nothing;
    insert into public.crm_empresas (id, organization_id, nome) values ('${EMPRESA}', '${ORG}', 'Empresa 9013')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, empresa_id, cargo, papel_na_empresa, principal_na_empresa) values
      ('${PESSOA}', '${ORG}', 'Pessoa 9013', '${EMPRESA}', 'Sócia', 'decisor', true),
      ('${CONTROLE}', '${ORG}', 'Controle 9013', '${EMPRESA}', 'Gerente', 'financeiro', false)
      on conflict do nothing;
  `);
});

function sqlstate(dml: string): string {
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
  return (saida.split("\n").find((l) => l.startsWith("R:")) ?? "").slice(2);
}

describe("papel do contato na empresa", () => {
  it("vocabulário fechado: recusa papel desconhecido; aceita nulo e os cinco", () => {
    expect(sqlstate(`update public.contacts set papel_na_empresa = 'chefe' where id = '${CONTROLE}'`)).toBe("23514");
    expect(sqlstate(`update public.contacts set papel_na_empresa = null where id = '${CONTROLE}'`)).toBe("passou");
    for (const p of ["decisor", "financeiro", "usuario", "influenciador", "outro"]) {
      expect(sqlstate(`update public.contacts set papel_na_empresa = '${p}' where id = '${CONTROLE}'`)).toBe("passou");
    }
  });

  it("anonimizar zera papel e principal (com cargo e empresa); quem não foi anonimizado fica como estava", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${PESSOA}';`);
    expect(
      sql(`select coalesce(papel_na_empresa, '-') || '|' || principal_na_empresa::text || '|' || coalesce(cargo, '-') || '|' || coalesce(empresa_id::text, '-')
             from public.contacts where id = '${PESSOA}';`),
    ).toBe("-|false|-|-");
    expect(
      sql(`select papel_na_empresa || '|' || principal_na_empresa::text from public.contacts where id = '${CONTROLE}';`),
    ).toBe("financeiro|false");
  });
});

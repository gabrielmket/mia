/**
 * 9166 · FUSO VAZIO OU INVÁLIDO VALE BRASÍLIA no motor dos relatórios
 * (`fn_mia_relatorio_preparar`, a régua do montador, dos painéis prontos e da
 * lista), no Postgres de verdade.
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * Até a 9041 o preparo só recuava para `America/Sao_Paulo` quando o fuso
 * estava VAZIO. Com um nome que o Postgres não conhece (`America/Sao_Pualo`,
 * um erro de digitação), o `at time zone` da janela levantava 22023 e o
 * relatório não abria. E o resto do sistema já recuava para Brasília
 * (`fusoUtilizavel` no TypeScript), então a mesma venda caía em meses
 * diferentes conforme a tela.
 *
 * ─── O que se mede ──────────────────────────────────────────────────────────
 *
 * 1. Fuso inválido, vazio e só espaços: o motor abre, diz `America/Sao_Paulo`
 *    na janela, e a venda das 22h de 31/10 em Brasília é de OUTUBRO.
 * 2. Controle positivo: o fuso válido de outro lugar (Tóquio) continua valendo
 *    — a mesma venda é de novembro lá. A regra recua só o que não existe.
 * 3. Pela sessão (`authenticated`, `security invoker`): quem pergunta lê
 *    `pg_timezone_names` sem permissão extra (a `fn_fuso_valido` do upstream
 *    não serve aqui porque é só de `service_role`).
 * 4. O fuso gravado NÃO muda: a correção é na leitura.
 *
 * Organizações próprias (namespace `e9166e90-`), nomes fictícios. Nenhum dado
 * de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ALFA = "e9166e90-0000-4000-8000-00000000000a"; // 'America/Sao_Pualo'
const BETA = "e9166e90-0000-4000-8000-00000000000b"; // ''
const GAMA = "e9166e90-0000-4000-8000-00000000000c"; // '   '
const TOQUIO = "e9166e90-0000-4000-8000-00000000000d"; // 'Asia/Tokyo'
const CONTROLE = "e9166e90-0000-4000-8000-00000000000e"; // 'America/Sao_Paulo'
const GESTOR_ALFA = "e9166e90-1111-4000-8000-00000000000a";
const AGORA = "2026-11-20 12:00:00-03";

const EMPRESAS: { org: string; fuso: string; nome: string; sufixo: string }[] = [
  { org: ALFA, fuso: "America/Sao_Pualo", nome: "Academia Alfa", sufixo: "a" },
  { org: BETA, fuso: "", nome: "Academia Beta", sufixo: "b" },
  { org: GAMA, fuso: "   ", nome: "Academia Gama", sufixo: "c" },
  { org: TOQUIO, fuso: "Asia/Tokyo", nome: "Academia Delta", sufixo: "d" },
  { org: CONTROLE, fuso: "America/Sao_Paulo", nome: "Academia Épsilon", sufixo: "e" },
];

const funil = (s: string) => `e9166e90-2222-4000-8000-00000000000${s}`;
const etapa = (s: string) => `e9166e90-3333-4000-8000-00000000000${s}`;
const negocio = (s: string) => `e9166e90-4444-4000-8000-00000000000${s}`;

/** O jsonb do motor por `chamada`, como `postgres` (a plataforma) ou como `usuario`. */
function json(chamada: string, usuario?: string): Record<string, unknown> {
  const prefixo = usuario
    ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);`
    : "";
  return JSON.parse(lastLine(sql(`${prefixo} select (${chamada})::text;`))) as Record<string, unknown>;
}

/** Outubro e novembro de 2026, por mês, só os negócios ganhos. */
const porMes = (org: string) =>
  `public.fn_mia_relatorio('${org}'::uuid, 'negocios', array['qtd'], 'mes', null, '{}', 'pers', '2026-10-01', '2026-11-30', true, false, '${AGORA}')`;

const preparo = (org: string) =>
  `public.fn_mia_relatorio_preparar('${org}'::uuid, 'negocios', array['qtd'], 'mes', null, '{}', 'pers', '2026-10-01', '2026-11-30', '${AGORA}')`;

type Grupo = { chave: string; n: number };
const nDoMes = (r: Record<string, unknown>, mes: string) =>
  (r.grupos as Grupo[]).find((g) => g.chave === mes)?.n ?? 0;
const fusoDa = (r: Record<string, unknown>) => (r.janela as Record<string, string>).fuso;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${GESTOR_ALFA}', 'fuso-9166-gestor-alfa@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, timezone, currency) values
      ${EMPRESAS.map((e) => `('${e.org}', 'fuso-9166-${e.sufixo}', '${e.nome}', '${e.nome}', '${e.fuso}', 'BRL')`).join(",\n      ")}
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GESTOR_ALFA}', '${ALFA}', 'manager', now())
      on conflict do nothing;

    update public.crm_pipelines set is_default = false
     where organization_id in (${EMPRESAS.map((e) => `'${e.org}'`).join(", ")});
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default, vocabulary) values
      ${EMPRESAS.map((e) => `('${funil(e.sufixo)}', '${e.org}', 'Matrículas', 'matriculas-9166-${e.sufixo}', true, '{}')`).join(",\n      ")};
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost) values
      ${EMPRESAS.map((e) => `('${etapa(e.sufixo)}', '${e.org}', '${funil(e.sufixo)}', 'Matriculou', 'matriculou-9166-${e.sufixo}', 1000, true, false)`).join(",\n      ")};

    -- A venda da reprodução: fechada às 22h de 31/10 em Brasília (01h de 01/11 em
    -- UTC, 10h de 01/11 em Tóquio).
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, value_cents, currency,
      created_at, closed_at) values
      ${EMPRESAS.map((e) => `('${negocio(e.sufixo)}', '${e.org}', '${funil(e.sufixo)}', '${etapa(e.sufixo)}', 'Plano anual', 'won', 120000, 'BRL', '2026-10-20 10:00-03', '2026-10-31 22:00-03')`).join(",\n      ")};
  `);
});

describe("⭐ fuso que o Postgres não conhece vale Brasília, e o relatório abre", () => {
  it.each([
    ["inválido (America/Sao_Pualo)", ALFA],
    ["vazio", BETA],
    ["só espaços", GAMA],
  ])("fuso %s: o preparo diz America/Sao_Paulo", (_rotulo, org) => {
    expect(json(preparo(org)).fuso).toBe("America/Sao_Paulo");
  });

  it.each([
    ["inválido (America/Sao_Pualo)", ALFA],
    ["vazio", BETA],
    ["só espaços", GAMA],
  ])("fuso %s: a venda das 22h de 31/10 em Brasília é de outubro", (_rotulo, org) => {
    const r = json(porMes(org));
    expect(fusoDa(r)).toBe("America/Sao_Paulo");
    expect(nDoMes(r, "2026-10")).toBe(1);
    expect(nDoMes(r, "2026-11")).toBe(0);
  });

  it("o mesmo número do fuso escrito certo (controle)", () => {
    const certo = json(porMes(CONTROLE));
    const torto = json(porMes(ALFA));
    expect(fusoDa(certo)).toBe("America/Sao_Paulo");
    expect(torto.grupos).toEqual(certo.grupos);
    expect(torto.janela).toEqual(certo.janela);
  });
});

describe("o fuso válido continua valendo", () => {
  it("⭐ em Tóquio a mesma venda é de novembro (a regra recua só o que não existe)", () => {
    const r = json(porMes(TOQUIO));
    expect(fusoDa(r)).toBe("Asia/Tokyo");
    expect(nDoMes(r, "2026-10")).toBe(0);
    expect(nDoMes(r, "2026-11")).toBe(1);
  });
});

describe("pela sessão de quem pergunta", () => {
  it("⭐ o gestor da Academia Alfa abre o relatório (security invoker lê pg_timezone_names)", () => {
    const r = json(porMes(ALFA), GESTOR_ALFA);
    expect(fusoDa(r)).toBe("America/Sao_Paulo");
    expect(nDoMes(r, "2026-10")).toBe(1);
  });
});

describe("a correção é na leitura", () => {
  it("o fuso gravado não muda", () => {
    expect(lastLine(sql(`select timezone from public.organizations where id = '${ALFA}';`))).toBe("America/Sao_Pualo");
  });
});

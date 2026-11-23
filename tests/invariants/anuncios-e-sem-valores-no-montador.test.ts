/**
 * MIA-106 · A FONTE DE ANÚNCIOS DO MONTADOR e o "SEM VALORES" do link do dono,
 * no Postgres de verdade.
 *
 * ─── O que se trava, e por quê ──────────────────────────────────────────────
 *
 * A. `fn_mia_relatorio_linhas_de_anuncios` é DEFINER (a tabela
 *    `ad_conversion_dispatches` é só do servidor) e o `authenticated` a executa
 *    direto pelo PostgREST, sem passar pelo motor. Então ela mesma tem de:
 *
 *    1. filtrar `p_org` em TODO `join`: o envio de A que aponta para um negócio
 *       de B (o `lead_id` só tem FK para `crm_leads(id)`, sem empresa) não traz
 *       a campanha de B, e o `Etapa:<id>` de uma etapa de B não traz o nome
 *       dela. Nada de B aparece na resposta de A;
 *    2. exigir gestor: o atendente de A e o gestor de B, chamando direto, levam
 *       zero linhas; `anon` nem executa;
 *    3. cortar o período no FUSO DA EMPRESA (o motor manda o início e o fim já
 *       no fuso): a academia de Manaus que mandou a compra às 23h30 de 30/09
 *       (00h30 de 01/10 em Brasília) vê a compra em SETEMBRO.
 *
 * B. `p_valores = false` (o link do dono com "mostrar valores" desligado; a
 *    página só calcula pelo motor, `lib/paineis/calcular.ts` e
 *    `lib/relatorios/link.ts`) não deixa sair dinheiro por NENHUM caminho da
 *    resposta: total, grupos, séries, período anterior, meta do período e meta
 *    de cada mês. A varredura é do jsonb inteiro, não de uma chave escolhida.
 *    O CONTROLE (`p_valores = true`, mesmo pedido) prova que o cenário tem
 *    dinheiro para esconder.
 *
 * Organizações próprias (namespace `e9106e91-`), dados fictícios (Academia
 * Alfa). Nenhum dado de cliente real.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG_A = "e9106e91-0000-4000-8000-00000000000a";
const ORG_B = "e9106e91-0000-4000-8000-00000000000b";
const GESTOR_A = "e9106e91-1111-4000-8000-00000000000a";
const ATENDENTE_A = "e9106e91-1111-4000-8000-0000000000a2";
const GESTOR_B = "e9106e91-1111-4000-8000-00000000000b";
const FUNIL_A = "e9106e91-2222-4000-8000-00000000000a";
const FUNIL_B = "e9106e91-2222-4000-8000-00000000000b";
const ETAPA_A = "e9106e91-3333-4000-8000-0000000000a1";
const GANHO_A = "e9106e91-3333-4000-8000-0000000000a2";
const ETAPA_B = "e9106e91-3333-4000-8000-0000000000b1";
const NEG_A1 = "e9106e91-5555-4000-8000-0000000000a1";
const NEG_A2 = "e9106e91-5555-4000-8000-0000000000a2";
const NEG_A3 = "e9106e91-5555-4000-8000-0000000000a3";
const NEG_A4 = "e9106e91-5555-4000-8000-0000000000a4";
const NEG_B1 = "e9106e91-5555-4000-8000-0000000000b1";
const ENVIO_SET = "e9106e91-6666-4000-8000-000000000001";
const ENVIO_OUT = "e9106e91-6666-4000-8000-000000000002";
const ENVIO_CRUZADO = "e9106e91-6666-4000-8000-000000000003";
const ENVIO_ETAPA = "e9106e91-6666-4000-8000-000000000004";
const ENVIO_DE_B = "e9106e91-6666-4000-8000-0000000000b1";
const AGORA = "2026-10-15 12:00:00-04";
const A = `'${ORG_A}'::uuid`;

/** O jsonb do motor como `authenticated` com o JWT de `usuario`. */
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

/** O jsonb do motor como `postgres` (a plataforma: o link do dono chama assim). */
function motor(args: string): Record<string, unknown> {
  return JSON.parse(lastLine(sql(`select public.fn_mia_relatorio(${args})::text;`))) as Record<string, unknown>;
}

/** Quantas linhas a fonte de anúncios devolve, chamada DIRETO como `usuario`. */
function linhasDiretoComo(usuario: string, org: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
      select count(*) from public.fn_mia_relatorio_linhas_de_anuncios('${org}'::uuid, '-infinity', 'infinity');
    `),
  );
}

/** O SQLSTATE da chamada como `anon`, ou `passou`. */
function comoAnon(chamada: string): string {
  return lastLine(
    sql(`
      set role anon;
      do $$
      begin
        begin
          perform ${chamada};
          perform set_config('inv.r9106', 'passou', false);
        exception when others then
          perform set_config('inv.r9106', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9106');
    `),
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${GESTOR_A}', 'mia106-gestor-a@invariant.test'),
      ('${ATENDENTE_A}', 'mia106-atendente-a@invariant.test'),
      ('${GESTOR_B}', 'mia106-gestor-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, timezone, currency) values
      ('${ORG_A}', 'mia106-academia-alfa', 'Academia Alfa', 'Academia Alfa', 'America/Manaus', 'BRL'),
      ('${ORG_B}', 'mia106-outra', 'Outra Empresa', 'Outra Empresa', 'America/Sao_Paulo', 'BRL')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${ATENDENTE_A}', '${ORG_A}', 'agent', now()),
      ('${GESTOR_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    update public.crm_pipelines set is_default = false where organization_id in ('${ORG_A}','${ORG_B}');
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values
      ('${FUNIL_A}', '${ORG_A}', 'Matrículas', 'matriculas-9106', true),
      ('${FUNIL_B}', '${ORG_B}', 'Vendas', 'vendas-9106', true);
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost, win_probability) values
      ('${ETAPA_A}', '${ORG_A}', '${FUNIL_A}', 'Aula experimental', 'aula-9106', 1000, false, false, 40),
      ('${GANHO_A}', '${ORG_A}', '${FUNIL_A}', 'Matriculou', 'matriculou-9106', 2000, true, false, null),
      ('${ETAPA_B}', '${ORG_B}', '${FUNIL_B}', 'Etapa secreta de B', 'secreta-9106', 1000, false, false, 10);

    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, value_cents, currency,
      source, source_metadata, created_at, closed_at) values
      ('${NEG_A1}', '${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A1', 'open', 30000, 'BRL', 'meta_ads',
        '{"campaign_name":"Campanha de A"}', '2026-09-20 10:00-04', null),
      ('${NEG_A2}', '${ORG_A}', '${FUNIL_A}', '${ETAPA_A}', 'A2', 'open', 20000, 'BRL', 'google_ads',
        '{}', '2026-10-02 10:00-04', null),
      ('${NEG_A3}', '${ORG_A}', '${FUNIL_A}', '${GANHO_A}', 'A3', 'won', 500000, 'BRL', 'indicacao',
        '{}', '2026-09-01 10:00-04', '2026-10-05 10:00-04'),
      ('${NEG_A4}', '${ORG_A}', '${FUNIL_A}', '${GANHO_A}', 'A4', 'won', 250000, 'BRL', 'meta_ads',
        '{}', '2026-08-20 10:00-04', '2026-09-10 10:00-04'),
      ('${NEG_B1}', '${ORG_B}', '${FUNIL_B}', '${ETAPA_B}', 'B1', 'open', 999999, 'BRL', 'meta_ads',
        '{"campaign_name":"Campanha secreta de B"}', '2026-10-01 10:00-03', null);

    insert into public.sales_targets (organization_id, periodo, metrica, alvo_cents) values
      ('${ORG_A}', '2026-10-01', 'receita_total', 1000000),
      ('${ORG_A}', '2026-09-01', 'receita_total', 600000);

    insert into public.ad_conversion_dispatches (id, organization_id, lead_id, platform, event_name, status, attempted_at) values
      -- 23h30 de 30/09 em Manaus = 00h30 de 01/10 em Brasília.
      ('${ENVIO_SET}', '${ORG_A}', '${NEG_A1}', 'meta_ads', 'Purchase', 'sent', '2026-09-30 23:30-04'),
      ('${ENVIO_OUT}', '${ORG_A}', '${NEG_A1}', 'meta_ads', 'QualifiedLead', 'sent', '2026-10-01 00:30-04'),
      -- Envio de A que aponta para o negócio e a etapa de B.
      ('${ENVIO_CRUZADO}', '${ORG_A}', '${NEG_B1}', 'google_ads', 'Etapa:${ETAPA_B}', 'error', '2026-10-10 10:00-04'),
      ('${ENVIO_ETAPA}', '${ORG_A}', '${NEG_A2}', 'google_ads', 'Etapa:${ETAPA_A}', 'sent', '2026-10-05 10:00-04'),
      ('${ENVIO_DE_B}', '${ORG_B}', '${NEG_B1}', 'meta_ads', 'Purchase', 'sent', '2026-10-05 10:00-03');
  `);
});

describe("A1. a fonte de anúncios filtra a empresa em todo join", () => {
  type Linha = { registro: string; campanha: string | null; evento: string; rotulo: string | null };
  const linhas = (): Linha[] =>
    JSON.parse(
      lastLine(
        sql(`
          select coalesce(jsonb_agg(jsonb_build_object(
                   'registro', l.registro, 'campanha', l.dims->>'campanha',
                   'evento', l.dims->>'evento', 'rotulo', l.rotulos->>'evento') order by l.momento), '[]')::text
            from public.fn_mia_relatorio_linhas_de_anuncios(${A}, '-infinity', 'infinity') l;
        `),
      ),
    ) as Linha[];

  it("CONTROLE: os quatro envios de A, e a campanha e a etapa de A com nome", () => {
    const l = linhas();
    expect(l.map((x) => x.registro)).toEqual([ENVIO_SET, ENVIO_OUT, ENVIO_ETAPA, ENVIO_CRUZADO]);
    expect(l.find((x) => x.registro === ENVIO_SET)?.campanha).toBe("Campanha de A");
    expect(l.find((x) => x.registro === ENVIO_ETAPA)?.rotulo).toBe("Aula experimental");
  });

  it("⭐ o envio de A que aponta para o negócio e a etapa de B não traz nada de B", () => {
    const cruzado = linhas().find((x) => x.registro === ENVIO_CRUZADO);
    expect(cruzado).toEqual({ registro: ENVIO_CRUZADO, campanha: null, evento: `etapa:${ETAPA_B}`, rotulo: null });
    const texto = JSON.stringify(linhas());
    expect(texto).not.toContain("secreta");
    expect(texto).not.toContain(ENVIO_DE_B);
  });
});

describe("A2. a fonte de anúncios exige gestor, mesmo chamada direto", () => {
  it("⭐ o atendente de A e o gestor de B levam zero linhas; o gestor de A, as quatro", () => {
    expect(linhasDiretoComo(ATENDENTE_A, ORG_A)).toBe("0");
    expect(linhasDiretoComo(GESTOR_B, ORG_A)).toBe("0");
    expect(linhasDiretoComo(GESTOR_A, ORG_A)).toBe("4");
  });

  it("anon não executa (42501)", () => {
    expect(comoAnon(`public.fn_mia_relatorio_linhas_de_anuncios(${A}, '-infinity', 'infinity')`)).toBe("42501");
  });
});

describe("A3. o período dos anúncios é cortado no fuso da empresa", () => {
  const porMes = (de: string, ate: string) =>
    motorComo(GESTOR_A, `${A}, 'anuncios', array['qtd'], 'plataforma', null, '{}', 'pers', '${de}'::date, '${ate}'::date, true, false, '${AGORA}'`);

  it("⭐ a compra das 23h30 de 30/09 em Manaus é de setembro; a de 00h30 de 01/10, de outubro", () => {
    const setembro = porMes("2026-09-01", "2026-09-30");
    const outubro = porMes("2026-10-01", "2026-10-31");
    expect((setembro.janela as { fuso: string }).fuso).toBe("America/Manaus");
    // Em Brasília a compra de 30/09 cairia em outubro: setembro teria 0 e outubro 4.
    expect((setembro.total as { n: number }).n).toBe(1);
    expect((outubro.total as { n: number }).n).toBe(3);
  });
});

// ─── B. sem valores, nenhum dinheiro em lugar nenhum ────────────────────────

const DINHEIRO = new Set(["soma", "media", "prev", "alvo_cents", "meta_cents", "valor_cents"]);

/** Os caminhos do jsonb onde ficou dinheiro (uma chave de dinheiro com número). */
function dinheiroQueSobrou(v: unknown, caminho = "$"): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => dinheiroQueSobrou(x, `${caminho}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
      DINHEIRO.has(k) && typeof x === "number" ? [`${caminho}.${k}`] : dinheiroQueSobrou(x, `${caminho}.${k}`),
    );
  }
  return [];
}

describe("B. sem valores (o link do dono com 'mostrar valores' desligado)", () => {
  const PEDIDOS: Array<[string, (valores: boolean) => string]> = [
    [
      "ganhos por mês, com meta e período anterior",
      (v) => `${A}, 'negocios', array['soma','media'], 'mes', null, '{"situacao":"ganho"}', 'pers', '2026-09-01'::date, '2026-10-31'::date, ${v}, true, '${AGORA}'`,
    ],
    [
      "este mês, com a meta do período",
      (v) => `${A}, 'negocios', array['soma'], null, null, '{"situacao":"ganho"}', 'mes', null, null, ${v}, true, '${AGORA}'`,
    ],
    [
      "por origem e situação (séries), com o previsto",
      (v) => `${A}, 'negocios', array['soma','media','prev'], 'origem', 'situacao', '{}', 'pers', '2026-08-01'::date, '2026-10-31'::date, ${v}, false, '${AGORA}'`,
    ],
  ];

  it.each(PEDIDOS)("CONTROLE (%s): com valores, há dinheiro para esconder", (_nome, args) => {
    expect(dinheiroQueSobrou(motor(args(true))).length).toBeGreaterThan(0);
  });

  it.each(PEDIDOS)("⭐ %s: sem valores, nenhuma chave de dinheiro sai com número", (_nome, args) => {
    const res = motor(args(false));
    expect(res.valores).toBe(false);
    expect(dinheiroQueSobrou(res)).toEqual([]);
  });

  it("a meta sem valores perde o alvo e fica a fração (decisão do protótipo)", () => {
    const res = motor(PEDIDOS[1]![1](false));
    const meta = res.meta as Record<string, unknown>;
    expect(meta.alvo_cents).toBeNull();
    expect(typeof meta.fracao).toBe("number");
  });
});

/**
 * MIA-361 · ponto 1 · O LINK DO DONO COM "MOSTRAR VALORES" DESLIGADO, DE PONTA
 * A PONTA: o código que a página `/painel/<token>` chama, contra o motor de
 * verdade no Postgres.
 *
 * ─── O que já estava travado (MIA-106) e o que faltava ──────────────────────
 *
 * - `tests/unit/link-do-dono-sem-valores-e-teto.test.ts` prova que toda chamada
 *   ao motor feita para o link leva `p_valores = false` (motor FALSO);
 * - `tests/invariants/anuncios-e-sem-valores-no-montador.test.ts` prova que o
 *   motor com `p_valores = false` não devolve dinheiro, em três pedidos
 *   escritos à mão.
 *
 * Faltava juntar as duas pontas: os pedidos que os DOZE PRONTOS fazem de
 * verdade (`perguntaDo` em `lib/paineis/calcular.ts`, que não é exportada e
 * pode mudar sem ninguém atualizar os pedidos escritos à mão) e os do PAINEL DO
 * MONTADOR, inclusive o FUNIL com a soma de quem chegou (9041), a média, o
 * previsto, a meta de cada mês e o período anterior. Aqui o `rpc` do cliente de
 * serviço vai ao `fn_mia_relatorio` de verdade (por psql, como `postgres`: a
 * plataforma chama sem JWT); só o `from` (empresa, funis, a linha do painel) é
 * servido da memória, com os mesmos dados gravados no banco.
 *
 * A prova é a VARREDURA do que a página recebe, não de uma chave escolhida: os
 * valores semeados são números que não aparecem por acaso (R$ 12.345,67,
 * R$ 76.543,21, a meta de R$ 314.159,26), e nenhum deles, nem as somas, nem o
 * previsto, pode aparecer na resposta sem valores. O CONTROLE (o mesmo cálculo
 * com valores) prova que havia dinheiro para esconder.
 *
 * "As duas parcelas do período" (vendido único e recorrência nova mensal) são
 * da Análise do funil (`lib/metrics/valores-do-periodo.ts`), que o link não
 * calcula: a cerca de importação está em
 * `tests/unit/link-do-dono-nao-alcanca-a-analise-do-funil.test.ts`.
 *
 * Namespace `e9361000-` (exclusivo deste arquivo). Dados fictícios (Academia
 * Alfa).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { calcularPaineis } from "@/lib/paineis/calcular";
import { calcularPainelDoDono } from "@/lib/relatorios/link";

import { lastLine, sql } from "./gov-helpers";

const ORG = "e9361000-0000-4000-8000-00000000000a";
const FUNIL = "e9361000-2222-4000-8000-00000000000a";
const ETAPA = "e9361000-3333-4000-8000-0000000000a1";
const GANHO = "e9361000-3333-4000-8000-0000000000a2";
const NEG_ABERTO = "e9361000-5555-4000-8000-0000000000a1";
const NEG_GANHO = "e9361000-5555-4000-8000-0000000000a2";
const NEG_GANHO_SET = "e9361000-5555-4000-8000-0000000000a3";
const PAINEL = "e9361000-8888-4000-8000-000000000001";
/** O "agora" dos prontos: outubro de 2026 em Manaus. */
const AGORA = "2026-10-15T12:00:00-04:00";

const ABERTO_CENTS = 1234567; // R$ 12.345,67
const GANHO_CENTS = 7654321; // R$ 76.543,21
const GANHO_SET_CENTS = 2718281; // R$ 27.182,81
const META_OUT_CENTS = 31415926; // R$ 314.159,26
const META_SET_CENTS = 16180339; // R$ 161.803,39

/**
 * Os números de dinheiro que não podem sair sem valores: cada valor semeado, as
 * somas e médias que o motor faria com eles, o previsto pela chance da etapa
 * (40%) e as metas. Em centavos e em reais (a página formata a partir deles).
 */
const DINHEIRO_SEMEADO: number[] = (() => {
  const base = [ABERTO_CENTS, GANHO_CENTS, GANHO_SET_CENTS, META_OUT_CENTS, META_SET_CENTS];
  const somas = [
    ABERTO_CENTS + GANHO_CENTS,
    GANHO_CENTS + GANHO_SET_CENTS,
    ABERTO_CENTS + GANHO_CENTS + GANHO_SET_CENTS,
    ABERTO_CENTS + GANHO_SET_CENTS,
  ];
  const medias = [
    (GANHO_CENTS + GANHO_SET_CENTS) / 2,
    (ABERTO_CENTS + GANHO_CENTS) / 2,
    (ABERTO_CENTS + GANHO_CENTS + GANHO_SET_CENTS) / 3,
    (ABERTO_CENTS + GANHO_SET_CENTS) / 2,
  ];
  const previsto = [ABERTO_CENTS * 0.4];
  const centavos = [...base, ...somas, ...medias, ...previsto].flatMap((v) => [Math.round(v), Math.floor(v), Math.ceil(v)]);
  return [...new Set([...centavos, ...centavos.map((c) => c / 100)])];
})();

/** Todos os números de uma árvore (o que a página recebe), com o caminho. */
function numeros(v: unknown, caminho = "$"): Array<[string, number]> {
  if (typeof v === "number") return [[caminho, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => numeros(x, `${caminho}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => numeros(x, `${caminho}.${k}`));
  }
  return [];
}

/** Os caminhos onde apareceu um número de dinheiro semeado. */
function dinheiroQueSaiu(v: unknown): string[] {
  return numeros(v)
    .filter(([, n]) => DINHEIRO_SEMEADO.some((d) => Math.abs(d - n) < 1e-6))
    .map(([c, n]) => `${c}=${n}`);
}

// ─── O cliente de serviço: `rpc` no banco de verdade, `from` da memória ─────

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (Array.isArray(v)) {
    return v.length === 0 ? "'{}'::text[]" : `array[${v.map((x) => literal(String(x))).join(", ")}]::text[]`;
  }
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
}

/** Chama a função com argumentos nomeados, como o PostgREST faz. */
async function rpcNoBanco(nome: string, args: Record<string, unknown>) {
  if (!/^[a-z_]+$/.test(nome)) throw new Error(`nome de função inesperado: ${nome}`);
  const nomeados = Object.entries(args)
    .map(([k, v]) => `${k} => ${literal(v)}`)
    .join(", ");
  try {
    const saida = lastLine(sql(`select public.${nome}(${nomeados})::text;`));
    return { data: JSON.parse(saida) as unknown, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: null } };
  }
}

function clienteDeServico(tabelas: Record<string, unknown>) {
  return {
    rpc: rpcNoBanco,
    from: (tabela: string) => {
      const dado = tabelas[tabela] ?? null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: Array.isArray(dado) ? (dado[0] ?? null) : dado, error: null }),
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve({ data: Array.isArray(dado) ? dado : dado ? [dado] : [], error: null }).then(ok, falha),
      });
      return q;
    },
  } as never;
}

const EMPRESA = { display_name: "Academia Alfa", timezone: "America/Manaus", currency: "BRL", demonstracao: false };
const FUNIS = [{ id: FUNIL, name: "Matrículas", vocabulary: {}, is_default: true, is_archived: false, position: 1 }];

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name, timezone, currency) values
      ('${ORG}', 'mia361-academia-alfa', 'Academia Alfa', 'Academia Alfa', 'America/Manaus', 'BRL')
      on conflict (id) do nothing;

    update public.crm_pipelines set is_default = false where organization_id = '${ORG}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values
      ('${FUNIL}', '${ORG}', 'Matrículas', 'matriculas-9361', true)
      on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost, win_probability) values
      ('${ETAPA}', '${ORG}', '${FUNIL}', 'Aula experimental', 'aula-9361', 1000, false, false, 40),
      ('${GANHO}', '${ORG}', '${FUNIL}', 'Matriculou', 'matriculou-9361', 2000, true, false, null)
      on conflict (id) do nothing;

    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, value_cents, currency,
      source, source_metadata, created_at, closed_at) values
      ('${NEG_ABERTO}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Plano anual', 'open', ${ABERTO_CENTS}, 'BRL',
        'indicacao', '{}', '2026-10-02 10:00-04', null),
      ('${NEG_GANHO}', '${ORG}', '${FUNIL}', '${GANHO}', 'Plano família', 'won', ${GANHO_CENTS}, 'BRL',
        'meta_ads', '{}', '2026-09-20 10:00-04', '2026-10-05 10:00-04'),
      ('${NEG_GANHO_SET}', '${ORG}', '${FUNIL}', '${GANHO}', 'Plano mensal', 'won', ${GANHO_SET_CENTS}, 'BRL',
        'indicacao', '{}', '2026-09-01 10:00-04', '2026-09-10 10:00-04')
      on conflict (id) do nothing;

    insert into public.sales_targets (organization_id, periodo, metrica, alvo_cents) values
      ('${ORG}', '2026-10-01', 'receita_total', ${META_OUT_CENTS}),
      ('${ORG}', '2026-09-01', 'receita_total', ${META_SET_CENTS})
      on conflict do nothing;
  `);
});

// ─── Os doze prontos (o link com `paineis`) ─────────────────────────────────

describe("⭐ os doze prontos pelo motor de verdade", () => {
  const calcular = (valores: boolean) =>
    calcularPaineis(clienteDeServico({ organizations: EMPRESA, crm_pipelines: FUNIS }), {
      organizationId: ORG,
      periodo: "mes",
      valores,
      agora: AGORA,
    });

  it("CONTROLE: com valores, o resultado, a meta e a previsão têm o dinheiro semeado", async () => {
    const r = await calcular(true);
    const dados = Object.fromEntries(r.paineis.map((p) => [p.chave, p.dados]));
    expect(dados.resultado).toMatchObject({ tipo: "resultado", ganhos: 1, valorGanho: GANHO_CENTS });
    expect(dados.meta).toMatchObject({ tipo: "meta", alvo: META_OUT_CENTS, realizado: GANHO_CENTS });
    expect(dados.previsao).toMatchObject({ tipo: "previsao", abertos: 1 });
    expect((dados.previsao as { previsto: number | null }).previsto).toBeGreaterThan(0);
    expect(dinheiroQueSaiu(r).length).toBeGreaterThan(0);
  });

  it("⭐ sem valores: nenhum número de dinheiro em nenhum dos doze, e as contagens continuam", async () => {
    const r = await calcular(false);
    expect(r.valores).toBe(false);
    // Os painéis de negócio foram calculados (não é um "erro" que esconde o número).
    for (const chave of ["resultado", "meta", "funil", "origem", "previsao"] as const) {
      const p = r.paineis.find((x) => x.chave === chave);
      expect(p?.erro ?? null, chave).toBeNull();
      expect(p?.dados, chave).not.toBeNull();
    }
    expect(dinheiroQueSaiu(r)).toEqual([]);

    const dados = Object.fromEntries(r.paineis.map((p) => [p.chave, p.dados]));
    expect(dados.resultado).toMatchObject({ ganhos: 1, valorGanho: null });
    expect(dados.meta).toMatchObject({ temMeta: true, alvo: null, realizado: null });
    expect(dados.previsao).toMatchObject({ abertos: 1, previsto: null });
    for (const m of (dados.previsao as { meses: Array<{ previsto: number | null }> }).meses) {
      expect(m.previsto).toBeNull();
    }
    // O funil continua contando quem chegou (a contagem não é dinheiro e fica).
    const funil = dados.funil as { etapas: Array<{ nome: string; chegaram: number }> };
    expect(funil.etapas.map((e) => e.nome)).toEqual(expect.arrayContaining(["Aula experimental", "Matriculou"]));
    expect(funil.etapas.reduce((s, e) => s + e.chegaram, 0)).toBeGreaterThan(0);
  });
});

// ─── O painel do montador (o link com `painel_id`) ──────────────────────────

describe("⭐ o painel do montador pelo motor de verdade", () => {
  const salvo = (id: string, nome: string, cfg: Record<string, unknown>) => ({
    id,
    nome,
    fonte: "negocios",
    dim2: null,
    filtros: {},
    periodo: "pers",
    de: "2026-09-01",
    ate: "2026-10-31",
    comparar: true,
    visualizacao: "barras",
    ...cfg,
  });
  const RELATORIOS = [
    salvo("e9361000-7777-4000-8000-000000000001", "Valor por etapa", { medida: "soma", dim1: "etapa", visualizacao: "funil" }),
    salvo("e9361000-7777-4000-8000-000000000002", "Ganhos por mês com a meta", {
      medida: "soma",
      dim1: "mes",
      filtros: { situacao: "ganho" },
    }),
    salvo("e9361000-7777-4000-8000-000000000003", "Ticket por origem", { medida: "media", dim1: "origem", dim2: "situacao" }),
    salvo("e9361000-7777-4000-8000-000000000004", "Previsto por etapa", { medida: "prev", dim1: "etapa", comparar: false }),
  ];
  const ITENS = RELATORIOS.map((r, i) => ({
    id: `e9361000-6666-4000-8000-00000000000${i + 1}`,
    painel_id: PAINEL,
    relatorio_id: r.id,
    pronto: null,
    tamanho: "M",
    // Período próprio: o do relatório (setembro e outubro de 2026), sem depender do dia em que a CI roda.
    periodo_proprio: true,
    posicao: i + 1,
  }));
  const calcular = (valores: boolean) =>
    calcularPainelDoDono(
      clienteDeServico({
        mia_paineis_usuario: {
          id: PAINEL,
          nome: "Painel da Academia Alfa",
          periodo: "30",
          compartilhado: true,
          created_by: null,
          criado_via: "tela",
          updated_at: "2026-10-01T00:00:00Z",
        },
        mia_paineis_usuario_itens: ITENS,
        crm_pipelines: FUNIS,
        mia_relatorios_da_empresa: null,
        mia_relatorios: RELATORIOS,
      }),
      { organizationId: ORG, painelId: PAINEL, periodo: "30", valores },
    );

  it("CONTROLE: com valores, os quatro relatórios saem com o dinheiro semeado", async () => {
    const p = await calcular(true);
    expect(p?.itens).toHaveLength(4);
    for (const item of p!.itens) expect(item.erro, item.titulo).toBe(false);
    expect(dinheiroQueSaiu(p).length).toBeGreaterThan(0);
  });

  it("⭐ sem valores: o funil com a soma, a meta de cada mês, a média e o previsto não deixam sair dinheiro", async () => {
    const p = await calcular(false);
    expect(p?.itens).toHaveLength(4);
    for (const item of p!.itens) {
      expect(item.erro, item.titulo).toBe(false);
      expect(item.modelo?.valores, item.titulo).toBe(false);
    }
    expect(dinheiroQueSaiu(p)).toEqual([]);
    // O funil continua contando quem chegou a cada etapa.
    const funil = p!.itens.find((i) => i.titulo === "Valor por etapa")!.modelo!;
    expect(funil.ehFunil).toBe(true);
    expect(funil.total.n).toBeGreaterThan(0);
  });
});

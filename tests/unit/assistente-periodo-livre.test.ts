/**
 * FORK MIA (.106) — O ASSISTENTE RESPONDE QUALQUER PERÍODO, LÊ A META DO MÊS
 * EM QUALQUER PERÍODO E NÃO MANDA NINGUÉM PARA TELA SEM CONEXÃO.
 *
 * Os dois casos que motivaram (09/11/2026, dados fictícios aqui):
 *   1. "e semana passada como foi?" voltou "não consigo consultar a semana
 *      passada": a ferramenta só aceitava "mes", "mesp", "7" e "30". E nos
 *      últimos 7 dias a resposta dizia "meta não definida", porque a meta só
 *      era lida em "mes" e "mesp".
 *   2. O assistente mandou a gerente de um cliente para Meta Ads atrás dos
 *      números das campanhas, e a tela abriu "Nenhuma conta de anúncios
 *      conectada": a empresa não tinha a conta da Meta ligada.
 */
import { describe, expect, it, vi } from "vitest";

const metas = vi.hoisted(() => ({ meses: [] as string[] }));

vi.mock("@/lib/crm/metas/ler-do-mes", () => ({
  lerMetasDoMes: async (_db: unknown, _org: string, mes: string) => {
    metas.meses.push(mes);
    return {
      ok: true,
      dados: {
        truncado: false,
        metas: [
          { metrica: "receita_total", agent_id: null, user_id: null, alvo: 100_000_00, realizado: 40_000_00, fracao: 0.4, falta: 60_000_00 },
        ],
      },
    };
  },
}));

const { periodoPedido } = await import("@/lib/assistente/ferramentas");
const { lerPerformance, mesDaMeta } = await import("@/lib/assistente/leituras/performance");
const { telasParaOPapel, TELAS_QUE_DEPENDEM_DE_CONEXAO } = await import("@/lib/assistente/telas");
const { montarSystemDoAssistente } = await import("@/lib/assistente/prompt");

const ORG = "0a000000-0000-4000-8000-000000000106";
const EU = "0b000000-0000-4000-8000-000000000106";
const AGORA = new Date("2026-11-09T18:00:00Z");
const FUSO = "America/Sao_Paulo";

function grupo(chave: string, n: number, soma: number | null) {
  return { chave, n, n_ok: n, valores: { qtd: n, soma }, rotulo: null, ordem: null, sem: false, outros: false };
}

function dbDeMentira() {
  const pedidos: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("fn_mia_relatorio");
      pedidos.push(params);
      const janela = { periodo: params.p_periodo, de: params.p_de ?? "2026-11-03", ate: params.p_ate ?? "2026-11-09", fuso: FUSO };
      if (params.p_dim1 === "resp") {
        return { data: { janela, moeda: "BRL", grupos: [grupo(EU, 2, 3_000_00)], anterior: null }, error: null };
      }
      return {
        data: {
          janela,
          moeda: "BRL",
          grupos: [grupo("ganho", 5, 7_500_00), grupo("perdido", 5, null), grupo("aberto", 12, null)],
          anterior: params.p_comparar
            ? {
                janela: { de: "2026-10-27", ate: "2026-11-02" },
                total: { n: 0, n_ok: 0, valores: {} },
                grupos: { ganho: { n: 3, valores: { soma: 4_000_00 } }, perdido: { n: 1, valores: {} } },
              }
            : null,
        },
        error: null,
      };
    },
  };
  return { db: db as never, pedidos };
}

describe("o período pedido", () => {
  it("sem nada é este mês; com datas e sem período é o personalizado", () => {
    expect(periodoPedido({})).toEqual({ ok: true, periodo: "mes", de: null, ate: null, comparar: false });
    expect(periodoPedido({ de: "2026-11-02", ate: "2026-11-08" })).toEqual({
      ok: true,
      periodo: "pers",
      de: "2026-11-02",
      ate: "2026-11-08",
      comparar: false,
    });
  });

  it('"ontem" é um dia só: uma data serve para as duas pontas', () => {
    expect(periodoPedido({ periodo: "pers", de: "2026-11-08" })).toMatchObject({ ok: true, de: "2026-11-08", ate: "2026-11-08" });
  });

  it('"pers" sem datas, ou com as datas trocadas, volta com o motivo para o modelo refazer', () => {
    expect(periodoPedido({ periodo: "pers" })).toMatchObject({ ok: false });
    expect(periodoPedido({ periodo: "pers", de: "2026-11-08", ate: "2026-11-02" })).toMatchObject({ ok: false });
  });

  it("os períodos fixos ignoram datas soltas", () => {
    expect(periodoPedido({ periodo: "7", de: "2026-01-01" })).toEqual({ ok: true, periodo: "7", de: null, ate: null, comparar: false });
  });
});

describe("a semana passada, comparada com a anterior", () => {
  it("o motor recebe o intervalo e a comparação, e a resposta traz o anterior", async () => {
    metas.meses.length = 0;
    const { db, pedidos } = dbDeMentira();
    const perf = await lerPerformance(db, {
      organizationId: ORG,
      escopo: { tipo: "equipe", userId: EU },
      periodo: "pers",
      de: "2026-11-02",
      ate: "2026-11-08",
      comparar: true,
      agora: AGORA,
      fuso: FUSO,
      equipe: [{ user_id: EU, nome: "Pessoa Exemplo", papel: "admin" }],
    });

    expect(pedidos[0]).toMatchObject({ p_periodo: "pers", p_de: "2026-11-02", p_ate: "2026-11-08", p_comparar: true });
    // O "por pessoa" lê o mesmo intervalo.
    expect(pedidos[1]).toMatchObject({ p_periodo: "pers", p_de: "2026-11-02", p_ate: "2026-11-08" });

    expect(perf.ganhos).toEqual({ quantos: 5, valor_cents: 7_500_00 });
    expect(perf.taxa_de_ganho).toBe(0.5);
    expect(perf.anterior).toEqual({
      janela: { de: "2026-10-27", ate: "2026-11-02" },
      ganhos: { quantos: 3, valor_cents: 4_000_00 },
      perdidos: 1,
      abertos_no_periodo: 0,
      taxa_de_ganho: 0.75,
    });
  });

  it("sem comparar, nada de anterior e o motor não é pedido a comparar", async () => {
    const { db, pedidos } = dbDeMentira();
    const perf = await lerPerformance(db, {
      organizationId: ORG,
      escopo: { tipo: "proprio", userId: EU },
      periodo: "hoje",
      agora: AGORA,
      fuso: FUSO,
      equipe: [],
    });
    expect(pedidos[0]).toMatchObject({ p_periodo: "hoje", p_de: null, p_ate: null, p_comparar: false });
    expect(perf.anterior).toBeNull();
  });
});

describe("a meta do mês em qualquer período", () => {
  it('nos últimos 7 dias a meta é lida (antes vinha "não definida") e o aviso diz que é do mês', async () => {
    metas.meses.length = 0;
    const { db } = dbDeMentira();
    const perf = await lerPerformance(db, {
      organizationId: ORG,
      escopo: { tipo: "equipe", userId: EU },
      periodo: "7",
      agora: AGORA,
      fuso: FUSO,
      equipe: [],
    });
    expect(metas.meses).toEqual(["2026-11"]);
    expect(perf.meta).toMatchObject({ mes: "2026-11", fracao: 0.4 });
    expect(perf.avisos.join(" ")).toContain("A meta é do mês (2026-11)");
  });

  it("o mês da meta segue o período", () => {
    expect(mesDaMeta("mes", AGORA, FUSO)).toBe("2026-11");
    expect(mesDaMeta("mesp", AGORA, FUSO)).toBe("2026-10");
    expect(mesDaMeta("pers", AGORA, FUSO, "2026-10-01", "2026-10-15")).toBe("2026-10");
    // Intervalo que cruza o mês: a meta do mês de agora.
    expect(mesDaMeta("pers", AGORA, FUSO, "2026-10-27", "2026-11-02")).toBe("2026-11");
  });
});

describe("tela que depende de conexão", () => {
  const HREF = "/app/ads/meta";

  it("a tela de Meta Ads depende da conta de anúncios da Meta", () => {
    expect(TELAS_QUE_DEPENDEM_DE_CONEXAO[HREF]?.conexao).toBe("meta_ads");
  });

  it("sem a conta ligada, a tela leva o aviso; ligada ou sem saber, não leva", () => {
    const sem = telasParaOPapel({ papel: "admin", conexoes: { meta_ads: false } }).find((t) => t.href === HREF);
    const com = telasParaOPapel({ papel: "admin", conexoes: { meta_ads: true } }).find((t) => t.href === HREF);
    const semSaber = telasParaOPapel({ papel: "admin" }).find((t) => t.href === HREF);
    expect(sem?.semConexao).toContain("Configurações › Meta Ads");
    expect(com?.semConexao).toBeNull();
    expect(semSaber?.semConexao).toBeNull();
  });

  it("o mapa do prompt marca a tela e a regra diz o que fazer no lugar", () => {
    const telas = telasParaOPapel({ papel: "admin", conexoes: { meta_ads: false } });
    const sistema = montarSystemDoAssistente({
      primeiroNome: "Pessoa",
      papel: "admin",
      idioma: "pt-BR",
      fuso: FUSO,
      agora: AGORA,
      tela: { caminho: "/app", rotulo: null } as never,
      telas,
      base: [],
      nomeDaEmpresa: "Empresa Exemplo",
    });
    expect(sistema).toMatch(/\(\/app\/ads\/meta\):[^\n]*\[SEM CONEXÃO: /);
    expect(sistema).toContain('Tela marcada com "SEM CONEXÃO"');
    expect(sistema).toContain("Nunca diga que não dá para ver um período.");
  });
});

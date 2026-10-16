/**
 * FORK MIA (item 8) — os doze painéis por cima do motor (`lib/paineis/calcular.ts`).
 *
 * O motor é do banco (`fn_mia_relatorio`, provado em
 * `tests/invariants/motor-de-conta-dos-relatorios.test.ts`). Aqui o banco é de
 * mentira e responde com números fixos; o que se mede é a PERGUNTA que cada
 * painel faz (fonte, medidas, agrupamento, filtro, período) e a LEITURA da
 * resposta: nenhuma soma refeita, só escolher grupo, nomear e dividir.
 */
import { describe, expect, it } from "vitest";

import { PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import { calcularPaineis, escolherFunil } from "@/lib/paineis/calcular";

const ORG = "33333333-3333-4333-8333-333333333333";
const FUNIL = "44444444-4444-4444-8444-444444444444";

type Args = Record<string, unknown>;

function grupo(chave: string, n: number, valores: Record<string, number | null> = {}, extra: Record<string, unknown> = {}) {
  return { chave, rotulo: null, ordem: null, sem: chave === "__sem", outros: chave === "__outros", n, n_ok: 0, valores: { qtd: n, ...valores }, ...extra };
}

function resposta(args: Args) {
  const base = {
    fonte: args.p_fonte,
    medidas: args.p_medidas,
    dim1: args.p_dim1,
    dim2: args.p_dim2,
    filtros: args.p_filtros,
    janela: { periodo: args.p_periodo, de: "2026-10-01", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 15 },
    moeda: "BRL",
    valores: args.p_valores,
    total: { n: 0, n_ok: 0, valores: {} as Record<string, number | null> },
    fora_da_moeda: 0,
    grupos: [] as unknown[],
    series: null,
    dobrados: [],
    funil: null,
    meta: null as unknown,
    anterior: null,
  };
  const f = args.p_filtros as Args;
  switch (`${args.p_fonte}:${args.p_dim1 ?? ""}`) {
    case "negocios:situacao":
      return { ...base, total: { n: 10, n_ok: 4, valores: {} }, fora_da_moeda: 1, grupos: [grupo("aberto", 3), grupo("ganho", 4, { soma: 800000, tfechar: 12.5 }), grupo("perdido", 3)] };
    case "negocios:":
      return { ...base, total: { n: 4, n_ok: 4, valores: { soma: 800000 } }, meta: { alvo_cents: 1000000, proporcional: false, meses_sem_meta: 0, fracao: 0.8, corrido: 0.48 } };
    case "negocios:etapa":
      return { ...base, grupos: [grupo("e1", 8, {}, { rotulo: "Novo contato" }), grupo("e2", 6, {}, { rotulo: "Avaliação" }), grupo("e3", 3, {}, { rotulo: "Fechou", ganho: true })] };
    case "negocios:origem":
      return {
        ...base,
        grupos: [
          grupo("meta_ads", 5, {}, { series: { ganho: { n: 2, n_ok: 2, valores: { qtd: 2 } } } }),
          grupo("feira_de_maio", 2),
          grupo("__sem", 0),
        ],
      };
    case "negocios:motivo":
      return { ...base, total: { n: 3, n_ok: 0, valores: {} }, grupos: [grupo("price", 2), grupo("Fechou com o concorrente", 1), grupo("__sem", 0)] };
    case "conversas:quem":
      if ((args.p_medidas as string[]).includes("tresp")) {
        return { ...base, total: { n: 3, n_ok: 1, valores: {} }, grupos: [grupo("agente", 1, { tresp: 12, tresp90: 30 }), grupo("equipe", 1, { tresp: 420, tresp90: 2280 }), grupo("sem_resposta", 1, { tresp: null })] };
      }
      return { ...base, total: { n: 3, n_ok: 1, valores: { resolv: 33.3 } }, grupos: [grupo("agente", 1), grupo("equipe", 1), grupo("sem_resposta", 1)] };
    case "agenda:situacao":
      return { ...base, total: { n: 5, n_ok: 1, valores: {} }, grupos: [grupo("marcado", 1), grupo("confirmado", 1), grupo("compareceu", 1), grupo("faltou", 1), grupo("desmarcou", 1)] };
    case "followup:resultado":
      return { ...base, total: { n: 4, n_ok: 2, valores: { taxa: 50 } }, grupos: [grupo("respondeu", 1), grupo("fechou", 1), grupo("parou", 1), grupo("sem_resposta", 1)] };
    case "anuncios:plataforma":
      return { error: { code: "42501", message: "anuncios_so_para_gestor_ou_administrador" } };
    case "negocios:previsto":
      return { ...base, total: { n: 4, n_ok: 0, valores: { prev: 90000, sem_prob: 1 } }, grupos: [grupo("2026-11", 1, { prev: 10000 }), grupo("__sem", 3, { prev: 80000 })] };
    case "conversas:etiqueta":
      return { ...base, grupos: [grupo("Preço", 2), grupo("Implante", 1), grupo("__sem", 0)] };
    default:
      throw new Error(`pergunta inesperada ao motor: ${JSON.stringify(args)} ${JSON.stringify(f)}`);
  }
}

function bancoDeMentira(opcoes: { vocabulario?: Record<string, string> } = {}) {
  const perguntas: Args[] = [];
  const tabelas: Record<string, unknown[]> = {
    organizations: [{ display_name: "Clínica Exemplo", timezone: "America/Sao_Paulo", currency: "BRL", demonstracao: false }],
    crm_pipelines: [
      { id: "55555555-5555-4555-8555-555555555555", name: "Arquivado", vocabulary: {}, is_default: false, is_archived: true, position: 1 },
      { id: FUNIL, name: "Pacientes", vocabulary: opcoes.vocabulario ?? {}, is_default: true, is_archived: false, position: 2 },
    ],
  };
  const consulta = (nome: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      maybeSingle: async () => ({ data: tabelas[nome]?.[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: tabelas[nome] ?? [], error: null }).then(ok),
    };
    return q;
  };
  return {
    perguntas,
    db: {
      from: consulta,
      rpc: async (_nome: string, args: Args) => {
        perguntas.push(args);
        const r = resposta(args) as { error?: unknown };
        return "error" in r && r.error ? { data: null, error: r.error } : { data: r, error: null };
      },
    },
  };
}

describe("os doze painéis", () => {
  it("⭐ cada painel faz UMA pergunta ao motor, e as certas", async () => {
    const b = bancoDeMentira();
    await calcularPaineis(b.db as never, { organizationId: ORG, periodo: "30" });
    expect(b.perguntas).toHaveLength(PAINEIS_PRONTOS.length);
    for (const p of b.perguntas) expect(p.p_org).toBe(ORG);
    const por = (fonte: string, dim: string | null) => b.perguntas.find((p) => p.p_fonte === fonte && p.p_dim1 === dim)!;
    // A meta é sempre do mês e dos funis em que ganhar é receita.
    expect(por("negocios", null).p_periodo).toBe("mes");
    expect(por("negocios", null).p_filtros).toEqual({ situacao: "ganho", so_receita: true });
    // A previsão olha os abertos de hoje, qualquer que seja a entrada.
    expect(por("negocios", "previsto").p_periodo).toBe("tudo");
    // Os de negócio vão pelo funil principal (o arquivado não conta).
    expect((por("negocios", "situacao").p_filtros as Args).funil).toBe(FUNIL);
    expect(por("negocios", "etapa").p_medidas).toEqual(["chegaram"]);
    // O resto pelo período pedido.
    expect(por("conversas", "etiqueta").p_periodo).toBe("30");
  });

  it("⭐ a leitura: nenhuma soma refeita, só escolher grupo, nomear e dividir", async () => {
    const b = bancoDeMentira({ vocabulario: { compromisso_plural: "Avaliações", won: "Tratamento fechado" } });
    const r = await calcularPaineis(b.db as never, { organizationId: ORG, periodo: "30" });
    const dados = Object.fromEntries(r.paineis.map((p) => [p.chave, p]));

    expect(dados.resultado!.dados).toMatchObject({ tipo: "resultado", ganhos: 4, perdidos: 3, abertos: 3, taxaDeGanho: 57.1, valorGanho: 800000, diasAteFechar: 12.5, foraDaMoeda: 1 });
    expect(dados.meta!.dados).toMatchObject({ temMeta: true, alvo: 1000000, realizado: 800000, fracao: 0.8, corrido: 0.48 });
    expect(dados.funil!.dados).toMatchObject({
      etapas: [
        { nome: "Novo contato", chegaram: 8, seguemAdiante: 75 },
        { nome: "Avaliação", chegaram: 6, seguemAdiante: 50 },
        { nome: "Fechou", chegaram: 3, seguemAdiante: null, ganho: true },
      ],
    });
    // Origem conhecida ganha rótulo (a traduzir); a desconhecida sai como foi gravada; o "Sem" fica.
    expect(dados.origem!.dados).toMatchObject({
      linhas: [
        { chave: "meta_ads", rotulo: "Anúncio da Meta", traduzir: true, n: 5, fecharam: 2 },
        { chave: "feira_de_maio", rotulo: "feira_de_maio", traduzir: false, n: 2, fecharam: 0 },
        { chave: "__sem", rotulo: "Sem origem", traduzir: true, n: 0 },
      ],
    });
    // O motivo canônico ganha o rótulo do produto; o do funil é dado.
    expect(dados.perdas!.dados).toMatchObject({
      total: 3,
      linhas: [
        { chave: "price", rotulo: "Preço", traduzir: true },
        { chave: "Fechou com o concorrente", rotulo: "Fechou com o concorrente", traduzir: false },
        { chave: "__sem", rotulo: "Sem motivo" },
      ],
    });
    expect(dados.atendimento!.dados).toMatchObject({ total: 3, agente: 1, equipe: 1, semResposta: 1, resolvidas: 33.3 });
    expect(dados.resposta!.dados).toMatchObject({ agente: 12, equipeMetade: 420, equipeNoveEmDez: 2280 });
    // Desmarcado não é compromisso de pé; confirmado inclui quem já veio ou faltou.
    expect(dados.agenda!.dados).toMatchObject({ marcadas: 4, confirmadas: 3, realizadas: 1, faltas: 1, desmarcadas: 1, taxaDeFaltas: 50 });
    expect(dados.followup!.dados).toMatchObject({ receberam: 4, responderam: 2, viraramVenda: 1, pediramParaParar: 1, taxa: 50 });
    expect(dados.previsao!.dados).toMatchObject({ previsto: 90000, abertos: 4, semProbabilidade: 1, meses: [{ chave: "2026-11", previsto: 10000 }, { chave: "__sem", previsto: 80000 }] });
    expect(dados.assuntos!.dados).toMatchObject({
      linhas: [
        { chave: "Preço", rotulo: "Preço", traduzir: false, n: 2 },
        { chave: "Implante", n: 1 },
        { chave: "__sem", rotulo: "Sem etiqueta", n: 0 },
      ],
    });
  });

  it("⭐ a palavra do segmento vem do vocabulário do funil, não de código por nicho", async () => {
    const com = await calcularPaineis(bancoDeMentira({ vocabulario: { compromisso_plural: "Visitas" } }).db as never, {
      organizationId: ORG,
      periodo: "30",
      paineis: ["agenda"],
    });
    expect(com.paineis[0]).toMatchObject({ titulo: "Visitas", tituloEDado: true });
    const sem = await calcularPaineis(bancoDeMentira().db as never, { organizationId: ORG, periodo: "30", paineis: ["agenda"] });
    expect(sem.paineis[0]).toMatchObject({ titulo: "Agenda", tituloEDado: false });
  });

  it("o painel recusado pelo motor (anúncios sem ser gestor) diz isso, e não derruba os outros", async () => {
    const r = await calcularPaineis(bancoDeMentira().db as never, { organizationId: ORG, periodo: "30" });
    const anuncios = r.paineis.find((p) => p.chave === "anuncios")!;
    expect(anuncios).toMatchObject({ restrito: "so_gestor", dados: null, erro: null });
    expect(r.paineis.filter((p) => p.dados !== null)).toHaveLength(PAINEIS_PRONTOS.length - 1);
  });

  it("só os painéis pedidos, na ordem pedida, sem repetir", async () => {
    const b = bancoDeMentira();
    const r = await calcularPaineis(b.db as never, { organizationId: ORG, periodo: "7", paineis: ["meta", "resultado", "meta"] });
    expect(r.paineis.map((p) => p.chave)).toEqual(["meta", "resultado"]);
    expect(b.perguntas).toHaveLength(2);
  });

  it("sem valores, o motor é perguntado sem valores", async () => {
    const b = bancoDeMentira();
    await calcularPaineis(b.db as never, { organizationId: ORG, periodo: "30", paineis: ["resultado"], valores: false });
    expect(b.perguntas[0]!.p_valores).toBe(false);
  });
});

describe("o funil dos painéis", () => {
  const funis = [
    { id: "a", name: "A", vocabulary: {}, is_default: false, is_archived: false, position: 2 },
    { id: "b", name: "B", vocabulary: {}, is_default: true, is_archived: false, position: 3 },
    { id: "c", name: "C", vocabulary: {}, is_default: false, is_archived: true, position: 1 },
  ];
  it("o pedido, se for da empresa e não estiver arquivado; senão, o principal", () => {
    expect(escolherFunil(funis, "a")?.id).toBe("a");
    expect(escolherFunil(funis, "c")?.id).toBe("b");
    expect(escolherFunil(funis, "outro")?.id).toBe("b");
    expect(escolherFunil(funis, null)?.id).toBe("b");
    expect(escolherFunil(funis.map((f) => ({ ...f, is_default: false })), null)?.id).toBe("a");
  });
});

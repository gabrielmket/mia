/**
 * FORK MIA (MIA-103) · as duas leituras novas do MCP de plataforma, pelo
 * servidor inteiro (tools/list, a conferência dos argumentos, o handler e a
 * resposta):
 *
 *   plataforma_ver_analise_do_funil   a Análise do funil de um cliente
 *   plataforma_ver_conversas_do_mes   as conversas do mês por quem respondeu
 *
 * O funil é medido contra a PRÓPRIA rota da tela (`/api/v1/metrics/funil`) sobre
 * o mesmo banco de memória: a ferramenta tem de dar os mesmos números, e a
 * empresa vizinha não entra. As conversas são do motor (`fn_mia_relatorio`), que
 * responde aqui com números fixos (a conta de verdade é do Postgres, provada em
 * `tests/invariants/motor-de-conta-dos-relatorios.test.ts`): o que se mede é o
 * pedido que a ferramenta faz e como ela lê a resposta.
 *
 * Dados fictícios: Academia Alfa, com a Ana Exemplo na equipe.
 */
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnaliseDoFunil } from "@/lib/implantacao/analise-do-funil";
import {
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  ORG,
  OUTRA_ORG,
} from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
// A rota da tela, pelo ramo do token da empresa: cliente de serviço e a organização da linha do token.
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(async () => ({ ok: true, supabase: estado.cliente, organizationId: ORG, idioma: "pt-BR" })),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { GET: rotaDoFunil } = await import("@/app/api/v1/metrics/funil/route");

type Analise = AnaliseDoFunil & { empresa: string; periodo: unknown };

const AGORA = "2026-11-20T12:00:00.000Z";
const ANA = "0b000000-0000-4000-8000-0000000000a1";

let cenario: ReturnType<typeof cenarioDaImplantacao>;
const pedidosAoMotor: Array<Record<string, unknown>> = [];
const pedidosDeAtrito: Array<Record<string, unknown>> = [];

/** As etapas do funil semeado, na ordem. */
function etapas(): Array<{ id: string; name: string }> {
  return (cenario.banco.db.crm_stages ?? [])
    .filter((e) => e.pipeline_id === FUNIL_SEMEADO)
    .sort((a, b) => Number(a.position) - Number(b.position)) as Array<{ id: string; name: string }>;
}

/** As três primeiras etapas do funil semeado (o semeador cria pelo menos três). */
function tresEtapas(): [{ id: string }, { id: string }, { id: string }] {
  const [s0, s1, s2] = etapas();
  if (!s0 || !s1 || !s2) throw new Error("o funil semeado precisa de três etapas");
  return [s0, s1, s2];
}

function lead(org: string, extra: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organization_id: org,
    pipeline_id: FUNIL_SEMEADO,
    value_cents: null,
    currency: "BRL",
    closed_at: null,
    recurring_value_cents: null,
    recurring_period: null,
    nao_comercial_em: null,
    owner_id: ANA,
    ...extra,
  };
}

function passagem(org: string, leadId: string, quando: string, payload: Record<string, unknown>) {
  return { id: randomUUID(), organization_id: org, lead_id: leadId, type: "stage_changed", performed_at: quando, payload };
}

/** O mês de outubro da Academia Alfa, com um negócio de setembro na borda e um da empresa vizinha. */
function semearOutubro() {
  const [s0, s1, s2] = tresEtapas();
  const ganho = lead(ORG, {
    stage_id: s2.id,
    status: "won",
    source: "instagram",
    value_cents: 50000,
    created_at: "2026-10-05T13:00:00.000Z",
    closed_at: "2026-10-15T13:00:00.000Z",
  });
  const perdido = lead(ORG, {
    stage_id: s1.id,
    status: "lost",
    source: "site",
    value_cents: 30000,
    created_at: "2026-10-10T13:00:00.000Z",
    closed_at: "2026-10-20T13:00:00.000Z",
  });
  // 23h30 de 30/09 em Brasília (02h30 de 01/10 em UTC): é de setembro para a Academia Alfa.
  const daBorda = lead(ORG, { stage_id: s0.id, status: "open", source: "site", created_at: "2026-10-01T02:30:00.000Z" });
  const daVizinha = lead(OUTRA_ORG, { stage_id: s0.id, status: "won", source: "site", value_cents: 990000, created_at: "2026-10-07T13:00:00.000Z", closed_at: "2026-10-08T13:00:00.000Z" });

  cenario.banco.db.crm_leads = [ganho, perdido, daBorda, daVizinha];
  cenario.banco.db.crm_lead_activities = [
    // A grafia das rotas de movimento…
    passagem(ORG, ganho.id, "2026-10-06T13:00:00.000Z", { from_stage_id: s0.id, to_stage_id: s1.id }),
    passagem(ORG, ganho.id, "2026-10-15T13:00:00.000Z", { from_stage_id: s1.id, to_stage_id: s2.id }),
    // …e a do agente, que a rota também lê.
    passagem(ORG, perdido.id, "2026-10-11T13:00:00.000Z", { de: s0.id, para: s1.id }),
    passagem(OUTRA_ORG, daVizinha.id, "2026-10-07T14:00:00.000Z", { from_stage_id: s0.id, to_stage_id: s1.id }),
  ];
}

/** O que o motor devolve para a fonte "conversas" agrupada por quem respondeu. */
function respostaDasConversas(args: Record<string, unknown>) {
  const pers = args.p_periodo === "pers";
  const comCanal = args.p_dim2 === "canal";
  const g = (chave: string, n: number, valores: Record<string, number>, series?: Record<string, number>) => ({
    chave,
    rotulo: null,
    ordem: null,
    sem: false,
    outros: false,
    n,
    n_ok: 0,
    valores: { qtd: n, ...valores },
    ...(comCanal && series
      ? { series: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, { n: v, n_ok: 0, valores: { qtd: v } }])) }
      : {}),
  });
  return {
    fonte: "conversas",
    medidas: args.p_medidas,
    dim1: args.p_dim1,
    dim2: args.p_dim2,
    filtros: {},
    janela: {
      periodo: args.p_periodo,
      de: pers ? args.p_de : "2026-11-01",
      ate: pers ? args.p_ate : "2026-11-20",
      inicio: null,
      fim: null,
      fuso: "America/Sao_Paulo",
      hoje: "2026-11-20",
      futuro: false,
      dias: pers ? 31 : 20,
    },
    moeda: "BRL",
    valores: false,
    total: { n: 47, n_ok: 0, valores: { qtd: 47, resolv: 68.1, tresp: 30, tresp90: 600 } },
    // Ninguém ficou sem resposta: o grupo não vem, e a ferramenta o mostra com zero.
    grupos: [
      g("agente", 32, { tresp: 12, tresp90: 40 }, { whatsapp: 30, instagram: 2 }),
      g("equipe", 15, { tresp: 420, tresp90: 3600 }, { whatsapp: 15 }),
    ],
    series: comCanal
      ? [
          { chave: "whatsapp", rotulo: null, sem: false, outros: false, n: 45 },
          { chave: "instagram", rotulo: null, sem: false, outros: false, n: 2 },
        ]
      : null,
    dobrados: [],
    fora_da_moeda: 0,
    funil: null,
    meta: null,
    anterior: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
  cenario = cenarioDaImplantacao();
  const org = (cenario.banco.db.organizations ?? [])[0]!;
  org.display_name = "Academia Alfa";
  org.legal_name = "Academia Alfa LTDA";
  cenario.usuarios.set(ANA, { email: "ana@exemplo.invalid", nome: "Ana Exemplo" });
  (cenario.banco.db.user_organizations ??= []).push({
    id: randomUUID(),
    organization_id: ORG,
    user_id: ANA,
    role: "agent",
    accepted_at: "2026-01-01T00:00:00Z",
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
  });
  pedidosAoMotor.length = 0;
  pedidosDeAtrito.length = 0;
  const rpcDoCenario = cenario.cliente.rpc;
  cenario.cliente.rpc = async (nome: string, args: unknown) => {
    if (nome === "fn_mia_relatorio") {
      pedidosAoMotor.push(args as Record<string, unknown>);
      return { data: respostaDasConversas(args as Record<string, unknown>), error: null };
    }
    if (nome === "fn_atrito_metrics") {
      pedidosDeAtrito.push(args as Record<string, unknown>);
      return { data: { cliente: { turnos_p50: 3, turnos_p90: 7, descadastros: 1 } }, error: null };
    }
    return rpcDoCenario(nome, args);
  };
  estado.cliente = cenario.cliente;
});

afterEach(() => {
  vi.useRealTimers();
});

async function chamar(nome: string, args: Record<string, unknown>) {
  const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
  const r = await mcp.chamar(nome, args);
  await mcp.fechar();
  return r;
}

describe("a lista", () => {
  it("as duas estão lá, as duas só leem, e a lista tem 130 (124 + as duas dos preços da Meta, MIA-99, + as duas da MIA-103 + as duas das conversões do site, MIA-169)", () => {
    expect(FERRAMENTAS).toHaveLength(130);
    const operacao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.operacao;
    expect(operacao("plataforma_ver_analise_do_funil")).toBeNull();
    expect(operacao("plataforma_ver_conversas_do_mes")).toBeNull();
  });
});

describe("plataforma_ver_analise_do_funil", () => {
  it("⭐ outubro da Academia Alfa: os mesmos números da rota da tela, sem a empresa vizinha", async () => {
    semearOutubro();
    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG, mes: "2026-10" });
    expect(r.erro, r.texto).toBe(false);
    const d = r.dados as unknown as Analise;

    expect(d.empresa).toBe("Academia Alfa");
    expect(d.periodo).toEqual({ tipo: "mes", mes: "2026-10", de: "2026-10-01", ate: "2026-10-31" });
    // O mês no fuso da empresa: 00h de 01/10 a 00h de 01/11 em Brasília.
    expect(d.janela).toEqual({ from: "2026-10-01T03:00:00.000Z", to: "2026-11-01T03:00:00.000Z" });

    const [s0, s1] = tresEtapas();
    const linha = (id: string) => d.conversao.etapas.find((e) => e.etapa.id === id)!;
    // Os dois de outubro entraram na primeira etapa e passaram; o da borda (setembro) não conta.
    expect(linha(s0.id)).toMatchObject({ entraram: 2, passaram: 2, taxa: 1 });
    expect(linha(s1.id)).toMatchObject({ entraram: 2, passaram: 1, taxa: 0.5 });
    expect(d.dias_ate_fechar).toMatchObject({ medida: "mediana", mediana: 10, amostra: 1 });
    expect(d.origem.linhas).toEqual([
      { origem: "instagram", status: "won", quantidade: 1, por_moeda: [{ moeda: "BRL", quantidade: 1, valor_cents: 50000 }] },
      { origem: "site", status: "lost", quantidade: 1, por_moeda: [{ moeda: "BRL", quantidade: 1, valor_cents: 30000 }] },
    ]);
    expect(d.valores_do_periodo.unico).toEqual({ centavos: 50000, negocios: 1 });
    expect(d.contra_metrica.turnos).toMatchObject({ p50: 3, p90: 7 });
    expect(pedidosDeAtrito).toEqual([{ p_org: ORG, p_from: "2026-10-01T03:00:00.000Z", p_to: "2026-11-01T03:00:00.000Z" }]);
    expect(d.truncado).toBe(false);

    // A rota da tela, na mesma janela e no mesmo banco.
    const res = await rotaDoFunil(
      new NextRequest(`http://localhost/api/v1/metrics/funil?from=${d.janela.from}&to=${d.janela.to}`),
    );
    expect(res.status).toBe(200);
    const tela = ((await res.json()) as { data: Analise }).data;
    for (const campo of ["janela", "base", "conversao", "dias_ate_fechar", "origem", "vazio", "truncado", "valores_do_periodo"] as const) {
      expect(d[campo], `${campo} diverge da tela`).toEqual(tela[campo]);
    }
    expect(d.contra_metrica.turnos).toEqual(tela.contra_metrica.turnos);
    expect(d.contra_metrica.opt_outs).toEqual(tela.contra_metrica.opt_outs);

    // Só números somados: nenhum nome de pessoa da equipe.
    expect(r.texto).not.toContain("Ana Exemplo");
  });

  it("negócio não comercial (#4191): fica fora da conta, como na rota da tela", async () => {
    semearOutubro();
    const [s0, s1] = tresEtapas();
    // Criado em outubro, aberto, e classificado pela equipe como NÃO comercial: sem o corte, viraria
    // uma linha nova de origem e mais uma entrada na primeira etapa.
    const naoComercial = lead(ORG, {
      stage_id: s1.id,
      status: "open",
      source: "whatsapp",
      created_at: "2026-10-12T13:00:00.000Z",
      nao_comercial_em: "2026-10-13T13:00:00.000Z",
    });
    cenario.banco.db.crm_leads = [...(cenario.banco.db.crm_leads ?? []), naoComercial];
    cenario.banco.db.crm_lead_activities = [
      ...(cenario.banco.db.crm_lead_activities ?? []),
      passagem(ORG, naoComercial.id, "2026-10-12T14:00:00.000Z", { from_stage_id: s0.id, to_stage_id: s1.id }),
    ];

    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG, mes: "2026-10" });
    expect(r.erro, r.texto).toBe(false);
    const d = r.dados as unknown as Analise;
    const linha = (id: string) => d.conversao.etapas.find((e) => e.etapa.id === id)!;
    expect(linha(s0.id)).toMatchObject({ entraram: 2, passaram: 2 });
    expect(d.origem.linhas.map((l) => l.origem)).not.toContain("whatsapp");

    const res = await rotaDoFunil(
      new NextRequest(`http://localhost/api/v1/metrics/funil?from=${d.janela.from}&to=${d.janela.to}`),
    );
    expect(res.status).toBe(200);
    const tela = ((await res.json()) as { data: Analise }).data;
    for (const campo of ["base", "conversao", "dias_ate_fechar", "origem", "valores_do_periodo"] as const) {
      expect(d[campo], `${campo} diverge da tela`).toEqual(tela[campo]);
    }
  });

  it("sem `mes`: os últimos 30 dias até agora, como o botão padrão da tela", async () => {
    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.periodo).toEqual({ tipo: "dias", dias: 30 });
    expect(r.dados.janela).toEqual({ from: "2026-10-21T12:00:00.000Z", to: AGORA });
    expect((r.dados.vazio as { motivo: string }).motivo).toMatch(/sem dado/);
  });

  it("o mês corrente vai até agora", async () => {
    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG, mes: "2026-11" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.periodo).toEqual({ tipo: "mes", mes: "2026-11", de: "2026-11-01", ate: "2026-11-20" });
    expect(r.dados.janela).toEqual({ from: "2026-11-01T03:00:00.000Z", to: AGORA });
  });

  it("mês que ainda não começou: recusa que diz qual é o mês corrente, e nada é lido", async () => {
    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG, mes: "2026-12" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/ainda não começou/);
    expect(r.texto).toContain("2026-11");
    expect(pedidosDeAtrito).toHaveLength(0);
  });

  it("janela fora das da tela é recusada pela validação", async () => {
    const r = await chamar("plataforma_ver_analise_do_funil", { organization_id: ORG, dias: 45 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("dias");
  });
});

describe("plataforma_ver_conversas_do_mes", () => {
  it("⭐ outubro: pede ao motor a fonte do montador, agrupada por quem respondeu, só da Academia Alfa", async () => {
    const r = await chamar("plataforma_ver_conversas_do_mes", { organization_id: ORG, mes: "2026-10" });
    expect(r.erro, r.texto).toBe(false);

    expect(pedidosAoMotor).toHaveLength(1);
    expect(pedidosAoMotor[0]).toMatchObject({
      p_org: ORG,
      p_fonte: "conversas",
      p_medidas: ["qtd", "resolv", "tresp", "tresp90"],
      p_dim1: "quem",
      p_dim2: null,
      p_periodo: "pers",
      p_de: "2026-10-01",
      p_ate: "2026-10-31",
      p_valores: false,
    });

    expect(r.dados).toMatchObject({
      empresa: "Academia Alfa",
      mes: "2026-10",
      de: "2026-10-01",
      ate: "2026-10-31",
      conversas: 47,
      resolvidas_pelo_agente_pct: 68.1,
      primeira_resposta_em_segundos: {
        agente: { metade_esperou_ate: 12, nove_em_dez_esperaram_ate: 40 },
        equipe: { metade_esperou_ate: 420, nove_em_dez_esperaram_ate: 3600 },
      },
    });
    // Os três, sempre, na mesma ordem; o que não veio do motor é zero.
    expect(r.dados.por_quem).toEqual([
      { quem: "agente", rotulo: "Agente resolveu", conversas: 32 },
      { quem: "equipe", rotulo: "Passou para a equipe", conversas: 15 },
      { quem: "sem_resposta", rotulo: "Sem resposta", conversas: 0 },
    ]);
    expect(r.dados).not.toHaveProperty("por_canal");
    expect(r.texto).not.toContain("Ana Exemplo");
  });

  it("por canal: os três grupos dentro de cada canal", async () => {
    const r = await chamar("plataforma_ver_conversas_do_mes", { organization_id: ORG, mes: "2026-10", por_canal: true });
    expect(r.erro, r.texto).toBe(false);
    expect(pedidosAoMotor[0]).toMatchObject({ p_dim1: "quem", p_dim2: "canal" });
    expect(r.dados.por_canal).toEqual([
      { canal: "whatsapp", rotulo: "WhatsApp", conversas: 45, agente: 30, equipe: 15, sem_resposta: 0 },
      { canal: "instagram", rotulo: "Instagram", conversas: 2, agente: 2, equipe: 0, sem_resposta: 0 },
    ]);
  });

  it.each([[{}], [{ mes: "2026-11" }]])("o mês corrente (%j) é o \"Este mês\" da tela, até hoje", async (extra) => {
    const r = await chamar("plataforma_ver_conversas_do_mes", { organization_id: ORG, ...extra });
    expect(r.erro, r.texto).toBe(false);
    expect(pedidosAoMotor[0]).toMatchObject({ p_periodo: "mes", p_de: null, p_ate: null });
    expect(r.dados).toMatchObject({ mes: "2026-11", de: "2026-11-01", ate: "2026-11-20" });
  });

  it("mês que ainda não começou: recusa, e o motor não é chamado", async () => {
    const r = await chamar("plataforma_ver_conversas_do_mes", { organization_id: ORG, mes: "2027-01" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/ainda não começou/);
    expect(pedidosAoMotor).toHaveLength(0);
  });

  it("mês mal escrito: a recusa da validação ensina o formato", async () => {
    const r = await chamar("plataforma_ver_conversas_do_mes", { organization_id: ORG, mes: "10/2026" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("AAAA-MM");
    expect(pedidosAoMotor).toHaveLength(0);
  });
});

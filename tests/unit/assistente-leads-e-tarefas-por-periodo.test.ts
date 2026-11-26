/**
 * FORK MIA (MIA-244) — O ASSISTENTE VOLTA A RESPONDER "QUANTOS LEADS", COM
 * PERÍODO, FUNIL E TAREFAS CONCLUÍDAS.
 *
 * O diagnóstico da MIA-239 (produção, 25/11) achou `ver_meus_leads` falhando nas
 * seis vezes em que foi chamada, e nenhuma resposta com a fonte "Funis/Radar".
 * As duas causas, reproduzidas aqui com um cliente em memória que se comporta
 * como o PostgREST desta instalação (`tests/support/supabase-em-memoria.ts`):
 *
 *   1. o Radar lançava (qualquer leitura dele que falhe, a agenda por exemplo)
 *      e a ferramenta inteira caía junto, no `{ erro }` de "tente de novo";
 *   2. a contagem dos abertos vinha das linhas lidas, e o PostgREST devolve no
 *      máximo 1.000: com 1.500 abertos, a resposta seria "1.000".
 *
 * Os dois primeiros blocos ficam VERMELHOS no código de antes (provado no PR).
 * Depois vêm as perguntas reais do diagnóstico, com dado fictício (Academia
 * Alfa, Ana Exemplo): "quantos leads chegaram hoje", "na semana passada", "no fim
 * de semana no funil Comercial" e "quantas tarefas concluí hoje".
 *
 * Fuso America/Sao_Paulo (UTC-3); "agora" é quarta, 25/11/2026, 12h.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const avisos = vi.hoisted(() => [] as Array<{ msg: string; ctx: unknown }>);
vi.mock("@/lib/logger", () => ({
  logger: {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (msg: string, ctx?: unknown) => {
      avisos.push({ msg, ctx });
    },
  },
}));

import { bancoEmMemoria } from "../support/supabase-em-memoria";

const { ColetorDoTurno, ferramentasDoAssistente } = await import("@/lib/assistente/ferramentas");
const { telasParaOPapel } = await import("@/lib/assistente/telas");

const ORG = "0a000000-0000-4000-8000-000000000244";
const ANA = "0b000000-0000-4000-8000-0000000002a1";
const BETO = "0b000000-0000-4000-8000-0000000002a2";
const CARLA = "0b000000-0000-4000-8000-0000000002a3";
const DAVI = "0b000000-0000-4000-8000-0000000002a4";
const COMERCIAL = "0c000000-0000-4000-8000-000000000001";
const POS_VENDA = "0c000000-0000-4000-8000-000000000002";
const ETAPA = "0d000000-0000-4000-8000-000000000001";
const AGORA = new Date("2026-11-25T15:00:00Z");
const FUSO = "America/Sao_Paulo";

const EQUIPE = [
  { user_id: ANA, nome: "Ana Exemplo", papel: "agent" as const },
  { user_id: BETO, nome: "Beto Exemplo", papel: "agent" as const },
  { user_id: CARLA, nome: "Carla Exemplo", papel: "manager" as const },
  { user_id: DAVI, nome: "Davi Exemplo", papel: "admin" as const },
];

let seq = 0;
function uuid(prefixo: string): string {
  seq += 1;
  return `${prefixo}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function lead(p: {
  criado: string;
  source: string;
  funil: string;
  dono: string | null;
  status?: "open" | "won";
  contato?: string | null;
  atividade?: string | null;
}) {
  return {
    id: uuid("1e000000"),
    organization_id: ORG,
    title: "Plano da Academia Alfa",
    contact_id: p.contato ?? null,
    owner_user_id: p.dono,
    owner_kind: p.dono ? "user" : null,
    owner_agent_id: null,
    stage_id: ETAPA,
    pipeline_id: p.funil,
    status: p.status ?? "open",
    closed_at: p.status === "won" ? p.criado : null,
    nao_comercial_em: null,
    source: p.source,
    created_at: p.criado,
    last_activity_at: p.atividade ?? null,
  };
}

/** 1.500 abertos antigos (acima do teto de 1.000 do PostgREST), com contato, e os recentes das perguntas. */
function base() {
  seq = 0;
  const donos = [ANA, BETO, null];
  const antigos = Array.from({ length: 1500 }, (_, i) =>
    lead({
      criado: "2026-01-10T12:00:00.000Z",
      source: "manual",
      funil: i % 2 ? COMERCIAL : POS_VENDA,
      dono: donos[i % 3]!,
      contato: uuid("2c000000"),
    }),
  );
  const recentes = [
    // hoje (25/11 em Brasília)
    lead({ criado: "2026-11-25T11:00:00.000Z", source: "meta_ads", funil: COMERCIAL, dono: ANA }),
    lead({ criado: "2026-11-25T13:30:00.000Z", source: "whatsapp", funil: COMERCIAL, dono: BETO }),
    lead({ criado: "2026-11-25T14:00:00.000Z", source: "site", funil: POS_VENDA, dono: null, status: "won" }),
    // 24/11 às 23h30 em Brasília: já é 25/11 em UTC, e NÃO é hoje
    lead({ criado: "2026-11-25T02:30:00.000Z", source: "meta_ads", funil: COMERCIAL, dono: ANA }),
    // o fim de semana (21 e 22/11)
    lead({ criado: "2026-11-21T15:00:00.000Z", source: "meta_ads", funil: COMERCIAL, dono: ANA }),
    lead({ criado: "2026-11-21T20:00:00.000Z", source: "instagram", funil: COMERCIAL, dono: BETO }),
    lead({ criado: "2026-11-22T12:00:00.000Z", source: "whatsapp", funil: COMERCIAL, dono: null }),
    lead({ criado: "2026-11-22T16:00:00.000Z", source: "site", funil: POS_VENDA, dono: ANA }),
    // domingo 22/11 às 23h em Brasília (segunda em UTC): ainda é fim de semana
    lead({ criado: "2026-11-23T02:00:00.000Z", source: "meta_ads", funil: COMERCIAL, dono: BETO }),
    // a semana passada, nos dias úteis
    lead({ criado: "2026-11-16T12:00:00.000Z", source: "manual", funil: COMERCIAL, dono: ANA }),
    lead({ criado: "2026-11-18T12:00:00.000Z", source: "meta_ads", funil: POS_VENDA, dono: BETO }),
    // domingo 15/11 às 23h em Brasília: a semana ANTERIOR à passada
    lead({ criado: "2026-11-16T02:00:00.000Z", source: "meta_ads", funil: COMERCIAL, dono: ANA }),
  ];
  const tarefa = (p: { dono: string; status: string; alterada: string }) => ({
    id: uuid("7a000000"),
    organization_id: ORG,
    title: "Ligar para a aluna nova",
    due_date: null,
    status: p.status,
    assigned_to: p.dono,
    updated_at: p.alterada,
  });
  return {
    crm_pipelines: [
      { id: COMERCIAL, organization_id: ORG, name: "Comercial", is_archived: false },
      { id: POS_VENDA, organization_id: ORG, name: "Pós-venda", is_archived: false },
    ],
    crm_stages: [{ id: ETAPA, organization_id: ORG, expected_duration_hours: null }],
    crm_leads: [...antigos, ...recentes],
    crm_tasks: [
      tarefa({ dono: ANA, status: "done", alterada: "2026-11-25T12:00:00.000Z" }),
      tarefa({ dono: ANA, status: "done", alterada: "2026-11-25T14:30:00.000Z" }),
      // 24/11 às 23h em Brasília: concluída ONTEM
      tarefa({ dono: ANA, status: "done", alterada: "2026-11-25T02:00:00.000Z" }),
      tarefa({ dono: ANA, status: "pending", alterada: "2026-11-25T13:00:00.000Z" }),
      tarefa({ dono: BETO, status: "done", alterada: "2026-11-25T13:00:00.000Z" }),
    ],
    organizations: [{ id: ORG, settings: {} }],
  };
}

type Papel = "agent" | "manager" | "admin";
const QUEM: Record<Papel, string> = { agent: ANA, manager: CARLA, admin: DAVI };

function ferramentas(papel: Papel, opcoes: Parameters<typeof bancoEmMemoria>[1] = {}) {
  const { db } = bancoEmMemoria(base(), opcoes);
  const coletor = new ColetorDoTurno();
  const tools = ferramentasDoAssistente(
    {
      db: db as never,
      organizationId: ORG,
      userId: QUEM[papel],
      papel,
      idioma: "pt-BR",
      fuso: FUSO,
      agora: AGORA,
      telas: telasParaOPapel({ papel }),
      equipe: EQUIPE,
      base: [],
      ultimaRecusa: null,
    },
    coletor,
  );
  const chamar = async (nome: string, args: Record<string, unknown> = {}) =>
    (await tools[nome]!.execute!(args as never, { toolCallId: nome, messages: [] })) as Record<string, any>;
  return { chamar, coletor };
}

/** A agenda do Radar fora do ar: o Radar lança `radar_agenda_indisponivel`. */
const AGENDA_FORA = { falhas: { calendar_appointments: { message: "TypeError: fetch failed" } } };

beforeEach(() => {
  avisos.length = 0;
});

describe("causa 1: o Radar que falha não derruba a ferramenta (vermelho no código de antes)", () => {
  it.each(["agent", "manager", "admin"] as const)("com a agenda do Radar fora, %s recebe os leads, sem o erro", async (papel) => {
    const { chamar, coletor } = ferramentas(papel, AGENDA_FORA);
    const r = await chamar("ver_meus_leads");
    expect(r.erro, JSON.stringify(r).slice(0, 200)).toBeUndefined();
    expect(r.abertos).toBeGreaterThan(0);
    expect(r.em_risco).toBeNull();
    expect(r.avisos.join(" ")).toContain("O Radar não respondeu");
    expect(coletor.fontes.has("Funis")).toBe(true);
    expect(coletor.fontes.has("Radar")).toBe(false);
  });

  it("a falha do Radar vai ao log com o código, e sem texto", async () => {
    const { chamar } = ferramentas("admin", AGENDA_FORA);
    await chamar("ver_meus_leads");
    const radar = avisos.find((a) => a.msg.includes("radar"));
    expect(radar?.ctx).toEqual({ codigo: "radar_agenda_indisponivel" });
  });

  it("com o Radar de pé, vem o em risco e a fonte Radar", async () => {
    const { chamar, coletor } = ferramentas("admin");
    const r = await chamar("ver_meus_leads");
    expect(r.erro).toBeUndefined();
    expect(r.em_risco).toBeGreaterThan(0);
    expect(r.avisos).toEqual([]);
    expect(coletor.fontes.has("Radar")).toBe(true);
  });
});

describe("causa 2: o total de abertos não para no teto de 1.000 linhas (vermelho no código de antes)", () => {
  it("o administrador vê os 1.500 antigos e os 11 recentes ainda abertos", async () => {
    const { chamar } = ferramentas("admin");
    const r = await chamar("ver_meus_leads");
    expect(r.abertos).toBe(1500 + 11);
  });

  it("a divisão por dono soma os abertos inteiros (em páginas)", async () => {
    const { chamar } = ferramentas("manager");
    const r = await chamar("ver_meus_leads");
    const somados = r.por_dono.reduce((s: number, p: { abertos: number }) => s + p.abertos, 0) + r.sem_dono;
    expect(somados).toBe(r.abertos);
    expect(r.truncado).toBe(false);
  });

  it("a atendente conta só os dela", async () => {
    const { chamar } = ferramentas("agent");
    const r = await chamar("ver_meus_leads");
    // 500 antigos (um a cada três) e 6 recentes ainda abertos.
    expect(r.abertos).toBe(500 + 6);
    expect(r.por_dono).toBeNull();
  });
});

describe('"quantos leads chegaram hoje?"', () => {
  it("a equipe: três hoje, por origem e por funil; o das 23h30 de ontem fica fora", async () => {
    const { chamar } = ferramentas("admin");
    const r = await chamar("ver_meus_leads", { periodo: "hoje" });
    expect(r.chegaram).toMatchObject({ periodo: "hoje", janela: { de: "2026-11-25", ate: "2026-11-25" }, total: 3, ainda_abertos: 2 });
    expect(r.chegaram.por_origem).toEqual(
      expect.arrayContaining([
        { rotulo: "Meta", quantos: 1 },
        { rotulo: "WhatsApp", quantos: 1 },
        { rotulo: "site", quantos: 1 },
      ]),
    );
    expect(r.chegaram.por_funil).toEqual([
      { rotulo: "Comercial", quantos: 2 },
      { rotulo: "Pós-venda", quantos: 1 },
    ]);
  });

  it("a Ana: só o dela", async () => {
    const { chamar } = ferramentas("agent");
    const r = await chamar("ver_meus_leads", { periodo: "hoje" });
    expect(r.chegaram.total).toBe(1);
  });
});

describe('"quantos leads chegaram na semana passada?"', () => {
  it("de segunda (16/11) a domingo (22/11), com o domingo às 23h dentro e o domingo anterior fora", async () => {
    const { chamar } = ferramentas("admin");
    const r = await chamar("ver_meus_leads", { periodo: "pers", de: "2026-11-16", ate: "2026-11-22", comparar: true });
    expect(r.chegaram.total).toBe(7);
    expect(r.chegaram.anterior).toEqual({ janela: { de: "2026-11-09", ate: "2026-11-15" }, total: 1 });
  });
});

describe('"quantos leads chegaram no fim de semana no funil Comercial?"', () => {
  it("sábado e domingo no Comercial: quatro, e o funil se acha pelo nome sem acento nem maiúscula", async () => {
    const { chamar } = ferramentas("manager");
    const r = await chamar("ver_meus_leads", { periodo: "pers", de: "2026-11-21", ate: "2026-11-22", funil: "funil comercial" });
    expect(r.funil).toEqual({ id: COMERCIAL, nome: "Comercial" });
    expect(r.chegaram.total).toBe(4);
    expect(r.chegaram.por_funil).toEqual([{ rotulo: "Comercial", quantos: 4 }]);
    // O "abertos" também é do funil.
    expect(r.abertos).toBe(750 + 9);
  });

  it("funil que não existe volta a lista dos funis, sem erro", async () => {
    const { chamar } = ferramentas("manager");
    const r = await chamar("ver_meus_leads", { periodo: "7", funil: "Financeiro" });
    expect(r).toMatchObject({ ok: false, motivo: "funil_nao_encontrado", funis: ["Comercial", "Pós-venda"] });
  });
});

describe('"quantas tarefas concluí hoje?"', () => {
  it("a Ana: duas hoje (a das 23h de ontem fica fora, a pendente também)", async () => {
    const { chamar } = ferramentas("agent");
    const r = await chamar("ver_minha_rotina");
    expect(r.tarefas.concluidas_hoje).toBe(2);
  });

  it("a gestora vê as da equipe", async () => {
    const { chamar } = ferramentas("manager");
    const r = await chamar("ver_minha_rotina");
    expect(r.tarefas.concluidas_hoje).toBe(3);
  });

  it("no período pedido: nos últimos 7 dias a Ana concluiu três", async () => {
    const { chamar } = ferramentas("agent");
    const r = await chamar("ver_minha_rotina", { periodo: "7" });
    expect(r.concluidas_no_periodo).toEqual({ periodo: "7", de: "2026-11-19", ate: "2026-11-25", quantas: 3 });
  });
});

describe("a ferramenta que falha diz o código, e o log diz qual ferramenta", () => {
  it("leitura recusada: { erro, codigo } ao modelo e { ferramenta, codigo } no log, sem o texto do banco", async () => {
    const { chamar } = ferramentas("admin", {
      falhas: { crm_pipelines: { message: 'valor "Ana Exemplo" recusado', code: "XX000" } },
    });
    const r = await chamar("ver_meus_leads");
    expect(r.erro).toBeTruthy();
    expect(r.codigo).toBe("leads_funis_indisponiveis");
    const log = avisos.find((a) => a.msg.includes("ferramenta falhou"));
    expect(log?.ctx).toEqual({ ferramenta: "ver_meus_leads", codigo: "leads_funis_indisponiveis" });
    expect(JSON.stringify(avisos)).not.toContain("Ana Exemplo");
  });
});

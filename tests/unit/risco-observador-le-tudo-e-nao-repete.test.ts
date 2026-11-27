import { beforeEach, describe, expect, it, vi } from "vitest";

import { observaTravessias } from "@/lib/leads/risk-worker";

/**
 * FORK MIA (MIA-293) — PASSADA SEM MUDANÇA NÃO GRAVA NADA, mesmo com mais de
 * 1000 negócios.
 *
 * O defeito medido em produção: o PostgREST corta toda resposta em 1000 linhas
 * e, sem `ORDER BY`, o recorte muda de uma chamada para outra. O observador lia
 * os negócios abertos e os estados gravados assim, e o negócio que caía fora da
 * página dos estados virava `de = null`: travessia nova, upsert, proposta de
 * reativação e mais um "Negócio esfriou" na timeline, a cada passada do cron.
 *
 * O dublê abaixo é o PostgREST no que importa para isso:
 *   · teto de 1000 linhas por resposta, com ou sem `.range()`;
 *   · `.order()` + `.range()` dão a fatia pedida da ordem pedida;
 *   · SEM `.order()`, a ordem é a do plano, e muda a cada chamada (aqui, um
 *     giro determinístico do ponto de partida).
 *
 * Os follow-ups (`cron_jobs`) entram de propósito com 12 por contato nos 100
 * primeiros: um lote de 100 contatos passa de 1000 linhas, e cortado ele faria
 * o bucket desses negócios oscilar entre `em_voo` e `critico`.
 *
 * Dado inventado: a "Academia Alfa" e seus negócios não existem.
 */

const ORG = "0a1fa000-0000-4000-8000-000000000001"; // Academia Alfa (fictícia)
const AGORA = new Date("2026-11-20T12:00:00Z");
const NEGOCIOS = 1500;
const TETO_DO_POSTGREST = 1000;

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// A agenda tem dublê e testes próprios (`protecao-followup`); aqui ela só não
// protege ninguém.
vi.mock("@/lib/agenda/protecao-followup", () => ({
  protecaoAgendaSupabase: async () => new Map(),
}));

const atividades = vi.hoisted(() => ({ emitidas: [] as Array<{ leadId: string; type: string }> }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: async (_admin: unknown, input: { leadId: string; type: string }) => {
    atividades.emitidas.push({ leadId: input.leadId, type: input.type });
    return { ok: true };
  },
}));

const propostas = vi.hoisted(() => ({ pedidas: [] as string[] }));
vi.mock("@/lib/leads/reactivation", () => ({
  propoeReativacao: async (_admin: unknown, input: { leadId: string }) => {
    propostas.pedidas.push(input.leadId);
    return null;
  },
}));

type Linha = Record<string, unknown>;

function uuid(prefixo: string, n: number): string {
  return `${prefixo}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const DIA = 86_400_000;

function negocios(): Linha[] {
  return Array.from({ length: NEGOCIOS }, (_, i) => ({
    id: uuid("1ead0000", i),
    organization_id: ORG,
    status: "open",
    stage_id: "5a9e0000-0000-4000-8000-000000000001",
    contact_id: uuid("c0de0000", i),
    // Um terço tocado há uma hora (em dia); o resto parado há 10 dias.
    last_activity_at: new Date(AGORA.getTime() - (i % 3 === 0 ? 3_600_000 : 10 * DIA)).toISOString(),
    created_at: new Date(AGORA.getTime() - 30 * DIA).toISOString(),
  }));
}

function followups(): Linha[] {
  const linhas: Linha[] = [];
  for (let c = 0; c < 100; c++) {
    for (let k = 0; k < 12; k++) {
      linhas.push({
        id: uuid(`f0110${String(k).padStart(3, "0")}`, c),
        organization_id: ORG,
        contact_id: uuid("c0de0000", c),
        kind: "at",
        enabled: true,
        next_run_at: new Date(AGORA.getTime() + (k + 1) * DIA).toISOString(),
      });
    }
  }
  return linhas;
}

let tabelas: Record<string, Linha[]> = {};
let upserts = 0;
let chamadasSemOrdem = 0;

class Consulta implements PromiseLike<{ data: Linha[]; error: null; count: number | null }> {
  private filtros: Array<(l: Linha) => boolean> = [];
  private ordem: Array<{ coluna: string; asc: boolean }> = [];
  private faixa: [number, number] | null = null;

  constructor(
    private readonly linhas: Linha[],
    private readonly colunas: string[],
    private readonly contar: boolean,
  ) {}

  eq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] === valor);
    return this;
  }
  in(coluna: string, valores: readonly unknown[]) {
    const conjunto = new Set(valores);
    this.filtros.push((l) => conjunto.has(l[coluna]));
    return this;
  }
  gt(coluna: string, valor: string) {
    this.filtros.push((l) => String(l[coluna]) > valor);
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordem.push({ coluna, asc: opcoes?.ascending !== false });
    return this;
  }
  range(de: number, ate: number) {
    this.faixa = [de, ate];
    return this;
  }

  private executa() {
    let r = this.linhas.filter((l) => this.filtros.every((f) => f(l)));
    const total = r.length;
    if (this.ordem.length > 0) {
      r = [...r].sort((a, b) => {
        for (const { coluna, asc } of this.ordem) {
          const x = String(a[coluna]);
          const y = String(b[coluna]);
          if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
    } else if (r.length > 0) {
      // Sem ORDER BY, o plano decide — e decide diferente a cada chamada.
      const giro = (++chamadasSemOrdem * 389) % r.length;
      r = [...r.slice(giro), ...r.slice(0, giro)];
    }
    if (this.faixa) r = r.slice(this.faixa[0], this.faixa[1] + 1);
    r = r.slice(0, TETO_DO_POSTGREST);
    const data = r.map((l) => Object.fromEntries(this.colunas.map((c) => [c, l[c]])));
    return { data, error: null, count: this.contar ? total : null };
  }

  then<A = { data: Linha[]; error: null; count: number | null }, B = never>(
    ok?: ((v: { data: Linha[]; error: null; count: number | null }) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executa()).then(ok, falha);
  }
}

function adminDuble() {
  return {
    from(tabela: string) {
      const linhas = tabelas[tabela];
      if (!linhas) throw new Error(`tabela não modelada no dublê: ${tabela}`);
      return {
        select: (colunas: string, opcoes?: { count?: string }) =>
          new Consulta(
            linhas,
            colunas.split(",").map((c) => c.trim()),
            opcoes?.count === "exact",
          ),
        upsert: async (linha: Linha) => {
          upserts += 1;
          const i = linhas.findIndex((l) => l.lead_id === linha.lead_id);
          if (i >= 0) linhas[i] = { ...linhas[i], ...linha };
          else linhas.push({ ...linha });
          return { error: null };
        },
      };
    },
  };
}

beforeEach(() => {
  tabelas = {
    crm_leads: negocios(),
    crm_stages: [{ id: "5a9e0000-0000-4000-8000-000000000001", organization_id: ORG, expected_duration_hours: 24 }],
    cron_jobs: followups(),
    crm_lead_risk_states: [],
  };
  upserts = 0;
  chamadasSemOrdem = 0;
  atividades.emitidas = [];
  propostas.pedidas = [];
});

describe("observador de risco com mais de 1000 negócios (MIA-293)", () => {
  it("CONTROLE: o dublê corta em 1000 como o PostgREST", async () => {
    const { data } = await adminDuble().from("crm_leads").select("id");
    expect(data).toHaveLength(TETO_DO_POSTGREST);
  });

  it("a primeira passada grava o estado de TODOS os negócios abertos", async () => {
    const r = await observaTravessias(adminDuble() as never, ORG, AGORA);

    expect(r.avaliados).toBe(NEGOCIOS);
    expect(r.travessias).toBe(NEGOCIOS);
    expect(upserts).toBe(NEGOCIOS);
    expect(tabelas.crm_lead_risk_states).toHaveLength(NEGOCIOS);

    // Os 100 primeiros contatos têm follow-up no futuro: os parados entre eles
    // estão em voo, não esfriando — o lote de follow-ups foi lido até o fim.
    const bucket = (i: number) =>
      tabelas.crm_lead_risk_states!.find((l) => l.lead_id === uuid("1ead0000", i))?.bucket;
    expect(bucket(1)).toBe("em_voo");
    expect(bucket(98)).toBe("em_voo");
    expect(bucket(101)).toBe("critico");
    expect(bucket(0)).toBe("em_dia");

    // Só esfriamento real vira linha: parados e fora dos 100 com follow-up.
    let esperados = 0;
    for (let i = 100; i < NEGOCIOS; i++) if (i % 3 !== 0) esperados += 1;
    expect(r.esfriaram).toBe(esperados);
    expect(atividades.emitidas).toHaveLength(esperados);
  });

  it("⛔ a segunda e a terceira passadas, sem nada mudar, não gravam atividade nem estado", async () => {
    await observaTravessias(adminDuble() as never, ORG, AGORA);
    upserts = 0;
    atividades.emitidas = [];
    propostas.pedidas = [];

    for (const passada of [2, 3]) {
      const r = await observaTravessias(adminDuble() as never, ORG, AGORA);
      // O defeito primeiro: gravação repetida é o que enchia a timeline.
      expect(upserts, `passada ${passada}: upserts`).toBe(0);
      expect(atividades.emitidas.length, `passada ${passada}: atividades`).toBe(0);
      expect(propostas.pedidas.length, `passada ${passada}: propostas`).toBe(0);
      expect(r.travessias, `passada ${passada}: travessias`).toBe(0);
      expect(r.avaliados, `passada ${passada}: avaliados`).toBe(NEGOCIOS);
    }
  });
});

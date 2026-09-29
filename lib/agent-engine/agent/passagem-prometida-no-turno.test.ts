/**
 * FORK MIA — a rede de segurança da passagem prometida, no fim do turno.
 *
 * O Jev e as duas ações (a passagem para humano do motor e o caminho até
 * qualificado) são dublês: aqui se prova a DECISÃO — quando ela age, quando só
 * observa, e que nunca age duas vezes nem derruba o turno.
 *
 *     npx vitest run lib/agent-engine/agent/passagem-prometida-no-turno.test.ts
 */
import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const d = vi.hoisted(() => ({
  jev: null as null | Record<string, unknown>,
  nova: true,
  registros: [] as Array<Record<string, unknown>>,
  handoffs: [] as Array<{ ids: unknown; opts: Record<string, unknown> }>,
  caminhos: [] as unknown[],
}));

vi.mock("@/lib/ai/decisao/passagem-prometida", () => ({
  perguntarPassagemPrometidaAoJev: vi.fn(async () => d.jev),
  registrarPassagemPrometidaDoJev: vi.fn(async (_pool: unknown, r: Record<string, unknown>) => {
    d.registros.push(r);
    return d.nova;
  }),
}));
vi.mock("./human-handoff", () => ({
  performHumanHandoff: vi.fn(async (_db: unknown, ids: unknown, opts: Record<string, unknown>) => {
    d.handoffs.push({ ids, opts });
  }),
}));
vi.mock("./caminhar-ate-qualificado", () => ({
  caminharAteQualificado: vi.fn(async (...args: unknown[]) => {
    d.caminhos.push(args);
    return { ok: true, de: "qualifying", etapas: ["qualified"], card: [] };
  }),
}));

import { vigiarPassagemPrometida, type EntradaDaVigia } from "./passagem-prometida-no-turno";

const FICHA = { headline: "Implante · São Miguel", body: "Roberto quer implante, prefere quinta à tarde." };
const PROMESSA = "Perfeito! Vou encaminhar para a nossa equipe, em breve eles entram em contato.";

/** O banco do motor: o time foi avisado no turno? houve ficha no turno? */
function pool(opts: { avisado: boolean; ficha: boolean }) {
  const consultas: string[] = [];
  const p = {
    query: vi.fn(async (sql: string) => {
      consultas.push(sql);
      if (sql.includes("lead_state_transitions")) return { rows: [{ avisado: opts.avisado }] };
      if (sql.includes("from lead_notes")) return { rows: opts.ficha ? [FICHA] : [] };
      throw new Error("consulta não prevista");
    }),
  };
  return { pool: p as unknown as pg.Pool, consultas };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function entrada(p: pg.Pool, over: Partial<EntradaDaVigia> = {}): EntradaDaVigia {
  return {
    pool: p,
    crm: { supabase: {} as never },
    tenantId: "org",
    contactId: "contato",
    conversationId: "conversa",
    jobId: "job",
    textos: [PROMESSA],
    messageIds: ["msg-1"],
    abriuCaso: false,
    inicioDoTurno: new Date("2026-09-29T12:00:00Z"),
    log,
    ...over,
  };
}

const jev = (estado: "observando" | "decidindo", rotulo: "passou" | "nao_passou") => ({
  estado,
  rotulo,
  probabilidade: rotulo === "passou" ? 0.95 : 0.05,
  modelo: "jev-1.13.0",
  tokensDeEntrada: 1,
  tokensDeSaida: 1,
  latenciaMs: 1,
});

beforeEach(() => {
  d.jev = null;
  d.nova = true;
  d.registros = [];
  d.handoffs = [];
  d.caminhos = [];
  vi.clearAllMocks();
});

describe("a rede de segurança da passagem prometida", () => {
  it("⭐ OBSERVANDO: prometeu e nada andou — grava, avisa no log, NÃO age", async () => {
    d.jev = jev("observando", "passou");
    const { pool: p } = pool({ avisado: false, ficha: true });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toEqual({ rodou: true, rotuloJev: "passou", rotuloAtual: "nao_passou", agiu: false });
    expect(d.registros).toMatchObject([{ rotuloAtual: "nao_passou", decidiu: false, messageId: "msg-1", jobId: "job" }]);
    expect(d.handoffs).toEqual([]);
    expect(d.caminhos).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      "passagem prometida ao cliente sem o time ser avisado no turno",
      expect.objectContaining({ estado: "observando" }),
    );
  });

  it("⭐ DECIDINDO, prometeu, nada andou e havia ficha: abre o bastão E leva a qualificado", async () => {
    d.jev = jev("decidindo", "passou");
    const { pool: p } = pool({ avisado: false, ficha: true });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toMatchObject({ agiu: true, qualificou: true });
    expect(d.registros).toMatchObject([{ decidiu: true }]);
    expect(d.handoffs).toHaveLength(1);
    expect(d.handoffs[0]!.ids).toEqual({ tenantId: "org", leadId: "contato", conversationId: "conversa" });
    expect(d.handoffs[0]!.opts).toMatchObject({ reason: "passagem_prometida", avisoAoLead: { avisado: true } });
    // O time lê o que foi prometido e a ficha — no grupo e na Central.
    expect(String(d.handoffs[0]!.opts.conversationSummary)).toContain(PROMESSA);
    expect(String(d.handoffs[0]!.opts.conversationSummary)).toContain(FICHA.body);
    expect(d.caminhos).toHaveLength(1);
  });

  it("⭐ DECIDINDO sem ficha no turno: abre o bastão, mas NÃO qualifica pela frase", async () => {
    d.jev = jev("decidindo", "passou");
    const { pool: p } = pool({ avisado: false, ficha: false });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toMatchObject({ agiu: true, qualificou: false });
    expect(d.handoffs).toHaveLength(1);
    expect(String(d.handoffs[0]!.opts.conversationSummary)).toMatch(/Não houve ficha/);
    expect(d.caminhos).toEqual([]);
  });

  it("o time JÁ foi avisado no turno (funil andou): concorda, e não age", async () => {
    d.jev = jev("decidindo", "passou");
    const { pool: p } = pool({ avisado: true, ficha: true });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toEqual({ rodou: true, rotuloJev: "passou", rotuloAtual: "passou", agiu: false });
    expect(d.handoffs).toEqual([]);
  });

  it("caso aberto no turno também conta como o time avisado", async () => {
    d.jev = jev("decidindo", "passou");
    const { pool: p, consultas } = pool({ avisado: false, ficha: false });
    const r = await vigiarPassagemPrometida(entrada(p, { abriuCaso: true }));
    expect(r).toMatchObject({ rotuloAtual: "passou", agiu: false });
    expect(consultas.filter((c) => c.includes("lead_state_transitions"))).toEqual([]);
  });

  it("não prometeu: nada acontece além do registro", async () => {
    d.jev = jev("decidindo", "nao_passou");
    const { pool: p } = pool({ avisado: false, ficha: true });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toMatchObject({ rotuloJev: "nao_passou", agiu: false });
    expect(d.handoffs).toEqual([]);
  });

  it("⭐ idempotente: a observação já existia (retry do job) — não abre a passagem de novo", async () => {
    d.jev = jev("decidindo", "passou");
    d.nova = false;
    const { pool: p } = pool({ avisado: false, ficha: true });
    const r = await vigiarPassagemPrometida(entrada(p));
    expect(r).toMatchObject({ agiu: false });
    expect(d.handoffs).toEqual([]);
  });

  it("tarefa pausada (o Jev não responde): nem consulta o banco", async () => {
    const { pool: p, consultas } = pool({ avisado: false, ficha: true });
    expect(await vigiarPassagemPrometida(entrada(p))).toEqual({ rodou: false });
    expect(consultas).toEqual([]);
  });

  it("nada saiu no turno: não pergunta nada", async () => {
    d.jev = jev("decidindo", "passou");
    const { pool: p } = pool({ avisado: false, ficha: true });
    expect(await vigiarPassagemPrometida(entrada(p, { textos: [], messageIds: [] }))).toEqual({ rodou: false });
  });

  it("nunca derruba o turno: erro vira log", async () => {
    d.jev = jev("decidindo", "passou");
    const quebrado = { query: vi.fn().mockRejectedValue(new Error("banco caiu")) } as unknown as pg.Pool;
    await expect(vigiarPassagemPrometida(entrada(quebrado))).resolves.toEqual({ rodou: false });
    expect(log.error).toHaveBeenCalled();
  });
});

/**
 * FORK MIA (.85) — o horário da IA NO MOTOR.
 *
 *   1. A mensagem que chega com a IA inativa: o turno termina sem enviar e sem
 *      reagendar; o pedido de parar continua registrado, sem mensagem
 *      automática. A decisão é pelo instante em que a mensagem CHEGOU.
 *   2. O toque da régua (worker): reagendado para a próxima abertura, com o
 *      adiamento voltando ao enrollment.
 *   3. O texto fixo pelo atalho inline: a terceira régua, composta com as duas
 *      do upstream.
 *   4. O retorno prometido (`followup_turn` sem régua): reagendado.
 *
 * Banco dublê por padrão de SQL, como `followup-classificar-sem-resposta.test.ts`.
 * Nenhum dado é de cliente real (Vita Odonto é fictícia).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type * as GetLeadContext from "@/lib/agent-engine/edge/crm/get-lead-context";
import type * as HumanHandoff from "@/lib/agent-engine/agent/human-handoff";
import type * as Scheduler from "@/lib/agent-engine/cron/scheduler";
import type * as Motor from "@/lib/agent-engine/agent/horario-da-ia-no-motor";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import { lerHorarioDaIa, type HorarioDaIaGravado } from "@/lib/agent-engine/agent/horario-da-ia";
import { aberturaDoToque, turnoTerminaComIaInativa, type PortasDoTurnoInativo } from "@/lib/agent-engine/agent/horario-da-ia-no-turno";

const getLeadContext = vi.fn();
const performHumanHandoff = vi.fn(async () => undefined);
const cancelPendingCronsForLead = vi.fn(async () => 0);

vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", async (original) => ({
  ...(await original<typeof GetLeadContext>()),
  getLeadContext,
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", async (original) => ({
  ...(await original<typeof HumanHandoff>()),
  performHumanHandoff,
}));
vi.mock("@/lib/agent-engine/cron/scheduler", async (original) => ({
  ...(await original<typeof Scheduler>()),
  cancelPendingCronsForLead,
}));

/** Seg a sex: a IA até 10:00 e de 17:30 em diante (a recepção atende entre as duas). */
const VITA: HorarioDaIaGravado = {
  fuso: "America/Sao_Paulo",
  faixas: [
    { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "10:00" },
    { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
  ],
};
const HORARIO = lerHorarioDaIa({ filters: { horario_da_ia: VITA } })!;
const GATILHO = { events: ["message"], filters: { horario_da_ia: VITA } };
/** 2026-10-19 é segunda; São Paulo é UTC-3. */
const sp = (hhmm: string, data = "2026-10-19") => new Date(`${data}T${hhmm}:00-03:00`);

const silencioso = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function portas(sobre: Partial<PortasDoTurnoInativo> = {}): PortasDoTurnoInativo {
  return {
    instanteDaMensagem: vi.fn(async () => sp("11:00")),
    lerPendentes: vi.fn(async () => ({ textos: ["tem horário amanhã?"], bloqueado: false })),
    pedidoDeParar: (t: string) => /parar|pare de/i.test(t),
    registrarPedidoDeParar: vi.fn(async () => undefined),
    cancelarFollowups: vi.fn(async () => 0),
    ...sobre,
  };
}

beforeEach(() => {
  getLeadContext.mockReset();
  performHumanHandoff.mockClear();
  cancelPendingCronsForLead.mockClear();
});

// ---------------------------------------------------------------------------
// 1. a decisão
// ---------------------------------------------------------------------------

describe("a mensagem que chega com a IA inativa (a decisão)", () => {
  const base = { horario: HORARIO, agentId: "agente-1", log: silencioso };

  it("inativa quando a mensagem chegou: o turno termina, nada é registrado à toa", async () => {
    const p = portas();
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("11:00"), portas: p })).toBe(true);
    expect(p.registrarPedidoDeParar).not.toHaveBeenCalled();
    expect(p.cancelarFollowups).not.toHaveBeenCalled();
  });

  it("decide pelo instante em que a mensagem CHEGOU: 09:59 é da IA mesmo com o job às 10:00:05", async () => {
    const p = portas({ instanteDaMensagem: vi.fn(async () => sp("09:59")) });
    expect(await turnoTerminaComIaInativa({ ...base, agora: new Date(sp("10:00").getTime() + 5_000), portas: p })).toBe(false);
    expect(p.lerPendentes).not.toHaveBeenCalled();
  });

  it("a mensagem das 23h que a janela do número segurou até as 7h continua sendo da IA", async () => {
    const p = portas({ instanteDaMensagem: vi.fn(async () => sp("23:00")) });
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("07:00", "2026-10-20"), portas: p })).toBe(false);
  });

  it("sem o instante da mensagem, vale o relógio do turno", async () => {
    const p = portas({ instanteDaMensagem: vi.fn(async () => null) });
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("09:00"), portas: p })).toBe(false);
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("12:00"), portas: p })).toBe(true);
  });

  it("o pedido de parar com a IA inativa é registrado (LGPD), sem mensagem automática", async () => {
    const p = portas({ lerPendentes: vi.fn(async () => ({ textos: ["oi", "pare de me mandar mensagem"], bloqueado: false })) });
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("11:00"), portas: p })).toBe(true);
    expect(p.registrarPedidoDeParar).toHaveBeenCalledWith(["oi", "pare de me mandar mensagem"]);
  });

  it("contato já bloqueado: os follow-ups que nasceram depois são cancelados", async () => {
    const p = portas({ lerPendentes: vi.fn(async () => ({ textos: ["ok"], bloqueado: true })) });
    expect(await turnoTerminaComIaInativa({ ...base, agora: sp("11:00"), portas: p })).toBe(true);
    expect(p.cancelarFollowups).toHaveBeenCalledTimes(1);
    expect(p.registrarPedidoDeParar).not.toHaveBeenCalled();
  });

  it("falha ao ler o que o cliente disse SOBE: o job volta à fila e a detecção roda de novo", async () => {
    const p = portas({ lerPendentes: vi.fn(async () => Promise.reject(new Error("banco fora"))) });
    await expect(turnoTerminaComIaInativa({ ...base, agora: sp("11:00"), portas: p })).rejects.toThrow("banco fora");
  });

  it("sem horário não há o que decidir: nenhuma porta é tocada", async () => {
    const p = portas();
    expect(await turnoTerminaComIaInativa({ ...base, horario: null, agora: sp("11:00"), portas: p })).toBe(false);
    expect(p.instanteDaMensagem).not.toHaveBeenCalled();
  });

  it("o toque de follow-up: ativa sai agora; inativa espera a próxima abertura", () => {
    expect(aberturaDoToque(HORARIO, sp("09:00"))).toBeNull();
    expect(aberturaDoToque(HORARIO, sp("11:00"))?.toISOString()).toBe(sp("17:30").toISOString());
    expect(aberturaDoToque(null, sp("11:00"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 1b. a fiação de produção, com banco dublê
// ---------------------------------------------------------------------------

type Consulta = { sql: string; params: unknown[] };

function poolDublê(respostas: Array<[RegExp, unknown[]]>) {
  const consultas: Consulta[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      for (const [padrao, rows] of respostas) if (padrao.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool, consultas };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const MENSAGEM = "44444444-4444-4444-8444-444444444444";

function jobDe(kind: string, payload: Record<string, unknown>): JobRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organization_id: ORG,
    contact_id: LEAD,
    kind,
    source_event_id: null,
    payload,
    status: "running",
    priority: 0,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    deferred_reason: null,
    locked_by: "w1",
    locked_at: new Date(),
    created_at: new Date(),
  } as JobRow;
}

const AGENTE = {
  agentId: "agente-1",
  versionId: "versao-1",
  agentName: "Assistente da Vita",
  pausedAt: null,
  operationMode: "automatic",
  historyMessageWindow: 20,
  historyTokenWindow: 4000,
  horarioDaIa: HORARIO,
} as unknown as PublishedAgentConfig;

describe("a fiação do turno inbound (encerrarTurnoSeIaInativa)", () => {
  let encerrar: typeof Motor.encerrarTurnoSeIaInativa;
  beforeAll(async () => {
    ({ encerrarTurnoSeIaInativa: encerrar } = await import("@/lib/agent-engine/agent/horario-da-ia-no-motor"));
  }, 60_000);

  const deps = (agora: Date) => ({ crmCfg: {}, log: silencioso, clock: () => agora }) as never;
  const job = jobDe("inbound_turn", { conversation_id: CONVERSA, inbound_message_id: MENSAGEM });

  it("inativa: termina sem enfileirar, sem reagendar e sem tocar o canal", async () => {
    const { pool, consultas } = poolDublê([[/select created_at\s+from messages/, [{ created_at: sp("11:00") }]]]);
    getLeadContext.mockResolvedValue({ ok: true, context: { contact: { is_blocked: false }, messages: [{ direction: "inbound", body: "tem horário?" }] } });

    const terminou = await encerrar(pool as never, deps(sp("11:00")), { job, agent: AGENTE, conversationId: CONVERSA, inboundMessageId: MENSAGEM });

    expect(terminou).toBe(true);
    // A mensagem é lida pelo recorte certo (organização, conversa, id).
    expect(consultas[0]?.params).toEqual([ORG, CONVERSA, MENSAGEM]);
    // Nada de reagendar o job nem de enviar: nenhuma escrita na fila ou em mensagens.
    expect(consultas.some((c) => /update job_queue|insert into job_queue|insert into messages/i.test(c.sql))).toBe(false);
    expect(performHumanHandoff).not.toHaveBeenCalled();
  });

  it("inativa com pedido de parar: passagem durável SEM aviso ao cliente", async () => {
    const { pool } = poolDublê([[/select created_at\s+from messages/, [{ created_at: sp("11:00") }]]]);
    getLeadContext.mockResolvedValue({
      ok: true,
      context: { contact: { is_blocked: false }, messages: [{ direction: "inbound", body: "não quero mais receber mensagem" }] },
    });

    expect(await encerrar(pool as never, deps(sp("11:00")), { job, agent: AGENTE, conversationId: CONVERSA, inboundMessageId: MENSAGEM })).toBe(true);

    expect(performHumanHandoff).toHaveBeenCalledTimes(1);
    const [, ids, opcoes] = performHumanHandoff.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>];
    expect(ids).toEqual({ tenantId: ORG, leadId: LEAD, conversationId: CONVERSA });
    expect(opcoes.reason).toBe("suspected_optout");
    // Nenhuma mensagem saiu: o desfecho "não avisado" é declarado, e a Central diz isso a quem assume.
    expect(opcoes.avisoAoLead).toEqual({ avisado: false, porque: "ia_inativa_no_horario" });
  });

  it("ativa: segue o turno, sem ler o contexto", async () => {
    const { pool } = poolDublê([[/select created_at\s+from messages/, [{ created_at: sp("09:30") }]]]);
    expect(await encerrar(pool as never, deps(sp("09:31")), { job, agent: AGENTE, conversationId: CONVERSA, inboundMessageId: MENSAGEM })).toBe(false);
    expect(getLeadContext).not.toHaveBeenCalled();
  });

  it("agente sem horário: nem lê a mensagem", async () => {
    const { pool, consultas } = poolDublê([]);
    const semHorario = { ...AGENTE, horarioDaIa: null } as PublishedAgentConfig;
    expect(await encerrar(pool as never, deps(sp("11:00")), { job, agent: semHorario, conversationId: CONVERSA, inboundMessageId: MENSAGEM })).toBe(false);
    expect(consultas).toHaveLength(0);
  });
});

describe("a ligação no handler do inbound", () => {
  it("o horário é conferido depois de escolher o agente e ANTES do rascunho do assistido e do turno", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");
    const handler = fonte.slice(fonte.indexOf("export function createInboundTurnHandler"));
    const horario = handler.indexOf("encerrarTurnoSeIaInativa(");
    expect(horario).toBeGreaterThan(handler.indexOf("const operationAgent = resolvedAgent.config"));
    expect(horario).toBeLessThan(handler.indexOf("operationAgent?.operationMode === 'assisted'"));
    expect(horario).toBeLessThan(handler.indexOf("await runAgentTurn("));
  });
});

// ---------------------------------------------------------------------------
// 2. o toque da régua pelo worker
// ---------------------------------------------------------------------------

describe("o toque da régua com a IA inativa (worker)", () => {
  const INSCRICAO = "66666666-6666-4666-8666-666666666666";
  const boundary = { organization_id: ORG, contact_id: LEAD, conversation_id: CONVERSA, service_revision: 1, demanda_id: null, demanda_revision: null };
  const complete = vi.fn(async () => undefined);
  let run: (job: JobRow, pool: never, ctx: { workerId: string }) => Promise<void>;

  async function preparar(agora: Date) {
    const { createFollowupTurnHandler } = await import("@/lib/agent-engine/agent/followup-turn");
    run = createFollowupTurnHandler({
      knobs: { historyLimit: 20, maxContextTokens: 4000 },
      log: silencioso,
      clock: () => agora,
      completeFollowupTurn: complete,
    } as never);
  }

  const respostas = (): Array<[RegExp, unknown[]]> => [
    [/d\.fechada_em::text/, [{ ...boundary, status: "open", demanda_fechada_em: null }]],
    [/from conversations c/, [{ channel_session_id: "canal-1", archived_at: null }]],
    [/select current_node_id, status from followup_enrollments/, [{ current_node_id: "n1", status: "active" }]],
    [/select v\.trigger_config/, [{ trigger_config: GATILHO }]],
    [/insert into cron_jobs/, [{ id: "cron-1" }]],
  ];
  const job = jobDe("followup_turn", {
    service_boundary: boundary,
    followup_enrollment_id: INSCRICAO,
    node_id: "n1",
    purpose: "send_message",
    fixed_body: "Oi! Ainda quer marcar a avaliação?",
  });

  beforeEach(() => complete.mockClear());

  it("inativa às 11:00: o toque é reagendado para 17:30 e o enrollment fica sabendo", async () => {
    await preparar(sp("11:00"));
    const { pool, consultas } = poolDublê(respostas());

    await run(job, pool as never, { workerId: "w1" });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ enrollmentId: INSCRICAO, nodeId: "n1", result: { kind: "deferred", until: sp("17:30"), reason: "horario_da_ia" } }),
    );
    // Reagendado, não perdido: o cron de reentrada nasce para a abertura.
    const reentrada = consultas.find((c) => /insert into cron_jobs/i.test(c.sql));
    expect(reentrada, "o toque precisa voltar à fila na abertura").toBeDefined();
    expect(JSON.stringify(reentrada!.params)).toContain(sp("17:30").toISOString());
    // E nada sai pelo canal neste turno.
    expect(consultas.some((c) => /insert into messages|send_ledger/i.test(c.sql))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. o texto fixo pelo atalho inline
// ---------------------------------------------------------------------------

describe("o texto fixo pelo atalho inline (decidirAdiamentoPorJanela)", () => {
  function admin(tabelas: Record<string, Record<string, unknown>>) {
    const make = (tabela: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          const linha = tabelas[tabela] ?? {};
          return Promise.resolve({ data: Object.keys(linha).length === 0 ? null : linha, error: null });
        },
      };
      return chain;
    };
    return { from: (t: string) => make(t) } as unknown as SupabaseClient;
  }
  const tabelas = (canal: Record<string, unknown> = {}) => ({
    conversations: { channel_session_id: "sess-1" },
    channel_knobs: { throttle_ms: null, jitter_max_ms: 0, window_start_hour: 7, window_end_hour: 22, allow_sunday: true, timezone: null, warmup_daily_caps: null, ...canal },
    organizations: { timezone: "America/Sao_Paulo" },
    followup_enrollments: { agent_id: "ag-1" },
    ai_agents: { published_version_id: "v1" },
    ai_agent_versions: { followup: null, trigger_config: GATILHO },
  });
  const decidir = async (t: Record<string, Record<string, unknown>>, agora: Date) => {
    const { decidirAdiamentoPorJanela } = await import("@/lib/followup/janela-de-disparo");
    return decidirAdiamentoPorJanela(admin(t), {
      organizationId: ORG,
      contactId: LEAD,
      conversationId: CONVERSA,
      enrollmentId: "enr-1",
      agora,
    });
  };

  it("IA inativa às 11:00 com o canal aberto: adia para 17:30, motivo do horário da IA", async () => {
    expect(await decidir(tabelas(), sp("11:00"))).toEqual({ until: sp("17:30"), reason: "horario_da_ia" });
  });

  it("IA ativa às 09:00: sai agora", async () => {
    expect(await decidir(tabelas(), sp("09:00"))).toBeNull();
  });

  it("compõe com a janela do canal: aberta só das 12h às 18h, a IA só às 17:30, sai às 17:30 (um adiamento só)", async () => {
    expect(await decidir(tabelas({ window_start_hour: 12, window_end_hour: 18 }), sp("08:00"))).toEqual({
      until: sp("17:30"),
      reason: "horario_da_ia",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. o retorno prometido (followup_turn sem régua)
// ---------------------------------------------------------------------------

describe("o retorno prometido com a IA inativa", () => {
  it("é reagendado para a próxima abertura com o motivo do horário do agente, sem sair", async () => {
    const { runAgentTurn, JobSettledError } = await import("@/lib/agent-engine/agent/inbound-turn");
    const { pool, consultas } = poolDublê([
      // O número com a janela de resposta e de disparo abertas o dia inteiro: só o horário da IA decide.
      [/from organizations o\s+left join channel_knobs k/, [{ window_start_hour: 0, window_end_hour: 24, resposta_start_hour: 0, resposta_end_hour: 24, allow_sunday: true, prospeccao_dias: null, timezone: "America/Sao_Paulo", warmup_daily_caps: null, number_activated_at: null, org_timezone: "America/Sao_Paulo" }]],
      [/update job_queue/, [{ id: "55555555-5555-4555-8555-555555555555" }]],
    ]);
    const job = jobDe("followup_turn", { reason: "retorno combinado", promise: "te chamo depois do almoço" });

    await expect(
      runAgentTurn(
        { crmCfg: {}, llmCfg: {}, knobs: { historyLimit: 20, maxContextTokens: 4000 }, log: silencioso, clock: () => sp("13:00") } as never,
        job,
        pool as never,
        { workerId: "w1" },
        {
          channelSessionId: "canal-1",
          conversationId: CONVERSA,
          resolvedAgent: { config: AGENTE, routerId: null, intentName: null, confidence: null, outcome: "no_router" },
          buildOpening: () => {
            throw new Error("o turno não deveria chegar à abertura");
          },
        },
      ),
    ).rejects.toBeInstanceOf(JobSettledError);

    const adiamento = consultas.find((c) => /update job_queue/.test(c.sql));
    expect(adiamento).toBeDefined();
    // delay até 17:30 (4h30) e o motivo do banco que já existe para o horário do agente.
    expect(adiamento!.params[2]).toBe(4.5 * 60 * 60 * 1000);
    expect(adiamento!.params).toContain("horario_do_agente");
  });
});

/**
 * FORK MIA (MIA-373) — OS DOIS CRONS DE DEVOLUÇÃO LEEM TUDO, NÃO AS PRIMEIRAS
 * 1000 LINHAS.
 *
 * `handoff-devolucao` (devolve ao agente) lia as empresas com prazo, os agentes
 * publicados delas e os roteadores ativos delas sem `range`; `rodizio-devolucao`
 * (devolve à fila) lia as empresas com prazo do mesmo jeito. O PostgREST corta
 * toda resposta em 1000 linhas sem avisar: a empresa fora da página nunca tinha
 * devolução, e o agente ou roteador fora da página fazia a sessão parecer "sem
 * ninguém que atenda", então a conversa vencida ali nunca voltava. Cada caso
 * abaixo foi escrito para REPROVAR com a leitura antiga (conferido no PR) e
 * passar com a nova, que lê página a página por `lerTodasAsPaginas`.
 *
 * O banco é o dublê que corta como o de verdade
 * (`tests/helpers/postgrest-com-teto.ts`). A devolução em si fica de fora: no
 * handoff, `devolverAtendimentoAoAgente` é dublada (o teste dela é outro); no
 * rodízio, as duas funções do banco respondem o mínimo. Aqui só se mede a
 * leitura e QUEM é devolvido.
 *
 * Dado fictício: a Academia Alfa e as unidades da Academia Beta.
 *
 *     npx vitest run tests/unit/crons-de-devolucao-leem-tudo.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  postgrestComTeto,
  type Linha,
  type OpcoesDoDuble,
  type PostgrestComTeto,
} from "@/tests/helpers/postgrest-com-teto";

const h = vi.hoisted(() => ({ devolver: vi.fn() }));
vi.mock("@/lib/escalacao/retomada", () => ({
  devolverAtendimentoAoAgente: (...a: unknown[]) => h.devolver(...a),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { devolverHandoffsVencidos } from "@/app/api/v1/cron/handoff-devolucao/route";
import { devolverConversasAoRodizio } from "@/app/api/v1/cron/rodizio-devolucao/route";

/** O `id` da Alfa vem DEPOIS de todos os da Beta, na ordem de `id` e na de inserção. */
const ACADEMIA_ALFA = "ffffffff-0000-4000-8000-000000000001";
const SESSAO_ALFA = "ffffffff-0000-4000-8000-0000000000c1";
const CONVERSA_ALFA = "ffffffff-0000-4000-8000-0000000000a1";
const ATENDENTE_ALFA = "ffffffff-0000-4000-8000-0000000000e1";

const AGORA = new Date("2026-09-14T12:00:00.000Z");
const haMinutos = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();
const pad = (n: number, w = 6) => String(n).padStart(w, "0");

/** A n-ésima unidade da Academia Beta: ids que vêm antes do da Alfa. */
const unidadeBeta = (i: number) => `bbbbbbbb-0000-4000-8000-${pad(i, 12)}`;
const sessaoBeta = (i: number) => `bbbbbbbb-0000-4000-9000-${pad(i, 12)}`;

function banco(tabelas: Record<string, Linha[]>, opcoes: OpcoesDoDuble = {}): PostgrestComTeto {
  return postgrestComTeto({ conversations: [], messages: [], ...tabelas }, opcoes);
}

const cliente = (b: PostgrestComTeto) => b.cliente as never;

/** Toda leitura da tabela paginou, em ordem de `id`. */
function leuPaginado(b: PostgrestComTeto, tabela: string) {
  const pedidos = b.pedidos.filter((p) => p.tabela === tabela);
  expect(pedidos.length).toBeGreaterThan(1);
  for (const p of pedidos) {
    expect(p.range).not.toBeNull();
    expect(p.ordem).toEqual([{ coluna: "id", ascendente: true }]);
  }
}

// ---------------------------------------------------------------------------
// handoff-devolucao
// ---------------------------------------------------------------------------

describe("handoff-devolucao lê todas as empresas, agentes e roteadores (MIA-373)", () => {
  const prazo = (minutos: number) => ({ routing: { handoff_return_after_minutes: minutos } });

  const empresaAlfa: Linha = { id: ACADEMIA_ALFA, settings: prazo(60) };

  /** Parada há 2 h com uma pessoa, sem nenhum sinal dela: vencida no prazo de 60 min. */
  const conversaAlfa: Linha = {
    id: CONVERSA_ALFA,
    organization_id: ACADEMIA_ALFA,
    channel_session_id: SESSAO_ALFA,
    status: "pending",
    assignee_kind: "user",
    assigned_to_user_id: null,
    assigned_at: null,
    bot_silenced_until: "infinity",
    last_handoff_at: haMinutos(120),
    last_outbound_at: null,
    status_changed_at: haMinutos(120),
    is_group: false,
    metadata: {},
  };

  const agente = (id: string, org: string, sessao: string): Linha => ({
    id,
    organization_id: org,
    archived_at: null,
    published_version_id: `versao-de-${id}`,
    ai_agent_versions: { channel_session_id: sessao, status: "published" },
  });
  const agenteAlfa = agente("ffffffff-0000-4000-8000-0000000000b1", ACADEMIA_ALFA, SESSAO_ALFA);

  const unidadesBeta = (n: number): Linha[] =>
    Array.from({ length: n }, (_, i) => ({ id: unidadeBeta(i), settings: prazo(60) }));

  beforeEach(() => {
    h.devolver.mockReset();
    h.devolver.mockResolvedValue({ ok: true, conversationId: CONVERSA_ALFA, jaEstavaComOAgente: false });
  });

  const devolvidas = () =>
    h.devolver.mock.calls.map((c) => (c[1] as { conversationId: string }).conversationId);

  it("a Academia Alfa depois de 1.500 unidades da Beta com prazo tem a conversa vencida devolvida", async () => {
    const b = banco({
      organizations: [...unidadesBeta(1_500), empresaAlfa],
      ai_agents: [agenteAlfa],
      ai_routers: [],
      conversations: [conversaAlfa],
    });

    const r = await devolverHandoffsVencidos(cliente(b), "req-teste", AGORA);

    expect(r.organizacoes).toBe(1_501);
    expect(devolvidas()).toEqual([CONVERSA_ALFA]);
    leuPaginado(b, "organizations");
  });

  it("o agente da Alfa depois de 1.500 agentes publicados da Beta faz a sessão dela ter quem atenda", async () => {
    const b = banco({
      organizations: [{ id: unidadeBeta(0), settings: prazo(60) }, empresaAlfa],
      ai_agents: [
        ...Array.from({ length: 1_500 }, (_, i) =>
          agente(`bbbbbbbb-0000-4000-a000-${pad(i, 12)}`, unidadeBeta(0), sessaoBeta(i)),
        ),
        agenteAlfa,
      ],
      ai_routers: [],
      conversations: [conversaAlfa],
    });

    await devolverHandoffsVencidos(cliente(b), "req-teste", AGORA);

    expect(devolvidas()).toEqual([CONVERSA_ALFA]);
    leuPaginado(b, "ai_agents");
  });

  it("o roteador da Alfa depois de 1.500 roteadores ativos da Beta faz a sessão dela ter quem atenda", async () => {
    const b = banco({
      organizations: [{ id: unidadeBeta(0), settings: prazo(60) }, empresaAlfa],
      ai_agents: [],
      ai_routers: [
        ...Array.from({ length: 1_500 }, (_, i) => ({
          id: `bbbbbbbb-0000-4000-b000-${pad(i, 12)}`,
          organization_id: unidadeBeta(0),
          channel_session_id: sessaoBeta(i),
          is_active: true,
        })),
        {
          id: "ffffffff-0000-4000-8000-0000000000d1",
          organization_id: ACADEMIA_ALFA,
          channel_session_id: SESSAO_ALFA,
          is_active: true,
        },
      ],
      conversations: [conversaAlfa],
    });

    await devolverHandoffsVencidos(cliente(b), "req-teste", AGORA);

    expect(devolvidas()).toEqual([CONVERSA_ALFA]);
    leuPaginado(b, "ai_routers");
  });

  it("empresas demais para o teto de páginas: falha fechada, nenhuma conversa devolvida", async () => {
    // 20 páginas de 1000 é o teto; 20.001 empresas não cabem. Tratar as 20 mil
    // primeiras como todas deixaria a Alfa (a última) sem devolução, calada.
    const b = banco({
      organizations: [...unidadesBeta(20_000), empresaAlfa],
      ai_agents: [agenteAlfa],
      ai_routers: [],
      conversations: [conversaAlfa],
    });

    await expect(devolverHandoffsVencidos(cliente(b), "req-teste", AGORA)).rejects.toThrow(
      /organizations: leitura cortada/,
    );
    expect(h.devolver).not.toHaveBeenCalled();
    expect(b.pedidosEm("conversations")).toBe(0);
  });

  it("a segunda página dos roteadores falha: a rodada falha fechada, sem devolver com metade", async () => {
    const b = banco(
      {
        organizations: [{ id: unidadeBeta(0), settings: prazo(60) }, empresaAlfa],
        ai_agents: [],
        ai_routers: Array.from({ length: 1_500 }, (_, i) => ({
          id: `bbbbbbbb-0000-4000-b000-${pad(i, 12)}`,
          organization_id: i === 0 ? ACADEMIA_ALFA : unidadeBeta(0),
          channel_session_id: i === 0 ? SESSAO_ALFA : sessaoBeta(i),
          is_active: true,
        })),
        conversations: [conversaAlfa],
      },
      {
        falhaEm: (_n, tabela) => {
          if (tabela !== "ai_routers") return null;
          return b.pedidosEm("ai_routers") >= 1 ? "canceling statement due to statement timeout" : null;
        },
      },
    );

    await expect(devolverHandoffsVencidos(cliente(b), "req-teste", AGORA)).rejects.toThrow(/ai_routers/);
    expect(h.devolver).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rodizio-devolucao
// ---------------------------------------------------------------------------

describe("rodizio-devolucao lê todas as empresas com prazo (MIA-373)", () => {
  const prazo = (minutos: number) => ({ routing: { unanswered_return_minutes: minutos } });
  const empresaAlfa: Linha = { id: ACADEMIA_ALFA, settings: prazo(15) };

  /** Entregue pelo rodízio há 30 min, sem resposta humana: vencida no prazo de 15 min. */
  const conversaAlfa = (): Linha => ({
    id: CONVERSA_ALFA,
    organization_id: ACADEMIA_ALFA,
    status: "open",
    assigned_to_user_id: ATENDENTE_ALFA,
    is_group: false,
    metadata: {},
  });
  const entregaAlfa: Linha = {
    id: "ffffffff-0000-4000-8000-0000000000f1",
    conversation_id: CONVERSA_ALFA,
    reason: "routing",
    created_at: haMinutos(30),
  };

  /** As duas funções do banco: o release solta o dono, o pedido de rodízio só responde. */
  const rpc: OpcoesDoDuble["rpc"] = (nome, args, tabelas) => {
    if (nome === "fn_conversation_assign") {
      const c = (tabelas.conversations ?? []).find((l) => l.id === args.p_conversation_id);
      if (!c || c.assigned_to_user_id !== args.p_expected_assignee) return { data: [], error: null };
      c.assigned_to_user_id = null;
      return { data: [{ id: c.id }], error: null };
    }
    if (nome === "fn_request_channel_routing") return { data: null, error: null };
    return { data: null, error: { message: `rpc ${nome} não dublada` } };
  };

  const unidadesBeta = (n: number): Linha[] =>
    Array.from({ length: n }, (_, i) => ({ id: unidadeBeta(i), settings: prazo(15) }));

  const daAlfa = (b: PostgrestComTeto) =>
    (b.tabelas.conversations ?? []).find((l) => l.id === CONVERSA_ALFA)!;

  it("a Academia Alfa depois de 1.500 unidades da Beta com prazo tem a conversa devolvida à fila", async () => {
    const b = banco(
      {
        organizations: [...unidadesBeta(1_500), empresaAlfa],
        conversations: [conversaAlfa()],
        conversation_assignment_events: [entregaAlfa],
      },
      { rpc },
    );

    const r = await devolverConversasAoRodizio(cliente(b), "req-teste", AGORA);

    expect(r).toMatchObject({ organizacoes: 1_501, devolvidas: 1, falhas: 0 });
    expect(daAlfa(b).assigned_to_user_id).toBeNull();
    leuPaginado(b, "organizations");
  });

  it("empresas demais para o teto de páginas: falha fechada, a conversa fica com quem está", async () => {
    const b = banco(
      {
        organizations: [...unidadesBeta(20_000), empresaAlfa],
        conversations: [conversaAlfa()],
        conversation_assignment_events: [entregaAlfa],
      },
      { rpc },
    );

    await expect(devolverConversasAoRodizio(cliente(b), "req-teste", AGORA)).rejects.toThrow(
      /organizations: leitura cortada/,
    );
    expect(daAlfa(b).assigned_to_user_id).toBe(ATENDENTE_ALFA);
    expect(b.escritas).toEqual([]);
    expect(b.pedidosEm("conversations")).toBe(0);
  });

  it("a segunda página das empresas falha: a rodada falha fechada, sem devolver nada", async () => {
    const b = banco(
      {
        organizations: [empresaAlfa, ...unidadesBeta(1_500)],
        conversations: [conversaAlfa()],
        conversation_assignment_events: [entregaAlfa],
      },
      {
        rpc,
        falhaEm: (n, tabela) => (tabela === "organizations" && n === 2 ? "connection reset" : null),
      },
    );

    await expect(devolverConversasAoRodizio(cliente(b), "req-teste", AGORA)).rejects.toThrow(
      /organizations: connection reset/,
    );
    expect(b.escritas).toEqual([]);
  });
});

/**
 * FORK MIA — O NÚMERO DA ABORDAGEM NO GATILHO "LEAD CRIADO".
 *
 * O que este arquivo prende (`lib/followup/numero-do-gatilho.ts`):
 *
 *  - número escolhido e conectado: o lead é inscrito, e o número chega a
 *    `serviceForEvent` como a sessão (o `p_session` de `fn_service_event_origin`);
 *  - arquivado, desconectado ou de outra empresa: o lead NÃO é inscrito, e o
 *    motivo fica no resumo (que o handler leva ao `detail` e ao log);
 *  - o banco recusando a sessão (`service_channel_mismatch`): mesmo desfecho,
 *    motivo `divergente`, nunca erro que re-tenta nem troca de número;
 *  - sem o campo: nada muda, nem a leitura de `channel_sessions`.
 *
 * O que NÃO prova: o SQL. Que `fn_service_event_origin` abre a conversa no
 * número pedido é do banco (baseline.sql, a última definição da função).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const origem = vi.hoisted(() => ({ serviceForEvent: vi.fn() }));
vi.mock("@/lib/atendimento/origem", () => origem);

import type { EventRow } from "@/lib/event-log/dispatcher";
import type { FollowupGateDb } from "./agent-followup-gate";
import {
  EVENTO_DE_LEAD_CRIADO,
  aplicaGatilhoDeLead,
  createSupabaseGatilhoLeadDb,
  type GatilhoLeadDb,
  type PointerDeLead,
} from "./gatilho-lead";
import { triggerConfigSchema } from "./api-schemas";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "12121212-1212-4212-8212-121212121212";
const POINTER = "22222222-2222-4222-8222-222222222222";
const NEGOCIO = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const VERSION = "99999999-9999-4999-8999-999999999999";
const EVENTO = "e0000000-0000-4000-8000-000000000001";
const OFICIAL = "0f000000-0000-4000-8000-00000000000f";

function evento(): EventRow {
  return {
    id: EVENTO,
    organization_id: ORG,
    event_type: EVENTO_DE_LEAD_CRIADO,
    entity_kind: "crm_lead",
    entity_id: NEGOCIO,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

const semAgente: FollowupGateDb = {
  async loadEnabledPublishedFollowupAgents() {
    return [];
  },
};

/** Fake do gatilho: texto fixo (sem agente), contato achado, enrollment aceito. */
function fakeDb(pointer: PointerDeLead, opts: { recusaNumero?: boolean } = {}) {
  const inscritos: Array<Parameters<GatilhoLeadDb["insereEnrollment"]>[0]> = [];
  const db: GatilhoLeadDb = {
    async carregaPointersDeLead() {
      return [pointer];
    },
    async carregaContatoDoNegocio() {
      return CONTATO;
    },
    async carregaNoDeGatilho() {
      return { id: "t1", pedeAgente: false };
    },
    async insereEnrollment(input) {
      if (opts.recusaNumero) return { inserted: false, id: null, reason: "numero_divergente" };
      inscritos.push(input);
      return { inserted: true, id: "enr-1" };
    },
    async insereEventoDoEnrollment() {},
  };
  return { db, inscritos };
}

const base: PointerDeLead = { id: POINTER, organization_id: ORG, active_version_id: VERSION };
const CLOCK = () => new Date("2026-09-30T12:00:00.000Z");

describe("aplicaGatilhoDeLead com número escolhido", () => {
  it("⭐ número conectado: inscreve e passa o número adiante como a sessão", async () => {
    const { db, inscritos } = fakeDb({
      ...base,
      numero_de_envio: { channel_session_id: OFICIAL, estado: { status: "WORKING", archived_at: null } },
    });
    const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

    expect(s.enrolled).toBe(1);
    expect(inscritos[0]).toMatchObject({ channel_session_id: OFICIAL, contact_id: CONTATO });
    expect(s.numero_indisponivel).toBeUndefined();
  });

  it("⭐ número ARQUIVADO: não inscreve, e o motivo fica registrado", async () => {
    const { db, inscritos } = fakeDb({
      ...base,
      numero_de_envio: {
        channel_session_id: OFICIAL,
        estado: { status: "WORKING", archived_at: "2026-09-29T10:00:00.000Z" },
      },
    });
    const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

    expect(inscritos, "inscreveu por um número excluído").toHaveLength(0);
    expect(s.enrolled).toBe(0);
    expect(s.numero_indisponivel).toEqual([{ pointer_id: POINTER, channel_session_id: OFICIAL, motivo: "arquivado" }]);
  });

  it.each(["FAILED", "STOPPED", "SCAN_QR_CODE", "STARTING"])(
    "⭐ número DESCONECTADO (%s): não inscreve, e o motivo fica registrado",
    async (status) => {
      const { db, inscritos } = fakeDb({
        ...base,
        numero_de_envio: { channel_session_id: OFICIAL, estado: { status, archived_at: null } },
      });
      const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

      expect(inscritos, "inscreveu com o número fora do ar: sairia por outro calado").toHaveLength(0);
      expect(s.numero_indisponivel?.[0]?.motivo).toBe("desconectado");
    },
  );

  it("número que não é mais desta empresa: não inscreve, motivo `nao_encontrado`", async () => {
    const { db, inscritos } = fakeDb({ ...base, numero_de_envio: { channel_session_id: OFICIAL, estado: null } });
    const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

    expect(inscritos).toHaveLength(0);
    expect(s.numero_indisponivel?.[0]?.motivo).toBe("nao_encontrado");
  });

  it("o banco recusa a sessão (conversa em outro número): motivo `divergente`, não é contado como já-vivo", async () => {
    const { db } = fakeDb(
      { ...base, numero_de_envio: { channel_session_id: OFICIAL, estado: { status: "WORKING", archived_at: null } } },
      { recusaNumero: true },
    );
    const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

    expect(s.enrolled).toBe(0);
    expect(s.skipped_existing).toBe(0);
    expect(s.numero_indisponivel?.[0]?.motivo).toBe("divergente");
  });

  it("⭐ controle: SEM o campo, nada muda (sem sessão, sem motivo)", async () => {
    const { db, inscritos } = fakeDb(base);
    const s = await aplicaGatilhoDeLead({ db, gateDb: semAgente, clock: CLOCK }, evento());

    expect(s.enrolled).toBe(1);
    expect(inscritos[0]).not.toHaveProperty("channel_session_id");
    expect(s.numero_indisponivel).toBeUndefined();
  });
});

describe("o schema do gatilho", () => {
  it("aceita o número opcional e continua aceitando o formato antigo", () => {
    expect(triggerConfigSchema.safeParse({ kind: "lead_created" }).success).toBe(true);
    expect(triggerConfigSchema.safeParse({ kind: "lead_created", params: {} }).success).toBe(true);
    expect(
      triggerConfigSchema.safeParse({ kind: "lead_created", params: { channel_session_id: OFICIAL } }).success,
    ).toBe(true);
    expect(
      triggerConfigSchema.safeParse({ kind: "lead_created", params: { channel_session_id: "nao-e-uuid" } }).success,
    ).toBe(false);
  });
});

// ─── O adaptador de verdade (Supabase), com um client de mentira ──────────────

interface Consulta {
  tabela: string;
  filtros: Array<[string, string, unknown]>;
  inserido?: Record<string, unknown>;
}

/**
 * Client mínimo: cada `from()` é uma consulta encadeável que registra os
 * filtros. `channel_sessions` responde FILTRANDO pela organização pedida, para
 * que um id de outra empresa volte sem linha como no banco.
 */
function fakeAdmin(
  pointers: Array<Record<string, unknown>>,
  sessoes: Array<{ id: string; organization_id: string; status: string; archived_at: string | null }>,
) {
  const consultas: Consulta[] = [];
  function resposta(c: Consulta): { data: unknown; error: null } {
    if (c.tabela === "followup_flow_pointers") return { data: pointers, error: null };
    if (c.tabela === "channel_sessions") {
      const org = c.filtros.find(([op, col]) => op === "eq" && col === "organization_id")?.[2];
      const ids = c.filtros.find(([op, col]) => op === "in" && col === "id")?.[2] as string[] | undefined;
      return {
        data: sessoes
          .filter((s) => s.organization_id === org && (!ids || ids.includes(s.id)))
          .map(({ organization_id: _o, ...s }) => s),
        error: null,
      };
    }
    if (c.tabela === "followup_enrollments") return { data: { id: "enr-1" }, error: null };
    return { data: null, error: null };
  }
  const admin = {
    from(tabela: string) {
      const c: Consulta = { tabela, filtros: [] };
      consultas.push(c);
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "not", "is", "order"]) {
        q[op] = (col: string, _b?: unknown, v?: unknown) => {
          if (op !== "select") c.filtros.push([op, col, op === "not" ? v : _b]);
          return q;
        };
      }
      q.insert = (valores: Record<string, unknown>) => {
        c.inserido = valores;
        return q;
      };
      q.maybeSingle = async () => resposta(c);
      q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta(c)).then(ok, falha);
      return q;
    },
  };
  return { admin: admin as never, consultas };
}

function linhaDoPointer(trigger_config: unknown) {
  return { id: POINTER, organization_id: ORG, active_version_id: VERSION, trigger_config, surface: "followup" };
}

const fronteira = { organization_id: ORG, contact_id: CONTATO, conversation_id: "conv-1" };

describe("createSupabaseGatilhoLeadDb", () => {
  beforeEach(() => {
    origem.serviceForEvent.mockReset();
    origem.serviceForEvent.mockResolvedValue(fronteira);
  });

  it("⭐ lê o estado do número NA organização do evento: id de outra empresa volta sem estado", async () => {
    const { admin } = fakeAdmin(
      [linhaDoPointer({ kind: "lead_created", params: { channel_session_id: OFICIAL } })],
      [{ id: OFICIAL, organization_id: OUTRA_ORG, status: "WORKING", archived_at: null }],
    );
    const [p] = await createSupabaseGatilhoLeadDb(admin).carregaPointersDeLead(ORG);

    expect(p?.numero_de_envio).toEqual({ channel_session_id: OFICIAL, estado: null });
  });

  it("número da própria empresa: vem com status e arquivamento", async () => {
    const { admin } = fakeAdmin(
      [linhaDoPointer({ kind: "lead_created", params: { channel_session_id: OFICIAL } })],
      [{ id: OFICIAL, organization_id: ORG, status: "FAILED", archived_at: null }],
    );
    const [p] = await createSupabaseGatilhoLeadDb(admin).carregaPointersDeLead(ORG);

    expect(p?.numero_de_envio?.estado).toEqual({ status: "FAILED", archived_at: null });
  });

  it("sem número escolhido: nem consulta `channel_sessions`", async () => {
    const { admin, consultas } = fakeAdmin([linhaDoPointer({ kind: "lead_created" })], []);
    const [p] = await createSupabaseGatilhoLeadDb(admin).carregaPointersDeLead(ORG);

    expect(p).not.toHaveProperty("numero_de_envio");
    expect(consultas.map((c) => c.tabela)).toEqual(["followup_flow_pointers"]);
  });

  const inscricao = {
    event_id: EVENTO,
    organization_id: ORG,
    pointer_id: POINTER,
    version_id: VERSION,
    contact_id: CONTATO,
    current_node_id: "t1",
    agent_id: null,
  };

  it("⭐ com número: a sessão chega a `serviceForEvent` (o `p_session` do banco) e não vai para a linha", async () => {
    const { admin, consultas } = fakeAdmin([], []);
    const r = await createSupabaseGatilhoLeadDb(admin).insereEnrollment({ ...inscricao, channel_session_id: OFICIAL });

    expect(origem.serviceForEvent).toHaveBeenCalledWith(admin, ORG, EVENTO, CONTATO, OFICIAL);
    expect(r).toEqual({ inserted: true, id: "enr-1" });
    const linha = consultas.find((c) => c.tabela === "followup_enrollments")?.inserido;
    expect(linha).not.toHaveProperty("channel_session_id");
    expect(linha).toMatchObject({ conversation_id: "conv-1" });
  });

  it("⭐ controle: sem número, `serviceForEvent` é chamado como sempre (sem sessão)", async () => {
    const { admin } = fakeAdmin([], []);
    await createSupabaseGatilhoLeadDb(admin).insereEnrollment(inscricao);

    expect(origem.serviceForEvent).toHaveBeenCalledWith(admin, ORG, EVENTO, CONTATO, undefined);
  });

  it("o banco recusa a sessão pedida: vira desfecho `numero_divergente`, não erro", async () => {
    origem.serviceForEvent.mockRejectedValueOnce({ code: "23503", message: "service_channel_mismatch" });
    const { admin } = fakeAdmin([], []);
    const r = await createSupabaseGatilhoLeadDb(admin).insereEnrollment({ ...inscricao, channel_session_id: OFICIAL });

    expect(r).toEqual({ inserted: false, id: null, reason: "numero_divergente" });
  });

  it("controle: a mesma recusa SEM número escolhido continua sendo erro (não é deste item)", async () => {
    origem.serviceForEvent.mockRejectedValueOnce({ code: "23503", message: "service_channel_mismatch" });
    const { admin } = fakeAdmin([], []);

    await expect(createSupabaseGatilhoLeadDb(admin).insereEnrollment(inscricao)).rejects.toMatchObject({
      message: "service_channel_mismatch",
    });
  });
});

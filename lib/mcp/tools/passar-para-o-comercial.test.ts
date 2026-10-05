/**
 * FORK MIA — `crm_passar_para_o_comercial`: ficha + etiquetas + funil até
 * `qualified`, numa chamada, com os MESMOS efeitos das três ferramentas.
 *
 * Só o banco é dublê (a memória do lead e o funil do agente em SQL cru; o CRM
 * pelo cliente do Supabase). O resto é código de produção: `applySaveLeadNote`,
 * `applyLeadStateUpdate`, o espelho no card (`sincronizaEstagioDoAgente`, que
 * emite `lead.stage_changed`) e o handler de `crm_manage_tags` (que emite
 * `contact.tag_added`). O funil de teste é o da Vita Odonto: só "em
 * atendimento" (qualifying) e "Qualificado" (qualified) têm etapa no quadro.
 *
 *     npx vitest run lib/mcp/tools/passar-para-o-comercial.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const memoria = vi.hoisted(() => ({
  estado: null as null | { stage: string; qualification: Record<string, string>; next_action: string | null },
  notas: [] as Array<{ id: string; headline: string; body: string }>,
  transicoes: [] as Array<{ de: string; para: string; job: string | null; motivo: string | null }>,
  avisos: [] as unknown[],
}));

/** O Postgres do motor, só nas consultas que a passagem faz. */
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({
    query: async (sql: string, p: unknown[]) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.startsWith("select * from lead_state")) {
        return { rows: memoria.estado ? [{ ...memoria.estado, next_action_seq: 0 }] : [] };
      }
      if (s.startsWith("select id, headline from lead_notes")) {
        return { rows: memoria.notas.map(({ id, headline }) => ({ id, headline })) };
      }
      if (s.includes("insert into lead_notes")) {
        const id = `nota-${memoria.notas.length + 1}`;
        memoria.notas.push({ id, headline: String(p[3]), body: String(p[4]) });
        return { rows: [{ id, superseded: "0" }] };
      }
      if (s.includes("insert into lead_state ")) {
        const antes = memoria.estado?.stage ?? "new";
        memoria.estado = {
          stage: String(p[2]),
          qualification: JSON.parse(String(p[3])),
          next_action: (p[4] as string | null) ?? null,
        };
        if (s.includes("lead_state_transitions")) {
          memoria.transicoes.push({ de: antes, para: String(p[2]), job: (p[6] as string | null) ?? null, motivo: (p[8] as string | null) ?? null });
        }
        return { rows: [{ ...memoria.estado, next_action_seq: 0 }] };
      }
      if (s.includes("insert into agent_inbox_items")) {
        memoria.avisos.push(p);
        return { rows: [{ id: "aviso" }], rowCount: 1 };
      }
      throw new Error(`consulta não prevista no dublê: ${s.slice(0, 80)}`);
    },
  }),
}));

import { crmPassarParaOComercial, passosAteQualificado } from "@/lib/mcp/tools/passar-para-o-comercial";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const CONTATO = "c0c0c0c0-0000-4000-8000-000000000001";
const NEGOCIO = "1e1e1e1e-0000-4000-8000-000000000002";
const FUNIL = "f0f0f0f0-0000-4000-8000-000000000003";
const ETAPA = { novo: "e-novo", atendimento: "e-atend", qualificado: "e-qualif" };

type Rpc = { fn: string; args: Record<string, unknown> };

/** O CRM: um contato, um negócio aberto no funil SDR, e as etapas com o passo do agente. */
function crm() {
  const rpcs: Rpc[] = [];
  const updates: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
  const negocio = { id: NEGOCIO, organization_id: ORG, pipeline_id: FUNIL, stage_id: ETAPA.novo, status: "open", created_at: "2026-09-29T10:00:00Z", last_activity_at: null, custom_fields: {}, won_reason: null };
  const supabase = {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      let atualizando: Record<string, unknown> | null = null;
      for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
      q.update = (valores: Record<string, unknown>) => {
        updates.push({ tabela, valores });
        atualizando = valores;
        return q;
      };
      q.insert = async () => ({ data: null, error: null });
      q.maybeSingle = async () => {
        if (tabela === "contacts") return { data: { id: CONTATO, tags: [], is_anonymized: false }, error: null };
        if (tabela === "crm_pipelines") return { data: { settings: {} }, error: null };
        if (tabela === "crm_stages") return { data: { name: "Novo" }, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (v: unknown) => unknown) => {
        let data: unknown = null;
        if (tabela === "crm_leads" && atualizando) {
          negocio.stage_id = String(atualizando.stage_id);
          data = [{ id: NEGOCIO }];
        } else if (tabela === "crm_leads") data = [negocio];
        else if (tabela === "crm_stages")
          data = [
            { id: ETAPA.novo, name: "Novo", agent_stage_hint: null, is_archived: false, is_lost: false, is_won: false },
            { id: ETAPA.atendimento, name: "Em atendimento", agent_stage_hint: "qualifying", is_archived: false, is_lost: false, is_won: false },
            { id: ETAPA.qualificado, name: "Qualificado", agent_stage_hint: "qualified", is_archived: false, is_lost: false, is_won: false },
          ];
        return Promise.resolve({ data, error: null }).then(ok);
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: fn === "fn_service_observe_command" ? { conversa: "x" } : null, error: null };
    },
  };
  return { supabase, rpcs, updates, negocio };
}

function ctx(supabase: unknown): McpContext {
  return {
    organizationId: ORG,
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agente", agent_id: "agente", role: "ai_operator", api_token_id: "tok" },
    apiTokenId: "tok",
    requestId: "job-1",
    sourceJobId: "job-1",
    supabase,
  } as unknown as McpContext;
}

const PEDIDO = {
  contact_id: CONTATO,
  ficha: {
    headline: "Implante · São Miguel · quinta à tarde",
    body: "Roberto perdeu um dente, quer implante, prefere São Miguel, pode ir quinta à tarde.",
  },
  etiquetas: ["Sao-Miguel"],
  motivo: "Cliente pediu avaliação de implante e escolheu a unidade.",
};

const eventos = (rpcs: Rpc[]) =>
  rpcs.filter((r) => r.fn === "emit_event").map((r) => r.args as Record<string, unknown>);

beforeEach(() => {
  memoria.estado = null;
  memoria.notas = [];
  memoria.transicoes = [];
  memoria.avisos = [];
});

describe("o caminho da máquina", () => {
  it("só passos válidos, do estágio atual até qualified", () => {
    expect(passosAteQualificado("new")).toEqual(["contacted", "qualifying", "qualified"]);
    expect(passosAteQualificado("contacted")).toEqual(["qualifying", "qualified"]);
    expect(passosAteQualificado("qualifying")).toEqual(["qualified"]);
    expect(passosAteQualificado("negotiating")).toBeNull();
  });
});

describe("crm_passar_para_o_comercial", () => {
  it("⭐ numa chamada: ficha salva, etiqueta no contato, funil em qualified passo a passo", async () => {
    const { supabase, rpcs } = crm();
    const r = (await crmPassarParaOComercial.handler(PEDIDO as never, ctx(supabase))) as Record<string, unknown>;

    expect(r).toMatchObject({ passado: true, de: "new", etapas: ["contacted", "qualifying", "qualified"], ficha_salva: true });
    expect(memoria.notas).toEqual([{ id: "nota-1", headline: PEDIDO.ficha.headline, body: PEDIDO.ficha.body }]);
    expect(memoria.estado?.stage).toBe("qualified");
    // Um passo por vez, com o job do turno e a evidência — nunca o salto.
    expect(memoria.transicoes).toEqual([
      { de: "new", para: "contacted", job: "job-1", motivo: PEDIDO.motivo },
      { de: "contacted", para: "qualifying", job: "job-1", motivo: PEDIDO.motivo },
      { de: "qualifying", para: "qualified", job: "job-1", motivo: PEDIDO.motivo },
    ]);
    // O card: "contacted" não tem etapa no quadro (fica onde está), os outros dois andam.
    expect(r.card).toEqual([
      { etapa: "contacted", moveu: false, motivo: "not_configured" },
      { etapa: "qualifying", moveu: true },
      { etapa: "qualified", moveu: true },
    ]);
    expect(r.etiquetas).toEqual({ aplicadas: ["sao-miguel"] });
    expect(eventos(rpcs).map((e) => e.p_event_type)).toEqual([
      "contact.tag_added",
      "lead.stage_changed",
      "lead.stage_changed",
    ]);
  });

  it("⭐ a regra 'etapa Qualificado' casa UMA vez — no passo que chega lá", async () => {
    const { supabase, rpcs } = crm();
    await crmPassarParaOComercial.handler(PEDIDO as never, ctx(supabase));
    const chegouNoQualificado = eventos(rpcs).filter(
      (e) =>
        e.p_event_type === "lead.stage_changed" &&
        (e.p_payload as { to_stage_id?: string }).to_stage_id === ETAPA.qualificado,
    );
    expect(chegouNoQualificado).toHaveLength(1);
    expect(chegouNoQualificado[0]).toMatchObject({ p_entity_kind: "crm_lead", p_entity_id: NEGOCIO });
  });

  it("⭐ idempotente: já em qualified, won ou lost → nada acontece", async () => {
    for (const etapa of ["qualified", "negotiating", "won", "lost"]) {
      memoria.estado = { stage: etapa, qualification: {}, next_action: null };
      memoria.notas = [];
      const { supabase, rpcs, updates } = crm();
      const r = (await crmPassarParaOComercial.handler(PEDIDO as never, ctx(supabase))) as Record<string, unknown>;
      expect(r).toMatchObject({ passado: false, ja_estava: etapa });
      expect(memoria.notas).toEqual([]);
      expect(eventos(rpcs)).toEqual([]);
      expect(updates).toEqual([]);
    }
  });

  it("de onde parou: lead já em qualifying anda um passo só", async () => {
    memoria.estado = { stage: "qualifying", qualification: {}, next_action: null };
    const { supabase } = crm();
    const r = (await crmPassarParaOComercial.handler(
      { ...PEDIDO, qualificacao: { need: "implante" }, proxima_acao: "avaliação quinta" } as never,
      ctx(supabase),
    )) as Record<string, unknown>;
    expect(r).toMatchObject({ passado: true, etapas: ["qualified"] });
    expect(memoria.estado).toMatchObject({ stage: "qualified", qualification: { need: "implante" }, next_action: "avaliação quinta" });
  });

  it("ficha que não cabe no índice: ensina a consolidar e NÃO mexe no funil", async () => {
    memoria.notas = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, headline: "x".repeat(60), body: "y" }));
    const { supabase, rpcs } = crm();
    const r = (await crmPassarParaOComercial.handler(PEDIDO as never, ctx(supabase))) as Record<string, unknown>;
    expect(r).toMatchObject({ passado: false, motivo: "ficha_index_budget_exceeded" });
    expect(String(r.mensagem)).toMatch(/supersedes/);
    expect(memoria.estado).toBeNull();
    expect(eventos(rpcs)).toEqual([]);
  });

  it("contato de outra conta: recusa sem tocar em nada", async () => {
    const { supabase } = crm();
    const semContato = {
      ...supabase,
      from: (t: string) => {
        const q = supabase.from(t) as Record<string, unknown>;
        if (t === "contacts") q.maybeSingle = async () => ({ data: null, error: null });
        return q;
      },
    };
    const r = (await crmPassarParaOComercial.handler(PEDIDO as never, ctx(semContato))) as Record<string, unknown>;
    expect(r).toMatchObject({ passado: false, motivo: "contato_nao_encontrado" });
    expect(memoria.notas).toEqual([]);
  });
});

/**
 * FORK MIA — a etiqueta posta pelo AGENTE dispara a automação, como a da tela.
 *
 * Medido antes do conserto: `crm_manage_tags` gravava e auditava, e NENHUM
 * `contact.tag_added` saía — a regra "Quando um contato ganhar uma tag" nunca
 * via a etiqueta que a IA punha. A prova vai pela ferramenta REAL (o handler de
 * `lib/mcp/tools/governance.ts`) e leva o evento que ela emite até o motor REAL
 * de regras (`runAutomationForEvent`): o par é o que importa — o evento sair e a
 * regra rodar por causa dele.
 *
 *     npx vitest run lib/mcp/tools/tag-adicionada-pela-ferramenta.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { runAutomationForEvent } from "@/lib/automation/engine";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { crmManageTags } from "@/lib/mcp/tools/governance";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const CONTATO = "c0c0c0c0-0000-4000-8000-000000000001";
const NEGOCIO = "1e1e1e1e-0000-4000-8000-000000000002";
const AGENTE = "a9a9a9a9-0000-4000-8000-000000000003";

type Rpc = { fn: string; args: Record<string, unknown> };

/** Supabase de mentira: a linha do alvo, e o registro de toda RPC chamada. */
function banco(opts: { tags: string[]; emitFalha?: boolean }) {
  const rpcs: Rpc[] = [];
  const supabase = {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "update"]) q[m] = () => q;
      q.maybeSingle = async () =>
        tabela === "crm_leads"
          ? { data: { id: NEGOCIO, tags: opts.tags, contact_id: CONTATO }, error: null }
          : { data: { id: CONTATO, tags: opts.tags }, error: null };
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "fn_service_observe_command") return { data: { conversa: "x" }, error: null };
      if (fn === "emit_event" && opts.emitFalha) return { data: null, error: { message: "boom" } };
      return { data: null, error: null };
    },
  };
  return { supabase, rpcs };
}

function ctx(supabase: unknown, requestId = "job-da-sofia"): McpContext {
  return {
    organizationId: ORG,
    role: "ai_operator",
    actor: { type: "ai_agent", id: AGENTE, agent_id: AGENTE, role: "ai_operator", api_token_id: "tok-1" },
    apiTokenId: "tok-1",
    requestId,
    supabase,
  } as unknown as McpContext;
}

const emitidos = (rpcs: Rpc[]) => rpcs.filter((r) => r.fn === "emit_event").map((r) => r.args);

describe("crm_manage_tags emite o evento da etiqueta", () => {
  it("⭐ contato: `contact.tag_added` com o MESMO payload da tela", async () => {
    const { supabase, rpcs } = banco({ tags: ["paciente"] });
    await crmManageTags.handler(
      { target_kind: "contact", target_id: CONTATO, add: ["Sao-Miguel", "paciente"] },
      ctx(supabase),
    );
    expect(emitidos(rpcs)).toEqual([
      {
        p_event_type: "contact.tag_added",
        p_entity_kind: "contact",
        p_entity_id: CONTATO,
        p_payload: {
          added_tags: ["sao-miguel"],
          tags: ["paciente", "sao-miguel"],
          service_origin: { kind: "command", observed: { conversa: "x" } },
        },
        p_metadata: {
          request_id: "job-da-sofia",
          actor_type: "ai_agent",
          actor_id: AGENTE,
          actor_api_token_id: "tok-1",
          via: "mcp",
        },
        p_organization_id: ORG,
      },
    ]);
  });

  it("negócio: `lead.tag_added`, entidade `crm_lead`, rastro pelo contato do negócio", async () => {
    const { supabase, rpcs } = banco({ tags: [] });
    await crmManageTags.handler(
      { target_kind: "lead", target_id: NEGOCIO, add: ["qualificado"] },
      ctx(supabase),
    );
    const [e] = emitidos(rpcs);
    expect(e).toMatchObject({ p_event_type: "lead.tag_added", p_entity_kind: "crm_lead", p_entity_id: NEGOCIO });
    expect(rpcs.find((r) => r.fn === "fn_service_observe_command")?.args).toEqual({ p_org: ORG, p_contact: CONTATO });
  });

  it("⭐ repor a MESMA etiqueta não reemite — o laço não tem por onde girar", async () => {
    const { supabase, rpcs } = banco({ tags: ["sao-miguel"] });
    await crmManageTags.handler(
      { target_kind: "contact", target_id: CONTATO, add: ["sao-miguel"] },
      ctx(supabase),
    );
    expect(emitidos(rpcs)).toEqual([]);
  });

  it("só remover não emite; etiqueta de CONVERSA não tem gatilho", async () => {
    const a = banco({ tags: ["x"] });
    await crmManageTags.handler({ target_kind: "contact", target_id: CONTATO, remove: ["x"] }, ctx(a.supabase));
    expect(emitidos(a.rpcs)).toEqual([]);
    const b = banco({ tags: [] });
    await crmManageTags.handler({ target_kind: "conversation", target_id: CONTATO, add: ["y"] }, ctx(b.supabase));
    expect(emitidos(b.rpcs)).toEqual([]);
  });

  it("falha do evento não desfaz a etiqueta: a ferramenta responde com o que gravou", async () => {
    const { supabase } = banco({ tags: [], emitFalha: true });
    const r = await crmManageTags.handler(
      { target_kind: "contact", target_id: CONTATO, add: ["sao-miguel"] },
      ctx(supabase),
    );
    expect(r).toMatchObject({ tags: ["sao-miguel"] });
  });
});

describe("o evento da ferramenta chega à regra", () => {
  /** Motor com UMA regra: "contato ganhou `sao-miguel`". */
  function motor() {
    const execucoes: unknown[] = [];
    const admin = {
      from: (tabela: string) => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "order", "update"]) q[m] = () => q;
        q.insert = (linha: unknown) => {
          if (tabela === "automation_rule_runs") execucoes.push(linha);
          return q;
        };
        q.maybeSingle = async () =>
          tabela === "contacts"
            ? { data: { id: CONTATO, tags: ["sao-miguel"] }, error: null }
            : { data: tabela === "automation_rule_runs" ? { id: "run-1" } : { run_count: 0 }, error: null };
        q.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve(
            tabela === "automation_rules"
              ? {
                  data: [
                    {
                      id: "regra-sm",
                      name: "Unidade São Miguel → avisa o comercial",
                      conditions: [{ field: "event.added_tags", op: "contains", value: "sao-miguel" }],
                      actions: [{ type: "acao_de_teste_inexistente" }],
                    },
                  ],
                  error: null,
                }
              : { data: null, error: null },
          ).then(ok);
        return q;
      },
      rpc: async () => ({ data: null, error: null }),
    };
    return { admin, execucoes };
  }

  async function eventoDaFerramenta(requestId: string): Promise<EventRow> {
    const { supabase, rpcs } = banco({ tags: [] });
    await crmManageTags.handler(
      { target_kind: "contact", target_id: CONTATO, add: ["sao-miguel"] },
      ctx(supabase, requestId),
    );
    const e = emitidos(rpcs)[0]!;
    return {
      id: "evt-1",
      organization_id: e.p_organization_id as string,
      event_type: e.p_event_type as string,
      entity_kind: e.p_entity_kind as string,
      entity_id: e.p_entity_id as string,
      payload: e.p_payload as Record<string, unknown>,
      metadata: e.p_metadata as Record<string, unknown>,
      consumed_by: [],
      attempts: 0,
    };
  }

  it("⭐ a regra de etiqueta RODA pelo evento que o agente gerou", async () => {
    const { admin, execucoes } = motor();
    const r = await runAutomationForEvent(admin as never, await eventoDaFerramenta("job-da-sofia"));
    expect(r.status).toBe("ok");
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]).toMatchObject({ rule_id: "regra-sm", event_id: "evt-1" });
  });

  it("⭐ sem laço: chamada feita a partir de uma regra (`rule:`) não redispara regra", async () => {
    const { admin, execucoes } = motor();
    const r = await runAutomationForEvent(admin as never, await eventoDaFerramenta("rule:regra-sm"));
    expect(r).toMatchObject({ status: "skipped", detail: "caused_by_rule" });
    expect(execucoes).toEqual([]);
  });
});

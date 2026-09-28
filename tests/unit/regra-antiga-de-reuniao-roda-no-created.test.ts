// @vitest-environment node
/**
 * A REGRA SALVA COMO `appointment.booked` RODA NO `appointment.created` — e uma
 * vez só (fork MIA).
 *
 * ## O defeito que esta cerca fecha
 *
 * A agenda anunciava a reunião marcada duas vezes: `appointment.booked` (o
 * nome que este fork deu primeiro) e `appointment.created` (o do upstream,
 * #1612), no mesmo instante. A cerca do upstream
 * (`tests/unit/agenda-aviso-de-compromisso.test.ts`) exige UM aviso, e o
 * handler passou a emitir só o `created`. Só que o motor casa regra por
 * `trigger_event = event_type`, e as regras de cliente em produção estão
 * salvas com o nome antigo — card no funil comercial e aviso no grupo do time.
 * Sem a ponte, elas param caladas: a regra continua na tela, a reunião é
 * marcada, e nada roda.
 *
 * ## Onde a sonda olha
 *
 * No EFEITO do motor de verdade (`runAutomationForEvent`): a ação da regra
 * executou, com o contexto que ela lê. Só o banco é falso — em memória, e ele
 * FILTRA pelos `eq` que recebe, então uma busca pelo gatilho errado volta vazia
 * como voltaria no Postgres.
 *
 * ## Comando
 *
 *     npx vitest run tests/unit/regra-antiga-de-reuniao-roda-no-created.test.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerAction } from "@/lib/automation/actions";
import { runAutomationForEvent } from "@/lib/automation/engine";
import type { ActionCtx } from "@/lib/automation/types";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const AGENDAMENTO = "ffffffff-0000-4000-8000-00000000000f";
const CONTATO = "dddddddd-0000-4000-8000-00000000000d";
const NEGOCIO = "eeeeeeee-0000-4000-8000-00000000000e";
const REGRA_ANTIGA = "11111111-0000-4000-8000-000000000001";
const REGRA_DE_HOJE = "22222222-0000-4000-8000-000000000002";

type Linha = Record<string, unknown>;

/** Cada execução da ação espiã: qual regra, e o que ela enxergou. */
const execucoes: Array<{ regra: string; lead: unknown; tipo: unknown }> = [];

registerAction({
  type: "espiao_da_regra_antiga",
  async execute(ctx: ActionCtx) {
    const contexto = ctx.context as { lead?: { id?: unknown }; event?: Linha };
    execucoes.push({
      regra: ctx.ruleId,
      lead: contexto.lead?.id ?? null,
      tipo: contexto.event?.nome_do_tipo ?? null,
    });
    return { type: "espiao_da_regra_antiga", status: "success" };
  },
});

let tabelas: Record<string, Linha[]>;
/** Quantas vezes `automation_rules` foi lida por gatilho — o custo da ponte. */
let leiturasDeRegra: string[];

function bancoFalso(): SupabaseClient {
  return {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let inserida: Linha | null = null;
      const linhas = (): Linha[] =>
        inserida ? [inserida] : (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v));
      const consulta: Record<string, unknown> = {
        select: () => consulta,
        order: () => consulta,
        update: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          filtros.push([coluna, valor]);
          if (tabela === "automation_rules" && coluna === "trigger_event") leiturasDeRegra.push(String(valor));
          return consulta;
        },
        insert: (linha: Linha) => {
          inserida = { id: `linha-${Math.random()}`, ...linha };
          (tabelas[tabela] ??= []).push(inserida);
          return consulta;
        },
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        single: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas(), error: null }).then(ok, erro),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

function regra(id: string, gatilho: string, conditions: Linha[] = []): Linha {
  return {
    id,
    organization_id: ORG,
    name: `regra ${gatilho}`,
    trigger_event: gatilho,
    is_active: true,
    conditions,
    actions: [{ type: "espiao_da_regra_antiga", config: {} }],
    run_count: 0,
  };
}

/** O corpo que o handler da agenda emite hoje ao marcar (ver `fecharOLaco`). */
function evento(tipo: string): EventRow {
  return {
    id: `evento-${tipo}`,
    organization_id: ORG,
    event_type: tipo,
    entity_kind: "calendar_appointment",
    entity_id: AGENDAMENTO,
    payload: {
      appointment_id: AGENDAMENTO,
      contact_id: CONTATO,
      event_type_name: "Consulta",
      lead_ids: [NEGOCIO],
      lead_id: NEGOCIO,
      nome_do_tipo: "Consulta",
    },
    metadata: { request_id: "req-1" },
    consumed_by: [],
    attempts: 0,
  };
}

beforeEach(() => {
  execucoes.length = 0;
  leiturasDeRegra = [];
  tabelas = {
    automation_rules: [
      // A regra de produção: o nome antigo, e a condição pelo campo antigo.
      regra(REGRA_ANTIGA, "appointment.booked", [{ field: "event.nome_do_tipo", op: "eq", value: "Consulta" }]),
      regra(REGRA_DE_HOJE, "appointment.created"),
    ],
    calendar_appointments: [{ id: AGENDAMENTO, organization_id: ORG, contact_id: CONTATO }],
    contacts: [{ id: CONTATO, organization_id: ORG }],
    crm_leads: [{ id: NEGOCIO, organization_id: ORG, contact_id: CONTATO }],
    automation_rule_runs: [],
  };
});

describe("a regra salva com o nome antigo de 'horário marcado'", () => {
  it("roda no appointment.created, com o negócio e o tipo que ela lê", async () => {
    const r = await runAutomationForEvent(bancoFalso(), evento("appointment.created"));

    expect(r.status).toBe("ok");
    const daAntiga = execucoes.filter((e) => e.regra === REGRA_ANTIGA);
    expect(
      daAntiga,
      "a regra salva como appointment.booked não rodou: o card não nasce no comercial e o grupo do time não recebe o aviso — calado, porque a regra continua na tela",
    ).toHaveLength(1);
    expect(daAntiga[0]!.lead, "sem o negócio no contexto, create_or_move_lead cria card duplicado").toBe(NEGOCIO);
    expect(daAntiga[0]!.tipo, "a condição e o token {{event.nome_do_tipo}} da regra antiga leem esta chave").toBe(
      "Consulta",
    );
    expect(execucoes.filter((e) => e.regra === REGRA_DE_HOJE), "a regra do nome de hoje também roda").toHaveLength(1);
  });

  it("um appointment.booked que ainda estava na fila roda a regra antiga UMA vez, e não a de hoje", async () => {
    await runAutomationForEvent(bancoFalso(), evento("appointment.booked"));

    expect(execucoes.map((e) => e.regra), "a ponte não pode fazer a regra antiga rodar em dobro").toEqual([
      REGRA_ANTIGA,
    ]);
  });

  it("qualquer outro gatilho continua com UMA leitura de regras — a ponte não custa nada a quem não é agenda", async () => {
    await runAutomationForEvent(bancoFalso(), evento("appointment.cancelled"));

    expect(leiturasDeRegra).toEqual(["appointment.cancelled"]);
    expect(execucoes).toHaveLength(0);
  });
});

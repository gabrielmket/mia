/**
 * FORK MIA — as leituras de servidor do cartão: os sinais do quadro e a tarefa
 * que nasce ao aprovar a próxima ação. Banco em memória (tabelas de verdade),
 * para medir QUAL linha foi lida e o que foi gravado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/tarefas/atividade", () => ({
  registraAtividadeDaTarefa: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { audit } from "@/lib/audit";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { bancoEmMemoria, type Linha } from "../../tests/helpers/banco-em-memoria";
import type { Lead } from "@/lib/types/leads";
import { comSinaisDoCartao, objecaoAberta } from "./sinais-do-quadro";
import {
  criarTarefaDaProximaAcao,
  prazoDaProximaAcao,
  responsavelDaProximaAcao,
} from "./tarefa-da-proxima-acao";

const ORG = "org-1";

function negocio(over: Partial<Lead> = {}): Lead {
  return {
    id: "L1",
    organization_id: ORG,
    pipeline_id: "P",
    stage_id: "S1",
    contact_id: "C1",
    title: "Apto 2 dorm",
    description: null,
    status: "open",
    lost_reason: null,
    position_in_stage: 1,
    value_cents: 48_500_000,
    currency: "BRL",
    owner_user_id: null,
    owner_kind: null,
    owner_agent_id: null,
    assigned_at: null,
    last_activity_at: null,
    stage_changed_at: null,
    expected_close_date: null,
    closed_at: null,
    source: "whatsapp",
    source_metadata: {},
    external_id: null,
    custom_fields: {},
    tags: [],
    created_at: "2026-09-26T12:00:00Z",
    updated_at: "2026-09-26T12:00:00Z",
    created_by_user_id: null,
    conversa: { id: "CV1", preview: "e a parcela?", last_message_at: "2026-09-30T11:48:00Z", unread: 2 },
    ...over,
  };
}

function banco(extra: Record<string, Linha[]> = {}, sinais: Linha[] = []) {
  const b = bancoEmMemoria({
    contacts: [
      { id: "C1", organization_id: ORG, name: "Mariana Costa", display_name: null, source: "whatsapp", source_metadata: {}, cargo: null, is_anonymized: false, empresa_id: null },
    ],
    conversations: [
      { id: "CV1", organization_id: ORG, last_inbound_at: "2026-09-30T11:48:00Z", last_outbound_at: "2026-09-30T10:00:00Z" },
    ],
    calendar_appointments: [],
    calendar_event_types: [],
    crm_lead_links: [],
    crm_tasks: [],
    crm_leads: [],
    orders: [],
    ...extra,
  });
  const rpc = vi.fn(async (_nome: string, _args: unknown) => ({ data: sinais, error: null }));
  return { ...b, cliente: { ...b.cliente, rpc } as unknown as Parameters<typeof comSinaisDoCartao>[0], rpc };
}

const agora = new Date("2026-09-30T15:00:00Z");

describe("os sinais do quadro", () => {
  it("anexa bola, objeção, compromisso ligado ao negócio, tarefa atrasada e compras — e a bola também na conversa", async () => {
    const { cliente, rpc } = banco(
      {
        calendar_appointments: [
          { id: "A-outro", organization_id: ORG, contact_id: "C1", title: "Outro", event_type_id: null, location_kind: "phone", location_details: null, starts_at: "2026-10-01T13:00:00Z", ends_at: "2026-10-01T14:00:00Z", time_zone: "America/Sao_Paulo", status: "confirmed" },
          { id: "A-meu", organization_id: ORG, contact_id: "C1", title: "Visita", event_type_id: "T1", location_kind: "in_person", location_details: "Jardim das Flores", starts_at: "2026-10-03T13:00:00Z", ends_at: "2026-10-03T14:00:00Z", time_zone: "America/Sao_Paulo", status: "confirmed" },
        ],
        calendar_event_types: [{ id: "T1", organization_id: ORG, name: "Visita ao decorado" }],
        crm_lead_links: [
          { organization_id: ORG, lead_id: "L1", target_kind: "appointment", target_id: "A-meu" },
          { organization_id: ORG, lead_id: "L9", target_kind: "appointment", target_id: "A-outro" },
        ],
        crm_tasks: [
          { id: "T-atr", organization_id: ORG, lead_id: "L1", due_date: "2026-09-28T12:00:00Z", status: "pending" },
          { id: "T-fut", organization_id: ORG, lead_id: "L1", due_date: "2026-10-02T12:00:00Z", status: "pending" },
          { id: "T-feita", organization_id: ORG, lead_id: "L1", due_date: "2026-09-20T12:00:00Z", status: "done" },
        ],
        crm_leads: [
          { id: "G1", organization_id: ORG, contact_id: "C1", empresa_id: null, status: "won", value_cents: 30_000_000, currency: "BRL" },
        ],
      },
      [{ contact_id: "C1", objecoes: ["distância do metrô", "parcela da obra"], objecoes_em: null, ultima_saida_via: "ai", ultima_saida_por: null, ultima_saida_em: null }],
    );
    const [l] = await comSinaisDoCartao(cliente, ORG, [negocio()], { agora, etapas: [{ id: "S1", is_won: false, is_lost: false, win_probability: 40 }] });

    expect(rpc).toHaveBeenCalledWith("fn_mia_sinais_do_cartao", { p_org: ORG, p_contatos: ["C1"] });
    expect(l!.cartao?.bola).toMatchObject({ com: "nos", quem: "lead" });
    expect(l!.conversa?.bola).toEqual(l!.cartao?.bola);
    expect(l!.cartao?.objecao).toBe("parcela da obra");
    expect(l!.cartao?.compromisso?.id).toBe("A-meu");
    expect(l!.cartao?.compromisso?.tipo).toBe("Visita ao decorado");
    expect(l!.cartao?.tarefasAtrasadas).toBe(1);
    expect(l!.cartao?.temTarefaFutura).toBe(true);
    expect(l!.cartao?.compras).toEqual({ quantidade: 1, totalCents: 30_000_000, moeda: "BRL" });
    expect(l!.cartao?.canal.sigla).toBe("DIRETO");
    expect(l!.cartao?.contatoNome).toBe("Mariana Costa");
    expect(l!.cartao?.chanceDaEtapa).toBe(40);
  });

  it("contato anonimizado (LGPD) não mostra nome nem objeção", async () => {
    const { cliente } = banco(
      {
        contacts: [{ id: "C1", organization_id: ORG, name: "Cliente Anonimizado #3", display_name: null, source: "whatsapp", source_metadata: {}, cargo: null, is_anonymized: true }],
      },
      [{ contact_id: "C1", objecoes: ["preço"], objecoes_em: null, ultima_saida_via: null, ultima_saida_por: null, ultima_saida_em: null }],
    );
    const [l] = await comSinaisDoCartao(cliente, ORG, [negocio()], { agora });
    expect(l!.cartao?.contatoNome).toBeNull();
    expect(l!.cartao?.objecao).toBeNull();
  });

  it("negócio de EMPRESA: a pessoa principal com cargo, os outros contatos envolvidos e as compras da empresa", async () => {
    const { cliente } = banco({
      contacts: [
        { id: "C1", organization_id: ORG, name: "Carla Mendes", display_name: null, source: "whatsapp", source_metadata: {}, cargo: "Sócia", is_anonymized: false, empresa_id: "E1" },
        { id: "C2", organization_id: ORG, name: "Ricardo Alves", display_name: null, source: "whatsapp", source_metadata: {}, cargo: null, is_anonymized: false, empresa_id: "E1" },
      ],
      crm_lead_links: [
        { organization_id: ORG, lead_id: "L1", target_kind: "contact", target_id: "C2" },
        { organization_id: ORG, lead_id: "L1", target_kind: "contact", target_id: "C3" },
      ],
      crm_leads: [
        { id: "G1", organization_id: ORG, contact_id: "C1", empresa_id: "E1", status: "won", value_cents: 42_000_000, currency: "BRL" },
        { id: "G2", organization_id: ORG, contact_id: "C2", empresa_id: null, status: "won", value_cents: 45_000_000, currency: "BRL" },
      ],
    });
    const [l] = await comSinaisDoCartao(cliente, ORG, [negocio({ empresa_id: "E1", empresa_nome: "Clínica Vida Plena" })], { agora });
    expect(l!.cartao?.pessoa).toEqual({ nome: "Carla Mendes", cargo: "Sócia", papel: null, outros: 2 });
    // Soma quem comprou: G1 (ligado à empresa) e G2 (de uma pessoa da empresa), sem contar duas vezes.
    expect(l!.cartao?.compras).toEqual({ quantidade: 2, totalCents: 87_000_000, moeda: "BRL" });
  });

  it("falha de leitura NUNCA derruba o quadro: devolve os cartões como vieram", async () => {
    const quebrado = {
      from: () => {
        throw new Error("banco fora");
      },
      rpc: async () => ({ data: null, error: null }),
    } as unknown as Parameters<typeof comSinaisDoCartao>[0];
    const leads = [negocio()];
    expect(await comSinaisDoCartao(quebrado, ORG, leads, { agora })).toBe(leads);
  });

  it("a objeção aberta é o último item do retrato", () => {
    expect(objecaoAberta(["a", "b"])).toBe("b");
    expect(objecaoAberta([])).toBeNull();
    expect(objecaoAberta(null)).toBeNull();
  });
});

describe("aprovar a próxima ação cria a tarefa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prazo: hoje 18h antes das 17h; depois disso, amanhã 10h — no fuso da empresa", () => {
    // 12h em São Paulo
    expect(prazoDaProximaAcao(new Date("2026-09-30T15:00:00Z"), "America/Sao_Paulo").toISOString()).toBe(
      "2026-09-30T21:00:00.000Z",
    );
    // 17h30 em São Paulo
    expect(prazoDaProximaAcao(new Date("2026-09-30T20:30:00Z"), "America/Sao_Paulo").toISOString()).toBe(
      "2026-10-01T13:00:00.000Z",
    );
  });

  it("responsável: o dono humano; negócio do agente ou sem dono, quem aprovou", () => {
    expect(responsavelDaProximaAcao({ owner_kind: "user", owner_user_id: "U-dono" }, "U-aprovou")).toBe("U-dono");
    expect(responsavelDaProximaAcao({ owner_kind: "ai", owner_user_id: null }, "U-aprovou")).toBe("U-aprovou");
    expect(responsavelDaProximaAcao({ owner_kind: null, owner_user_id: null }, "U-aprovou")).toBe("U-aprovou");
  });

  it("grava a tarefa ligada ao negócio e ao contato, com a origem, audita e registra na linha do tempo", async () => {
    const b = bancoEmMemoria({
      crm_leads: [{ id: "L1", organization_id: ORG, owner_kind: "user", owner_user_id: "U-dono" }],
      organizations: [{ id: ORG, timezone: "America/Sao_Paulo" }],
      crm_tasks: [],
    });
    const tarefa = await criarTarefaDaProximaAcao(b.cliente as never, {
      organizationId: ORG,
      leadId: "L1",
      contactId: "C1",
      texto: "  Enviar simulação da parcela da obra  ",
      quemAprovou: "U-aprovou",
      requestId: "req",
      agora: new Date("2026-09-30T15:00:00Z"),
    });
    expect(tarefa).toMatchObject({ title: "Enviar simulação da parcela da obra", assigned_to: "U-dono", due_date: "2026-09-30T21:00:00.000Z" });
    const gravada = b.db.crm_tasks![0]!;
    expect(gravada).toMatchObject({
      organization_id: ORG,
      lead_id: "L1",
      contact_id: "C1",
      status: "pending",
      created_by: "U-aprovou",
      source_kind: "next_action_approved",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "crm_task.created", organizationId: ORG }));
    expect(registraAtividadeDaTarefa).toHaveBeenCalledWith(
      b.cliente,
      expect.objectContaining({ tipo: "task_created", actor: { type: "user", id: "U-aprovou" } }),
    );
  });
});

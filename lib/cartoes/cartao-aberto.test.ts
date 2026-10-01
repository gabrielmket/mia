/**
 * FORK MIA — as regras e a leitura do cartão aberto: resumo da IA (objeções
 * abertas × respondidas, promessas), primeira mensagem sem códigos de rastreio,
 * conversões, histórico com filtros, "veio da conversa" e a montagem completa
 * num banco em memória.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { bancoEmMemoria } from "../../tests/helpers/banco-em-memoria";
import type { TimelineItemView } from "@/lib/types/contacts";
import {
  objecoesDosRetratos,
  promessasDosRetratos,
  resumoDaIa,
  semCodigosDeRastreio,
  situacaoDaConversao,
} from "./cartao-aberto";
import { montarCartaoAberto } from "./cartao-aberto-servidor";
import { chavesPersonalizadasAlteradas, origemDosCampos } from "./campos-da-conversa";
import { contagemDoFiltro, montarHistorico } from "./historico";

describe("resumo da IA", () => {
  it("objeção aberta = retrato atual; respondida = esteve e saiu; sem repetir", () => {
    expect(
      objecoesDosRetratos([
        { objections: ["parcela da obra"] },
        { objections: ["distância do metrô", "parcela da obra"] },
        { objections: ["Distância do metrô"] },
      ]),
    ).toEqual([
      { texto: "parcela da obra", aberta: true },
      { texto: "distância do metrô", aberta: false },
    ]);
    expect(objecoesDosRetratos([])).toEqual([]);
  });

  it("promessas da última declaração que tem promessas", () => {
    expect(
      promessasDosRetratos([
        { declaracao: null },
        { declaracao: { promessas: [{ o_que: "Enviar simulação", prazo: "2026-10-01T18:00:00Z" }, { o_que: " " }] } },
      ]),
    ).toEqual([{ oQue: "Enviar simulação", prazo: "2026-10-01T18:00:00Z" }]);
  });

  it("BANT, compromissos e resumo do último turno; nada registrado = nulo", () => {
    const r = resumoDaIa(
      { stage: "qualified", qualification: { need: "2 dorm com varanda", budget: "parcela até 3.200", authority: " " }, updated_at: "2026-09-30T10:00:00Z" },
      [{ objections: [], commitments: ["mandar a planta"], rolling_summary: "Viu o vídeo tour.", created_at: "2026-09-30T11:00:00Z" }],
    )!;
    expect(r).toMatchObject({
      estagio: "qualified",
      quer: "2 dorm com varanda",
      orcamento: "parcela até 3.200",
      decide: null,
      prazo: null,
      compromissos: ["mandar a planta"],
      resumo: "Viu o vídeo tour.",
      atualizadoEm: "2026-09-30T11:00:00Z",
    });
    expect(resumoDaIa(null, [])).toBeNull();
  });

  it("a 1ª mensagem sai sem os códigos do link rastreável e do site", () => {
    expect(semCodigosDeRastreio("Oi! Vi o vídeo [ref:ABC234] e quero saber [dk1:eyJ1dG0iOiJ4In0]")).toBe(
      "Oi! Vi o vídeo e quero saber",
    );
  });

  it("situação da conversão", () => {
    expect(situacaoDaConversao("sent", null)).toBe("enviada");
    expect(situacaoDaConversao("error", "recusado_pela_plataforma")).toBe("falha");
    expect(situacaoDaConversao("skipped", "aguardando_processamento")).toBe("aguardando");
    expect(situacaoDaConversao("skipped", "sem_valor")).toBe("nao_enviada");
  });
});

function atividade(over: Partial<TimelineItemView>): TimelineItemView {
  return {
    id: over.id ?? Math.random().toString(36),
    organization_id: "o",
    lead_id: "L",
    contact_id: null,
    source_module: "crm",
    source_id: null,
    type: "note",
    payload: {},
    metadata: {},
    performed_at: "2026-09-30T10:00:00Z",
    performed_by_user_id: null,
    actor_kind: "user",
    ...over,
  };
}

describe("histórico com filtros", () => {
  const itens = [
    atividade({ id: "n", type: "note", payload: { texto: "o marido só aos sábados", fixada: true }, performed_at: "2026-09-28T10:00:00Z" }),
    atividade({ id: "s", type: "stage_changed", performed_at: "2026-09-29T19:38:00Z" }),
    atividade({ id: "v1", type: "send_vetoed", actor_kind: "ai", performed_at: "2026-09-29T20:05:00Z" }),
    atividade({ id: "v2", type: "send_vetoed", actor_kind: "ai", performed_at: "2026-09-29T20:31:00Z" }),
    atividade({ id: "t1", type: "ai_turn", actor_kind: "ai", performed_at: "2026-09-29T21:00:00Z" }),
    atividade({ id: "tk", type: "task_created", performed_at: "2026-09-29T19:45:00Z" }),
    atividade({ id: "cv", type: "conversation_claimed", performed_at: "2026-09-29T19:40:00Z" }),
  ];

  it("Importante: fixada no topo, e a rotina da IA de um dia vira UMA linha com as decisões de não enviar", () => {
    const h = montarHistorico(itens, "importante");
    expect(h[0]).toMatchObject({ tipo: "item", fixada: true });
    const grupo = h.find((e) => e.tipo === "ia-do-dia");
    expect(grupo).toMatchObject({ tipo: "ia-do-dia", naoEnviou: 2 });
    expect(grupo && "itens" in grupo ? grupo.itens.map((i) => i.id) : []).toEqual(["t1", "v2", "v1"]);
    expect(h.filter((e) => e.tipo === "item").map((e) => (e.tipo === "item" ? e.item.id : ""))).toEqual(["n", "tk", "cv", "s"]);
  });

  it("Tudo mostra tudo; Tarefas e Conversas recortam; as contagens batem", () => {
    expect(montarHistorico(itens, "tudo")).toHaveLength(7);
    expect(montarHistorico(itens, "tarefas").map((e) => (e.tipo === "item" ? e.item.id : ""))).toEqual(["tk"]);
    expect(montarHistorico(itens, "conversas").map((e) => (e.tipo === "item" ? e.item.id : ""))).toEqual(["cv"]);
    expect(contagemDoFiltro(itens, "importante")).toBe(4);
    expect(contagemDoFiltro(itens, "tudo")).toBe(7);
  });
});

describe("veio da conversa", () => {
  it("as chaves que mudaram", () => {
    expect(chavesPersonalizadasAlteradas({ a: 1, b: "x", c: "" }, { a: 1, b: "y" })).toEqual(["b"]);
    expect(chavesPersonalizadasAlteradas({ novo: ["x"] }, null)).toEqual(["novo"]);
  });

  it("vale a última palavra: IA marca; pessoa (edição ou Confirmar) desmarca", () => {
    const o = origemDosCampos([
      atividade({ type: "lead_edited", actor_kind: "ai", payload: { custom_field_keys: ["empreendimento", "renda"] }, performed_at: "2026-09-27T10:00:00Z" }),
      atividade({ type: "lead_edited", actor_kind: "user", payload: { custom_field_keys: ["renda"], confirmado: true }, performed_at: "2026-09-28T10:00:00Z" }),
      atividade({ type: "lead_edited", actor_kind: "ai", payload: { fields: ["value_cents"] }, performed_at: "2026-09-29T10:00:00Z" }),
    ]);
    expect(o.get("empreendimento")?.veioDaConversa).toBe(true);
    expect(o.get("renda")?.veioDaConversa).toBe(false);
    expect(o.has("value_cents")).toBe(false);
  });
});

describe("montar o cartão aberto", () => {
  const ORG = "org-1";
  const agora = new Date("2026-09-30T15:00:00Z");

  function banco() {
    return bancoEmMemoria({
      crm_leads: [
        { id: "L1", organization_id: ORG, pipeline_id: "P", stage_id: "S2", contact_id: "C1", empresa_id: null, created_at: "2026-09-26T12:00:00Z", closed_at: null, source: "meta_ads", source_metadata: { ad_platform: "meta_ads", ad_source_id: "clk", campaign_name: "Jardim das Flores" }, external_id: null, tags: [], description: null, status: "open", title: "Apto 2 dorm", updated_at: "2026-09-30T00:00:00Z" },
        { id: "L0", organization_id: ORG, pipeline_id: "P2", stage_id: "SX", contact_id: "C1", status: "lost", title: "Studio", value_cents: 100, currency: "BRL", lost_reason: "Preço", updated_at: "2025-11-01T00:00:00Z" },
        { id: "G1", organization_id: ORG, pipeline_id: "P", stage_id: "S2", contact_id: "C1", empresa_id: null, status: "won", title: "Garagem", value_cents: 3_000_000, currency: "BRL", closed_at: "2025-06-10T12:00:00Z", updated_at: "2025-06-10T12:00:00Z", custom_fields: { forma_de_pagamento: "À vista" } },
      ],
      crm_stages: [
        { id: "S1", organization_id: ORG, pipeline_id: "P", name: "Novo lead", position: 1, is_won: false, is_lost: false, is_archived: false },
        { id: "S2", organization_id: ORG, pipeline_id: "P", name: "Visita agendada", position: 2, is_won: false, is_lost: false, is_archived: false },
        { id: "SX", organization_id: ORG, pipeline_id: "P2", name: "Proposta", position: 1, is_won: false, is_lost: false, is_archived: false },
      ],
      crm_lead_activities: [
        { organization_id: ORG, lead_id: "L1", type: "stage_changed", performed_at: "2026-09-27T12:00:00Z", payload: { from_stage_id: "S1", to_stage_id: "S2" } },
      ],
      lead_state: [{ organization_id: ORG, contact_id: "C1", stage: "qualified", qualification: { need: "2 dorm" }, updated_at: "2026-09-30T10:00:00Z" }],
      lead_checkpoints: [
        { organization_id: ORG, contact_id: "C1", seq: 2, objections: ["parcela"], commitments: [], declaracao: null, rolling_summary: "Quer visitar.", created_at: "2026-09-30T11:00:00Z" },
        { organization_id: ORG, contact_id: "C1", seq: 1, objections: ["metrô"], commitments: [], declaracao: null, rolling_summary: "", created_at: "2026-09-29T11:00:00Z" },
      ],
      contacts: [
        { id: "C1", organization_id: ORG, name: "Mariana Costa", display_name: null, phone_number: "+5511955550142", source: "meta_ads", source_metadata: { ad_source_id: "clk", ad_platform: "meta_ads" }, cargo: null, empresa_id: "E1", is_anonymized: false, created_at: "2026-09-26T12:00:00Z" },
        { id: "C2", organization_id: ORG, name: "Diego Costa", display_name: null, phone_number: "+5511955550187", cargo: null, is_anonymized: false },
      ],
      crm_lead_links: [{ organization_id: ORG, lead_id: "L1", target_kind: "contact", target_id: "C2", metadata: { papel: "decisor" } }],
      conversations: [{ id: "CV2", organization_id: ORG, contact_id: "C2", last_message_at: "2026-09-29T00:00:00Z" }],
      messages: [
        { organization_id: ORG, contact_id: "C1", direction: "inbound", body: "Oi! Vi o vídeo [ref:ABC234]", sent_at: "2026-09-26T20:14:00Z" },
      ],
      calendar_appointments: [
        { id: "A1", organization_id: ORG, contact_id: "C1", title: "Visita", event_type_id: null, location_kind: "in_person", location_details: "Jardim das Flores", starts_at: "2026-10-03T13:00:00Z", ends_at: "2026-10-03T14:00:00Z", time_zone: "America/Sao_Paulo", status: "confirmed" },
        { id: "A2", organization_id: ORG, contact_id: "C1", title: "Do outro", event_type_id: null, location_kind: "phone", location_details: null, starts_at: "2026-10-02T13:00:00Z", ends_at: "2026-10-02T14:00:00Z", time_zone: "America/Sao_Paulo", status: "confirmed" },
      ],
      crm_empresas: [{ id: "E1", organization_id: ORG, nome: "Clínica Vida Plena", cnpj: null, telefone: null, site: null }],
      orders: [],
    });
  }

  it("junta etapas com dias, IA, pessoas, outros negócios, empresa do contato, compras, origem e agenda", async () => {
    const b = banco();
    // o compromisso A2 é de outro negócio
    b.db.crm_lead_links!.push({ organization_id: ORG, lead_id: "L9", target_kind: "appointment", target_id: "A2" });
    const admin = bancoEmMemoria({
      ad_conversion_dispatches: [
        { organization_id: ORG, lead_id: "L1", platform: "meta_ads", event_name: "QualifiedLead", status: "sent", reason: null, attempted_at: "2026-09-27T11:02:00Z", event_occurred_at: null },
        { organization_id: ORG, lead_id: "L1", platform: "google_ads", event_name: "Etapa:S2", status: "skipped", reason: "sem_conexao", attempted_at: "2026-09-27T11:02:00Z", event_occurred_at: null },
        { organization_id: "outra", lead_id: "L1", platform: "meta_ads", event_name: "Purchase", status: "sent", reason: null, attempted_at: null, event_occurred_at: null },
      ],
    });

    const c = (await montarCartaoAberto(b.cliente as never, admin.cliente as never, ORG, "L1", agora))!;
    expect(c.etapas.map((e) => [e.nome, e.dias, e.atual])).toEqual([
      ["Novo lead", 1, false],
      ["Visita agendada", 3, true],
    ]);
    expect(c.resumo?.objecoes).toEqual([
      { texto: "parcela", aberta: true },
      { texto: "metrô", aberta: false },
    ]);
    expect(c.pessoas.map((p) => [p.nome, p.principal, p.papel, p.conversaId])).toEqual([
      ["Mariana Costa", true, null, null],
      ["Diego Costa", false, "decisor", "CV2"],
    ]);
    expect(c.outrosNegocios.map((o) => [o.titulo, o.etapa])).toEqual([
      ["Studio", "Proposta"],
      ["Garagem", "Visita agendada"],
    ]);
    expect(c.empresa).toBeNull();
    expect(c.empresaDoContato).toEqual({ id: "E1", nome: "Clínica Vida Plena" });
    expect(c.compras?.quantidade).toBe(1);
    expect(c.compras?.habito.pagamento).toBe("À vista");
    expect(c.origem.canal.sigla).toBe("META");
    expect(c.origem.campanha).toBe("Jardim das Flores");
    expect(c.origem.primeiraMensagem?.texto).toBe("Oi! Vi o vídeo");
    expect(c.origem.semClique).toBe(false);
    expect(c.origem.conversoes).toEqual([
      { plataforma: "meta_ads", evento: "QualifiedLead", rotulo: "Lead qualificado", situacao: "enviada", motivo: null, quando: "2026-09-27T11:02:00Z", valorCentavos: null, moeda: null, detalhe: null },
      { plataforma: "google_ads", evento: "Etapa: Visita agendada", rotulo: "Etapa: Visita agendada", situacao: "nao_enviada", motivo: "sem_conexao", quando: "2026-09-27T11:02:00Z", valorCentavos: null, moeda: null, detalhe: null },
    ]);
    // O contato tem clique em anúncio da Meta: é o que explica a plataforma sem envio.
    expect(c.origem.origemPorPlataforma).toEqual({ meta_ads: "clique", google_ads: null });
    expect(c.agenda.map((a) => a.id)).toEqual(["A1"]);
  });

  it("negócio de outra organização não é lido", async () => {
    expect(await montarCartaoAberto(banco().cliente as never, null, "outra-org", "L1", agora)).toBeNull();
  });

  it("contato anonimizado: sem resumo da IA, sem nome e sem 1ª mensagem", async () => {
    const b = banco();
    Object.assign(b.db.contacts![0]!, { is_anonymized: true, name: "Cliente Anonimizado #1" });
    const c = (await montarCartaoAberto(b.cliente as never, null, ORG, "L1", agora))!;
    expect(c.resumo).toBeNull();
    expect(c.pessoas[0]?.nome).toBeNull();
    expect(c.origem.primeiraMensagem).toBeNull();
  });
});

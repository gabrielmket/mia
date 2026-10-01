/**
 * FORK MIA — as fichas conectadas, montadas num banco em memória: o que a ficha
 * do contato e a da empresa juntam, e de onde.
 */
import { describe, expect, it } from "vitest";

import { bancoEmMemoria } from "../../tests/helpers/banco-em-memoria";
import { montarFichaDaEmpresa, montarFichaDoContato } from "./fichas-servidor";

const ORG = "org-1";
const agora = new Date("2026-09-30T15:00:00Z");

function banco() {
  return bancoEmMemoria({
    contacts: [
      { id: "carla", organization_id: ORG, name: "Carla Mendes", display_name: null, phone_number: "+5511955550110", email: null, empresa_id: "vida", cargo: "Sócia", papel_na_empresa: "decisor", principal_na_empresa: true, is_anonymized: false, last_activity_at: "2026-09-30T09:12:00Z" },
      { id: "ricardo", organization_id: ORG, name: "Ricardo Alves", display_name: null, phone_number: null, email: null, empresa_id: "vida", cargo: "Financeiro", papel_na_empresa: "financeiro", principal_na_empresa: false, is_anonymized: false, last_activity_at: "2026-09-28T10:00:00Z" },
      { id: "outra", organization_id: "OUTRA", name: "De fora", display_name: null, empresa_id: "vida", is_anonymized: false },
    ],
    crm_empresas: [{ id: "vida", organization_id: ORG, nome: "Clínica Vida Plena", cnpj: "12345678000190" }],
    crm_leads: [
      { id: "sala", organization_id: ORG, contact_id: "carla", empresa_id: "vida", title: "Sala 42 m²", status: "open", stage_id: "S", pipeline_id: "P", value_cents: 22_320_000, currency: "BRL", owner_user_id: "u", owner_kind: "user", lost_reason: null, updated_at: "2026-09-29" },
      { id: "moema", organization_id: ORG, contact_id: "carla", empresa_id: "vida", title: "Sala Moema", status: "won", stage_id: "S", pipeline_id: "P", value_cents: 42_000_000, currency: "BRL", owner_user_id: null, owner_kind: null, lost_reason: null, closed_at: "2023-03-15T12:00:00Z", updated_at: "2023-03-15" },
      { id: "aurora", organization_id: ORG, contact_id: "ricardo", empresa_id: null, title: "Sala Aurora", status: "won", stage_id: "S", pipeline_id: "P", value_cents: 45_000_000, currency: "BRL", owner_user_id: null, owner_kind: null, lost_reason: null, closed_at: "2024-08-22T12:00:00Z", updated_at: "2024-08-22" },
      { id: "outro-neg", organization_id: ORG, contact_id: "joao", empresa_id: null, title: "Negócio do João", status: "open", stage_id: "S", pipeline_id: "P", value_cents: null, currency: "BRL", owner_user_id: null, owner_kind: null, lost_reason: null, updated_at: "2026-09-01" },
    ],
    crm_lead_links: [{ organization_id: ORG, lead_id: "outro-neg", target_kind: "contact", target_id: "ricardo", metadata: { papel: "financeiro" } }],
    crm_stages: [{ id: "S", organization_id: ORG, name: "Proposta" }],
    crm_pipelines: [{ id: "P", organization_id: ORG, name: "Locação" }],
    crm_lead_scores: [{ organization_id: ORG, lead_id: "sala", ai_probability: "65" }],
    conversations: [{ id: "cv-carla", organization_id: ORG, contact_id: "carla", last_message_preview: "Recebi a proposta", last_message_at: "2026-09-29T18:02:00Z", unread_count_for_assignee: 1, status: "open" }],
    lead_state: [{ organization_id: ORG, contact_id: "carla", stage: "negotiating", qualification: { need: "Sala para clínica" }, updated_at: "2026-09-29T00:00:00Z" }],
    lead_checkpoints: [{ organization_id: ORG, contact_id: "carla", seq: 1, objections: ["carência"], commitments: [], declaracao: null, rolling_summary: "", created_at: "2026-09-29T00:00:00Z" }],
    lead_notes: [{ id: "n1", organization_id: ORG, contact_id: "carla", headline: "Prefere Teams depois das 18h", body: "…", created_at: "2026-09-20T00:00:00Z" }],
    calendar_appointments: [],
    calendar_event_types: [],
    orders: [],
  });
}

describe("ficha do contato", () => {
  it("empresa com cargo, papel e principal; negócios dele; resumo, memória, conversa; compras dele e a soma da empresa", async () => {
    const f = (await montarFichaDoContato(banco().cliente as never, ORG, "carla", agora))!;
    expect(f.empresa).toEqual({ id: "vida", nome: "Clínica Vida Plena", cnpj: "12345678000190", cargo: "Sócia", papel: "decisor", principal: true });
    expect(f.negocios.map((n) => [n.titulo, n.status, n.etapa, n.funil, n.probabilidade])).toEqual([
      ["Sala 42 m²", "open", "Proposta", "Locação", 65],
      ["Sala Moema", "won", "Proposta", "Locação", null],
    ]);
    expect(f.estagio).toBe("negotiating");
    expect(f.resumo?.quer).toBe("Sala para clínica");
    expect(f.memoria.map((m) => m.titulo)).toEqual(["Prefere Teams depois das 18h"]);
    expect(f.conversas[0]).toMatchObject({ id: "cv-carla", naoLidas: 1 });
    expect(f.compras?.quantidade).toBe(1);
    // A empresa soma Carla (Moema) + Ricardo (Aurora).
    expect(f.comprasDaEmpresa).toEqual({ quantidade: 2, totalCents: 87_000_000, moeda: "BRL" });
  });

  it("os negócios em que a pessoa está ENVOLVIDA aparecem, com o papel", async () => {
    const f = (await montarFichaDoContato(banco().cliente as never, ORG, "ricardo", agora))!;
    const envolvido = f.negocios.find((n) => n.id === "outro-neg");
    expect(envolvido?.envolvidoComo).toBe("financeiro");
    expect(f.negocios.find((n) => n.id === "aurora")?.envolvidoComo).toBeNull();
  });

  it("contato de outra organização: nada", async () => {
    expect(await montarFichaDoContato(banco().cliente as never, ORG, "outra", agora)).toBeNull();
  });
});

describe("ficha da empresa", () => {
  it("pessoas com papel (a principal primeiro), negócios sem repetir, números e compras de todos", async () => {
    const f = await montarFichaDaEmpresa(banco().cliente as never, ORG, "vida", agora);
    expect(f.pessoas.map((p) => [p.nome, p.papel, p.principal, p.conversaId])).toEqual([
      ["Carla Mendes", "decisor", true, "cv-carla"],
      ["Ricardo Alves", "financeiro", false, null],
    ]);
    expect(f.negocios.map((n) => n.id).sort()).toEqual(["aurora", "moema", "sala"]);
    expect(f.numeros).toEqual({
      abertos: 1,
      abertosCents: 22_320_000,
      moeda: "BRL",
      ultimaInteracao: "2026-09-30T09:12:00Z",
      maisQuente: 65,
    });
    expect(f.compras?.quantidade).toBe(2);
    expect(f.compras?.compras.map((c) => c.contatoNome)).toEqual(["Ricardo Alves", "Carla Mendes"]);
  });
});

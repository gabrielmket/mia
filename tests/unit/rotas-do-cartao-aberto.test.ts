import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — as rotas do cartão aberto: nota interna, pessoas envolvidas no
 * negócio e "Confirmar" o campo que veio da conversa. E a leitura do cartão.
 *
 * Cada caso nomeia a garantia: papel mínimo (viewer não escreve), organização
 * vinda do cookie (negócio e contato de outra empresa não passam), validação do
 * corpo, efeito gravado com o ATOR, linha do tempo e auditoria.
 */
const estado = vi.hoisted(() => ({ papel: "agent" as "viewer" | "agent" }));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => false }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (min: string) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as Record<string, number>;
    if (ordem[estado.papel]! < ordem[min]!) {
      const { fail } = await import("@/lib/api/wrappers");
      return { ok: false, response: fail("forbidden_role", "papel", 403, {}) };
    }
    return {
      ok: true,
      user: { id: "U1", idioma: "pt-BR" },
      org: { orgId: "ORG", name: "Org", role: estado.papel },
    };
  }),
}));

import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createClient } from "@/lib/supabase/server";
import { bancoEmMemoria } from "../helpers/banco-em-memoria";
import { POST as postNota } from "@/app/api/v1/leads/[id]/notas/route";
import { DELETE as retirar, POST as incluir } from "@/app/api/v1/leads/[id]/envolvidos/route";
import { POST as confirmar } from "@/app/api/v1/leads/[id]/campos-confirmados/route";
import { GET as lerCartao } from "@/app/api/v1/leads/[id]/cartao/route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";
const DE_FORA = "44444444-4444-4444-8444-444444444444";

let banco: ReturnType<typeof bancoEmMemoria>;

function req(url: string, metodo: string, corpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo), headers: { "content-type": "application/json" } } : {}),
  });
}
const ctx = (id = LEAD) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  estado.papel = "agent";
  banco = bancoEmMemoria({
    crm_leads: [
      { id: LEAD, organization_id: "ORG", contact_id: CONTATO, custom_fields: { empreendimento: "Jardim" } },
      { id: DE_FORA, organization_id: "OUTRA", contact_id: null, custom_fields: {} },
    ],
    contacts: [
      { id: CONTATO, organization_id: "ORG", is_anonymized: false },
      { id: OUTRO, organization_id: "ORG", is_anonymized: false },
      { id: DE_FORA, organization_id: "OUTRA", is_anonymized: false },
    ],
    crm_lead_links: [],
  });
  vi.mocked(createClient).mockResolvedValue(banco.cliente as never);
});

describe("nota interna", () => {
  it("grava a nota na linha do tempo com o texto no payload (nunca no reason), fixada, e audita", async () => {
    const r = await postNota(req(`/api/v1/leads/${LEAD}/notas`, "POST", { texto: "  só aos sábados ", fixada: true }), ctx());
    expect(r.status).toBe(201);
    expect(emitLeadActivity).toHaveBeenCalledWith(
      banco.cliente,
      expect.objectContaining({
        type: "note",
        leadId: LEAD,
        actor: { type: "user", id: "U1" },
        reason: "Nota interna fixada",
        payload: { texto: "só aos sábados", fixada: true },
      }),
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lead.nota_adicionada" }));
  });

  it("recusa nota vazia, negócio de outra empresa e quem só vê", async () => {
    expect((await postNota(req(`/api/v1/leads/${LEAD}/notas`, "POST", { texto: " " }), ctx())).status).toBe(422);
    expect((await postNota(req(`/api/v1/leads/${DE_FORA}/notas`, "POST", { texto: "x" }), ctx(DE_FORA))).status).toBe(404);
    estado.papel = "viewer";
    expect((await postNota(req(`/api/v1/leads/${LEAD}/notas`, "POST", { texto: "x" }), ctx())).status).toBe(403);
    expect(emitLeadActivity).not.toHaveBeenCalled();
  });
});

describe("pessoas envolvidas", () => {
  it("inclui com o papel; incluir de novo troca o papel sem duplicar; retirar apaga", async () => {
    const r1 = await incluir(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: OUTRO, papel: "financeiro" }), ctx());
    expect(r1.status).toBe(201);
    expect(banco.db.crm_lead_links).toEqual([
      expect.objectContaining({ lead_id: LEAD, target_kind: "contact", target_id: OUTRO, link_kind: "envolvido", metadata: { papel: "financeiro" } }),
    ]);
    await incluir(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: OUTRO, papel: "decisor" }), ctx());
    expect(banco.db.crm_lead_links).toHaveLength(1);
    expect(banco.db.crm_lead_links![0]!.metadata).toEqual({ papel: "decisor" });
    expect(emitLeadActivity).toHaveBeenCalledWith(banco.cliente, expect.objectContaining({ type: "lead_edited", reason: "Incluiu uma pessoa no negócio" }));

    const r2 = await retirar(req(`/api/v1/leads/${LEAD}/envolvidos?contact_id=${OUTRO}`, "DELETE"), ctx());
    expect(r2.status).toBe(200);
    expect(banco.db.crm_lead_links).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lead.contato_envolvido_retirado" }));
  });

  it("recusa contato de outra empresa, o próprio contato principal e papel fora do vocabulário", async () => {
    expect((await incluir(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: DE_FORA }), ctx())).status).toBe(404);
    expect((await incluir(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: CONTATO }), ctx())).status).toBe(422);
    expect((await incluir(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: OUTRO, papel: "chefe" }), ctx())).status).toBe(422);
    expect(banco.db.crm_lead_links).toHaveLength(0);
  });

  it("retirar quem não está no negócio é 404, não sucesso silencioso", async () => {
    expect((await retirar(req(`/api/v1/leads/${LEAD}/envolvidos?contact_id=${OUTRO}`, "DELETE"), ctx())).status).toBe(404);
  });
});

describe("confirmar o campo que veio da conversa", () => {
  it("grava a palavra humana sobre a chave (lead_edited, confirmado) e audita", async () => {
    const r = await confirmar(req(`/api/v1/leads/${LEAD}/campos-confirmados`, "POST", { chave: "empreendimento" }), ctx());
    expect(r.status).toBe(200);
    expect(emitLeadActivity).toHaveBeenCalledWith(
      banco.cliente,
      expect.objectContaining({
        type: "lead_edited",
        actor: { type: "user", id: "U1" },
        payload: { fields: ["custom_fields"], custom_field_keys: ["empreendimento"], confirmado: true },
      }),
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lead.campo_confirmado" }));
  });

  it("campo sem valor não se confirma", async () => {
    expect((await confirmar(req(`/api/v1/leads/${LEAD}/campos-confirmados`, "POST", { chave: "renda" }), ctx())).status).toBe(422);
  });
});

describe("leitura do cartão", () => {
  it("negócio de outra empresa é 404; viewer lê", async () => {
    estado.papel = "viewer";
    expect((await lerCartao(req(`/api/v1/leads/${DE_FORA}/cartao`, "GET"), ctx(DE_FORA))).status).toBe(404);
  });
});

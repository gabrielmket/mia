/**
 * FORK MIA (.81) — a ação `send_email` do upstream (v1.81, #2726) numa empresa
 * de DEMONSTRAÇÃO não manda e-mail.
 *
 * A trava do e-mail mora no roteador (`lib/email/roteador.ts`) e só age quando
 * recebe a organização. A ação nova chamava `sendEmail` sem ela: numa
 * demonstração, uma regra com destinatário FIXO ou o responsável do negócio
 * mandaria e-mail de verdade. Aqui o roteador é o de verdade (só os dois
 * transportes e a pergunta ao banco são dublês), e a prova é que nenhum
 * transporte é chamado.
 *
 * Controle: a mesma regra numa empresa de verdade sai pelo transporte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcDoAdmin = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: (...args: unknown[]) => rpcDoAdmin(...args) }),
}));

const enviarPorSmtp = vi.fn(async () => ({ ok: true, id: "smtp-1" }));
const enviarPelaResend = vi.fn(async () => ({ ok: true, id: "resend-1" }));
vi.mock("@/lib/email/config", () => ({ getSmtpConfig: async () => ({ host: "smtp.invalid" }) }));
vi.mock("@/lib/email/smtp", () => ({
  isSmtpConfigured: () => true,
  sendEmail: (...a: unknown[]) => enviarPorSmtp(...(a as [])),
}));
vi.mock("@/lib/email/resend", () => ({
  isEmailConfigured: async () => true,
  sendEmail: (...a: unknown[]) => enviarPelaResend(...(a as [])),
}));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/send-email";
import type { ActionCtx } from "@/lib/automation/types";

const ORG = "90109010-0000-4000-8000-00000000081e";

function ctx(): ActionCtx {
  return {
    // Desde a v1.88 (#3287) a ação lê `organizations.settings` (o remetente da
    // organização) antes de chamar o roteador: a empresa sem remetente próprio.
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: {} }, error: null }) }) }),
      }),
    } as unknown as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "regra-1",
    ruleName: "Aviso por e-mail",
    requestId: "evt-1",
    event: {
      id: "evt-1",
      organization_id: ORG,
      event_type: "lead.stage_changed",
      entity_kind: "crm_lead",
      entity_id: "lead-1",
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context: {
      lead: { id: "lead-1", title: "Negócio de exemplo" },
      contact: { id: "contato-1", name: "Pessoa de Exemplo", email: "pessoa@exemplo.invalid", is_blocked: false },
    },
  } as ActionCtx;
}

const CONFIG = {
  destinatario: "fixo",
  email_fixo: "time@exemplo.invalid",
  assunto: "Negócio andou",
  corpo: "O negócio {{lead.title}} mudou de etapa.",
  formato: "texto",
};

beforeEach(() => {
  rpcDoAdmin.mockReset();
  enviarPorSmtp.mockClear();
  enviarPelaResend.mockClear();
});

describe("send_email na empresa de demonstração", () => {
  it("não chega a nenhum transporte e sai como recusa de configuração", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });

    const r = await getAction("send_email")!.execute(ctx(), CONFIG);

    expect(rpcDoAdmin, "a ação não passou a organização ao roteador").toHaveBeenCalledWith(
      "fn_mia_e_demonstracao",
      { p_org: ORG },
    );
    expect(enviarPorSmtp, "o e-mail saiu da demonstração pelo SMTP").not.toHaveBeenCalled();
    expect(enviarPelaResend, "o e-mail saiu da demonstração pela Resend").not.toHaveBeenCalled();
    expect(r.status).toBe("skipped");
    expect(r.detail).toMatchObject({ reason: "organizacao_de_demonstracao" });
  });

  it("sem confirmar que a empresa é de verdade, também não sai (falha fechada)", async () => {
    rpcDoAdmin.mockResolvedValue({ data: null, error: { message: "banco fora" } });

    const r = await getAction("send_email")!.execute(ctx(), CONFIG);

    expect(enviarPorSmtp).not.toHaveBeenCalled();
    expect(enviarPelaResend).not.toHaveBeenCalled();
    expect(r.status).toBe("skipped");
  });

  it("CONTROLE: numa empresa de verdade a mesma regra sai pelo transporte", async () => {
    rpcDoAdmin.mockResolvedValue({ data: false, error: null });

    const r = await getAction("send_email")!.execute(ctx(), CONFIG);

    expect(enviarPorSmtp).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("success");
  });
});

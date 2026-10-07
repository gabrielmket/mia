/**
 * FORK MIA (cliente modelo, 9010) — o lado do CÓDIGO da trava da demonstração.
 *
 * Quem trava é o banco (tests/invariants/empresa-de-demonstracao-nao-envia).
 * Aqui se prova o que o código faz com isso:
 *
 *  1. a porta de saída de mensagens (`sendMessageHandler`) traduz a recusa do
 *     banco em 403 `organizacao_de_demonstracao` — e o canal NUNCA é chamado;
 *  2. o roteador de e-mail pergunta à empresa e, se for demonstração (ou se não
 *     der para confirmar), o e-mail não chega a nenhum transporte; a única
 *     exceção é o convite de equipe, pedida pelo nome (9020);
 *  3. o selo lê a marca sem nunca derrubar o layout;
 *  4. o corte das métricas monta o filtro certo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { deriveActor } from "@/lib/mcp/auth";
import type { SendMessageInput } from "@/lib/schemas";
import {
  CODIGO_DA_DEMONSTRACAO,
  ehRecusaDaDemonstracao,
  travaDaDemonstracao,
} from "@/lib/demonstracao/trava";
import { empresaEDemonstracao } from "@/lib/demonstracao/selo";
import {
  excluirDemonstracao,
  idsDasEmpresasDeDemonstracao,
  listaParaExcluir,
  SEM_DEMONSTRACAO,
} from "@/lib/demonstracao/fora-das-metricas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const rpcDoAdmin = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => rpcDoAdmin(...args),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.invalid/a.jpg" }, error: null }),
      }),
    },
  }),
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

const ORG = "90109010-0000-4000-8000-00000000000d";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const RECUSA_DO_BANCO = {
  code: "42501",
  message: "organizacao_de_demonstracao: mensagem de saida nao existe numa empresa de demonstracao",
};

beforeEach(() => {
  rpcDoAdmin.mockReset();
  enviarPorSmtp.mockClear();
  enviarPelaResend.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a recusa do banco é reconhecida pelo que ela é", () => {
  it("42501 com a mensagem da trava é a demonstração", () => {
    expect(ehRecusaDaDemonstracao(RECUSA_DO_BANCO)).toBe(true);
  });

  it("outro 42501 (RLS, trava de IA, Página da Meta) NÃO é", () => {
    expect(ehRecusaDaDemonstracao({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      false,
    );
    expect(ehRecusaDaDemonstracao({ code: "42501", message: "ia_da_plataforma: ..." })).toBe(false);
  });

  it("a mesma mensagem com outro código, ou nenhum erro, NÃO é", () => {
    expect(ehRecusaDaDemonstracao({ code: "23505", message: RECUSA_DO_BANCO.message })).toBe(false);
    expect(ehRecusaDaDemonstracao(null)).toBe(false);
    expect(ehRecusaDaDemonstracao(undefined)).toBe(false);
  });
});

describe("a porta de saída de mensagens: a demonstração recebe 403 e o canal não é chamado", () => {
  function conversa() {
    return {
      id: CONV,
      organization_id: ORG,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      is_group: false,
      group_chat_id: null,
      bot_silenced_until: null,
      provider_conversation_id: null,
      last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(),
      contacts: { phone_number: "+5500900000021", wa_identity: null, wa_lid: null, is_blocked: false },
      channel_sessions: {
        id: SESSION,
        organization_id: ORG,
        provider: "meta_cloud",
        waha_session_name: null,
        status: "WORKING",
        archived_at: null,
      },
    };
  }

  /** O dublê do handler, com o INSERT em `messages` recusado como o banco recusa. */
  function supabaseQueRecusaAFila() {
    const { supabase } = criarDubleDoHandler({ conversation: conversa() });
    const original = supabase.from.bind(supabase);
    const recusando = {
      ...supabase,
      from: (tabela: string) => {
        const alvo = original(tabela) as unknown as Record<string, unknown>;
        if (tabela !== "messages") return alvo;
        return {
          ...alvo,
          insert: () => ({
            select: () => ({ single: async () => ({ data: null, error: RECUSA_DO_BANCO }) }),
          }),
        };
      },
    };
    return recusando as unknown as typeof supabase;
  }

  const ctx: HandlerCtx = {
    organization_id: ORG,
    actor: deriveActor(["mcp:write"], "77777777-7777-4777-8777-777777777777"),
    requestId: "req-9010",
  };

  it("⭐ 403 `organizacao_de_demonstracao`, com a frase, e nenhuma chamada ao canal", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "1103328999528818");
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "tok");
    const canal = vi.fn();
    vi.stubGlobal("fetch", canal);

    const erro = await sendMessageHandler(supabaseQueRecusaAFila(), ctx, {
      conversation_id: CONV,
      type: "text",
      body: "oi",
    } as SendMessageInput).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(403);
    expect((erro as ApiError).code).toBe(CODIGO_DA_DEMONSTRACAO);
    expect((erro as ApiError).message).toContain("demonstração");
    expect(canal, "o canal foi chamado para uma empresa de demonstração").not.toHaveBeenCalled();
  });
});

describe("a pergunta que o roteador de e-mail faz", () => {
  it("demonstração: travado", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    expect(await travaDaDemonstracao({ rpc: rpcDoAdmin } as never, ORG)).toEqual({
      travado: true,
      motivo: "demonstracao",
    });
    expect(rpcDoAdmin).toHaveBeenCalledWith("fn_mia_e_demonstracao", { p_org: ORG });
  });

  it("empresa de verdade: livre", async () => {
    rpcDoAdmin.mockResolvedValue({ data: false, error: null });
    expect(await travaDaDemonstracao({ rpc: rpcDoAdmin } as never, ORG)).toEqual({ travado: false });
  });

  it("⭐ falha fechada: erro, resposta estranha ou exceção travam", async () => {
    rpcDoAdmin.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    rpcDoAdmin.mockResolvedValueOnce({ data: "sim", error: null });
    rpcDoAdmin.mockRejectedValueOnce(new Error("rede"));
    for (let i = 0; i < 3; i += 1) {
      expect(await travaDaDemonstracao({ rpc: rpcDoAdmin } as never, ORG)).toEqual({
        travado: true,
        motivo: "nao_confirmado",
      });
    }
  });

  it("a sentinela da plataforma não é empresa e não pergunta nada", async () => {
    expect(await travaDaDemonstracao({ rpc: rpcDoAdmin } as never, "plataforma")).toEqual({ travado: false });
    expect(rpcDoAdmin).not.toHaveBeenCalled();
  });
});

describe("o roteador de e-mail", () => {
  const email = { to: "titular@exemplo.invalid", subject: "LGPD", html: "<p>oi</p>" };

  it("⭐ e-mail da demonstração não chega a transporte nenhum", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao" });
    expect(enviarPorSmtp).not.toHaveBeenCalled();
    expect(enviarPelaResend).not.toHaveBeenCalled();
  });

  it("⭐ sem confirmar a empresa, também não sai (falha fechada)", async () => {
    rpcDoAdmin.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao", details: "nao_confirmado" });
    expect(enviarPorSmtp).not.toHaveBeenCalled();
  });

  it("controle: empresa de verdade envia, e a organização não vaza para o transporte", async () => {
    rpcDoAdmin.mockResolvedValue({ data: false, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG });

    expect(r).toMatchObject({ ok: true, via: "smtp" });
    expect(enviarPorSmtp).toHaveBeenCalledTimes(1);
    expect(enviarPorSmtp.mock.calls[0]).toEqual([email]);
  });

  it("controle: e-mail sem empresa (da instalação) não pergunta nada e sai", async () => {
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail(email);

    expect(r.ok).toBe(true);
    expect(rpcDoAdmin).not.toHaveBeenCalled();
  });
});

/**
 * FORK MIA (9020) — a ÚNICA exceção: o convite de equipe.
 *
 * Convite não fala com contato: fala com uma pessoa de verdade que quem
 * administra a empresa escolheu, e é o jeito de dar acesso à demonstração. A
 * exceção é pedida pelo chamador, pelo nome; o roteador não deduz nada. As duas
 * pontas são medidas aqui: o convite sai, e tudo que NÃO pede a exceção, mesmo
 * com cara de convite, segue recusado. Quem pode pedir (só `issueInvite`) é
 * medido em `tests/unit/convite-de-equipe-na-demonstracao.test.ts`.
 */
describe("o roteador de e-mail: a exceção nomeada do convite de equipe (9020)", () => {
  const email = { to: "convidada@exemplo.invalid", subject: "Convite", html: "<p>entre</p>" };

  it("⭐ com a exceção, o e-mail da demonstração SAI, e os campos do fork não chegam ao transporte", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG, excecaoDaTravaDaDemonstracao: "convite_de_equipe" });

    expect(r).toMatchObject({ ok: true, via: "smtp" });
    expect(enviarPorSmtp).toHaveBeenCalledTimes(1);
    expect(enviarPorSmtp.mock.calls[0]).toEqual([email]);
  });

  it("⭐ CONTROLE: o MESMO e-mail, da MESMA empresa, sem a exceção, não sai", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao", details: "demonstracao" });
    expect(enviarPorSmtp).not.toHaveBeenCalled();
    expect(enviarPelaResend).not.toHaveBeenCalled();
  });

  it("⭐ nada é deduzido: e-mail com etiqueta e assunto de convite, sem a exceção, segue recusado", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({
      to: "convidada@exemplo.invalid",
      subject: "Você foi convidada para a equipe",
      html: "<p>convite de equipe</p>",
      tags: [
        { name: "kind", value: "team_invite" },
        { name: "org", value: ORG },
      ],
      organizationId: ORG,
    });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao" });
    expect(enviarPorSmtp).not.toHaveBeenCalled();
  });

  it("⭐ um valor que não é a exceção nomeada não abre nada", async () => {
    rpcDoAdmin.mockResolvedValue({ data: true, error: null });
    const { sendEmail } = await import("@/lib/email/roteador");

    for (const valor of [true, "convite", "qualquer_coisa", ""]) {
      const r = await sendEmail({ ...email, organizationId: ORG, excecaoDaTravaDaDemonstracao: valor as never });
      expect(r, `valor ${JSON.stringify(valor)}`).toMatchObject({ ok: false, error: "organizacao_de_demonstracao" });
    }
    expect(enviarPorSmtp).not.toHaveBeenCalled();
  });

  it("o convite sai de qualquer empresa, então o roteador nem pergunta: leitura fora do ar não o segura", async () => {
    rpcDoAdmin.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG, excecaoDaTravaDaDemonstracao: "convite_de_equipe" });

    expect(r.ok).toBe(true);
    expect(rpcDoAdmin).not.toHaveBeenCalled();
  });

  it("CONTROLE: a mesma leitura fora do ar segura qualquer outro e-mail (a falha fechada não mudou)", async () => {
    rpcDoAdmin.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    const { sendEmail } = await import("@/lib/email/roteador");

    const r = await sendEmail({ ...email, organizationId: ORG });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao", details: "nao_confirmado" });
    expect(enviarPorSmtp).not.toHaveBeenCalled();
  });
});

describe("o selo nunca derruba o layout", () => {
  function admin(resposta: unknown, lanca = false) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (lanca) throw new Error("rede");
              return resposta;
            },
          }),
        }),
      }),
    };
  }

  it("liga só com `demonstracao: true`", async () => {
    expect(await empresaEDemonstracao(admin({ data: { demonstracao: true }, error: null }) as never, ORG)).toBe(true);
    expect(await empresaEDemonstracao(admin({ data: { demonstracao: false }, error: null }) as never, ORG)).toBe(
      false,
    );
  });

  it("erro, linha ausente ou exceção: sem selo, sem quebrar", async () => {
    expect(await empresaEDemonstracao(admin({ data: null, error: { message: "x" } }) as never, ORG)).toBe(false);
    expect(await empresaEDemonstracao(admin({ data: null, error: null }) as never, ORG)).toBe(false);
    expect(await empresaEDemonstracao(admin(null, true) as never, ORG)).toBe(false);
  });
});

describe("o corte das métricas da plataforma", () => {
  it("`SEM_DEMONSTRACAO` é o `not is true` da coluna", () => {
    expect([...SEM_DEMONSTRACAO]).toEqual(["demonstracao", "is", true]);
  });

  it("a lista do `in` do PostgREST, e nada quando não há o que excluir", () => {
    expect(listaParaExcluir([])).toBeNull();
    expect(listaParaExcluir(["a", "b"])).toBe("(a,b)");
  });

  it("aplica o `not in` só quando há empresa de demonstração", () => {
    interface Consulta {
      not: (coluna: string, operador: string, valor: unknown) => Consulta;
    }
    const not = vi.fn((): Consulta => consulta);
    const consulta: Consulta = { not };
    excluirDemonstracao(consulta, []);
    expect(not).not.toHaveBeenCalled();
    excluirDemonstracao(consulta, ["d1"]);
    expect(not).toHaveBeenCalledWith("organization_id", "in", "(d1)");
  });

  it("⭐ não conseguir ler quem é demonstração LANÇA (relatório não sai como se tivesse excluído)", async () => {
    const admin = {
      from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "fora do ar" } }) }) }),
    };
    await expect(idsDasEmpresasDeDemonstracao(admin as never)).rejects.toThrow(/empresas_de_demonstracao/);
  });
});

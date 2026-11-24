/**
 * FORK MIA · CLIENTE MODELO — a recusa de ligação recebida (WAHA `call.received`)
 * passa pela trava da empresa de demonstração (R1 do docs/fork/CATALOGO.md).
 *
 * Recusar a ligação chega a uma pessoa de verdade e não passa por `messages`
 * nem por estado que o banco barre, então quem barra é o próprio handler
 * (`handleCallReceived`, em `lib/waha/ingest.ts`), perguntando
 * `fn_mia_e_demonstracao` só quando a chave "Bloquear chamadas recebidas" está
 * ligada. A trava falha fechada: se não der para confirmar que a empresa é de
 * verdade, a ligação toca.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rejectCall = vi.fn();
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({ rejectCall }),
}));

import { dispatchWahaEvent } from "@/lib/waha/ingest";

type Admin = Parameters<typeof dispatchWahaEvent>[0];

/** A Academia Alfa, fictícia, com a chave de bloqueio ligada. */
const ORG = "org-academia-alfa";
const CONTATO = "5531900000002@c.us";

type RespostaDoRpc = { data: unknown; error: { message: string } | null } | "lanca";

/**
 * Um admin que só sabe ler `organizations.settings` (a chave ligada) e
 * responder `rpc("fn_mia_e_demonstracao")`. Guarda quem perguntou a trava.
 */
function adminCom(resposta: RespostaDoRpc) {
  const rpc = vi.fn(async (nome: string, args: Record<string, unknown>) => {
    void nome;
    void args;
    if (resposta === "lanca") throw new Error("rede fora");
    return resposta;
  });
  const admin = {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { settings: { calls: { block_incoming: true } } },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as Admin;
  return { admin, rpc };
}

const SESSAO = {
  id: "cs-academia-alfa",
  organization_id: ORG,
  waha_session_name: "sessao-academia-alfa",
  is_warmup_complete: true,
  warmup_started_at: null,
};

const LIGACAO = {
  event: "call.received",
  session: "sessao-academia-alfa",
  payload: { id: "call-1", from: CONTATO, isVideo: false, isGroup: false },
};

describe("recusa de ligação recebida na empresa de demonstração", () => {
  beforeEach(() => {
    rejectCall.mockReset();
    rejectCall.mockResolvedValue(undefined);
  });

  it("empresa de demonstração com a chave ligada: a ligação não é recusada", async () => {
    const { admin, rpc } = adminCom({ data: true, error: null });
    await dispatchWahaEvent(admin, SESSAO, LIGACAO, "r1");
    expect(rpc).toHaveBeenCalledWith("fn_mia_e_demonstracao", { p_org: ORG });
    expect(rejectCall).not.toHaveBeenCalled();
  });

  it("a consulta da trava deu erro: falha fechada, a ligação não é recusada", async () => {
    const { admin } = adminCom({ data: null, error: { message: "função ausente" } });
    await expect(dispatchWahaEvent(admin, SESSAO, LIGACAO, "r1")).resolves.toBeUndefined();
    expect(rejectCall).not.toHaveBeenCalled();
  });

  it("a consulta da trava lançou: falha fechada e o handler não lança", async () => {
    const { admin } = adminCom("lanca");
    await expect(dispatchWahaEvent(admin, SESSAO, LIGACAO, "r1")).resolves.toBeUndefined();
    expect(rejectCall).not.toHaveBeenCalled();
  });

  it("empresa de verdade com a chave ligada: a ligação é recusada como antes", async () => {
    const { admin, rpc } = adminCom({ data: false, error: null });
    await dispatchWahaEvent(admin, SESSAO, LIGACAO, "r1");
    expect(rpc).toHaveBeenCalledWith("fn_mia_e_demonstracao", { p_org: ORG });
    expect(rejectCall).toHaveBeenCalledWith("sessao-academia-alfa", CONTATO, "call-1");
  });

  it("chave desligada: nem pergunta a trava (a consulta só é paga com a chave ligada)", async () => {
    const rpc = vi.fn();
    const admin = {
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { settings: {} }, error: null }) }),
        }),
      }),
    } as unknown as Admin;
    await dispatchWahaEvent(admin, SESSAO, LIGACAO, "r1");
    expect(rpc).not.toHaveBeenCalled();
    expect(rejectCall).not.toHaveBeenCalled();
  });
});

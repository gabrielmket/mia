/**
 * FORK MIA — PATCH do gatilho "Lead criado" com número escolhido: o canal tem
 * de ser da organização ATIVA (`lib/followup/numero-do-gatilho.ts`). Um id de
 * outra empresa no corpo é recusado com 422 e nada é gravado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const deps = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), audit: vi.fn(), client: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: deps.support }));
vi.mock("@/lib/audit", () => ({ audit: deps.audit }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";

import { PATCH } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "0a000000-0000-4000-8000-00000000000a";
const OUTRA_ORG = "0b000000-0000-4000-8000-00000000000b";
const NUMERO_DA_ORG = "0c000000-0000-4000-8000-00000000000c";
const NUMERO_DE_OUTRA_ORG = "0d000000-0000-4000-8000-00000000000d";

/** Qualquer canal de mensagem serve: a conferência é de organização, não de provedor. */
const PROVIDER = PROVIDERS_DE_MENSAGEM[0];

const CANAIS = [
  { id: NUMERO_DA_ORG, organization_id: ORG, archived_at: null, provider: PROVIDER },
  { id: NUMERO_DE_OUTRA_ORG, organization_id: OUTRA_ORG, archived_at: null, provider: PROVIDER },
];

/** Client que responde `channel_sessions` aplicando os filtros de verdade e registra o update. */
function client() {
  const gravado: unknown[] = [];
  function consulta(tabela: string) {
    const filtros: Array<(linha: Record<string, unknown>) => boolean> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filtros.push((l) => l[col] === v);
        return q;
      },
      is: (col: string, v: unknown) => {
        filtros.push((l) => l[col] === v);
        return q;
      },
      in: (col: string, vs: unknown[]) => {
        filtros.push((l) => vs.includes(l[col]));
        return q;
      },
      update: (valores: unknown) => {
        gravado.push(valores);
        return q;
      },
      maybeSingle: async () => {
        if (tabela === "channel_sessions") {
          return { data: CANAIS.find((l) => filtros.every((f) => f(l))) ?? null, error: null };
        }
        return { data: { id: ID }, error: null };
      },
      single: async () => ({ data: { id: ID, trigger_config: gravado.at(-1) }, error: null }),
    };
    return q;
  }
  return { gravado, supabase: { from: consulta } };
}

function patch(trigger_config: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/v1/ai/followup-flows/${ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger_config }),
    }),
    { params: Promise.resolve({ id: ID }) } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.support.mockResolvedValue(null);
  deps.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: ORG, role: "manager" } });
});

describe("PATCH do gatilho Lead criado com número", () => {
  it("⭐ número de OUTRA empresa no corpo: 422 e nada gravado", async () => {
    const c = client();
    deps.client.mockResolvedValue(c.supabase);
    const res = await patch({ kind: "lead_created", params: { channel_session_id: NUMERO_DE_OUTRA_ORG } });

    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("trigger_channel_not_found");
    expect(c.gravado, "gravou o número de outra empresa").toHaveLength(0);
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it("número que não existe: 422 e nada gravado", async () => {
    const c = client();
    deps.client.mockResolvedValue(c.supabase);
    const res = await patch({
      kind: "lead_created",
      params: { channel_session_id: "0e000000-0000-4000-8000-00000000000e" },
    });

    expect(res.status).toBe(422);
    expect(c.gravado).toHaveLength(0);
  });

  it("⭐ número da própria empresa: grava", async () => {
    const c = client();
    deps.client.mockResolvedValue(c.supabase);
    const res = await patch({ kind: "lead_created", params: { channel_session_id: NUMERO_DA_ORG } });

    expect(res.status).toBe(200);
    expect(c.gravado[0]).toMatchObject({
      trigger_config: { kind: "lead_created", params: { channel_session_id: NUMERO_DA_ORG } },
    });
  });

  it("controle: sem número (automático) grava sem consultar canal nenhum", async () => {
    const c = client();
    deps.client.mockResolvedValue(c.supabase);
    const res = await patch({ kind: "lead_created" });

    expect(res.status).toBe(200);
    expect(c.gravado[0]).toMatchObject({ trigger_config: { kind: "lead_created" } });
  });
});

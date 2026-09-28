/**
 * POST /api/v1/ai/credentials: SÓ A PLATAFORMA CRIA CHAVE DE IA (fork MIA).
 *
 * No upstream, qualquer admin do tenant cadastra a chave do provedor. Neste fork
 * a conta do provedor é paga por quem opera a plataforma e o cliente contrata
 * atendimento, não tokens (`lib/ai/custo-e-da-plataforma.ts`). A rota recusa com
 * 403 quem não é admin de plataforma — e o faz ANTES de ler o corpo, então nem a
 * validação do provedor chega a rodar.
 *
 * Este arquivo existe para que o portão não suma calado: o teste do upstream
 * (`credenciais-aceita-a-chave-do-jev.test.ts`) mede a catraca de provedores com
 * um admin de plataforma, e sem este par a remoção do portão num merge passaria
 * verde.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/v1/ai/credentials/route";
import { guardarCredencial } from "@/lib/ai/credenciais/guardar";
import { requireRole } from "@/lib/auth/require-role";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/credenciais/guardar", () => ({
  guardarCredencial: vi.fn(async () => ({ ok: true, id: "cred-1", last4: "c0de" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { id: "cred-1", provider: "openai" }, error: null }),
    };
    return { from: () => chain };
  },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const CORPO = { provider: "openai", label: "Chave", api_key: "sk-de-teste-1234567890" };

function comUsuario(user: { is_platform_admin: boolean; support: unknown }) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: { orgId: ORG, role: "admin", name: "Org" },
    user: { id: "actor", idioma: "pt-BR", ...user },
  } as Awaited<ReturnType<typeof requireRole>>);
}

function postar(corpo: unknown) {
  return POST(
    new NextRequest("http://localhost/api/v1/ai/credentials", {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/ai/credentials — portão da plataforma", () => {
  it("admin do TENANT é recusado com 403, e nada é guardado", async () => {
    comUsuario({ is_platform_admin: false, support: null });
    const res = await postar(CORPO);
    expect(res.status).toBe(403);
    expect(guardarCredencial).not.toHaveBeenCalled();
  });

  it("admin de plataforma em sessão de acompanhamento (support) também é recusado", async () => {
    comUsuario({ is_platform_admin: true, support: { organization_id: ORG } });
    const res = await postar(CORPO);
    expect(res.status).toBe(403);
    expect(guardarCredencial).not.toHaveBeenCalled();
  });

  it("admin de plataforma passa pelo portão e chega ao miolo de sempre (controle positivo)", async () => {
    comUsuario({ is_platform_admin: true, support: null });
    const res = await postar(CORPO);
    expect(res.status).toBe(201);
    expect(guardarCredencial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", orgId: ORG }),
    );
  });
});

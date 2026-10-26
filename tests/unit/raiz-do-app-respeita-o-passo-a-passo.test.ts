/**
 * FORK MIA (.91) — A RAIZ DE /app E O INÍCIO RESPEITAM O PASSO A PASSO DO UPSTREAM.
 *
 * Quem ainda não terminou o passo a passo continua indo para ele, como no
 * upstream: a raiz de `/app` só manda ao Início (`/app/inicio`) a empresa que
 * JÁ terminou o passo a passo desta versão (com o segmento) e ainda não zerou;
 * o Início devolve ao `/onboarding` quem ainda está nele. A empresa que já roda
 * (concluída sem o segmento) segue para a tela de sempre.
 *
 * Mede as duas páginas com `redirect` de mentira (o destino de cada caso); o
 * layout de `/app`, que manda o passo a passo inacabado para `/onboarding`, tem
 * o teste dele no upstream (`layout-app-suspensao-antes-do-onboarding`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  org: null as null | { onboarded_at: string | null; onboarding_state: unknown; demonstracao: boolean },
  zerou: false,
  papel: "admin" as string,
}));

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "user-1", idioma: "pt-BR", is_platform_admin: false, support: null }),
  resolveActiveOrg: async () => ({ orgId: "org-1", role: mundo.papel, interface_settings: null }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        maybeSingle: async () =>
          tabela === "organizations"
            ? { data: mundo.org, error: null }
            : { data: mundo.zerou ? { id: "retrato-1" } : null, error: null },
      };
      return q;
    },
  }),
}));
vi.mock("@/components/assistente/PrimeirosPassosComAssistente", () => ({ PrimeirosPassosComAssistente: () => null }));

import AppHome from "@/app/app/page";
import InicioPage from "@/app/app/inicio/page";

const COM_SEGMENTO = { welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "Loja QA VPS", segmento: "outro" } };
const SEM_SEGMENTO = { welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "Loja QA VPS" } };

async function destino(pagina: () => Promise<unknown>): Promise<string> {
  try {
    await pagina();
  } catch (e) {
    const m = /^redirect:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
  return "(renderizou)";
}

beforeEach(() => {
  mundo.org = null;
  mundo.zerou = false;
  mundo.papel = "admin";
});

describe("a raiz de /app", () => {
  it("o dono recém-cadastrado, ainda no passo a passo, NÃO vai ao Início (segue para o passo a passo)", async () => {
    mundo.org = { onboarded_at: null, onboarding_state: {}, demonstracao: false };
    expect(await destino(AppHome)).not.toBe("/app/inicio");
    // mesmo com o "Seu negócio" já feito (o segmento gravado), o passo a passo vem antes
    mundo.org = { onboarded_at: null, onboarding_state: COM_SEGMENTO, demonstracao: false };
    expect(await destino(AppHome)).not.toBe("/app/inicio");
  });

  it("a empresa que terminou o passo a passo desta versão vai ao Início até zerar", async () => {
    mundo.org = { onboarded_at: "2026-10-25T12:00:00Z", onboarding_state: COM_SEGMENTO, demonstracao: false };
    expect(await destino(AppHome)).toBe("/app/inicio");
    mundo.zerou = true;
    expect(await destino(AppHome)).not.toBe("/app/inicio");
  });

  it("a empresa que já roda (sem o segmento desta versão) segue para a tela de sempre", async () => {
    mundo.org = { onboarded_at: "2026-09-01T12:00:00Z", onboarding_state: SEM_SEGMENTO, demonstracao: false };
    expect(await destino(AppHome)).not.toBe("/app/inicio");
  });

  it("o atendente nunca vai ao Início", async () => {
    mundo.papel = "agent";
    mundo.org = { onboarded_at: "2026-10-25T12:00:00Z", onboarding_state: COM_SEGMENTO, demonstracao: false };
    expect(await destino(AppHome)).not.toBe("/app/inicio");
  });
});

describe("o Início", () => {
  it("quem ainda está no passo a passo volta para ele", async () => {
    mundo.org = { onboarded_at: null, onboarding_state: COM_SEGMENTO, demonstracao: false };
    expect(await destino(InicioPage)).toBe("/onboarding");
  });

  it("a empresa nova, depois do passo a passo, vê o Início", async () => {
    mundo.org = { onboarded_at: "2026-10-25T12:00:00Z", onboarding_state: COM_SEGMENTO, demonstracao: false };
    expect(await destino(InicioPage)).toBe("(renderizou)");
  });

  it("a empresa que já roda vai para a tela de sempre", async () => {
    mundo.org = { onboarded_at: "2026-09-01T12:00:00Z", onboarding_state: SEM_SEGMENTO, demonstracao: false };
    const para = await destino(InicioPage);
    expect(para).not.toBe("(renderizou)");
    expect(para).not.toBe("/onboarding");
  });
});

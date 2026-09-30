/**
 * FORK MIA (.65) — A VOLTA DO GOOGLE CAI NO DOMÍNIO EM QUE A PESSOA CLICOU.
 *
 * A instalação responde por crm.timecompany.com.br e app.iamia.com.br. O cookie
 * do verificador de PKCE fica no domínio da tela; se o GoTrue devolve para o
 * outro, a troca do `code` falha. Ver lib/auth/dominio-do-retorno-do-google.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClientDeEntradaComGoogle } from "@/lib/supabase/server";
import { origemDoRetornoDoGoogle } from "@/lib/auth/dominio-do-retorno-do-google";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server", () => ({ createClientDeEntradaComGoogle: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://crm.timecompany.com.br",
    NEXT_PUBLIC_SUPABASE_URL: "https://sistema-db.exemplo.com.br",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVER_URL: "",
  },
}));

const APP = "https://crm.timecompany.com.br";

describe("origemDoRetornoDoGoogle", () => {
  it("usa o Origin do pedido: é o domínio onde ficou o cookie do PKCE", () => {
    expect(origemDoRetornoDoGoogle("https://app.iamia.com.br", APP)).toBe("https://app.iamia.com.br");
  });

  it("controle: no domínio principal, dá o mesmo de antes", () => {
    expect(origemDoRetornoDoGoogle(APP, APP)).toBe(APP);
  });

  it("sem Origin, vale NEXT_PUBLIC_APP_URL", () => {
    expect(origemDoRetornoDoGoogle(null, APP)).toBe(APP);
    expect(origemDoRetornoDoGoogle(undefined, APP)).toBe(APP);
    expect(origemDoRetornoDoGoogle("", APP)).toBe(APP);
  });

  it("Origin opaco (`null`) ou de outro esquema não vira endereço de retorno", () => {
    expect(origemDoRetornoDoGoogle("null", APP)).toBe(APP);
    expect(origemDoRetornoDoGoogle("javascript:alert(1)", APP)).toBe(APP);
    expect(origemDoRetornoDoGoogle("file:///etc", APP)).toBe(APP);
  });

  it("fica só a origem: caminho e consulta não passam", () => {
    expect(origemDoRetornoDoGoogle("https://app.iamia.com.br/qualquer?x=1", APP)).toBe(
      "https://app.iamia.com.br",
    );
  });
});

describe("signInWithGoogle pede a volta no domínio da tela", () => {
  const signInWithOAuth = vi.fn();

  beforeEach(() => {
    signInWithOAuth
      .mockReset()
      .mockResolvedValue({ data: { url: "https://accounts.google.com/o/oauth2" }, error: null });
    vi.mocked(redirect).mockClear();
    vi.mocked(createClientDeEntradaComGoogle).mockResolvedValue({
      auth: { signInWithOAuth },
    } as never);
    // Provedor ligado nas settings do GoTrue.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ external: { google: true } }) })),
    );
  });

  function comOrigin(origin: string | null) {
    vi.mocked(headers).mockResolvedValue({
      get: (nome: string) => (nome.toLowerCase() === "origin" ? origin : null),
    } as never);
  }

  it("⭐ clicou em app.iamia.com.br: volta para app.iamia.com.br/auth/callback", async () => {
    comOrigin("https://app.iamia.com.br");
    const { signInWithGoogle } = await import("@/app/actions/auth/signInWithGoogle");
    await signInWithGoogle({ convite: "tok" });
    const pedido = signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } };
    const volta = new URL(pedido.options.redirectTo);
    expect(volta.origin).toBe("https://app.iamia.com.br");
    expect(volta.pathname).toBe("/auth/callback");
    expect(volta.searchParams.get("convite")).toBe("tok");
  });

  it("controle: sem Origin, volta para NEXT_PUBLIC_APP_URL como antes", async () => {
    comOrigin(null);
    const { signInWithGoogle } = await import("@/app/actions/auth/signInWithGoogle");
    await signInWithGoogle();
    const pedido = signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } };
    expect(pedido.options.redirectTo).toBe(`${APP}/auth/callback`);
  });
});

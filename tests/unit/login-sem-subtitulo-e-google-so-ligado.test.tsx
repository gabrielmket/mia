/**
 * FORK MIA (.64) — A TELA DE ENTRAR SEM O QUE NÃO SERVE.
 *
 * Duas coisas que a tela mostrava e não deviam estar lá:
 *
 *   1. o botão "Entrar com Google" (e o separador "ou") numa instalação em que
 *      o Google está DESLIGADO no GoTrue — o clique só servia para mostrar "O
 *      Google não está habilitado nesta instalação...". Agora a tela pergunta
 *      ao GoTrue antes de desenhar (`lib/auth/google-na-tela.ts`), com cache
 *      curto, e SEM resposta esconde (falha fechado);
 *   2. o nome da marca sob o "Entrar", que repetia o logo desenhado logo acima
 *      pela casca de acesso. Fica só quando a casca não mostra marca nenhuma
 *      (`lib/branding/fachada.ts`).
 *
 * O que NÃO muda, e tem controle aqui: com o Google ligado o botão aparece; sem
 * logo e com nome próprio, o nome continua sob o "Entrar".
 */
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  marca: { nome: "MIA", logoUrl: null as string | null, logoDarkUrl: null as string | null },
}));

// A action do clique não é o assunto aqui (ela tem o teste dela); mockada
// inteira, o botão renderiza sem puxar `next/headers` e o cliente do Supabase.
vi.mock("@/app/actions/auth/signInWithGoogle", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: vi.fn(async () => "pt-BR") }));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: vi.fn(async () => ({
    ...h.marca,
    accent: "#000000",
    accentFg: "#ffffff",
    origens: { nome: "padrao", cor: "padrao" },
  })),
}));
vi.mock("@/components/auth/LoginForm", () => ({
  LoginForm: () => <form aria-label="formulário de entrar" />,
}));

import { EntrarComGoogleSeLigado } from "@/components/auth/EntrarComGoogleSeLigado";
import {
  VALIDADE_DA_RESPOSTA_MS,
  VALIDADE_DO_DESCONHECIDO_MS,
  esquecerEstadoDoGoogleNaTela,
  googleNaTelaDeEntrar,
} from "@/lib/auth/google-na-tela";
import { fachadaMostraAMarca } from "@/lib/branding/fachada";

/** As settings do GoTrue: só `external.google` importa. */
function settings(corpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

function stubGoTrue(resposta: Response | Error) {
  const f = vi.fn(async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  esquecerEstadoDoGoogleNaTela();
  h.marca = { nome: "MIA", logoUrl: null, logoDarkUrl: null };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o GoTrue decide se o botão do Google existe", () => {
  it("ligado nas settings: aparece", async () => {
    const f = stubGoTrue(settings({ external: { google: true } }));
    expect(await googleNaTelaDeEntrar()).toBe(true);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/\/auth\/v1\/settings$/);
  });

  it("desligado nas settings: some", async () => {
    stubGoTrue(settings({ external: { google: false } }));
    expect(await googleNaTelaDeEntrar()).toBe(false);
  });

  it.each([
    ["rede fora do ar", new Error("ECONNREFUSED")],
    ["GoTrue respondendo 500", settings({}, 500)],
    ["corpo sem `external.google`", settings({ external: {} })],
  ])("sem saber (%s): some — falha fechado", async (_caso, resposta) => {
    stubGoTrue(resposta);
    expect(await googleNaTelaDeEntrar()).toBe(false);
  });

  it("a resposta vale um minuto: a segunda visita não vai ao GoTrue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = stubGoTrue(settings({ external: { google: true } }));
    await googleNaTelaDeEntrar();
    await googleNaTelaDeEntrar();
    expect(f).toHaveBeenCalledTimes(1);

    // Alguém desligou o Google no GoTrue: passado o minuto, a tela acompanha.
    vi.setSystemTime(Date.now() + VALIDADE_DA_RESPOSTA_MS + 1);
    f.mockResolvedValue(settings({ external: { google: false } }));
    expect(await googleNaTelaDeEntrar()).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a falha vale pouco: o botão volta assim que o GoTrue responder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = stubGoTrue(new Error("timeout"));
    expect(await googleNaTelaDeEntrar()).toBe(false);

    f.mockResolvedValue(settings({ external: { google: true } }));
    // Dentro da validade curta ainda vale a falha guardada...
    expect(await googleNaTelaDeEntrar()).toBe(false);
    // ...e ela é bem menor que a da resposta lida.
    expect(VALIDADE_DO_DESCONHECIDO_MS).toBeLessThan(VALIDADE_DA_RESPOSTA_MS);
    vi.setSystemTime(Date.now() + VALIDADE_DO_DESCONHECIDO_MS + 1);
    expect(await googleNaTelaDeEntrar()).toBe(true);
  });

  it("visitas ao mesmo tempo esperam UMA leitura", async () => {
    const f = stubGoTrue(settings({ external: { google: true } }));
    const respostas = await Promise.all([
      googleNaTelaDeEntrar(),
      googleNaTelaDeEntrar(),
      googleNaTelaDeEntrar(),
    ]);
    expect(respostas).toEqual([true, true, true]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("o componente do botão", () => {
  it("⭐ Google desligado: nem o botão nem o separador 'ou' vão para a tela", async () => {
    stubGoTrue(settings({ external: { google: false } }));
    const el = await EntrarComGoogleSeLigado({});
    expect(el).toBeNull();
  });

  it("controle: Google ligado desenha o botão e o separador", async () => {
    stubGoTrue(settings({ external: { google: true } }));
    const el = await EntrarComGoogleSeLigado({ next: "/app" });
    render(el as ReactElement);
    expect(screen.getByRole("button", { name: /entrar com google/i })).toBeTruthy();
    expect(screen.getByText("ou")).toBeTruthy();
  });
});

describe("a página de entrar", () => {
  async function pintarLogin() {
    // O botão do Google é dublê aqui: o que se mede é que a página delega a
    // decisão a ele (e não desenha o `EntrarComGoogle` direto).
    vi.resetModules();
    vi.doMock("@/components/auth/EntrarComGoogleSeLigado", () => ({
      EntrarComGoogleSeLigado: () => <div data-testid="google-se-ligado" />,
    }));
    const { default: LoginPage } = await import("@/app/(public)/login/page");
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
  }

  afterEach(() => {
    vi.doUnmock("@/components/auth/EntrarComGoogleSeLigado");
    vi.resetModules();
  });

  it("⭐ com o logotipo do produto na casca: sem o 'MIA' repetido sob o 'Entrar'", async () => {
    await pintarLogin();
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeTruthy();
    expect(screen.queryByText("MIA", { exact: true })).toBeNull();
    expect(screen.getByTestId("google-se-ligado")).toBeTruthy();
  });

  it("⭐ com logo configurado na casca: também sem o nome repetido", async () => {
    h.marca = { nome: "MIA", logoUrl: "https://cdn.exemplo.test/logo.png", logoDarkUrl: null };
    await pintarLogin();
    expect(screen.queryByText("MIA", { exact: true })).toBeNull();
  });

  it("controle: nome próprio sem logo — a casca não mostra nada, e o nome fica", async () => {
    // `branding()` lê `window.__PUBLIC_ENV__` quando há `window` (jsdom).
    const w = window as unknown as { __PUBLIC_ENV__?: Record<string, string> };
    const antes = w.__PUBLIC_ENV__;
    w.__PUBLIC_ENV__ = { ...antes, APP_NAME: "Clínica Aurora" };
    try {
      h.marca = { nome: "Clínica Aurora", logoUrl: null, logoDarkUrl: null };
      await pintarLogin();
      expect(screen.getByText("Clínica Aurora", { exact: true })).toBeTruthy();
    } finally {
      w.__PUBLIC_ENV__ = antes;
    }
  });
});

describe("a regra da casca, isolada", () => {
  it.each([
    [{ nome: "MIA", logoUrl: null, logoDarkUrl: null }, true],
    [{ nome: "Clínica Aurora", logoUrl: "https://x.test/l.png", logoDarkUrl: null }, true],
    [{ nome: "Clínica Aurora", logoUrl: null, logoDarkUrl: "https://x.test/escuro.png" }, true],
    [{ nome: "Clínica Aurora", logoUrl: null, logoDarkUrl: null }, false],
  ])("%j → mostra a marca? %s", (marca, esperado) => {
    expect(fachadaMostraAMarca(marca)).toBe(esperado);
  });
});

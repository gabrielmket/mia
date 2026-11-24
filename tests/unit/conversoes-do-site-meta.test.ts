/**
 * FORK MIA (MIA-169) — o CORPO do evento de site na Meta
 * (`lib/plataformas-de-anuncio/meta/evento-do-site.ts`), sem rede.
 *
 * O que se mede é o fio: `website` com a página e o navegador, os hashes
 * SHA-256 do valor normalizado, `fbp`/`fbc` só com o aviso de cookies aceito
 * (`medicao`), valor, moeda e id do pedido só no Purchase e no Subscribe, o
 * `test_event_code`, e `system_generated` quando o navegador não foi guardado.
 *
 * Dado fictício: a Ana Exemplo, domínio de exemplo e IP de documentação.
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { corpoDoEventoDoSite, enviarEventoDoSite } = await import("@/lib/plataformas-de-anuncio/meta/evento-do-site");
const { transporteMeta } = await import("@/lib/plataformas-de-anuncio/meta/conversions");

import type { ConversaoOffline, DadosDoEventoDoSite } from "@/lib/plataformas-de-anuncio/types";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const AGORA = Date.parse("2026-11-24T12:00:00Z");
const LEAD = "0e000000-0000-4000-8000-0000000005a1";
const EMPRESA = "0a000000-0000-4000-8000-0000000005a2";

function site(over: Partial<DadosDoEventoDoSite> = {}): DadosDoEventoDoSite {
  return {
    email: "  Ana.Exemplo@Example.com ",
    nome: "Ana Maria Exemplo",
    idExterno: EMPRESA,
    ip: "203.0.113.10/32",
    navegador: "Mozilla/5.0 (teste)",
    pagina: "https://app.exemplo.test/signup",
    fbp: "fb.1.1700000000000.123",
    fbc: "fb.1.1700000000000.AbC",
    consentimento: "medicao",
    pedidoId: "pay_ficticio_1",
    ...over,
  };
}

function conversao(evento: string, over: Partial<ConversaoOffline> = {}, s: Partial<DadosDoEventoDoSite> = {}): ConversaoOffline {
  return {
    organizationId: "0a000000-0000-4000-8000-000000000001",
    leadId: LEAD,
    evento: "MetaEtapa:0f000000-0000-4000-8000-000000000001",
    eventoId: `${LEAD}:MetaEtapa:0f000000-0000-4000-8000-000000000001`,
    ocorridoEm: new Date(AGORA - 60_000),
    cliqueDeOrigem: "",
    telefone: "+55 (00) 90000-0000",
    moeda: "brl",
    valorCentavos: 19700,
    eventoNaPlataforma: evento,
    site: site(s),
    ...over,
  };
}

type Evento = { action_source: string; event_source_url?: string; event_id: string; event_name: string; user_data: Record<string, unknown>; custom_data?: Record<string, unknown> };
function evento(c: ConversaoOffline, codigo: string | null = null) {
  const r = corpoDoEventoDoSite(c, codigo, AGORA);
  if (!r.ok) throw new Error(r.detalhe);
  return { corpo: r.corpo, e: (r.corpo.data as Evento[])[0]!, origem: r.origem };
}

describe("o evento de site na Meta", () => {
  it("⭐ sai `website`, com a página, o navegador, o IP sem máscara e os hashes do valor normalizado", () => {
    const { e, corpo, origem } = evento(conversao("CompleteRegistration"));
    expect(origem).toBe("website");
    expect(e.action_source).toBe("website");
    expect(e.event_name).toBe("CompleteRegistration");
    expect(e.event_source_url).toBe("https://app.exemplo.test/signup");
    expect(e.event_id).toBe(`${LEAD}:MetaEtapa:0f000000-0000-4000-8000-000000000001`);
    expect(e.user_data).toEqual({
      em: [sha("ana.exemplo@example.com")],
      ph: [sha("5500900000000")],
      fn: [sha("ana")],
      ln: [sha("exemplo")],
      external_id: [sha(EMPRESA)],
      client_ip_address: "203.0.113.10",
      client_user_agent: "Mozilla/5.0 (teste)",
      fbp: "fb.1.1700000000000.123",
      fbc: "fb.1.1700000000000.AbC",
    });
    // Nada em claro do que vai em hash.
    expect(JSON.stringify(corpo)).not.toContain("example.com");
    expect(JSON.stringify(corpo)).not.toContain("Ana");
    // Cadastro não leva valor.
    expect(e.custom_data).toBeUndefined();
    expect(corpo.test_event_code).toBeUndefined();
  });

  it("⭐ sem o aviso de cookies aceito (`medicao`), fbp e fbc não saem, mesmo guardados", () => {
    for (const consentimento of ["necessario", null]) {
      const { e } = evento(conversao("StartTrial", {}, { consentimento }));
      expect(e.user_data).not.toHaveProperty("fbp");
      expect(e.user_data).not.toHaveProperty("fbc");
      // O resto continua (a especificação: IP e navegador não dependem do aviso).
      expect(e.user_data.client_user_agent).toBe("Mozilla/5.0 (teste)");
    }
  });

  it.each(["Purchase", "Subscribe"])("⭐ %s leva value, currency BRL e order_id", (nome) => {
    const { e } = evento(conversao(nome));
    expect(e.custom_data).toEqual({ value: 197, currency: "BRL", order_id: "pay_ficticio_1" });
  });

  it.each(["Purchase", "Subscribe"])("%s sem valor é recusado antes de sair (a Meta recusaria)", (nome) => {
    const r = corpoDoEventoDoSite(conversao(nome, { valorCentavos: null }), null, AGORA);
    expect(r.ok).toBe(false);
  });

  it("StartTrial e CompleteRegistration não levam valor, mesmo com valor no negócio", () => {
    expect(evento(conversao("StartTrial")).e.custom_data).toBeUndefined();
  });

  it("⭐ o código de teste vai no corpo", () => {
    expect(evento(conversao("Purchase"), "TESTE123").corpo.test_event_code).toBe("TESTE123");
  });

  it("⭐ sem navegador guardado sai `system_generated`, sem página nem IP, nunca com navegador inventado", () => {
    for (const s of [{ navegador: null }, { pagina: null }]) {
      const { e, origem } = evento(conversao("Subscribe", {}, s));
      expect(origem).toBe("system_generated");
      expect(e.action_source).toBe("system_generated");
      expect(e).not.toHaveProperty("event_source_url");
      expect(e.user_data).not.toHaveProperty("client_user_agent");
      expect(e.user_data).not.toHaveProperty("client_ip_address");
      expect(e.user_data.em).toEqual([sha("ana.exemplo@example.com")]);
    }
  });

  it("evento fora dos 4, mais de 7 dias, ou sem nada que reconheça a pessoa: recusa antes de sair", () => {
    expect(corpoDoEventoDoSite(conversao("LeadSubmitted"), null, AGORA).ok).toBe(false);
    expect(corpoDoEventoDoSite(conversao("StartTrial", { ocorridoEm: new Date(AGORA - 8 * 86_400_000) }), null, AGORA).ok).toBe(false);
    expect(
      corpoDoEventoDoSite(conversao("StartTrial", { telefone: null }, { email: null, nome: null, idExterno: null }), null, AGORA).ok,
    ).toBe(false);
  });

  it("o transporte da Meta delega ao evento de site, com o token no cabeçalho e o endereço da Graph de sempre", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const r = await transporteMeta.enviar(
        { datasetId: "900000000000009", accessToken: "token-ficticio", testEventCode: "TESTE123" },
        conversao("Purchase", { ocorridoEm: new Date(Date.now() - 60_000) }),
      );
      expect(r).toEqual({ tipo: "ok" });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/900000000000009\/events$/);
      expect(url).not.toContain("token-ficticio");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-ficticio");
      const corpo = JSON.parse(String(init.body)) as { data: Evento[]; test_event_code: string };
      expect(corpo.data[0]!.action_source).toBe("website");
      expect(corpo.test_event_code).toBe("TESTE123");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a recusa da Meta vira permanente, e o 5xx, transitório", async () => {
    const credencial = { datasetId: "900000000000009", accessToken: "token-ficticio", testEventCode: null };
    const c = conversao("StartTrial", { ocorridoEm: new Date(Date.now() - 60_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), { status: 400 })));
    expect((await enviarEventoDoSite(credencial, c)).tipo).toBe("permanente");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    expect((await enviarEventoDoSite(credencial, c)).tipo).toBe("transitorio");
    vi.unstubAllGlobals();
  });
});

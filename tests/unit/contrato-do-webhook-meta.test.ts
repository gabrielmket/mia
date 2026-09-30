import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CONTRATO do webhook da Cloud API.
 *
 * A ordem dos casos é a da dúvida: primeiro que os payloads REAIS produzem
 * exatamente os mesmos eventos de antes (é o que prova que ninguém apertou
 * demais), depois que o payload torto para de virar 500.
 *
 * O 500 não é hipótese: `parseMetaWebhook` faz `for (const entry of
 * envelope.entry ?? [])`, e `for...of` sobre um número LANÇA. A rota não tem
 * `try/catch` em volta, então a Meta recebia 5xx e reentregava o mesmo corpo em
 * backoff — indefinidamente, porque ele nunca ia melhorar.
 */

const SESSAO = { id: "sess-1", organizationId: "org-1", wabaId: "2434045433735175" };
const APP_SECRET = "app-secret-de-teste";
const OUTRA_SESSAO = { id: "sess-2", organizationId: "org-2", wabaId: "2434045433735175" };
const ingeridos: unknown[] = [];
const orgsIngeridas: string[] = [];

const porToken = vi.hoisted(() => vi.fn());
const porWaba = vi.hoisted(() => vi.fn());
vi.mock("@/lib/channels/meta/session", () => ({
  metaSessionByWebhookToken: porToken,
  metaSessionByWabaId: porWaba,
}));

const ecos: string[] = [];
const naCampanha = vi.hoisted(() => [] as Array<{ organizationId: string; statusDaMeta: string }>);

vi.mock("@/lib/channels/meta/ingest", () => ({
  // O eco do app (coexistência, upstream v1.60) registra a organização como a
  // recebida: é a mesma pergunta de "de quem é", e as duas têm que ouvir
  // `donoDoEvento`, não o token do caminho.
  ingestMetaEcho: async (_a: unknown, _e: unknown, opts: { organizationId: string }) => {
    ecos.push(opts.organizationId);
    return { status: "ingested" };
  },
  ingestMetaInbound: async (_a: unknown, e: unknown, opts: { organizationId: string }) => {
    ingeridos.push(e);
    orgsIngeridas.push(opts.organizationId);
    return { status: "ingested" };
  },
}));

vi.mock("@/lib/broadcast/desfecho-da-campanha", () => ({
  aplicarDesfechoNaCampanha: async (_a: unknown, input: { organizationId: string; statusDaMeta: string }) => {
    naCampanha.push({ organizationId: input.organizationId, statusDaMeta: input.statusDaMeta });
    return "nao_e_disparo";
  },
}));

/**
 * Uma consulta que aceita qualquer encadeamento e termina vazia.
 *
 * Era uma escada fixa de quatro `.eq()`, que só servia ao ramo de status comum.
 * O ramo de `failed` do upstream (#1614) encadeia `.neq().select().maybeSingle()`,
 * e a escada fixa lançaria ali — o teste mediria o mock, não a rota.
 */
function consultaVazia(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["update", "eq", "neq", "select"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  c.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
  return c;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => consultaVazia() }),
}));

import { lerEnvelopeMeta } from "@/lib/channels/meta/envelope";
import { parseMetaWebhook } from "@/lib/channels/meta/webhook";
import { POST } from "@/app/api/v1/webhooks/meta/[token]/route";

/** Payloads REAIS capturados da WABA de teste — os mesmos de `meta-webhook-inbound.test.ts`. */
const REAIS = JSON.parse(readFileSync("tests/fixtures/meta/inbound-webhooks.json", "utf8")) as unknown[];

const pedido = (corpo: unknown) => {
  const cru = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return {
    text: async () => cru,
    headers: new Headers({
      "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(cru, "utf8").digest("hex")}`,
    }),
  } as never;
};
const ctx = { params: Promise.resolve({ token: "token-de-teste" }) } as never;

describe("os payloads reais atravessam inteiros", () => {
  it.each(REAIS.map((p, i) => [i, p] as const))("payload real #%i passa e nada some", (_i, cru) => {
    const r = lerEnvelopeMeta(JSON.stringify(cru));
    expect(r.ok).toBe(true);
    expect(r.ok && r.envelope).toEqual(cru);
  });

  it("o parser produz EXATAMENTE os mesmos eventos com e sem o schema no meio", () => {
    // Prova de não-regressão: se o schema tivesse comido um campo, a lista de
    // eventos mudaria — e é ela que vira mensagem no inbox.
    for (const cru of REAIS) {
      const validado = lerEnvelopeMeta(JSON.stringify(cru));
      expect(validado.ok).toBe(true);
      expect(validado.ok && parseMetaWebhook(validado.envelope)).toEqual(
        parseMetaWebhook(cru as Parameters<typeof parseMetaWebhook>[0]),
      );
    }
  });

  it("campo desconhecido no envelope, na entry e na change passa intacto", () => {
    const comNovidade = {
      object: "whatsapp_business_account",
      campoDoFuturo: 1,
      entry: [{ id: "waba-1", time: 123, changes: [{ field: "messages", value: {}, extra: true }] }],
    };
    const r = lerEnvelopeMeta(JSON.stringify(comNovidade));
    expect(r.ok).toBe(true);
    expect(r.ok && r.envelope).toEqual(comNovidade);
  });

  it("o miolo de `value` NÃO é apertado — quem o lê já trata qualquer forma", () => {
    // `parseMetaWebhook` lê tudo por `str()`/`Array.isArray`. Exigir tipo aqui
    // trocaria "campo ignorado" por "webhook inteiro recusado".
    const r = lerEnvelopeMeta(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "w", changes: [{ field: "messages", value: { messages: "nem é lista", metadata: 7 } }] }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("envelope de outro produto (`object: page`) passa no contrato e o parser é quem ignora", () => {
    // A separação importa: recusar aqui viraria 400 para um evento legítimo que
    // simplesmente não é nosso.
    const r = lerEnvelopeMeta(JSON.stringify({ object: "page", entry: [{ id: "x" }] }));
    expect(r.ok).toBe(true);
    expect(r.ok && parseMetaWebhook(r.envelope)).toEqual([]);
  });
});

describe("o payload fora do contrato é recusado, e o campo é nomeado", () => {
  const recusa = (corpo: unknown): string[] => {
    const r = lerEnvelopeMeta(JSON.stringify(corpo));
    if (r.ok) throw new Error("o schema ACEITOU um payload que devia recusar");
    expect(r.motivo).toBe("contrato_violado");
    return [...r.campos].sort();
  };

  it("`entry` que não é lista — o campo que virava 500", () => {
    expect(recusa({ object: "whatsapp_business_account", entry: 3 })).toEqual(["entry"]);
  });

  it("sem o contrato, esse mesmo valor LANÇAVA no parser", () => {
    expect(() =>
      parseMetaWebhook({ object: "whatsapp_business_account", entry: 3 } as never),
    ).toThrow(TypeError);
  });

  it("`changes` que não é lista, e `value` que não é objeto", () => {
    expect(recusa({ object: "whatsapp_business_account", entry: [{ id: "w", changes: 1 }] })).toEqual([
      "entry.0.changes",
    ]);
    expect(
      recusa({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ value: "texto" }] }] }),
    ).toEqual(["entry.0.changes.0.value"]);
  });

  it("json quebrado é motivo PRÓPRIO", () => {
    expect(lerEnvelopeMeta("{nao é json")).toMatchObject({ ok: false, motivo: "json_invalido" });
  });
});

describe("a rota — o desfecho que a Meta enxerga", () => {
  beforeEach(() => {
    porToken.mockReset().mockResolvedValue(SESSAO);
    porWaba.mockReset().mockResolvedValue(null);
    ingeridos.length = 0;
    orgsIngeridas.length = 0;
    ecos.length = 0;
    naCampanha.length = 0;
  });

  it("payload real bem assinado: 200 e a mensagem é ingerida", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);

    const res = await POST(pedido(REAIS[0]), ctx);

    expect(res.status).toBe(200);
    expect(ingeridos).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it("`entry` torto bem assinado: 400 com o campo, e NADA é ingerido", async () => {
    // Antes era 500 (exceção não capturada) e a Meta reentregava para sempre.
    vi.stubEnv("META_APP_SECRET", APP_SECRET);

    const res = await POST(pedido({ object: "whatsapp_business_account", entry: 3 }), ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "validation_failed", details: { campos: ["entry"] } },
    });
    expect(ingeridos).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("a assinatura continua vindo ANTES do contrato — corpo torto sem HMAC é 401", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);

    const res = await POST(
      { text: async () => '{"entry":3}', headers: new Headers() } as never,
      ctx,
    );

    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  /**
   * O TOKEN ÓRFÃO — a armadilha que ficava armada esperando uma faxina.
   *
   * A URL de callback do app carrega o token de UM canal. Arquivar esse canal é
   * a coisa mais natural do mundo ao trocar o número de teste pelo definitivo, e
   * fazia a rota devolver 404 antes de olhar o corpo: TODAS as contas ficavam
   * mudas de uma vez, e o defeito parecia estar no número novo.
   */
  it("canal do token ARQUIVADO: o evento ainda acha dono pela WABA", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    porToken.mockResolvedValue(null);
    porWaba.mockResolvedValue(OUTRA_SESSAO);

    const res = await POST(pedido(REAIS[0]), ctx);

    expect(res.status, "era 404 — e 404 aqui derruba a instalação inteira").toBe(200);
    expect(ingeridos).toHaveLength(1);
    expect(orgsIngeridas, "a organização sai da WABA, não do token morto").toEqual(["org-2"]);
    vi.unstubAllEnvs();
  });

  it("token órfão E WABA desconhecida: 200 sem escrever nada", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    porToken.mockResolvedValue(null);
    porWaba.mockResolvedValue(null);

    const res = await POST(pedido(REAIS[0]), ctx);

    // 200 porque a Meta reentrega em backoff tudo que não recebe 2xx — e este
    // evento nunca vai melhorar.
    expect(res.status).toBe(200);
    expect(ingeridos, "sem dono não se escreve em tenant nenhum").toHaveLength(0);
    expect(await res.json()).toMatchObject({ outcomes: ["waba_desconhecida"] });
    vi.unstubAllEnvs();
  });

  /**
   * Os dois ramos que o upstream trouxe na v1.60 — o eco do app (coexistência)
   * e o `failed` com `message.failed` (#1614) — foram escritos contra a rota
   * antiga, em que `session` nunca era nula. Na fusão eles liam
   * `session.organizationId`: com token órfão isso LANÇA, e com duas contas
   * escreve no tenant errado. Estes dois casos seguram a costura.
   */
  it("eco do app WhatsApp Business com token órfão: a organização sai da WABA", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    porToken.mockResolvedValue(null);
    porWaba.mockResolvedValue(OUTRA_SESSAO);

    const res = await POST(
      pedido({
        object: "whatsapp_business_account",
        entry: [
          {
            id: OUTRA_SESSAO.wabaId,
            changes: [
              {
                field: "smb_message_echoes",
                value: {
                  metadata: { phone_number_id: "pn-1" },
                  message_echoes: [
                    { id: "wamid.eco-1", to: "5511999990000", timestamp: "1700000000", type: "text", text: { body: "oi" } },
                  ],
                },
              },
            ],
          },
        ],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(ecos, "era session.organizationId — nulo aqui").toEqual(["org-2"]);
    vi.unstubAllEnvs();
  });

  it("status `failed` ainda chega à campanha — é ele que estorna o cliente", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    porToken.mockResolvedValue(null);
    porWaba.mockResolvedValue(OUTRA_SESSAO);

    const res = await POST(
      pedido({
        object: "whatsapp_business_account",
        entry: [
          {
            id: OUTRA_SESSAO.wabaId,
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "pn-1" },
                  statuses: [
                    {
                      id: "wamid.falhou-1",
                      status: "failed",
                      recipient_id: "5511999990000",
                      errors: [{ code: 131047, title: "Re-engagement message" }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    // O ramo de `failed` do upstream entrou como `else if` à frente do nosso
    // `else`, e do jeito que a fusão os juntou o `failed` nunca chegava aqui.
    expect(naCampanha, "sem isto a campanha não estorna a mensagem recusada").toEqual([
      { organizationId: "org-2", statusDaMeta: "failed" },
    ]);
    vi.unstubAllEnvs();
  });
});

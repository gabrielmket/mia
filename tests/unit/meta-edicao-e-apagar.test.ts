/**
 * FORK MIA · coexistência (S4): A EDIÇÃO E O APAGAR FEITOS NO WHATSAPP APARECEM
 * NA MENSAGEM QUE A MIA JÁ TEM (lib/channels/meta/webhook.ts,
 * lib/channels/meta/coexistencia/edicao.ts; docs/fork/coexistencia.md).
 *
 * Dois lados, o mesmo miolo (webhooks/reference/messages, lido em 18/11/2026):
 * o cliente edita ou apaga (campo `messages`) e o dono edita ou apaga pelo app
 * WhatsApp Business (campo `smb_message_echoes`). `edit.original_message_id` e
 * `edit.message`; `revoke.original_message_id`.
 *
 * Antes: o `edit` do cliente virava mensagem NOVA com `type = 'edit'` (que o
 * CHECK de `messages.type` recusa: a edição sumia), e o do app era descartado
 * pelo `continue` do upstream, que continua lá para o eco sem alvo.
 *
 * Apagar NÃO remove a linha nem limpa o corpo: só carimba `revoked_at` (a tela
 * decide o que mostrar, `lib/messaging/apagada.ts`).
 *
 * Dado fictício: Academia Alfa, cliente Ana Exemplo (+55 31 900000002).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auditados: [] as Array<{ action: string; resourceId?: string; metadata?: Record<string, unknown> }> }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: { action: string; resourceId?: string; metadata?: Record<string, unknown> }) => {
    h.auditados.push(e);
  }),
}));

const { parseMetaWebhook } = await import("@/lib/channels/meta/webhook");
const { aplicarEdicaoDaMeta } = await import("@/lib/channels/meta/coexistencia/edicao");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");

const ALFA = "0a0b0c0d-1111-4111-8111-000000009291";
const CONVERSA = "0a0b0c0d-5555-4555-8555-000000009291";
const WABA = "102290129340398";
const NUMERO = "106540352242922";
const ANA = "5531900000002";
const RECEBIDA = "wamid.HBgLNTUzMTkwMDAwMDAwMhUCABIYFDNBQ0I2OTlENTA1RkYxRkQzRUFEAA==";
const ENVIADA_PELO_APP = "wamid.HBgLNTUzMTkwMDAwMDAwMhUCABEYEjU1QTgxRjZFMzM4QjQ4OUY3AA==";
const T0 = 1_768_400_000;

function mensagens(raw: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5531900000001", phone_number_id: NUMERO },
              contacts: [{ profile: { name: "Ana Exemplo" }, wa_id: ANA }],
              messages: [raw],
            },
          },
        ],
      },
    ],
  };
}

function ecos(raw: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5531900000001", phone_number_id: NUMERO },
              message_echoes: [raw],
            },
          },
        ],
      },
    ],
  };
}

const edicaoDoCliente = (id: string, quando: number, corpo: string, alvo = RECEBIDA) =>
  mensagens({
    from: ANA,
    id,
    timestamp: String(quando),
    type: "edit",
    edit: { original_message_id: alvo, message: { type: "text", text: { body: corpo } } },
  });
const apagarDoCliente = (id: string, quando: number, alvo = RECEBIDA) =>
  mensagens({ from: ANA, id, timestamp: String(quando), type: "revoke", revoke: { original_message_id: alvo } });

function banco() {
  return bancoEmMemoria({
    messages: [
      {
        id: "0a0b0c0d-7777-4777-8777-000000000001",
        organization_id: ALFA,
        conversation_id: CONVERSA,
        external_id: RECEBIDA,
        direction: "inbound",
        type: "text",
        body: "Quero o plano mensal",
        sent_at: new Date(T0 * 1000).toISOString(),
        edited_at: null,
        revoked_at: null,
      },
      {
        id: "0a0b0c0d-7777-4777-8777-000000000002",
        organization_id: ALFA,
        conversation_id: CONVERSA,
        external_id: ENVIADA_PELO_APP,
        direction: "outbound",
        sent_via: "external_device",
        type: "image",
        body: "Tabela de preços",
        sent_at: new Date((T0 + 10) * 1000).toISOString(),
        edited_at: null,
        revoked_at: null,
      },
    ],
    conversations: [
      {
        id: CONVERSA,
        organization_id: ALFA,
        last_message_at: new Date(T0 * 1000).toISOString(),
        last_message_preview: "Quero o plano mensal",
      },
    ],
  });
}

const ctx = { organizationId: ALFA, requestId: "req-9291" };
async function aplicar(b: ReturnType<typeof banco>, envelope: unknown) {
  const eventos = parseMetaWebhook(envelope as never);
  const out: string[] = [];
  for (const e of eventos) {
    if (e.kind !== "message_edit") throw new Error(`esperava message_edit, veio ${e.kind}`);
    out.push(await aplicarEdicaoDaMeta(b.cliente as never, e, ctx));
  }
  return out;
}
const msg = (b: ReturnType<typeof banco>, externalId: string) =>
  b.tabela("messages").find((m) => m.external_id === externalId)!;

beforeEach(() => {
  h.auditados = [];
});

describe("a leitura: edit e revoke viram alteração da original, não mensagem nova", () => {
  it("o cliente editou (campo messages)", () => {
    expect(parseMetaWebhook(edicaoDoCliente("wamid.edit.1", T0 + 60, "Quero o plano anual") as never)).toEqual([
      {
        kind: "message_edit",
        wabaId: WABA,
        phoneNumberId: NUMERO,
        externalId: "wamid.edit.1",
        targetExternalId: RECEBIDA,
        acao: "edit",
        origem: "cliente",
        text: "Quero o plano anual",
        sentAt: new Date((T0 + 60) * 1000),
      },
    ]);
  });

  it("a edição da legenda de uma foto traz a legenda nova (o exemplo da página da Meta)", () => {
    const [e] = parseMetaWebhook(
      mensagens({
        from: ANA,
        id: "wamid.edit.foto",
        timestamp: String(T0),
        type: "edit",
        edit: { original_message_id: RECEBIDA, message: { type: "image", image: { caption: "Legenda nova" } } },
      }) as never,
    );
    expect(e).toMatchObject({ kind: "message_edit", acao: "edit", text: "Legenda nova" });
  });

  it("o cliente apagou", () => {
    expect(parseMetaWebhook(apagarDoCliente("wamid.revoke.1", T0 + 90) as never)).toEqual([
      expect.objectContaining({ kind: "message_edit", acao: "revoke", origem: "cliente", targetExternalId: RECEBIDA, text: null }),
    ]);
  });

  it("o dono editou e apagou pelo app (eco)", () => {
    const editou = parseMetaWebhook(
      ecos({
        from: "5531900000001",
        to: ANA,
        id: "wamid.eco.edit",
        timestamp: String(T0 + 20),
        type: "edit",
        edit: { original_message_id: ENVIADA_PELO_APP, message: { type: "image", image: { caption: "Tabela nova" } } },
      }) as never,
    );
    expect(editou).toEqual([expect.objectContaining({ kind: "message_edit", origem: "app", acao: "edit", text: "Tabela nova" })]);
    const apagou = parseMetaWebhook(
      ecos({
        from: "5531900000001",
        to: ANA,
        id: "wamid.eco.revoke",
        timestamp: String(T0 + 30),
        type: "revoke",
        revoke: { original_message_id: ENVIADA_PELO_APP },
      }) as never,
    );
    expect(apagou).toEqual([expect.objectContaining({ kind: "message_edit", origem: "app", acao: "revoke" })]);
  });

  it("sem o alvo: o eco cai no `continue` do upstream (nada) e nenhuma linha meia-boca nasce", () => {
    const eco = parseMetaWebhook(
      ecos({ from: "5531900000001", to: ANA, id: "wamid.eco.x", timestamp: String(T0), type: "revoke", revoke: {} }) as never,
    );
    expect(eco).toEqual([]);
    const doCliente = parseMetaWebhook(
      mensagens({ from: ANA, id: "wamid.x", timestamp: String(T0), type: "edit", edit: {} }) as never,
    );
    expect(doCliente.some((e) => e.kind === "message_edit")).toBe(false);
  });

  it("o resto do campo messages não mudou: o texto segue mensagem recebida", () => {
    const [e] = parseMetaWebhook(
      mensagens({ from: ANA, id: "wamid.texto", timestamp: String(T0), type: "text", text: { body: "Oi" } }) as never,
    );
    expect(e).toMatchObject({ kind: "inbound_message", type: "text", text: "Oi" });
  });
});

describe("a edição", () => {
  it("troca o corpo e carimba edited_at com a hora do evento", async () => {
    const b = banco();
    expect(await aplicar(b, edicaoDoCliente("wamid.edit.1", T0 + 60, "Quero o plano anual"))).toEqual(["editada"]);
    expect(msg(b, RECEBIDA)).toMatchObject({
      body: "Quero o plano anual",
      edited_at: new Date((T0 + 60) * 1000).toISOString(),
      revoked_at: null,
    });
    // Alteração, não mensagem nova.
    expect(b.tabela("messages")).toHaveLength(2);
  });

  it("a reentrega não muda nada; a edição MAIS VELHA que a aplicada não volta o texto", async () => {
    const b = banco();
    await aplicar(b, edicaoDoCliente("wamid.edit.2", T0 + 120, "Versão nova"));
    expect(await aplicar(b, edicaoDoCliente("wamid.edit.2", T0 + 120, "Versão nova"))).toEqual(["sem_mudanca"]);
    expect(await aplicar(b, edicaoDoCliente("wamid.edit.1", T0 + 60, "Versão velha"))).toEqual(["sem_mudanca"]);
    expect(msg(b, RECEBIDA).body).toBe("Versão nova");
  });

  it("sem a original na MIA: `sem_alvo`, e nada é criado", async () => {
    const b = banco();
    expect(await aplicar(b, edicaoDoCliente("wamid.edit.3", T0, "x", "wamid.que.nao.existe"))).toEqual(["sem_alvo"]);
    expect(b.tabela("messages")).toHaveLength(2);
  });

  it("o dono editou a legenda pelo app: a mensagem da empresa muda", async () => {
    const b = banco();
    const r = await aplicar(
      b,
      ecos({
        from: "5531900000001",
        to: ANA,
        id: "wamid.eco.edit",
        timestamp: String(T0 + 20),
        type: "edit",
        edit: { original_message_id: ENVIADA_PELO_APP, message: { type: "image", image: { caption: "Tabela nova" } } },
      }),
    );
    expect(r).toEqual(["editada"]);
    expect(msg(b, ENVIADA_PELO_APP).body).toBe("Tabela nova");
  });

  it("edição sem texto carimba e não zera o corpo", async () => {
    const b = banco();
    await aplicar(
      b,
      mensagens({
        from: ANA,
        id: "wamid.edit.semtexto",
        timestamp: String(T0 + 5),
        type: "edit",
        edit: { original_message_id: RECEBIDA, message: { type: "image", image: {} } },
      }),
    );
    expect(msg(b, RECEBIDA)).toMatchObject({ body: "Quero o plano mensal", edited_at: new Date((T0 + 5) * 1000).toISOString() });
  });
});

describe("o apagar", () => {
  it("carimba revoked_at e NÃO remove a linha nem limpa o corpo; a prévia da conversa sai do texto", async () => {
    const b = banco();
    expect(await aplicar(b, apagarDoCliente("wamid.revoke.1", T0 + 90))).toEqual(["apagada"]);
    expect(msg(b, RECEBIDA)).toMatchObject({
      body: "Quero o plano mensal",
      revoked_at: new Date((T0 + 90) * 1000).toISOString(),
    });
    expect(b.tabela("messages")).toHaveLength(2);
    expect(b.tabela("conversations")[0]!.last_message_preview).toBe("Mensagem apagada pelo contato");
    // A trilha vai à auditoria, sem o corpo.
    expect(h.auditados).toHaveLength(1);
    expect(h.auditados[0]).toMatchObject({
      action: "message.revoked_in_channel",
      resourceId: "0a0b0c0d-7777-4777-8777-000000000001",
      metadata: { direction: "inbound", origem: "contato", conteudo_preservado: true },
    });
    expect(JSON.stringify(h.auditados)).not.toContain("plano mensal");
  });

  it("a reentrega não carimba de novo nem grava outra trilha", async () => {
    const b = banco();
    await aplicar(b, apagarDoCliente("wamid.revoke.1", T0 + 90));
    expect(await aplicar(b, apagarDoCliente("wamid.revoke.1", T0 + 90))).toEqual(["sem_mudanca"]);
    expect(h.auditados).toHaveLength(1);
    expect(msg(b, RECEBIDA).revoked_at).toBe(new Date((T0 + 90) * 1000).toISOString());
  });

  it("a mensagem apagada não é editada depois", async () => {
    const b = banco();
    await aplicar(b, apagarDoCliente("wamid.revoke.1", T0 + 90));
    expect(await aplicar(b, edicaoDoCliente("wamid.edit.tarde", T0 + 200, "Texto novo"))).toEqual(["sem_mudanca"]);
    expect(msg(b, RECEBIDA).body).toBe("Quero o plano mensal");
  });

  it("o dono apagou pelo app: a da empresa é carimbada e a prévia da conversa fica", async () => {
    const b = banco();
    const r = await aplicar(
      b,
      ecos({
        from: "5531900000001",
        to: ANA,
        id: "wamid.eco.revoke",
        timestamp: String(T0 + 30),
        type: "revoke",
        revoke: { original_message_id: ENVIADA_PELO_APP },
      }),
    );
    expect(r).toEqual(["apagada"]);
    expect(msg(b, ENVIADA_PELO_APP).revoked_at).toBe(new Date((T0 + 30) * 1000).toISOString());
    expect(b.tabela("conversations")[0]!.last_message_preview).toBe("Quero o plano mensal");
    expect(h.auditados[0]).toMatchObject({ metadata: { direction: "outbound", origem: "app_whatsapp_business" } });
  });

  it("sem a original: `sem_alvo`, sem trilha", async () => {
    const b = banco();
    expect(await aplicar(b, apagarDoCliente("wamid.revoke.2", T0, "wamid.que.nao.existe"))).toEqual(["sem_alvo"]);
    expect(h.auditados).toHaveLength(0);
  });
});

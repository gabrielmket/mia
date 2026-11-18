import { describe, expect, it } from "vitest";

import { chaveDoLote, lerHistorico } from "@/lib/channels/meta/coexistencia/historico";
import {
  direcaoDaMensagemDoHistorico,
  mapearMensagemDoHistorico,
  type ContextoDaMensagemDoHistorico,
} from "@/lib/channels/meta/coexistencia/mapear";

/**
 * FORK MIA · coexistência (S2): a leitura do campo `history` e o mapeamento da
 * mensagem do histórico para a linha de `messages`.
 *
 * As fixtures seguem a forma da referência da Meta (webhooks/reference/history,
 * lida em 17/11/2026), com dado fictício: Academia Alfa, número da empresa
 * +55 31 900000001, cliente Ana Exemplo em +55 31 900000002.
 */
const EMPRESA = "5531900000001";
const ANA = "5531900000002";
const AGORA = Date.parse("2026-11-17T12:00:00Z");
const DIA = 86_400;
const SEG = Math.floor(AGORA / 1000);

function valor(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "+55 31 90000-0001", phone_number_id: "pn-academia-alfa" },
    ...extra,
  };
}

const CTX: ContextoDaMensagemDoHistorico = {
  organizationId: "org",
  channelSessionId: "sessao",
  contactId: "contato",
  conversationId: "conversa",
  loteId: "lote-1",
  numeroDaEmpresa: EMPRESA,
  waIdDoCliente: ANA,
  recebidoEm: AGORA,
};

describe("lerHistorico", () => {
  it("o lote vira leitura com fase, ordem, progresso e o número da empresa só em dígitos", () => {
    const item = {
      metadata: { phase: 1, chunk_order: 3, progress: 55 },
      threads: [{ id: ANA, context: { wa_id: ANA }, messages: [] }],
    };
    const [l] = lerHistorico("history", "waba-alfa", valor({ history: [item] }));
    expect(l).toMatchObject({
      tipo: "lote",
      wabaId: "waba-alfa",
      phoneNumberId: "pn-academia-alfa",
      numeroDaEmpresa: EMPRESA,
      fase: 1,
      ordem: 3,
      progresso: 55,
    });
    expect(chaveDoLote(l as never)).toBe("f1:o3");
  });

  it("o erro 2593109 (o dono desligou o compartilhamento) vira erro com código e título", () => {
    const [l] = lerHistorico(
      "history",
      "waba-alfa",
      valor({
        history: [
          {
            errors: [
              {
                code: 2593109,
                title: "History sync is turned off by the business from the WhatsApp Business App",
                message: "x",
                error_data: { details: "y" },
              },
            ],
          },
        ],
      }),
    );
    expect(l).toMatchObject({ tipo: "erro", codigo: "2593109" });
    expect((l as { titulo: string }).titulo).toContain("History sync is turned off");
  });

  it("a mídia à parte (messages direto no value) vira leitura de mídia com o wamid", () => {
    const [l] = lerHistorico(
      "history",
      "waba-alfa",
      valor({ messages: [{ id: "wamid.A1", from: ANA, timestamp: String(SEG), type: "image", image: { id: "m1" } }] }),
    );
    expect(l).toMatchObject({ tipo: "midia", externalId: "wamid.A1" });
    expect(chaveDoLote(l as never)).toBe("midia:wamid.A1");
  });

  it("outro campo, lote sem fase ou sem ordem e value sem phone_number_id ficam de fora", () => {
    expect(lerHistorico("messages", "w", valor({ history: [{ metadata: { phase: 0, chunk_order: 1 } }] }))).toEqual([]);
    expect(lerHistorico("history", "w", valor({ history: [{ metadata: { phase: 0 } }] }))).toEqual([]);
    expect(lerHistorico("history", "w", valor({ history: [{ metadata: { phase: 7, chunk_order: 1 } }] }))).toEqual([]);
    expect(lerHistorico("history", "w", { history: [{ metadata: { phase: 0, chunk_order: 1 } }] })).toEqual([]);
    // Forma inesperada não lança.
    expect(lerHistorico("history", "w", valor({ history: "x", messages: 3 }))).toEqual([]);
  });
});

describe("mapearMensagemDoHistorico", () => {
  it("⭐ toda linha leva a chave da 0760 como TEXTO 'true', a origem e o lote", () => {
    const l = mapearMensagemDoHistorico(
      { id: "wamid.1", from: ANA, from_user_id: "BR.1", timestamp: String(SEG - DIA), type: "text", text: { body: "Oi" } },
      CTX,
    );
    expect(l?.metadata).toEqual({
      historico_importado: "true",
      historico_origem: "coexistencia",
      coexistencia_lote_id: "lote-1",
    });
    expect(l).toMatchObject({
      external_id: "wamid.1",
      direction: "inbound",
      type: "text",
      body: "Oi",
      status: "delivered",
      sent_via: "external_device",
      sent_at: new Date((SEG - DIA) * 1000).toISOString(),
    });
  });

  it("a saída é a mensagem cujo `from` é o número da empresa, e o status vem do history_context", () => {
    const l = mapearMensagemDoHistorico(
      {
        id: "wamid.2",
        from: EMPRESA,
        timestamp: String(SEG),
        type: "text",
        text: { body: "Bom dia" },
        history_context: { status: "READ" },
      },
      CTX,
    );
    expect(l).toMatchObject({ direction: "outbound", status: "read" });
  });

  it("sem o número da empresa, quem não é o cliente da thread é a empresa", () => {
    expect(direcaoDaMensagemDoHistorico({ from: EMPRESA }, null, ANA)).toBe("outbound");
    expect(direcaoDaMensagemDoHistorico({ from: ANA }, null, ANA)).toBe("inbound");
    // `from` some quando o número do cliente não está disponível.
    expect(direcaoDaMensagemDoHistorico({}, EMPRESA, ANA)).toBe("inbound");
  });

  it("o marcador de mídia dos últimos 14 dias fica pendente; o mais velho já nasce indisponível", () => {
    const recente = mapearMensagemDoHistorico(
      { id: "wamid.3", from: ANA, timestamp: String(SEG - 2 * DIA), type: "media_placeholder" },
      CTX,
    );
    expect(recente).toMatchObject({ type: "text", body: null });
    expect(recente?.metadata).toMatchObject({ meta_media_placeholder: "true", media_status: "pendente" });
    const velho = mapearMensagemDoHistorico(
      { id: "wamid.4", from: ANA, timestamp: String(SEG - 30 * DIA), type: "media_placeholder" },
      CTX,
    );
    expect(velho?.metadata).toMatchObject({ media_status: "indisponivel" });
  });

  it("mídia com id usa o mesmo ponteiro opaco da ingestão ao vivo", () => {
    const l = mapearMensagemDoHistorico(
      {
        id: "wamid.5",
        from: ANA,
        timestamp: String(SEG),
        type: "image",
        image: { id: "midia-9", mime_type: "image/jpeg", caption: "Foto" },
      },
      CTX,
    );
    expect(l).toMatchObject({ type: "image", body: "Foto", media_url: "meta-media:midia-9", media_mime: "image/jpeg" });
    expect(l?.metadata).toMatchObject({ meta_media_id: "midia-9", historico_importado: "true" });
  });

  it("o que não é conversa, ou vem sem id ou sem hora, não vira linha", () => {
    for (const tipo of ["reaction", "edit", "revoke", "unsupported", "system", ""]) {
      expect(mapearMensagemDoHistorico({ id: "w", from: ANA, timestamp: String(SEG), type: tipo }, CTX), tipo).toBeNull();
    }
    expect(mapearMensagemDoHistorico({ from: ANA, timestamp: String(SEG), type: "text" }, CTX)).toBeNull();
    expect(mapearMensagemDoHistorico({ id: "w", from: ANA, type: "text" }, CTX)).toBeNull();
  });

  it("clique de botão e cartão de contato entram nos tipos que o CHECK de messages aceita", () => {
    expect(
      mapearMensagemDoHistorico(
        { id: "w1", from: ANA, timestamp: String(SEG), type: "button", button: { text: "Quero agendar" } },
        CTX,
      ),
    ).toMatchObject({ type: "text", body: "Quero agendar" });
    expect(
      mapearMensagemDoHistorico(
        { id: "w2", from: ANA, timestamp: String(SEG), type: "contacts", contacts: [{ name: { formatted_name: "Bruno Teste" } }] },
        CTX,
      ),
    ).toMatchObject({ type: "contact", body: "Bruno Teste" });
  });
});

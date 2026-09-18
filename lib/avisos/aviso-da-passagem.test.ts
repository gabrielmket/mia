import { describe, expect, it, vi } from "vitest";

const enviados = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const falhar = vi.hoisted(() => ({ valor: false }));

/**
 * Dublê SÓ do envio — o resto de `@/lib/channels` é o de verdade, para que a
 * pergunta "este canal entrega em grupo?" continue sendo respondida pela matriz
 * e não por este arquivo.
 */
vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      if (falhar.valor) throw new Error("transporte fora do ar");
      enviados.push(envelope);
      return { externalId: "msg-1" };
    },
  }),
}));

import { CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";

import { avisarGrupoDaPassagemPg, textoDaPassagem } from "./aviso-da-passagem";

/**
 * O AVISO QUE CHAMA UMA PESSOA DE VERDADE.
 *
 * A passagem de bastão já registrava (Central, fila, timeline). Registro serve
 * a quem está com a tela aberta — e o time comercial do cliente não está: ele
 * trabalha no grupo do WhatsApp. Este é o único caminho do sistema que sai da
 * tela e vai atrás de alguém, e ele falha do jeito mais silencioso que existe:
 * ninguém reclama de um recado que não chegou, o lead só esfria.
 *
 *     npx vitest run lib/avisos/aviso-da-passagem.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const GRUPO = "120363405136320907@g.us";
const CONVERSA = "cccccccc-0000-4000-8000-00000000000c";

function bancoCom(sessao: unknown, settings: unknown) {
  return {
    query: async <T>(texto: string): Promise<{ rows: T[] }> => {
      if (texto.includes("channel_sessions")) return { rows: (sessao ? [sessao] : []) as T[] };
      if (texto.includes("organizations")) return { rows: [{ settings }] as T[] };
      return { rows: [] };
    },
  };
}

const numeroDaPlataforma = {
  provider: CHANNEL_PROVIDER_WAHA,
  waha_session_name: "plataforma_avisos",
};
const comGrupo = { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } };

describe("o texto do aviso", () => {
  it("leva nome, telefone, motivo e o caminho para a conversa", () => {
    const t = textoDaPassagem({
      organizationId: ORG,
      conversationId: CONVERSA,
      nome: "Joana",
      telefone: "+5531999998888",
      motivo: "requested_human",
      resumo: "Quer orçamento para 12 unidades.",
    });

    expect(t).toContain("Joana");
    expect(t).toContain("+5531999998888");
    expect(
      t,
      "o vocabulário do motor saiu cru para quem vende: \"requested_human\" obriga o time a adivinhar, e adivinhar duas vezes ensina a ignorar o aviso",
    ).toContain("pediu para falar com uma pessoa");
    expect(
      t,
      "sem o link, quem lê sabe que alguém espera e não sabe ONDE — e vai procurar por nome numa lista",
    ).toContain(CONVERSA);
  });

  it("corta resumo quilométrico em vez de despejar parede de texto no grupo", () => {
    const t = textoDaPassagem({
      organizationId: ORG,
      conversationId: null,
      nome: "Joana",
      telefone: null,
      motivo: "qualificado",
      resumo: "x".repeat(2000),
    });
    expect(t.length, "o grupo recebeu a conversa inteira colada").toBeLessThan(900);
    expect(t).toContain("…");
  });
});

describe("o envio pelo motor", () => {
  it("sai pelo número da plataforma, no grupo do cliente", async () => {
    enviados.length = 0;
    falhar.valor = false;
    const ok = await avisarGrupoDaPassagemPg(bancoCom(numeroDaPlataforma, comGrupo), {
      organizationId: ORG,
      conversationId: CONVERSA,
      nome: "Joana",
      telefone: "+5531999998888",
      motivo: "requested_human",
    });

    expect(ok).toBe(true);
    expect(enviados[0]!.to, "o recado não foi para o grupo configurado").toBe(GRUPO);
  });

  it("fica QUIETO quando o cliente não tem grupo — não é erro, é configuração", async () => {
    enviados.length = 0;
    const ok = await avisarGrupoDaPassagemPg(bancoCom(numeroDaPlataforma, {}), {
      organizationId: ORG,
      conversationId: CONVERSA,
      nome: "Joana",
      telefone: null,
      motivo: "requested_human",
    });

    expect(ok).toBe(false);
    expect(enviados, "mandou sem ter para onde").toHaveLength(0);
  });

  it("NÃO derruba a passagem quando o transporte cai", async () => {
    falhar.valor = true;
    const ok = await avisarGrupoDaPassagemPg(bancoCom(numeroDaPlataforma, comGrupo), {
      organizationId: ORG,
      conversationId: CONVERSA,
      nome: "Joana",
      telefone: null,
      motivo: "requested_human",
    });
    falhar.valor = false;

    expect(
      ok,
      "a exceção subiu: uma falha no recado do grupo abortaria a passagem de bastão, e aí o cliente fica com a IA calada e ninguém assume",
    ).toBe(false);
  });
});

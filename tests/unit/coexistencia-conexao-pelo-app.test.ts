import { describe, expect, it, vi } from "vitest";

import { estadoGeralDaSincronizacao } from "@/components/connections/coexistencia/estado-geral";
import { lerFimDaJanela } from "@/components/connections/coexistencia/sdk-da-meta";
import type { PedidoDaSincronizacaoNaTela } from "@/hooks/channels/useCoexistencia";
import { conectarPeloApp, digitosDoNumero, trocarCodigoPeloToken } from "@/lib/channels/meta/coexistencia/conectar";
import { configuracaoDaJanela, emitirNonceDaJanela, nonceDaJanelaConfere } from "@/lib/channels/meta/coexistencia/janela";
import { emitirEstadoDaVolta } from "@/lib/channels/estado-da-volta";

/**
 * FORK MIA · coexistência (S3): as peças da conexão pelo app que não precisam
 * de banco. O pedido único contra o banco é
 * `tests/invariants/coexistencia-pedido-unico.test.ts`.
 *
 * Dado fictício: Academia Alfa, +55 31 900000002.
 */
const SEGREDO = "segredo-de-teste-com-mais-de-16";
const ORG_ALFA = "c0e59164-0000-4000-8000-00000000000a";
const ORG_BETA = "c0e59164-0000-4000-8000-00000000000b";
const ANA = "c0e59164-1111-4000-8000-00000000000a";

describe("a janela da Meta só abre com o app configurado", () => {
  it("sem app_id ou config_id: diz o que falta, sem abrir", () => {
    expect(configuracaoDaJanela({})).toEqual({ ok: false, faltaNoAmbiente: ["META_APP_ID", "META_COEXISTENCIA_CONFIG_ID"] });
    expect(configuracaoDaJanela({ META_APP_ID: "123", META_COEXISTENCIA_CONFIG_ID: "  " })).toEqual({
      ok: false,
      faltaNoAmbiente: ["META_COEXISTENCIA_CONFIG_ID"],
    });
  });

  it("com os dois: devolve o que a tela precisa, com a versão da Graph", () => {
    const c = configuracaoDaJanela({ META_APP_ID: "123", META_COEXISTENCIA_CONFIG_ID: "456" });
    expect(c).toMatchObject({ ok: true, appId: "123", configId: "456" });
    expect(c.ok && c.graphVersion).toMatch(/^v\d+\.\d+$/);
  });
});

describe("o nonce da janela é preso à empresa e à pessoa", () => {
  const agora = new Date("2026-11-18T12:00:00Z");
  const nonce = emitirNonceDaJanela({ organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora });

  it("confere para a mesma empresa e pessoa, dentro de 10 minutos", () => {
    expect(nonceDaJanelaConfere(nonce, { organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora })).toBe(true);
  });

  it("recusa outra empresa (quem trocou de empresa no meio da janela)", () => {
    expect(nonceDaJanelaConfere(nonce, { organizationId: ORG_BETA, userId: ANA }, { segredo: SEGREDO, agora })).toBe(false);
  });

  it("recusa depois de 10 minutos", () => {
    const depois = new Date(agora.getTime() + 11 * 60 * 1000);
    expect(nonceDaJanelaConfere(nonce, { organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora: depois })).toBe(false);
  });

  it("recusa o estado da conexão por um clique (outra janela, mesmo formato)", () => {
    const outro = emitirEstadoDaVolta(
      { organizationId: ORG_ALFA, userId: ANA, profileId: "perfil-do-parceiro" },
      { segredo: SEGREDO, agora },
    );
    expect(nonceDaJanelaConfere(outro, { organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora })).toBe(false);
  });

  it("recusa lixo sem lançar", () => {
    expect(nonceDaJanelaConfere("nao-e-nonce", { organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora })).toBe(false);
    expect(nonceDaJanelaConfere(null, { organizationId: ORG_ALFA, userId: ANA }, { segredo: SEGREDO, agora })).toBe(false);
  });
});

describe("o fim da janela pelo app (postMessage da Meta)", () => {
  const FIM = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    data: { waba_id: "1234567890" },
  };

  it("lê a conta e o número quando vem da Meta", () => {
    expect(lerFimDaJanela("https://www.facebook.com", FIM)).toEqual({ wabaId: "1234567890", phoneNumberId: null });
    expect(
      lerFimDaJanela("https://web.facebook.com", JSON.stringify({ ...FIM, data: { waba_id: "1", phone_number_id: "2" } })),
    ).toEqual({ wabaId: "1", phoneNumberId: "2" });
  });

  it("ignora o que não vem da Meta, mesmo com o mesmo formato", () => {
    expect(lerFimDaJanela("https://facebook.com.exemplo.com", FIM)).toBeNull();
    expect(lerFimDaJanela("http://www.facebook.com", FIM)).toBeNull();
    expect(lerFimDaJanela("https://app.exemplo.com", FIM)).toBeNull();
  });

  it("a janela fechada pelo cliente é cancelamento; outro evento é ignorado", () => {
    expect(lerFimDaJanela("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} })).toBe("cancelada");
    expect(lerFimDaJanela("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "1" } })).toBeNull();
    expect(lerFimDaJanela("https://www.facebook.com", "{quebrado")).toBeNull();
  });
});

describe("a troca do código pelo token", () => {
  it("devolve o token e manda o código e o app à Meta", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "EAAficticio", token_type: "bearer" })));
    const token = await trocarCodigoPeloToken({ code: "codigo-1", appId: "app-1", appSecret: "segredo-1", fetch: f as unknown as typeof fetch });
    expect(token).toBe("EAAficticio");
    const url = new URL(String((f.mock.calls[0] as unknown as [string])[0]));
    expect(url.pathname).toMatch(/\/oauth\/access_token$/);
    expect(url.searchParams.get("code")).toBe("codigo-1");
    expect(url.searchParams.get("client_id")).toBe("app-1");
  });

  it("recusa da Meta ou rede caída: null, sem ecoar nada", async () => {
    const recusa = vi.fn(async () => new Response(JSON.stringify({ error: { message: "code already used" } }), { status: 400 }));
    expect(await trocarCodigoPeloToken({ code: "c", appId: "a", appSecret: "s", fetch: recusa as unknown as typeof fetch })).toBeNull();
    const caiu = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await trocarCodigoPeloToken({ code: "c", appId: "a", appSecret: "s", fetch: caiu as unknown as typeof fetch })).toBeNull();
  });
});

describe("a conexão recusa a empresa com a chave desligada", () => {
  it("chave desligada: recusa antes de falar com a Meta", async () => {
    const f = vi.fn();
    // Só a leitura da chave responde: sem linha = desligada.
    const admin = {
      from: (tabela: string) => {
        if (tabela !== "mia_coexistencia_da_empresa") throw new Error(`não devia ler ${tabela}`);
        const cadeia = {
          select: () => cadeia,
          eq: () => cadeia,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return cadeia;
      },
    };
    const r = await conectarPeloApp(
      admin as never,
      {
        organizationId: ORG_ALFA,
        userId: ANA,
        code: "codigo",
        wabaId: "1234567890",
        baseDoWebhook: "https://app.exemplo.com",
        requestId: "teste",
      },
      { fetch: f as unknown as typeof fetch },
    );
    expect(r).toEqual({ ok: false, motivo: "chave_desligada" });
    expect(f).not.toHaveBeenCalled();
  });

  it("só os dígitos do número: o oficial grava +55 e o QR grava 55", () => {
    expect(digitosDoNumero("+55 31 90000-0002")).toBe("5531900000002");
    expect(digitosDoNumero(null)).toBe("");
  });
});

describe("o estado que a tela mostra", () => {
  const pedido = (tipo: "contatos" | "historico", estado: string): PedidoDaSincronizacaoNaTela => ({
    id: `${tipo}-${estado}`,
    tipo,
    estado,
    pedidaEm: null,
    respondidaEm: null,
    concluidaEm: null,
    erroCodigo: null,
    erroTitulo: null,
    progresso: null,
    fase: null,
    contatosRecebidos: 0,
    conversasRecebidas: 0,
    mensagensRecebidas: 0,
    mensagensExistentes: 0,
    midiasGuardadas: 0,
    lotesComFalha: 0,
  });

  it.each([
    [[pedido("contatos", "pedida"), pedido("historico", "pedida")], "pedida"],
    [[pedido("contatos", "em_andamento"), pedido("historico", "pedida")], "andamento"],
    [[pedido("contatos", "concluida"), pedido("historico", "concluida")], "concluida"],
    [[pedido("contatos", "pedida"), pedido("historico", "falhou")], "falhou"],
    [[pedido("contatos", "em_andamento"), pedido("historico", "recusada_pelo_dono")], "recusou"],
    [[pedido("contatos", "sem_resposta"), pedido("historico", "sem_resposta")], "incerto"],
    [[pedido("contatos", "prazo_vencido"), pedido("historico", "prazo_vencido")], "prazo"],
    [[], "pedida"],
  ] as const)("%j → %s", (pedidos, esperado) => {
    expect(estadoGeralDaSincronizacao(pedidos)).toBe(esperado);
  });
});

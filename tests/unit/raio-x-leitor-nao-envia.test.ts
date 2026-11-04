/**
 * FORK MIA (.101) · O LEITOR DO RAIO-X NÃO TEM COMO ENVIAR (decisão 3).
 *
 * A promessa do termo ("nenhuma mensagem é enviada do seu número") é provada em
 * três camadas, cada uma num `describe`:
 *
 *  1. a SUPERFÍCIE: o objeto que `criarLeitor` devolve só tem os oito métodos
 *     de leitura, pareamento, estado e desconexão. Nenhum nome de envio, visto,
 *     presença, reação ou edição;
 *  2. a LISTA FECHADA: `rotaPermitida` recusa todo endpoint de envio do canal
 *     (texto, mídia, visto, presença, reação, edição, apagar, o PUT da sessão);
 *  3. o FIO: com um `fetch` dublê que grava cada pedido, nenhuma operação do
 *     leitor sai por um caminho fora da lista, e a sessão nasce com o acervo
 *     ligado, `markOnline: false` e sem webhook.
 *
 * E a fonte: o arquivo não importa o cliente do upstream que tem os envios.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { criarLeitor, rotaPermitida } from "@/lib/channels/raio-x/leitor";

const FONTE = readFileSync(join(process.cwd(), "lib", "channels", "raio-x", "leitor.ts"), "utf8");

interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/** Um leitor de mentira que grava os pedidos e responde como o contêiner. */
function dubleDoLeitor() {
  const pedidos: Pedido[] = [];
  let sessao: Record<string, unknown> | null = null;
  const fetchDuble = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = (init?.method ?? "GET").toUpperCase();
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ metodo, caminho: u.pathname, corpo });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/sessions" && metodo === "POST") {
      sessao = { name: corpo.name, status: "STOPPED", config: corpo.config, me: null };
      return json(201, sessao);
    }
    if (/^\/api\/sessions\/[^/]+$/.test(u.pathname) && metodo === "GET") return sessao ? json(200, sessao) : json(404, {});
    if (/\/start$/.test(u.pathname)) {
      sessao = { ...sessao, status: "SCAN_QR_CODE" };
      return json(201, sessao);
    }
    if (/\/auth\/request-code$/.test(u.pathname)) return json(200, { code: "K7PQ2M9X" });
    if (/\/auth\/qr$/.test(u.pathname)) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
    if (/\/chats$/.test(u.pathname)) return json(200, [{ id: "5531900000002@c.us" }, { id: "120363000000000000@g.us" }, { id: "status@broadcast" }]);
    if (/\/messages$/.test(u.pathname)) {
      return json(200, [
        { id: "false_5531900000002@c.us_AAA1", from: "5531900000002@c.us", fromMe: false, timestamp: 1_762_000_000, body: "Oi, ainda tem o Polo?", _data: { notifyName: "Ricardo Exemplo" } },
        { id: "true_5531900000002@c.us_AAA2", from: "5531900001101@c.us", fromMe: true, timestamp: 1_762_000_600, body: "Tem sim!" },
      ]);
    }
    if (/\/logout$/.test(u.pathname)) return json(201, {});
    if (metodo === "DELETE") {
      sessao = null;
      return json(200, {});
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { pedidos, fetchDuble };
}

describe("1. a superfície: só leitura, pareamento, estado e desconexão", () => {
  it("o leitor tem exatamente os oito métodos", () => {
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", (async () => new Response("{}")) as unknown as typeof fetch);
    expect(Object.keys(leitor).sort()).toEqual(
      ["baixarAudio", "desconectar", "estado", "paginaDeConversas", "paginaDeMensagens", "pedirCodigo", "preparar", "qr"].sort(),
    );
    const proibido = /send|seen|presen|typing|react|reply|forward|edit|star|archive|pin|mark|read|delete(?!r)/i;
    expect(Object.keys(leitor).filter((k) => proibido.test(k))).toEqual([]);
  });
});

describe("2. a lista fechada recusa todo caminho de envio", () => {
  const ENVIOS: Array<[string, string]> = [
    ["POST", "/api/sendText"],
    ["POST", "/api/sendImage"],
    ["POST", "/api/sendFile"],
    ["POST", "/api/sendVoice"],
    ["POST", "/api/sendVideo"],
    ["POST", "/api/sendSeen"],
    ["POST", "/api/sendContactVcard"],
    ["POST", "/api/sendLocation"],
    ["POST", "/api/reply"],
    ["POST", "/api/startTyping"],
    ["POST", "/api/raiox_abc123def456/presence"],
    ["PUT", "/api/reaction"],
    ["PUT", "/api/raiox_abc123def456/chats/5531900000002%40c.us/messages/x"],
    ["DELETE", "/api/raiox_abc123def456/chats/5531900000002%40c.us/messages/x"],
    ["PUT", "/api/sessions/raiox_abc123def456"],
    ["POST", "/api/raiox_abc123def456/chats/5531900000002%40c.us/messages/read"],
    ["POST", "/api/raiox_abc123def456/status/text"],
  ];

  it.each(ENVIOS)("%s %s é recusado", (metodo, caminho) => {
    expect(rotaPermitida(metodo, caminho)).toBe(false);
  });

  it("CONTROLE: a leitura passa", () => {
    expect(rotaPermitida("GET", "/api/raiox_abc123def456/chats?limit=50")).toBe(true);
    expect(rotaPermitida("GET", "/api/raiox_abc123def456/chats/5531900000002%40c.us/messages")).toBe(true);
    expect(rotaPermitida("POST", "/api/raiox_abc123def456/auth/request-code")).toBe(true);
  });
});

describe("3. o fio: nenhum pedido fora da lista, e a sessão nasce do jeito certo", () => {
  it("o caminho inteiro (preparar, código, QR, conversas, mensagens, desconectar) só usa rotas permitidas", async () => {
    const { pedidos, fetchDuble } = dubleDoLeitor();
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", fetchDuble);
    const SESSAO = "raiox_0123456789abcdef";

    const preparado = await leitor.preparar(SESSAO);
    expect(preparado.estado).toBe("esperando_pareamento");
    expect(await leitor.pedirCodigo(SESSAO, "+55 31 900000002")).toBe("K7PQ-2M9X");
    expect(await leitor.qr(SESSAO)).toBeInstanceOf(Buffer);
    const conversas = await leitor.paginaDeConversas(SESSAO, { limit: 50, offset: 0 });
    // Grupo e status ficam de fora.
    expect(conversas.conversas.map((c) => c.chatId)).toEqual(["5531900000002@c.us"]);
    const msgs = await leitor.paginaDeMensagens(SESSAO, "5531900000002@c.us", { limit: 100, offset: 0, desde: 0 });
    expect(msgs.mensagens.map((m) => [m.daLoja, m.tipo, m.texto, m.nome])).toEqual([
      [false, "texto", "Oi, ainda tem o Polo?", "Ricardo Exemplo"],
      [true, "texto", "Tem sim!", null],
    ]);
    await leitor.desconectar(SESSAO);

    expect(pedidos.length).toBeGreaterThan(5);
    for (const p of pedidos) expect(rotaPermitida(p.metodo, p.caminho), `${p.metodo} ${p.caminho}`).toBe(true);
    expect(pedidos.some((p) => /send|seen|presence|typing|reaction/i.test(p.caminho))).toBe(false);

    const criacao = pedidos.find((p) => p.metodo === "POST" && p.caminho === "/api/sessions")!.corpo as {
      config: { noweb: { markOnline: boolean; store: { enabled: boolean; fullSync: boolean } }; webhooks: unknown[]; ignore: Record<string, boolean>; client: { deviceName: string } };
    };
    expect(criacao.config.noweb.markOnline).toBe(false);
    expect(criacao.config.noweb.store).toEqual({ enabled: true, fullSync: true });
    expect(criacao.config.webhooks).toEqual([]);
    expect(criacao.config.ignore).toMatchObject({ groups: true, status: true });
    expect(criacao.config.client.deviceName).toBe("Raio-X Time Company");
  });

  it("sessão que o contêiner criou sem o acervo ou com o 'online' é apagada e o pareamento recusado", async () => {
    const pedidos: Pedido[] = [];
    const fetchSemAcervo = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      pedidos.push({ metodo: (init?.method ?? "GET").toUpperCase(), caminho: u.pathname, corpo: null });
      return new Response(JSON.stringify({ name: "raiox_0123456789abcdef", status: "STOPPED", config: { noweb: { markOnline: true } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", fetchSemAcervo);
    await expect(leitor.preparar("raiox_0123456789abcdef")).rejects.toMatchObject({ codigo: "leitor_config_recusada" });
    expect(pedidos.some((p) => p.metodo === "DELETE")).toBe(true);
  });
});

describe("a fonte", () => {
  it("não importa o cliente do upstream (que tem os envios), só constantes e o esquema", () => {
    const doCliente = [...FONTE.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/waha\/client"/g)].map((m) => m[1]!.trim());
    expect(doCliente).toEqual(["ACERVO_DO_HISTORICO, CONVERSAS_IGNORADAS"]);
    expect(FONTE).not.toMatch(/getWahaClient\(|new WahaClient\(/);
    expect(FONTE).not.toMatch(/["'`]\/api\/send/);
    expect(FONTE).not.toMatch(/\/presence["'`]/);
  });
});

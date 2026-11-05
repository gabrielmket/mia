/**
 * FORK MIA (.103) · A CONEXÃO DO RAIO-X NÃO TRAVA.
 *
 * O primeiro raio-X de verdade (05/11/2026) travou na etapa de conectar por três
 * defeitos da .101, um em cada `describe`:
 *
 *  1. o CÓDIGO de 8 letras saía para o número com o nono dígito. A conta de
 *     celular de DDD 31 em diante fica registrada sem ele, e o WhatsApp do
 *     celular respondia "Não foi possível conectar o dispositivo";
 *  2. a SESSÃO que falhou (QR ou código vencido sem ninguém conectar) nunca
 *     voltava: `start` numa sessão FAILED responde 422 e ela ficava FAILED, sem
 *     QR nem código, para sempre;
 *  3. a CERCA da página contava os pedidos que a própria página repete (o
 *     andamento a cada 5 s, o QR a cada 20 s): com ~4 minutos de tela aberta o
 *     dono era barrado e o QR virava imagem quebrada.
 *
 * Números fictícios.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { criarLeitor, numeroDaContaDoWhatsapp, rotaPermitida } from "@/lib/channels/raio-x/leitor";
import { LIMITE_DA_PAGINA, LIMITE_DO_ANDAMENTO, ROTULO_DO_LIMITE_DA_PAGINA, ROTULO_DO_LIMITE_DO_ANDAMENTO } from "@/lib/raio-x/publico";

const SESSAO = "raiox_0123456789abcdef";
const CONFIG_CERTA = { noweb: { markOnline: false, store: { enabled: true, fullSync: true } } };

interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/**
 * Um contêiner de mentira que se comporta como o de verdade numa sessão FAILED:
 * `start` responde 422 e não muda nada; `stop` a deixa STOPPED, e aí `start` a
 * religa.
 */
function conteinerComSessaoQueFalhou(statusInicial: "FAILED" | "STOPPED" | "SCAN_QR_CODE" = "FAILED") {
  const pedidos: Pedido[] = [];
  let status: string = statusInicial;
  const fetchDuble = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = (init?.method ?? "GET").toUpperCase();
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ metodo, caminho: u.pathname, corpo });
    const json = (codigo: number, b: unknown) => new Response(JSON.stringify(b), { status: codigo, headers: { "content-type": "application/json" } });
    const sessao = () => ({ name: SESSAO, status, config: CONFIG_CERTA, me: null });
    if (/^\/api\/sessions\/[^/]+$/.test(u.pathname) && metodo === "GET") return json(200, sessao());
    if (/\/stop$/.test(u.pathname)) {
      status = "STOPPED";
      return json(201, sessao());
    }
    if (/\/start$/.test(u.pathname)) {
      if (status !== "STOPPED") return json(422, { message: `Session '${SESSAO}' is already started.` });
      status = "SCAN_QR_CODE";
      return json(201, sessao());
    }
    if (/\/auth\/request-code$/.test(u.pathname)) return json(200, { code: "K7PQ2M9X" });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { pedidos, fetchDuble, status: () => status };
}

describe("1. o código de 8 letras vai para o número da conta do WhatsApp", () => {
  it.each([
    ["5531984025321", "553184025321", "DDD 31: a conta fica sem o nono dígito"],
    ["5599991234567", "559991234567", "DDD 99: idem"],
    ["5511987654321", "5511987654321", "DDD 11: a conta fica COM o nono dígito"],
    ["5528999990000", "5528999990000", "DDD 28: o último que fica com ele"],
    ["553184025321", "553184025321", "já sem o 9: passa como veio"],
    ["553133334444", "553133334444", "fixo: passa como veio"],
    ["14155552671", "14155552671", "fora do Brasil: passa como veio"],
  ])("%s vira %s (%s)", (entrada, saida) => {
    expect(numeroDaContaDoWhatsapp(entrada)).toBe(saida);
  });

  it("o pedido do código ao contêiner sai sem o nono dígito no DDD 31", async () => {
    const c = conteinerComSessaoQueFalhou("SCAN_QR_CODE");
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", c.fetchDuble);
    expect(await leitor.pedirCodigo(SESSAO, "+5531900001101")).toBe("K7PQ-2M9X");
    const pedido = c.pedidos.find((p) => p.caminho.endsWith("/auth/request-code"));
    expect(pedido?.corpo).toEqual({ phoneNumber: "553100001101" });
  });
});

describe("2. a sessão que falhou é religada", () => {
  it("preparar uma sessão FAILED para e inicia: ela volta a esperar o pareamento", async () => {
    const c = conteinerComSessaoQueFalhou("FAILED");
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", c.fetchDuble);
    const preparado = await leitor.preparar(SESSAO);
    expect(preparado.estado).toBe("esperando_pareamento");
    const ordem = c.pedidos.filter((p) => p.metodo === "POST").map((p) => p.caminho.split("/").at(-1));
    expect(ordem).toEqual(["stop", "start"]);
    // Nada fora da lista fechada, e nada apagado: o pareamento e o acervo ficam.
    for (const p of c.pedidos) expect(rotaPermitida(p.metodo, p.caminho), `${p.metodo} ${p.caminho}`).toBe(true);
    expect(c.pedidos.some((p) => p.metodo === "DELETE")).toBe(false);
  });

  it("CONTROLE: a sessão parada só inicia, sem parar antes", async () => {
    const c = conteinerComSessaoQueFalhou("STOPPED");
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", c.fetchDuble);
    expect((await leitor.preparar(SESSAO)).estado).toBe("esperando_pareamento");
    expect(c.pedidos.filter((p) => p.metodo === "POST").map((p) => p.caminho.split("/").at(-1))).toEqual(["start"]);
  });

  it("CONTROLE: a sessão esperando o pareamento não é mexida", async () => {
    const c = conteinerComSessaoQueFalhou("SCAN_QR_CODE");
    const leitor = criarLeitor("http://leitor.teste:3000", "chave-de-teste", c.fetchDuble);
    expect((await leitor.preparar(SESSAO)).estado).toBe("esperando_pareamento");
    expect(c.pedidos.some((p) => p.metodo === "POST")).toBe(false);
  });

  it("parar entra na lista fechada; parar qualquer outra coisa, não", () => {
    expect(rotaPermitida("POST", `/api/sessions/${SESSAO}/stop`)).toBe(true);
    expect(rotaPermitida("POST", "/api/sessions/stop")).toBe(false);
    expect(rotaPermitida("POST", `/api/${SESSAO}/stop`)).toBe(false);
  });
});

describe("3. a cerca não barra a página que espera a conexão", () => {
  const fonte = (...partes: string[]) => readFileSync(join(process.cwd(), ...partes), "utf8");

  it("o andamento e o QR usam a cerca própria, que cabe duas abas abertas por 10 minutos", () => {
    // Uma aba: o andamento a cada 5 s (120) + o QR a cada 20 s (30) em 10 minutos.
    const porAba = (600 / 5 + 600 / 20) * (LIMITE_DO_ANDAMENTO.windowSec / 600);
    expect(LIMITE_DO_ANDAMENTO.ip).toBeGreaterThanOrEqual(2 * porAba);
    expect(ROTULO_DO_LIMITE_DO_ANDAMENTO).not.toBe(ROTULO_DO_LIMITE_DA_PAGINA);
    for (const rota of [["route.ts"], ["qr", "route.ts"]]) {
      const texto = fonte("app", "api", "v1", "publico", "raio-x", "[codigo]", ...rota);
      expect(texto).toMatch(/authRateLimited\(ROTULO_DO_LIMITE_DO_ANDAMENTO, null, LIMITE_DO_ANDAMENTO\)/);
      expect(texto).not.toMatch(/LIMITE_DA_PAGINA/);
    }
  });

  it("CONTROLE: abrir a página e autorizar continuam na cerca da página", () => {
    expect(LIMITE_DA_PAGINA.ip).toBe(60);
    for (const caminho of [["app", "raio-x", "[codigo]", "page.tsx"], ["app", "api", "v1", "publico", "raio-x", "[codigo]", "aceite", "route.ts"]]) {
      expect(fonte(...caminho)).toMatch(/authRateLimited\(ROTULO_DO_LIMITE_DA_PAGINA, null, LIMITE_DA_PAGINA\)/);
    }
  });

  it("a página mostra 'Preparando o QR' em vez da imagem quebrada, e tenta de novo", () => {
    const texto = fonte("components", "raio-x", "ConexaoDoDono.tsx");
    expect(texto).toMatch(/onError=\{\(\) => \{\s*setQrPreparando\(true\);\s*window\.setTimeout\(\(\) => setRodadaDoQr/);
    expect(texto).toContain('t("Preparando o QR… ele aparece em alguns segundos.")');
  });
});

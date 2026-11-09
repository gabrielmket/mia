/**
 * E2E [P0] FORK MIA (.107): o RAIO-X GRÁTIS POR CADASTRO pelo navegador
 * (docs/fork/raio-x-do-atendimento.md, seção 16). Dado fictício, nenhum
 * WhatsApp nem e-mail de verdade:
 *
 *  - o LEITOR do raio-X é o dublê HTTP da spec do raio-X (porta 3994,
 *    `RAIO_X_LEITOR_URL` do .env.e2e), que grava os pedidos;
 *  - o E-MAIL sai pelo caminho de sempre da instalação (o SMTP da tela,
 *    `platform_smtp_settings`), apontado para um dublê de SMTP que esta spec
 *    sobe na porta 3993. É dele que a spec lê o código de 6 números.
 *
 *   1. a pessoa preenche o formulário de /raio-x/gratis (sem login) e cai na
 *      página de conexão do raio-X, já na etapa de conectar (o aceite foi no
 *      cadastro); o leitor recebeu o pedido de sessão;
 *   2. o leitor "conecta" e o relatório sai (montado das conversas fictícias
 *      fixas, como na spec do raio-X), revisado como o ciclo do cadastro grava;
 *   3. a pessoa entra em /raio-x/entrar com o e-mail e o código do e-mail;
 *   4. a área mostra o raio-X grátis e abre o relatório.
 *
 * Self-contida: tudo morre no `finally` (e o SMTP da instalação volta ao que era).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as criarServidorTcp, type Server as ServidorTcp } from "node:net";

import { montarRelatorio } from "@/lib/raio-x/relatorio";

import { FIM_DA_GARAGEM, INICIO_DA_GARAGEM, conversasDaGaragemModelo } from "../fixtures/raio-x/garagem-modelo";
import { db, inserir } from "./helpers/cobranca";
import { expect, test } from "./helpers/test";

const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/raio-x-por-cadastro";
const EMPRESA = `Garagem Modelo Veículos ${sufixo}`;
const EMAIL = `ricardo-${sufixo}@garagemmodelo.com.br`;
const PORTA_DO_LEITOR = 3994;
const PORTA_DO_SMTP = 3993;

/** O dublê do contêiner do leitor (o mesmo jeito da spec do raio-X). */
function subirLeitor(): Promise<{ servidor: Server; pedidos: Array<{ metodo: string; caminho: string }> }> {
  const pedidos: Array<{ metodo: string; caminho: string }> = [];
  const sessoes = new Map<string, Record<string, unknown>>();
  const servidor = createServer((req, res) => {
    let bruto = "";
    req.on("data", (c) => (bruto += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://leitor");
      const corpo = bruto ? (JSON.parse(bruto) as Record<string, unknown>) : null;
      pedidos.push({ metodo: req.method ?? "GET", caminho: url.pathname });
      const json = (status: number, b: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(b));
      };
      const m = /^\/api\/sessions\/([^/]+)(\/start|\/logout)?$/.exec(url.pathname);
      if (req.method === "POST" && url.pathname === "/api/sessions") {
        const nome = String(corpo?.name);
        sessoes.set(nome, { name: nome, status: "STOPPED", config: corpo?.config, me: null });
        return json(201, sessoes.get(nome));
      }
      if (m) {
        const nome = decodeURIComponent(m[1]!);
        const s = sessoes.get(nome);
        if (req.method === "GET" && !m[2]) return s ? json(200, s) : json(404, { statusCode: 404, error: "Not Found", message: "Session not found" });
        if (req.method === "POST" && m[2] === "/start" && s) {
          s.status = "SCAN_QR_CODE";
          return json(201, s);
        }
        if (req.method === "POST" && m[2] === "/logout") return json(201, {});
        if (req.method === "DELETE") {
          sessoes.delete(nome);
          return json(200, {});
        }
      }
      if (req.method === "POST" && /\/auth\/request-code$/.test(url.pathname)) return json(200, { code: "K7PQ2M9X" });
      return json(404, {});
    });
  });
  return new Promise((ok) => servidor.listen(PORTA_DO_LEITOR, "127.0.0.1", () => ok({ servidor, pedidos })));
}

/** Um SMTP de mentira, o mínimo do protocolo: guarda cada mensagem recebida. */
function subirSmtp(): Promise<{ servidor: ServidorTcp; mensagens: Array<{ para: string; corpo: string }> }> {
  const mensagens: Array<{ para: string; corpo: string }> = [];
  const servidor = criarServidorTcp((socket) => {
    let buffer = "";
    let emDados = false;
    let para = "";
    socket.write("220 smtp-de-teste ESMTP\r\n");
    socket.on("data", (pedaco) => {
      buffer += pedaco.toString("utf8");
      for (;;) {
        if (emDados) {
          const fim = buffer.indexOf("\r\n.\r\n");
          if (fim < 0) return;
          mensagens.push({ para, corpo: buffer.slice(0, fim) });
          buffer = buffer.slice(fim + 5);
          emDados = false;
          socket.write("250 OK\r\n");
          continue;
        }
        const quebra = buffer.indexOf("\r\n");
        if (quebra < 0) return;
        const linha = buffer.slice(0, quebra);
        buffer = buffer.slice(quebra + 2);
        const comando = linha.slice(0, 4).toUpperCase();
        if (comando === "EHLO" || comando === "HELO") socket.write("250 smtp-de-teste\r\n");
        else if (comando === "MAIL") socket.write("250 OK\r\n");
        else if (comando === "RCPT") {
          para = /<([^>]+)>/.exec(linha)?.[1] ?? "";
          socket.write("250 OK\r\n");
        } else if (comando === "DATA") {
          emDados = true;
          socket.write("354 manda\r\n");
        } else if (comando === "QUIT") {
          socket.write("221 tchau\r\n");
          socket.end();
          return;
        } else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((ok) => servidor.listen(PORTA_DO_SMTP, "127.0.0.1", () => ok({ servidor, mensagens })));
}

/**
 * O texto da mensagem, sem a codificação que o nodemailer escolher: o
 * quoted-printable (o normal para texto em português) e, por garantia, as
 * partes em base64.
 */
function decodificar(corpo: string): string {
  const semQuebra = corpo.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < semQuebra.length; i += 1) {
    const hex = /^=([0-9A-F]{2})/.exec(semQuebra.slice(i, i + 3));
    if (hex) {
      bytes.push(Number.parseInt(hex[1]!, 16));
      i += 2;
    } else bytes.push(...Buffer.from(semQuebra[i]!, "utf8"));
  }
  const qp = Buffer.from(bytes).toString("utf8");
  const partes64 = [...corpo.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/gi)].map((m) =>
    Buffer.from(m[1]!.replace(/\s+/g, ""), "base64").toString("utf8"),
  );
  return [qp, ...partes64].join("\n");
}

test("[P0] raio-X grátis por cadastro: o formulário, a conexão, o código no e-mail e a área", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(EVIDENCIA, { recursive: true });
  const { servidor, pedidos } = await subirLeitor();
  const { servidor: smtp, mensagens } = await subirSmtp();
  const errosDePagina: string[] = [];
  page.on("pageerror", (e) => errosDePagina.push(e.message));
  const smtpAntes = (await db.from("platform_smtp_settings").select("*").eq("id", 1).maybeSingle()).data as Record<string, unknown> | null;
  let raioXId: string | null = null;
  let contaId: string | null = null;

  try {
    // ── 0. O e-mail da instalação sai pelo dublê de SMTP ────────────────
    const smtpDeTeste = { id: 1, smtp_host: "127.0.0.1", smtp_port: PORTA_DO_SMTP, smtp_security: "none", smtp_username: null, smtp_password_encrypted: null, from_email: "naoresponda@iamia.com.br", from_name: "MIA" };
    const gravouSmtp = smtpAntes
      ? await db.from("platform_smtp_settings").update(smtpDeTeste).eq("id", 1)
      : await db.from("platform_smtp_settings").insert(smtpDeTeste);
    if (gravouSmtp.error) throw gravouSmtp.error;

    // ── 1. O cadastro pelo formulário, sem login ────────────────────────
    await page.goto("/raio-x/gratis?utm_source=e2e");
    await expect(page.getByRole("heading", { name: "Raio-X do seu atendimento no WhatsApp, grátis" })).toBeVisible();
    await page.locator("#raio-x-nome").fill("Ricardo Exemplo");
    await page.locator("#raio-x-email").fill(EMAIL);
    await page.locator("#raio-x-telefone").fill("(31) 90000-2202");
    await page.locator("#raio-x-whatsapp").fill("(31) 90000-1106");
    await page.locator("#raio-x-empresa").fill(EMPRESA);
    await page.locator("#raio-x-segmento").selectOption("revenda_de_veiculos");
    await page.locator('[data-raio-x="aceite"]').check();
    await page.screenshot({ path: `${EVIDENCIA}/1-cadastro.png`, fullPage: true });
    await page.locator('[data-raio-x="cadastrar"]').click();

    // A página de conexão abre direto em "conectar" (o aceite foi no cadastro).
    await page.waitForURL(/\/raio-x\/[0-9A-Z]{8}$/);
    await expect(page.locator('[data-raio-x-etapa="conectar"]')).toBeVisible();
    const criado = await db.from("mia_raio_x").select("id, situacao, origem, gratis, conta_id, whatsapp, sessao, criado_via, teto_centavos, periodo_dias").eq("empresa", EMPRESA).single();
    if (criado.error) throw criado.error;
    const rx = criado.data as Record<string, unknown>;
    raioXId = rx.id as string;
    contaId = rx.conta_id as string;
    expect(rx).toMatchObject({ situacao: "conectando", origem: "cadastro", gratis: true, whatsapp: "5531900001106", criado_via: "cadastro", teto_centavos: 1000, periodo_dias: 30 });
    expect(pedidos.some((p) => p.metodo === "POST" && p.caminho === "/api/sessions")).toBe(true);
    const aceite = await db.from("mia_raio_x_aceites").select("nome, email, termo_versao").eq("raio_x_id", raioXId).single();
    expect(aceite.data).toMatchObject({ nome: "Ricardo Exemplo", email: EMAIL, termo_versao: "v1" });
    // Sem RAIO_X_FONTE_DO_CRM no e2e: o cadastro não quebra, a conta fica marcada.
    expect((await db.from("mia_raio_x_contas").select("crm_erro").eq("id", contaId).single()).data).toMatchObject({ crm_erro: "sem_fonte" });
    // O e-mail "começou" chegou com o link de conexão.
    await expect.poll(() => mensagens.filter((m) => m.para === EMAIL).length, { message: "o e-mail do começo não chegou" }).toBeGreaterThan(0);
    expect(decodificar(mensagens.find((m) => m.para === EMAIL)!.corpo)).toContain(new URL(page.url()).pathname);
    await page.screenshot({ path: `${EVIDENCIA}/2-conectar.png`, fullPage: true });

    // ── 2. O leitor conecta e o relatório sai (revisado, como o ciclo do cadastro grava) ─
    const dados = montarRelatorio({
      empresa: EMPRESA,
      segmento: "revenda_de_veiculos",
      tipo: "unico",
      periodo: { inicio: INICIO_DA_GARAGEM, fim: FIM_DA_GARAGEM },
      conversas: conversasDaGaragemModelo(),
    });
    await inserir("mia_raio_x_relatorios", {
      raio_x_id: raioXId,
      sequencia: 1,
      periodo_inicio: INICIO_DA_GARAGEM.toISOString(),
      periodo_fim: FIM_DA_GARAGEM.toISOString(),
      criterios_versao: dados.criteriosVersao,
      dados,
      parcial: dados.analise.parcial,
      conversas: dados.numeros.conversas,
      situacao: "revisado",
      revisado_em: new Date().toISOString(),
      notas_da_time: "automático: cadastro",
    });
    const pronto = await db
      .from("mia_raio_x")
      .update({ situacao: "pronto", conectado_em: new Date().toISOString(), ultimo_relatorio_em: new Date().toISOString(), entregue_em: new Date().toISOString() })
      .eq("id", raioXId);
    if (pronto.error) throw pronto.error;

    // ── 3. Entrar com o código do e-mail ────────────────────────────────
    const pessoa = await browser.newContext({ baseURL });
    const area = await pessoa.newPage();
    await area.goto(`/raio-x/entrar?email=${encodeURIComponent(EMAIL)}`);
    await expect(area.getByRole("heading", { name: "Entrar na área do Raio-X" })).toBeVisible();
    const antes = mensagens.length;
    await area.locator('[data-raio-x="mandar-codigo"]').click();
    await expect(area.locator('[data-raio-x="codigo-enviado"]')).toBeVisible();
    await expect.poll(() => mensagens.length, { message: "o código não chegou ao SMTP de teste" }).toBeGreaterThan(antes);
    const texto = decodificar(mensagens[mensagens.length - 1]!.corpo);
    const codigo = /Use o código (\d{6}) para entrar/.exec(texto)?.[1];
    expect(codigo, "o código no e-mail").toMatch(/^\d{6}$/);
    // O banco guarda só o hash.
    const guardado = await db.from("mia_raio_x_codigos_de_acesso").select("codigo_hash").eq("conta_id", contaId);
    expect(JSON.stringify(guardado.data)).not.toContain(codigo!);
    await area.locator("#raio-x-codigo").fill(codigo!);
    await area.screenshot({ path: `${EVIDENCIA}/3-entrar.png`, fullPage: true });
    await area.locator('[data-raio-x="entrar"]').click();

    // ── 4. A área com o raio-X, e o relatório ───────────────────────────
    await area.waitForURL(/\/raio-x\/minha-area$/);
    await expect(area.locator('[data-raio-x="minha-area"]')).toContainText(EMPRESA);
    await expect(area.locator(`[data-raio-x-da-area="${raioXId}"]`)).toContainText("grátis");
    await area.screenshot({ path: `${EVIDENCIA}/4-area.png`, fullPage: true });
    await area.locator(`[data-raio-x-da-area="${raioXId}"] [data-raio-x="abrir"]`).click();
    await area.waitForURL(new RegExp(`/raio-x/minha-area/${raioXId}$`));
    const relatorio = area.locator('[data-raio-x="dono"]');
    await expect(relatorio).toContainText(`${EMPRESA}: 11 clientes chamaram no WhatsApp.`);
    await expect(relatorio).not.toContainText("Custo da análise");
    await expect(area.locator("body")).not.toContainText("automático: cadastro");
    await area.screenshot({ path: `${EVIDENCIA}/5-relatorio.png`, fullPage: true });

    // Outro id (que não é desta conta) responde 404.
    const outro = await area.goto(`/raio-x/minha-area/${randomUUID()}`);
    expect(outro?.status()).toBe(404);
    // Sem o cookie, a área manda para a entrada.
    const semSessao = await browser.newContext({ baseURL });
    const deFora = await semSessao.newPage();
    await deFora.goto("/raio-x/minha-area");
    await deFora.waitForURL(/\/raio-x\/entrar$/);
    await semSessao.close();
    await pessoa.close();
    // O leitor nunca recebeu pedido de envio.
    expect(pedidos.filter((p) => /send|seen|presence|typing|reaction/i.test(p.caminho))).toEqual([]);
    expect(errosDePagina).toEqual([]);
  } finally {
    servidor.close();
    smtp.close();
    // O SMTP da instalação volta ao que era (o service_role não apaga a linha: esvazia).
    if (smtpAntes) await db.from("platform_smtp_settings").update(smtpAntes).eq("id", 1);
    else await db.from("platform_smtp_settings").update({ smtp_host: null, from_email: null, from_name: null }).eq("id", 1);
    if (raioXId) await db.from("mia_raio_x").delete().eq("id", raioXId);
    if (contaId) await db.from("mia_raio_x_contas").delete().eq("id", contaId);
  }
});

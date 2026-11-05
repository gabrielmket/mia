/**
 * E2E [P0] FORK MIA (.101): o raio-X do atendimento pelo navegador
 * (docs/fork/raio-x-do-atendimento.md). Dado fictício, nenhum WhatsApp de verdade:
 * o LEITOR do raio-X é um dublê HTTP que esta spec sobe na porta 3994
 * (`RAIO_X_LEITOR_URL` do .env.e2e, scripts/gerar-env-e2e.sh). Ele responde como o
 * contêiner e grava os pedidos, para a spec conferir que nada de envio passou.
 *
 *   1. a Time cria o raio-X no Admin e recebe o link de conexão e a mensagem;
 *   2. o dono abre o link SEM login, aceita o termo (fica gravado com o texto
 *      inteiro) e pede o código de 8 letras;
 *   3. o relatório, montado das conversas fictícias fixas, aparece no Admin;
 *   4. a Time revisa e gera o link do dono;
 *   5. o dono abre o link SEM login: sem o bloco da MIA e sem custo;
 *   6. a Time encerra: o link de conexão deixa de existir.
 *
 * Self-contida: tudo morre no `finally`.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";

import { montarRelatorio } from "@/lib/raio-x/relatorio";

import { FIM_DA_GARAGEM, INICIO_DA_GARAGEM, conversasDaGaragemModelo } from "../fixtures/raio-x/garagem-modelo";
import { criarPessoa, db, entrar, inserir } from "./helpers/cobranca";
import { expect, test } from "./helpers/test";

const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/raio-x-do-atendimento";
const EMPRESA = `Garagem Modelo Veículos ${sufixo}`;
const PORTA_DO_LEITOR = 3994;

interface PedidoAoLeitor {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/** O dublê do contêiner do leitor: sessões em memória, código fixo, nenhuma rota de envio. */
function subirLeitor(): Promise<{ servidor: Server; pedidos: PedidoAoLeitor[] }> {
  const pedidos: PedidoAoLeitor[] = [];
  const sessoes = new Map<string, Record<string, unknown>>();
  const servidor = createServer((req, res) => {
    let bruto = "";
    req.on("data", (c) => (bruto += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://leitor");
      const corpo = bruto ? (JSON.parse(bruto) as Record<string, unknown>) : null;
      pedidos.push({ metodo: req.method ?? "GET", caminho: url.pathname, corpo });
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

test("[P0] raio-X do atendimento: criar, aceitar, revisar, link do dono e encerrar", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(EVIDENCIA, { recursive: true });
  const { servidor, pedidos } = await subirLeitor();
  const pessoas: string[] = [];
  const orgs: string[] = [];
  let raioXId: string | null = null;
  const errosDePagina: string[] = [];
  page.on("pageerror", (e) => errosDePagina.push(e.message));
  page.on("dialog", (d) => void d.accept());

  try {
    // ── 0. Semente: a pessoa da Time, administradora da plataforma ──────
    const time = await criarPessoa("time-raio-x", sufixo);
    pessoas.push(time.id);
    const org = await inserir("organizations", { slug: `raio-x-e2e-${sufixo}`, display_name: `Time Raio-X ${sufixo}`, legal_name: `Time Raio-X ${sufixo}`, onboarded_at: new Date().toISOString() });
    orgs.push(org);
    const vinc = await db.from("user_organizations").insert({ organization_id: org, user_id: time.id, role: "admin", accepted_at: new Date().toISOString() });
    if (vinc.error) throw vinc.error;
    const pa = await db.from("platform_admins").insert({ user_id: time.id, granted_by: time.id, scope: "full", mfa_required: false, reason: "E2E raio-X" });
    if (pa.error) throw pa.error;

    // ── 1. A Time cria o raio-X no Admin ────────────────────────────────
    await entrar(page, time.email);
    await page.goto("/admin/raio-x");
    await expect(page.getByRole("heading", { name: "Raio-X do atendimento", exact: true })).toBeVisible();
    await page.locator('[data-raio-x="novo"]').click();
    await page.locator("#raio-x-empresa").fill(EMPRESA);
    await page.locator("#raio-x-segmento").selectOption("revenda_de_veiculos");
    await page.locator("#raio-x-whatsapp").fill("(31) 90000-1101");
    await page.locator("#raio-x-responsavel").fill("Ricardo Exemplo");
    await page.locator('[data-raio-x="criar"]').click();
    const linkDeConexao = await page.locator('[data-raio-x="link-pronto"] [data-raio-x="link-de-conexao"]').inputValue();
    expect(linkDeConexao).toMatch(/\/raio-x\/[0-9A-Z]{8}$/);
    await expect(page.locator('[data-raio-x="mensagem-pronta"]')).toContainText("O link vale por 48 horas");
    const criado = await db.from("mia_raio_x").select("id, situacao, whatsapp").eq("empresa", EMPRESA).single();
    if (criado.error) throw criado.error;
    raioXId = (criado.data as { id: string }).id;
    expect(criado.data).toMatchObject({ situacao: "aguardando", whatsapp: "5531900001101" });
    await page.screenshot({ path: `${EVIDENCIA}/1-novo-raio-x.png`, fullPage: true });

    // ── 2. O dono abre o link sem login e aceita o termo ────────────────
    const dono = await browser.newContext({ baseURL });
    const paginaDoDono = await dono.newPage();
    await paginaDoDono.goto(new URL(linkDeConexao).pathname);
    await expect(paginaDoDono.locator('[data-raio-x-etapa="termo"]')).toContainText(EMPRESA);
    await paginaDoDono.locator("#raio-x-nome").fill("Ricardo Exemplo");
    await paginaDoDono.locator('[data-raio-x="aceite"]').check();
    await paginaDoDono.locator('[data-raio-x="autorizar"]').click();
    await expect(paginaDoDono.locator('[data-raio-x-etapa="conectar"]')).toBeVisible();
    const aceite = await db.from("mia_raio_x_aceites").select("nome, termo_versao, termo_texto, termo_hash").eq("raio_x_id", raioXId).single();
    if (aceite.error) throw aceite.error;
    expect(aceite.data).toMatchObject({ nome: "Ricardo Exemplo", termo_versao: "v1" });
    expect((aceite.data as { termo_texto: string }).termo_texto).toContain("TERMO DE AUTORIZAÇÃO");
    // A sessão do leitor nasceu com o acervo, sem o "online" e sem webhook.
    const criacao = pedidos.find((p) => p.metodo === "POST" && p.caminho === "/api/sessions");
    expect(criacao, "o leitor não recebeu o pedido de sessão").toBeDefined();
    expect((criacao!.corpo as { config: { noweb: { markOnline: boolean } } }).config.noweb.markOnline).toBe(false);
    // O código de 8 letras.
    await paginaDoDono.locator('[data-raio-x="gerar-codigo"]').click();
    await expect(paginaDoDono.locator('[data-raio-x="codigo-do-whatsapp"]')).toHaveText("K7PQ-2M9X");
    expect(pedidos.find((p) => p.caminho.endsWith("/auth/request-code"))?.corpo).toEqual({ phoneNumber: "5531900001101" });
    await paginaDoDono.screenshot({ path: `${EVIDENCIA}/2-conexao.png`, fullPage: true });

    // ── 3. O relatório (montado das conversas fictícias fixas) no Admin ─
    const dados = montarRelatorio({
      empresa: EMPRESA,
      segmento: "revenda_de_veiculos",
      tipo: "unico",
      periodo: { inicio: INICIO_DA_GARAGEM, fim: FIM_DA_GARAGEM },
      conversas: conversasDaGaragemModelo(),
    });
    const relatorioId = await inserir("mia_raio_x_relatorios", {
      raio_x_id: raioXId,
      sequencia: 1,
      periodo_inicio: INICIO_DA_GARAGEM.toISOString(),
      periodo_fim: FIM_DA_GARAGEM.toISOString(),
      criterios_versao: dados.criteriosVersao,
      dados,
      parcial: dados.analise.parcial,
      conversas: dados.numeros.conversas,
      custo_usd_centavos: 3.5,
      custo_centavos: 21.4,
    });
    const pronto = await db
      .from("mia_raio_x")
      .update({ situacao: "pronto", conectado_em: new Date().toISOString(), ultimo_relatorio_em: new Date().toISOString() })
      .eq("id", raioXId);
    if (pronto.error) throw pronto.error;
    await page.goto(`/admin/raio-x/${raioXId}`);
    await expect(page.locator('[data-raio-x="relatorio"]')).toContainText("Velocidade da primeira resposta");
    await expect(page.locator('[data-raio-x-exemplo="0187"]')).toContainText("[nome]");
    await expect(page.locator('[data-raio-x-bloco="mia"]')).toBeVisible();
    // Rascunho: o link do dono ainda não sai.
    await expect(page.locator('[data-raio-x="gerar-link-do-dono"]')).toBeDisabled();

    // ── 4. A Time revisa e gera o link do dono ──────────────────────────
    await page.locator("#raio-x-notas").fill("Conferi as conversas de exemplo.");
    await page.locator('[data-raio-x="revisar"]').click();
    await expect
      .poll(async () => (await db.from("mia_raio_x_relatorios").select("situacao").eq("id", relatorioId).single()).data?.situacao, {
        message: "o relatório não virou revisado",
      })
      .toBe("revisado");
    await page.reload();
    await page.locator('[data-raio-x="gerar-link-do-dono"]').click();
    const linkDoDono = await page.locator('[data-raio-x-link-do-dono="ativo"]').first().inputValue();
    expect(linkDoDono).toMatch(/\/raio-x\/relatorio\/[0-9a-z]{24}$/);
    await page.screenshot({ path: `${EVIDENCIA}/3-relatorio-da-time.png`, fullPage: true });

    // ── 5. O dono abre o link sem login ─────────────────────────────────
    await paginaDoDono.goto(new URL(linkDoDono).pathname);
    const relatorioDoDono = paginaDoDono.locator('[data-raio-x="dono"]');
    await expect(relatorioDoDono).toContainText(`${EMPRESA}: 11 clientes chamaram no WhatsApp.`);
    await expect(relatorioDoDono).not.toContainText("Para a conversa comercial da Time");
    await expect(relatorioDoDono).not.toContainText("Custo da análise");
    await expect(paginaDoDono.locator("body")).not.toContainText("Conferi as conversas de exemplo.");
    await paginaDoDono.screenshot({ path: `${EVIDENCIA}/4-link-do-dono.png`, fullPage: true });
    const acessos = await db.from("mia_raio_x_links").select("acessos").eq("relatorio_id", relatorioId).single();
    expect((acessos.data as { acessos: number }).acessos).toBe(1);

    // ── 6. A Time encerra ───────────────────────────────────────────────
    await page.locator('[data-raio-x="encerrar"]').click();
    await expect
      .poll(async () => (await db.from("mia_raio_x").select("situacao").eq("id", raioXId).single()).data?.situacao, {
        message: "o raio-X não encerrou",
      })
      .toBe("encerrado");
    const encerrado = await db.from("mia_raio_x").select("apagar_conversas_em, desconectado_em").eq("id", raioXId).single();
    expect((encerrado.data as { apagar_conversas_em: string | null }).apagar_conversas_em).not.toBeNull();
    expect(pedidos.some((p) => p.caminho.endsWith("/logout"))).toBe(true);
    // O link de conexão deixou de existir.
    const depois = await paginaDoDono.goto(new URL(linkDeConexao).pathname);
    expect(depois?.status()).toBe(404);
    // E o leitor nunca recebeu pedido de envio.
    expect(pedidos.filter((p) => /send|seen|presence|typing|reaction/i.test(p.caminho))).toEqual([]);
    await dono.close();
    expect(errosDePagina).toEqual([]);
  } finally {
    servidor.close();
    if (raioXId) await db.from("mia_raio_x").delete().eq("id", raioXId);
    for (const o of orgs) await db.from("organizations").delete().eq("id", o);
    for (const p of pessoas) {
      await db.from("platform_admins").delete().eq("user_id", p);
      await db.auth.admin.deleteUser(p);
    }
  }
});

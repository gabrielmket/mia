/**
 * E2E [P0] FORK MIA (.102): o raio-X do CLIENTE ATIVO pelo navegador
 * (docs/fork/raio-x-do-atendimento.md, seção 13). Dado fictício: a "Garagem
 * Modelo Veículos", um número de WhatsApp da conta e uma conversa semeados no
 * banco. Nenhum leitor, nenhum WhatsApp de verdade, nenhuma IA (o e2e não tem
 * chave: o relatório sai só com o relógio).
 *
 *   1. a Time cria no Admin com "Conversas que já estão na MIA": a empresa
 *      ativa, o número da conta, o período e a estimativa vêm da conta;
 *   2. o dono abre o link SEM login: duas etapas (autorizar e pronto), o termo
 *      "cliente ativo" v1, e o aceite só passa com nome completo e e-mail;
 *   3. o cron lê as conversas da conta e gera o rascunho;
 *   4. o detalhe mostra "Autorizado por …" e quem respondeu primeiro;
 *   5. nenhuma mensagem nova saiu da conta.
 *
 * Self-contida: tudo morre no `finally`.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { criarPessoa, db, diasAtras, entrar, inserir } from "./helpers/cobranca";
import { expect, test } from "./helpers/test";

const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/raio-x-cliente-ativo";
const EMPRESA = `Garagem Modelo Veículos ${sufixo}`;
const SEGREDO = process.env.INTERNAL_CRON_SECRET || process.env.INTERNAL_SECRET || "";

test("[P0] raio-X do cliente ativo: autorizar sem conectar, ler a conta e gerar o rascunho", async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(EVIDENCIA, { recursive: true });
  const pessoas: string[] = [];
  const orgs: string[] = [];
  let raioXId: string | null = null;
  let cliente: string | null = null;
  const errosDePagina: string[] = [];
  page.on("pageerror", (e) => errosDePagina.push(e.message));

  try {
    // ── 0. Semente: a Time (admin de plataforma) e a conta do cliente, com uma conversa ──
    const time = await criarPessoa("time-raio-x-ativo", sufixo);
    pessoas.push(time.id);
    const daTime = await inserir("organizations", { slug: `raio-x-ativo-time-${sufixo}`, display_name: `Time Raio-X ${sufixo}`, legal_name: `Time Raio-X ${sufixo}`, onboarded_at: new Date().toISOString() });
    orgs.push(daTime);
    const vinc = await db.from("user_organizations").insert({ organization_id: daTime, user_id: time.id, role: "admin", accepted_at: new Date().toISOString() });
    if (vinc.error) throw vinc.error;
    const pa = await db.from("platform_admins").insert({ user_id: time.id, granted_by: time.id, scope: "full", mfa_required: false, reason: "E2E raio-X do cliente ativo" });
    if (pa.error) throw pa.error;

    // A conta do cliente: sem assinatura no sistema (isenta), operando, como o cliente implantado pela Time.
    cliente = await inserir("organizations", { slug: `raio-x-ativo-${sufixo}`, display_name: EMPRESA, legal_name: EMPRESA, onboarded_at: new Date().toISOString() });
    orgs.push(cliente);
    const canal = await inserir("channel_sessions", {
      organization_id: cliente,
      waha_session_name: `e2e-raio-x-ativo-${sufixo}`,
      webhook_secret_encrypted: "e2e",
      display_name: "Vendas",
      phone_number: "+5531900000101",
    });
    const contato = await inserir("contacts", { organization_id: cliente, display_name: "Cliente Exemplo", phone_number: `+55319${String(Date.now()).slice(-8)}` });
    // Três dias atrás: o período do cliente ativo são os dias INTEIROS antes de hoje.
    const conversa = await inserir("conversations", {
      organization_id: cliente,
      contact_id: contato,
      channel_session_id: canal,
      status: "open",
      created_at: diasAtras(3),
      last_message_at: diasAtras(3),
      last_inbound_at: diasAtras(3),
    });
    const base = { organization_id: cliente, conversation_id: conversa, channel_session_id: canal, contact_id: contato, type: "text" };
    const quando = Date.parse(diasAtras(3));
    for (const linha of [
      { ...base, direction: "inbound", status: "delivered", sent_via: "external_device", body: "Ainda tem o carro do anúncio?", sent_at: new Date(quando).toISOString() },
      { ...base, direction: "outbound", status: "sent", sent_via: "ai", body: "Tem sim! Quer agendar uma visita?", sent_at: new Date(quando + 9_000).toISOString() },
    ]) {
      const { error } = await db.from("messages").insert(linha);
      if (error) throw error;
    }

    // ── 1. A Time cria no Admin, com as conversas que já estão na MIA ──
    await entrar(page, time.email);
    await page.goto("/admin/raio-x");
    await page.locator('[data-raio-x="novo"]').click();
    await page.locator('[data-raio-x-fonte="conversas_da_mia"]').click();
    await page.locator("#raio-x-conta").selectOption(cliente);
    const numero = page.locator(`[data-raio-x-numero="${canal}"]`);
    await expect(numero).toContainText("Vendas");
    await expect(numero.locator('input[type="checkbox"]')).toBeChecked();
    await page.locator("#raio-x-periodo").selectOption("30");
    await expect(page.locator('[data-raio-x="estimativa"]')).toContainText("Estimativa para este período");
    await expect(page.locator('[data-raio-x="periodo-da-conta"]')).toContainText("A conta tem conversas desde");
    await page.screenshot({ path: `${EVIDENCIA}/1-novo-raio-x.png`, fullPage: true });
    await page.locator('[data-raio-x="criar"]').click();
    const link = await page.locator('[data-raio-x="link-pronto"] [data-raio-x="link-de-conexao"]').inputValue();
    expect(link).toMatch(/\/raio-x\/[0-9A-Z]{8}$/);
    await expect(page.locator('[data-raio-x="mensagem-pronta"]')).toContainText("Não precisa conectar nada");
    const criado = await db.from("mia_raio_x").select("id, fonte, situacao, whatsapp, organization_id, periodo_inicio, periodo_fim").eq("empresa", EMPRESA).single();
    if (criado.error) throw criado.error;
    raioXId = (criado.data as { id: string }).id;
    expect(criado.data).toMatchObject({ fonte: "conversas_da_mia", situacao: "aguardando", whatsapp: "5531900000101", organization_id: cliente });
    const numeros = await db.from("mia_raio_x_numeros").select("channel_session_id, rotulo, oficial").eq("raio_x_id", raioXId);
    expect(numeros.data).toEqual([{ channel_session_id: canal, rotulo: "Vendas", oficial: false }]);

    // ── 2. O dono autoriza, sem conectar nada ──
    const dono = await browser.newContext({ baseURL });
    const paginaDoDono = await dono.newPage();
    await paginaDoDono.goto(new URL(link).pathname);
    const termo = paginaDoDono.locator('[data-raio-x-etapa="termo"][data-raio-x-fonte-da-pagina="conversas_da_mia"]');
    await expect(termo).toContainText(EMPRESA);
    await expect(termo).toContainText("Nada para conectar.");
    await expect(paginaDoDono.getByText("2 · pronto")).toBeVisible();
    await expect(paginaDoDono.getByText("2 · conectar")).toHaveCount(0);
    // Só o primeiro nome não passa.
    await paginaDoDono.locator("#raio-x-nome").fill("Dono");
    await paginaDoDono.locator("#raio-x-email").fill("dono@garagemmodelo.com.br");
    await paginaDoDono.locator('[data-raio-x="aceite"]').check();
    await paginaDoDono.locator('[data-raio-x="autorizar"]').click();
    await expect(paginaDoDono.locator("#raio-x-nome")).toHaveAttribute("aria-invalid", "true");
    expect((await db.from("mia_raio_x_aceites").select("id").eq("raio_x_id", raioXId)).data).toEqual([]);
    await paginaDoDono.locator("#raio-x-nome").fill("Dono Modelo da Silva");
    await paginaDoDono.locator('[data-raio-x="autorizar"]').click();
    await expect(paginaDoDono.locator('[data-raio-x-etapa="lendo"]')).toBeVisible();
    await paginaDoDono.screenshot({ path: `${EVIDENCIA}/2-autorizado.png`, fullPage: true });
    const aceite = await db.from("mia_raio_x_aceites").select("nome, email, termo_versao, termo_texto").eq("raio_x_id", raioXId).single();
    if (aceite.error) throw aceite.error;
    expect(aceite.data).toMatchObject({ nome: "Dono Modelo da Silva", email: "dono@garagemmodelo.com.br", termo_versao: "cliente_ativo_v1" });
    expect((aceite.data as { termo_texto: string }).termo_texto).toContain("do número Vendas já registradas na MIA");

    // ── 3. O cron lê as conversas da conta e gera o rascunho ──
    expect(SEGREDO, "sem INTERNAL_CRON_SECRET/INTERNAL_SECRET no ambiente do e2e").not.toBe("");
    await expect
      .poll(
        async () => {
          const r = await request.post("/api/v1/cron/raio-x", { headers: { authorization: `Bearer ${SEGREDO}` } });
          expect(r.status(), await r.text()).toBe(200);
          return (await db.from("mia_raio_x").select("situacao").eq("id", raioXId).single()).data?.situacao;
        },
        { message: "o raio-X do cliente ativo não chegou ao rascunho", timeout: 120_000, intervals: [2_000] },
      )
      .toBe("pronto");
    const rel = await db.from("mia_raio_x_relatorios").select("situacao, dados").eq("raio_x_id", raioXId).single();
    if (rel.error) throw rel.error;
    const dados = (rel.data as { dados: { fonte: string; numeros: { conversas: number }; clienteAtivo: { quemRespondeu: { linhas: Array<{ quem: string; conversas: number }> } } } }).dados;
    expect((rel.data as { situacao: string }).situacao).toBe("rascunho");
    expect(dados.fonte).toBe("conversas_da_mia");
    expect(dados.numeros.conversas).toBe(1);
    expect(dados.clienteAtivo.quemRespondeu.linhas).toContainEqual(expect.objectContaining({ quem: "ia", conversas: 1 }));
    expect(JSON.stringify(dados)).not.toContain("Cliente Exemplo");

    // ── 4. O detalhe no Admin ──
    await page.goto(`/admin/raio-x/${raioXId}`);
    await expect(page.locator('[data-raio-x="andamento-da-mia"]')).toContainText("Autorizado por Dono Modelo da Silva");
    await expect(page.locator('[data-raio-x-bloco="quem-respondeu"]')).toContainText("IA");
    await expect(page.locator('[data-raio-x-bloco="mia"]')).toHaveCount(0);
    await expect(page.locator('[data-raio-x-bloco="onde-ganhar"]')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/3-relatorio-da-time.png`, fullPage: true });

    // ── 5. Nenhuma mensagem nova saiu da conta ──
    const saidas = await db.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", cliente).eq("direction", "outbound");
    expect(saidas.count).toBe(1);
    await dono.close();
    expect(errosDePagina).toEqual([]);
  } finally {
    if (raioXId) await db.from("mia_raio_x").delete().eq("id", raioXId);
    if (cliente) {
      await db.from("messages").delete().eq("organization_id", cliente);
      await db.from("conversations").delete().eq("organization_id", cliente);
      await db.from("contacts").delete().eq("organization_id", cliente);
      await db.from("channel_sessions").delete().eq("organization_id", cliente);
    }
    for (const o of orgs) await db.from("organizations").delete().eq("id", o);
    for (const p of pessoas) {
      await db.from("platform_admins").delete().eq("user_id", p);
      await db.auth.admin.deleteUser(p);
    }
  }
});

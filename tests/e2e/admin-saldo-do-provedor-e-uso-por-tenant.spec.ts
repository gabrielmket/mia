/**
 * SALDO DO PROVEDOR E USO POR TENANT, PELA TELA DO DONO DO SERVIDOR (MIA-41).
 *
 * Dois defeitos de `/admin/usage`, achados em 17/11/2026:
 *
 *  1. O campo "Quando" do saldo do provedor virava meia-noite em UTC, que em
 *     Brasília é 21h do dia anterior. A leitura de hoje aparecia como de
 *     ontem; a de amanhã caía hoje, às 21h, e zerava o "consumido desde então".
 *  2. A linha de "Uso por tenant" soma o uso de TODOS os agentes do cliente,
 *     mas mostrava o nome de um só.
 *
 * ═══ O QUE ESTA SPEC PROVA ═══
 *
 *  - Hoje: a leitura grava AGORA e a lista mostra a data de hoje.
 *  - Dia passado: grava o meio-dia local daquele dia, e a lista mostra o dia.
 *  - Amanhã: a tela recusa (aviso e botão desligado) e a rota responde 422.
 *  - A Academia Alfa (fictícia) com 2 agentes publicados mostra
 *    "+1 · o uso soma todos os agentes", e o CSV traz `agentes_publicados`.
 *
 * O navegador roda no fuso de Brasília de propósito: no fuso do runner (UTC)
 * o defeito 1 não aparece.
 *
 * ═══ O QUE ESTA SPEC NÃO PROVA ═══
 *
 *  - As bordas do dia (depois das 21h, data que não existe): são de
 *    `tests/unit/saldo-dia-do-lancamento.test.ts`, com relógio fixo.
 *  - A conta do saldo em si: `tests/unit/saldo-do-provedor.test.ts`.
 *
 * Os lançamentos levam uma observação única e saem no fim; a organização, os
 * agentes e a sessão de canal semeados também.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const { url, serviceRole } = credenciaisSupabaseDeTeste();
const db = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

const EVIDENCIA = path.join(process.cwd(), "evidence", "admin-saldo-do-provedor-e-uso");
const FUSO = "America/Sao_Paulo";
const SUFIXO = Date.now().toString(36);
const SLUG = `e2e-academia-alfa-${SUFIXO}`;
const NOME = "Academia Alfa";
const NOTA = `e2e-saldo-${SUFIXO}`;

let orgId = "";
let sessaoId = "";
const agentes: string[] = [];

test.use({ locale: "pt-BR", timezoneId: FUSO });
test.describe.configure({ timeout: 240_000 });

async function foto(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

/** "AAAA-MM-DD" de hoje + `deslocamento` dias, no fuso de Brasília. */
function diaEmBrasilia(deslocamento: number): string {
  const instante = new Date(Date.now() + deslocamento * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(instante);
}

/** Como a lista mostra o dia em pt-BR: "dd/mm/aaaa". */
function comoALista(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

async function semearAgentePublicado(nome: string, prioridade: number): Promise<void> {
  const { data: agente, error: ea } = await db
    .from("ai_agents")
    .insert({ organization_id: orgId, name: nome, system_prompt: "Agente fictício do E2E.", priority: prioridade })
    .select("id")
    .single();
  if (ea || !agente) throw new Error(`ai_agents: ${ea?.message}`);
  const agentId = (agente as { id: string }).id;
  agentes.push(agentId);

  const { data: versao, error: ev } = await db
    .from("ai_agent_versions")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      version_number: 1,
      system_prompt: "Agente fictício do E2E.",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      credential_id: null,
      channel_session_id: sessaoId,
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ev || !versao) throw new Error(`ai_agent_versions: ${ev?.message}`);

  const { error: ep } = await db
    .from("ai_agents")
    .update({ published_version_id: (versao as { id: string }).id })
    .eq("id", agentId);
  if (ep) throw new Error(`published_version_id: ${ep.message}`);
}

/** O lançamento desta rodada com o valor dado, lido do banco. */
async function lancamento(valor: number): Promise<{ occurred_at: string }> {
  const { data, error } = await db
    .from("platform_ai_ledger")
    .select("occurred_at")
    .eq("note", NOTA)
    .eq("amount_usd", valor);
  if (error) throw new Error(`platform_ai_ledger: ${error.message}`);
  const linhas = (data ?? []) as Array<{ occurred_at: string }>;
  expect(linhas, `um lançamento de US$ ${valor} com a nota ${NOTA}`).toHaveLength(1);
  return linhas[0]!;
}

test.beforeAll(async () => {
  await afirmarDonoDoServidor(lerCreds().users.dono!.email);

  const { data: org, error: oe } = await db
    .from("organizations")
    .insert({ slug: SLUG, legal_name: `${NOME} LTDA`, display_name: NOME, onboarded_at: new Date().toISOString() })
    .select("id")
    .single();
  if (oe || !org) throw new Error(`organizations: ${oe?.message}`);
  orgId = (org as { id: string }).id;

  // A versão publicada exige uma sessão de canal; esta não tem transporte no ar.
  const { data: sessao, error: se } = await db
    .from("channel_sessions")
    .insert({ organization_id: orgId, waha_session_name: `e2e-saldo-${SUFIXO}`, webhook_secret_encrypted: "e2e" })
    .select("id")
    .single();
  if (se || !sessao) throw new Error(`channel_sessions: ${se?.message}`);
  sessaoId = (sessao as { id: string }).id;

  await semearAgentePublicado("Agente Recepção", 10);
  await semearAgentePublicado("Agente Matrículas", 5);
});

test.afterAll(async () => {
  await db.from("platform_ai_ledger").delete().eq("note", NOTA);
  // A versão prende a sessão (ON DELETE RESTRICT): agentes (e versões) antes.
  if (agentes.length > 0) await db.from("ai_agents").delete().in("id", agentes);
  if (sessaoId) await db.from("channel_sessions").delete().eq("id", sessaoId);
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
});

test("o saldo grava no dia escolhido e o uso avisa que soma os agentes — pela tela", async ({ page }) => {
  await loginComoDono(page, lerCreds());
  await page.goto("/admin/usage");
  await expect(page.getByRole("heading", { name: "Saldo e recarga do provedor" })).toBeVisible({
    timeout: 30_000,
  });

  const tipo = page.locator("#saldo-tipo");
  const valor = page.locator("#saldo-valor");
  const quando = page.locator("#saldo-quando");
  const nota = page.locator("#saldo-nota");
  const registrar = page.getByRole("button", { name: "Registrar", exact: true });
  const lista = page.locator("table").filter({ hasText: "Observação" });

  async function lancar(dia: string, usd: string): Promise<void> {
    await tipo.selectOption("leitura");
    await valor.fill(usd);
    await quando.fill(dia);
    await nota.fill(NOTA);
    const resposta = page.waitForResponse(
      (r) => r.url().includes("/api/v1/admin/ai-saldo") && r.request().method() === "POST",
    );
    await registrar.click();
    expect((await resposta).status()).toBe(200);
    await expect(valor).toHaveValue("");
  }

  await test.step("hoje grava agora, e a lista mostra hoje", async () => {
    const hoje = diaEmBrasilia(0);
    const antes = Date.now();
    await lancar(hoje, "41,17");
    const depois = Date.now();

    const { occurred_at } = await lancamento(41.17);
    const gravado = Date.parse(occurred_at);
    // Agora, não meia-noite UTC (21h de ontem em Brasília).
    expect(gravado).toBeGreaterThanOrEqual(antes - 60_000);
    expect(gravado).toBeLessThanOrEqual(depois + 60_000);

    const linha = lista.locator("tr").filter({ hasText: "41,17" }).filter({ hasText: NOTA });
    await expect(linha).toContainText(comoALista(hoje));
    await foto(page, "01-leitura-de-hoje");
  });

  await test.step("dia passado grava meio-dia local daquele dia", async () => {
    const passado = diaEmBrasilia(-3);
    await lancar(passado, "52,30");

    const { occurred_at } = await lancamento(52.3);
    // Brasília é UTC-3 o ano todo: meio-dia local = 15h UTC.
    expect(new Date(occurred_at).toISOString()).toBe(`${passado}T15:00:00.000Z`);

    const linha = lista.locator("tr").filter({ hasText: "52,30" }).filter({ hasText: NOTA });
    await expect(linha).toContainText(comoALista(passado));
    await foto(page, "02-leitura-de-dia-passado");
  });

  await test.step("amanhã: a tela recusa e a rota responde erro", async () => {
    const amanha = diaEmBrasilia(1);
    await expect(quando).toHaveAttribute("max", diaEmBrasilia(0));
    await tipo.selectOption("leitura");
    await valor.fill("63,40");
    await quando.fill(amanha);
    await expect(page.getByText("A data não pode ser depois de hoje.")).toBeVisible();
    await expect(registrar).toBeDisabled();
    await foto(page, "03-amanha-recusado-na-tela");

    // Quem chama a rota sem a tela: o meio-dia de amanhã é recusado.
    const r = await page.request.post("/api/v1/admin/ai-saldo", {
      data: { tipo: "leitura", amount_usd: 63.4, occurred_at: `${amanha}T15:00:00.000Z`, note: NOTA },
    });
    expect(r.status()).toBe(422);
    const { count } = await db
      .from("platform_ai_ledger")
      .select("id", { count: "exact", head: true })
      .eq("note", NOTA)
      .eq("amount_usd", 63.4);
    expect(count).toBe(0);

    await quando.fill("");
    await valor.fill("");
  });

  await test.step("a Academia Alfa com 2 agentes avisa que o uso soma todos", async () => {
    const linha = page.locator("tr").filter({ hasText: SLUG });
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText("Agente Recepção");
    await expect(linha).toContainText("+1 · o uso soma todos os agentes");
    await linha.scrollIntoViewIfNeeded();
    await foto(page, "04-uso-por-tenant-com-dois-agentes");

    const baixar = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const arquivo = await (await baixar).path();
    const csv = fs.readFileSync(arquivo, "utf8").split("\n");
    const cabecalho = csv[0]!.split(",");
    const coluna = cabecalho.indexOf("agentes_publicados");
    expect(coluna, "a coluna agentes_publicados no CSV").toBeGreaterThan(-1);
    const daAcademia = csv.find((l) => l.includes(SLUG));
    expect(daAcademia, "a linha da Academia Alfa no CSV").toBeTruthy();
    expect(daAcademia!.split(",")[coluna]).toBe("2");
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    fs.writeFileSync(
      path.join(EVIDENCIA, "05-csv-cabecalho-e-linha.txt"),
      `${csv[0]}\n${daAcademia}\n`,
    );
  });
});

/**
 * FORK MIA — O BROADCAST UNIFICADO, PELA TELA (1.21.0-mia.58).
 *
 * Desenho: docs/fork/broadcast-unificado.md. O dono do produto decidiu juntar a
 * tela de Campanhas (upstream) e o Broadcast (fork) num produto só, com a porta
 * do número oficial e a do número por QR. Esta spec prova o CAMINHO de quem usa,
 * nas duas posições que importam:
 *
 *   1. SEM o módulo `disparador` (com a proposta "o QR também atrás do módulo"
 *      ligada): nenhum dos dois aparece no hub; `/app/campaigns` e as telas de
 *      dentro dela levam ao Broadcast, que diz "não contratado"; e a API das
 *      Campanhas recusa — esconder o menu não é recusar.
 *   2. COM o módulo: o hub tem UMA porta, "Broadcast"; a lista junta um disparo
 *      de cada motor, cada um com o seu selo; "Novo disparo" pergunta por onde
 *      sai e mostra o custo (oficial) e o risco de bloqueio (QR) antes da
 *      escolha; o QR leva ao formulário do upstream embrulhado na faixa do
 *      Broadcast, e a faixa traz de volta.
 *
 * O que ela NÃO prova: o envio. Os dois motores não mudaram nesta versão, e cada
 * um tem a própria prova; aqui se mede a porta e a costura.
 *
 * Os dados são desta spec (um número, uma campanha por QR, um disparo oficial e
 * a liberação do módulo), criados pela chave de serviço e desfeitos no fim.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { QR_EXIGE_O_MODULO } from "@/lib/broadcast/canais-do-disparo";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { expect, test } from "./helpers/test";
import { afirmarAdminDeTenantPuro } from "./utils/precondicao";

const env = carregarEnvLocal();
const servico: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const EVIDENCIA = path.join(process.cwd(), "evidence", "broadcast-unificado");
function evidencia(nome: string): string {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  return path.join(EVIDENCIA, nome);
}

const CANAL = "Número da prova do Broadcast";
const CAMPANHA_QR = "Prova QR do Broadcast unificado";
const DISPARO_OFICIAL = "Prova oficial do Broadcast unificado";

// Dois logins no arquivo não cabem nos 30 s padrão (ver o comentário igual em
// `protecao-de-envio-nao-congela-o-padrao.spec.ts`).
test.describe.configure({ mode: "serial", timeout: 150_000 });

let orgId = "";
let canalId = "";
/** Liberações vivas que já existiam: esta spec as revoga e as devolve no fim. */
let liberacoesDeAntes: string[] = [];

async function semModulo(): Promise<void> {
  await servico
    .from("organization_modules")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("modulo", "disparador")
    .is("revoked_at", null);
}

async function comModulo(): Promise<void> {
  await semModulo();
  const { error } = await servico.from("organization_modules").insert({
    organization_id: orgId,
    modulo: "disparador",
    note: "e2e broadcast-unificado — apagada no fim da spec",
  } as never);
  if (error) throw new Error(`liberar o módulo falhou: ${error.message}`);
}

test.beforeAll(async () => {
  const creds = lerCreds() as unknown as { org_id: string; users: { admin: { email: string } } };
  orgId = creds.org_id;
  // O admin de PLATAFORMA enxerga toda porta, com ou sem módulo: medir o menu com
  // ele seria medir o escape, não o produto.
  await afirmarAdminDeTenantPuro(creds.users.admin.email);

  const { data: vivas } = await servico
    .from("organization_modules")
    .select("id")
    .eq("organization_id", orgId)
    .eq("modulo", "disparador")
    .is("revoked_at", null);
  liberacoesDeAntes = (vivas ?? []).map((l) => (l as { id: string }).id);

  await servico.from("channel_sessions").delete().eq("display_name", CANAL);
  const canal = await servico
    .from("channel_sessions")
    .insert({
      organization_id: orgId,
      display_name: CANAL,
      waha_session_name: `prova-broadcast-${Date.now()}`,
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    })
    .select("id")
    .single();
  if (canal.error) throw new Error(`fixture de número falhou: ${canal.error.message}`);
  canalId = (canal.data as { id: string }).id;

  await servico.from("campaigns").delete().eq("organization_id", orgId).eq("name", CAMPANHA_QR);
  const qr = await servico.from("campaigns").insert({
    organization_id: orgId,
    name: CAMPANHA_QR,
    channel_session_id: canalId,
    base_legal: "consent",
    message_body: "Oi {{primeiro_nome}}",
  });
  if (qr.error) throw new Error(`fixture da campanha por QR falhou: ${qr.error.message}`);

  await servico.from("broadcasts").delete().eq("organization_id", orgId).eq("nome", DISPARO_OFICIAL);
  const oficial = await servico.from("broadcasts").insert({
    organization_id: orgId,
    nome: DISPARO_OFICIAL,
    template_name: "prova_broadcast",
    template_language: "pt_BR",
  });
  if (oficial.error) throw new Error(`fixture do disparo oficial falhou: ${oficial.error.message}`);
});

test.afterAll(async () => {
  await servico.from("broadcasts").delete().eq("organization_id", orgId).eq("nome", DISPARO_OFICIAL);
  await servico.from("campaigns").delete().eq("organization_id", orgId).eq("name", CAMPANHA_QR);
  if (canalId) await servico.from("channel_sessions").delete().eq("id", canalId);
  await servico
    .from("organization_modules")
    .delete()
    .eq("organization_id", orgId)
    .eq("note", "e2e broadcast-unificado — apagada no fim da spec");
  if (liberacoesDeAntes.length > 0) {
    await servico.from("organization_modules").update({ revoked_at: null }).in("id", liberacoesDeAntes);
  }
});

test("sem o módulo, as Campanhas levam ao Broadcast, e ele diz o que a empresa pode usar", async ({ page }) => {
  await semModulo();
  await loginComoAdmin(page, lerCreds());

  await page.goto("/app/crm");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Campanhas/ })).toHaveCount(0);

  if (!QR_EXIGE_O_MODULO) {
    // A chave desligada (a outra posição da proposta): o QR é de todos, e o
    // oficial diz "não contratado" em vez de sumir com a tela.
    await page.goto("/app/campaigns");
    await expect(page).toHaveURL(/\/app\/broadcast$/);
    await expect(page.locator('[data-canal="oficial"]')).toContainText("Não contratado");
    expect((await page.request.get("/api/v1/campaigns")).status()).toBe(200);
    await page.screenshot({ path: evidencia("1-sem-modulo-qr-livre.png"), fullPage: true });
    return;
  }

  // A proposta ligada (docs/fork/broadcast-unificado.md): nenhum dos dois.
  await expect(page.getByRole("link", { name: /^Broadcast/ })).toHaveCount(0);

  // A lista antiga redireciona; a de dentro volta pelo layout.
  await page.goto("/app/campaigns");
  await expect(page).toHaveURL(/\/app\/broadcast$/);
  await expect(page.locator('[data-acesso="nao_contratado"]')).toContainText("não está contratado");
  await page.goto("/app/campaigns/new");
  await expect(page).toHaveURL(/\/app\/broadcast$/);
  await page.screenshot({ path: evidencia("1-sem-modulo.png"), fullPage: true });

  // A trava de verdade: a rota recusa pela sessão do navegador.
  const r = await page.request.get("/api/v1/campaigns");
  expect(r.status()).toBe(403);
  expect(((await r.json()) as { error: { message: string } }).error.message).toContain("não está contratado");
});

test("com o módulo, o Broadcast é a porta única e pergunta por onde sai", async ({ page }) => {
  await comModulo();
  await loginComoAdmin(page, lerCreds());

  // Pela porta, como o usuário: o hub do CRM.
  await page.goto("/app/crm");
  await expect(page.getByRole("link", { name: /^Campanhas/ })).toHaveCount(0);
  await page.getByRole("link", { name: /^Broadcast/ }).first().click();
  await expect(page).toHaveURL(/\/app\/broadcast$/);
  await expect(page.getByRole("heading", { level: 1, name: "Broadcast" })).toBeVisible();

  // O preço de cada caminho, antes de qualquer clique.
  await expect(page.locator('[data-canal="oficial"]')).toContainText("Número oficial (Meta)");
  await expect(page.locator('[data-canal="qr"]')).toContainText("Risco de bloqueio");

  // UMA lista, um disparo de cada motor, cada um com o seu selo e o seu destino.
  const linhaQr = page.locator('a[data-disparo="qr"]', { hasText: CAMPANHA_QR });
  const linhaOficial = page.locator('a[data-disparo="oficial"]', { hasText: DISPARO_OFICIAL });
  await expect(linhaQr).toBeVisible({ timeout: 20_000 });
  await expect(linhaOficial).toBeVisible();
  await expect(linhaQr).toContainText("QR");
  await expect(linhaOficial).toContainText("Oficial");
  await expect(linhaQr).toHaveAttribute("href", /\/app\/campaigns\/[0-9a-f-]+$/);
  await expect(linhaOficial).toHaveAttribute("href", /\/app\/broadcast\/[0-9a-f-]+$/);
  await page.screenshot({ path: evidencia("2-lista-unificada.png"), fullPage: true });

  // O filtro de canal separa os dois.
  await page.locator("#filtro-canal").selectOption("oficial");
  await expect(linhaQr).toHaveCount(0);
  await expect(linhaOficial).toBeVisible();
  await page.locator("#filtro-canal").selectOption("");

  // Novo disparo: a primeira pergunta é por onde sai.
  await page.getByRole("link", { name: "Novo disparo" }).first().click();
  await expect(page).toHaveURL(/\/app\/broadcast\/novo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Novo disparo" })).toBeVisible();
  await expect(page.locator('[data-canal="oficial"] [data-custo]')).toContainText(/Custo|Não contratado/);
  await expect(page.locator('[data-canal="qr"] [data-risco]')).toContainText("bloquear o número");
  // O cartão do QR diz qual número escolher lá: o formulário do upstream oferece todos.
  await expect(page.locator('[data-canal="qr"]')).toContainText(CANAL);
  await page.screenshot({ path: evidencia("3-novo-disparo.png"), fullPage: true });

  // Número oficial: o formulário aparece aqui mesmo, em seções.
  await page.getByRole("button", { name: "Usar o número oficial" }).click();
  await expect(page.getByRole("heading", { name: "Mensagem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Montar lista" })).toBeVisible();
  await page.screenshot({ path: evidencia("4-formulario-oficial.png"), fullPage: true });

  // Número por QR: o formulário do upstream, embrulhado na faixa do Broadcast.
  await page.getByRole("link", { name: "Usar o número por QR" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/new$/);
  const faixa = page.locator('[data-faixa="broadcast-qr"]');
  await expect(faixa).toBeVisible();
  await expect(faixa).toContainText("bloquear o número");
  await expect(page.getByRole("heading", { level: 1, name: "Nova campanha" })).toBeVisible();
  await page.screenshot({ path: evidencia("5-formulario-qr.png"), fullPage: true });

  // E a faixa traz de volta.
  await faixa.getByRole("link", { name: "Broadcast" }).click();
  await expect(page).toHaveURL(/\/app\/broadcast$/);

  // Quem tem o módulo também cai no Broadcast pela lista antiga; e a API abre.
  await page.goto("/app/campaigns");
  await expect(page).toHaveURL(/\/app\/broadcast$/);
  expect((await page.request.get("/api/v1/campaigns")).status()).toBe(200);
});

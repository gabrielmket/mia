/**
 * O PRODUTO OU SERVIÇO NO NEGÓCIO, PELA TELA (.109, docs/fork/produto-no-negocio.md).
 *
 * ─── O que só a tela responde ───────────────────────────────────────────────
 *
 * As regras têm prova de unidade (`tests/unit/produto-no-negocio-*.test.ts`):
 * a soma, o valor à mão, o preço congelado, a recusa do ganho sem item. O que
 * a unidade não alcança é a cadeia inteira: o catálogo no banco → a busca do
 * bloco (`GET /api/v1/products`) → o rascunho → `PUT /api/v1/leads/[id]/itens`
 * → `mia_itens_do_negocio` e `crm_leads.value_cents` / `valor_a_mao`. E a janela
 * de ganho, que grava os itens ANTES do `/win` de sempre.
 *
 * Três casos:
 *  1. Editar negócio: buscar no catálogo, quantidade, desconto, a soma que vira
 *     o valor; o preço que fica congelado quando o catálogo muda; o valor
 *     digitado à mão que para de somar; tirar um item e "Usar a soma".
 *  2. Ganho com "Pedir o tratamento ao marcar como ganho" LIGADO: o `/win` sem
 *     item é recusado no servidor (422), a janela não confirma sem item, e
 *     confirmar com o item escolhido ali grava o item, o valor e o motivo.
 *  3. Ganho com a opção DESLIGADA (a chave ausente do `settings`, como nos funis
 *     que já existiam): a janela avisa e deixa fechar sem item; o negócio de
 *     antes dos itens (`valor_a_mao` nulo) fecha sem nada regravado.
 *
 * Fora daqui, de propósito (a descrição da MIA-8): o mover em lote e o Novo
 * negócio, que não têm o bloco (seção 11 do documento).
 *
 * ─── Por que tudo é semeado ─────────────────────────────────────────────────
 *
 * Os funis, as etapas, os dois produtos do catálogo e os negócios são DESTA
 * spec, com sufixo próprio, e apagados por ela. Mesmo molde de
 * `motivos-de-perda-do-funil.spec.ts`: o banco do e2e é compartilhado dentro
 * da parte, e mexer no funil ou no catálogo de outra spec é vizinhança quebrada.
 * Dado fictício: a clínica Vita Odonto e a paciente Ana Exemplo.
 *
 * Pré-requisitos (banco local do baseline, app buildada):
 *   pnpm e2e:env && pnpm e2e:build
 *   pnpm exec playwright test tests/e2e/itens-do-negocio.spec.ts
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Locator, type Page } from "./helpers/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA =
  process.env.E2E_EVIDENCIA_ITENS ?? path.join(process.cwd(), "evidence/itens-do-negocio");

interface Creds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let creds: Creds;
const SUFIXO = `${Date.now()}`.slice(-7);
/** O prefixo que a limpeza procura: funis e códigos do catálogo desta spec. */
const PREFIXO_DO_FUNIL = "Itens E2E";
const PREFIXO_DO_CODIGO = "VITA-E2E-";

/** A palavra do funil da clínica (decisão 1 do documento). */
const PALAVRA = "Tratamento";

const LIMPEZA = { nome: `Limpeza Vita ${SUFIXO}`, codigo: `${PREFIXO_DO_CODIGO}LIMP-${SUFIXO}`, preco: 25_000 };
const CLAREAMENTO = { nome: `Clareamento Vita ${SUFIXO}`, codigo: `${PREFIXO_DO_CODIGO}CLAR-${SUFIXO}`, preco: 90_000 };

const TITULO_EDICAO = `Ana Exemplo · Vita Odonto ${SUFIXO}`;
const TITULO_PEDE = `Ana Exemplo · ganho pede ${SUFIXO}`;
const TITULO_OPCIONAL = `Ana Exemplo · ganho opcional ${SUFIXO}`;

let funilPedeId = "";
let funilOpcionalId = "";
let limpezaId = "";
let clareamentoId = "";
let leadEdicaoId = "";
let leadPedeId = "";
let leadOpcionalId = "";

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function captura(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function limparFixtures(): Promise<void> {
  const { data } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", creds.org_id)
    .like("name", `${PREFIXO_DO_FUNIL} %`);
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length > 0) {
    await admin.from("crm_lead_activities").delete().in("pipeline_id", ids);
    // `mia_itens_do_negocio` cai junto com o negócio (on delete cascade).
    await admin.from("crm_leads").delete().in("pipeline_id", ids);
    await admin.from("crm_stages").delete().in("pipeline_id", ids);
    await admin.from("crm_pipelines").delete().in("id", ids);
  }
  await admin
    .from("catalog_products")
    .delete()
    .eq("organization_id", creds.org_id)
    .like("codigo", `${PREFIXO_DO_CODIGO}%`);
}

async function criarFunil(nome: string, slug: string, settings: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin
    .from("crm_pipelines")
    .insert({
      organization_id: creds.org_id,
      name: nome,
      slug,
      vocabulary: { produto: PALAVRA },
      settings,
    })
    .select("id")
    .single();
  if (error) throw new Error(`funil ${nome}: ${error.message}`);
  const id = (data as { id: string }).id;
  for (const [etapa, posicao, ganho] of [
    ["Avaliação", 1000, false],
    ["Fechado", 2000, true],
  ] as [string, number, boolean][]) {
    const { error: erroEtapa } = await admin.from("crm_stages").insert({
      organization_id: creds.org_id,
      pipeline_id: id,
      name: etapa,
      slug: `${slug}-${ganho ? "ganho" : "aberto"}`,
      position: posicao,
      is_won: ganho,
    });
    if (erroEtapa) throw new Error(`etapa ${etapa}: ${erroEtapa.message}`);
  }
  return id;
}

async function etapaAberta(pipelineId: string): Promise<string> {
  const { data, error } = await admin
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("is_won", false)
    .single();
  if (error) throw new Error(`etapa aberta: ${error.message}`);
  return (data as { id: string }).id;
}

async function criarNegocio(pipelineId: string, titulo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("crm_leads")
    .insert({
      organization_id: creds.org_id,
      pipeline_id: pipelineId,
      stage_id: await etapaAberta(pipelineId),
      title: titulo,
      position_in_stage: 1000,
      source: "manual",
      currency: "BRL",
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw new Error(`negócio ${titulo}: ${error.message}`);
  return (data as { id: string }).id;
}

async function criarProduto(p: { nome: string; codigo: string; preco: number }): Promise<string> {
  const { data, error } = await admin
    .from("catalog_products")
    .insert({
      organization_id: creds.org_id,
      codigo: p.codigo,
      nome: p.nome,
      preco_cents: p.preco,
      moeda: "BRL",
      controla_estoque: false,
      ativo: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`produto ${p.nome}: ${error.message}`);
  return (data as { id: string }).id;
}

/** Abre o menu do cartão certo (o funil tem mais de um cartão). */
async function menuDoCartao(page: Page, titulo: string): Promise<void> {
  const cartao = page.getByRole("group", { name: `Negócio: ${titulo}` });
  await expect(cartao).toBeVisible({ timeout: 30_000 });
  await cartao.getByRole("button", { name: "Ações do negócio" }).click();
}

/**
 * Busca no catálogo e escolhe o produto. Depois fecha a lista: ela fica aberta
 * enquanto a busca tem o foco e cobre os botões dos itens logo abaixo.
 */
async function escolherNoCatalogo(onde: Locator, nome: string): Promise<void> {
  const busca = onde.getByRole("combobox", { name: `Buscar ${PALAVRA.toLowerCase()} no catálogo` });
  await busca.fill(nome);
  await onde.getByRole("option", { name: new RegExp(nome) }).click();
  await busca.blur();
  await expect(onde.getByRole("listbox")).toBeHidden();
}

function itemNaTela(onde: Locator, nome: string): Locator {
  return onde.getByTestId("itens-do-negocio").getByRole("listitem").filter({ hasText: nome });
}

async function itensGravados(leadId: string) {
  const { data, error } = await admin
    .from("mia_itens_do_negocio")
    .select("product_id, nome, preco_unitario_cents, quantidade, desconto_cents")
    .eq("lead_id", leadId)
    .order("position");
  if (error) throw new Error(`itens: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((i) => ({
    product_id: i.product_id,
    nome: i.nome,
    preco_unitario_cents: Number(i.preco_unitario_cents),
    quantidade: Number(i.quantidade),
    desconto_cents: Number(i.desconto_cents),
  }));
}

async function valorDoNegocio(leadId: string) {
  const { data, error } = await admin
    .from("crm_leads")
    .select("value_cents, valor_a_mao, status, won_reason")
    .eq("id", leadId)
    .single();
  if (error) throw new Error(`negócio: ${error.message}`);
  const d = data as { value_cents: number | string | null; valor_a_mao: boolean | null; status: string; won_reason: string | null };
  return { ...d, value_cents: d.value_cents === null ? null : Number(d.value_cents) };
}

const respostaDosItens = (page: Page, leadId: string) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/v1/leads/${leadId}/itens`) && r.request().method() === "PUT");
const respostaDoGanho = (page: Page, leadId: string) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/v1/leads/${leadId}/win`) && r.request().method() === "POST");

test.describe("Produto ou serviço no negócio — o bloco de itens e a janela de ganho", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    // O worker reinicia depois de um vermelho e o `beforeAll` volta com outro
    // SUFIXO: sem esta linha as sobras da execução anterior ficam no banco.
    await limparFixtures();

    limpezaId = await criarProduto(LIMPEZA);
    clareamentoId = await criarProduto(CLAREAMENTO);

    funilPedeId = await criarFunil(`${PREFIXO_DO_FUNIL} pede ${SUFIXO}`, `itens-e2e-pede-${SUFIXO}`, {
      pedir_produto_no_ganho: true,
    });
    // Sem a chave: é o funil que já existia antes da .109 (regra 5).
    funilOpcionalId = await criarFunil(`${PREFIXO_DO_FUNIL} opcional ${SUFIXO}`, `itens-e2e-opcional-${SUFIXO}`, {});

    leadEdicaoId = await criarNegocio(funilOpcionalId, TITULO_EDICAO);
    leadPedeId = await criarNegocio(funilPedeId, TITULO_PEDE);
    // O negócio de antes dos itens: valor digitado e a marca NULA (regra 3).
    leadOpcionalId = await criarNegocio(funilOpcionalId, TITULO_OPCIONAL, { value_cents: 50_000, valor_a_mao: null });
  });

  test.afterAll(async () => {
    await limparFixtures();
  });

  test("Editar negócio: a soma dos itens vira o valor, o preço fica congelado e o valor à mão para de somar", async ({
    page,
  }) => {
    await login(page, creds.users.manager!.email, creds.password);
    await page.goto(`/app/pipelines/${funilOpcionalId}`);

    const abrirEdicao = async () => {
      await menuDoCartao(page, TITULO_EDICAO);
      await page.getByRole("menuitem", { name: "Editar" }).click();
      const dialogo = page.getByRole("dialog", { name: "Editar negócio" });
      await expect(dialogo.getByTestId("bloco-de-itens")).toBeVisible({ timeout: 30_000 });
      return dialogo;
    };
    const salvar = async (dialogo: Locator) => {
      const gravou = respostaDosItens(page, leadEdicaoId);
      await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
      expect((await gravou).status(), "a rota dos itens grava a lista e o valor").toBe(200);
      await expect(dialogo).toBeHidden({ timeout: 30_000 });
    };

    // ── 1. BUSCAR NO CATÁLOGO, QUANTIDADE, DESCONTO E A SOMA ───────────────
    let dialogo = await abrirEdicao();
    await expect(dialogo.getByRole("heading", { name: "Tratamentos" })).toBeVisible();
    await expect(dialogo.getByText("Nenhum tratamento ainda.", { exact: false })).toBeVisible();

    await escolherNoCatalogo(dialogo, LIMPEZA.nome);
    await expect(dialogo.getByTestId("soma-dos-itens")).toHaveText(/250,00/);
    await expect(dialogo.getByTestId("valor-do-negocio"), "o Valor é a soma, só leitura").toHaveValue("250,00");

    await dialogo.getByRole("button", { name: `Aumentar a quantidade de ${LIMPEZA.nome}` }).click();
    await expect(dialogo.getByRole("textbox", { name: `Quantidade de ${LIMPEZA.nome}` })).toHaveValue("2");
    await escolherNoCatalogo(dialogo, CLAREAMENTO.nome);
    await itemNaTela(dialogo, LIMPEZA.nome).getByLabel(/Desconto/).fill("50");

    await expect(itemNaTela(dialogo, LIMPEZA.nome), "2 × 250,00 − 50,00").toContainText("450,00");
    await expect(dialogo.getByTestId("soma-dos-itens")).toHaveText(/1\.350,00/);
    await expect(dialogo.getByTestId("valor-do-negocio")).toHaveValue("1350,00");
    await captura(page, "01-editar-negocio-soma");
    await salvar(dialogo);

    // A prova é no banco: o preço do catálogo do dia, a quantidade e o desconto
    // do negócio, e o valor que é a soma (marca de "à mão" desligada).
    expect(await itensGravados(leadEdicaoId)).toEqual([
      { product_id: limpezaId, nome: LIMPEZA.nome, preco_unitario_cents: 25_000, quantidade: 2, desconto_cents: 5_000 },
      { product_id: clareamentoId, nome: CLAREAMENTO.nome, preco_unitario_cents: 90_000, quantidade: 1, desconto_cents: 0 },
    ]);
    expect(await valorDoNegocio(leadEdicaoId)).toMatchObject({ value_cents: 135_000, valor_a_mao: false });

    // ── 2. O PREÇO FICA CONGELADO QUANDO O CATÁLOGO MUDA (regra 1) ─────────
    const { error: erroPreco } = await admin.from("catalog_products").update({ preco_cents: 30_000 }).eq("id", limpezaId);
    if (erroPreco) throw new Error(`preço: ${erroPreco.message}`);

    dialogo = await abrirEdicao();
    await expect(itemNaTela(dialogo, LIMPEZA.nome), "o item mostra o preço do dia em que entrou").toContainText("250,00 no catálogo");
    await expect(dialogo.getByTestId("soma-dos-itens")).toHaveText(/1\.350,00/);

    // ── 3. O VALOR DIGITADO À MÃO PARA DE SOMAR (regra 2) ──────────────────
    await dialogo.getByRole("button", { name: "Digitar o valor à mão" }).click();
    await dialogo.getByTestId("valor-do-negocio").fill("1500,00");
    await expect(dialogo.getByText("Digitado à mão:")).toBeVisible();
    await expect(dialogo.getByRole("button", { name: "Usar a soma" })).toBeVisible();
    await captura(page, "02-editar-negocio-valor-a-mao");
    await salvar(dialogo);
    expect(await valorDoNegocio(leadEdicaoId)).toMatchObject({ value_cents: 150_000, valor_a_mao: true });

    // ── 4. TIRAR UM ITEM NÃO MEXE NO VALOR À MÃO; "USAR A SOMA" VOLTA ──────
    dialogo = await abrirEdicao();
    await expect(dialogo.getByTestId("valor-do-negocio")).toHaveValue("1500,00");
    await dialogo.getByRole("button", { name: `Tirar ${CLAREAMENTO.nome}` }).click();
    await expect(dialogo.getByTestId("soma-dos-itens")).toHaveText(/450,00/);
    await expect(dialogo.getByTestId("valor-do-negocio"), "à mão, o valor não acompanha o item").toHaveValue("1500,00");
    await dialogo.getByRole("button", { name: "Usar a soma" }).click();
    await expect(dialogo.getByTestId("valor-do-negocio")).toHaveValue("450,00");
    await salvar(dialogo);

    expect(await itensGravados(leadEdicaoId)).toEqual([
      { product_id: limpezaId, nome: LIMPEZA.nome, preco_unitario_cents: 25_000, quantidade: 2, desconto_cents: 5_000 },
    ]);
    expect(await valorDoNegocio(leadEdicaoId)).toMatchObject({ value_cents: 45_000, valor_a_mao: false });
  });

  test("ganho com \"pedir\" ligado: o servidor recusa sem item e a janela só confirma com um", async ({ page }) => {
    await login(page, creds.users.manager!.email, creds.password);

    // ── 1. QUEM CHEGA POR FORA DA JANELA É RECUSADO NO SERVIDOR ────────────
    const recusa = await page.request.post(`/api/v1/leads/${leadPedeId}/win`, {
      data: {},
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(recusa.status(), "sem item, o /win recusa com a opção ligada").toBe(422);
    expect(((await recusa.json()) as { error: { code: string } }).error.code).toBe("produto_exigido_no_ganho");
    expect((await valorDoNegocio(leadPedeId)).status).toBe("open");

    // ── 2. A JANELA NÃO CONFIRMA SEM ITEM ──────────────────────────────────
    await page.goto(`/app/pipelines/${funilPedeId}`);
    await menuDoCartao(page, TITULO_PEDE);
    await page.getByRole("menuitem", { name: "Marcar como ganho" }).click();
    const janela = page.getByTestId("janela-do-ganho");
    await expect(janela.getByTestId("aviso-sem-produto")).toContainText("Este negócio ainda não tem tratamento.", {
      timeout: 30_000,
    });
    await expect(janela.getByTestId("confirmar-ganho")).toBeDisabled();
    await expect(janela.getByText("Escolha pelo menos um tratamento para confirmar.")).toBeVisible();
    await captura(page, "03-ganho-pede-sem-item");

    // ── 3. COM O ITEM ESCOLHIDO NA JANELA, CONFIRMA E GRAVA TUDO ───────────
    await escolherNoCatalogo(janela, CLAREAMENTO.nome);
    await expect(janela.getByTestId("valor-do-negocio")).toHaveValue("900,00");
    await expect(janela.getByTestId("confirmar-ganho")).toBeEnabled();
    await janela.getByLabel("Motivo do ganho (opcional)").fill("Indicação de paciente");
    await captura(page, "04-ganho-pede-com-item");

    const gravou = respostaDosItens(page, leadPedeId);
    const ganhou = respostaDoGanho(page, leadPedeId);
    await janela.getByTestId("confirmar-ganho").click();
    expect((await gravou).status(), "os itens gravam antes do ganho").toBe(200);
    expect((await ganhou).status(), "com o item, o /win passa").toBe(200);
    await expect(janela).toBeHidden({ timeout: 30_000 });

    expect(await itensGravados(leadPedeId)).toEqual([
      { product_id: clareamentoId, nome: CLAREAMENTO.nome, preco_unitario_cents: 90_000, quantidade: 1, desconto_cents: 0 },
    ]);
    expect(await valorDoNegocio(leadPedeId)).toMatchObject({
      status: "won",
      won_reason: "Indicação de paciente",
      value_cents: 90_000,
      valor_a_mao: false,
    });
  });

  test("ganho com \"pedir\" desligado: fecha sem item e o negócio de antes dos itens não é regravado", async ({
    page,
  }) => {
    await login(page, creds.users.manager!.email, creds.password);
    const gravacoes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes(`/api/v1/leads/${leadOpcionalId}/itens`)) gravacoes.push(r.url());
    });

    await page.goto(`/app/pipelines/${funilOpcionalId}`);
    await menuDoCartao(page, TITULO_OPCIONAL);
    await page.getByRole("menuitem", { name: "Marcar como ganho" }).click();
    const janela = page.getByTestId("janela-do-ganho");
    await expect(janela.getByTestId("aviso-sem-produto")).toContainText("Neste funil escolher é opcional", {
      timeout: 30_000,
    });
    // O valor que ele tinha, à mão, com a frase própria (regra 3).
    await expect(janela.getByTestId("valor-do-negocio")).toHaveValue("500,00");
    await expect(janela.getByText("Negócio de antes dos tratamentos:")).toBeVisible();
    await expect(janela.getByTestId("confirmar-ganho")).toBeEnabled();
    await captura(page, "05-ganho-opcional-sem-item");

    const ganhou = respostaDoGanho(page, leadOpcionalId);
    await janela.getByTestId("confirmar-ganho").click();
    expect((await ganhou).status(), "desligado, o /win passa sem item").toBe(200);
    await expect(janela).toBeHidden({ timeout: 30_000 });

    expect(gravacoes, "confirmar sem mexer no bloco não grava os itens").toEqual([]);
    expect(await itensGravados(leadOpcionalId)).toEqual([]);
    expect(await valorDoNegocio(leadOpcionalId)).toMatchObject({ status: "won", value_cents: 50_000, valor_a_mao: null });
  });
});

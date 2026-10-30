/**
 * E2E [P0] FORK MIA (.98): o cupom do parceiro, pela tela (docs/fork/cupons-e-parceiros.md).
 * As contas da comissão estão em tests/invariants/cupons-e-parceiros.test.ts. Aqui, só
 * o que depende de navegador:
 *   1. a Time cria o parceiro e o cupom pelas telas do Admin;
 *   2. o visitante do link vê o preço com desconto e o preço cheio riscado;
 *   3. o cupom fica guardado no navegador e chega ao cadastro sem estar no link;
 *   4. cupom que não existe não dá desconto nem derruba a página;
 *   5. as telas de repasses, módulos dos planos e ficha da empresa abrem sem erro.
 * Self-contida: tudo morre no `finally`, e as chaves da instalação voltam ao que eram.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { test, expect, type BrowserContext } from "./helpers/test";
import { criarPessoa, db, entrar, fotografarChaves, inserir, restaurarChaves, type FotoDasChaves } from "./helpers/cobranca";
import { gerarCnpj } from "./fixtures/provedor-de-cobranca-asaas";

const sufixo = randomUUID().slice(0, 8);
const EVIDENCIA = "evidence/cupons-e-parceiros";
const PLANO = `Plano Cupom E2E ${sufixo}`;
const CODIGO = `E2E${sufixo.toUpperCase()}`;
const NOME_DO_PARCEIRO = `Parceiro E2E ${sufixo}`;

test("[P0] cupom do parceiro: criado no Admin, desconto no link e guardado até o cadastro", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(EVIDENCIA, { recursive: true });
  const pessoas: string[] = [];
  const orgs: string[] = [];
  const contextos: BrowserContext[] = [];
  const errosDePagina: string[] = [];
  let planoId: string | null = null;
  let falhaDoCenario: unknown;
  const foto: FotoDasChaves = await fotografarChaves();
  page.on("pageerror", (e) => errosDePagina.push(e.message));

  try {
    // ── 0. Semente ──────────────────────────────────────────────────────
    const ligar = await db.from("platform_config").upsert(
      { chave: "MODULO_COBRANCA", valor: "ligado", eh_segredo: false, semeado_do_env: false },
      { onConflict: "chave" },
    );
    if (ligar.error) throw ligar.error;

    const dono = await criarPessoa("dono-cupom", sufixo);
    pessoas.push(dono.id);
    const org = await inserir("organizations", { slug: `cupom-e2e-${sufixo}`, display_name: `Time Cupom ${sufixo}`, legal_name: `Time Cupom ${sufixo}`, onboarded_at: new Date().toISOString() });
    orgs.push(org);
    const vinc = await db.from("user_organizations").insert({ organization_id: org, user_id: dono.id, role: "admin", accepted_at: new Date().toISOString() });
    if (vinc.error) throw vinc.error;
    const pa = await db.from("platform_admins").insert({ user_id: dono.id, granted_by: dono.id, scope: "full", mfa_required: false, reason: "E2E cupons e parceiros" });
    if (pa.error) throw pa.error;
    planoId = await inserir("cobranca_planos", { nome: PLANO, preco_cents: 10000, intervalo: "mes", trial_dias: 0, updated_by: dono.id });

    // ── 1. A Time cria o parceiro e o cupom pelas telas ─────────────────
    await entrar(page, dono.email);
    await page.goto("/admin/parceiros");
    await expect(page.getByRole("heading", { name: "Parceiros", exact: true })).toBeVisible();
    await page.locator('[data-parceiros="novo"]').click();
    await page.locator("#parceiro-nome").fill(NOME_DO_PARCEIRO);
    await page.locator("#parceiro-doc").fill(gerarCnpj());
    await page.locator("#parceiro-email").fill(`parceiro-${sufixo}@invariant.test`);
    await page.locator("#parceiro-pix").fill(`parceiro-${sufixo}@invariant.test`);
    await page.locator("#parceiro-comissao").fill("10");
    await page.locator('[data-parceiros="salvar"]').click();
    let parceiroId: string | null = null;
    await expect.poll(async () => {
      const r = await db.from("mia_parceiros").select("id").eq("nome", NOME_DO_PARCEIRO).maybeSingle();
      if (r.error) throw r.error;
      parceiroId = (r.data as { id: string } | null)?.id ?? null;
      return parceiroId;
    }, { message: "o parceiro não foi salvo pela tela", timeout: 20_000 }).not.toBeNull();
    await page.screenshot({ path: `${EVIDENCIA}/1-parceiros.png`, fullPage: true });

    await page.goto("/admin/cupons");
    await expect(page.getByRole("heading", { name: "Cupons", exact: true })).toBeVisible();
    await page.locator('[data-cupons="novo"]').click();
    await page.locator("#cupom-codigo").fill(CODIGO);
    await page.locator("#cupom-beneficio").selectOption("pct");
    await page.locator("#cupom-valor").fill("20");
    await page.locator("#cupom-meses").selectOption("3");
    await page.getByRole("checkbox", { name: PLANO }).check();
    await page.locator("#cupom-parceiro").selectOption(parceiroId as unknown as string);
    await page.locator('[data-cupons="salvar"]').click();
    await expect(page.locator(`[data-cupom="${CODIGO}"]`), "o cupom criado não apareceu na lista").toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/2-cupons.png`, fullPage: true });

    // ── 2. O visitante do link vê o desconto ────────────────────────────
    const visitante = await browser.newContext({ baseURL });
    contextos.push(visitante);
    const pv = await visitante.newPage();
    pv.on("pageerror", (e) => errosDePagina.push(e.message));
    await pv.goto(`/precos?cupom=${CODIGO}`);
    await expect(pv.getByText(PLANO).first()).toBeVisible();
    await expect(pv.getByText(/R\$\s*80,00/).first(), "o preço com o cupom de 20%").toBeVisible();
    await expect(pv.locator(".line-through", { hasText: /R\$\s*100,00/ }).first(), "o preço cheio riscado").toBeVisible();
    await pv.screenshot({ path: `${EVIDENCIA}/3-precos-com-cupom.png`, fullPage: true });

    // ── 3. O cupom fica guardado e chega ao cadastro sem estar no link ──
    await expect.poll(async () => (await visitante.cookies()).some((c) => c.value === CODIGO), {
      message: "o cupom não ficou guardado no navegador",
      timeout: 10_000,
    }).toBe(true);
    await pv.goto(`/signup?plano=${planoId}`);
    await expect(pv.getByText(CODIGO).first(), "o cupom guardado não chegou ao cadastro").toBeVisible();
    const cartaoDoPlano = pv.locator(`[data-plano-do-cadastro="${planoId}"]`);
    await expect(cartaoDoPlano.getByText(/R\$\s*80,00/), "o cartão do plano sem o preço com o cupom").toBeVisible();
    await expect(cartaoDoPlano.locator(".line-through", { hasText: /R\$\s*100,00/ }), "o cartão do plano sem o preço cheio riscado").toBeVisible();
    await pv.screenshot({ path: `${EVIDENCIA}/4-cadastro-com-cupom.png`, fullPage: true });

    // ── 4. Cupom que não existe não dá desconto nem derruba a página ────
    const outro = await browser.newContext({ baseURL });
    contextos.push(outro);
    const po = await outro.newPage();
    po.on("pageerror", (e) => errosDePagina.push(e.message));
    await po.goto(`/precos?cupom=NAOEXISTE${sufixo.toUpperCase()}`);
    await expect(po.getByText(PLANO).first()).toBeVisible();
    // Sem cupom, o preço do cartão sai sem os centavos.
    await expect(po.getByText(/R\$\s*100(?![\d.])/).first()).toBeVisible();
    await expect(po.getByText(/R\$\s*80,00/)).toHaveCount(0);

    // ── 5. As outras telas abrem sem erro ───────────────────────────────
    await page.goto("/admin/parceiros/repasses");
    await expect(page.getByRole("heading", { name: "Repasses do mês", exact: true })).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/5-repasses.png`, fullPage: true });
    for (const rota of ["/admin/cobranca/modulos-dos-planos", `/admin/tenants/${org}`]) {
      const r = await page.goto(rota);
      expect(r?.status(), `${rota} não abriu`).toBeLessThan(400);
      await expect(page.getByText(/algo deu errado|something went wrong/i)).toHaveCount(0);
    }
    await page.screenshot({ path: `${EVIDENCIA}/6-ficha-da-empresa.png`, fullPage: true });

    expect(errosDePagina, "erro de JavaScript nas telas do cupom").toEqual([]);
  } catch (e) {
    falhaDoCenario = e;
    throw e;
  } finally {
    const errosDaLimpeza: unknown[] = [];
    for (const c of contextos) await c.close().catch((e) => errosDaLimpeza.push(e));
    try {
      const cupons = await db.from("mia_cupons").delete().eq("codigo", CODIGO);
      if (cupons.error) throw cupons.error;
      const parceiros = await db.from("mia_parceiros").delete().eq("nome", NOME_DO_PARCEIRO);
      if (parceiros.error) throw parceiros.error;
      if (planoId) {
        const planos = await db.from("cobranca_planos").delete().eq("id", planoId);
        if (planos.error) throw planos.error;
      }
      for (const id of orgs) {
        const r = await db.from("organizations").delete().eq("id", id);
        if (r.error) throw r.error;
      }
      const pa = await db.from("platform_admins").delete().in("user_id", pessoas);
      if (pa.error) throw pa.error;
      for (const id of pessoas) {
        const r = await db.auth.admin.deleteUser(id);
        if (r.error) throw r.error;
      }
      await restaurarChaves(foto);
    } catch (e) {
      errosDaLimpeza.push(e);
    }
    if (errosDaLimpeza.length) {
      const motivos = errosDaLimpeza.map((e) => (e instanceof Error ? e.message : String(e))).join(" | ");
      test.info().annotations.push({ type: "cleanup", description: `limpeza incompleta: ${motivos}` });
      if (!falhaDoCenario) console.warn(`[cupons-e-parceiros] limpeza incompleta: ${motivos}`);
    }
  }
});

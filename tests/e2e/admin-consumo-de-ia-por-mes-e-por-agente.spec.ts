/**
 * O CONSUMO DE IA POR MÊS E POR AGENTE, PELA TELA DO DONO DO SERVIDOR (MIA-44).
 *
 * O Gabriel quer saber, pelo painel, quanto cada cliente gastou de IA no MÊS
 * PASSADO e NESTE MÊS, com cada agente separado e o que é do sistema à parte.
 *
 * ═══ O QUE ESTA SPEC PROVA ═══
 *
 *  - A aba Uso da Academia Alfa (fictícia, 2 agentes) em "Este mês": cada
 *    agente na sua linha, a linha "Sistema" com as chamadas sem agente, a
 *    finalidade `checkpoint` separada, e o custo em US$ e em R$.
 *  - A mesma aba em "Mês passado": só as chamadas do mês passado, e o agente
 *    sem chamada aparece com zero.
 *  - `/admin/usage` em "Este mês" e em "Mês passado": a linha da Academia Alfa
 *    com o custo de cada mês.
 *
 * O navegador roda no fuso de Brasília; o mês é o do calendário de Brasília.
 *
 * ═══ O QUE ESTA SPEC NÃO PROVA ═══
 *
 *  - A virada do mês às 21h UTC, a paginação e a conversão dia a dia:
 *    `tests/unit/consumo-de-ia-por-mes-e-por-agente.test.ts` e
 *    `tests/unit/consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx`.
 *  - O valor exato em R$: a cotação é da instalação (`platform_fx_rates`), e
 *    outras specs podem ter gravado dias. Aqui só se confere que o R$ aparece.
 *
 * A organização e os agentes semeados saem no fim (as chamadas caem com a
 * organização). A cotação semeada, só se foi esta spec que a gravou.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/test";

import { janelaDoMes } from "@/lib/crm/metas/fuso";
import { FUSO_DO_CONSUMO, mesAtualEAnterior } from "@/lib/ai/usage/consumo-do-periodo";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const { url, serviceRole } = credenciaisSupabaseDeTeste();
const db = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

const EVIDENCIA = path.join(process.cwd(), "evidence", "admin-consumo-de-ia-por-mes");
const SUFIXO = Date.now().toString(36);
const SLUG = `e2e-academia-alfa-consumo-${SUFIXO}`;
const NOME = "Academia Alfa";

let orgId = "";
let recepcao = "";
let matriculas = "";
let cotacaoSemeada: string | null = null;

test.use({ locale: "pt-BR", timezoneId: FUSO_DO_CONSUMO });
test.describe.configure({ timeout: 240_000 });

async function foto(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function semearAgente(nome: string, prioridade: number): Promise<string> {
  const { data, error } = await db
    .from("ai_agents")
    .insert({ organization_id: orgId, name: nome, system_prompt: "Agente fictício do E2E.", priority: prioridade })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ai_agents: ${error?.message}`);
  return (data as { id: string }).id;
}

/**
 * Um instante dentro do mês ATUAL de Brasília e no passado: um minuto atrás, ou
 * logo depois da meia-noite do dia 1º, se a rodada cair no primeiro minuto do mês.
 */
function nesteMes(i: number): string {
  const inicio = Date.parse(janelaDoMes(mesAtualEAnterior().atual, FUSO_DO_CONSUMO).inicio);
  return new Date(Math.max(inicio + 1_000 + i, Date.now() - 60_000 - i * 1_000)).toISOString();
}

/** O dia 10 do mês passado, ao meio-dia de Brasília, mais `i` segundos. */
function noMesPassado(i: number): string {
  const inicio = Date.parse(janelaDoMes(mesAtualEAnterior().anterior, FUSO_DO_CONSUMO).inicio);
  return new Date(inicio + 9 * 86_400_000 + 12 * 3_600_000 + i * 1_000).toISOString();
}

function chamada(agentId: string | null, purpose: string, centavos: number, created_at: string) {
  return {
    organization_id: orgId,
    agent_id: agentId,
    purpose,
    provider: "openai",
    model: "gpt-4o-mini",
    input_tokens: 1_000,
    output_tokens: 100,
    cache_read_tokens: 400,
    cost_cents: centavos,
    created_at,
  };
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

  recepcao = await semearAgente("Agente Recepção", 10);
  matriculas = await semearAgente("Agente Matrículas", 5);

  // Este mês: Recepção 3 × US$ 0,10, Matrículas 1 × US$ 0,05, Sistema 2 × US$ 0,20.
  // Mês passado: Recepção 1 × US$ 0,07, Sistema 1 × US$ 0,15, Matrículas nada.
  const { error: ce } = await db.from("llm_calls").insert([
    chamada(recepcao, "agent_turn", 10, nesteMes(1)),
    chamada(recepcao, "agent_turn", 10, nesteMes(2)),
    chamada(recepcao, "agent_turn", 10, nesteMes(3)),
    chamada(matriculas, "agent_turn", 5, nesteMes(4)),
    chamada(null, "checkpoint", 20, nesteMes(5)),
    chamada(null, "classifier", 20, nesteMes(6)),
    chamada(recepcao, "agent_turn", 7, noMesPassado(1)),
    chamada(null, "checkpoint", 15, noMesPassado(2)),
  ]);
  if (ce) throw new Error(`llm_calls: ${ce.message}`);

  // Uma cotação antes do mês passado, para o R$ não sair parcial numa instalação
  // sem nenhuma. Só se o dia estiver livre: a tabela é da instalação.
  const dia = janelaDoMes(mesAtualEAnterior().anterior, FUSO_DO_CONSUMO).inicio.slice(0, 10);
  const { data: existe } = await db.from("platform_fx_rates").select("dia").lte("dia", dia).limit(1);
  if (!existe || existe.length === 0) {
    const { error: fe } = await db.from("platform_fx_rates").insert({ dia, usd_brl: 5.5, fonte: "e2e" });
    if (!fe) cotacaoSemeada = dia;
  }
});

test.afterAll(async () => {
  if (cotacaoSemeada) await db.from("platform_fx_rates").delete().eq("dia", cotacaoSemeada).eq("fonte", "e2e");
  if (orgId) await db.from("llm_calls").delete().eq("organization_id", orgId);
  const agentes = [recepcao, matriculas].filter(Boolean);
  if (agentes.length > 0) await db.from("ai_agents").delete().in("id", agentes);
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
});

test("o consumo de IA de este mês e do mês passado, por agente e com o Sistema — pela tela", async ({ page }) => {
  await loginComoDono(page, lerCreds());
  const { atual, anterior } = mesAtualEAnterior();

  /** Escolhe o atalho e espera a resposta da rota daquele mês. */
  async function escolherNaAba(rotulo: string, mes: string): Promise<void> {
    const resposta = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/admin/tenants/${orgId}/usage`) && r.url().includes(`mes=${mes}`),
    );
    await page.getByRole("button", { name: rotulo, exact: true }).click();
    expect((await resposta).status()).toBe(200);
  }

  const linha = (nome: string | RegExp) => page.getByRole("row", { name: nome });

  await test.step("aba Uso em Este mês: cada agente, o Sistema e a finalidade, em US$ e R$", async () => {
    await page.goto(`/admin/tenants/${orgId}/usage`);
    await expect(page.getByRole("button", { name: "Este mês", exact: true })).toBeVisible({ timeout: 30_000 });
    await escolherNaAba("Este mês", atual);
    await expect(page.getByText("Custo de IA por agente")).toBeVisible();

    await expect(linha(/Agente Recepção/)).toContainText("US$ 0,30");
    await expect(linha(/Agente Matrículas/)).toContainText("US$ 0,05");
    await expect(linha(/^Sistema/)).toContainText("US$ 0,40");
    await expect(linha(/^Total/)).toContainText("US$ 0,75");
    await expect(linha(/^Total/)).toContainText(/R\$\s?\d/);
    // Tokens = entrada + saída (6 × 1.100); o cache é parte da entrada (6 × 400).
    await expect(linha(/^Total/)).toContainText("6.600");
    await expect(linha(/^Total/)).toContainText("2.400");
    await expect(linha(/checkpoint/)).toContainText("US$ 0,20");
    await expect(page.getByText(/O valor em R\$ é parcial/)).toHaveCount(0);
    await foto(page, "01-aba-uso-este-mes");
  });

  await test.step("aba Uso em Mês passado: só o mês passado, e o agente sem chamada com zero", async () => {
    await escolherNaAba("Mês passado", anterior);
    await expect(linha(/Agente Recepção/)).toContainText("US$ 0,07");
    await expect(linha(/Agente Matrículas/)).toContainText("US$ 0,00");
    await expect(linha(/^Sistema/)).toContainText("US$ 0,15");
    await expect(linha(/^Total/)).toContainText("US$ 0,22");
    await foto(page, "02-aba-uso-mes-passado");
  });

  await test.step("/admin/usage em Este mês e em Mês passado: a linha da Academia Alfa", async () => {
    await page.goto("/admin/usage");
    const periodo = page.getByRole("combobox").filter({ hasText: "Últimos 30 dias" });
    await expect(periodo).toBeVisible({ timeout: 30_000 });

    for (const [rotulo, mes, custo, nome] of [
      ["Este mês", atual, "US$ 0,75", "03-uso-geral-este-mes"],
      ["Mês passado", anterior, "US$ 0,22", "04-uso-geral-mes-passado"],
    ] as const) {
      const resposta = page.waitForResponse(
        (r) => r.url().includes("/api/v1/admin/usage") && r.url().includes(`mes=${mes}`),
      );
      await page.getByRole("combobox").filter({ hasText: /Últimos 30 dias|Este mês|Mês passado/ }).click();
      await page.getByRole("option", { name: rotulo, exact: true }).click();
      expect((await resposta).status()).toBe(200);
      const daAcademia = page.locator("tr").filter({ hasText: SLUG });
      await expect(daAcademia).toHaveCount(1);
      await expect(daAcademia).toContainText(custo);
      await daAcademia.scrollIntoViewIfNeeded();
      await foto(page, nome);
    }
  });
});

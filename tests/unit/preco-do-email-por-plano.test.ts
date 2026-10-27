/**
 * FORK MIA (.95) · O PREÇO DO E-MAIL POR PLANO (pedido do Gabriel em 27/10/2026:
 * "o valor do disparo de WhatsApp e do e-mail é diferente").
 *
 * O preço por e-mail chega à empresa pelo MESMO caminho do preço por mensagem
 * (lib/planos-mia/preco-por-email.ts): o definido à mão vence; sem ele, o do
 * plano ATUAL da assinatura, com a cobrança ligada; a isenta não tem plano; sem
 * nenhum, o padrão de R$ 0,02. O banco trava a mudança do preço em plano
 * assinado (9110), provado em tests/invariants/jornada-de-assinatura.test.ts.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { lerPrecoPorEmail } from "@/lib/email-marketing/banco";
import { PRECO_PADRAO_POR_EMAIL_CENTS } from "@/lib/email-marketing/regras";
import { mudancasDoLado } from "@/lib/planos-mia/garantir-planos";
import { juntarPlano } from "@/lib/planos-mia/leitura";
import { lerPrecosDaEmpresa, precoPorEmailDaEmpresa } from "@/lib/planos-mia/preco-por-email";
import { precoPorMensagemDaEmpresa } from "@/lib/planos-mia/preco-por-mensagem";
import { planoPublico, seloDoTesteGratis } from "@/lib/planos-mia/publico";
import { bancoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000f5";
const PLANO = "00000000-0000-4000-8000-0000000000f6";
const RAIZ = process.cwd();

interface Mundo {
  cobrancaLigada: boolean;
  /** `null` = a empresa é isenta (sem assinatura). */
  planoDaAssinatura: string | null;
  doPlano: { preco_por_mensagem_cents: number | null; preco_por_email_cents: number | null } | null;
  aMao: { preco_por_mensagem_cents: number | null; preco_por_email_cents: number | null } | null;
  falhaNoPlano?: boolean;
}

function banco(m: Mundo) {
  return bancoLivre((c: CadeiaLivre) => {
    if (c.tabela === "platform_config")
      return { data: m.cobrancaLigada ? [{ chave: "MODULO_COBRANCA", valor: "ligado" }] : [] };
    if (c.tabela === "modulos_instalados") return { data: [] };
    if (c.tabela === "cobranca_assinaturas")
      return { data: m.planoDaAssinatura ? { plano_id: m.planoDaAssinatura } : null };
    if (c.tabela === "mia_plano_modulos")
      return m.falhaNoPlano ? { data: null, error: { code: "XX000", message: "caiu" } } : { data: m.doPlano };
    if (c.tabela === "tenant_broadcast_pricing") return { data: m.aMao };
    if (c.tabela === "cobranca_planos") return { data: { nome: "Profissional" } };
    return { data: null };
  });
}

const tabelas = (b: ReturnType<typeof banco>) => new Set(b.cadeias.map((c) => c.tabela));

describe("o preço por e-mail que vale para a empresa", () => {
  const noPlano = { preco_por_mensagem_cents: 12, preco_por_email_cents: 3 };

  it("⭐ o definido à mão vence o do plano, sem ler o plano", async () => {
    const b = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null });
    expect(await precoPorEmailDaEmpresa(b.cliente as never, ORG, 5)).toEqual({ cents: 5, origem: "combinado" });
    expect(tabelas(b).has("mia_plano_modulos")).toBe(false);
  });

  it("⭐ sem o definido à mão, o do plano da assinatura", async () => {
    const b = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null });
    expect(await precoPorEmailDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: 3, origem: "plano" });
  });

  it("plano que não diz o preço: o padrão de R$ 0,02", async () => {
    const b = banco({
      cobrancaLigada: true,
      planoDaAssinatura: PLANO,
      doPlano: { preco_por_mensagem_cents: 12, preco_por_email_cents: null },
      aMao: null,
    });
    expect(await precoPorEmailDaEmpresa(b.cliente as never, ORG, null)).toEqual({
      cents: PRECO_PADRAO_POR_EMAIL_CENTS,
      origem: "padrao",
    });
    expect(PRECO_PADRAO_POR_EMAIL_CENTS).toBe(2);
  });

  it("⭐ a isenta (sem assinatura) não tem plano: o padrão", async () => {
    const b = banco({ cobrancaLigada: true, planoDaAssinatura: null, doPlano: noPlano, aMao: null });
    expect(await precoPorEmailDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: 2, origem: "padrao" });
    expect(tabelas(b).has("mia_plano_modulos")).toBe(false);
  });

  it("⭐ com a cobrança desligada, nada vem do plano (tudo como antes da .95)", async () => {
    const b = banco({ cobrancaLigada: false, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null });
    expect(await precoPorEmailDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: 2, origem: "padrao" });
    expect(tabelas(b).has("cobranca_assinaturas")).toBe(false);
  });

  it("leitura do plano que falha LANÇA: não cobra o padrão calado de quem tem outro preço", async () => {
    const b = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null, falhaNoPlano: true });
    await expect(precoPorEmailDaEmpresa(b.cliente as never, ORG, null)).rejects.toThrow(/preço do plano/);
    // A mensagem segue como sempre: na dúvida, sem preço (o disparo recusa).
    expect(await precoPorMensagemDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: null, origem: null });
  });

  it("a mensagem segue o MESMO caminho, pela outra coluna", async () => {
    const b = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null });
    expect(await precoPorMensagemDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: 12, origem: "plano" });
  });

  it("⭐ a leitura das campanhas (lerPrecoPorEmail) diz a origem", async () => {
    const pelaMao = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: { preco_por_mensagem_cents: null, preco_por_email_cents: 4 } });
    expect(await lerPrecoPorEmail(pelaMao.cliente as never, ORG)).toEqual({ cents: 4, padrao: false, origem: "combinado" });
    const pelo = banco({ cobrancaLigada: true, planoDaAssinatura: PLANO, doPlano: noPlano, aMao: null });
    expect(await lerPrecoPorEmail(pelo.cliente as never, ORG)).toEqual({ cents: 3, padrao: false, origem: "plano" });
    const padrao = banco({ cobrancaLigada: false, planoDaAssinatura: null, doPlano: null, aMao: null });
    expect(await lerPrecoPorEmail(padrao.cliente as never, ORG)).toEqual({ cents: 2, padrao: true, origem: "padrao" });
  });

  it("a carteira da Time lê os dois preços, o que vale, de onde vem e o nome do plano", async () => {
    const b = banco({
      cobrancaLigada: true,
      planoDaAssinatura: PLANO,
      doPlano: noPlano,
      aMao: { preco_por_mensagem_cents: 15, preco_por_email_cents: null },
    });
    expect(await lerPrecosDaEmpresa(b.cliente as never, ORG)).toEqual({
      plano: "Profissional",
      mensagem: { cents: 15, origem: "combinado", combinado_cents: 15 },
      email: { cents: 3, origem: "plano", combinado_cents: null },
    });
  });
});

describe("o lado nosso do plano leva o preço por e-mail", () => {
  const atual = { modulos: ["email_marketing" as const], preco_por_mensagem_cents: null, preco_por_email_cents: 3, frase: null, destaque: false };

  it("igual não grava; mudado grava só ele; nulo volta ao padrão", () => {
    expect(mudancasDoLado(atual, { preco_por_email_cents: 3 })).toBeNull();
    expect(mudancasDoLado(atual, { preco_por_email_cents: 4 })).toEqual({ preco_por_email_cents: 4 });
    expect(mudancasDoLado(atual, { preco_por_email_cents: null })).toEqual({ preco_por_email_cents: null });
    // O lado lido antes da 9110 (sem a coluna) conta como nulo.
    const { preco_por_email_cents: _semColuna, ...antigo } = atual;
    expect(mudancasDoLado(antigo, { preco_por_email_cents: null })).toBeNull();
  });
});

describe("a vitrine pública e a página de preços", () => {
  const plano = (modulos: Array<"disparador" | "email_marketing">, email: number | null, trial = 14) =>
    juntarPlano(
      {
        id: PLANO,
        nome: "Profissional",
        preco_cents: 59700,
        intervalo: "mes",
        trial_dias: trial,
        max_assentos: 8,
        max_canais: 2,
        teto_ia_usd_cents: 4000,
        padrao_no_cadastro: false,
        oferecido_ao_cliente: true,
        arquivado_em: null,
      },
      { plano_id: PLANO, modulos, preco_por_mensagem_cents: 12, preco_por_email_cents: email, frase: null, destaque: false },
    );

  it("⭐ com e-mail marketing, o preço do plano; sem preço no plano, o padrão (o que a empresa paga)", () => {
    expect(planoPublico(plano(["email_marketing"], 3)).preco_por_email_cents).toBe(3);
    expect(planoPublico(plano(["email_marketing"], null)).preco_por_email_cents).toBe(2);
  });

  it("sem e-mail marketing no plano, o preço por e-mail não sai", () => {
    expect(planoPublico(plano(["disparador"], 3)).preco_por_email_cents).toBeNull();
  });

  it("⭐ o selo do topo só promete teste grátis quando todo plano oferecido tem teste", () => {
    expect(seloDoTesteGratis([{ trial_dias: 14 }, { trial_dias: 14 }])).toBe(14);
    expect(seloDoTesteGratis([{ trial_dias: 14 }, { trial_dias: 7 }])).toBe("todos");
    expect(seloDoTesteGratis([{ trial_dias: 14 }, { trial_dias: 0 }])).toBeNull();
    expect(seloDoTesteGratis([{ trial_dias: 0 }])).toBeNull();
    expect(seloDoTesteGratis([])).toBeNull();
  });

  it("a página de preços mostra o preço por e-mail no cartão e na comparação", () => {
    const pagina = readFileSync(path.join(RAIZ, "app/precos/page.tsx"), "utf8");
    expect(pagina).toContain('t("com e-mail a {preco}")');
    expect(pagina).toContain("p.preco_por_email_cents");
    expect(pagina).toContain("seloDoTesteGratis(planos)");
  });
});

describe("o banco (9110): estender, nunca redefinir", () => {
  const MIGRATION = "supabase/migrations-mia/20261028100000_9110_preco_do_email_por_plano.sql";
  const sql = readFileSync(path.join(RAIZ, MIGRATION), "utf8");
  const baseline = readFileSync(path.join(RAIZ, "supabase/baseline-mia.sql"), "utf8");

  it("a coluna nasce ao lado do preço por mensagem, idempotente, e a trava a leva junto", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- manifest: /);
    expect(sql).toContain("add column if not exists preco_por_email_cents integer");
    expect(sql).toContain("check (preco_por_email_cents is null or preco_por_email_cents between 0 and 100000)");
    expect(sql).toContain("new.preco_por_email_cents is distinct from old.preco_por_email_cents");
    expect(sql).toContain("or old.preco_por_email_cents is not null");
  });

  it("⭐ o baseline-mia carrega o espelho exato, antes da varredura anon", () => {
    const corpo = sql.split("\n").slice(1).join("\n").trim();
    const onde = baseline.indexOf(corpo);
    expect(onde, "o bloco da 9110 não é o espelho exato da migration").toBeGreaterThan(-1);
    expect(onde).toBeLessThan(baseline.lastIndexOf("-- ---- VARREDURA anon:"));
  });
});

/**
 * FORK MIA (MIA-242): o cartão "Enterprise" da página de preços
 * (lib/planos-mia/enterprise.ts). Os limites saem do plano oferecido mais caro,
 * o cartão some com a lista e o número do comercial não mora no código.
 * Número fictício.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cartaoEnterprise,
  limitesDoPlanoMaisAlto,
  linkDoWhatsAppDoComercial,
  VARIAVEL_DO_WHATSAPP_DO_COMERCIAL,
} from "@/lib/planos-mia/enterprise";

const RAIZ = process.cwd();
const FICTICIO = "5511999990000";

const plano = (preco_cents: number, numeros: number | null, pessoas: number | null, conversas_estimadas: number | null) => ({
  preco_cents,
  numeros,
  pessoas,
  conversas_estimadas,
});
const TRES = [plano(29700, 1, 3, 200), plano(59700, 2, 8, 450), plano(99700, 3, 15, 800)];

describe("os limites do cartão vêm do plano mais alto", () => {
  it("⭐ lê conversas, números e pessoas do plano mais caro", () => {
    expect(limitesDoPlanoMaisAlto(TRES)).toEqual({ conversas: 800, numeros: 3, pessoas: 15 });
  });

  it("não depende da ordem da lista", () => {
    expect(limitesDoPlanoMaisAlto([TRES[2]!, TRES[0]!, TRES[1]!])).toEqual({ conversas: 800, numeros: 3, pessoas: 15 });
  });

  it("mudou o plano, a frase muda junto", () => {
    expect(limitesDoPlanoMaisAlto([...TRES.slice(0, 2), plano(99700, 5, 20, 1200)])).toEqual({
      conversas: 1200,
      numeros: 5,
      pessoas: 20,
    });
  });

  it("plano mais alto com algum 'sem limite' não dá número: a frase sai genérica", () => {
    expect(limitesDoPlanoMaisAlto([TRES[0]!, plano(99700, null, 15, 800)])).toBeNull();
    expect(limitesDoPlanoMaisAlto([TRES[0]!, plano(99700, 3, null, 800)])).toBeNull();
    expect(limitesDoPlanoMaisAlto([TRES[0]!, plano(99700, 3, 15, null)])).toBeNull();
  });
});

describe("o cartão some com a lista", () => {
  it("⭐ sem plano oferecido (cobrança desligada ou nada à venda), não há cartão", () => {
    expect(cartaoEnterprise([], FICTICIO, "suporte@exemplo.test")).toBeNull();
  });

  it("com plano oferecido, o cartão aparece", () => {
    expect(cartaoEnterprise(TRES, FICTICIO, "")).not.toBeNull();
  });
});

describe("o botão Falar com o comercial", () => {
  it("⭐ abre o wa.me do número da instalação", () => {
    expect(cartaoEnterprise(TRES, FICTICIO, "suporte@exemplo.test")?.contato).toEqual({
      tipo: "whatsapp",
      href: `https://wa.me/${FICTICIO}`,
    });
  });

  it("tira a máscara do número", () => {
    expect(linkDoWhatsAppDoComercial("+55 (11) 99999-0000")).toBe(`https://wa.me/${FICTICIO}`);
  });

  it("número vazio ou que não parece telefone com DDI não vira link", () => {
    expect(linkDoWhatsAppDoComercial("")).toBeNull();
    expect(linkDoWhatsAppDoComercial(null)).toBeNull();
    expect(linkDoWhatsAppDoComercial("99990000")).toBeNull();
    expect(linkDoWhatsAppDoComercial("1".repeat(16))).toBeNull();
  });

  it("sem o número, cai no e-mail de suporte; sem nenhum dos dois, não tem botão", () => {
    expect(cartaoEnterprise(TRES, "", " suporte@exemplo.test ")?.contato).toEqual({
      tipo: "email",
      href: "mailto:suporte@exemplo.test",
    });
    expect(cartaoEnterprise(TRES, null, "")?.contato).toBeNull();
  });
});

describe("a página de preços usa o cartão", () => {
  const pagina = readFileSync(path.join(RAIZ, "app/precos/page.tsx"), "utf8");

  it("⭐ o texto passa pelo t(), como o resto da página", () => {
    expect(pagina).toContain('t("Enterprise")');
    expect(pagina).toContain('t("Falar com o comercial")');
    expect(pagina).toContain(
      '"Para quem passa de {conversas} conversas, {numeros} números ou {pessoas} pessoas. Condições sob medida."',
    );
    expect(pagina).toContain('t("Para quem precisa de mais do que os planos acima. Condições sob medida.")');
  });

  it("o cartão vem da leitura dos planos e do número da instalação, sem preço nem número no código", () => {
    expect(pagina).toContain("cartaoEnterprise(planos, whatsappDoComercial, suporte)");
    expect(pagina).toContain("valorDaInstalacao(VARIAVEL_DO_WHATSAPP_DO_COMERCIAL)");
    expect(pagina).toContain('data-precos="enterprise"');
    expect(pagina).not.toMatch(/wa\.me\/\d/);
  });

  it("a chave está declarada no ambiente e no exemplo", () => {
    expect(readFileSync(path.join(RAIZ, "lib/env.ts"), "utf8")).toContain(`${VARIAVEL_DO_WHATSAPP_DO_COMERCIAL}:`);
    expect(readFileSync(path.join(RAIZ, ".env.example"), "utf8")).toContain(`${VARIAVEL_DO_WHATSAPP_DO_COMERCIAL}=`);
  });
});

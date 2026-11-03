/**
 * FORK MIA (.99) · A FRASE DE AJUDA DOS PLANOS SÓ FALA DO TESTE QUANDO HÁ TESTE.
 *
 * Quem chegava da página de preços num plano de ENTRADA PAGA (0 dia de teste) lia
 * "Dá para trocar aqui ou depois, no teste." — e esse plano não tem teste: a troca
 * é na hora de pagar (o passo "Pagamento", antes de pagar) ou depois, em Plano e
 * cobrança. A frase segue a mesma régua do cadastro (`entradaPaga` do formulário):
 * 0 dia de teste e nenhum cupom de dias grátis no plano marcado.
 *
 * Pelo formulário inteiro, e não só pelos cartões: trocar o plano marcado troca a
 * frase, e quem decide "sem teste" é o formulário. E toda frase nova tem espanhol.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/components/auth/SignupForm";
import type { CupomPublico } from "@/lib/cupons/publico";
import { traduzir } from "@/lib/i18n/dicionario";
import type { CartaoDoPlano } from "@/lib/planos-mia/cadastro";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions/auth/signUp", () => ({ signUp: vi.fn() }));

const COM_TESTE = "11111111-1111-4111-8111-111111111111";
const ENTRADA_PAGA = "22222222-2222-4222-8222-222222222222";

const cartao = (id: string, nome: string, trial: number): CartaoDoPlano => ({
  id,
  nome,
  frase: null,
  destaque: false,
  padrao: false,
  preco_cents: 29_700,
  intervalo: "mes",
  trial_dias: trial,
  pessoas: 3,
  numeros: 1,
  conversas: 500,
  modulos: [],
});
const CARTOES = [cartao(COM_TESTE, "Plano Teste Grátis", 14), cartao(ENTRADA_PAGA, "Plano Entrada Paga", 0)];
const PLANOS = CARTOES.map(({ id, nome, preco_cents, intervalo, trial_dias }) => ({ id, nome, preco_cents, intervalo, trial_dias }));

const NO_TESTE = "Veio da página de preços com o plano marcado. Dá para trocar aqui ou depois, no teste.";
const NA_HORA_DE_PAGAR = "Veio da página de preços com o plano marcado. Dá para trocar aqui, na hora de pagar ou depois.";
const SEM_LINK_COM_TESTE = "Dá para trocar de plano depois, inclusive durante o teste.";
const SEM_LINK_SEM_TESTE = "Dá para trocar de plano na hora de pagar ou depois.";

function abrir(planoInicial: string, veioDoLink: boolean, cupomInicial: CupomPublico | null = null) {
  render(
    <SignupForm planos={PLANOS} cartoes={CARTOES} planoInicial={planoInicial} planoVeioDoLink={veioDoLink} cupomInicial={cupomInicial} />,
  );
  return document.getElementById("planos-do-cadastro-ajuda")?.textContent ?? "";
}

describe("a frase de ajuda dos planos no cadastro", () => {
  it("⭐ veio do link num plano de entrada paga: não fala de teste", () => {
    expect(abrir(ENTRADA_PAGA, true)).toBe(NA_HORA_DE_PAGAR);
  });

  it("controle positivo: veio do link num plano com teste, a frase de sempre", () => {
    expect(abrir(COM_TESTE, true)).toBe(NO_TESTE);
  });

  it("trocar o plano marcado troca a frase, nos dois sentidos", async () => {
    const user = userEvent.setup();
    expect(abrir(COM_TESTE, true)).toBe(NO_TESTE);
    await user.click(screen.getByRole("radio", { name: /Plano Entrada Paga/ }));
    expect(screen.getByText(NA_HORA_DE_PAGAR)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Plano Teste Grátis/ }));
    expect(screen.getByText(NO_TESTE)).toBeTruthy();
  });

  it("sem o link: a frase de sempre no plano com teste e a da hora de pagar na entrada paga", () => {
    expect(abrir(COM_TESTE, false)).toBe(SEM_LINK_COM_TESTE);
    document.body.innerHTML = "";
    expect(abrir(ENTRADA_PAGA, false)).toBe(SEM_LINK_SEM_TESTE);
  });

  it("cupom de dias grátis no plano de entrada paga: há teste, então a frase fala dele", () => {
    const cupom: CupomPublico = {
      codigo: "PARCEIRO30",
      valido: true,
      motivo: null,
      beneficio: "dias",
      valor: 30,
      meses: null,
      setup_tipo: "nenhum",
      setup_valor: 0,
      planos: [ENTRADA_PAGA],
      vale_ate: null,
      parceiro: "Parceiro de Teste",
    };
    expect(abrir(ENTRADA_PAGA, true, cupom)).toBe(NO_TESTE);
  });

  it("as duas frases novas têm espanhol", () => {
    for (const frase of [NA_HORA_DE_PAGAR, SEM_LINK_SEM_TESTE]) {
      const es = traduzir(frase, "es");
      expect(es, frase).not.toBe(frase);
      expect(es).not.toMatch(/prueba/);
    }
  });
});

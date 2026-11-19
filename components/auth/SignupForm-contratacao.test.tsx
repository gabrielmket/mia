import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ signup: vi.fn(), replace: vi.fn() }));
vi.mock("@/app/actions/auth/signUp", () => ({ signUp: h.signup }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
import { SignupForm } from "./SignupForm";
const P = "11111111-1111-4111-8111-111111111111", T = "22222222-2222-4222-8222-222222222222";
const planos = [{ id: P, nome: "Pago", preco_cents: 120000, moeda: "BRL", intervalo: "ano" as const, trial_dias: 0 }, { id: T, nome: "Teste", preco_cents: 10000, moeda: "BRL", intervalo: "mes" as const, trial_dias: 7 }];
function preencher() {
  fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Empresa fictícia" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pessoa@example.test" } });
  fireEvent.change(screen.getByLabelText("Senha", { exact: true }), { target: { value: "SenhaTeste2026!" } });
  fireEvent.change(screen.getByLabelText("Confirmar senha", { exact: true }), { target: { value: "SenhaTeste2026!" } });
}
// FORK MIA (.96): no fork, o plano de 0 dia de teste é a ENTRADA PAGA
// (docs/fork/pagamento-no-inicio.md): o formulário pede quem assina e os dados
// fiscais, o nome da empresa vira "Nome fantasia" e o botão diz "Criar conta e ir
// para o pagamento". Sem esses campos a própria tela recusa o envio. Estes são os
// dados fictícios que passam pela régua de lib/dados-fiscais/regras.ts.
function preencherEntradaPaga() {
  fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Ana Exemplo" } });
  fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "31900000002" } });
  fireEvent.change(screen.getByLabelText("Nome fantasia"), { target: { value: "Academia Alfa" } });
  fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: "11.222.333/0001-81" } });
  fireEvent.change(screen.getByLabelText("Razão social"), { target: { value: "Academia Alfa Ltda" } });
  fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "30110-000" } });
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua Exemplo" } });
  fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Centro" } });
  fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Belo Horizonte" } });
  fireEvent.change(screen.getByLabelText("UF"), { target: { value: "MG" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pessoa@example.test" } });
  fireEvent.change(screen.getByLabelText("Senha", { exact: true }), { target: { value: "SenhaTeste2026!" } });
  fireEvent.change(screen.getByLabelText("Confirmar senha", { exact: true }), { target: { value: "SenhaTeste2026!" } });
}
beforeEach(() => { vi.clearAllMocks(); h.signup.mockResolvedValue({ ok: true, sessao_ativa: false }); });
describe("compromisso explícito no formulário nativo", () => {
  it("plano pago muda o CTA e envia intenção, preservando a confirmação de e-mail", async () => {
    // FORK MIA (.96): os campos e o botão da entrada paga do fork (ver acima).
    render(<SignupForm planos={planos} planoInicial={P} />); preencherEntradaPaga();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta e ir para o pagamento" }));
    await waitFor(() => expect(h.signup).toHaveBeenCalledTimes(1));
    expect(h.signup.mock.calls[0]?.[0]).toMatchObject({ cobranca_plan_id: P, continuar_pagamento: true });
    expect(await screen.findByText("Confirme seu e-mail")).toBeVisible();
    expect(screen.getByText(/Seu plano está preservado/)).toBeVisible();
  });
  it("trocar para trial antes do envio remove o compromisso automático de pagamento", async () => {
    // FORK MIA (.96): troca o plano ANTES de preencher, porque no plano pago o
    // campo do nome se chama "Nome fantasia" (a entrada paga do fork).
    render(<SignupForm planos={planos} planoInicial={P} />);
    fireEvent.change(screen.getByLabelText("Plano"), { target: { value: T } });
    preencher();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(h.signup).toHaveBeenCalledTimes(1));
    expect(h.signup.mock.calls[0]?.[0]).toMatchObject({ cobranca_plan_id: T, continuar_pagamento: false });
  });
});

/**
 * FORK MIA (.91) — AS BOAS-VINDAS DO UPSTREAM FUNCIONAM SOZINHAS; O SEGMENTO SÓ SOMA.
 *
 * ─── O defeito que este arquivo guarda ──────────────────────────────────────
 *
 * O e2e do upstream (`tests/e2e/vps-fresh-onboarding.spec.ts`, J1.3 + J1.4)
 * estourou o tempo no passo "Seu negócio": abria o fuso e o "Los Angeles"
 * ficava fora da tela, para sempre (job 121265841314, parte 4). Duas peças da
 * .91 mexiam na página no meio do preenchimento:
 *
 *   1. a coluna do assistente surgia só quando a resposta do "o que falta"
 *      chegava: o passo mudava de largura com o seletor de fuso aberto;
 *   2. o painel do assistente, ao montar, chamava `scrollIntoView` no fim da
 *      conversa, e isso rola a JANELA junto (o painel da .88 morava numa gaveta;
 *      na .91 ele mora ao lado do passo).
 *
 * O conserto: a coluna nasce com a página (o critério que o servidor já leu,
 * `apareceInicial`) e o painel rola só a própria lista. E a regra do passo:
 * nome, fuso, termos e "Continuar" funcionam sem tocar no segmento, com um
 * único checkbox na tela, e um segmento ausente ou estranho não vira erro.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const enviado = vi.hoisted(() => ({ forms: [] as FormData[] }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/app/actions/onboarding/acceptWelcome", () => ({
  acceptWelcome: vi.fn(async (fd: FormData) => {
    enviado.forms.push(fd);
    return { ok: true };
  }),
}));

// O componente da coluna: só a estrutura importa aqui, não o que o painel e o bloco desenham.
const oQueFalta = vi.hoisted(() => ({ estado: { isPending: true, data: undefined as unknown } }));
vi.mock("@/hooks/assistente/usePrimeirosPassos", () => ({ useOQueFalta: () => oQueFalta.estado }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { full_name: "Dono", support: null }, activeOrg: { role: "admin" } }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/onboarding/welcome" }));
vi.mock("@/components/assistente/PainelDoAssistente", () => ({
  PainelDoAssistente: () => <div data-testid="painel-dublê" />,
}));
vi.mock("@/components/assistente/OQueFalta", () => ({ OQueFalta: () => <div data-testid="bloco-dublê" /> }));

import { PrimeirosPassosComAssistente } from "@/components/assistente/PrimeirosPassosComAssistente";
import { WelcomeForm } from "@/app/onboarding/welcome/_form";
import { segmentoDoFormulario } from "@/lib/onboarding/modelos-de-agente-da-mia";
import { welcomeSchema } from "@/lib/schemas/onboarding";

afterEach(() => {
  cleanup();
  enviado.forms = [];
  oQueFalta.estado = { isPending: true, data: undefined };
});

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("as boas-vindas do upstream, sem tocar no segmento", () => {
  it("um checkbox só (o dos termos): o locator do e2e continua único", () => {
    const { container } = render(<WelcomeForm defaultOrgName="" orgId={ORG} />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    // os chips do segmento são botões que não enviam o formulário
    for (const chip of container.querySelectorAll('[id^="segmento-"]')) expect(chip.getAttribute("type")).toBe("button");
  });

  it("Continuar desligado sem os termos; ligado com os termos, sem escolher segmento", () => {
    render(<WelcomeForm defaultOrgName="" orgId={ORG} />);
    const continuar = screen.getByRole("button", { name: /^continuar$/i });
    expect(continuar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/como se chama o seu negócio/i), { target: { value: "Loja QA VPS" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(continuar).toBeEnabled();
  });

  it("o envio leva nome, fuso e a empresa da aba; o segmento vai junto só como soma", async () => {
    const { container } = render(<WelcomeForm defaultOrgName="" orgId={ORG} />);
    fireEvent.change(screen.getByLabelText(/como se chama o seu negócio/i), { target: { value: "Loja QA VPS" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(enviado.forms).toHaveLength(1));
    const fd = enviado.forms[0]!;
    expect(fd.get("display_name")).toBe("Loja QA VPS");
    expect(fd.get("timezone")).toBe("America/Sao_Paulo");
    expect(fd.get("organization_id")).toBe(ORG);
    // a leitura do nome: uma loja não é nenhum dos quatro segmentos
    expect(fd.get("segmento")).toBe("outro");
  });

  it("o segmento ausente ou estranho não vira erro: só deixa de ser gravado", () => {
    expect(segmentoDoFormulario(null)).toBeUndefined();
    expect(segmentoDoFormulario("")).toBeUndefined();
    expect(segmentoDoFormulario("padaria")).toBeUndefined();
    expect(segmentoDoFormulario(" academia ")).toBe("academia");
    const semSegmento = welcomeSchema.safeParse({
      display_name: "Loja QA VPS",
      timezone: "America/Sao_Paulo",
      accepted_terms_at: new Date().toISOString(),
    });
    expect(semSegmento.success).toBe(true);
  });
});

describe("a coluna do assistente não mexe no passo que a pessoa preenche", () => {
  it("com o critério do servidor, a coluna nasce com a página, antes da resposta da rota", () => {
    render(
      <PrimeirosPassosComAssistente apareceInicial>
        <div data-testid="passo">passo</div>
      </PrimeirosPassosComAssistente>,
    );
    expect(screen.getByTestId("painel-dublê")).toBeTruthy();
    expect(screen.getByTestId("passo").parentElement?.parentElement?.className).toMatch(/grid/);
  });

  it("a resposta da rota chega e o passo continua o MESMO nó (nada remonta nem muda de largura)", () => {
    const { rerender } = render(
      <PrimeirosPassosComAssistente apareceInicial>
        <input data-testid="campo" defaultValue="" />
      </PrimeirosPassosComAssistente>,
    );
    const antes = screen.getByTestId("campo");
    const grade = antes.parentElement?.parentElement?.className;
    oQueFalta.estado = {
      isPending: false,
      data: { criterio: { aparece: true, onde: "passo_a_passo" }, rotulo: { contas: { faltam: 7 }, agente: "Mia" } },
    };
    rerender(
      <PrimeirosPassosComAssistente apareceInicial>
        <input data-testid="campo" defaultValue="" />
      </PrimeirosPassosComAssistente>,
    );
    expect(screen.getByTestId("campo")).toBe(antes);
    expect(antes.parentElement?.parentElement?.className).toBe(grade);
  });

  it("nenhum componente do assistente rola a janela (scrollIntoView)", () => {
    const pasta = path.resolve(__dirname, "../../components/assistente");
    const comScroll = readdirSync(pasta)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /\.scrollIntoView\s*\(/.test(readFileSync(path.join(pasta, f), "utf8")));
    expect(comScroll).toEqual([]);
  });
});

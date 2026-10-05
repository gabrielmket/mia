/**
 * FORK MIA — A TELA das conversões da Meta no que continua nosso, pelo que a
 * pessoa vê e clica: a chave dos leads de formulário e o diagnóstico da Meta.
 *
 * Desde a .72 a régua por etapa ("O que cada etapa do funil informa à Meta") e o
 * histórico de envios são os do upstream (0524 e 0436); o atalho do diagnóstico
 * leva ao histórico dele, já filtrado pelas recusas (`situacao=falha`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DiagnosticoDaMetaNaTela } from "@/app/app/settings/conversoes/_diagnosticoMeta";
import { LeadsDeFormularioDaMeta } from "@/app/app/settings/conversoes/_leadsDeFormularioMeta";

const mock = vi.hoisted(() => ({
  chave: vi.fn(),
  testar: vi.fn(),
  aviso: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));
vi.mock("@/app/actions/settings/conversoesDaMeta", () => ({
  definirLeadsDeFormularioDaMeta: mock.chave,
  testarConexaoDaMeta: mock.testar,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: mock.aviso }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.chave.mockResolvedValue({ ok: true });
});

describe("leads de formulário voltam para a Meta", () => {
  it("vem desligada; ligar salva no clique", async () => {
    render(<LeadsDeFormularioDaMeta ligada={false} desde={null} idioma="pt-BR" />);
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Desligada: lead de formulário não volta para a Meta.");
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.chave).toHaveBeenCalledWith(true));
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Ligada: a Meta fica sabendo");
  });

  it("a recusa do servidor devolve a chave ao que estava", async () => {
    mock.chave.mockResolvedValueOnce({ ok: false, error: "forbidden_role" });
    render(<LeadsDeFormularioDaMeta ligada={false} desde={null} idioma="pt-BR" />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.aviso.error).toHaveBeenCalled());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("ligada, diz desde quando: é dali para a frente que os eventos voltam", () => {
    render(<LeadsDeFormularioDaMeta ligada desde="2026-09-26T12:00:00Z" idioma="pt-BR" />);
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Desde 26/09/2026");
  });
});

describe("o diagnóstico da Meta", () => {
  it("só roda quando alguém pede, e mostra cada conferência com o que fazer", async () => {
    mock.testar.mockResolvedValue({
      ok: true,
      diagnostico: {
        veredito: "com_problema",
        testadoEm: "2026-10-01T10:35:00Z",
        itens: [
          { chave: "token", caso: "token_recusado", saude: "problema", dado: "Session has expired" },
          { chave: "destino", caso: "destino_nao_conferido", saude: "atencao", dado: null },
          { chave: "permissao", caso: "permissao_nao_conferida", saude: "atencao", dado: null },
          {
            chave: "ultimo_envio",
            caso: "ultimo_envio_aceito",
            saude: "ok",
            dado: null,
            ultimo: { em: "2026-10-01T08:31:00Z", evento: "Novo lead", negocio: "Negócio de teste", leadId: "l1" },
          },
          {
            chave: "recusados",
            caso: "com_recusados",
            saude: "atencao",
            dado: null,
            recusados: { total: 2, motivos: [{ motivo: "token de acesso vencido", quantos: 2 }] },
          },
          { chave: "modo_de_teste", caso: "modo_de_teste", saude: "atencao", dado: null },
        ],
      },
    });
    render(<DiagnosticoDaMetaNaTela idioma="pt-BR" />);
    expect(screen.getByTestId("diagnostico-meta-vazio").textContent).toBe("Ainda não testado nesta visita.");
    expect(mock.testar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Testar conexão" }));
    await waitFor(() => expect(screen.getByTestId("diagnostico-meta-veredito")).toBeTruthy());

    const secao = within(screen.getByTestId("diagnostico-meta"));
    expect(secao.getByText("Token recusado pela Meta")).toBeTruthy();
    expect(secao.getByText(/Gere um token novo na Meta/)).toBeTruthy();
    expect(secao.getByText("Session has expired")).toBeTruthy();
    expect(secao.getByText("Último envio aceito há 2 horas")).toBeTruthy();
    expect(secao.getByText("Eventos recusados nos últimos 7 dias: 2")).toBeTruthy();
    expect(secao.getByText("2 · token de acesso vencido")).toBeTruthy();
    expect(secao.getByText("Modo de teste ligado")).toBeTruthy();
    // O atalho para o histórico já filtrado.
    expect(secao.getByRole("link", { name: "Ver no histórico" }).getAttribute("href")).toBe(
      "?aba=historico&plataforma=meta_ads&situacao=falha&periodo=7d",
    );
    expect(screen.getByTestId("diagnostico-meta-veredito").textContent).toBe("A Meta não está recebendo. Veja o item em vermelho.");
  });
});

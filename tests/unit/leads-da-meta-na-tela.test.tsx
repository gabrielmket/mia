/**
 * FORK MIA — Configurações › Meta Ads › aba Formulários de leads, no DOM.
 * (Até a .60, a tela própria Configurações › Formulários da Meta.)
 *
 * As rotas e a rodada têm testes próprios; aqui se prova o que quem configura VÊ:
 * a falta de conexão com o caminho para resolver, a permissão que falta pelo
 * nome e pelo efeito, a Página sem acesso com a frase certa, o histórico com o
 * motivo legível, e o "Ler agora" que só acende quando há o que ler.
 *
 * A API é um dublê (nenhuma chamada sai); o idioma é o de verdade (pt-BR), então
 * as frases conferidas são as que a tela mostra.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeadsDaMetaClient } from "@/app/app/settings/meta-ads/_formularios";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const FORMULARIO_ESCOLHIDO = {
  id: "linha-1",
  page_id: "p1",
  page_name: "Clínica Sorriso",
  form_id: "f1",
  form_name: "Avaliação grátis",
  pipeline_id: "funil-1",
  stage_id: "etapa-1",
  ativo: true,
  lido_ate: null,
  ultima_leitura_em: "2026-09-29T14:55:00.000Z",
  ultimo_status: "erro",
  ultimo_motivo: "token_invalido",
  ultimo_detalhe: "Error validating access token",
  importados_total: 12,
};

function estado(sobre: Record<string, unknown> = {}) {
  return {
    data: {
      config: {
        ativo: true,
        dias_de_recuperacao: 7,
        ativado_em: "2026-09-28T10:00:00.000Z",
        atualizado_em: null,
      },
      conectada: true,
      origem_da_conexao: "propria",
      // .61: as Páginas desta empresa (9004).
      paginas: [
        { page_id: "p1", page_name: "Clínica Sorriso" },
        { page_id: "p2", page_name: "Página sem acesso" },
      ],
      formularios: [FORMULARIO_ESCOLHIDO],
      leituras: [
        {
          id: "l1",
          formulario_id: "linha-1",
          iniciada_em: "2026-09-29T14:00:00.000Z",
          terminada_em: "2026-09-29T14:55:00.000Z",
          status: "erro",
          novos: 0,
          repetidos: 0,
          recusados: 0,
          motivo: "token_invalido",
          detalhe: null,
          janela_de: null,
          janela_ate: null,
          repeticoes: 12,
        },
      ],
      ...sobre,
    },
  };
}

const DIAGNOSTICO = {
  data: {
    origem: "propria",
    permissoes: {
      verificadas: true,
      faltandoObrigatorias: ["leads_retrieval"],
      faltandoRecomendadas: ["ads_management"],
    },
    erro: null,
    paginasCortadas: false,
    paginas: [
      {
        id: "p1",
        nome: "Clínica Sorriso",
        erro: null,
        detalhe: null,
        formularios: [{ id: "f1", nome: "Avaliação grátis", status: "ACTIVE", perguntas: {} }],
      },
      {
        id: "p2",
        nome: "Página sem acesso",
        erro: "sem_token_da_pagina",
        detalhe: null,
        formularios: [],
      },
    ],
  },
};

function responderGet(estadoAtual: unknown) {
  api.get.mockImplementation(async (caminho: string) => {
    if (caminho === "/api/v1/leads-da-meta") return estadoAtual;
    if (caminho === "/api/v1/leads-da-meta/paginas") return DIAGNOSTICO;
    if (caminho === "/api/v1/pipelines")
      return { data: [{ id: "funil-1", name: "Comercial", is_default: true }] };
    if (caminho.startsWith("/api/v1/pipelines/"))
      return { data: { stages: [{ id: "etapa-1", name: "Novo" }] } };
    throw new Error(`GET inesperado: ${caminho}`);
  });
}

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function abrir() {
  render(
    <IdiomaProvider locale="pt-BR">
      <QueryClientProvider client={client}>
        <LeadsDaMetaClient />
      </QueryClientProvider>
    </IdiomaProvider>,
  );
}

describe("sem token conectado", () => {
  it("diz o que falta e leva para onde se cola o token", async () => {
    responderGet(estado({ conectada: false }));
    abrir();
    expect(await screen.findByText("Nenhum token de anúncios conectado.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ir para Contas de anúncio" });
    expect(link.getAttribute("href")).toBe("/app/settings/meta-ads");
    // Sem conexão, a Meta nem é consultada.
    expect(api.get).not.toHaveBeenCalledWith("/api/v1/leads-da-meta/paginas", expect.anything());
  });
});

describe("sem Página atribuída à empresa (.61)", () => {
  it("diz que a Página é atribuída pela plataforma, e a Meta nem é consultada", async () => {
    responderGet(estado({ paginas: [], formularios: [] }));
    abrir();
    expect(await screen.findByText("Nenhuma Página da Meta é desta empresa ainda.")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith("/api/v1/leads-da-meta/paginas", expect.anything());
    // Sem Página, a pista não é colar token.
    expect(screen.queryByText("Nenhum token de anúncios conectado.")).toBeNull();
  });

  it("formulário que ficou de Página de outra empresa aparece com o motivo", async () => {
    responderGet(
      estado({
        paginas: [],
        formularios: [{ ...FORMULARIO_ESCOLHIDO, page_id: "p9", page_name: "Página do vizinho", ativo: false }],
      }),
    );
    abrir();
    expect(
      await screen.findByText("Formulários de Páginas que não são desta empresa:"),
    ).toBeTruthy();
    expect(screen.getByText(/Página do vizinho/)).toBeTruthy();
  });
});

describe("com token conectado", () => {
  it("pela conexão da plataforma, a falta de permissão manda falar com o suporte", async () => {
    responderGet(estado({ origem_da_conexao: "plataforma" }));
    api.get.mockImplementation(async (caminho: string) => {
      if (caminho === "/api/v1/leads-da-meta") return estado({ origem_da_conexao: "plataforma" });
      if (caminho === "/api/v1/leads-da-meta/paginas")
        return { data: { ...DIAGNOSTICO.data, origem: "plataforma" } };
      if (caminho === "/api/v1/pipelines")
        return { data: [{ id: "funil-1", name: "Comercial", is_default: true }] };
      if (caminho.startsWith("/api/v1/pipelines/"))
        return { data: { stages: [{ id: "etapa-1", name: "Novo" }] } };
      throw new Error(`GET inesperado: ${caminho}`);
    });
    abrir();
    expect(
      await screen.findByText(
        "Estas Páginas são lidas pela conexão da plataforma. Avise o suporte para gerar o token de novo com as permissões que faltam.",
      ),
    ).toBeTruthy();
  });

  it("a permissão que falta aparece pelo nome e pelo efeito", async () => {
    responderGet(estado());
    abrir();
    const alerta = await screen.findByText(
      "Faltam permissões no token, e sem elas nenhum lead é lido:",
    );
    const quadro = alerta.closest("div")!;
    expect(within(quadro).getByText("leads_retrieval")).toBeTruthy();
    expect(quadro.textContent).toContain("ler os leads");
    expect(screen.getByText("ads_management")).toBeTruthy();
  });

  it("a Página sem acesso diz o que fazer no Gerenciador de Negócios", async () => {
    responderGet(estado());
    abrir();
    expect(await screen.findByText("Página sem acesso")).toBeTruthy();
    expect(
      screen.getByText(
        "O usuário do sistema não tem acesso suficiente à Página. Dê a ele acesso de anúncios e de leads (ou controle total) no Gerenciador de Negócios.",
      ),
    ).toBeTruthy();
  });

  it("o histórico mostra o motivo legível e quantas leituras seguidas deram o mesmo erro", async () => {
    responderGet(estado());
    abrir();
    const historico = (await screen.findByText("Histórico de leituras")).closest("section")!;
    expect(within(historico).getByText(/12 leituras seguidas desde/)).toBeTruthy();
    expect(
      within(historico).getByText(
        "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads.",
      ),
    ).toBeTruthy();
  });

  it("'Ler agora' fica apagado sem formulário ativo", async () => {
    responderGet(estado({ formularios: [{ ...FORMULARIO_ESCOLHIDO, ativo: false }] }));
    abrir();
    const botao = await screen.findByRole("button", { name: "Ler agora" });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
  });

  it("'Ler agora' lê a empresa e mostra o resultado na hora", async () => {
    responderGet(estado());
    api.post.mockResolvedValue({
      data: { formularios: 1, novos: 2, repetidos: 1, recusados: 0, erros: 0 },
    });
    abrir();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Ler agora" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/leads-da-meta/ler-agora",
        {},
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText(
        /Leitura concluída: 2 novos · 1 repetidos · 0 recusados · 0 com erro/,
      ),
    ).toBeTruthy();
  });
});

describe("tempo real e perguntas do formulário (.62)", () => {
  it("a Meta recusou assinar a Página: a tela diz a permissão que falta e deixa tentar de novo", async () => {
    responderGet(
      estado({
        formularios: [
          { ...FORMULARIO_ESCOLHIDO, tempo_real: "recusado", tempo_real_motivo: "permissao_insuficiente" },
        ],
      }),
    );
    api.put.mockResolvedValue({ data: { id: "linha-1", ativo: true, tempo_real: "assinado", tempo_real_motivo: null } });
    abrir();
    expect(await screen.findByText(/pages_manage_metadata no token/)).toBeTruthy();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: "Ligar o tempo real" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/leads-da-meta/formularios",
        expect.objectContaining({ form_id: "f1", ativo: true }),
        expect.anything(),
      ),
    );
  });

  it("ligado, mostra quando chegou o último lead pelo aviso da Meta", async () => {
    responderGet(
      estado({
        formularios: [
          {
            ...FORMULARIO_ESCOLHIDO,
            tempo_real: "assinado",
            ultimo_aviso_da_meta_em: "2026-09-30T14:32:00.000Z",
          },
        ],
      }),
    );
    abrir();
    expect(await screen.findByText(/Tempo real ligado/)).toBeTruthy();
    expect(screen.getByText(/Último lead pelo aviso da Meta:/)).toBeTruthy();
  });

  it("a pergunta própria do celular aparece como o que o automático usa", async () => {
    responderGet(estado());
    api.get.mockImplementation(async (caminho: string) => {
      if (caminho === "/api/v1/leads-da-meta") return estado();
      if (caminho === "/api/v1/leads-da-meta/paginas") {
        return {
          data: {
            ...DIAGNOSTICO.data,
            paginas: [
              {
                ...DIAGNOSTICO.data.paginas[0],
                formularios: [
                  {
                    id: "f1",
                    nome: "Avaliação grátis",
                    status: "ACTIVE",
                    perguntas: {
                      full_name: "Nome completo",
                      "celular:_(ddd_+_número)": "Celular (DDD + número)",
                    },
                  },
                ],
              },
            ],
          },
        };
      }
      if (caminho === "/api/v1/pipelines")
        return { data: [{ id: "funil-1", name: "Comercial", is_default: true }] };
      if (caminho.startsWith("/api/v1/pipelines/"))
        return { data: { stages: [{ id: "etapa-1", name: "Novo" }] } };
      throw new Error(`GET inesperado: ${caminho}`);
    });
    abrir();
    expect(
      await screen.findByText("Quais perguntas são o telefone, o nome e o e-mail"),
    ).toBeTruthy();
    expect(screen.getByText("O automático usa: Celular (DDD + número)")).toBeTruthy();
    expect(screen.getByText("O automático usa: Nome completo")).toBeTruthy();
    expect(screen.getByText("O automático não reconheceu nenhuma pergunta.")).toBeTruthy();
  });
});

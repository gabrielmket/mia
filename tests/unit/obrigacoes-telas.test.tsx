import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — Documentos e obrigações na tela: a seção do cartão aberto e das
 * fichas (com a herança em três grupos) e o que aparece no Foco.
 *
 * O ponto que não pode regredir: o agente de IA PROPÕE e a pessoa confirma.
 * "Sim, marcar recebido" abre o painel de receber (a pessoa ainda confere a
 * validade e confirma); só "Não é" grava na hora, e grava a recusa.
 */
const acoes = vi.hoisted(() => ({
  adicionar: { mutate: vi.fn(), isPending: false },
  pedir: { mutate: vi.fn(), isPending: false },
  receber: { mutate: vi.fn(), isPending: false },
  marcarFeita: { mutate: vi.fn(), isPending: false },
  editar: { mutate: vi.fn(), isPending: false },
  decidirProposta: { mutate: vi.fn(), isPending: false },
}));
const estado = vi.hoisted(() => ({
  leitura: undefined as unknown,
  detalhe: undefined as unknown,
  catalogo: undefined as unknown,
  detalhePedido: [] as Array<string | null>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/obrigacoes/useObrigacoes", () => ({
  useObrigacoes: () => ({ data: estado.leitura, isLoading: false, isError: false }),
  useDetalheDaObrigacao: (id: string | null) => {
    estado.detalhePedido.push(id);
    return { data: id ? estado.detalhe : undefined, isLoading: false, isError: false };
  },
  useTiposDeObrigacao: () => ({ data: estado.catalogo, isLoading: false }),
  useAcoesDeObrigacao: () => acoes,
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [{ user_id: "u-helena", full_name: "Helena Prado", role: "agent" }] }),
}));
vi.mock("@/hooks/useEmpresas", () => ({ useEmpresas: () => ({ data: { data: [] } }) }));
vi.mock("@/components/kanban/SeletorDeContato", () => ({ SeletorDeContato: () => null }));

import { ObrigacoesNoFoco, obrigacoesDoFoco } from "@/components/obrigacoes/ObrigacoesNoFoco";
import { SecaoDeObrigacoes } from "@/components/obrigacoes/SecaoDeObrigacoes";
import type { LeituraNaTela } from "@/hooks/obrigacoes/useObrigacoes";
import { MODELOS_DE_TIPO } from "@/lib/obrigacoes/catalogo";
import type { ObrigacaoNaTela } from "@/lib/obrigacoes/tipos";

const HOJE = "2026-10-01";

function item(over: Partial<ObrigacaoNaTela> & Pick<ObrigacaoNaTela, "id" | "nome">): ObrigacaoNaTela {
  return {
    organization_id: "o",
    tipo_id: null,
    nome_curto: null,
    categoria: "documento",
    lead_id: null,
    empresa_id: null,
    contact_id: null,
    quem_entrega: "cliente",
    recorrencia: "anual",
    recorrencia_meses: null,
    validade_meses: 12,
    avisos_dias: [30, 15, 7],
    dias_sem_resposta: 5,
    pedido_em: null,
    prazo_em: null,
    cobrado_em: null,
    recebido_em: null,
    valido_ate: null,
    renovado_em: null,
    proxima_em: null,
    feita_em: null,
    ciclo: 1,
    arquivo_nome: null,
    arquivo_mime: null,
    arquivo_bytes: null,
    responsavel_user_id: "u-helena",
    observacao: null,
    origem: "tela",
    sem_aviso_antes_de: "2026-01-01",
    arquivado_em: null,
    created_at: "2026-01-01T12:00:00Z",
    updated_at: "2026-01-01T12:00:00Z",
    tem_arquivo: false,
    vinculos: { negocio: null, empresa: null, contato: null },
    proposta: null,
    ...over,
  };
}

/** O negócio da padaria, como o protótipo aprovado o mostra em 01/10/2026. */
function leituraDoNegocio(): LeituraNaTela {
  return {
    hoje: HOJE,
    cortada: false,
    contexto: {
      negocio: { id: "N1", titulo: "Padaria Trigo Dourado · gestão mensal", pipeline_id: "P", empresa_id: "E1", contact_id: "C1", dono_user_id: "u-helena" },
      empresa: { id: "E1", nome: "Padaria Trigo Dourado" },
      contato: { id: "C1", nome: "Helena Souza", empresa_id: "E1" },
      contatos_da_empresa: [],
    },
    itens: [
      item({
        id: "o1",
        nome: "Alvará de funcionamento",
        nome_curto: "Alvará",
        empresa_id: "E1",
        recebido_em: "2025-10-14",
        valido_ate: "2026-10-13",
        pedido_em: "2026-09-26",
        prazo_em: "2026-10-06",
        tem_arquivo: true,
        arquivo_nome: "alvara-2025.pdf",
        proposta: { id: "P1", obrigacao_id: "o1", arquivo_nome: "alvara-2026.pdf", conversation_id: "CV1", de: "Helena Souza", criada_em: "2026-10-01T12:42:00Z" },
      }),
      item({ id: "o2", nome: "Licença sanitária", empresa_id: "E1", recebido_em: "2026-03-22", valido_ate: "2027-03-20" }),
      item({ id: "o4", nome: "Relatório mensal", categoria: "atividade", quem_entrega: "nos", recorrencia: "mensal", validade_meses: 0, avisos_dias: [5, 2], lead_id: "N1", proxima_em: "2026-10-05", feita_em: "2026-09-04" }),
      item({ id: "o6", nome: "Certificado digital", contact_id: "C1", recebido_em: "2025-10-19", valido_ate: "2026-10-18" }),
      item({ id: "o18", nome: "Contrato social", recorrencia: "unica", validade_meses: 0, avisos_dias: [], lead_id: "N1" }),
    ],
  };
}

beforeEach(() => {
  for (const acao of Object.values(acoes)) acao.mutate.mockReset();
  estado.leitura = leituraDoNegocio();
  estado.detalhe = undefined;
  estado.catalogo = undefined;
  estado.detalhePedido = [];
});

describe("a seção Documentos e obrigações no cartão aberto", () => {
  it("três grupos: do negócio, da empresa (herdado) e do contato (herdado), com a contagem", () => {
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    const secao = screen.getByTestId("documentos-e-obrigacoes");
    const grupos = [...secao.querySelectorAll<HTMLElement>("[data-grupo-de-obrigacoes]")];
    expect(grupos.map((g) => g.dataset.grupoDeObrigacoes)).toEqual([
      "Do negócio",
      "Da empresa · Padaria Trigo Dourado",
      "Do contato · Helena Souza",
    ]);
    const ids = (g: HTMLElement) => [...g.querySelectorAll<HTMLElement>("[data-obrigacao]")].map((li) => li.dataset.obrigacao);
    // Dentro de cada grupo, do mais urgente para o menos.
    expect(ids(grupos[0]!)).toEqual(["o4", "o18"]);
    expect(ids(grupos[1]!)).toEqual(["o1", "o2"]);
    expect(ids(grupos[2]!)).toEqual(["o6"]);
    expect(within(grupos[0]!).queryByText("herdado")).toBeNull();
    expect(within(grupos[1]!).getByText("herdado")).toBeTruthy();
    expect(within(grupos[2]!).getByText("herdado")).toBeTruthy();
    expect(secao.textContent).toContain("5");
  });

  it("a situação é a calculada pelas datas, com a frase ao lado e o clipe do arquivo", () => {
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    const alvara = document.querySelector('[data-obrigacao="o1"]') as HTMLElement;
    expect(alvara.querySelector("[data-situacao]")?.getAttribute("data-situacao")).toBe("vencendo");
    expect(alvara.textContent).toContain("vence em 12 dias · 13/10/2026 · renovação pedida há 5 dias");
    expect(alvara.textContent).toContain("resp. Helena Prado");
    expect(within(alvara).getByRole("link", { name: "Abrir o arquivo" }).getAttribute("href")).toBe("/api/v1/obrigacoes/o1/arquivo");
    const licenca = document.querySelector('[data-obrigacao="o2"]') as HTMLElement;
    expect(licenca.querySelector("[data-situacao]")?.getAttribute("data-situacao")).toBe("valido");
    // Com tudo em dia a linha não oferece botão de ação: só "Ver histórico".
    expect(within(licenca).queryByRole("button", { name: "Receber versão nova" })).toBeNull();
    expect(within(licenca).getByRole("button", { name: "Ver histórico" })).toBeTruthy();
  });

  it("no cartão aberto a proposta do agente fica no Foco, e não na seção; nas fichas ela aparece na seção", () => {
    const { unmount } = render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    expect(screen.queryByTestId("proposta-do-agente")).toBeNull();
    unmount();
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} />);
    expect(screen.getByTestId("proposta-do-agente")).toBeTruthy();
  });

  it("Marcar pedido e Marcar feita gravam na hora; Marcar recebido abre o painel em vez de gravar", async () => {
    const user = userEvent.setup();
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    await user.click(within(document.querySelector('[data-obrigacao="o18"]') as HTMLElement).getByRole("button", { name: "Marcar pedido" }));
    expect(acoes.pedir.mutate).toHaveBeenCalledWith("o18", expect.anything());
    await user.click(within(document.querySelector('[data-obrigacao="o4"]') as HTMLElement).getByRole("button", { name: "Marcar feita" }));
    expect(acoes.marcarFeita.mutate).toHaveBeenCalledWith("o4", expect.anything());
    await user.click(within(document.querySelector('[data-obrigacao="o1"]') as HTMLElement).getByRole("button", { name: "Marcar recebido" }));
    expect(acoes.receber.mutate).not.toHaveBeenCalled();
    // A folha do item foi pedida: é nela que a pessoa confere a validade e confirma.
    expect(estado.detalhePedido).toContain("o1");
  });

  it("na ficha da empresa: da empresa, dos contatos dela e, quando há, dos negócios dela", () => {
    const base = leituraDoNegocio();
    estado.leitura = {
      ...base,
      contexto: { negocio: null, empresa: { id: "E1", nome: "Padaria Trigo Dourado" }, contato: null, contatos_da_empresa: [{ id: "C1", nome: "Helena Souza" }] },
    } satisfies LeituraNaTela;
    render(<SecaoDeObrigacoes escopo={{ tipo: "empresa", id: "E1" }} />);
    const grupos = [...document.querySelectorAll<HTMLElement>("[data-grupo-de-obrigacoes]")];
    expect(grupos.map((g) => g.dataset.grupoDeObrigacoes)).toEqual(["Da empresa", "Dos contatos da empresa", "Dos negócios da empresa"]);
    expect(grupos.map((g) => g.querySelectorAll("[data-obrigacao]").length)).toEqual([2, 1, 2]);
  });

  it("na ficha do contato: do contato e da empresa dele (herdado)", () => {
    const base = leituraDoNegocio();
    estado.leitura = {
      ...base,
      itens: base.itens.filter((i) => i.contact_id === "C1" || i.empresa_id === "E1"),
      contexto: { negocio: null, empresa: { id: "E1", nome: "Padaria Trigo Dourado" }, contato: { id: "C1", nome: "Helena Souza", empresa_id: "E1" }, contatos_da_empresa: [] },
    } satisfies LeituraNaTela;
    render(<SecaoDeObrigacoes escopo={{ tipo: "contato", id: "C1" }} />);
    const grupos = [...document.querySelectorAll<HTMLElement>("[data-grupo-de-obrigacoes]")];
    expect(grupos.map((g) => g.dataset.grupoDeObrigacoes)).toEqual(["Do contato", "Da empresa · Padaria Trigo Dourado"]);
    expect(grupos.map((g) => g.querySelectorAll("[data-obrigacao]").length)).toEqual([1, 2]);
  });

  it("sem dados ainda, a seção não quebra nem oferece Adicionar", () => {
    estado.leitura = undefined;
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} />);
    expect(screen.getByTestId("documentos-e-obrigacoes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adicionar" })).toBeNull();
  });
});

describe("a folha do item e o painel de receber", () => {
  function comDetalheDo(id: string) {
    const item = leituraDoNegocio().itens.find((i) => i.id === id)!;
    estado.detalhe = {
      hoje: HOJE,
      item,
      ciclos: [{ id: "c1", ciclo: 1, como: "recebido", pedido_em: null, recebido_em: "2024-10-15", valido_ate: "2025-10-14", proxima_em: null, feita_em: null, arquivo_nome: "alvara-2024.pdf", tem_arquivo: true, encerrado_em: "2025-10-14T12:00:00Z" }],
      avisos: [],
      propostas: [],
    };
  }

  it("⭐ Marcar recebido abre o painel com o 'válido até' SUGERIDO pela validade anterior, e só a confirmação grava", async () => {
    const user = userEvent.setup();
    comDetalheDo("o1");
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    await user.click(within(document.querySelector('[data-obrigacao="o1"]') as HTMLElement).getByRole("button", { name: "Marcar recebido" }));
    const painel = await screen.findByTestId("painel-de-receber");
    // Recorrência anual: a validade anterior (13/10/2026) mais um ano.
    expect((within(painel).getByLabelText("Válido até") as HTMLInputElement).value).toBe("2027-10-13");
    expect(painel.textContent).toContain("Próximo ciclo: vence em 13/10/2027. Primeiro aviso em 13/09/2027 (30 dias antes). O ciclo atual vai para o histórico do item.");
    expect(acoes.receber.mutate).not.toHaveBeenCalled();
    await user.click(within(painel).getByRole("button", { name: "Confirmar recebimento" }));
    expect(acoes.receber.mutate).toHaveBeenCalledTimes(1);
    expect(acoes.receber.mutate.mock.calls[0]?.[0]).toEqual({ id: "o1", validoAte: "2027-10-13", arquivo: null });
  });

  it("⭐ vindo da proposta do agente, confirmar decide a proposta (o arquivo é o da conversa), e não o recebimento solto", async () => {
    const user = userEvent.setup();
    comDetalheDo("o1");
    render(<ObrigacoesNoFoco dados={leituraDoNegocio()} />);
    await user.click(within(screen.getByTestId("proposta-do-agente")).getByRole("button", { name: "Sim, marcar recebido" }));
    const painel = await screen.findByTestId("painel-de-receber");
    expect(painel.textContent).toContain("alvara-2026.pdf · copiado da conversa do WhatsApp para a área privada.");
    await user.click(within(painel).getByRole("button", { name: "Confirmar recebimento" }));
    expect(acoes.decidirProposta.mutate).toHaveBeenCalledTimes(1);
    expect(acoes.decidirProposta.mutate.mock.calls[0]?.[0]).toEqual({ propostaId: "P1", decisao: "confirmar", validoAte: "2027-10-13" });
    expect(acoes.receber.mutate).not.toHaveBeenCalled();
  });

  it("documento sem validade padrão: o campo fica vazio, e a tela diz que ele fica recebido, sem validade", async () => {
    const user = userEvent.setup();
    comDetalheDo("o18");
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    await user.click(within(document.querySelector('[data-obrigacao="o18"]') as HTMLElement).getByRole("button", { name: "Ver histórico" }));
    const folha = await screen.findByTestId("folha-da-obrigacao");
    await user.click(within(folha).getByRole("button", { name: "Marcar recebido" }));
    const painel = await screen.findByTestId("painel-de-receber");
    expect((within(painel).getByLabelText(/Válido até/) as HTMLInputElement).value).toBe("");
    expect(painel.textContent).toContain("o item fica como recebido e não entra nos avisos de vencimento");
    expect(painel.textContent).toContain("Primeiro recebimento deste item.");
  });

  it("a folha mostra o histórico dos ciclos e a antecedência dos avisos do item", async () => {
    const user = userEvent.setup();
    comDetalheDo("o1");
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    await user.click(within(document.querySelector('[data-obrigacao="o1"]') as HTMLElement).getByRole("button", { name: "Ver histórico" }));
    const folha = await screen.findByTestId("folha-da-obrigacao");
    expect(folha.textContent).toContain("Histórico do item");
    expect(folha.textContent).toContain("14/10/2025");
    const avisos = within(folha).getByTestId("avisos-da-obrigacao");
    expect([...avisos.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value).slice(0, 3)).toEqual(["30", "15", "7"]);
  });
});

describe("adicionar um item", () => {
  it("o formulário nasce com o primeiro tipo do funil, a prévia da situação, e manda o item ligado a quem o tipo costuma se ligar", async () => {
    const user = userEvent.setup();
    const alvara = MODELOS_DE_TIPO.find((m) => m.nome === "Alvará de funcionamento")!;
    estado.catalogo = { tipos: [{ ...alvara, id: "T1", pipeline_id: "P", posicao: 0 }], modelos: [...MODELOS_DE_TIPO] };
    render(<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: "N1" }} mostrarPropostas={false} />);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    const formulario = await screen.findByTestId("formulario-de-obrigacao");
    expect(formulario.textContent).toContain("Adicionar documento ou atividade");
    expect(formulario.textContent).toContain("Este tipo é da empresa: aparece em todos os negócios dela.");
    expect(formulario.textContent).toContain("Situação calculada pelas datas (ninguém digita)");
    expect(formulario.textContent).toContain("ainda não foi pedido");
    await user.click(within(formulario).getByRole("button", { name: "Adicionar" }));
    expect(acoes.adicionar.mutate).toHaveBeenCalledTimes(1);
    expect((acoes.adicionar.mutate.mock.calls[0]?.[0] as { item: Record<string, unknown> }).item).toMatchObject({
      nome: "Alvará de funcionamento",
      tipo_id: "T1",
      categoria: "documento",
      empresa_id: "E1",
      lead_id: null,
      recorrencia: "anual",
      validade_meses: 12,
      avisos_dias: [30, 15, 7],
    });
  });
});

describe("as obrigações no Foco do cartão aberto", () => {
  it("só o que pede ação agora: a proposta do agente e os itens vencidos, vencendo ou sem resposta", () => {
    const doFoco = obrigacoesDoFoco(leituraDoNegocio());
    expect(doFoco.propostas.map((i) => i.id)).toEqual(["o1"]);
    // O4 (4 dias), o1 (12 dias, renovação pedida), o6 (17 dias). A licença válida e o contrato a pedir ficam fora.
    expect(doFoco.urgentes.map((i) => i.id)).toEqual(["o4", "o1", "o6"]);
    expect(obrigacoesDoFoco(undefined)).toEqual({ propostas: [], urgentes: [] });
  });

  it("cada item diz de quem é: do negócio, da empresa ou do contato", () => {
    render(<ObrigacoesNoFoco dados={leituraDoNegocio()} />);
    const foco = screen.getByTestId("obrigacoes-no-foco");
    expect((foco.querySelector('li[data-obrigacao="o4"]') as HTMLElement).textContent).toContain("em 4 dias · 05/10/2026 · do negócio");
    expect((foco.querySelector('li[data-obrigacao="o1"]') as HTMLElement).textContent).toContain("da empresa");
    expect((foco.querySelector('li[data-obrigacao="o6"]') as HTMLElement).textContent).toContain("do contato");
    expect(foco.querySelector('li[data-obrigacao="o2"]')).toBeNull();
  });

  it("⭐ a proposta do agente pergunta, e não marca nada: diz o arquivo, o documento e leva à conversa", () => {
    render(<ObrigacoesNoFoco dados={leituraDoNegocio()} />);
    const proposta = screen.getByTestId("proposta-do-agente");
    expect(proposta.textContent).toContain("O cliente enviou um arquivo no WhatsApp: “alvara-2026.pdf”. É este documento: Alvará de funcionamento?");
    expect(proposta.textContent).toContain("O agente propõe, a pessoa confirma. Ele nunca marca recebido sozinho.");
    expect(within(proposta).getByRole("link", { name: "ver na conversa" }).getAttribute("href")).toBe("/app/inbox?id=CV1");
    expect(within(proposta).getByRole("button", { name: "Sim, marcar recebido" })).toBeTruthy();
    expect(within(proposta).getByRole("button", { name: "Não é" })).toBeTruthy();
    for (const acao of Object.values(acoes)) expect(acao.mutate).not.toHaveBeenCalled();
  });

  it("⭐ 'Sim, marcar recebido' abre o painel de receber em vez de gravar: quem confirma é a pessoa, lá", async () => {
    const user = userEvent.setup();
    render(<ObrigacoesNoFoco dados={leituraDoNegocio()} />);
    await user.click(within(screen.getByTestId("proposta-do-agente")).getByRole("button", { name: "Sim, marcar recebido" }));
    expect(acoes.decidirProposta.mutate).not.toHaveBeenCalled();
    expect(acoes.receber.mutate).not.toHaveBeenCalled();
    expect(estado.detalhePedido).toContain("o1");
  });

  it("⭐ 'Não é' grava a recusa, e só ela: o item continua pendente", async () => {
    const user = userEvent.setup();
    render(<ObrigacoesNoFoco dados={leituraDoNegocio()} />);
    await user.click(within(screen.getByTestId("proposta-do-agente")).getByRole("button", { name: "Não é" }));
    expect(acoes.decidirProposta.mutate).toHaveBeenCalledTimes(1);
    expect(acoes.decidirProposta.mutate.mock.calls[0]?.[0]).toEqual({ propostaId: "P1", decisao: "recusar" });
    expect(acoes.receber.mutate).not.toHaveBeenCalled();
  });

  it("com tudo em dia, o Foco não ganha nada", () => {
    const base = leituraDoNegocio();
    render(<ObrigacoesNoFoco dados={{ ...base, itens: base.itens.filter((i) => i.id === "o2") }} />);
    expect(screen.queryByTestId("obrigacoes-no-foco")).toBeNull();
  });
});

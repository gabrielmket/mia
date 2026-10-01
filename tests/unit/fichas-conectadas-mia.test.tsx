import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — as fichas conectadas: a do contato (empresa OPCIONAL, negócios,
 * conversas, IA, agenda, tarefas, compras) e a da empresa (contatos com papel,
 * negócios, compras de todos). E as portas: do atendimento ao negócio e à
 * empresa, e da ficha do upstream para a ficha conectada.
 */
const estado = vi.hoisted(() => ({ mostraEmpresa: true, comEmpresa: false }));
const vincular = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useMostraEmpresas", () => ({ useMostraEmpresas: () => estado.mostraEmpresa }));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({ useDefaultPipeline: () => ({ data: null }) }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({ useAssignableMembers: () => ({ data: [] }) }));
vi.mock("@/hooks/tasks/useTasks", () => ({ useTasks: () => ({ tarefas: [], alternarConcluida: vi.fn() }) }));
vi.mock("@/hooks/webhooks/useWebhookSources", () => ({ usePipelines: () => ({ data: { data: [] } }) }));
vi.mock("@/components/empresas/SeletorDeEmpresa", () => ({
  SeletorDeEmpresa: ({ aoMudar }: { aoMudar: (v: string | null) => void }) => (
    <button type="button" onClick={() => aoMudar("vida")}>
      escolher Vida Plena
    </button>
  ),
}));
vi.mock("@/components/kanban/SeletorDeContato", () => ({ SeletorDeContato: () => null }));
vi.mock("@/components/kanban/NewLeadDialog", () => ({ NewLeadDialog: () => null }));
vi.mock("@/app/app/empresas/_client", () => ({ FormularioDaEmpresa: () => null }));
// FORK MIA (9018) — Documentos e obrigações: a seção e o Foco leem destes hooks
// (tests/unit/obrigacoes-telas.test.tsx prova o conteúdo; aqui só a presença).
vi.mock("@/hooks/obrigacoes/useObrigacoes", () => {
  const acao = { mutate: vi.fn(), isPending: false };
  return {
    useObrigacoes: () => ({ data: undefined, isLoading: false, isError: false }),
    useDetalheDaObrigacao: () => ({ data: undefined, isLoading: false, isError: false }),
    useTiposDeObrigacao: () => ({ data: undefined }),
    useAcoesDeObrigacao: () => ({ adicionar: acao, pedir: acao, receber: acao, marcarFeita: acao, editar: acao, decidirProposta: acao }),
  };
});

const COMPRAS = {
  selo: "recorrente" as const,
  quantidade: 2,
  totalCents: 87_000_000,
  moeda: "BRL",
  outrasMoedas: false,
  ticketMedioCents: 43_500_000,
  ultima: { data: "2024-08-22T12:00:00Z", haDias: 769 },
  primeira: { data: "2023-03-15T12:00:00Z", haDias: 1294 },
  intervaloMedioDias: 526,
  intervalosMedidos: 1,
  proximaProvavel: { data: "2026-01-30T12:00:00Z", jaPassou: true, emDias: 0 },
  habito: { oQue: "Sala 42 m²; Sala Moema", pagamento: null, finalidade: null, derivado: true as const },
  compras: [
    { id: "lead:aurora", data: "2024-08-22T12:00:00Z", item: "Sala Aurora", valorCents: 45_000_000, moeda: "BRL", origem: "negocio_ganho" as const, referencia: "Sala Aurora", contatoId: "ricardo", contatoNome: "Ricardo Alves", empresaId: "vida", negocioId: "aurora", pagamento: null, finalidade: null },
  ],
};

vi.mock("@/hooks/cartoes/useFichas", () => ({
  useVincularEmpresa: () => ({ mutate: vincular, isPending: false }),
  useFichaDoContato: () => ({
    isLoading: false,
    isError: false,
    data: {
      empresa: estado.comEmpresa ? { id: "vida", nome: "Clínica Vida Plena", cnpj: null, cargo: "Sócia", papel: "decisor", principal: true } : null,
      negocios: [
        { id: "sala", titulo: "Sala 42 m²", status: "open", etapa: "Proposta", funil: "Locação", valorCents: 22_320_000, moeda: "BRL", donoUserId: null, donoKind: null, motivoDaPerda: null, empresaId: null, envolvidoComo: null, probabilidade: 65 },
      ],
      conversas: [{ id: "cv", preview: "Recebi a proposta", ultimaEm: null, naoLidas: 0, status: "open" }],
      estagio: "negotiating",
      resumo: null,
      memoria: [{ id: "n", titulo: "Prefere Teams depois das 18h", corpo: "x", em: "" }],
      agenda: [],
      compras: null,
      comprasDaEmpresa: null,
    },
  }),
  useFichaDaEmpresa: () => ({
    isLoading: false,
    isError: false,
    data: {
      id: "vida", nome: "Clínica Vida Plena", cnpj: "12345678000190", site: null, telefone: null, email: null, endereco: null, observacoes: null, tags: [], custom_fields: {}, created_at: "", updated_at: "",
      ficha: {
        pessoas: [
          { id: "carla", nome: "Carla Mendes", telefone: null, email: null, cargo: "Sócia", papel: "decisor", principal: true, conversaId: "cv", ultimaAtividade: null },
          { id: "ricardo", nome: "Ricardo Alves", telefone: null, email: null, cargo: null, papel: "financeiro", principal: false, conversaId: null, ultimaAtividade: null },
        ],
        negocios: [],
        numeros: { abertos: 1, abertosCents: 22_320_000, moeda: "BRL", ultimaInteracao: null, maisQuente: 65 },
        compras: COMPRAS,
      },
    },
  }),
}));

import { FichaConectadaDoContato } from "@/components/cartoes/fichas/FichaConectadaDoContato";
import { FichaDaEmpresa } from "@/components/cartoes/fichas/FichaDaEmpresa";

beforeEach(() => {
  estado.mostraEmpresa = true;
  estado.comEmpresa = false;
  vincular.mockReset();
});

describe("ficha do contato", () => {
  it("sem empresa: nenhum campo vazio, só o link de vincular; ao vincular, papel, cargo, principal e os negócios abertos", async () => {
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.queryByTestId("empresa-do-contato")).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Vincular a uma empresa" }));
    await user.click(screen.getByRole("button", { name: "escolher Vida Plena" }));
    await user.type(screen.getByLabelText("Cargo"), "Sócia");
    await user.selectOptions(screen.getByLabelText("Papel"), "decisor");
    await user.click(screen.getByLabelText("Contato principal desta empresa"));
    await user.click(screen.getByRole("button", { name: "Vincular" }));
    expect(vincular).toHaveBeenCalledWith(
      { contatoId: "carla", empresaId: "vida", cargo: "Sócia", papel: "decisor", principal: true, ligarNegocios: ["sala"] },
      expect.anything(),
    );
  });

  it("quem vende a pessoas (B2C) não vê nada de empresa", () => {
    estado.mostraEmpresa = false;
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.queryByText(/Vincular a uma empresa/)).toBeNull();
  });

  it("com empresa: o nome leva à ficha dela, com cargo e papel, e Desvincular", async () => {
    estado.comEmpresa = true;
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    const bloco = screen.getByTestId("empresa-do-contato");
    expect(within(bloco).getByRole("link", { name: "Clínica Vida Plena" }).getAttribute("href")).toBe("/app/empresas/vida");
    expect(within(bloco).getByText("Decisor")).toBeTruthy();
    await user.click(within(bloco).getByRole("button", { name: "Desvincular" }));
    expect(vincular).toHaveBeenCalledWith({ contatoId: "carla", empresaId: null, papel: null, principal: false });
  });

  it("negócios levam ao cartão aberto; conversas, ciclo e memória da IA aparecem", () => {
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.getByRole("link", { name: "Sala 42 m²" }).getAttribute("href")).toBe("/app/leads/sala");
    expect(screen.getByRole("link", { name: "Recebi a proposta" }).getAttribute("href")).toBe("/app/inbox?id=cv");
    expect(screen.getByText("Negociando").getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Prefere Teams depois das 18h")).toBeTruthy();
  });
});

describe("ficha da empresa", () => {
  it("contatos com papel e a principal; compras de todos dizendo quem comprou; números", () => {
    render(<FichaDaEmpresa empresaId="vida" />);
    const pessoas = screen.getByTestId("pessoas-da-empresa");
    expect(within(pessoas).getByText("Decisor")).toBeTruthy();
    expect(within(pessoas).getByText("principal")).toBeTruthy();
    expect(within(pessoas).getByText("Financeiro")).toBeTruthy();
    const compras = screen.getByTestId("historico-de-compras");
    expect(within(compras).getByText("Cliente recorrente")).toBeTruthy();
    expect(within(compras).getByRole("link", { name: "Ricardo Alves" }).getAttribute("href")).toBe("/app/contacts/ricardo");
    expect(within(compras).getByText("já passou: bom momento para oferecer")).toBeTruthy();
    expect(within(screen.getByTestId("numeros-da-empresa")).getByText("65%")).toBeTruthy();
  });
});

describe("documentos e obrigações nas fichas", () => {
  it("a ficha da empresa e a do contato têm a seção; contato anonimizado, não", () => {
    const { unmount } = render(<FichaDaEmpresa empresaId="vida" />);
    expect(screen.getByTestId("documentos-e-obrigacoes")).toBeTruthy();
    unmount();
    const contato = render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.getByTestId("documentos-e-obrigacoes")).toBeTruthy();
    contato.unmount();
    render(<FichaConectadaDoContato contactId="carla" anonimizado />);
    expect(screen.queryByTestId("documentos-e-obrigacoes")).toBeNull();
  });
});

describe("as portas", () => {
  it("do atendimento ao cartão do negócio e à ficha da empresa", () => {
    const painel = readFileSync("components/inbox/CRMSidePanel.tsx", "utf8");
    expect(painel).toContain("href={`/app/leads/${ativo.id}`}");
    expect(painel).toContain("href={`/app/empresas/${empresa.id}`}");
  });

  it("a ficha do contato do upstream mostra a ficha conectada", () => {
    expect(readFileSync("app/app/contacts/[id]/_client.tsx", "utf8")).toMatch(/<FichaConectadaDoContato\b/);
  });
});

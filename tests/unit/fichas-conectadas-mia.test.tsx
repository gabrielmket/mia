import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — as fichas conectadas: a do contato (empresa OPCIONAL, negócios,
 * conversas, IA, agenda, tarefas, compras) e a da empresa (pessoas com papel,
 * negócios, compras de todos). E as portas: do atendimento ao negócio e à
 * empresa, e da ficha do upstream para a ficha conectada.
 *
 * Desde a .79 (empresa única, protótipo aprovado em 15/10/2026, telas 2 e 3):
 * o contato pode estar em VÁRIAS empresas (uma aparece no cartão), o papel é
 * trocado na própria ficha, vários números são uma pessoa só, e a ficha da
 * empresa mostra "Também está em", torna principal, tira da empresa e recusa a
 * exclusão com negócio aberto.
 */
const estado = vi.hoisted(() => ({
  mostraEmpresa: true,
  empresas: 0,
  outrosNumeros: false,
  negocioAbertoDaEmpresa: false,
}));
const acoes = vi.hoisted(() => ({
  vincular: vi.fn(),
  desvincular: vi.fn(),
  juntar: vi.fn(),
  separar: vi.fn(),
  excluir: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { is_platform_admin: false, support: null }, activeOrg: { role: "manager" } }),
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
vi.mock("@/components/empresas/FormularioDaEmpresa", () => ({ FormularioDaEmpresa: () => null }));
vi.mock("@/hooks/useEmpresas", () => {
  const de = (fn: ReturnType<typeof vi.fn>) => ({ mutate: fn, isPending: false });
  return {
    useVincularPessoa: () => de(acoes.vincular),
    useDesvincularPessoa: () => de(acoes.desvincular),
    useJuntarNumeros: () => de(acoes.juntar),
    useSepararNumero: () => de(acoes.separar),
    useExcluirEmpresa: () => de(acoes.excluir),
    useAtualizarPelaReceita: () => de(vi.fn()),
    useMesclarEmpresas: () => de(vi.fn()),
    useEmpresasDoSeletor: () => ({ data: { data: [] } }),
  };
});
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

const VIDA = { id: "vida", nome: "Clínica Vida Plena", cnpj: null, cargo: "Sócia", setor: null, papel: "decisor", principal: true, noCartao: true };
const SOL = { id: "sol", nome: "Studio Sol", cnpj: null, cargo: "Consultora", setor: null, papel: "influenciador", principal: false, noCartao: false };

vi.mock("@/hooks/cartoes/useFichas", () => ({
  useFichaDoContato: () => ({
    isLoading: false,
    isError: false,
    data: {
      empresa: estado.empresas > 0 ? { id: "vida", nome: "Clínica Vida Plena", cnpj: null, cargo: "Sócia", papel: "decisor", principal: true } : null,
      empresas: estado.empresas === 0 ? [] : estado.empresas === 1 ? [VIDA] : [VIDA, SOL],
      outrosNumeros: estado.outrosNumeros ? [{ id: "carla-2", telefone: "+5531900000109", nome: "Carla Mendes" }] : [],
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
      id: "vida", nome: "Clínica Vida Plena", razao_social: "Vida Plena Odontologia Ltda.", cnpj: "12345678000190", site: null, telefone: null, email: null, endereco: null, observacoes: null, tags: [], custom_fields: {}, created_at: "", updated_at: "",
      receita: { situacao: "Ativa", abertura: "2014-03-12", atividade: "Atividade odontológica", natureza: null, porte: null, endereco: "Rua das Acácias, 120 · Belo Horizonte, MG", consultadaEm: null },
      total_ganho_cents: 0,
      parece_com: null,
      ficha: {
        pessoas: [
          { id: "carla", pessoaId: "p-carla", nome: "Carla Mendes", telefone: "+5531900000101", telefones: ["+5531900000101", "+5531900000109"], email: null, cargo: "Sócia", papel: "decisor", principal: true, conversaId: "cv", ultimaAtividade: null, outrasEmpresas: [] },
          { id: "ricardo", pessoaId: "p-ricardo", nome: "Ricardo Alves", telefone: null, telefones: [], email: null, cargo: null, papel: "financeiro", principal: false, conversaId: null, ultimaAtividade: null, outrasEmpresas: [{ id: "sol", nome: "Studio Sol" }] },
        ],
        negocios: estado.negocioAbertoDaEmpresa
          ? [{ id: "sala", titulo: "Sala 42 m²", status: "open", etapa: "Proposta", funil: "Locação", valorCents: 1, moeda: "BRL", donoUserId: null, donoKind: null, motivoDaPerda: null, empresaId: "vida", envolvidoComo: null, probabilidade: null }]
          : [],
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
  estado.empresas = 0;
  estado.outrosNumeros = false;
  estado.negocioAbertoDaEmpresa = false;
  for (const fn of Object.values(acoes)) fn.mockReset();
});

describe("ficha do contato", () => {
  it("sem empresa: nenhum campo vazio, só o link de vincular; ao vincular, papel, cargo e principal", async () => {
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.queryByTestId("empresa-do-contato")).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Vincular a uma empresa" }));
    await user.click(screen.getByRole("button", { name: "escolher Vida Plena" }));
    await user.type(screen.getByLabelText("Cargo (opcional)"), "Sócia");
    await user.selectOptions(screen.getByLabelText("Papel"), "decisor");
    await user.click(screen.getByLabelText("Contato principal desta empresa"));
    await user.click(screen.getByRole("button", { name: "Vincular a esta empresa" }));
    expect(acoes.vincular).toHaveBeenCalledWith(
      { empresaId: "vida", contatoId: "carla", cargo: "Sócia", papel: "decisor", principal: true },
      expect.anything(),
    );
  });

  it("quem vende a pessoas (B2C) não vê nada de empresa", () => {
    estado.mostraEmpresa = false;
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.queryByText(/Vincular a uma empresa/)).toBeNull();
  });

  it("com empresa: o nome leva à ficha dela, com o papel trocável, e Tirar da empresa", async () => {
    estado.empresas = 1;
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    const bloco = screen.getByTestId("empresa-do-contato");
    expect(within(bloco).getByRole("link", { name: "Clínica Vida Plena" }).getAttribute("href")).toBe("/app/companies/vida");
    expect((within(bloco).getByLabelText("Papel: Clínica Vida Plena") as HTMLSelectElement).value).toBe("decisor");
    await user.selectOptions(within(bloco).getByLabelText("Papel: Clínica Vida Plena"), "financeiro");
    expect(acoes.vincular).toHaveBeenCalledWith({ empresaId: "vida", contatoId: "carla", papel: "financeiro" });
    await user.click(within(bloco).getByRole("button", { name: "Tirar da empresa" }));
    expect(acoes.desvincular).toHaveBeenCalledWith({ empresaId: "vida", contatoId: "carla" });
  });

  it("em duas empresas: a do cartão marcada, e a outra pode passar a ser a do cartão", async () => {
    estado.empresas = 2;
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    const vinculos = screen.getAllByTestId("vinculo-do-contato");
    expect(vinculos).toHaveLength(2);
    expect(within(vinculos[0]!).getByText(/a que aparece no cartão/)).toBeTruthy();
    expect(within(vinculos[0]!).queryByRole("button", { name: "Mostrar esta no cartão" })).toBeNull();
    await user.click(within(vinculos[1]!).getByRole("button", { name: "Mostrar esta no cartão" }));
    expect(acoes.vincular).toHaveBeenCalledWith({ empresaId: "sol", contatoId: "carla", noCartao: true });
  });

  it("vários números: a mesma pessoa, e o desfazer", async () => {
    estado.outrosNumeros = true;
    const user = userEvent.setup();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    const bloco = screen.getByTestId("numeros-da-pessoa");
    expect(within(bloco).getByText(/2 números, a mesma pessoa/)).toBeTruthy();
    expect(within(bloco).getByRole("link").getAttribute("href")).toBe("/app/contacts/carla-2");
    await user.click(within(bloco).getByRole("button", { name: "Separar este número" }));
    expect(acoes.separar).toHaveBeenCalledWith("carla");
  });

  it("negócios levam ao cartão aberto; conversas, ciclo e memória da IA aparecem", () => {
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.getByRole("link", { name: "Sala 42 m²" }).getAttribute("href")).toBe("/app/leads/sala");
    expect(screen.getByRole("link", { name: "Recebi a proposta" }).getAttribute("href")).toBe("/app/inbox?id=cv");
    expect(screen.getByText("Negociando").getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Prefere Teams depois das 18h")).toBeTruthy();
  });

  it("(.81) a carteira do cliente do upstream mora dentro da ficha, e sem ela nada sobra", () => {
    const { unmount } = render(
      <FichaConectadaDoContato contactId="carla" anonimizado={false} carteira={<div data-testid="carteira-do-contato" />} />,
    );
    expect(within(screen.getByTestId("ficha-conectada-do-contato")).getByTestId("carteira-do-contato")).toBeTruthy();
    unmount();
    render(<FichaConectadaDoContato contactId="carla" anonimizado={false} />);
    expect(screen.queryByTestId("carteira-do-contato")).toBeNull();
  });
});

describe("ficha da empresa", () => {
  it("pessoas com papel e a principal, todos os números, e onde mais a pessoa está; compras de todos; números", async () => {
    const user = userEvent.setup();
    render(<FichaDaEmpresa empresaId="vida" />);
    const pessoas = screen.getByTestId("pessoas-da-empresa");
    expect((within(pessoas).getByLabelText("Papel: Carla Mendes") as HTMLSelectElement).value).toBe("decisor");
    expect((within(pessoas).getByLabelText("Papel: Ricardo Alves") as HTMLSelectElement).value).toBe("financeiro");
    expect(within(pessoas).getByText("principal")).toBeTruthy();
    expect(within(pessoas).getByText(/\+5531900000101 e \+5531900000109/)).toBeTruthy();
    expect(within(pessoas).getByRole("link", { name: "Studio Sol" }).getAttribute("href")).toBe("/app/companies/sol");
    await user.click(within(pessoas).getByRole("button", { name: "Tornar principal" }));
    expect(acoes.vincular).toHaveBeenCalledWith({ empresaId: "vida", contatoId: "ricardo", principal: true });
    const compras = screen.getByTestId("historico-de-compras");
    expect(within(compras).getByText("Cliente recorrente")).toBeTruthy();
    expect(within(compras).getByRole("link", { name: "Ricardo Alves" }).getAttribute("href")).toBe("/app/contacts/ricardo");
    expect(within(compras).getByText("já passou: bom momento para oferecer")).toBeTruthy();
    expect(within(screen.getByTestId("numeros-da-empresa")).getByText("65%")).toBeTruthy();
    expect(within(screen.getByTestId("dados-da-receita")).getByText("Ativa")).toBeTruthy();
  });

  it("excluir com negócio aberto é recusado; sem ele, confirma dizendo quem fica sem empresa", async () => {
    const user = userEvent.setup();
    estado.negocioAbertoDaEmpresa = true;
    const { unmount } = render(<FichaDaEmpresa empresaId="vida" />);
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(screen.getByTestId("excluir-recusado").textContent).toContain("Não dá para excluir: 1 negócio aberto");
    unmount();

    estado.negocioAbertoDaEmpresa = false;
    render(<FichaDaEmpresa empresaId="vida" />);
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    const confirmar = screen.getByTestId("excluir-confirmar");
    expect(confirmar.textContent).toContain("2 pessoas ficam como contato sem empresa");
    await user.click(within(confirmar).getByRole("button", { name: "Excluir" }));
    expect(acoes.excluir).toHaveBeenCalledWith("vida", expect.anything());
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
  it("do atendimento ao cartão do negócio e à ficha da empresa (a tela única, /app/companies)", () => {
    const painel = readFileSync("components/inbox/CRMSidePanel.tsx", "utf8");
    expect(painel).toContain("href={`/app/leads/${ativo.id}`}");
    expect(painel).toContain("href={`/app/companies/${empresa.id}`}");
  });

  it("a ficha do contato do upstream mostra a ficha conectada", () => {
    expect(readFileSync("app/app/contacts/[id]/_client.tsx", "utf8")).toMatch(/<FichaConectadaDoContato\b/);
  });
});

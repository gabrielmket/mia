import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — o cartão aberto: a gaveta larga do negócio, com tela cheia,
 * barra de etapas com dias, Foco (aprovar vira tarefa), resumo da IA, pessoas,
 * compras, campos "veio da conversa" e histórico com filtros.
 *
 * E a catraca de convivência com o upstream: o cartão aberto SUBSTITUI o dossiê
 * no quadro reusando as peças dele. Peça nova que o upstream puser no dossiê
 * precisa entrar aqui também — senão ela some da tela sem ninguém ver.
 */
const confirmar = vi.hoisted(() => vi.fn());
const decidir = vi.hoisted(() => vi.fn());
const incluir = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useUser: () => ({ id: "u-ju", is_platform_admin: false }),
  useActiveOrg: () => ({ role: "agent", timezone: "America/Sao_Paulo" }),
}));
vi.mock("@/hooks/kanban/usePodeVerEquipe", () => ({ usePodeVerEquipe: () => false }));
vi.mock("@/hooks/kanban/useUpdateLead", () => ({
  useWinLead: () => ({ mutate: vi.fn(), isPending: false }),
  useEditLead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/kanban/useNextAction", () => ({
  useDecidirProximaAcao: () => ({ mutate: decidir, isPending: false }),
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [{ user_id: "u-ju", full_name: "Juliana Prado", role: "agent" }] }),
}));
vi.mock("@/hooks/contacts/useHierarquiaDoAnuncio", () => ({ useHierarquiaDoAnuncio: () => ({ data: null }) }));
vi.mock("@/hooks/tasks/useTasks", () => ({
  useTasks: () => ({
    tarefas: [
      { id: "t1", title: "Ligar para confirmar a visita", due_date: "2020-01-01T12:00:00Z", status: "pending", assigned_to: "u-ju", priority: "medium", lead_id: "L1", contact_id: "C1", organization_id: "o", description: null, created_by: null, created_at: "", updated_at: "" },
    ],
    editarTarefa: vi.fn(async () => undefined),
    criarTarefa: vi.fn(async () => undefined),
    alternarConcluida: vi.fn(async () => undefined),
  }),
}));
vi.mock("@/hooks/leads/useLeadTimeline", () => ({
  useLeadTimeline: () => ({
    itens: [
      { id: "n", organization_id: "o", lead_id: "L1", contact_id: null, source_module: "crm", source_id: null, type: "note", payload: { texto: "Diego só pode aos sábados", fixada: true }, metadata: {}, performed_at: "2026-09-28T10:00:00Z", performed_by_user_id: null, actor_kind: "user", actor_user_name: "Juliana" },
      { id: "v1", organization_id: "o", lead_id: "L1", contact_id: null, source_module: "ai", source_id: null, type: "send_vetoed", payload: {}, metadata: {}, performed_at: "2026-09-29T20:05:00Z", performed_by_user_id: null, actor_kind: "ai" },
      { id: "v2", organization_id: "o", lead_id: "L1", contact_id: null, source_module: "ai", source_id: null, type: "send_vetoed", payload: {}, metadata: {}, performed_at: "2026-09-29T20:31:00Z", performed_by_user_id: null, actor_kind: "ai" },
      { id: "e", organization_id: "o", lead_id: "L1", contact_id: null, source_module: "crm", source_id: null, type: "lead_edited", payload: { custom_field_keys: ["empreendimento"] }, metadata: {}, performed_at: "2026-09-27T10:00:00Z", performed_by_user_id: null, actor_kind: "ai" },
    ],
    chegouAoVivo: new Set<string>(),
    isLoading: false,
    isError: false,
    realtimeStatus: "SUBSCRIBED",
    seguranca: { divergencias: 0 },
  }),
}));
vi.mock("@/hooks/cartoes/useCartaoAberto", () => ({
  useCartaoAberto: () => ({ isLoading: false, isError: false, data: CARTAO }),
  useMensagensDoNegocio: () => ({ data: [], isLoading: false }),
  useNotaDoNegocio: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmarCampo: () => ({ mutate: confirmar, isPending: false }),
  useEnvolvidosDoNegocio: () => ({ incluir: { mutate: incluir, isPending: false }, retirar: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock("@/components/kanban/ContatoDoNegocio", () => ({ ContatoDoNegocio: () => null }));
vi.mock("@/components/kanban/LeadFieldsForm", () => ({ LeadFieldsForm: () => <div data-testid="formulario-do-upstream" /> }));
vi.mock("@/components/kanban/PropostasDoNegocio", () => ({ PropostasDoNegocio: () => null }));
vi.mock("@/components/kanban/LoseLeadDialog", () => ({ LoseLeadDialog: () => null }));
vi.mock("@/components/kanban/SeletorDeContato", () => ({ SeletorDeContato: () => null }));
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

import { CartaoAberto } from "@/components/cartoes/aberto/CartaoAberto";
import { ProvedorDoCartao } from "@/components/cartoes/ContextoDoCartao";
import type { CartaoAberto as DadosDoCartao } from "@/lib/cartoes/cartao-aberto";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";

const CARTAO: DadosDoCartao = {
  etapas: [
    { id: "S1", nome: "Novo lead", dias: 1, atual: false, feita: true },
    { id: "S2", nome: "Visita agendada", dias: 3, atual: true, feita: false },
    { id: "S3", nome: "Proposta", dias: null, atual: false, feita: false },
  ],
  resumo: {
    atualizadoEm: new Date(Date.now() - 12 * 60_000).toISOString(),
    estagio: "qualified",
    quer: "2 dormitórios com varanda",
    orcamento: "parcela até R$ 3.200",
    decide: "Ela e o marido",
    prazo: "julho de 2027",
    objecoes: [
      { texto: "parcela da obra", aberta: true },
      { texto: "distância do metrô", aberta: false },
    ],
    compromissos: [],
    promessas: [{ oQue: "Simulação da parcela da obra", prazo: null }],
    resumo: "Viu o vídeo tour e marcou visita no sábado.",
  },
  origem: {
    canal: { sigla: "META", campanha: "Jardim das Flores" },
    campanha: "Jardim das Flores",
    conjunto: "Zona Sul",
    anuncio: "Vídeo tour",
    anuncioSemNome: false,
    primeiraMensagem: { texto: "Oi! Vi o vídeo", em: "2026-09-26T20:14:00Z" },
    primeiroToque: { em: "2026-09-26T20:14:00Z" },
    conversoes: [{ plataforma: "meta_ads", evento: "QualifiedLead", situacao: "enviada", motivo: null, quando: "2026-09-27T11:02:00Z" }],
    semClique: false,
  },
  pessoas: [
    { contatoId: "C1", nome: "Mariana Costa", telefone: "+5511955550142", cargo: null, papel: null, principal: true, conversaId: "CV1" },
    { contatoId: "C2", nome: "Diego Costa", telefone: null, cargo: null, papel: "decisor", principal: false, conversaId: null },
  ],
  outrosNegocios: [{ id: "L0", titulo: "Studio Vista Parque", status: "lost", etapa: null, valorCents: null, moeda: null, motivoDaPerda: "Preço" }],
  empresa: null,
  empresaDoContato: null,
  compras: {
    selo: "recorrente",
    quantidade: 2,
    totalCents: 58_700_000,
    moeda: "BRL",
    outrasMoedas: false,
    ticketMedioCents: 29_350_000,
    ultima: { data: "2026-02-18T12:00:00Z", haDias: 224 },
    primeira: { data: "2025-06-10T12:00:00Z", haDias: 477 },
    intervaloMedioDias: 253,
    intervalosMedidos: 1,
    proximaProvavel: { data: "2026-10-29T12:00:00Z", jaPassou: false, emDias: 29 },
    habito: { oQue: "Studio", pagamento: "À vista", finalidade: null, derivado: true },
    compras: [],
  },
  agenda: [],
};

const STAGES: Stage[] = [
  { id: "S1", organization_id: "o", pipeline_id: "P", name: "Novo lead", slug: "novo", position: 1, color: null, is_won: false, is_lost: false, is_archived: false, expected_duration_hours: null },
  { id: "S2", organization_id: "o", pipeline_id: "P", name: "Visita agendada", slug: "visita", position: 2, color: null, is_won: false, is_lost: false, is_archived: false, expected_duration_hours: null },
  { id: "S3", organization_id: "o", pipeline_id: "P", name: "Proposta", slug: "proposta", position: 3, color: null, is_won: false, is_lost: false, is_archived: false, expected_duration_hours: null },
];

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "L1", organization_id: "o", pipeline_id: "P", stage_id: "S2", contact_id: "C1", title: "Apto 2 dorm", description: null,
    status: "open", lost_reason: null, position_in_stage: 1, value_cents: 48_500_000, currency: "BRL", owner_user_id: "u-ju",
    owner_kind: "user", owner_agent_id: null, assigned_at: null, last_activity_at: null, stage_changed_at: null, expected_close_date: null,
    closed_at: null, source: "meta_ads", source_metadata: {}, external_id: null, custom_fields: { empreendimento: "Jardim das Flores" }, tags: [],
    created_at: "2026-09-26T12:00:00Z", updated_at: "2026-09-26T12:00:00Z", created_by_user_id: null,
    next_action: { label: "enviar simulação da parcela da obra", seq: 7, proposed_at: "" },
    conversa: { id: "CV1", preview: "e a parcela da obra fica em quanto?", last_message_at: "", unread: 2 },
    cartao: {
      canal: { sigla: "META", campanha: "Jardim das Flores" },
      bola: { com: "nos", quem: "lead", desde: new Date(Date.now() - 12 * 60_000).toISOString(), porUsuarioId: null },
      compromisso: null, objecao: "parcela da obra", tarefasAtrasadas: 1, temTarefaFutura: false,
      compras: { quantidade: 2, totalCents: 58_700_000, moeda: "BRL" }, pessoa: null, contatoNome: "Mariana Costa", chanceDaEtapa: 60,
    },
    ...over,
  };
}

function renderCartao(onMoverEtapa = vi.fn()) {
  render(
    <ProvedorDoCartao usuarioAtualId="u-ju" nomes={new Map([["u-ju", "Juliana Prado"]])}>
    <CartaoAberto
      open
      onOpenChange={() => undefined}
      lead={lead()}
      pipelineId="P"
      fieldDefs={[{ key: "empreendimento", label: "Empreendimento", type: "text" }]}
      stages={STAGES}
      stageName="Visita agendada"
      onMoverEtapa={onMoverEtapa}
    />
    </ProvedorDoCartao>,
  );
  return { onMoverEtapa };
}

beforeEach(() => {
  confirmar.mockReset();
  decidir.mockReset();
  incluir.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("o cartão aberto", () => {
  it("abre largo e alterna a tela cheia", async () => {
    const user = userEvent.setup();
    renderCartao();
    const gaveta = screen.getByTestId("cartao-aberto");
    expect(gaveta.className).toContain("sm:max-w-5xl");
    await user.click(screen.getByRole("button", { name: /Tela cheia/ }));
    expect(gaveta.className).toContain("sm:max-w-none");
    expect(gaveta.dataset.telaCheia).toBe("sim");
  });

  it("barra de etapas com os dias em cada uma, e clicar move pelo caminho do quadro", async () => {
    const user = userEvent.setup();
    const { onMoverEtapa } = renderCartao();
    const barra = screen.getByTestId("barra-de-etapas");
    expect(within(barra).getByRole("button", { name: /Novo leads*· 1d/ })).toBeTruthy();
    expect(within(barra).getByRole("button", { name: /Visita agendadas*· 3d/ }).getAttribute("aria-current")).toBe("step");
    await user.click(within(barra).getByRole("button", { name: "Proposta" }));
    expect(onMoverEtapa).toHaveBeenCalledWith("S3");
  });

  it("Foco: lead esperando, proposta da IA que vira tarefa (dizendo para quem), tarefa atrasada", async () => {
    const user = userEvent.setup();
    renderCartao();
    const foco = screen.getByTestId("foco-do-negocio");
    expect(within(foco).getByText(/Lead esperando resposta há 12 min/)).toBeTruthy();
    expect(within(foco).getByText(/Ao aprovar, vira tarefa para você/)).toBeTruthy();
    expect(within(foco).getByText(/Ligar para confirmar a visita · atrasada desde/)).toBeTruthy();
    await user.click(within(foco).getByRole("button", { name: "Aprovar e criar tarefa" }));
    expect(decidir).toHaveBeenCalledWith({ leadId: "L1", decision: "approve", approvedSeq: 7 });
  });

  it("resumo da IA com objeções abertas e respondidas, e o aviso de compras leva ao histórico", () => {
    renderCartao();
    const resumo = screen.getByTestId("resumo-da-ia");
    expect(within(resumo).getByText("2 dormitórios com varanda")).toBeTruthy();
    expect(within(resumo).getByText("parcela da obra · aberta")).toBeTruthy();
    expect(within(resumo).getByText("distância do metrô · respondida")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Já comprou 2x · R\$ 587 mil/ })).toBeTruthy();
    const compras = screen.getByTestId("historico-de-compras");
    expect(within(compras).getByText("Cliente recorrente")).toBeTruthy();
    expect(within(compras).getByText("estimativa")).toBeTruthy();
  });

  it("pessoas com papel, outros negócios, e a origem com a conversão enviada", () => {
    renderCartao();
    const pessoas = screen.getByTestId("pessoas-do-negocio");
    expect(within(pessoas).getByText("Diego Costa")).toBeTruthy();
    expect(within(pessoas).getByText("Decisor")).toBeTruthy();
    expect(within(pessoas).getByText(/Studio Vista Parque/)).toBeTruthy();
    const origem = screen.getByTestId("origem-do-negocio");
    expect(within(origem).getByText("“Oi! Vi o vídeo”", { exact: false })).toBeTruthy();
    expect(within(origem).getByText(/Lead qualificado · Meta · enviada/)).toBeTruthy();
  });

  it("o campo que a IA preencheu aparece 'veio da conversa' e Confirmar chama a rota", () => {
    renderCartao();
    const campos = screen.getByTestId("campos-do-segmento");
    expect(within(campos).getByText("veio da conversa")).toBeTruthy();
    fireEvent.click(within(campos).getByRole("button", { name: "Confirmar" }));
    expect(confirmar).toHaveBeenCalledWith("empreendimento");
  });

  it("histórico: nota fixada no topo e as decisões de não enviar agrupadas; filtros trocam", async () => {
    const user = userEvent.setup();
    renderCartao();
    const h = screen.getByTestId("historico-do-negocio");
    const linhas = within(h).getAllByRole("listitem");
    expect(linhas[0]?.textContent).toContain("Diego só pode aos sábados");
    expect(within(h).getByText(/A IA fez 2 ações · 2 decisões de não enviar/)).toBeTruthy();
    await user.click(within(h).getByRole("button", { name: /^Tudo/ }));
    expect(within(h).queryByText(/A IA fez/)).toBeNull();
  });

  it("a seção Documentos e obrigações está no cartão aberto, e as propostas do agente ficam com o Foco", () => {
    renderCartao();
    expect(screen.getByTestId("documentos-e-obrigacoes")).toBeTruthy();
    expect(readFileSync("components/cartoes/aberto/CartaoAberto.tsx", "utf8")).toContain(
      '<SecaoDeObrigacoes escopo={{ tipo: "negocio", id: lead.id }} mostrarPropostas={false}',
    );
    expect(readFileSync("components/cartoes/aberto/Foco.tsx", "utf8")).toContain("<ObrigacoesNoFoco ");
  });
});

describe("convivência com o dossiê do upstream", () => {
  it("toda peça que o dossiê importa de components/kanban o cartão aberto também usa", () => {
    const dossie = readFileSync("components/kanban/LeadDossier.tsx", "utf8");
    const cartao = ["CartaoAberto.tsx", "Blocos.tsx", "Foco.tsx", "HistoricoDoNegocio.tsx"]
      .map((f) => readFileSync(`components/cartoes/aberto/${f}`, "utf8"))
      .join("\n");
    const pecas = [...dossie.matchAll(/import \{ ([A-Za-z, ]+) \} from "\.\/([A-Za-z]+)"/g)].flatMap((m) =>
      m[1]!.split(",").map((s) => s.trim()),
    );
    // A linha do tempo do upstream é substituída pelo histórico com filtros, que
    // reusa o hook vivo (useLeadTimeline) e o vocabulário dela.
    const substituidas = new Set(["LeadTimeline"]);
    const faltando = pecas.filter((p) => !substituidas.has(p) && !cartao.includes(p));
    expect(faltando, "peça do dossiê do upstream que sumiu do cartão aberto").toEqual([]);
    expect(pecas.length).toBeGreaterThan(4);
    expect(cartao).toContain("useLeadTimeline");
  });

  it("o quadro abre o cartão aberto no lugar do dossiê", () => {
    const quadro = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    expect(quadro).toMatch(/<CartaoAberto\b/);
    expect(quadro).not.toMatch(/<LeadDossier\b/);
  });
});

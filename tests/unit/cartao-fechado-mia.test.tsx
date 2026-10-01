import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * FORK MIA — o cartão fechado do funil responde "o que faço agora" sem abrir.
 *
 * Vigia, pela tela (DOM), cada linha que o protótipo aprovado pelo Gabriel pôs
 * no cartão: canal e campanha, empresa ou pessoa, próximo compromisso EXPLÍCITO
 * (cortado, inteiro no título), "Fechamento previsto" numa linha própria, selo
 * "recorrente", objeção aberta, tarefa atrasada, e a bola na linha da conversa.
 * E o contrato de altura do upstream: as linhas novas existem com e sem dado.
 */
vi.mock("@hello-pangea/dnd", () => ({
  Draggable: ({ children }: { children: (p: unknown, s: unknown) => ReactNode }) =>
    children({ innerRef: () => undefined, draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
}));
vi.mock("@/components/kanban/KanbanCardActions", () => ({ KanbanCardActions: () => null }));
vi.mock("@/hooks/kanban/useNextAction", () => ({
  useDecidirProximaAcao: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { KanbanCard } from "@/components/kanban/KanbanCard";
import { ProvedorDoCartao } from "@/components/cartoes/ContextoDoCartao";
import { FiltrosDoCartao } from "@/components/cartoes/FiltrosDoCartao";
import { buildCardInput } from "@/lib/kanban/card-state";
import type { Lead } from "@/lib/types/leads";
import type { SinaisDoCartao } from "@/lib/cartoes/tipos";

const EM_UM_ANO = new Date(Date.now() + 365 * 86_400_000);

function sinais(over: Partial<SinaisDoCartao> = {}): SinaisDoCartao {
  return {
    canal: { sigla: "META", campanha: "Jardim das Flores · vídeo tour" },
    bola: null,
    compromisso: null,
    objecao: null,
    tarefasAtrasadas: 0,
    temTarefaFutura: false,
    compras: null,
    pessoa: null,
    contatoNome: "Mariana Costa",
    chanceDaEtapa: 40,
    ...over,
  };
}

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "L1",
    organization_id: "o",
    pipeline_id: "p",
    stage_id: "s",
    contact_id: "c",
    title: "Apto 2 dorm",
    description: null,
    status: "open",
    lost_reason: null,
    position_in_stage: 1,
    value_cents: 48_500_000,
    currency: "BRL",
    owner_user_id: null,
    owner_kind: null,
    owner_agent_id: null,
    assigned_at: null,
    last_activity_at: null,
    stage_changed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    expected_close_date: `${EM_UM_ANO.getFullYear()}-10-31`,
    closed_at: null,
    source: "whatsapp",
    source_metadata: {},
    external_id: null,
    custom_fields: {},
    tags: [],
    created_at: "2026-09-26T12:00:00Z",
    updated_at: "2026-09-26T12:00:00Z",
    created_by_user_id: null,
    cartao: sinais(),
    ...over,
  };
}

function renderCard(l: Lead, usuarioAtualId: string | null = null) {
  return render(
    <ProvedorDoCartao usuarioAtualId={usuarioAtualId} nomes={new Map([["u-ju", "Juliana Prado"]])}>
      <KanbanCard
        card={buildCardInput(l, { stageName: "Visita agendada", ownerNames: undefined })}
        lead={l}
        index={0}
        pipelineId="p"
      />
    </ProvedorDoCartao>,
  );
}

describe("o cartão fechado responde sem abrir", () => {
  it("pessoa quando não há empresa, e a sigla do canal com a campanha", () => {
    renderCard(lead());
    expect(screen.getByRole("button", { name: "Mariana C. · Apto 2 dorm" })).toBeTruthy();
    const origem = document.querySelector("[data-canal]") as HTMLElement;
    expect(origem.dataset.canal).toBe("META");
    expect(within(origem).getByText("META")).toBeTruthy();
    expect(within(origem).getByText("Jardim das Flores · vídeo tour")).toBeTruthy();
  });

  it("empresa quando existe, com a pessoa, o cargo e quantos outros contatos há", () => {
    renderCard(
      lead({
        empresa_id: "e",
        empresa_nome: "Clínica Vida Plena",
        title: "Sala comercial 42 m²",
        cartao: sinais({ pessoa: { nome: "Carla Mendes", cargo: "Sócia", papel: "decisor", outros: 2 } }),
      }),
    );
    expect(screen.getByRole("button", { name: "Clínica Vida Plena · Sala comercial 42 m²" })).toBeTruthy();
    expect(screen.getByText("Carla, sócia · decisor · +2 contatos")).toBeTruthy();
  });

  it("o próximo compromisso é explícito — o quê · onde · quando — e inteiro ao passar o mouse", () => {
    const inicio = new Date(Date.now() + 3 * 86_400_000);
    inicio.setHours(10, 0, 0, 0);
    renderCard(
      lead({
        cartao: sinais({
          compromisso: {
            id: "a",
            titulo: "Visita",
            tipo: "Visita ao decorado",
            localTipo: "in_person",
            localDetalhe: "Jardim das Flores",
            inicio: inicio.toISOString(),
            fim: new Date(inicio.getTime() + 3_600_000).toISOString(),
            fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
            situacao: "confirmed",
            leadIds: ["L1"],
          },
        }),
      }),
    );
    const linha = screen.getByText(/^Visita ao decorado · Jardim das Flores · /);
    expect(linha.closest("p")?.getAttribute("title")).toMatch(/^Próximo compromisso: Visita ao decorado · Jardim das Flores · .+ 10h$/);
    expect(linha.className).toContain("truncate");
  });

  it("sem compromisso, a linha EXISTE e diz isso (altura constante)", () => {
    renderCard(lead());
    expect(screen.getByText("sem compromisso marcado")).toBeTruthy();
  });

  it("'Fechamento previsto dd/mm · NN%' numa linha própria, com a chance da etapa quando a IA não calculou", () => {
    renderCard(lead());
    const linha = screen.getByText(/Fechamento previsto/).closest("p") as HTMLElement;
    expect(linha.textContent).toContain(`31/10${EM_UM_ANO.getFullYear() === new Date().getFullYear() ? "" : `/${EM_UM_ANO.getFullYear()}`}`);
    expect(linha.textContent).toContain("40%");
    expect(linha.getAttribute("title")).toContain("chance da etapa");
  });

  it("selo 'recorrente' com quantas vezes e quanto já comprou", () => {
    renderCard(lead({ cartao: sinais({ compras: { quantidade: 2, totalCents: 58_700_000, moeda: "BRL" } }) }));
    expect(screen.getByRole("img", { name: "Já comprou 2x · R$ 587 mil" })).toBeTruthy();
    expect(screen.getByText("recorrente")).toBeTruthy();
  });

  it("objeção aberta ao lado da faixa, e tarefa atrasada no rodapé", () => {
    renderCard(
      lead({
        score: { probability: 78, reason: "respondeu rápido", band: "quente", factors: [], at: null },
        cartao: sinais({ objecao: "parcela da obra", tarefasAtrasadas: 1 }),
      }),
    );
    expect(screen.getByText("· objeção: parcela da obra")).toBeTruthy();
    expect(screen.getByText("quente")).toBeTruthy();
    expect(screen.getByText("· 1 tarefa atrasada")).toBeTruthy();
  });

  it("a bola na linha da conversa: 'Lead há 12 min' em alerta e 'bola: nós'", () => {
    const bola = { com: "nos" as const, quem: "lead" as const, desde: new Date(Date.now() - 12 * 60_000).toISOString(), porUsuarioId: null };
    renderCard(
      lead({
        conversa: { id: "cv", preview: "e a parcela da obra fica em quanto?", last_message_at: bola.desde, unread: 2, bola },
        cartao: sinais({ bola }),
      }),
    );
    const prefixo = screen.getByText("Lead há 12 min:");
    expect(prefixo.className).toContain("text-warning-fg");
    expect(screen.getByText("bola: nós")).toBeTruthy();
  });

  it("'Você' quando a última mensagem foi de quem olha; o nome quando foi de outra pessoa", () => {
    const bola = { com: "cliente" as const, quem: "equipe" as const, desde: new Date(Date.now() - 4 * 86_400_000).toISOString(), porUsuarioId: "u-ju" };
    const l = lead({ conversa: { id: "cv", preview: "Segue a tabela", last_message_at: bola.desde, unread: 0, bola }, cartao: sinais({ bola }) });
    const { unmount } = renderCard(l, "u-ju");
    expect(screen.getByText("Você há 4 dias:")).toBeTruthy();
    expect(screen.getByText("bola: cliente")).toBeTruthy();
    unmount();
    renderCard(l, "u-outro");
    expect(screen.getByText("Juliana há 4 dias:")).toBeTruthy();
  });

  it("contrato de altura: as linhas novas estão lá com dado E sem dado", () => {
    const { container: cheio, unmount } = renderCard(
      lead({ cartao: sinais({ objecao: "x", compras: { quantidade: 1, totalCents: 1, moeda: "BRL" } }) }),
    );
    const alturasCheio = [...cheio.querySelectorAll("p.h-5, p.h-4")].length;
    unmount();
    const { container: vazio } = renderCard(lead({ expected_close_date: null, cartao: sinais({ canal: { sigla: "DIRETO", campanha: null } }) }));
    expect([...vazio.querySelectorAll("p.h-5, p.h-4")].length).toBe(alturasCheio);
  });

  it("sem os sinais (a leitura falhou), o cartão continua o de antes — com a linha da empresa", () => {
    renderCard(lead({ cartao: undefined, empresa_nome: "Padaria do Zé", empresa_id: "e" }));
    expect(screen.getByRole("button", { name: "Apto 2 dorm" })).toBeTruthy();
    expect(screen.getByText("Padaria do Zé")).toBeTruthy();
    expect(screen.queryByText("sem compromisso marcado")).toBeNull();
  });
});

describe("o aviso de documentos e obrigações no cartão fechado", () => {
  it("UM aviso curto no rodapé, o mais urgente: vencido em cor de erro, inteiro ao passar o mouse", () => {
    renderCard(lead({ cartao: sinais({ obrigacao: { tipo: "vencido", nome: "Alvará", categoria: "documento", dias: -3 } }) }));
    const aviso = document.querySelector("[data-aviso-de-obrigacao]") as HTMLElement;
    expect(aviso.dataset.avisoDeObrigacao).toBe("vencido");
    expect(aviso.textContent).toBe("Alvará venceu há 3 dias");
    expect(aviso.getAttribute("title")).toBe("Alvará venceu há 3 dias");
    expect(aviso.className).toContain("text-error-fg");
    expect(aviso.querySelector("span")?.className).toContain("truncate");
    expect(document.querySelectorAll("[data-aviso-de-obrigacao]")).toHaveLength(1);
  });

  it("vencendo e pedido sem resposta, cada um com a frase e a cor dele", () => {
    const { unmount } = renderCard(
      lead({ cartao: sinais({ obrigacao: { tipo: "vencendo", nome: "Relatório mensal", categoria: "atividade", dias: 4 } }) }),
    );
    const vencendo = document.querySelector("[data-aviso-de-obrigacao]") as HTMLElement;
    expect(vencendo.textContent).toBe("Relatório mensal em 4 dias");
    expect(vencendo.className).toContain("text-warning-fg");
    unmount();
    renderCard(lead({ cartao: sinais({ obrigacao: { tipo: "sem_resposta", nome: "Contrato social", categoria: "documento", dias: 6 } }) }));
    expect((document.querySelector("[data-aviso-de-obrigacao]") as HTMLElement).textContent).toBe(
      "Contrato social: pedido há 6 dias, sem resposta",
    );
  });

  it("com tudo em dia o cartão não mostra nada, e a altura é a mesma com e sem aviso", () => {
    const { container: sem, unmount } = renderCard(lead({ cartao: sinais({ obrigacao: null }) }));
    expect(document.querySelector("[data-aviso-de-obrigacao]")).toBeNull();
    const linhasSem = [...sem.querySelectorAll("p.h-5, p.h-4")].length;
    unmount();
    const { container: com } = renderCard(
      lead({ cartao: sinais({ obrigacao: { tipo: "vencido", nome: "Alvará", categoria: "documento", dias: -3 } }) }),
    );
    // O aviso mora DENTRO da linha do rodapé: nenhuma linha a mais.
    expect([...com.querySelectorAll("p.h-5, p.h-4")].length).toBe(linhasSem);
    expect(com.querySelector("[data-aviso-de-obrigacao]")?.closest("p, div, span")).toBeTruthy();
  });
});

describe("filtros de canal, faixa e ordem", () => {
  it("o canal oferece só os que estão no quadro e devolve a escolha", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FiltrosDoCartao
        filtros={{ canal: null, faixa: null, ordem: "urgencia" }}
        onChange={onChange}
        leads={[lead(), lead({ id: "L2", cartao: sinais({ canal: { sigla: "GOOGLE", campanha: null } }) })]}
      />,
    );
    await user.click(screen.getByTestId("filtro-canal"));
    expect(await screen.findByRole("menuitemradio", { name: "Anúncio Meta" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Google Ads" })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Site" })).toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: "Google Ads" }));
    expect(onChange).toHaveBeenCalledWith({ canal: "GOOGLE", faixa: null, ordem: "urgencia" });
  });

  it("a ordem explica a urgência e manda arrastar pelo Manual", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FiltrosDoCartao filtros={{ canal: null, faixa: null, ordem: "urgencia" }} onChange={onChange} leads={[]} />);
    expect(screen.getByTestId("filtro-ordem").textContent).toBe("Ordem: Urgência");
    await user.click(screen.getByTestId("filtro-ordem"));
    expect(await screen.findByText(/lead esperando resposta, tarefa atrasada/)).toBeTruthy();
    expect(screen.getByText("Para reordenar arrastando dentro da coluna, escolha Manual.")).toBeTruthy();
    await user.click(screen.getByRole("menuitemradio", { name: "Quentes primeiro" }));
    expect(onChange).toHaveBeenCalledWith({ canal: null, faixa: null, ordem: "quentes" });
  });
});

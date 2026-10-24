/**
 * FORK MIA (.85) — o horário da IA NA TELA: a grade da semana, o editor, os
 * selos e o encaixe no editor de gatilho do upstream.
 *
 * O que se prova: a ida e a volta da grade não acusam mudança (reabrir e
 * salvar não deixa o "Publicar" cinza); erro em vermelho trava o salvar (o
 * schema recusa a grade crua); "Dividir" gera as duas faixas da meia-noite;
 * os textos dos selos; o aviso da janela de resposta do número, com o botão só
 * para o administrador mexendo só na janela de resposta.
 *
 * Nenhum dado é de cliente real.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { lerHorarioDaIa, MENSAGEM_SEM_FAIXA, type HorarioDaIaGravado } from "@/lib/agent-engine/agent/horario-da-ia";
import {
  acrescentarFaixa,
  copiarSegundaParaASemana,
  dividirNaMeiaNoite,
  editarFaixa,
  gradeDoGravado,
  gradePadrao,
  gravadoDaGrade,
  semNenhumaFaixa,
  temFaixaComErro,
  trocarTipoDoDia,
} from "@/lib/ai/agents/grade-do-horario-da-ia";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { textoEstavel } from "@/lib/ai/agents/mesmo-rascunho";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const mutate = vi.fn();
const knobs = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/hooks/channels/usePacingKnobs", () => ({
  usePacingKnobs: () => ({ data: { items: knobs.items } }),
  useUpdatePacingKnobs: () => ({ mutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { HorarioDaIaEditor } = await import("@/app/app/ai/agents/[id]/_components/HorarioDaIaEditor");
const { TriggerEditor } = await import("@/app/app/ai/agents/[id]/_components/TriggerEditor");
const { seloDaConversa, seloDaLista } = await import("@/components/ai/SeloDoHorarioDaIa");

const FUSO = "America/Sao_Paulo";
const VITA: HorarioDaIaGravado = {
  fuso: FUSO,
  faixas: [
    { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "10:00" },
    { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
    { dias: [0], inicio: "00:00", fim: "24:00" },
  ],
};
const BASE_DA_VERSAO = {
  system_prompt: "Você é a assistente da Academia Alfa, em teste.",
  provider: "openai" as const,
  model: "gpt-test",
  credential_id: null,
  channel_session_id: null,
};
const gatilho = (horario: HorarioDaIaGravado | null) => ({
  events: ["message" as const],
  concurrency: "one_per_conversation" as const,
  filters: { ignore_groups: true, ignore_self: true, keyword_regex: null, business_hours: null, horario_da_ia: horario },
});
const salvaria = (horario: HorarioDaIaGravado | null) =>
  versionCreateSchema.safeParse({ ...BASE_DA_VERSAO, trigger_config: gatilho(horario) }).success;

describe("a grade da semana (pura)", () => {
  it("reabrir e salvar não muda nada: a volta da grade é a forma canônica gravada", () => {
    const grade = gradeDoGravado(VITA, FUSO);
    expect(grade.modo).toBe("horario");
    expect(grade.dias[0]).toEqual({ tipo: "dia_todo", faixas: [] });
    expect(grade.dias[6]).toEqual({ tipo: "inativa", faixas: [] });
    expect(textoEstavel(gravadoDaGrade(grade))).toBe(textoEstavel(VITA));
  });

  it("sem horário abre em 'a qualquer hora' e grava null", () => {
    const grade = gradeDoGravado(null, FUSO);
    expect(grade.modo).toBe("sempre");
    expect(gravadoDaGrade(grade)).toBeNull();
  });

  it("faixa em vermelho grava CRU, e o schema recusa: o salvar fica travado", () => {
    const torta = editarFaixa(gradePadrao(FUSO), 1, 0, "fim", "8h");
    expect(temFaixaComErro(torta)).toBe(true);
    expect(gravadoDaGrade(torta)?.faixas).toContainEqual({ dias: [1], inicio: "08:00", fim: "8h" });
    expect(salvaria(gravadoDaGrade(torta))).toBe(false);
    expect(salvaria(gravadoDaGrade(gradePadrao(FUSO)))).toBe(true);
  });

  it("todos os dias inativos: a tela avisa e o schema recusa com a mesma frase", () => {
    let grade = gradePadrao(FUSO);
    for (const d of [1, 2, 3, 4, 5]) grade = trocarTipoDoDia(grade, d, "inativa");
    expect(semNenhumaFaixa(grade)).toBe(true);
    const r = versionCreateSchema.safeParse({ ...BASE_DA_VERSAO, trigger_config: gatilho(gravadoDaGrade(grade)) });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(MENSAGEM_SEM_FAIXA);
  });

  it("Dividir: sexta 22:00 às 02:00 vira sexta até 24:00 e sábado de 00:00", () => {
    const comMadrugada = editarFaixa(editarFaixa(gradePadrao(FUSO), 5, 0, "inicio", "22:00"), 5, 0, "fim", "02:00");
    expect(temFaixaComErro(comMadrugada)).toBe(true);
    const dividida = dividirNaMeiaNoite(comMadrugada, 5, 0);
    expect(dividida.dias[5]!.faixas).toEqual([{ inicio: "22:00", fim: "24:00" }]);
    expect(dividida.dias[6]).toEqual({ tipo: "faixas", faixas: [{ inicio: "00:00", fim: "02:00" }] });
    expect(temFaixaComErro(dividida)).toBe(false);
    // E o motor lê sexta 23h e sábado 1h como o MESMO período ativo.
    const h = lerHorarioDaIa({ filters: { horario_da_ia: gravadoDaGrade(dividida) } })!;
    expect(h.grade[5]).toContainEqual([1320, 1440]);
    expect(h.grade[6]).toContainEqual([0, 120]);
  });

  it("Dividir no sábado passa a madrugada para o domingo, antes das faixas que ele já tem", () => {
    let grade = trocarTipoDoDia(gradePadrao(FUSO), 6, "faixas");
    grade = editarFaixa(editarFaixa(grade, 6, 0, "inicio", "23:00"), 6, 0, "fim", "01:00");
    grade = trocarTipoDoDia(grade, 0, "faixas");
    const dividida = dividirNaMeiaNoite(grade, 6, 0);
    expect(dividida.dias[0]!.faixas[0]).toEqual({ inicio: "00:00", fim: "01:00" });
  });

  it("até 6 faixas por dia; a segunda copia para terça a sexta", () => {
    let grade = gradePadrao(FUSO);
    for (let i = 0; i < 5; i += 1) grade = acrescentarFaixa(grade, 1)!;
    expect(grade.dias[1]!.faixas).toHaveLength(6);
    expect(acrescentarFaixa(grade, 1)).toBeNull();
    const copiada = copiarSegundaParaASemana(grade);
    for (const d of [2, 3, 4, 5]) expect(copiada.dias[d]).toEqual(grade.dias[1]);
    expect(copiada.dias[6]).toEqual(grade.dias[6]);
  });
});

describe("os textos dos selos", () => {
  const h = lerHorarioDaIa({ filters: { horario_da_ia: VITA } })!;
  const identidade = (texto: string) => texto;
  const sp = (data: string, hhmm: string) => new Date(`${data}T${hhmm}:00-03:00`);

  it("lista: ativa até a próxima troca; inativa com a volta de hoje ou de amanhã", () => {
    expect(seloDaLista(h, sp("2026-10-19", "09:00"), identidade)).toEqual({ ativa: true, texto: "Ativa até 10:00" });
    expect(seloDaLista(h, sp("2026-10-19", "11:00"), identidade)).toEqual({ ativa: false, texto: "Inativa · volta às 17:30" });
    expect(seloDaLista(h, sp("2026-10-19", "20:00"), identidade)).toEqual({ ativa: true, texto: "Ativa até amanhã às 10:00" });
  });

  it("lista: do sábado (inativo) a volta é amanhã, domingo, o dia todo", () => {
    expect(seloDaLista(h, sp("2026-10-24", "12:00"), identidade)).toEqual({ ativa: false, texto: "Inativa · volta amanhã às 00:00" });
    expect(seloDaLista(h, sp("2026-10-23", "12:00"), identidade).texto).toBe("Inativa · volta às 17:30");
  });

  it("conversa: inativa é da equipe; ativa responde até a troca", () => {
    expect(seloDaConversa(h, sp("2026-10-19", "11:00"), identidade)).toEqual({ ativa: false, texto: "IA inativa agora · conversa da equipe" });
    expect(seloDaConversa(h, sp("2026-10-19", "08:00"), identidade)).toEqual({ ativa: true, texto: "IA ativa · responde até 10:00" });
    // Sexta à noite: o sábado é inativo, então a troca é à meia-noite, amanhã.
    expect(seloDaConversa(h, sp("2026-10-23", "20:00"), identidade).texto).toBe("IA ativa · responde até amanhã às 00:00");
  });

  it("toda frase dos selos tem espanhol", () => {
    for (const chave of ["Ativa até", "Inativa · volta às", "Inativa · volta", "IA inativa agora · conversa da equipe", "IA ativa · responde até", "amanhã às", "na segunda às"]) {
      expect(DICIONARIO[chave]?.es, chave).toBeTruthy();
    }
  });
});

describe("o editor na tela", () => {
  beforeEach(() => {
    mutate.mockClear();
    knobs.items = [];
  });

  function renderizar(horario: HorarioDaIaGravado | null, extra: Record<string, unknown> = {}) {
    const onChange = vi.fn();
    render(
      <HorarioDaIaEditor
        value={gatilho(horario)}
        onChange={onChange}
        organizationTimezone={FUSO}
        {...extra}
      />,
    );
    return onChange;
  }

  it("'Ativa a qualquer hora' grava sem horário e zera o horário antigo", () => {
    const onChange = renderizar(VITA);
    fireEvent.click(screen.getByRole("button", { name: "Ativa a qualquer hora" }));
    const emitido = onChange.mock.calls.at(-1)![0];
    expect(emitido.filters.horario_da_ia).toBeNull();
    expect(emitido.filters.business_hours).toBeNull();
  });

  it("a faixa que passa da meia-noite aparece em vermelho com o Dividir, que grava as duas", () => {
    const onChange = renderizar({ fuso: FUSO, faixas: [{ dias: [5], inicio: "22:00", fim: "23:00" }] });
    const sexta = document.querySelector('[data-dia="5"]') as HTMLElement;
    fireEvent.change(within(sexta).getByLabelText("Sexta, faixa 1, termina"), { target: { value: "02:00" } });
    expect(within(sexta).getByText(/passa da meia-noite/)).toBeInTheDocument();
    fireEvent.click(within(sexta).getByRole("button", { name: /Dividir:/ }));
    const emitido = onChange.mock.calls.at(-1)![0];
    expect(emitido.filters.horario_da_ia).toEqual({
      fuso: FUSO,
      faixas: [
        { dias: [5], inicio: "22:00", fim: "24:00" },
        { dias: [6], inicio: "00:00", fim: "02:00" },
      ],
    });
  });

  it("o horário que cai fora da janela de resposta do número avisa; o administrador abre só a resposta 24h", () => {
    knobs.items = [
      {
        channel_session: { id: "numero-1", display_name: "Recepção", phone_number: null },
        effective: { respostaStartHour: 7, respostaEndHour: 22, allowSunday: true, timezone: FUSO },
      },
    ];
    renderizar(VITA, { channelSessionId: "numero-1", podeAbrirJanela: true });
    const aviso = screen.getByTestId("horario-fora-da-janela");
    expect(aviso).toHaveTextContent("Recepção");
    fireEvent.click(within(aviso).getByRole("button", { name: "Abrir as respostas 24h neste número" }));
    expect(mutate).toHaveBeenCalledWith(
      { channel_session_id: "numero-1", resposta_start_hour: 0, resposta_end_hour: 24 },
      expect.anything(),
    );
  });

  it("quem não é administrador vê o aviso sem o botão; com a resposta 24h o aviso some", () => {
    knobs.items = [
      {
        channel_session: { id: "numero-1", display_name: "Recepção", phone_number: null },
        effective: { respostaStartHour: 7, respostaEndHour: 22, allowSunday: true, timezone: FUSO },
      },
    ];
    const { unmount } = render(
      <HorarioDaIaEditor value={gatilho(VITA)} onChange={vi.fn()} organizationTimezone={FUSO} channelSessionId="numero-1" />,
    );
    expect(screen.queryByRole("button", { name: "Abrir as respostas 24h neste número" })).not.toBeInTheDocument();
    expect(screen.getByText("Um administrador pode abrir as respostas 24h neste número.")).toBeInTheDocument();
    unmount();

    knobs.items = [
      {
        channel_session: { id: "numero-1", display_name: "Recepção", phone_number: null },
        effective: { respostaStartHour: 0, respostaEndHour: 24, allowSunday: true, timezone: FUSO },
      },
    ];
    renderizar(VITA, { channelSessionId: "numero-1" });
    expect(screen.queryByTestId("horario-fora-da-janela")).not.toBeInTheDocument();
  });
});

describe("o selo no cabeçalho da conversa, montado", () => {
  it("lê o horário de quem responde a conversa e diz que a conversa é da equipe; sem o provedor do app, não aparece", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { apiClient } = await import("@/lib/api/client");
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { agente: { id: "a1", nome: "Assistente" }, horario: VITA } } as never);
    const { SeloDoHorarioNaConversa } = await import("@/components/ai/SeloDoHorarioDaIa");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T11:00:00-03:00"));
    try {
      const { unmount } = render(<SeloDoHorarioNaConversa conversationId="conversa-1" />);
      expect(screen.queryByTestId("selo-horario-da-ia-na-conversa")).not.toBeInTheDocument();
      unmount();

      render(
        <QueryClientProvider client={new QueryClient()}>
          <SeloDoHorarioNaConversa conversationId="conversa-1" />
        </QueryClientProvider>,
      );
      expect(await screen.findByTestId("selo-horario-da-ia-na-conversa")).toHaveTextContent("IA inativa agora · conversa da equipe");
      expect(get).toHaveBeenCalledWith("/api/v1/ai/horario-da-ia?conversa=conversa-1");
    } finally {
      vi.useRealTimers();
      get.mockRestore();
    }
  });
});

describe("o encaixe no editor de gatilho do upstream", () => {
  const SEM_HORARIO = {
    events: ["message" as const],
    filters: { ignore_groups: true, ignore_self: true, keyword_regex: null, business_hours: null },
    concurrency: "one_per_conversation" as const,
  };

  it("com o editor do fork, o 'Só atender em horário de funcionamento' sai da tela", () => {
    render(<TriggerEditor value={SEM_HORARIO} onChange={vi.fn()} horarioDaIa={<p>editor do fork</p>} />);
    expect(screen.getByText("editor do fork")).toBeInTheDocument();
    expect(screen.queryByLabelText("Só atender em horário de funcionamento")).not.toBeInTheDocument();
  });

  it("sem ele, o componente segue como o upstream o escreveu", () => {
    render(<TriggerEditor value={SEM_HORARIO} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Só atender em horário de funcionamento")).toBeInTheDocument();
  });

  it("o formulário do agente passa o editor do fork", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("app/app/ai/agents/[id]/_components/AgentForm.tsx", "utf8");
    expect(fonte).toMatch(/horarioDaIa=\{\s*<HorarioDaIaEditor/);
  });
});

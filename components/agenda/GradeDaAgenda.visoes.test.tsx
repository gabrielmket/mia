/**
 * AS VISÕES DA GRADE LEVAM UMA À OUTRA — e a semana começa na segunda.
 *
 * O que este arquivo prende, e por que cada parte é gesto e não enfeite:
 *
 *   1. No Mês, o chip ABRE o compromisso pelo mesmo `onAbrirAgendamento` do
 *      bloco da semana. Antes ele era um `<div>`: via-se o compromisso e não se
 *      chegava nele.
 *   2. No Mês, a ocupação de agenda conectada NÃO vira chip e NÃO conta no
 *      "+N": ela só bloqueia horário, e como chip disputava as três vagas da
 *      célula com os compromissos de verdade.
 *   3. O número do dia, o "+N" e o vazio da célula do Mês, e o cabeçalho de
 *      cada dia da Semana, abrem a visão Dia DAQUELE dia — com a data como
 *      chave (`yyyy-MM-dd`), que é o que atravessa fusos sem trocar de dia.
 *   4. A semana começa na segunda, e o que a grade DESENHA é exatamente o que
 *      `recorteDaGrade` BUSCA — na Semana e no Mês.
 *
 * O fuso é o do próprio ambiente (como em `GradeDaAgenda.mobile.test.tsx`) e os
 * compromissos nascem em hora local: aqui o assunto é o gesto e a semana, e a
 * prova de fuso de organização mora em
 * `tests/unit/grade-da-agenda-no-fuso-da-organizacao.test.tsx`.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { format } from "date-fns";
import { describe, expect, it, vi } from "vitest";

import { recorteDaGrade } from "@/lib/agenda/recorte-da-grade";

import { GradeDaAgenda } from "./GradeDaAgenda";
import type { Agendamento, Pessoa, VisaoDaAgenda } from "./tipos";

const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Quarta, 14/10/2026, ao meio-dia local — como `ancoraLocalDoDia` monta. */
const ANCORA = new Date(2026, 9, 14, 12);
/** "Hoje" é segunda, 12/10: fora do dia dos chips, para os dois não se confundirem. */
const AGORA = new Date(2026, 9, 12, 10);

const PESSOAS: Pessoa[] = [{ id: "ana", nome: "Ana Prado", trilha: 1 }];

function compromisso(
  id: string,
  hora: number,
  extra: Partial<Agendamento> = {},
  dia = 14,
): Agendamento {
  return {
    id,
    titulo: `Consulta ${id}`,
    responsavelId: "ana",
    comeca: new Date(2026, 9, dia, hora, 0).toISOString(),
    termina: new Date(2026, 9, dia, hora, 30).toISOString(),
    origem: "ui",
    situacao: "confirmed",
    ...extra,
  };
}

/** Cinco compromissos na quarta 14/10, fora de ordem, e uma ocupação do Google. */
const QUARTA_CHEIA: Agendamento[] = [
  compromisso("c5", 16),
  compromisso("c1", 8),
  compromisso("c3", 11),
  compromisso("c2", 9),
  compromisso("c4", 14),
  // A rota devolve a ocupação DEPOIS dos compromissos, e ela começa antes de
  // todos: se entrasse na lista do Mês, seria o primeiro chip.
  compromisso("ocupado", 7, { titulo: "Ocupado", origem: "google_sync" }),
];

function montar(
  visao: VisaoDaAgenda,
  props: {
    agendamentos?: Agendamento[];
    onAbrirAgendamento?: (id: string) => void;
    onAbrirDia?: (dia: string) => void;
  } = {},
) {
  return render(
    <GradeDaAgenda
      visao={visao}
      ancora={ANCORA}
      agora={AGORA}
      fuso={FUSO}
      pessoas={PESSOAS}
      agendamentos={props.agendamentos ?? QUARTA_CHEIA}
      onAbrirAgendamento={props.onAbrirAgendamento}
      onAbrirDia={props.onAbrirDia}
    />,
  );
}

describe("visão Mês", () => {
  it("mostra até três chips, na ordem do dia, e o resto vira +N", () => {
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia: vi.fn() });
    const celula = screen.getByTestId("celula-mes-2026-10-14");

    const chips = within(celula).getAllByTestId(/^chip-mes-/);
    expect(chips.map((c) => c.dataset.testid)).toEqual([
      "chip-mes-c1",
      "chip-mes-c2",
      "chip-mes-c3",
    ]);
    // Cinco compromissos, três à vista: +2. A ocupação não entra na conta —
    // com ela seriam seis, e o "+3" diria que o dia está mais cheio do que está.
    expect(within(celula).getByTestId("mais-do-dia-2026-10-14")).toHaveTextContent("+2");
  });

  it("a ocupação de agenda conectada não vira chip — nem quando o dia só tem ela", () => {
    montar("mes", {
      agendamentos: [compromisso("ocupado", 9, { titulo: "Ocupado", origem: "google_sync" })],
      onAbrirAgendamento: vi.fn(),
      onAbrirDia: vi.fn(),
    });
    expect(document.querySelectorAll('[data-testid^="chip-mes-"]')).toHaveLength(0);
    expect(screen.queryByTestId("mais-do-dia-2026-10-14")).toBeNull();
    // E o nome do dia não anuncia compromisso que não existe.
    expect(screen.getByTestId("abrir-dia-2026-10-14")).toHaveAccessibleName(
      "Abrir o dia quarta 14/10",
    );
  });

  it("o chip abre o compromisso pelo mesmo callback da semana", () => {
    const onAbrirAgendamento = vi.fn();
    const onAbrirDia = vi.fn();
    montar("mes", { onAbrirAgendamento, onAbrirDia });

    const chip = screen.getByTestId("chip-mes-c2");
    expect(chip.tagName).toBe("BUTTON");
    // O nome acessível é o mesmo do bloco da semana: título, horário, quem atende.
    expect(chip).toHaveAccessibleName(/^Consulta c2, 09:00 às 09:30, atendido por Ana Prado$/);

    fireEvent.click(chip);
    expect(onAbrirAgendamento).toHaveBeenCalledWith("c2");
    // Abrir o compromisso não é abrir o dia: o clique no chip não atravessa.
    expect(onAbrirDia).not.toHaveBeenCalled();
  });

  it("o número do dia abre o Dia, com a contagem no nome", () => {
    const onAbrirDia = vi.fn();
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia });

    const numero = screen.getByTestId("abrir-dia-2026-10-14");
    expect(numero).toHaveAccessibleName("Abrir o dia quarta 14/10, 5 compromissos");
    fireEvent.click(numero);
    expect(onAbrirDia).toHaveBeenCalledWith("2026-10-14");
  });

  it("o +N abre o Dia, dizendo quantos ficaram de fora", () => {
    const onAbrirDia = vi.fn();
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia });

    const mais = screen.getByTestId("mais-do-dia-2026-10-14");
    expect(mais.tagName).toBe("BUTTON");
    expect(mais).toHaveAccessibleName("Abrir o dia quarta 14/10, mais 2 compromissos");
    fireEvent.click(mais);
    expect(onAbrirDia).toHaveBeenCalledWith("2026-10-14");
  });

  it("o vazio da célula abre o Dia — também num dia sem nada, e num dia do mês vizinho", () => {
    const onAbrirDia = vi.fn();
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia });

    fireEvent.click(screen.getByTestId("fundo-dia-2026-10-20"));
    expect(onAbrirDia).toHaveBeenLastCalledWith("2026-10-20");

    // 01/11 é domingo e fecha a última linha de outubro: desenhado esmaecido,
    // mas é um dia como os outros para abrir.
    fireEvent.click(screen.getByTestId("fundo-dia-2026-11-01"));
    expect(onAbrirDia).toHaveBeenLastCalledWith("2026-11-01");

    // O fundo não é uma segunda parada de Tab nem um segundo nome para o
    // leitor de tela: o número do dia já é esse gesto, com nome.
    const fundo = screen.getByTestId("fundo-dia-2026-10-20");
    expect(fundo).toHaveAttribute("tabindex", "-1");
    expect(fundo).toHaveAttribute("aria-hidden", "true");
  });

  it("hoje continua destacado no número do dia", () => {
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia: vi.fn() });
    expect(screen.getByTestId("abrir-dia-2026-10-12").className).toContain("bg-accent");
    expect(screen.getByTestId("abrir-dia-2026-10-14").className).not.toContain("bg-accent");
  });

  it("no celular os chips dão lugar a pontos, com o mesmo limite de três", () => {
    // jsdom não faz layout: o teste prova a REGRA (quem carrega a classe que
    // some abaixo de `md`), como `GradeDaAgenda.mobile.test.tsx` faz na semana.
    montar("mes", { onAbrirAgendamento: vi.fn(), onAbrirDia: vi.fn() });
    const chip = screen.getByTestId("chip-mes-c1");
    expect(chip.parentElement?.className).toContain("max-md:hidden");

    const pontos = screen.getByTestId("pontos-mes-2026-10-14");
    expect(pontos.className).toContain("md:hidden");
    expect(pontos.children).toHaveLength(3);
  });

  it("sem os callbacks, nada vira botão — a grade não oferece gesto que ninguém atende", () => {
    montar("mes");
    expect(screen.getByTestId("chip-mes-c1").tagName).not.toBe("BUTTON");
    expect(screen.queryByTestId("abrir-dia-2026-10-14")).toBeNull();
    expect(screen.queryByTestId("fundo-dia-2026-10-14")).toBeNull();
    expect(screen.getByTestId("mais-do-dia-2026-10-14").tagName).not.toBe("BUTTON");
  });

  it("começa na segunda e desenha exatamente o recorte que a tela busca", () => {
    montar("mes");
    const celulas = screen
      .getAllByTestId(/^celula-mes-/)
      .map((c) => c.dataset.testid!.replace("celula-mes-", ""));
    const { de, ate } = recorteDaGrade("mes", ANCORA);

    expect(celulas).toHaveLength(42);
    expect(celulas[0]).toBe("2026-09-28"); // a segunda que abre a primeira linha
    expect(celulas[0]).toBe(format(de, "yyyy-MM-dd"));
    // O fim do recorte é exclusivo: a última célula é a véspera dele.
    expect(celulas.at(-1)).toBe(format(new Date(ate.getTime() - 1), "yyyy-MM-dd"));
  });
});

describe("visão Semana", () => {
  it("começa na segunda, termina no domingo, e bate com o recorte buscado", () => {
    montar("semana");
    const colunas = screen
      .getAllByTestId(/^coluna-dia-/)
      .map((c) => c.dataset.testid!.replace("coluna-dia-", ""));
    const { de, ate } = recorteDaGrade("semana", ANCORA);

    expect(colunas).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(colunas[0]).toBe(format(de, "yyyy-MM-dd"));
    expect(colunas.at(-1)).toBe(format(new Date(ate.getTime() - 1), "yyyy-MM-dd"));
  });

  it("o cabeçalho de cada dia abre o Dia daquele dia", () => {
    const onAbrirDia = vi.fn();
    montar("semana", { onAbrirAgendamento: vi.fn(), onAbrirDia });

    const cabecalho = screen.getByTestId("cabecalho-dia-2026-10-16");
    expect(cabecalho.tagName).toBe("BUTTON");
    expect(cabecalho).toHaveAccessibleName("Abrir o dia sexta 16/10");
    fireEvent.click(cabecalho);
    expect(onAbrirDia).toHaveBeenCalledWith("2026-10-16");

    // A contagem da quarta não inclui a ocupação do Google, como no Mês.
    expect(screen.getByTestId("cabecalho-dia-2026-10-14")).toHaveAccessibleName(
      "Abrir o dia quarta 14/10, 5 compromissos",
    );
  });

  it("no Dia o cabeçalho não é botão — já é o dia aberto", () => {
    montar("dia", { onAbrirAgendamento: vi.fn(), onAbrirDia: vi.fn() });
    expect(screen.getAllByTestId(/^coluna-dia-/)).toHaveLength(1);
    expect(screen.queryByTestId("cabecalho-dia-2026-10-14")).toBeNull();
  });
});

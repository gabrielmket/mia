import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import { ancoraDoPeriodoVizinho, recorteDaGrade } from "./recorte-da-grade";

/**
 * As datas do vermelho de 2026-09-24. Montadas em hora LOCAL (como a
 * `ancoraLocalDoDia` monta), para o teste valer em qualquer fuso de máquina.
 */
const dia = (a: number, m: number, d: number, h = 0) => new Date(a, m - 1, d, h);
const chave = (d: Date) => format(d, "yyyy-MM-dd");

describe("recorteDaGrade", () => {
  it("visão Mês busca os dias do mês vizinho que ela desenha (30/09 na grade de outubro)", () => {
    // Quinta 24/09 + 7 = âncora em 01/10; o compromisso é na quarta 30/09.
    const { de, ate } = recorteDaGrade("mes", dia(2026, 10, 1, 12));
    expect(de).toEqual(dia(2026, 9, 28)); // a segunda-feira da primeira linha
    expect(ate).toEqual(dia(2026, 11, 9)); // seis semanas depois, exclusivo
    const compromisso = dia(2026, 9, 30, 15);
    expect(compromisso >= de && compromisso < ate).toBe(true);
  });

  it("visão Mês de um mês que começa na segunda não traz linha do mês anterior", () => {
    // 01/06/2026 é segunda: a primeira linha já é do próprio mês.
    const { de, ate } = recorteDaGrade("mes", dia(2026, 6, 15, 12));
    expect(de).toEqual(dia(2026, 6, 1));
    expect(ate).toEqual(dia(2026, 7, 13));
  });

  it("visão Mês de um mês que começa no domingo abre na segunda ANTERIOR", () => {
    // 01/11/2026 é domingo. Com a semana na segunda, ele é o ÚLTIMO dia da
    // primeira linha — a linha começa em 26/10 e o dia 1º ainda aparece nela.
    const { de } = recorteDaGrade("mes", dia(2026, 11, 20, 12));
    expect(de).toEqual(dia(2026, 10, 26));
    const primeiroDoMes = dia(2026, 11, 1, 9);
    expect(primeiroDoMes >= de).toBe(true);
  });

  it("semana vai de segunda a segunda", () => {
    expect(recorteDaGrade("semana", dia(2026, 10, 1, 12))).toEqual({
      de: dia(2026, 9, 28),
      ate: dia(2026, 10, 5),
    });
  });

  it("o domingo é o FIM da semana dele, não o começo da seguinte", () => {
    // A borda que muda com a segunda-feira: o domingo 04/10 pertence à semana
    // que começou em 28/09. Com a conta crua do `getDay()` (domingo = 0), ele
    // abriria a semana seguinte e a grade pularia sete dias.
    expect(recorteDaGrade("semana", dia(2026, 10, 4, 12))).toEqual({
      de: dia(2026, 9, 28),
      ate: dia(2026, 10, 5),
    });
  });

  it("dia é o próprio dia", () => {
    expect(recorteDaGrade("dia", dia(2026, 10, 1, 12))).toEqual({
      de: dia(2026, 10, 1),
      ate: dia(2026, 10, 2),
    });
  });
});

describe("ancoraDoPeriodoVizinho", () => {
  it("no Dia, anda um dia de cada vez e mantém o meio-dia da âncora", () => {
    const ancora = dia(2026, 10, 14, 12);
    expect(ancoraDoPeriodoVizinho("dia", ancora, 1)).toEqual(dia(2026, 10, 15, 12));
    expect(ancoraDoPeriodoVizinho("dia", ancora, -1)).toEqual(dia(2026, 10, 13, 12));
  });

  it("na Semana, anda sete dias", () => {
    const ancora = dia(2026, 10, 14, 12);
    expect(ancoraDoPeriodoVizinho("semana", ancora, 1)).toEqual(dia(2026, 10, 21, 12));
    expect(ancoraDoPeriodoVizinho("semana", ancora, -1)).toEqual(dia(2026, 10, 7, 12));
  });

  it("no Mês, sai do mês mesmo com a âncora no dia 1º de um mês de 31 dias", () => {
    // Com o passo antigo de 30 dias, 01/10 + 30 = 31/10: o "próximo" ficava
    // em outubro e a tela não mudava.
    const ancora = dia(2026, 10, 1, 12);
    expect(format(ancoraDoPeriodoVizinho("mes", ancora, 1), "yyyy-MM")).toBe("2026-11");
  });

  it("no Mês, voltar de março passa por fevereiro", () => {
    // 01/03/2027 − 30 dias = 30/01/2027: fevereiro sumia do caminho.
    const ancora = dia(2027, 3, 1, 12);
    expect(format(ancoraDoPeriodoVizinho("mes", ancora, -1), "yyyy-MM")).toBe("2027-02");
  });

  it("no Mês, o dia que não existe no destino encosta no último do mês", () => {
    expect(chave(ancoraDoPeriodoVizinho("mes", dia(2027, 1, 31, 12), 1))).toBe("2027-02-28");
  });
});

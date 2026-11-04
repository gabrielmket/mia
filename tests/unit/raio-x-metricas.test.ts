/**
 * FORK MIA (.101) · AS MÉTRICAS DE TEMPO DO RAIO-X (lib/raio-x/metricas.ts e
 * horario.ts). As definições estão em docs/fork/raio-x-do-atendimento.md, seção 4;
 * cada `it` fixa uma delas. Fuso America/Sao_Paulo, dado fictício.
 */
import { describe, expect, it } from "vitest";

import { faixaDoMinuto, lojaAberta, mesAnterior, momentoLocal } from "@/lib/raio-x/horario";
import { agregarMetricas, medirConversa, notaDeRapidez, type MensagemParaMedir } from "@/lib/raio-x/metricas";
import type { HorarioComercial } from "@/lib/raio-x/regras";

/** Um instante no fuso de São Paulo (-03:00). */
const sp = (iso: string) => new Date(`${iso}-03:00`).getTime();
const cli = (iso: string): MensagemParaMedir => ({ daLoja: false, em: sp(iso) });
const loja = (iso: string): MensagemParaMedir => ({ daLoja: true, em: sp(iso) });

/** Segunda a sexta 08:00-18:00, sábado até 13:00. */
const HORARIO: HorarioComercial = { abre: 8 * 60, fecha: 18 * 60, sabadoAte: 13 * 60 };
const FIM = sp("2026-11-09T12:00:00");

describe("o relógio (fuso America/Sao_Paulo)", () => {
  it("02/11/2026 é segunda; 09:00 em São Paulo é 12:00 UTC", () => {
    const m = momentoLocal(new Date("2026-11-02T12:00:00Z"));
    expect(m).toEqual({ dia: 0, minutos: 9 * 60, data: "2026-11-02" });
  });

  it("as quatro faixas: 8h-12h, 12h-14h, 14h-18h e 18h-8h", () => {
    expect(faixaDoMinuto(8 * 60)).toBe("manha");
    expect(faixaDoMinuto(11 * 60 + 59)).toBe("manha");
    expect(faixaDoMinuto(12 * 60)).toBe("almoco");
    expect(faixaDoMinuto(14 * 60)).toBe("tarde");
    expect(faixaDoMinuto(18 * 60)).toBe("noite");
    expect(faixaDoMinuto(7 * 60 + 59)).toBe("noite");
  });

  it("02:00 de terça fica na TERÇA, faixa da noite (dia do calendário, escrito na doc)", () => {
    const m = momentoLocal(sp("2026-11-03T02:00:00"));
    expect(m.dia).toBe(1);
    expect(faixaDoMinuto(m.minutos)).toBe("noite");
  });

  it("loja aberta: semana 08-18, sábado até 13h, domingo fechada", () => {
    expect(lojaAberta(momentoLocal(sp("2026-11-02T09:00:00")), HORARIO)).toBe(true);
    expect(lojaAberta(momentoLocal(sp("2026-11-02T18:00:00")), HORARIO)).toBe(false);
    expect(lojaAberta(momentoLocal(sp("2026-11-07T12:30:00")), HORARIO)).toBe(true);
    expect(lojaAberta(momentoLocal(sp("2026-11-07T13:30:00")), HORARIO)).toBe(false);
    expect(lojaAberta(momentoLocal(sp("2026-11-08T10:00:00")), HORARIO)).toBe(false);
    expect(lojaAberta(momentoLocal(sp("2026-11-07T10:00:00")), { ...HORARIO, sabadoAte: null })).toBe(false);
  });

  it("o mês anterior, no fuso: 01/11 00:30 → outubro inteiro", () => {
    const p = mesAnterior(new Date(sp("2026-11-01T00:30:00")));
    expect(p.competencia).toBe("2026-10-01");
    expect(p.inicio.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(p.fim.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});

describe("primeira resposta e episódio", () => {
  it("o tempo conta da PRIMEIRA mensagem do cliente até a primeira da loja", () => {
    const m = medirConversa([cli("2026-11-02T09:00:00"), cli("2026-11-02T09:03:00"), loja("2026-11-02T09:12:00")], HORARIO, FIM);
    expect(m.episodios).toHaveLength(1);
    expect(m.episodios[0]).toMatchObject({ dia: 0, faixa: "manha", aberta: true, desfecho: "respondido" });
    expect(m.medianaPrimeiraRespostaMin).toBe(12);
  });

  it("sexta 21:14 respondida sábado 10:02 é relógio de parede: 12h48, loja fechada", () => {
    const m = medirConversa([cli("2026-11-06T21:14:00"), loja("2026-11-07T10:02:00")], HORARIO, FIM);
    expect(m.episodios[0]).toMatchObject({ dia: 4, faixa: "noite", aberta: false });
    expect(m.medianaPrimeiraRespostaMin).toBe(12 * 60 + 48);
  });

  it("24 horas de silêncio abrem episódio novo; o segundo, sem resposta", () => {
    const m = medirConversa(
      [cli("2026-11-02T09:00:00"), loja("2026-11-02T09:05:00"), cli("2026-11-04T10:00:00")],
      HORARIO,
      FIM,
    );
    expect(m.episodios.map((e) => e.desfecho)).toEqual(["respondido", "sem_resposta"]);
    expect(m.semResposta).toBe(true);
  });

  it("menos de 24 horas sem resposta no fim do período é 'em aberto', fora das duas contas", () => {
    const m = medirConversa([cli("2026-11-09T02:00:00")], HORARIO, FIM);
    expect(m.episodios[0]!.desfecho).toBe("em_aberto");
    const a = agregarMetricas([m]);
    expect(a.semResposta).toBe(0);
    expect(a.emAberto).toBe(1);
    expect(a.proporcaoSemResposta).toBeNull();
  });

  it("trecho que a LOJA abriu (campanha) não é episódio", () => {
    const m = medirConversa([loja("2026-11-02T10:00:00"), cli("2026-11-02T10:30:00")], HORARIO, FIM);
    expect(m.episodios).toHaveLength(0);
    expect(m.trechosDaLoja).toBe(1);
    expect(m.doCliente).toBe(true);
  });
});

describe("sumiu e a loja não voltou a chamar", () => {
  it("a última palavra é da loja e o cliente não volta em 48 h: sumiu, sem retorno", () => {
    const m = medirConversa([cli("2026-11-02T09:00:00"), loja("2026-11-02T09:05:00")], HORARIO, FIM);
    expect([m.sumicos, m.sumicosComRetorno]).toEqual([1, 0]);
  });

  it("a loja mandou outra mensagem 12 h ou mais depois: sumiu, COM retorno", () => {
    const m = medirConversa(
      [cli("2026-11-02T09:00:00"), loja("2026-11-02T09:05:00"), loja("2026-11-03T10:00:00")],
      HORARIO,
      FIM,
    );
    expect([m.sumicos, m.sumicosComRetorno]).toEqual([1, 1]);
  });

  it("insistir na mesma hora não é voltar a chamar", () => {
    const m = medirConversa(
      [cli("2026-11-02T09:00:00"), loja("2026-11-02T09:05:00"), loja("2026-11-02T09:06:00")],
      HORARIO,
      FIM,
    );
    expect([m.sumicos, m.sumicosComRetorno]).toEqual([1, 0]);
  });

  it("o cliente respondeu dentro de 48 h: não sumiu", () => {
    const m = medirConversa(
      [cli("2026-11-02T09:00:00"), loja("2026-11-02T09:05:00"), cli("2026-11-03T20:00:00"), loja("2026-11-03T20:01:00")],
      HORARIO,
      sp("2026-11-04T12:00:00"),
    );
    expect(m.sumicos).toBe(0);
  });
});

describe("o agregado e o mapa 7 × 4", () => {
  const conversas = [
    medirConversa([cli("2026-11-02T09:00:00"), loja("2026-11-02T09:10:00"), cli("2026-11-02T09:11:00")], HORARIO, FIM),
    medirConversa([cli("2026-11-02T10:00:00"), loja("2026-11-02T10:30:00"), cli("2026-11-02T10:31:00")], HORARIO, FIM),
    medirConversa([cli("2026-11-06T21:00:00"), loja("2026-11-07T09:00:00"), cli("2026-11-07T09:01:00")], HORARIO, FIM),
    medirConversa([cli("2026-11-04T15:00:00")], HORARIO, FIM),
  ];
  const a = agregarMetricas(conversas);

  it("conta conversas de cliente, episódios, respondidos e sem resposta", () => {
    expect([a.conversasDeCliente, a.episodios, a.respondidos, a.semResposta, a.emAberto]).toEqual([4, 4, 3, 1, 0]);
    expect(a.proporcaoSemResposta).toBe(0.25);
  });

  it("mediana geral, com a loja aberta e com a loja fechada", () => {
    expect(a.medianaPrimeiraRespostaMin).toBe(30);
    expect(a.medianaComALojaAbertaMin).toBe(20);
    expect(a.medianaComALojaFechadaMin).toBe(12 * 60);
    expect(a.episodiosComALojaFechada).toBe(1);
  });

  it("o mapa: segunda de manhã tem 2 episódios e mediana de 20 min; o pico é ela", () => {
    expect(a.mapa).toHaveLength(7);
    expect(a.mapa[0]![0]).toEqual({ episodios: 2, medianaMin: 20 });
    expect(a.mapa[4]![3]).toEqual({ episodios: 1, medianaMin: 720 });
    expect(a.mapa[2]![2]).toEqual({ episodios: 1, medianaMin: null });
    expect(a.pico).toMatchObject({ dia: 0, faixa: "manha", episodios: 2 });
  });
});

describe("a nota de rapidez sai do relógio", () => {
  it("régua", () => {
    expect(notaDeRapidez(4, false)).toBe(10);
    expect(notaDeRapidez(12, false)).toBe(9);
    expect(notaDeRapidez(38, false)).toBe(6);
    expect(notaDeRapidez(200, false)).toBe(2);
    expect(notaDeRapidez(2000, false)).toBe(1);
    expect(notaDeRapidez(null, true)).toBe(0);
  });
});

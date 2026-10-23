/**
 * FORK MIA (.85) — o horário de atendimento da IA, o módulo puro.
 *
 * O que se prova aqui: 24:00 como fim do dia, a união das faixas que se cruzam,
 * o fuso do horário (e não o do servidor), a próxima troca virando a semana, e
 * a FALHA ABERTA (configuração torta é "sem horário", a IA responde).
 *
 * O caso de referência é o de uma clínica fictícia (Vita Odonto): a recepção
 * atende de dia e a IA cobre o resto. Seg a sex, a IA fica ativa até 10:00 e de
 * novo a partir de 17:30; sábado até 10:00 e a partir de 16:00; domingo o dia
 * todo.
 */
import { describe, expect, it } from "vitest";

import {
  analisarDia,
  ativaEm,
  faixasDaGrade,
  gradeDasFaixas,
  horarioForaDaJanelaDeResposta,
  horarioGravadoDe,
  lerHorarioDaIa,
  MENSAGEM_SEM_FAIXA,
  minutosAtivosNaSemana,
  minutosDaHora,
  normalizarHorario,
  problemasDoHorario,
  proximaAbertura,
  proximaTroca,
  temHorarioDaIaDeclarado,
  textoDaTroca,
  type HorarioDaIa,
  type HorarioDaIaGravado,
} from "@/lib/agent-engine/agent/horario-da-ia";

const VITA: HorarioDaIaGravado = {
  fuso: "America/Sao_Paulo",
  faixas: [
    { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "10:00" },
    { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
    { dias: [6], inicio: "00:00", fim: "10:00" },
    { dias: [6], inicio: "16:00", fim: "24:00" },
    { dias: [0], inicio: "00:00", fim: "24:00" },
  ],
};

const gatilho = (horario: unknown) => ({ events: ["message"], filters: { horario_da_ia: horario } });
const lido = (): HorarioDaIa => {
  const h = lerHorarioDaIa(gatilho(VITA));
  if (h === null) throw new Error("o horário de referência deveria ser lido");
  return h;
};

/** 2026-10-19 é segunda-feira; o fuso de São Paulo é UTC-3. */
const sp = (data: string, hhmm: string) => new Date(`${data}T${hhmm}:00-03:00`);
const SEGUNDA = "2026-10-19";
const SEXTA = "2026-10-23";
const SABADO = "2026-10-24";
const DOMINGO = "2026-10-25";

describe("as horas", () => {
  it("24:00 vale como FIM do dia e nunca como início", () => {
    expect(minutosDaHora("24:00", "fim")).toBe(1440);
    expect(minutosDaHora("24:00", "inicio")).toBeNull();
    expect(minutosDaHora("23:59", "inicio")).toBe(1439);
    expect(minutosDaHora("8:30", "inicio")).toBeNull();
    expect(minutosDaHora("24:30", "fim")).toBeNull();
    expect(minutosDaHora("12:60", "fim")).toBeNull();
  });

  it("o dia aponta a faixa que passa da meia-noite, a de começo igual ao fim e a torta", () => {
    const dia = analisarDia([
      { inicio: "22:00", fim: "02:00" },
      { inicio: "08:00", fim: "08:00" },
      { inicio: "oito", fim: "10:00" },
      { inicio: "10:00", fim: "24:00" },
    ]);
    expect(dia.problemas).toEqual([
      { tipo: "vira_a_meia_noite", faixa: 0, inicio: 1320, fim: 120 },
      { tipo: "igual", faixa: 1 },
      { tipo: "formato", faixa: 2 },
    ]);
    expect(dia.intervalos).toEqual([[600, 1440]]);
  });

  it("faixas que se cruzam viram uma só, e encostar não conta como cruzar", () => {
    const cruzam = analisarDia([
      { inicio: "11:00", fim: "14:00" },
      { inicio: "08:00", fim: "12:00" },
    ]);
    expect(cruzam.intervalos).toEqual([[480, 840]]);
    expect(cruzam.uniu).toBe(true);
    const encostam = analisarDia([
      { inicio: "08:00", fim: "12:00" },
      { inicio: "12:00", fim: "14:00" },
    ]);
    expect(encostam.intervalos).toEqual([[480, 840]]);
    expect(encostam.uniu).toBe(false);
  });
});

describe("a régua de gravação", () => {
  it("o horário de referência passa", () => {
    expect(problemasDoHorario(VITA)).toEqual([]);
  });

  it("recusa zero faixas, com a frase da tela e do MCP", () => {
    expect(problemasDoHorario({ fuso: "America/Sao_Paulo", faixas: [] })).toEqual([{ tipo: "sem_faixa" }]);
    expect(MENSAGEM_SEM_FAIXA).toContain("Sem nenhuma faixa a IA nunca responde. Para parar o agente, use Pausar");
  });

  it("recusa mais de 6 faixas num dia, fuso inválido, dia fora de 0 a 6 e a faixa que vira a meia-noite", () => {
    const sete = Array.from({ length: 7 }, (_, i) => ({ dias: [2], inicio: `0${i}:00`, fim: `0${i}:30` }));
    expect(problemasDoHorario({ fuso: "America/Sao_Paulo", faixas: sete })).toEqual([{ tipo: "mais_de_seis", dia: 2 }]);
    expect(problemasDoHorario({ ...VITA, fuso: "America/São_Paulo" })).toEqual([{ tipo: "fuso" }]);
    expect(problemasDoHorario({ fuso: "UTC", faixas: [{ dias: [7], inicio: "08:00", fim: "10:00" }] })).toEqual([
      { tipo: "dias", faixa: 0 },
    ]);
    expect(problemasDoHorario({ fuso: "UTC", faixas: [{ dias: [1], inicio: "22:00", fim: "02:00" }] })).toEqual([
      { tipo: "hora", faixa: 0, detalhe: "vira_a_meia_noite" },
    ]);
    expect(problemasDoHorario({ fuso: "UTC", faixas: [{ dias: [1], inicio: "24:00", fim: "24:00" }] })).toEqual([
      { tipo: "hora", faixa: 0, detalhe: "formato" },
    ]);
  });

  it("a forma canônica agrupa os dias com o mesmo intervalo e une o que se cruza", () => {
    const cru: HorarioDaIaGravado = {
      fuso: "America/Sao_Paulo",
      faixas: [
        { dias: [2], inicio: "08:00", fim: "12:00" },
        { dias: [1], inicio: "08:00", fim: "12:00" },
        { dias: [1], inicio: "11:00", fim: "13:00" },
        { dias: [0], inicio: "09:00", fim: "10:00" },
      ],
    };
    expect(normalizarHorario(cru).faixas).toEqual([
      { dias: [1], inicio: "08:00", fim: "13:00" },
      { dias: [2], inicio: "08:00", fim: "12:00" },
      { dias: [0], inicio: "09:00", fim: "10:00" },
    ]);
    // O sábado de manhã tem o mesmo intervalo da semana: entra na mesma faixa.
    expect(faixasDaGrade(gradeDasFaixas(VITA.faixas))).toEqual([
      { dias: [1, 2, 3, 4, 5, 6], inicio: "00:00", fim: "10:00" },
      { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
      { dias: [6], inicio: "16:00", fim: "24:00" },
      { dias: [0], inicio: "00:00", fim: "24:00" },
    ]);
  });

  it("o total da semana: 5 dias de 16h30, sábado 18h, domingo 24h", () => {
    expect(minutosAtivosNaSemana(lido().grade)).toBe((5 * 16.5 + 18 + 24) * 60);
  });
});

describe("a leitura do motor falha ABERTA", () => {
  it("sem o campo não há horário, e o business_hours do upstream não é nosso", () => {
    expect(lerHorarioDaIa({ filters: { business_hours: { timezone: "UTC", start: "08:00", end: "18:00", weekdays: [1] } } })).toBeNull();
    expect(lerHorarioDaIa(null)).toBeNull();
    expect(temHorarioDaIaDeclarado({ filters: { business_hours: {} } })).toBe(false);
    expect(temHorarioDaIaDeclarado(gatilho(VITA))).toBe(true);
  });

  it("configuração torta é SEM horário, mas continua declarada (o horário antigo não volta por baixo)", () => {
    const tortas: unknown[] = [
      { ...VITA, fuso: "Marte/Olympus" },
      { ...VITA, faixas: [] },
      { ...VITA, faixas: [{ dias: [1], inicio: "22:00", fim: "02:00" }] },
      { ...VITA, faixas: "todas" },
      "segunda a sexta",
    ];
    for (const torta of tortas) {
      expect(lerHorarioDaIa(gatilho(torta))).toBeNull();
    }
    expect(temHorarioDaIaDeclarado(gatilho({ ...VITA, faixas: [] }))).toBe(true);
    expect(horarioGravadoDe(gatilho({ ...VITA, faixas: [] }))).toBeNull();
  });

  it("fuso que o Intl recusa depois de lido vira ativa (nunca mordaça)", () => {
    const quebrado: HorarioDaIa = { fuso: "Marte/Olympus", grade: lido().grade };
    expect(ativaEm(quebrado, new Date())).toBe(true);
    expect(proximaAbertura(quebrado, new Date())).toBeNull();
    expect(proximaTroca(quebrado, new Date())).toBeNull();
  });
});

describe("ativa ou inativa, e quando troca", () => {
  it("segunda 09:59 ativa, 10:00 inativa (o fim é exclusivo), 17:30 ativa de novo", () => {
    const h = lido();
    expect(ativaEm(h, sp(SEGUNDA, "09:59"))).toBe(true);
    expect(ativaEm(h, sp(SEGUNDA, "10:00"))).toBe(false);
    expect(ativaEm(h, sp(SEGUNDA, "17:29"))).toBe(false);
    expect(ativaEm(h, sp(SEGUNDA, "17:30"))).toBe(true);
    expect(ativaEm(h, sp(SEGUNDA, "23:59"))).toBe(true);
  });

  it("o fuso do horário é o que vale, não o do servidor", () => {
    const h = lido();
    // 13:00 UTC de segunda = 10:00 em São Paulo: inativa.
    expect(ativaEm(h, new Date("2026-10-19T13:00:00Z"))).toBe(false);
    // 12:59 UTC = 09:59 em São Paulo: ativa.
    expect(ativaEm(h, new Date("2026-10-19T12:59:00Z"))).toBe(true);
    const manaus: HorarioDaIa = { ...h, fuso: "America/Manaus" };
    // 13:00 UTC = 09:00 em Manaus: ativa lá.
    expect(ativaEm(manaus, new Date("2026-10-19T13:00:00Z"))).toBe(true);
  });

  it("ativa às 09:50: troca hoje às 10:00", () => {
    const troca = proximaTroca(lido(), sp(SEGUNDA, "09:50"));
    expect(troca).toMatchObject({ ativaDepois: false, diasAdiante: 0, dia: 1, hora: "10:00" });
    expect(troca?.em.toISOString()).toBe(sp(SEGUNDA, "10:00").toISOString());
    expect(textoDaTroca(troca!)).toBe("hoje às 10:00");
  });

  it("de 17:30 de segunda a 10:00 de terça é UM período: a meia-noite não é troca", () => {
    const troca = proximaTroca(lido(), sp(SEGUNDA, "18:00"));
    expect(troca).toMatchObject({ ativaDepois: false, diasAdiante: 1, dia: 2, hora: "10:00" });
    expect(textoDaTroca(troca!)).toBe("amanhã às 10:00");
  });

  it("inativa às 11:00: volta hoje às 17:30, e a abertura é esse instante", () => {
    const h = lido();
    expect(proximaAbertura(h, sp(SEGUNDA, "11:00"))?.toISOString()).toBe(sp(SEGUNDA, "17:30").toISOString());
    expect(proximaAbertura(h, sp(SEGUNDA, "09:00"))).toBeNull();
  });

  it("a troca vira a semana: de sábado 16:00 ao domingo inteiro até segunda 10:00", () => {
    const troca = proximaTroca(lido(), sp(SABADO, "20:00"));
    expect(troca).toMatchObject({ ativaDepois: false, diasAdiante: 2, dia: 1, hora: "10:00" });
    expect(troca?.em.toISOString()).toBe(sp("2026-10-26", "10:00").toISOString());
    expect(textoDaTroca(troca!)).toBe("na segunda às 10:00");
    const deDomingo = proximaTroca(lido(), sp(DOMINGO, "12:00"));
    expect(deDomingo).toMatchObject({ diasAdiante: 1, dia: 1, hora: "10:00" });
  });

  it("a semana inteira pode virar: a única faixa é segunda de manhã, e de sexta ela volta na segunda", () => {
    const so: HorarioDaIa = { fuso: "America/Sao_Paulo", grade: gradeDasFaixas([{ dias: [1], inicio: "08:00", fim: "09:00" }]) };
    const troca = proximaTroca(so, sp(SEXTA, "12:00"));
    expect(troca).toMatchObject({ ativaDepois: true, diasAdiante: 3, dia: 1, hora: "08:00" });
    const daSegundaSeguinte = proximaTroca(so, sp(SEGUNDA, "09:30"));
    expect(daSegundaSeguinte).toMatchObject({ diasAdiante: 7, dia: 1, hora: "08:00" });
    expect(textoDaTroca({ diasAdiante: 3, dia: 6, hora: "08:00" })).toBe("no sábado às 08:00");
  });

  it("ativa a semana inteira não troca nunca", () => {
    const sempre: HorarioDaIa = {
      fuso: "America/Sao_Paulo",
      grade: gradeDasFaixas([{ dias: [0, 1, 2, 3, 4, 5, 6], inicio: "00:00", fim: "24:00" }]),
    };
    expect(proximaTroca(sempre, sp(SEGUNDA, "12:00"))).toBeNull();
    expect(ativaEm(sempre, sp(SEGUNDA, "12:00"))).toBe(true);
  });
});

describe("a janela de resposta do número", () => {
  const PADRAO = { inicioHora: 7, fimHora: 22, domingo: true, fuso: "America/Sao_Paulo" };

  it("a IA ativa de madrugada cai fora do 7h às 22h; aberta 0h às 24h, cabe", () => {
    expect(horarioForaDaJanelaDeResposta(lido(), PADRAO)).toBe(true);
    expect(horarioForaDaJanelaDeResposta(lido(), { ...PADRAO, inicioHora: 0, fimHora: 24 })).toBe(false);
  });

  it("horário dentro do 7h às 22h cabe; domingo desligado no número não cabe", () => {
    const comercial: HorarioDaIa = {
      fuso: "America/Sao_Paulo",
      grade: gradeDasFaixas([{ dias: [0, 1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" }]),
    };
    expect(horarioForaDaJanelaDeResposta(comercial, PADRAO)).toBe(false);
    expect(horarioForaDaJanelaDeResposta(comercial, { ...PADRAO, domingo: false })).toBe(true);
  });

  it("número em outro fuso: a comparação acontece no relógio do número", () => {
    // 08:00 a 18:00 em São Paulo é 07:00 a 17:00 em Manaus: cabe no 7h às 22h de lá.
    const comercial: HorarioDaIa = {
      fuso: "America/Sao_Paulo",
      grade: gradeDasFaixas([{ dias: [1], inicio: "08:00", fim: "18:00" }]),
    };
    expect(horarioForaDaJanelaDeResposta(comercial, { ...PADRAO, fuso: "America/Manaus" }, sp(SEGUNDA, "12:00"))).toBe(false);
    // 07:30 em São Paulo é 06:30 em Manaus: fora.
    const cedo: HorarioDaIa = {
      fuso: "America/Sao_Paulo",
      grade: gradeDasFaixas([{ dias: [1], inicio: "07:30", fim: "18:00" }]),
    };
    expect(horarioForaDaJanelaDeResposta(cedo, { ...PADRAO, fuso: "America/Manaus" }, sp(SEGUNDA, "12:00"))).toBe(true);
  });
});

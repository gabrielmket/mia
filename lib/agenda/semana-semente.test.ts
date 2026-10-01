/**
 * A borda que este teste prende é a que derrubou o CI quatro vezes em
 * 2026-09-20 — e ela vira uma linha porque o instante é parâmetro.
 */
import { describe, expect, it } from "vitest";

import { ancoraLocalDoDia, diaDeHojeNoFuso, semanaSemente } from "./semana-semente";
import { diaLocalISO } from "./fuso";

const SP = "America/Sao_Paulo";

describe("a semana que a agenda abre", () => {
  // A semana começa na SEGUNDA (`INICIO_DA_SEMANA`). A borda de fuso que
  // derrubou o CI em 2026-09-20 era a noite de sábado porque a semana começava
  // no domingo; com a segunda na frente, a mesma borda mora na noite de DOMINGO,
  // e os instantes abaixo andaram um dia para continuar medindo em cima dela.
  it("no domingo à noite em São Paulo, é a semana do DOMINGO — mesmo com UTC já na segunda", () => {
    // 2026-09-21T00:30Z: UTC já é SEGUNDA, São Paulo ainda é domingo, 21:30.
    // ⚠️ Na primeira versão deste caso (semana no domingo) o instante usado
    // de início foi o horário em que a RODADA foi criada; ali as duas réguas
    // concordavam e o controle abaixo pegou o engano: o caso teria passado
    // medindo nada.
    const { de } = semanaSemente(new Date("2026-09-21T00:30:00Z"), SP);
    expect(diaLocalISO(de, SP)).toBe("2026-09-14");
  });

  it("no fuso do SERVIDOR (UTC), o mesmo instante cai na semana seguinte — a divergência existe", () => {
    // O controle que dá sentido ao caso acima: sem ele, "2026-09-14" poderia
    // ser o resultado de qualquer fuso, e o teste não mediria o parâmetro.
    const { de } = semanaSemente(new Date("2026-09-21T00:30:00Z"), "UTC");
    expect(diaLocalISO(de, "UTC")).toBe("2026-09-21");
  });

  it("depois da meia-noite de São Paulo, as duas réguas voltam a concordar", () => {
    const instante = new Date("2026-09-21T03:30:00Z"); // 00:30 de segunda em SP
    expect(diaLocalISO(semanaSemente(instante, SP).de, SP)).toBe("2026-09-21");
    expect(diaLocalISO(semanaSemente(instante, "UTC").de, "UTC")).toBe("2026-09-21");
  });

  it("começa na segunda e termina na segunda seguinte, exclusivo", () => {
    const { de, ate } = semanaSemente(new Date("2026-09-16T15:00:00Z"), SP);
    expect(diaLocalISO(de, SP)).toBe("2026-09-14");
    expect(diaLocalISO(ate, SP)).toBe("2026-09-21");
    expect(de.getTime()).toBeLessThan(ate.getTime());
  });

  it("o domingo é o último dia da semana dele, não o primeiro da seguinte", () => {
    // `getUTCDay()` devolve 0 no domingo: a subtração crua de "dias desde a
    // segunda" daria −1 e mandaria o domingo para a semana SEGUINTE.
    const { de, ate } = semanaSemente(new Date("2026-09-20T15:00:00Z"), SP); // domingo 12:00 em SP
    expect(diaLocalISO(de, SP)).toBe("2026-09-14");
    expect(diaLocalISO(ate, SP)).toBe("2026-09-21");
  });

  it("a semana começa à MEIA-NOITE local, não à meia-noite de UTC", () => {
    // Sem isto, um `startOfWeek` em UTC passaria nos casos acima por acidente:
    // o dia bateria e a hora não, e o compromisso das 21h de domingo cairia fora
    // da janela que o servidor adianta.
    const { de } = semanaSemente(new Date("2026-09-16T15:00:00Z"), SP);
    expect(de.toISOString()).toBe("2026-09-14T03:00:00.000Z"); // 00:00 em SP (GMT-3)
  });

  it("atravessa a virada do horário de verão sem perder nem inventar hora", () => {
    // Sydney adianta o relógio às 2h de domingo 2026-10-04. Com a semana na
    // segunda, esse domingo é o ÚLTIMO dia da semana que começa em 28/09 — é ela
    // que tem 167 horas (28/09 00:00 AEST → 05/10 00:00 AEDT).
    // ⚠️ Com a semana no domingo, a primeira versão deste caso escolheu a semana
    // que TERMINAVA na virada e tinha 168 horas: o teste não teria exercitado a
    // borda. Aqui o instante é a quinta 01/10, dentro da semana que a contém.
    const fuso = "Australia/Sydney";
    const { de, ate } = semanaSemente(new Date("2026-10-01T02:00:00Z"), fuso);
    expect(diaLocalISO(de, fuso)).toBe("2026-09-28");
    expect(diaLocalISO(ate, fuso)).toBe("2026-10-05");
    const horas = (ate.getTime() - de.getTime()) / 3_600_000;
    expect(horas).toBe(167);
  });
});

describe("o dia de hoje no fuso da organização", () => {
  it("atravessa a fronteira como DATA, e a âncora local cai no mesmo dia", () => {
    // 2026-09-20T00:30Z: em São Paulo ainda é sábado 19.
    const instante = new Date("2026-09-20T00:30:00Z");
    expect(diaDeHojeNoFuso(instante, SP)).toBe("2026-09-19");
    expect(diaDeHojeNoFuso(instante, "UTC")).toBe("2026-09-20");

    const ancora = ancoraLocalDoDia("2026-09-19");
    expect(ancora.getFullYear()).toBe(2026);
    expect(ancora.getMonth()).toBe(8); // setembro
    expect(ancora.getDate()).toBe(19);
  });

  it("a âncora é ao MEIO-DIA — meia-noite ficaria a um passo de virar o dia", () => {
    // Com 00:00, uma diferença de uma hora (horário de verão, relógio do
    // sistema) muda a DATA. Ao meio-dia, não há borda a doze horas.
    expect(ancoraLocalDoDia("2026-09-19").getHours()).toBe(12);
  });
});

/**
 * FORK MIA (.101) · O RELÓGIO DO RAIO-X: dia da semana, faixa do mapa e "loja
 * aberta ou fechada", no fuso America/Sao_Paulo. PURO.
 *
 * O Brasil não tem horário de verão desde 2019, mas a conta não supõe isso: o
 * `Intl` resolve o fuso pela data, e um instante do passado com horário de
 * verão cai na hora certa.
 */
import type { HorarioComercial } from "./regras";

export const FUSO_DO_RAIO_X = "America/Sao_Paulo";

/** 0 = segunda ... 6 = domingo (a ordem das colunas do mapa). */
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * As quatro faixas do mapa (decisão aprovada): 8h-12h, 12h-14h, 14h-18h e
 * 18h-8h. A faixa da noite fica no dia do CALENDÁRIO da mensagem: 02:00 de
 * terça é "terça, 18h às 8h", e não "segunda à noite". Escrito na doc.
 */
export const FAIXAS = ["manha", "almoco", "tarde", "noite"] as const;
export type Faixa = (typeof FAIXAS)[number];

export interface MomentoLocal {
  dia: DiaDaSemana;
  /** Minutos desde a meia-noite, no fuso. */
  minutos: number;
  /** AAAA-MM-DD no fuso. */
  data: string;
}

const formatador = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DO_RAIO_X,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DIA: Record<string, DiaDaSemana> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function momentoLocal(instante: Date | number | string): MomentoLocal {
  const d = instante instanceof Date ? instante : new Date(instante);
  const partes = Object.fromEntries(formatador.formatToParts(d).map((p) => [p.type, p.value]));
  const hora = Number(partes.hour) % 24;
  return {
    dia: DIA[partes.weekday ?? "Mon"] ?? 0,
    minutos: hora * 60 + Number(partes.minute),
    data: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

export function faixaDoMinuto(minutos: number): Faixa {
  if (minutos >= 8 * 60 && minutos < 12 * 60) return "manha";
  if (minutos >= 12 * 60 && minutos < 14 * 60) return "almoco";
  if (minutos >= 14 * 60 && minutos < 18 * 60) return "tarde";
  return "noite";
}

/**
 * A loja estava aberta? Segunda a sexta de `abre` até `fecha`; sábado de `abre`
 * até `sabadoAte` (nulo = fechado); domingo fechado. Feriado não entra (a
 * conta não sabe o feriado da cidade da loja), e a doc diz isso.
 */
export function lojaAberta(momento: MomentoLocal, horario: HorarioComercial): boolean {
  if (momento.dia === 6) return false;
  if (momento.dia === 5) {
    if (horario.sabadoAte === null) return false;
    return momento.minutos >= horario.abre && momento.minutos < horario.sabadoAte;
  }
  return momento.minutos >= horario.abre && momento.minutos < horario.fecha;
}

/** O primeiro dia (00:00 no fuso) do mês de `instante`, como instante UTC. */
export function inicioDoMesLocal(instante: Date): Date {
  const m = momentoLocal(instante);
  const [ano, mes] = m.data.split("-").map(Number) as [number, number];
  return meiaNoiteLocal(ano, mes, 1);
}

/** 00:00 de um dia no fuso, como instante UTC (procura o deslocamento do dia). */
export function meiaNoiteLocal(ano: number, mes: number, dia: number): Date {
  // Começa supondo -03:00 e corrige pelo que o fuso diz daquele instante.
  let palpite = Date.UTC(ano, mes - 1, dia, 3, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const m = momentoLocal(palpite);
    const alvo = `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const ajusteDias = m.data === alvo ? 0 : m.data < alvo ? 1 : -1;
    const diff = ajusteDias * 24 * 60 - m.minutos;
    if (diff === 0) break;
    palpite += diff * 60_000;
  }
  return new Date(palpite);
}

/** O mês anterior ao de `instante`: [início, fim) no fuso, e a competência "AAAA-MM-01". */
export function mesAnterior(instante: Date): { inicio: Date; fim: Date; competencia: string } {
  const fim = inicioDoMesLocal(instante);
  const m = momentoLocal(new Date(fim.getTime() - 12 * 3_600_000));
  const [ano, mes] = m.data.split("-").map(Number) as [number, number];
  const inicio = meiaNoiteLocal(ano, mes, 1);
  return { inicio, fim, competencia: `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-01` };
}

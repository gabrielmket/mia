/**
 * FORK MIA (.89) — o relógio do disparo: "que dia e que hora são na empresa".
 *
 * A janela (das 8h às 19h), os dias úteis e o dia do aquecimento são do FUSO DA
 * EMPRESA (`organizations.timezone`), nunca do servidor: o servidor roda em UTC
 * e uma janela lida em UTC mandaria e-mail às 5h da manhã em São Paulo.
 */

export interface PartesNoFuso {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  /** 0 = domingo, 6 = sábado. */
  diaDaSemana: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function partesNoFuso(instante: Date, fuso: string): PartesNoFuso {
  const partes = Object.fromEntries(
    formatador(fuso)
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    segundo: Number(partes.second),
    diaDaSemana: DIAS[partes.weekday ?? "Sun"] ?? 0,
  };
}

/** Quantos minutos o fuso está à frente do UTC NESTE instante (horário de verão incluso). */
function deslocamentoEmMinutos(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - instante.getTime()) / 60_000);
}

/** O instante em que o relógio da empresa marca este dia e esta hora (fração = minutos). */
export function instanteNoFuso(
  ano: number,
  mes: number,
  dia: number,
  horaDecimal: number,
  fuso: string,
): Date {
  const horas = Math.floor(horaDecimal);
  const minutos = Math.round((horaDecimal - horas) * 60);
  const alvo = Date.UTC(ano, mes - 1, dia, horas, minutos);
  // Duas passadas: o deslocamento do palpite pode cair do outro lado de uma
  // troca de horário de verão.
  let t = alvo - deslocamentoEmMinutos(new Date(alvo), fuso) * 60_000;
  t = alvo - deslocamentoEmMinutos(new Date(t), fuso) * 60_000;
  return new Date(t);
}

/** `AAAA-MM-DD` do dia da empresa. */
export function diaNoFuso(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** O dia seguinte, no calendário (sem relógio). */
export function diaSeguinte(
  ano: number,
  mes: number,
  dia: number,
): { ano: number; mes: number; dia: number } {
  const d = new Date(Date.UTC(ano, mes - 1, dia + 1));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

export function ehFimDeSemana(diaDaSemana: number): boolean {
  return diaDaSemana === 0 || diaDaSemana === 6;
}

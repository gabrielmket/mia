/**
 * FORK MIA — OBRIGAÇÕES · as contas de DIA.
 *
 * As datas de uma obrigação são dias do calendário (`YYYY-MM-DD`), e não
 * instantes: validade de alvará é um dia, e o "hoje" que decide a situação é o
 * do fuso da empresa. Toda conta aqui é em UTC sobre o dia, para horário de
 * verão e fuso do servidor nunca moverem um vencimento.
 *
 * ⚠️ Módulo PURO: não importa nada. A tela (navegador), a rota, a varredura das
 * automações e as ferramentas do MCP leem as mesmas funções daqui.
 */

/** Um dia do calendário, `YYYY-MM-DD`. */
export type Dia = string;

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(dia: Dia): [number, number, number] | null {
  const m = FORMA.exec(dia);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const data = new Date(Date.UTC(ano, mes - 1, d));
  // `2026-02-30` vira 2 de março num `Date`: data "consertada" por engano é
  // pior que data recusada.
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== d) return null;
  return [ano, mes, d];
}

function montar(ano: number, mesIndice: number, dia: number): Dia {
  const data = new Date(Date.UTC(ano, mesIndice, dia));
  return data.toISOString().slice(0, 10);
}

/** `true` quando o texto é um dia que existe no calendário. */
export function diaValido(valor: unknown): valor is Dia {
  return typeof valor === "string" && partes(valor) !== null;
}

/** O dia, ou `null` para o que não é dia (vazio, formato errado, 30 de fevereiro). */
export function comoDia(valor: unknown): Dia | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim().slice(0, 10);
  return diaValido(texto) ? texto : null;
}

/** Quantos dias de `de` até `ate` (negativo quando `ate` já passou). */
export function diasEntre(de: Dia, ate: Dia): number {
  const a = partes(de);
  const b = partes(ate);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

export function somarDias(dia: Dia, n: number): Dia {
  const p = partes(dia);
  if (!p) return dia;
  return montar(p[0], p[1] - 1, p[2] + n);
}

/**
 * Soma meses SEM pular de mês: 31 de janeiro mais um mês é 28 (ou 29) de
 * fevereiro, e não 3 de março. É a conta de "vence todo dia 31".
 */
export function somarMeses(dia: Dia, n: number): Dia {
  const p = partes(dia);
  if (!p) return dia;
  const [ano, mes, d] = p;
  const primeiro = new Date(Date.UTC(ano, mes - 1 + n, 1));
  const ultimoDoMes = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0)).getUTCDate();
  return montar(primeiro.getUTCFullYear(), primeiro.getUTCMonth(), Math.min(d, ultimoDoMes));
}

/** `13/10/2026`. Português e espanhol escrevem a data na mesma ordem. */
export function diaPorExtenso(dia: Dia | null | undefined): string {
  if (!dia) return "";
  const p = partes(dia.slice(0, 10));
  if (!p) return "";
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(p[2])}/${dois(p[1])}/${p[0]}`;
}

/** `13/10`, para lista apertada. */
export function diaCurto(dia: Dia | null | undefined): string {
  return diaPorExtenso(dia).slice(0, 5);
}

/**
 * O dia do calendário NO FUSO informado.
 *
 * É o "hoje" da empresa: às 22h de São Paulo já é amanhã em UTC, e um
 * documento que vence hoje não pode aparecer vencido para quem ainda está no
 * dia do vencimento. Fuso inexistente cai no dia UTC, sem lançar: quem chama é
 * tela e varredura, e nenhuma das duas pode cair por causa de um campo digitado
 * errado.
 */
export function diaNoFuso(agora: Date, fuso: string | null | undefined): Dia {
  if (fuso) {
    try {
      const formatado = new Intl.DateTimeFormat("en-CA", {
        timeZone: fuso,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(agora);
      if (diaValido(formatado)) return formatado;
    } catch {
      // segue para o dia UTC
    }
  }
  return agora.toISOString().slice(0, 10);
}

/**
 * O DIA escolhido no campo "Quando" do saldo do provedor vira um INSTANTE no
 * fuso de quem digitou.
 *
 * `new Date("2026-11-17")` é meia-noite em UTC, que em Brasília ainda é 21h do
 * dia 16. Era o que a tela fazia: a leitura lançada para "hoje" aparecia com a
 * data de ontem, e a lançada para "amanhã" caía hoje, mas às 21h, no futuro, o
 * que zerava o "consumido desde então" até a hora chegar (Gabriel, 17/11/2026).
 *
 * Regras:
 *   • hoje → agora: a leitura acabou de ser feita, e qualquer outra hora conta
 *     consumo de menos ou de mais;
 *   • dia passado → meio-dia local, longe das duas viradas de dia em qualquer
 *     fuso do Brasil. Se o fato foi de tarde, o consumo entre meio-dia e a hora
 *     real entra como posterior, e o saldo sai um pouco MENOR, nunca maior: o
 *     erro fica do lado seguro para quem decide recarregar;
 *   • dia futuro → recusado: leitura e recarga são fatos que já aconteceram.
 */

export type MomentoDoLancamento =
  | { ok: true; occurred_at: string }
  | { ok: false; motivo: "futuro" | "invalido" };

/** Folga para relógio do navegador um pouco à frente do servidor. */
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;

/** "AAAA-MM-DD" do instante no fuso LOCAL (o mesmo do `<input type="date">`). */
export function diaLocal(instante: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${instante.getFullYear()}-${p(instante.getMonth() + 1)}-${p(instante.getDate())}`;
}

export function momentoDoLancamento(dia: string, agora: Date = new Date()): MomentoDoLancamento {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return { ok: false, motivo: "invalido" };
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const meioDia = new Date(ano, mes - 1, d, 12, 0, 0, 0);
  // 31/02 vira 03/03 no Date; aqui é data inválida, não outro dia.
  if (meioDia.getFullYear() !== ano || meioDia.getMonth() !== mes - 1 || meioDia.getDate() !== d) {
    return { ok: false, motivo: "invalido" };
  }
  const hoje = diaLocal(agora);
  if (dia === hoje) return { ok: true, occurred_at: agora.toISOString() };
  if (dia > hoje) return { ok: false, motivo: "futuro" };
  return { ok: true, occurred_at: meioDia.toISOString() };
}

/**
 * A mesma regra do lado do servidor, para quem chama a rota sem a tela: um
 * lançamento no futuro zera o "consumido desde então" até a hora chegar.
 */
export function instanteNaoEstaNoFuturo(iso: string, agora: Date = new Date()): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= agora.getTime() + FOLGA_DO_RELOGIO_MS;
}

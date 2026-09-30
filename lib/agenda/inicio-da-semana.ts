import { startOfWeek } from "date-fns";

/**
 * O DIA EM QUE A SEMANA DA AGENDA COMEÇA — segunda-feira, e num lugar só.
 *
 * ═══ Por que segunda ══════════════════════════════════════════════════════════
 *
 * A agenda é de quem atende, e quem atende organiza a semana pelos dias úteis.
 * Com o domingo na primeira coluna, a semana de trabalho aparecia partida: um
 * domingo quase sempre vazio abrindo a grade, o sábado sozinho na outra ponta, e
 * o fim de semana separado em duas bordas. Com a segunda na frente, os cinco
 * dias úteis ficam juntos e o fim de semana fecha a linha. É também a semana da
 * ISO 8601, a que o resto do mundo do trabalho já usa para contar semanas.
 *
 * ═══ Por que uma constante, e não um `weekStartsOn` em cada lugar ═════════════
 *
 * A MESMA semana é calculada em quatro lugares que precisam concordar:
 *
 *   - a grade que DESENHA (`components/agenda/GradeDaAgenda.tsx`);
 *   - o recorte que a tela BUSCA (`lib/agenda/recorte-da-grade.ts`);
 *   - a semana que o servidor ADIANTA na primeira pintura
 *     (`lib/agenda/semana-semente.ts`);
 *   - o mini-calendário do painel de marcação
 *     (`components/agenda/PainelDeMarcacao.tsx`).
 *
 * Com um literal em cada um, trocar três e esquecer o quarto faz a grade
 * desenhar um dia que a busca não trouxe — a célula aparece vazia com um
 * compromisso marcado nela. É o defeito que `recorte-da-grade.ts` já pagou uma
 * vez com o mês; aqui ele não tem por onde voltar.
 */
export const INICIO_DA_SEMANA = 1 as const;

/**
 * O primeiro dia da semana que contém `dia`, à meia-noite em hora local.
 *
 * Hora local de propósito: a grade recebe âncoras montadas por
 * `ancoraLocalDoDia` (o CALENDÁRIO da organização, ao meio-dia local) e lê as
 * chaves dos dias com `format` local. Quem precisa da semana num fuso que não é
 * o do processo é `semanaSemente`, que faz a mesma conta sobre as partes do dia
 * naquele fuso.
 */
export function inicioDaSemana(dia: Date): Date {
  return startOfWeek(dia, { weekStartsOn: INICIO_DA_SEMANA });
}

/**
 * Quantos dias `dia` está depois do início da semana — de 0 (segunda) a 6.
 *
 * Existe para quem conta a semana SEM `Date` local (a semente do servidor, que
 * trabalha em UTC sobre as partes do dia no fuso da organização): o
 * `getUTCDay()` devolve 0 no domingo, e a subtração crua levaria o domingo
 * para a semana seguinte.
 */
export function diasDesdeOInicioDaSemana(diaDaSemana: number): number {
  return (diaDaSemana - INICIO_DA_SEMANA + 7) % 7;
}

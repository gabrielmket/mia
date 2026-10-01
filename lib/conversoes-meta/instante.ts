/**
 * FORK MIA — "aconteceu antes?", com a precisão que o banco guarda.
 *
 * O Postgres guarda o instante com MICROSSEGUNDOS; `Date.parse` lê até o
 * milissegundo e joga o resto fora. A trava de retroatividade das conversões
 * ("ligar uma regra não envia o passado") compara o instante do movimento com o
 * instante em que a regra foi configurada, e os dois podem cair no MESMO
 * milissegundo: alguém desliga e religa a regra, e um negócio mudou de etapa
 * nesse meio. Comparando só até o milissegundo, o movimento deixava de ser
 * "anterior" e saía para a Meta. Foi medido no CI, numa máquina rápida.
 *
 * Aqui a comparação desempata pelos microssegundos escritos no próprio texto do
 * instante. Módulo puro: sem banco, sem relógio.
 */

/** Os microssegundos além do milissegundo (0 a 999), lidos do texto do instante. */
function alemDoMilissegundo(instante: string): number {
  const fracao = /\.(\d+)/.exec(instante)?.[1] ?? "";
  return Number(fracao.padEnd(6, "0").slice(3, 6)) || 0;
}

/**
 * `a` é estritamente anterior a `b`? Instantes iguais NÃO são anteriores.
 * Texto que não é data nunca é anterior a nada (a trava falha para o lado de
 * tratar como "não passado" só quando os dois são legíveis e iguais).
 */
export function aconteceuAntes(a: string, b: string): boolean {
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return false;
  if (ma !== mb) return ma < mb;
  return alemDoMilissegundo(a) < alemDoMilissegundo(b);
}

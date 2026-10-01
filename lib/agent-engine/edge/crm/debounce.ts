/**
 * Coalescência de rajada inbound — a janela que junta as mensagens de UM contato
 * em UM turno.
 *
 * Morava inline no `drain.ts`; saiu para cá com teste próprio (issue #1390)
 * porque o comportamento carrega duas leis que se cruzam — a janela de debounce
 * e a exclusão do job em HOLD — e as duas precisam de régua própria.
 *
 * Contrato:
 *   - mensagem que chega enquanto há job PENDING **do mesmo contato** com a
 *     janela ainda aberta (`run_after > now()`) viaja de carona nele: o turno lê
 *     o histórico completo e responde a todas as mensagens do lote — desde que o
 *     job seja da MESMA conversa e saia dentro do debounce (as cercas do fork,
 *     em `SQL_JOB_PARA_COALESCER`);
 *   - mensagem que chega fora da janela abre janela nova;
 *   - `debounceMs = 0` desliga a coalescência: job imediato, zero consulta.
 *
 * A janela é ANCORADA no primeiro job, não deslizante: mensagens que chegam
 * dentro dela não empurram o `run_after` para frente (nada aqui faz update de
 * `run_after`). Quem mede o pior caso com contato falante é
 * `debounce.medicao.test.ts`.
 */
import type pg from 'pg';

/**
 * Job pendente do contato cuja janela ainda não venceu — a carona desta
 * mensagem.
 *
 * ⚠️ `run_after > now()` sozinho casa com um job em HOLD (`enforceHolds`,
 * session-watchdog.ts), que usa `run_after = 'infinity'` como marcador, e
 * 'infinity' É maior que `now()`. Um job em hold por sessão MORTA (WhatsApp
 * reconectado, sessão antiga arquivada) nunca libera — a condição de liberação
 * exige a MESMA sessão antiga voltar a 'WORKING', o que não acontece nunca.
 * Sem esta exclusão, TODA mensagem nova do mesmo contato — inclusive na sessão
 * NOVA — coalescia nesse job morto para sempre: o cliente escrevia, o evento
 * saía "done" sem erro nenhum, e nenhum turno rodava. Medido em produção
 * (2026-09-14): 6 mensagens ao longo de 7h, zero resposta, zero job novo — só o
 * coalescing silencioso repetido no mesmo job com `held_run_after` no payload.
 *
 * ⚠️ DUAS CERCAS A MAIS (fork MIA, auditoria de 18/09), e nenhuma é zelo — cada
 * uma fecha um ralo medido. Prova: `tests/unit/coalescencia-nao-engole-turno-adiado.test.ts`.
 *
 * (a) HORIZONTE. A carona só é carona enquanto o job que a leva sai LOGO.
 *     `run_after > now()` não distingue um job adiado por 300 ms de debounce —
 *     o propósito desta peça — de um adiado por HORAS pela janela anti-ban
 *     (`inbound-turn.ts`, bloco "JANELA ANTI-BAN"), que adia com data real e
 *     por isso escapa da exclusão de hold. Com a janela fechada, TODA mensagem
 *     seguinte do contato virava `done` sem job novo. O teto é o próprio
 *     debounce, que é a janela que esta peça existe para cobrir.
 *
 * (b) MESMA CONVERSA. O turno responde na conversa PINADA no payload do job. O
 *     mesmo contato falando em dois canais (WhatsApp e Instagram são conversas
 *     diferentes) tinha a segunda mensagem pendurada num job que responde na
 *     PRIMEIRA — e a segunda conversa nunca recebia turno. Ali a mensagem não
 *     atrasava: sumia.
 *
 * As cercas moram NA consulta, não num filtro depois dela: com `limit 1`, um
 * filtro posterior recusaria o job errado sem enxergar o certo ao lado.
 */
const SQL_JOB_PARA_COALESCER = `select id from job_queue
 where organization_id = $1 and contact_id = $2
   and kind = 'inbound_turn' and status = 'pending' and run_after > now()
   and not (payload ? 'held_run_after')
   and run_after <= now() + make_interval(secs => $3 / 1000.0)
   and payload->>'conversation_id' = $4
 limit 1`;

/** O que fazer com a mensagem que acabou de chegar. */
export type DecisaoDeRajada =
  | { tipo: 'coalescido'; jobId: string }
  | { tipo: 'enfileirar'; runAfter: Date | undefined };

/**
 * Quem recebe a mensagem: o contato E a conversa em que ela chegou (a cerca
 * "mesma conversa" acima).
 */
export interface AlvoDaRajada {
  organizationId: string;
  contactId: string;
  conversationId: string;
}

/** Job pendente do contato que pode receber a mensagem de carona. */
export async function buscarJobParaCoalescer(
  pool: pg.Pool,
  alvo: AlvoDaRajada,
  debounceMs: number,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(SQL_JOB_PARA_COALESCER, [
    alvo.organizationId,
    alvo.contactId,
    debounceMs,
    alvo.conversationId,
  ]);
  return rows[0]?.id;
}

/**
 * Janela da rajada aberta por esta mensagem: `undefined` quando não há debounce
 * (o job nasce claimável agora).
 *
 * `agora` é injetável porque a janela é aritmética — o teste prende o número
 * sem depender do relógio.
 */
export function janelaDeRajada(debounceMs: number, agora: number = Date.now()): Date | undefined {
  return debounceMs > 0 ? new Date(agora + debounceMs) : undefined;
}

/**
 * Teto da janela de rajada configurável por agente (#1856): não deixar ninguém
 * travar o atendimento sem querer. Vale também como default de tela/UX.
 */
export const TETO_DEBOUNCE_MS = 60_000;

/**
 * Janela de rajada EFETIVA de um agente.
 *
 * `null`/`undefined` (campo vazio na versão) = o `INBOUND_DEBOUNCE_MS` da
 * instalação — regressão zero para quem nunca mexeu no campo. O valor
 * configurado é CLAMPADO em [0, TETO_DEBOUNCE_MS]: 0 desliga a coalescência e
 * valores acima do teto (dado sujo que entrou por fora da validação) caem para
 * 60s em vez de travar o atendimento.
 */
export function debounceEfetivo(
  configurado: number | null | undefined,
  padraoInstalacao: number,
): number {
  if (configurado === null || configurado === undefined) return padraoInstalacao;
  return Math.min(Math.max(0, configurado), TETO_DEBOUNCE_MS);
}

/** Decide entre carona em job existente e janela nova. */
export async function decidirRajada(
  pool: pg.Pool,
  alvo: AlvoDaRajada,
  debounceMs: number,
  agora: number = Date.now(),
): Promise<DecisaoDeRajada> {
  if (debounceMs > 0) {
    const jobId = await buscarJobParaCoalescer(pool, alvo, debounceMs);
    if (jobId !== undefined) return { tipo: 'coalescido', jobId };
  }
  return { tipo: 'enfileirar', runAfter: janelaDeRajada(debounceMs, agora) };
}

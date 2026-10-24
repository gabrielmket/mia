/**
 * FORK MIA (.85) — O QUE O TURNO FAZ QUANDO A IA ESTÁ INATIVA.
 *
 * A regra mora em `horario-da-ia.ts`; aqui moram as duas decisões do motor,
 * sem banco (as leituras e os efeitos chegam por PORTAS, para o teste provar a
 * decisão sem montar o turno inteiro). A fiação de produção está em
 * `horario-da-ia-no-motor.ts`.
 *
 * ## 1. A mensagem que chega com a IA inativa
 *
 * A IA não responde, nem depois: o turno termina SEM ENVIAR e SEM REAGENDAR,
 * e a conversa fica com a equipe. Não há aviso automático (inativa quer dizer
 * que quem atende é a equipe). Se o cliente escrever de novo com a IA ativa, o
 * turno daquela mensagem lê a conversa inteira e responde normalmente.
 *
 * A pergunta "estava ativa?" é feita no instante em que a mensagem CHEGOU
 * (`messages.created_at` da inbound fixada no job), e não no relógio do job:
 * a mensagem das 09:59 que o worker pega às 10:00:05 foi escrita com a IA
 * ativa e é respondida. Pelo mesmo motivo, a mensagem das 23h que a janela
 * anti-bloqueio do número segurou até as 7h continua sendo da IA às 7h. Sem
 * conseguir ler o instante, vale o relógio do job.
 *
 * O PEDIDO DE PARAR (LGPD) continua registrado com a IA inativa: a detecção é
 * a mesma do turno (`detectAmbiguousOptOut` sobre o que o cliente disse e não
 * foi respondido), e o registro é o mesmo mecanismo durável (silêncio
 * permanente, follow-ups cancelados, item na Central), só que SEM a mensagem de
 * confirmação que o turno ativo manda. O opt-out já gravado no contato
 * (`is_blocked`) cancela os follow-ups que nasceram depois.
 *
 * O pedido de falar com uma pessoa NÃO é registrado aqui: a conversa já é da
 * equipe. Se ninguém responder e o cliente escrever de novo com a IA ativa, o
 * turno daquela mensagem enxerga o pedido entre os não respondidos e passa a
 * conversa, como sempre.
 *
 * ## 2. O toque de follow-up que cai com a IA inativa
 *
 * Espera a próxima abertura: é REAGENDADO, não perdido. A decisão é a mesma
 * (`aberturaDoToque`), e quem reagenda é o caminho de cada toque (o turno do
 * worker, o atalho do texto fixo, o retorno prometido).
 */
import type { Logger } from "../obs/logger";
import { ativaEm, proximaAbertura, proximaTroca, textoDaTroca, type HorarioDaIa } from "./horario-da-ia";

export interface PortasDoTurnoInativo {
  /** O instante em que a mensagem fixada no job chegou; `null` = não deu para ler. */
  instanteDaMensagem: () => Promise<Date | null>;
  /** O que o cliente disse e ainda não teve resposta, e se o contato já está bloqueado. */
  lerPendentes: () => Promise<{ textos: string[]; bloqueado: boolean }>;
  /** A mesma detecção de opt-out provável do turno. */
  pedidoDeParar: (texto: string) => boolean;
  /** Silêncio durável, follow-ups cancelados e item na Central, SEM mensagem ao cliente. */
  registrarPedidoDeParar: (pendentes: string[]) => Promise<void>;
  /** Cancela os follow-ups agendados do contato; devolve quantos. */
  cancelarFollowups: () => Promise<number>;
}

export interface TurnoInativoEntrada {
  horario: HorarioDaIa | null | undefined;
  /** O relógio do job (quando o instante da mensagem não vem). */
  agora: Date;
  agentId: string;
  log: Logger;
  portas: PortasDoTurnoInativo;
}

/**
 * `true` = a IA estava INATIVA quando a mensagem chegou, e o turno acabou
 * aqui (o pedido de parar, se havia, já foi registrado). `false` = siga o
 * turno como sempre.
 */
export async function turnoTerminaComIaInativa(entrada: TurnoInativoEntrada): Promise<boolean> {
  const { horario, portas, log } = entrada;
  if (horario === null || horario === undefined) return false;

  let instante: Date | null = null;
  try {
    instante = await portas.instanteDaMensagem();
  } catch (err) {
    log.warn("horário da IA: não li quando a mensagem chegou — vale o relógio do turno", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 120),
    });
  }
  const chegouEm = instante ?? entrada.agora;
  if (ativaEm(horario, chegouEm)) return false;

  const volta = proximaTroca(horario, chegouEm);
  log.info("turno encerrado — a IA estava inativa quando a mensagem chegou (a conversa é da equipe)", {
    agent_id: entrada.agentId,
    mensagem_em: chegouEm.toISOString(),
    ia_volta: volta ? `${textoDaTroca(volta)} (${volta.em.toISOString()})` : null,
  });

  // LGPD: o pedido de parar não espera a IA voltar. Falha aqui SOBE: o job
  // volta à fila e a detecção roda de novo (o registro é idempotente), em vez
  // de o pedido se perder num turno que já decidiu não responder.
  const { textos, bloqueado } = await portas.lerPendentes();
  if (textos.some((t) => portas.pedidoDeParar(t))) {
    await portas.registrarPedidoDeParar(textos);
    log.info("possível opt-out com a IA inativa — registrado sem mensagem automática (silêncio, follow-ups cancelados, Central)", {
      agent_id: entrada.agentId,
    });
    return true;
  }
  if (bloqueado) {
    const cancelados = await portas.cancelarFollowups();
    if (cancelados > 0) {
      log.info("opt-out já registrado — follow-ups agendados cancelados (IA inativa)", { canceled: cancelados });
    }
  }
  return true;
}

/**
 * Quando um TOQUE de follow-up pode sair pelo horário da IA: `null` = agora
 * (ativa, ou sem horário); senão o instante da próxima abertura, para onde o
 * toque é reagendado.
 */
export function aberturaDoToque(horario: HorarioDaIa | null | undefined, agora: Date): Date | null {
  if (horario === null || horario === undefined) return null;
  return proximaAbertura(horario, agora);
}

/**
 * FORK MIA — a barra de etapas do cartão aberto, com os DIAS em cada etapa.
 *
 * O relógio é a linha do tempo do próprio negócio: toda troca de etapa grava
 * `crm_lead_activities.type = 'stage_changed'` com `payload.from_stage_id` e
 * `payload.to_stage_id` (rotas de mover, lote, agenda, passagem, espelho do
 * agente — `lib/leads/*-stage-move.ts`). Nenhuma coluna nova: a soma sai do que
 * já está gravado.
 *
 * Regras:
 *  - o negócio nasce na etapa de onde saiu a PRIMEIRA troca (`from_stage_id`);
 *    sem troca nenhuma, na etapa em que está;
 *  - voltar a uma etapa SOMA ao tempo que ela já tinha (o negócio passou por ela
 *    duas vezes; os dois períodos contam);
 *  - negócio encerrado para o relógio no `closed_at`;
 *  - troca registrada fora de ordem ou antes do nascimento não gera tempo
 *    negativo — o período fica em zero.
 */
import { MS_POR_DIA } from "@/lib/cartoes/tempo";

export interface TrocaDeEtapa {
  em: string;
  de: string | null;
  para: string | null;
}

export interface EtapaDaBarra {
  id: string;
  nome: string;
  /** Dias inteiros somados nesta etapa. `null` = o negócio nunca passou por ela. */
  dias: number | null;
  atual: boolean;
  /** Etapa anterior à atual na ordem do funil. */
  feita: boolean;
}

export function diasPorEtapa(entrada: {
  etapas: Array<{ id: string; nome: string; posicao: number; ganha?: boolean; perdida?: boolean }>;
  etapaAtualId: string;
  criadoEm: string;
  encerradoEm: string | null;
  trocas: TrocaDeEtapa[];
  agora: Date;
}): EtapaDaBarra[] {
  const trocas = [...entrada.trocas]
    .filter((t) => t.para)
    .sort((a, b) => new Date(a.em).getTime() - new Date(b.em).getTime());

  const ms = new Map<string, number>();
  const somar = (etapa: string | null, de: number, ate: number) => {
    if (!etapa) return;
    ms.set(etapa, (ms.get(etapa) ?? 0) + Math.max(0, ate - de));
  };

  let etapa: string | null = trocas[0]?.de ?? entrada.etapaAtualId;
  let inicio = new Date(entrada.criadoEm).getTime();
  for (const troca of trocas) {
    const em = new Date(troca.em).getTime();
    somar(etapa, inicio, em);
    etapa = troca.para;
    inicio = Math.max(inicio, em);
  }
  const fim = entrada.encerradoEm ? new Date(entrada.encerradoEm).getTime() : entrada.agora.getTime();
  // O relógio termina na etapa ATUAL do negócio, mesmo que a última troca
  // gravada diga outra — a coluna é a verdade; a atividade é o rastro.
  somar(entrada.etapaAtualId === etapa ? etapa : entrada.etapaAtualId, inicio, fim);

  const ordenadas = [...entrada.etapas].sort((a, b) => a.posicao - b.posicao);
  const posAtual = ordenadas.findIndex((e) => e.id === entrada.etapaAtualId);
  return ordenadas.map((e, i) => {
    const total = ms.get(e.id);
    return {
      id: e.id,
      nome: e.nome,
      dias: total === undefined ? null : Math.floor(total / MS_POR_DIA),
      atual: e.id === entrada.etapaAtualId,
      feita: posAtual >= 0 && i < posAtual,
    };
  });
}

/** Lê as trocas das atividades da timeline (qualquer ordem, qualquer tipo). */
export function trocasDasAtividades(
  atividades: Array<{ type: string; performed_at: string; payload: Record<string, unknown> | null }>,
): TrocaDeEtapa[] {
  const texto = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return atividades
    .filter((a) => a.type === "stage_changed")
    .map((a) => ({
      em: a.performed_at,
      de: texto(a.payload?.from_stage_id),
      para: texto(a.payload?.to_stage_id),
    }));
}

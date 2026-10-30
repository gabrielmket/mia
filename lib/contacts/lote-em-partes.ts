/**
 * FORK MIA (.97) · A AÇÃO EM LOTE EM PARTES: o que a tela repete até acabar.
 *
 * A rota de lote aceita até 100 contatos por chamada, e isso continua sendo
 * regra do SERVIDOR. Quem usa não tem teto: marcou 340 linhas, a ação vai em
 * quatro chamadas; escolheu o filtro inteiro, ela anda pelo `cursor` de
 * `POST /api/v1/contacts/bulk/filtro` até o servidor dizer que acabou.
 *
 * Módulo PURO: recebe quem faz o pedido e quem acompanha, para o laço ser testado
 * sem navegador. Não importa a rota: `TAMANHO_DA_PARTE` é conferido contra
 * `TETO_DO_LOTE` em teste, porque rota não entra em pacote de tela.
 */

/** Quantos ids vão por chamada. É o `TETO_DO_LOTE` de `app/api/v1/contacts/bulk/route.ts`. */
export const TAMANHO_DA_PARTE = 100;

/** O filtro da tela de Contatos, na forma que a rota de lote por filtro lê. */
export interface FiltroDoLote {
  search?: string;
  tag?: string[];
  modo?: "e" | "ou";
  source?: string;
  pessoais?: boolean;
}

/** Quem recebe a ação: os ids marcados, ou o filtro inteiro. */
export type AlvoDoLote = { ids: string[] } | { filtro: FiltroDoLote; total?: number | null };

export interface RecusaDoLote {
  id?: string;
  codigo?: string;
  motivo?: string;
}

/** O que uma chamada devolve, nas duas rotas. */
export interface RespostaDaParte {
  feitos: number;
  recusados: number;
  recusas: RecusaDoLote[];
  /** Só na rota por filtro. */
  processados?: number;
  cursor?: string | null;
  has_more?: boolean;
}

export interface ProgressoDoLote {
  /** Quantos contatos já passaram, feitos ou recusados. */
  processados: number;
  /** Quantos são ao todo. `null` = o total do filtro não foi lido. */
  total: number | null;
}

export interface MotivoDaRecusa {
  motivo: string;
  quantos: number;
}

export interface ResumoDoLote {
  processados: number;
  feitos: number;
  recusados: number;
  /** As recusas juntas por motivo: 300 frases iguais não são informação. */
  motivos: MotivoDaRecusa[];
  /** A ação parou no meio por erro de chamada. O que já foi, foi. */
  interrompido: boolean;
  /** A mensagem do erro que interrompeu. */
  erro?: string;
}

function somar(soma: ResumoDoLote, parte: RespostaDaParte, processados: number, semMotivo: string): void {
  soma.processados += processados;
  soma.feitos += parte.feitos;
  soma.recusados += parte.recusados;
  for (const recusa of parte.recusas) {
    const motivo = recusa.motivo ?? recusa.codigo ?? semMotivo;
    const jaVisto = soma.motivos.find((m) => m.motivo === motivo);
    if (jaVisto) jaVisto.quantos += 1;
    else soma.motivos.push({ motivo, quantos: 1 });
  }
}

/**
 * Roda a ação até o fim.
 *
 * O erro na PRIMEIRA chamada sobe: nada aconteceu, e quem chama mostra o erro de
 * sempre. O erro no meio NÃO sobe: já há contato alterado, e dizer "falhou"
 * esconderia isso. O resumo volta com `interrompido` e o que já foi.
 */
export async function rodarLoteEmPartes(
  alvo: AlvoDoLote,
  pedir: {
    porIds: (ids: string[]) => Promise<RespostaDaParte>;
    porFiltro: (filtro: FiltroDoLote, cursor?: string) => Promise<RespostaDaParte>;
  },
  aoAvancar?: (progresso: ProgressoDoLote) => void,
  semMotivo = "Recusado.",
): Promise<ResumoDoLote> {
  const soma: ResumoDoLote = { processados: 0, feitos: 0, recusados: 0, motivos: [], interrompido: false };
  const total = "ids" in alvo ? alvo.ids.length : (alvo.total ?? null);
  aoAvancar?.({ processados: 0, total });

  const interromper = (err: unknown): ResumoDoLote => {
    if (soma.processados === 0) throw err;
    soma.interrompido = true;
    soma.erro = err instanceof Error ? err.message : String(err);
    return soma;
  };

  if ("ids" in alvo) {
    for (let i = 0; i < alvo.ids.length; i += TAMANHO_DA_PARTE) {
      const ids = alvo.ids.slice(i, i + TAMANHO_DA_PARTE);
      try {
        somar(soma, await pedir.porIds(ids), ids.length, semMotivo);
      } catch (err) {
        return interromper(err);
      }
      aoAvancar?.({ processados: soma.processados, total });
    }
    return soma;
  }

  let cursor: string | undefined;
  for (;;) {
    let parte: RespostaDaParte;
    try {
      parte = await pedir.porFiltro(alvo.filtro, cursor);
    } catch (err) {
      return interromper(err);
    }
    somar(soma, parte, parte.processados ?? 0, semMotivo);
    aoAvancar?.({ processados: soma.processados, total });
    // Sem `cursor` novo não há como andar: parar é o que impede o laço infinito
    // num servidor que diga "tem mais" sem dizer onde.
    if (!parte.has_more || !parte.cursor || parte.cursor === cursor) return soma;
    cursor = parte.cursor;
  }
}

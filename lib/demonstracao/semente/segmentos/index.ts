/**
 * FORK MIA · AS EMPRESAS DE DEMONSTRAÇÃO — o catálogo das sementes.
 *
 * Uma semente por segmento. A bancada é a Empresa Modelo de sempre; as outras
 * quatro são as demonstrações por segmento, cada uma parecendo o negócio do
 * cliente que vai vê-la (docs/fork/cliente-modelo.md).
 */
import { SEGMENTOS_DE_DEMONSTRACAO, type SegmentoDeDemonstracao, type SementeDeDemonstracao } from "../tipos";
import { BANCADA } from "./bancada";

export const SEMENTES: Readonly<Partial<Record<SegmentoDeDemonstracao, SementeDeDemonstracao>>> = {
  bancada: BANCADA,
};

export function sementeDoSegmento(segmento: SegmentoDeDemonstracao): SementeDeDemonstracao {
  const s = SEMENTES[segmento];
  if (!s) throw new Error(`cliente modelo: não existe semente para o segmento "${segmento}"`);
  return s;
}

/** Todas as sementes, na ordem do catálogo. */
export function todasAsSementes(): SementeDeDemonstracao[] {
  return SEGMENTOS_DE_DEMONSTRACAO.flatMap((s) => (SEMENTES[s] ? [SEMENTES[s]] : []));
}

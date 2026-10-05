/**
 * FORK MIA · AS EMPRESAS DE DEMONSTRAÇÃO — o catálogo das sementes.
 *
 * Uma semente por segmento. A bancada é a Empresa Modelo de sempre; as outras
 * quatro são as demonstrações por segmento, cada uma parecendo o negócio do
 * cliente que vai vê-la (docs/fork/cliente-modelo.md).
 */
import { SEGMENTOS_DE_DEMONSTRACAO, type SegmentoDeDemonstracao, type SementeDeDemonstracao } from "../tipos";
import { ACADEMIA } from "./academia";
import { BANCADA } from "./bancada";
import { CLINICA_ODONTO } from "./clinica-odonto";
import { CONSTRUTORA } from "./construtora";
import { INDUSTRIA } from "./industria";

export const SEMENTES: Readonly<Record<SegmentoDeDemonstracao, SementeDeDemonstracao>> = {
  bancada: BANCADA,
  construtora: CONSTRUTORA,
  "clinica-odonto": CLINICA_ODONTO,
  industria: INDUSTRIA,
  academia: ACADEMIA,
};

export function sementeDoSegmento(segmento: SegmentoDeDemonstracao): SementeDeDemonstracao {
  const s = SEMENTES[segmento];
  if (!s) throw new Error(`cliente modelo: não existe semente para o segmento "${segmento}"`);
  return s;
}

/** Todas as sementes, na ordem do catálogo. */
export function todasAsSementes(): SementeDeDemonstracao[] {
  return SEGMENTOS_DE_DEMONSTRACAO.map((s) => SEMENTES[s]);
}

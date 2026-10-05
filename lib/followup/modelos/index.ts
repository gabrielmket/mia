/**
 * O CATÁLOGO DE MODELOS — a face do módulo.
 *
 * Quem consome (a tela, a rota de instalação, o teste) importa daqui e nunca do
 * arquivo do nicho: acrescentar um nicho novo é acrescentar uma lista a
 * `MODELOS_DE_FOLLOWUP`, sem tocar em nenhum consumidor.
 */
import { MODELOS_DE_CLINICA } from "./clinica";
// FORK MIA: os segmentos da MIA, ao lado do de clínica (ver `segmentos.ts`).
import { MODELOS_GERAIS } from "./geral";
import { MODELOS_IMOBILIARIOS } from "./imobiliario";
import { MODELOS_AUTOMOTIVOS } from "./automotivo";
import { MODELOS_DE_ACADEMIA } from "./academia";
import { MODELOS_DE_SERVICOS_B2B } from "./servicos-b2b";
import { MODELOS_DE_INDUSTRIA_B2B } from "./industria-b2b";
import type { ModeloDeFollowup, NichoDeModelo } from "./tipos";

export type { ModeloDeFollowup, NichoDeModelo, EntradaDoModelo } from "./tipos";
export { toquesDoModelo, horizonteDoModeloMs, NICHOS_DE_MODELO } from "./tipos";
// FORK MIA
export { SEGMENTO_PADRAO, ROTULO_DO_SEGMENTO } from "./segmentos";

export const MODELOS_DE_FOLLOWUP: readonly ModeloDeFollowup[] = [
  // FORK MIA: o geral primeiro, porque é o padrão da galeria.
  ...MODELOS_GERAIS,
  ...MODELOS_DE_CLINICA,
  ...MODELOS_IMOBILIARIOS,
  ...MODELOS_AUTOMOTIVOS,
  ...MODELOS_DE_ACADEMIA,
  ...MODELOS_DE_SERVICOS_B2B,
  ...MODELOS_DE_INDUSTRIA_B2B,
];

/** `undefined` — e não um erro — para a rota devolver 404 com a sua própria mensagem. */
export function modeloPorId(id: string): ModeloDeFollowup | undefined {
  return MODELOS_DE_FOLLOWUP.find((m) => m.id === id);
}

export function modelosDoNicho(nicho: NichoDeModelo): ModeloDeFollowup[] {
  return MODELOS_DE_FOLLOWUP.filter((m) => m.nicho === nicho);
}

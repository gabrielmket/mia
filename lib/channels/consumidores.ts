/**
 * Os consumidores do barramento que pertencem aos CANAIS — o ponto por onde
 * `lib/event-log/register-handlers.ts` os registra sem nomear provedor
 * (doutrina de restrição de canal: fora de `lib/channels/`, nenhum nome de
 * transporte). Quem acrescenta um consumidor de canal acrescenta aqui.
 */
import type { EventHandler } from "@/lib/event-log/dispatcher";

import { loteDoHistoricoHandler } from "./meta/coexistencia/lote.handler";
import { pedidoDaSincronizacaoHandler } from "./meta/coexistencia/sincronizacao.handler";
import { pinoReintentoHandler } from "./zernio/pino-reintento.handler";

export const CONSUMIDORES_DOS_CANAIS: readonly EventHandler[] = [
  // O pino que entrou só com o marcador: a API do canal não respondeu a tempo.
  pinoReintentoHandler,
  // FORK MIA: o lote do histórico que a Meta manda na coexistência, gravado
  // como histórico importado (docs/fork/coexistencia.md).
  loteDoHistoricoHandler,
  // FORK MIA: o pedido único dos contatos e do histórico do app, logo depois da
  // conexão pelo app WhatsApp Business (docs/fork/coexistencia.md).
  pedidoDaSincronizacaoHandler,
];

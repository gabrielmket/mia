/**
 * FORK MIA — POR ONDE UM DISPARO DO BROADCAST SAI, e quem pode usar cada caminho.
 *
 * Desde a 1.21.0-mia.58 o Broadcast é um produto só com dois caminhos
 * (docs/fork/broadcast-unificado.md):
 *
 *   - NÚMERO OFICIAL (Meta): modelo aprovado, cobrado por mensagem da carteira.
 *     Motor do Broadcast (`lib/broadcast/motor.ts`).
 *   - NÚMERO POR QR: texto livre, sem custo por mensagem, no ritmo do número.
 *     Motor das Campanhas do upstream (`lib/campanhas/rodada.ts`).
 *
 * Os motores continuam separados por baixo; o que este arquivo decide é a PORTA.
 *
 * ── O interruptor ──────────────────────────────────────────────────────────
 *
 * `QR_EXIGE_O_MODULO` é a proposta a confirmar com o Gabriel: o caminho por QR
 * também fica atrás do módulo `disparador`. É UMA linha de propósito — tudo que
 * depende da decisão (menu, telas, rotas, descrição do módulo) lê daqui, e virar
 * a chave não pede caçar `if` pelo código. A cerca
 * `tests/unit/broadcast-unificado.test.ts` confere as duas posições.
 */
import { capabilitiesOf, transportaMensagem } from "@/lib/channels/capabilities";
import type { ChannelProvider } from "@/lib/channels/types";
import type { ChaveDeModulo } from "@/lib/modulos/vendaveis";

/** Proposta de 29/09/2026, a confirmar: quem não tem o módulo não vê nenhum dos dois. */
export const QR_EXIGE_O_MODULO = true;

/** O módulo vendável do Broadcast. A chave não acompanha o nome — ver `vendaveis.ts`. */
export const MODULO_DO_BROADCAST: ChaveDeModulo = "disparador";

/**
 * As rotas de API do caminho por QR (as Campanhas do upstream). Entram na lista
 * de rotas do módulo quando o interruptor está ligado.
 */
export const ROTAS_DO_QR = [
  "/api/v1/campaigns",
  "/api/v1/campaign-templates",
  "/api/v1/campaign-suppressions",
] as const;

/**
 * O `resource` que essas rotas passam ao `requireRole`. É por ele que a trava
 * reconhece a rota sem editar os nove arquivos do upstream — e a cerca reprova
 * se uma rota daquelas pastas passar a usar um recurso que não está aqui.
 */
export const RECURSOS_DO_QR = ["campaigns", "campaign_templates", "campaign_suppressions"] as const;

/**
 * Qual módulo este `resource` do `requireRole` exige? `null` = nenhum, que é o
 * caso de quase toda rota. Com o interruptor desligado, o QR volta a ser de todos.
 */
export function moduloExigidoPeloRecurso(
  resource: string | undefined,
  qrExigeOModulo: boolean = QR_EXIGE_O_MODULO,
): ChaveDeModulo | null {
  if (!resource || !qrExigeOModulo) return null;
  return (RECURSOS_DO_QR as readonly string[]).includes(resource) ? MODULO_DO_BROADCAST : null;
}

export interface CanaisLiberados {
  /** Número oficial: exige o módulo, sempre — é ele que cobra por mensagem. */
  oficial: boolean;
  /** Número por QR: exige o módulo só com o interruptor ligado. */
  qr: boolean;
}

/**
 * O que ESTA organização pode usar do Broadcast. Os dois `false` = a tela diz
 * "não contratado" e o menu não mostra a porta.
 */
export function canaisLiberados(
  contratado: boolean,
  qrExigeOModulo: boolean = QR_EXIGE_O_MODULO,
): CanaisLiberados {
  return { oficial: contratado, qr: contratado || !qrExigeOModulo };
}

/**
 * O que a tela do Broadcast mostra para esta pessoa, nesta organização.
 *
 * A ordem das perguntas é a da porta: sem organização não há o que mostrar;
 * papel abaixo de manager não decide gastar (cada mensagem oficial é dinheiro do
 * cliente, e cada uma por QR é risco para o número dele); e só então o módulo.
 * Dizer "não contratado" a quem nem tem papel faria um atendente pedir ao dono
 * uma coisa que ele, de todo modo, não poderia usar.
 */
export type AcessoAoBroadcast =
  | { estado: "sem_organizacao" }
  | { estado: "sem_papel" }
  | { estado: "nao_contratado" }
  | { estado: "liberado"; canais: CanaisLiberados };

export function decidirAcesso(entrada: {
  temOrganizacao: boolean;
  papelSuficiente: boolean;
  contratado: boolean;
  qrExigeOModulo?: boolean;
}): AcessoAoBroadcast {
  if (!entrada.temOrganizacao) return { estado: "sem_organizacao" };
  if (!entrada.papelSuficiente) return { estado: "sem_papel" };
  const canais = canaisLiberados(entrada.contratado, entrada.qrExigeOModulo ?? QR_EXIGE_O_MODULO);
  if (!canais.oficial && !canais.qr) return { estado: "nao_contratado" };
  return { estado: "liberado", canais };
}

/**
 * Este número é "por QR"? A pergunta é de CAPACIDADE, não de provedor
 * (`docs/doctrine/restricao-de-canal.md`): manda texto livre a qualquer hora e
 * corre risco de bloqueio. É exatamente o que o motor das Campanhas precisa —
 * texto livre — e o risco que a tela tem de anunciar.
 *
 * Provedor desconhecido responde `false`: falhar fechado aqui só tira um nome da
 * lista de sugestões, nunca oferece um número que não entrega.
 */
export function ehNumeroPorQr(provider: string | null | undefined): boolean {
  if (!transportaMensagem(provider)) return false;
  const caps = capabilitiesOf(provider as ChannelProvider);
  return caps.freeformOutsideWindow && caps.banRisk;
}

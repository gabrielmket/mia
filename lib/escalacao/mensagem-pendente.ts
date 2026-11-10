/**
 * FORK MIA (.107) · A IA RESPONDE A MENSAGEM DO CLIENTE QUE FICOU PENDENTE.
 *
 * ## O defeito (produção, 09/11/2026)
 *
 * Uma pessoa da equipe mandou "ola" pela tela. O envio pela tela silencia a IA
 * naquela conversa por 5 minutos (`extendBotSilence`, em
 * `app/api/v1/messages/_handler.ts`). O cliente respondeu 21 s depois, dentro
 * do silêncio: o pedido de turno daquela mensagem (`ai_agent.dispatch_requested`,
 * emitido por `lib/channels/pos-entrada.ts`) chegou ao drain e a elegibilidade o
 * descartou (`conversa_silenciada`). Descartado é descartado: o evento vira
 * `done` sem job. Quando o silêncio acabou não chegou mensagem nova, e nada
 * mais pediu o turno. A conversa ficou em "Automático", com o cliente
 * esperando e ninguém respondendo.
 *
 * O mesmo buraco aparece em três portas:
 *   1. o silêncio do envio pela tela (5 min) vence;
 *   2. o silêncio do atendimento manual pelo celular vence
 *      (`lib/escalacao/atendimento-manual.ts`, padrão de 60 min);
 *   3. alguém devolve a conversa para a IA (botão, "Liberar", tool, cron de
 *      devolução) DEPOIS de o cliente já ter escrito.
 *
 * ## A regra, num lugar só
 *
 * `pedirTurnoDaMensagemPendente` pede o turno da IA para a ÚLTIMA mensagem do
 * cliente quando ela está sem resposta. Pede só quando TUDO isto vale:
 *
 *   - a conversa não é grupo, não está encerrada e tem canal e contato;
 *   - não está com uma PESSOA (`assignee_kind <> 'user'`);
 *   - o contato não está bloqueado, não é pessoal e não está com `force_human`;
 *   - o motor não cala o contato inteiro: `isLeadInHandoff`, a MESMA função do
 *     turno, chamada aqui (pessoa ou silêncio em OUTRA conversa do contato,
 *     `ai_opt_out`, contato interno; ver `pausa-por-outra-conversa.ts`);
 *   - a conversa não está silenciada AGORA (qualquer silêncio em vigor, o
 *     `infinity` do handoff inclusive);
 *   - a última mensagem do cliente não é reação nem histórico importado, e não
 *     há saída nenhuma (pessoa, IA, automação, celular) depois dela;
 *   - ela é recente: até `JANELA_DA_MENSAGEM_PENDENTE_MS` (30 min);
 *   - ninguém pediu ainda o turno dela por este caminho, e o pedido original
 *     não está mais na fila (se estiver, é ele que decide).
 *
 * O pedido é o MESMO evento de uma mensagem normal (`emit_event` com
 * `ai_agent.dispatch_requested`, `p_entity_kind: "message"`, o id da mensagem
 * do cliente e o payload de `pos-entrada.ts`, campo a campo). O precedente é a
 * reemissão de `lib/escalacao/handoff-tecnico.ts` (`reenfileirarTurno`).
 * `metadata.source` diz a origem: `retomada_da_ia` ou `fim_do_silencio`.
 *
 * ## O que NÃO mora aqui (de propósito)
 *
 * Janela de resposta do número, gate do número (modo de teste, allowlist),
 * horário da IA, canal desativado, organização parada, agente publicado,
 * debounce, anti-backlog, o teto de espera da mídia e "uma resposta por
 * mensagem" continuam decididos pelo drain
 * (`lib/agent-engine/edge/crm/drain.ts`) e pelo turno
 * (`lib/agent-engine/agent/inbound-turn.ts`), como em qualquer mensagem. Uma
 * cópia dessas regras aqui divergiria na primeira vez que alguém mexesse lá.
 * Os vetos repetidos acima (grupo, pessoa, silêncio, `force_human`) existem só
 * para não gravar evento que o drain jogaria fora.
 *
 * ## Quem chama, e o silêncio que a devolução zera
 *
 *   - `devolverAtendimentoAoAgente` (`retomada.ts`): o botão "Devolver ao
 *     automático" (`reactivate-bot`, um e em lote), a tool
 *     `crm_resume_ai_attendance`, o cron `handoff-devolucao` e o `#on` do
 *     celular. A devolução já gravava `bot_silenced_until = null`, e isso zera
 *     também os 5 min do envio pela tela: devolver vale na hora, não 5 min
 *     depois. O silêncio que deve continuar é o que outra regra impõe de
 *     propósito, e nenhuma delas mora nessa coluna: `ai_opt_out` (a devolução
 *     recusa antes de escrever), canal desligado ou em manutenção, horário da
 *     IA, gate do número e organização parada (decididos no drain e no turno).
 *     Ficam de fora, por `responderPendente: false`: o fechamento com
 *     "devolver ao automático" (fechar encerra o assunto; a IA responde a
 *     PRÓXIMA mensagem) e `handoff-tecnico.ts` (pede o turno da mensagem cuja
 *     transcrição chegou, que é mais preciso).
 *   - "Liberar" (`release`): `fn_conversation_assign` com dono nulo zera o
 *     silêncio quando não houve handoff formal e deixa `assignee_kind` nulo, que
 *     é o automático de volta. A rota chama esta função depois; com o silêncio
 *     mantido (houve handoff), ela recusa por `silenciada_agora`.
 *   - O cron `ia-pendente` (`varrerFimDoSilencio`, abaixo): o silêncio finito
 *     que venceu.
 *
 * ## Nunca duas vezes para a mesma mensagem
 *
 * Antes de emitir, a função lê os pedidos de turno daquela mensagem
 * (`event_log`, índice `event_log_entity_idx`). Se já existe um com origem
 * `retomada_da_ia` ou `fim_do_silencio`, não pede de novo: a devolução e a
 * varredura do fim do silêncio podem bater na mesma mensagem, e só a primeira
 * vale. Se o pedido ORIGINAL ainda está `pending` ou `processing`, também não:
 * o drain ainda não decidiu e vai decidir com o estado de agora. A corrida
 * residual (dois chamadores no mesmo milissegundo) cai na coalescência do drain
 * e na guarda "uma resposta por mensagem" do turno (`turno-ja-respondido.ts`).
 *
 * Nunca lança: quem chama acabou de fazer outra coisa (devolver o atendimento,
 * varrer) que não pode ser desfeita porque o pedido do turno falhou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarInstante } from "@/lib/ai/elegibilidade/gate";
import { logger } from "@/lib/logger";

/** Até quanto tempo depois de chegar a mensagem do cliente ainda é respondida. */
export const JANELA_DA_MENSAGEM_PENDENTE_MS = 30 * 60 * 1000;

/** A varredura só olha silêncio que venceu nestes últimos minutos. */
export const JANELA_DO_FIM_DO_SILENCIO_MS = 15 * 60 * 1000;

/** Quantos pedidos de turno a varredura faz, no máximo, por rodada. */
export const LIMITE_POR_RODADA = 50;

/**
 * Quantas conversas a varredura lê por rodada, antes do filtro em memória (o
 * PostgREST não compara duas colunas). Folga de 4× sobre o limite de pedidos.
 */
const LIMITE_DE_LEITURA = 200;

export const ORIGENS_DO_PEDIDO_PENDENTE = ["retomada_da_ia", "fim_do_silencio"] as const;
export type OrigemDoPedidoPendente = (typeof ORIGENS_DO_PEDIDO_PENDENTE)[number];

const EVENTO_DO_TURNO = "ai_agent.dispatch_requested";

/** O mesmo corte de "conversa acabou" da tela (`lib/inbox/comando-da-conversa.ts`). */
const STATUS_ENCERRADOS: ReadonlySet<string> = new Set(["closed", "archived", "resolved"]);

/** Os estados em que a conversa ainda é atendida (o mesmo do cron de devolução). */
const STATUS_ATENDIDOS = ["open", "pending", "claimed", "ai_handling"] as const;

/**
 * Os tipos de `messages` que são fala (o CHECK `messages_type_check` menos
 * `reaction` e `system`): reação da equipe e linha de sistema não respondem
 * o cliente.
 */
const TIPOS_DE_FALA = ["text", "image", "video", "audio", "document", "sticker", "location", "contact"] as const;

/** Pedido que o drain ainda não decidiu. */
const PEDIDO_NA_FILA: ReadonlySet<string> = new Set(["pending", "processing"]);

export type MotivoDaRecusa =
  | "conversa_inexistente"
  | "grupo"
  | "com_pessoa"
  | "conversa_encerrada"
  | "sem_canal"
  | "contato_bloqueado"
  | "contato_pessoal"
  | "force_human"
  /** `isLeadInHandoff`: pessoa ou silêncio em OUTRA conversa do contato, `ai_opt_out` ou contato interno. */
  | "contato_em_handoff"
  | "silenciada_agora"
  | "sem_mensagem_do_cliente"
  | "nao_e_fala"
  | "ja_respondida"
  | "mensagem_velha"
  | "chegou_depois_do_silencio"
  | "ja_pedido"
  | "pedido_na_fila"
  | "erro";

export type DesfechoDoPedido =
  | { pediu: true; inboundMessageId: string }
  | { pediu: false; porque: MotivoDaRecusa };

export interface ConversaDoPedido {
  is_group: boolean | null;
  assignee_kind: string | null;
  status: string | null;
  bot_silenced_until: string | null;
  contact_id: string | null;
  channel_session_id: string | null;
}

export interface ContatoDoPedido {
  is_blocked: boolean | null;
  is_personal: boolean | null;
  force_human: boolean | null;
}

export interface MensagemDoCliente {
  id: string;
  type: string | null;
  created_at: string;
  sent_at: string | null;
  metadata: unknown;
}

export interface PedidoJaFeito {
  status: string | null;
  metadata: unknown;
}

/** A conversa ainda pode receber a IA? (pura) */
export function recusaDaConversa(conversa: ConversaDoPedido | null, agora: Date): MotivoDaRecusa | null {
  if (!conversa) return "conversa_inexistente";
  if (conversa.is_group !== false) return "grupo";
  if (conversa.assignee_kind === "user") return "com_pessoa";
  if (conversa.status && STATUS_ENCERRADOS.has(conversa.status)) return "conversa_encerrada";
  if (!conversa.contact_id || !conversa.channel_session_id) return "sem_canal";
  // `'infinity'` do handoff vira `Infinity` e é sempre "silenciada agora".
  const ate = normalizarInstante(conversa.bot_silenced_until);
  if (ate !== null) {
    const ms = typeof ate === "number" ? ate : ate.getTime();
    if (ms > agora.getTime()) return "silenciada_agora";
  }
  return null;
}

/** O contato ainda pode receber a IA? (pura) */
export function recusaDoContato(contato: ContatoDoPedido | null): MotivoDaRecusa | null {
  if (!contato) return "conversa_inexistente";
  if (contato.is_blocked === true) return "contato_bloqueado";
  if (contato.is_personal === true) return "contato_pessoal";
  if (contato.force_human === true) return "force_human";
  return null;
}

function instanteMs(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A última mensagem do cliente ainda espera resposta e é recente? (pura)
 *
 * "Recente" mede o instante MAIS ANTIGO entre `sent_at` (o relógio do canal) e
 * `created_at` (quando ela chegou a nós): uma entrega atrasada ou uma linha de
 * histórico importado não passam por nova só porque foram gravadas agora.
 * `chegouAte` é o fim do silêncio, na varredura: a mensagem tem de ter chegado
 * ANTES dele, senão o pedido original já passou pelo drain sem silêncio e
 * pedir de novo seria pedir duas vezes.
 */
export function recusaDaMensagem(
  mensagem: MensagemDoCliente | null,
  entrada: { saidaDepois: boolean; agora: Date; chegouAte?: Date | null },
): MotivoDaRecusa | null {
  if (!mensagem) return "sem_mensagem_do_cliente";
  if (!(TIPOS_DE_FALA as readonly string[]).includes(mensagem.type ?? "")) return "nao_e_fala";
  const meta = mensagem.metadata as Record<string, unknown> | null;
  if (meta && typeof meta === "object" && String(meta.historico_importado ?? "") === "true") return "nao_e_fala";
  if (entrada.saidaDepois) return "ja_respondida";
  const gravada = instanteMs(mensagem.created_at);
  if (gravada === null) return "mensagem_velha";
  const enviada = instanteMs(mensagem.sent_at) ?? gravada;
  const quando = Math.min(gravada, enviada);
  if (entrada.agora.getTime() - quando > JANELA_DA_MENSAGEM_PENDENTE_MS) return "mensagem_velha";
  if (entrada.chegouAte && gravada > entrada.chegouAte.getTime()) return "chegou_depois_do_silencio";
  return null;
}

/** Já pediram o turno desta mensagem, ou o pedido original ainda está na fila? (pura) */
export function recusaDosPedidos(pedidos: readonly PedidoJaFeito[]): MotivoDaRecusa | null {
  const nossas = new Set<string>(ORIGENS_DO_PEDIDO_PENDENTE);
  for (const p of pedidos) {
    const fonte = (p.metadata as { source?: unknown } | null)?.source;
    if (typeof fonte === "string" && nossas.has(fonte)) return "ja_pedido";
  }
  if (pedidos.some((p) => p.status !== null && PEDIDO_NA_FILA.has(p.status))) return "pedido_na_fila";
  return null;
}

export interface PedidoDeTurnoPendente {
  organizationId: string;
  conversationId: string;
  origem: OrigemDoPedidoPendente;
  requestId: string;
  agora?: Date;
  /** Só a varredura: a mensagem tem de ter chegado até o fim do silêncio. */
  chegouAte?: Date | null;
}

export interface DependenciasDoPedido {
  /**
   * O veto do turno para o contato inteiro. Padrão: `isLeadInHandoff`, pelo pool
   * do processo (`getRequestPool`). Injetável para o teste.
   */
  contatoEmHandoff?: (organizationId: string, contactId: string) => Promise<boolean>;
}

/**
 * `isLeadInHandoff` em pessoa, sem cópia da regra. O import é dinâmico de
 * propósito: `human-handoff.ts` chega, por `handoff-tecnico.ts`, a `retomada.ts`,
 * que importa este arquivo, e o ciclo estático ficaria a um `const` de quebrar.
 */
async function contatoEmHandoffPeloMotor(organizationId: string, contactId: string): Promise<boolean> {
  const [{ isLeadInHandoff }, { getRequestPool }] = await Promise.all([
    import("@/lib/agent-engine/agent/human-handoff"),
    import("@/lib/agent-engine/db/request-pool"),
  ]);
  return isLeadInHandoff(getRequestPool(), organizationId, contactId);
}

/**
 * Pede o turno da IA para a última mensagem do cliente, se ela está pendente.
 *
 * `db` é o cliente de quem chama: o da sessão na rota da tela (a RLS deixa ler
 * a conversa que a pessoa acabou de devolver, e o `emit_event` aceita
 * `ai_agent.dispatch_requested` de membro da organização), o de serviço no cron.
 * Toda leitura filtra `organization_id` aqui, dos dois jeitos.
 */
export async function pedirTurnoDaMensagemPendente(
  db: SupabaseClient,
  pedido: PedidoDeTurnoPendente,
  deps: DependenciasDoPedido = {},
): Promise<DesfechoDoPedido> {
  const { organizationId, conversationId, origem, requestId } = pedido;
  const agora = pedido.agora ?? new Date();
  const recusa = (porque: MotivoDaRecusa): DesfechoDoPedido => ({ pediu: false, porque });
  try {
    const { data: conversaLida, error: erroConversa } = await db
      .from("conversations")
      .select("is_group, assignee_kind, status, bot_silenced_until, contact_id, channel_session_id")
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .maybeSingle();
    if (erroConversa) throw new Error(`conversa: ${erroConversa.message}`);
    const conversa = (conversaLida ?? null) as ConversaDoPedido | null;
    const naConversa = recusaDaConversa(conversa, agora);
    if (naConversa) return recusa(naConversa);
    const contactId = conversa!.contact_id!;
    const channelSessionId = conversa!.channel_session_id!;

    const { data: contatoLido, error: erroContato } = await db
      .from("contacts")
      .select("is_blocked, is_personal, force_human")
      .eq("organization_id", organizationId)
      .eq("id", contactId)
      .maybeSingle();
    if (erroContato) throw new Error(`contato: ${erroContato.message}`);
    const noContato = recusaDoContato((contatoLido ?? null) as ContatoDoPedido | null);
    if (noContato) return recusa(noContato);

    // A RÉGUA DO MOTOR, a mesma função: com uma pessoa (ou um silêncio) em OUTRA
    // conversa do contato, `isLeadInHandoff` cala o turno em todos os números
    // (decisão de 10/11, "calada em todos, mas avisando"). Pedir aqui seria
    // pedir um turno que o motor pula. Também cobre `ai_opt_out` e contato interno.
    if (await (deps.contatoEmHandoff ?? contatoEmHandoffPeloMotor)(organizationId, contactId)) {
      return recusa("contato_em_handoff");
    }

    // A MESMA "última do cliente" do anti-backlog do drain: pedir o turno de
    // outra mensagem faria o drain descartá-lo como superado.
    const { data: entradas, error: erroEntrada } = await db
      .from("messages")
      .select("id, type, created_at, sent_at, metadata")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (erroEntrada) throw new Error(`mensagem do cliente: ${erroEntrada.message}`);
    const ultima = ((entradas ?? []) as MensagemDoCliente[])[0] ?? null;

    // Saída depois dela, pelo relógio do BANCO dos dois lados (`created_at`),
    // como em `handoff-tecnico.ts`. Reação da equipe não é resposta.
    let saidaDepois = false;
    if (ultima) {
      const { data: saidas, error: erroSaida } = await db
        .from("messages")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .eq("direction", "outbound")
        .in("type", [...TIPOS_DE_FALA])
        .gt("created_at", ultima.created_at)
        .limit(1);
      if (erroSaida) throw new Error(`saída: ${erroSaida.message}`);
      saidaDepois = (saidas ?? []).length > 0;
    }
    const naMensagem = recusaDaMensagem(ultima, { saidaDepois, agora, chegouAte: pedido.chegouAte });
    if (naMensagem) return recusa(naMensagem);
    const inboundMessageId = ultima!.id;

    const { data: pedidosLidos, error: erroPedidos } = await db
      .from("event_log")
      .select("status, metadata")
      .eq("organization_id", organizationId)
      .eq("entity_kind", "message")
      .eq("entity_id", inboundMessageId)
      .eq("event_type", EVENTO_DO_TURNO)
      .limit(50);
    if (erroPedidos) throw new Error(`pedidos: ${erroPedidos.message}`);
    const nosPedidos = recusaDosPedidos((pedidosLidos ?? []) as PedidoJaFeito[]);
    if (nosPedidos) return recusa(nosPedidos);

    // O payload de `pos-entrada.ts` (`pedirDespachoDoAgente`), campo a campo: o
    // consumidor é um só e não adivinha de quem veio.
    const { error: erroEmit } = await db.rpc("emit_event", {
      p_event_type: EVENTO_DO_TURNO,
      p_entity_kind: "message",
      p_entity_id: inboundMessageId,
      p_payload: {
        organization_id: organizationId,
        conversation_id: conversationId,
        contact_id: contactId,
        channel_session_id: channelSessionId,
        inbound_message_id: inboundMessageId,
      },
      p_metadata: { source: origem, request_id: requestId, motivo: "mensagem_do_cliente_sem_resposta" },
      p_organization_id: organizationId,
    });
    if (erroEmit) throw new Error(`emit_event: ${erroEmit.message}`);

    logger.info("[mensagem-pendente] turno pedido para a mensagem do cliente sem resposta", {
      organization_id: organizationId,
      conversation_id: conversationId,
      inbound_message_id: inboundMessageId,
      origem,
      requestId,
    });
    return { pediu: true, inboundMessageId };
  } catch (erro) {
    logger.warn("[mensagem-pendente] o turno da mensagem pendente não foi pedido", {
      organization_id: organizationId,
      conversation_id: conversationId,
      origem,
      requestId,
      erro: (erro instanceof Error ? erro.message : String(erro)).slice(0, 160),
    });
    return recusa("erro");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// O FIM DO SILÊNCIO · a varredura de minuto em minuto
// ────────────────────────────────────────────────────────────────────────────

export interface ConversaDoFimDoSilencio {
  id: string;
  organization_id: string;
  bot_silenced_until: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
}

/**
 * Quem a varredura chama, em ordem (pura).
 *
 * Fica: silêncio FINITO que venceu nos últimos `JANELA_DO_FIM_DO_SILENCIO_MS`,
 * com a última mensagem do cliente chegada até o fim dele, nos últimos
 * `JANELA_DA_MENSAGEM_PENDENTE_MS`, e sem saída depois dela (pelas colunas da
 * conversa; `pedirTurnoDaMensagemPendente` confere de novo nas mensagens). O
 * `infinity` do handoff formal nunca vence, então nunca entra. A ordem é do
 * silêncio que venceu primeiro (o mais perto de sair da janela) e o corte é
 * `LIMITE_POR_RODADA`.
 */
export function selecionarFimDoSilencio(
  conversas: readonly ConversaDoFimDoSilencio[],
  agora: Date,
): Array<{ conversa: ConversaDoFimDoSilencio; fimDoSilencio: Date }> {
  const agoraMs = agora.getTime();
  const escolhidas: Array<{ conversa: ConversaDoFimDoSilencio; fimDoSilencio: Date }> = [];
  for (const conversa of conversas) {
    const fim = normalizarInstante(conversa.bot_silenced_until);
    if (!(fim instanceof Date)) continue; // nulo, ilegível ou `infinity`
    const fimMs = fim.getTime();
    if (fimMs > agoraMs || agoraMs - fimMs > JANELA_DO_FIM_DO_SILENCIO_MS) continue;
    const entrada = instanteMs(conversa.last_inbound_at);
    if (entrada === null || entrada > fimMs) continue;
    if (agoraMs - entrada > JANELA_DA_MENSAGEM_PENDENTE_MS) continue;
    const saida = instanteMs(conversa.last_outbound_at);
    if (saida !== null && saida >= entrada) continue;
    escolhidas.push({ conversa, fimDoSilencio: fim });
  }
  escolhidas.sort((a, b) => a.fimDoSilencio.getTime() - b.fimDoSilencio.getTime());
  return escolhidas.slice(0, LIMITE_POR_RODADA);
}

export interface ResultadoDoFimDoSilencio {
  examinadas: number;
  candidatas: number;
  pedidas: number;
  falhas: number;
}

/**
 * A varredura do cron `ia-pendente`. Atravessa as organizações de propósito
 * (cliente de serviço), como o `handoff-devolucao`; cada conversa passa por
 * `pedirTurnoDaMensagemPendente`, que filtra `organization_id` em toda leitura.
 *
 * ## Por que ela não acorda conversa antiga em massa
 *
 * Três cercas de tempo, e as três precisam valer juntas: o silêncio venceu nos
 * últimos 15 min; a mensagem do cliente chegou nos últimos 30 min; e chegou
 * antes do fim do silêncio, sem saída nenhuma depois. Conversa parada há horas
 * não passa pela segunda; a de handoff formal (`infinity`) nem pela primeira. Na
 * primeira rodada depois da implantação o alcance é o mesmo de qualquer outra:
 * só o que venceu no último quarto de hora. Por cima, no máximo 50 pedidos por
 * rodada, nunca dois para a mesma mensagem, e o drain ainda aplica o gate, a
 * janela de resposta do número, o horário da IA e o anti-backlog.
 */
export async function varrerFimDoSilencio(
  admin: SupabaseClient,
  entrada: { requestId: string; agora?: Date; deps?: DependenciasDoPedido },
): Promise<ResultadoDoFimDoSilencio> {
  const agora = entrada.agora ?? new Date();
  const desde = new Date(agora.getTime() - JANELA_DO_FIM_DO_SILENCIO_MS).toISOString();
  const recente = new Date(agora.getTime() - JANELA_DA_MENSAGEM_PENDENTE_MS).toISOString();
  // `conversations_bot_silenced_idx` (parcial, `bot_silenced_until is not null`)
  // atende o intervalo. `infinity` > agora, então `lte(agora)` já o deixa fora.
  const { data, error } = await admin
    .from("conversations")
    .select("id, organization_id, bot_silenced_until, last_inbound_at, last_outbound_at")
    .gt("bot_silenced_until", desde)
    .lte("bot_silenced_until", agora.toISOString())
    .eq("is_group", false)
    .in("status", [...STATUS_ATENDIDOS])
    .gte("last_inbound_at", recente)
    .order("bot_silenced_until", { ascending: true })
    .limit(LIMITE_DE_LEITURA);
  if (error) throw new Error(`conversations: ${error.message}`);
  const lidas = (data ?? []) as ConversaDoFimDoSilencio[];
  const candidatas = selecionarFimDoSilencio(lidas, agora);

  let pedidas = 0;
  let falhas = 0;
  for (const { conversa, fimDoSilencio } of candidatas) {
    const r = await pedirTurnoDaMensagemPendente(admin, {
      organizationId: conversa.organization_id,
      conversationId: conversa.id,
      origem: "fim_do_silencio",
      requestId: entrada.requestId,
      agora,
      chegouAte: fimDoSilencio,
    }, entrada.deps);
    if (r.pediu) pedidas++;
    else if (r.porque === "erro") falhas++;
  }
  return { examinadas: lidas.length, candidatas: candidatas.length, pedidas, falhas };
}

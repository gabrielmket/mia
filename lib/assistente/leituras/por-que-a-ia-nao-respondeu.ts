/**
 * FORK MIA (.88) — "POR QUE A IA NÃO RESPONDEU A HELENA?"
 *
 * A resposta vem do estado que o motor leu e do registro do que a IA fez em
 * cada mensagem (`agent_turn_traces`, que chegou do upstream na v1.88), na
 * ordem do que decide primeiro:
 *
 *   1. o contato pediu para parar (`contacts.is_blocked`, o opt-out);
 *   2. a conversa está com alguém da equipe (`comando_da_conversa = 'humano'`):
 *      enquanto uma pessoa está com a conversa, a IA fica calada;
 *   3. o número está desconectado (`channel_sessions.status` fora de `WORKING`);
 *   4. nenhum agente no ar no número, ou o agente está pausado (a régua do
 *      motor: o agente grudado na conversa, senão o publicado no número);
 *   4b. FORK MIA (.107): o número em modo de teste (só a lista de teste
 *      recebe a IA) ou com a lista de autorização (allowlist), o gate de
 *      `lib/ai/elegibilidade/gate.ts` e `pre-go-live.ts`;
 *   5. fora do horário da IA (.85): a mensagem chegou com a IA inativa;
 *   6. a IA silenciada na conversa; FORK MIA (.107): se o silêncio já acabou
 *      sem a IA responder, a resposta diz isso e que, desde a .107, a IA
 *      responde sozinha quando o silêncio acaba (`lib/escalacao/mensagem-pendente.ts`);
 *   7. o turno da IA rodou e falhou, foi interrompido ou terminou sem enviar.
 *
 * ── Quem vê o quê ───────────────────────────────────────────────────────────
 *
 * A conversa é procurada com o cliente da SESSÃO: o administrador e o gestor
 * acham qualquer uma; o atendente só as que o Inbox mostra a ele (a RLS de
 * `conversations`, `fn_can_view_conversation`). Conversa que não aparece para a
 * pessoa é "não encontrei entre as que você vê", nunca a resposta de outra.
 * Nenhum texto de mensagem é lido: só instantes, direção e quem enviou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ativaEm, lerHorarioDaIa } from "@/lib/agent-engine/agent/horario-da-ia";
import { normalizarInstante, ttlDaAutorizacaoMs } from "@/lib/ai/elegibilidade/gate";
import { lerModoDeAcessoDaIa, lerNumerosDeTeste, numeroPodeTestar } from "@/lib/ai/elegibilidade/pre-go-live";
import { JANELA_DA_MENSAGEM_PENDENTE_MS } from "@/lib/escalacao/mensagem-pendente";
import { rotuloLocal } from "@/lib/tempo/agora";

import { nomeDaPessoa, nomesDosContatos, type PessoaDaEquipe } from "./comum";

export type MotivoDoSilencio =
  | "pediu_para_parar"
  | "conversa_com_a_equipe"
  | "numero_desconectado"
  | "sem_agente_no_ar"
  | "agente_pausado"
  | "fora_do_horario_da_ia"
  | "numero_em_teste"
  | "contato_sem_autorizacao"
  | "ia_silenciada"
  | "silencio_acabou_sem_resposta"
  | "turno_falhou"
  | "turno_sem_envio"
  | "ia_respondeu"
  | "sem_mensagem_do_cliente"
  | "nao_encontrado";

export interface ExplicacaoDoSilencio {
  encontrado: boolean;
  /** Mais de um contato com esse nome: a pessoa escolhe. */
  opcoes: Array<{ contato: string; conversation_id: string }>;
  contato: string | null;
  conversation_id: string | null;
  mensagem_do_cliente_em: string | null;
  motivo: MotivoDoSilencio;
  /** Os fatos lidos, em frases curtas, para o assistente explicar. */
  fatos: string[];
  /** O que resolve, em uma frase. */
  conserto: string | null;
  link_da_conversa: string | null;
  contatos: string[];
  fontes: string[];
}

function escaparLike(texto: string): string {
  return texto.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[(),]/g, " ").trim();
}

interface ConversaLida {
  id: string;
  contact_id: string;
  status: string;
  assigned_to_user_id: string | null;
  assigned_at: string | null;
  bot_silenced_until: string | null;
  channel_session_id: string | null;
  active_ai_agent_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  comando_da_conversa: string | null;
}

const COLUNAS =
  "id, contact_id, status, assigned_to_user_id, assigned_at, bot_silenced_until, channel_session_id, " +
  "active_ai_agent_id, last_inbound_at, last_outbound_at, comando_da_conversa";

export async function explicarSilencioDaIa(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    contato: string;
    fuso: string;
    equipe: readonly PessoaDaEquipe[];
    /** FORK MIA (.107): o relógio, injetável para o teste. */
    agora?: Date;
  },
): Promise<ExplicacaoDoSilencio> {
  const org = entrada.organizationId;
  const agora = entrada.agora ?? new Date();
  const fontes = ["Caixa de entrada", "Registro do que a IA fez em cada mensagem"];
  const vazio = (motivo: MotivoDoSilencio, fatos: string[] = []): ExplicacaoDoSilencio => ({
    encontrado: false,
    opcoes: [],
    contato: null,
    conversation_id: null,
    mensagem_do_cliente_em: null,
    motivo,
    fatos,
    conserto: null,
    link_da_conversa: null,
    contatos: [],
    fontes,
  });

  const termo = escaparLike(entrada.contato).slice(0, 80);
  if (termo.length < 2) return vazio("nao_encontrado", ["Faltou o nome do contato."]);

  const { data: contatosBrutos } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("is_anonymized", false)
    .or(`name.ilike.%${termo}%,display_name.ilike.%${termo}%`)
    .limit(10);
  const ids = ((contatosBrutos ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (ids.length === 0) return vazio("nao_encontrado");

  // A conversa pela sessão: só as que o Inbox mostra a quem perguntou.
  const { data: conversasBrutas } = await db
    .from("conversations")
    .select(COLUNAS)
    .eq("organization_id", org)
    .in("contact_id", ids)
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(10);
  const conversas = (conversasBrutas ?? []) as unknown as ConversaLida[];
  if (conversas.length === 0) return vazio("nao_encontrado");

  const nomes = await nomesDosContatos(db, org, conversas.map((c) => c.contact_id));
  const contatosDistintos = [...new Set(conversas.map((c) => c.contact_id))];
  if (contatosDistintos.length > 1) {
    return {
      ...vazio("nao_encontrado"),
      opcoes: contatosDistintos.slice(0, 5).map((id) => ({
        contato: nomes.get(id) ?? "Contato sem nome",
        conversation_id: conversas.find((c) => c.contact_id === id)!.id,
      })),
      contatos: contatosDistintos,
    };
  }

  const conversa = conversas[0]!;
  const nome = nomes.get(conversa.contact_id) ?? "Contato sem nome";
  const fatos: string[] = [];
  const base = {
    encontrado: true,
    opcoes: [],
    contato: nome,
    conversation_id: conversa.id,
    link_da_conversa: `/app/inbox?id=${conversa.id}`,
    contatos: [conversa.contact_id],
    fontes,
  };

  // A última mensagem do cliente e o que saiu depois dela (sem texto nenhum).
  const { data: entradaBruta } = await db
    .from("messages")
    .select("sent_at")
    .eq("organization_id", org)
    .eq("conversation_id", conversa.id)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1);
  const ultimaDoCliente = ((entradaBruta ?? []) as Array<{ sent_at: string }>)[0]?.sent_at ?? null;
  if (!ultimaDoCliente) {
    return { ...base, mensagem_do_cliente_em: null, motivo: "sem_mensagem_do_cliente", fatos, conserto: null };
  }
  const quando = rotuloLocal(new Date(ultimaDoCliente), entrada.fuso);
  fatos.push(`A última mensagem do cliente chegou ${quando}.`);

  const { data: saidasBrutas } = await db
    .from("messages")
    .select("sent_at, sent_via, sent_by_user_id")
    .eq("organization_id", org)
    .eq("conversation_id", conversa.id)
    .eq("direction", "outbound")
    .gte("sent_at", ultimaDoCliente)
    .order("sent_at", { ascending: true })
    .limit(5);
  const saidas = (saidasBrutas ?? []) as Array<{ sent_at: string; sent_via: string; sent_by_user_id: string | null }>;
  const daIa = saidas.find((s) => s.sent_via === "ai");
  if (daIa) {
    fatos.push(`A IA respondeu ${rotuloLocal(new Date(daIa.sent_at), entrada.fuso)}.`);
    return { ...base, mensagem_do_cliente_em: ultimaDoCliente, motivo: "ia_respondeu", fatos, conserto: null };
  }
  const dePessoa = saidas.find((s) => s.sent_by_user_id);
  if (dePessoa) {
    fatos.push(
      `${nomeDaPessoa(entrada.equipe, dePessoa.sent_by_user_id)} respondeu ${rotuloLocal(new Date(dePessoa.sent_at), entrada.fuso)}.`,
    );
  }

  const resposta = (motivo: MotivoDoSilencio, conserto: string | null): ExplicacaoDoSilencio => ({
    ...base,
    mensagem_do_cliente_em: ultimaDoCliente,
    motivo,
    fatos,
    conserto,
  });

  // 1 · pediu para parar
  const { data: contatoBruto } = await db
    .from("contacts")
    .select("is_blocked, phone_number, ai_authorized_at")
    .eq("organization_id", org)
    .eq("id", conversa.contact_id)
    .maybeSingle();
  const contatoLido = contatoBruto as {
    is_blocked?: boolean;
    phone_number?: string | null;
    ai_authorized_at?: string | null;
  } | null;
  if (contatoLido?.is_blocked) {
    fatos.push("O contato pediu para parar de receber mensagens, e o sistema respeita o pedido.");
    return resposta("pediu_para_parar", "Só o próprio contato desfaz o pedido, voltando a falar com a empresa.");
  }

  // 2 · com alguém da equipe
  if (conversa.comando_da_conversa === "humano" || (conversa.assigned_to_user_id && conversa.comando_da_conversa !== "automatico")) {
    const quem = nomeDaPessoa(entrada.equipe, conversa.assigned_to_user_id) ?? "alguém da equipe";
    const desde = conversa.assigned_at ? ` desde ${rotuloLocal(new Date(conversa.assigned_at), entrada.fuso)}` : "";
    fatos.push(`A conversa está com ${quem}${desde}. Enquanto alguém da equipe está com a conversa, a IA fica calada.`);
    return resposta("conversa_com_a_equipe", "Responder o cliente ou devolver a conversa para a IA, no cabeçalho da conversa.");
  }

  // 3 · número desconectado
  let s: {
    status?: string;
    display_name?: string | null;
    last_status_change_at?: string | null;
    metadata?: unknown;
  } | null = null;
  if (conversa.channel_session_id) {
    const { data: sessao } = await db
      .from("channel_sessions")
      .select("status, display_name, last_status_change_at, metadata")
      .eq("organization_id", org)
      .eq("id", conversa.channel_session_id)
      .maybeSingle();
    s = sessao as typeof s;
    if (s && s.status && s.status !== "WORKING") {
      const desde = s.last_status_change_at ? ` desde ${rotuloLocal(new Date(s.last_status_change_at), entrada.fuso)}` : "";
      fatos.push(`O número${s.display_name ? ` "${s.display_name}"` : ""} está desconectado${desde}.`);
      return resposta("numero_desconectado", "Reconectar o número em Conexões (só o administrador conecta).");
    }
  }

  // 4 · o agente que responde esta conversa (a régua do motor)
  const { data: agentesBrutos } = await db
    .from("ai_agents")
    .select("id, name, priority, created_at, paused_at, published_version_id")
    .eq("organization_id", org)
    .is("archived_at", null)
    .not("published_version_id", "is", null);
  const agentes = (agentesBrutos ?? []) as Array<{
    id: string;
    name: string;
    priority: number | null;
    created_at: string;
    paused_at: string | null;
    published_version_id: string;
  }>;
  const versoesIds = agentes.map((a) => a.published_version_id);
  const { data: versoesBrutas } = versoesIds.length
    ? await db
        .from("ai_agent_versions")
        .select("id, channel_session_id, trigger_config")
        .eq("organization_id", org)
        .in("id", versoesIds)
    : { data: [] };
  const versoes = (versoesBrutas ?? []) as Array<{ id: string; channel_session_id: string | null; trigger_config: unknown }>;
  const versaoDe = (id: string) => versoes.find((v) => v.id === id) ?? null;
  const doNumero = agentes
    .filter((a) => conversa.channel_session_id && versaoDe(a.published_version_id)?.channel_session_id === conversa.channel_session_id)
    .sort((a, b) => {
      const pausa = (a.paused_at ? 1 : 0) - (b.paused_at ? 1 : 0);
      if (pausa !== 0) return pausa;
      const prio = (b.priority ?? 0) - (a.priority ?? 0);
      return prio !== 0 ? prio : a.created_at.localeCompare(b.created_at);
    });
  const agente =
    (conversa.active_ai_agent_id ? agentes.find((a) => a.id === conversa.active_ai_agent_id) : undefined) ?? doNumero[0] ?? null;
  if (!agente) {
    fatos.push("Não há agente de IA publicado neste número.");
    return resposta("sem_agente_no_ar", "Publicar um agente para o número em Agentes.");
  }
  if (agente.paused_at) {
    fatos.push(`O agente "${agente.name}" está pausado.`);
    return resposta("agente_pausado", "Retomar o agente em Agentes.");
  }

  // 4b · FORK MIA (.107): o gate do número (modo de teste ou lista de
  // autorização). A mesma leitura de `lib/ai/elegibilidade/gate.ts`: no modo de
  // teste só a lista do número passa; no allowlist, só o contato autorizado e
  // dentro da validade. Vem antes do silêncio: com o gate fechado a IA não
  // responderia nem depois de o silêncio acabar.
  const nomeDoNumero = s?.display_name ? ` "${s.display_name}"` : "";
  const modoDeAcesso = lerModoDeAcessoDaIa(s?.metadata);
  if (modoDeAcesso === "pre_go_live" && !numeroPodeTestar(contatoLido?.phone_number, lerNumerosDeTeste(s?.metadata))) {
    fatos.push(
      `O número${nomeDoNumero} está em modo de teste: a IA só responde os telefones da lista de teste dele, e o deste contato não está na lista.`,
    );
    return resposta(
      "numero_em_teste",
      "Para a IA atender todo mundo, ou para pôr este telefone na lista de teste: Conexões › o número › Configurar acesso da IA.",
    );
  }
  if (modoDeAcesso === "allowlist") {
    const autorizadoEm = contatoLido?.ai_authorized_at ? new Date(contatoLido.ai_authorized_at).getTime() : NaN;
    const valida = Number.isFinite(autorizadoEm) && agora.getTime() - autorizadoEm <= ttlDaAutorizacaoMs(process.env);
    if (!valida) {
      fatos.push(
        `O número${nomeDoNumero} só deixa a IA responder contatos autorizados (formulário, campanha, automação ou devolução pela tela), e este contato não está autorizado${contatoLido?.ai_authorized_at ? " (a autorização venceu)" : ""}.`,
      );
      return resposta(
        "contato_sem_autorizacao",
        "Devolver a conversa para a IA no cabeçalho da conversa autoriza o contato; para abrir o número a todos: Conexões › o número › Configurar acesso da IA.",
      );
    }
  }

  // 5 · fora do horário da IA (.85), no instante em que a mensagem chegou
  const horario = lerHorarioDaIa(versaoDe(agente.published_version_id)?.trigger_config);
  if (horario && !ativaEm(horario, new Date(ultimaDoCliente))) {
    fatos.push(`A mensagem chegou fora do horário de atendimento da IA do agente "${agente.name}": com a IA inativa, ela não responde, nem depois.`);
    return resposta("fora_do_horario_da_ia", "Alguém da equipe responde; para mudar o horário, Agentes › Horário de atendimento da IA.");
  }

  // 7 · o registro do que a IA fez nesta mensagem (lido antes do 6: FORK MIA .107)
  const { data: tracosBrutos } = await db
    .from("agent_turn_traces")
    .select("status, abort_reason, error_code, messages_sent, created_at")
    .eq("organization_id", org)
    .eq("conversation_id", conversa.id)
    .eq("is_dry_run", false)
    .gte("created_at", ultimaDoCliente)
    .order("created_at", { ascending: false })
    .limit(3);
  const traco = ((tracosBrutos ?? []) as Array<{
    status: string;
    abort_reason: string | null;
    error_code: string | null;
    messages_sent: number;
  }>)[0];

  // 6 · a IA silenciada nesta conversa. FORK MIA (.107): `infinity` (handoff,
  // pausa) é silêncio em vigor; e o silêncio que JÁ ACABOU sem turno nenhum
  // depois da mensagem é o defeito da .107, dito com todas as letras.
  const silencioAte = normalizarInstante(conversa.bot_silenced_until);
  const silencioMs = silencioAte === null ? null : typeof silencioAte === "number" ? silencioAte : silencioAte.getTime();
  if (silencioMs !== null && silencioMs > new Date(ultimaDoCliente).getTime()) {
    if (silencioMs > agora.getTime()) {
      fatos.push(
        Number.isFinite(silencioMs)
          ? `A IA está silenciada nesta conversa até ${rotuloLocal(new Date(silencioMs), entrada.fuso)}.`
          : "A IA está pausada nesta conversa até alguém devolver a conversa para ela.",
      );
      return resposta("ia_silenciada", "Devolver a conversa para a IA no cabeçalho da conversa.");
    }
    if (!traco) {
      fatos.push(
        `A mensagem chegou com a IA silenciada nesta conversa, porque alguém da equipe tinha respondido pela tela ou pelo celular. O silêncio acabou ${rotuloLocal(new Date(silencioMs), entrada.fuso)} e a IA não respondeu depois: até a versão .106, ela só voltava a falar quando chegava mensagem nova do cliente.`,
      );
      fatos.push(
        `A partir desta versão (.107), a IA responde sozinha quando o silêncio acaba, se a mensagem do cliente tiver chegado há até ${Math.round(JANELA_DA_MENSAGEM_PENDENTE_MS / 60_000)} minutos. Ela também responde na hora quando alguém devolve a conversa para ela.`,
      );
      return resposta(
        "silencio_acabou_sem_resposta",
        "Responder o cliente pelo Inbox agora; nas próximas vezes, a IA responde sozinha quando o silêncio acaba.",
      );
    }
  }

  if (traco && traco.status !== "completed") {
    fatos.push(
      traco.status === "failed"
        ? `A IA tentou responder e o turno falhou${traco.error_code ? ` (${traco.error_code})` : ""}.`
        : `O turno da IA foi interrompido${traco.abort_reason ? ` (${traco.abort_reason})` : ""}.`,
    );
    return resposta("turno_falhou", "Ver o detalhe em Execuções; se repetir, abrir um chamado para a Time.");
  }
  if (traco && traco.messages_sent === 0) {
    fatos.push("A IA leu a mensagem e decidiu não enviar nada naquele turno.");
    return resposta("turno_sem_envio", "Responder o cliente pelo Inbox; se parecer errado, abrir um chamado para a Time.");
  }

  fatos.push("Não achei, no registro do que a IA fez, o motivo de ela não ter respondido.");
  return resposta("nao_encontrado", null);
}

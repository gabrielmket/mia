/**
 * FORK MIA (.107) · A IA CALADA POR OUTRA CONVERSA DO CONTATO, E VISÍVEL.
 *
 * ## A decisão (dono do produto, 10/11/2026): "calada em todos, mas avisando"
 *
 * Se uma pessoa assumiu QUALQUER conversa do contato, a IA se cala em todos os
 * números da empresa. Isso protege o cliente que fala com dois números
 * (pré-atendimento com IA e comercial com gente): ele não recebe a IA num número
 * enquanto negocia com o vendedor no outro. A regra é a do upstream e não muda:
 * `isLeadInHandoff` (`lib/agent-engine/agent/human-handoff.ts`) conta o silêncio
 * de toda conversa do contato, e "Assumir" grava `bot_silenced_until =
 * 'infinity'` na conversa assumida (`fn_conversation_assign`).
 *
 * ## O defeito era não dizer (o 2º caso de 09/11)
 *
 * A mensagem chegou no número da IA, sem silêncio na conversa, sem pessoa e com
 * o gate aberto. A tela mostrava "Automático" (`comandoDaConversa` é por
 * conversa), o drain enfileirava (o gate também é por conversa) e o turno
 * voltava em `inbound-turn.ts` com uma linha de log e mais nada: nenhum
 * registro em `agent_turn_traces`, nenhum aviso, e o assistente respondia "não
 * achei o motivo".
 *
 * ## O que este arquivo faz
 *
 * Só NOMEIA a outra conversa: quem está com ela, em que número e desde quando.
 * A decisão de pular continua sendo `isLeadInHandoff`, e nada aqui decide se a
 * IA fala. Os três leitores:
 *
 *   - o turno (`registrarPausaPorOutraConversa`): grava o rastro em
 *     `agent_turn_traces` (`status = 'aborted'`, `abort_reason =
 *     MOTIVO_DA_PAUSA_POR_OUTRA_CONVERSA`), que a tela de Execuções
 *     (`/api/v1/ai/turn-traces`) e o assistente já leem, e um log estruturado.
 *     Sem migration: a tabela já aceita `aborted` com motivo;
 *   - o assistente e a faixa do cabeçalho da conversa
 *     (`lerOutraConversaComPessoaViaSupabase`), pelo cliente da sessão: a
 *     pessoa só vê a outra conversa se o Inbox a mostraria a ela.
 */
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

import { montarTracoDoTurno, registrarTracoDoTurno } from "@/lib/agent-engine/agent/traco-do-turno";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { sqlContatoInterno } from "@/lib/contacts/tags-internas";

/** O `abort_reason` do rastro, e o motivo do assistente. */
export const MOTIVO_DA_PAUSA_POR_OUTRA_CONVERSA = "contato_com_pessoa_em_outra_conversa";

export interface OutraConversaComPessoa {
  conversationId: string;
  /** Quem está com ela; `null` quando a conversa está calada sem dono (pausa, handoff na fila). */
  pessoaId: string | null;
  pessoaNome: string | null;
  /** O nome do número da outra conversa (`channel_sessions.display_name`). */
  numeroNome: string | null;
  /** Desde quando: quem assumiu, senão a passagem, senão a última troca de estado. */
  desde: string | null;
}

interface LinhaDaOutraConversa {
  id: string;
  assigned_to_user_id: string | null;
  assigned_to_user_name: string | null;
  desde: string | Date | null;
  numero: string | null;
}

function comoIso(valor: string | Date | null | undefined): string | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A outra conversa que cala o turno desta, pelo pool do worker.
 *
 * Devolve algo só quando ELA é a causa: o contato não está com `force_human`,
 * `ai_opt_out` nem etiqueta de contato interno (a mesma forma SQL que
 * `isLeadInHandoff` usa, `sqlContatoInterno`), e esta conversa não está calada
 * por si. Com uma pessoa dona, ela vem primeiro.
 */
export async function lerOutraConversaComPessoa(
  pool: Pick<pg.Pool, "query">,
  alvo: { organizationId: string; contactId: string; conversationId: string },
): Promise<OutraConversaComPessoa | null> {
  const { rows } = await pool.query<LinhaDaOutraConversa>(
    `select o.id, o.assigned_to_user_id, o.assigned_to_user_name,
            coalesce(o.assigned_at, o.last_handoff_at, o.status_changed_at) as desde,
            s.display_name as numero
       from conversations o
       join contacts c on c.organization_id = o.organization_id and c.id = o.contact_id
       left join channel_sessions s on s.organization_id = o.organization_id and s.id = o.channel_session_id
      where o.organization_id = $1 and o.contact_id = $2 and o.id <> $3
        and o.bot_silenced_until is not null and o.bot_silenced_until > now()
        and not c.force_human and not c.ai_opt_out
        and not ${sqlContatoInterno("c")}
        and not exists (
          select 1 from conversations a
           where a.organization_id = $1 and a.id = $3
             and a.bot_silenced_until is not null and a.bot_silenced_until > now()
        )
      order by (o.assigned_to_user_id is not null) desc, o.assigned_at desc nulls last, o.id
      limit 1`,
    [alvo.organizationId, alvo.contactId, alvo.conversationId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    conversationId: r.id,
    pessoaId: r.assigned_to_user_id,
    pessoaNome: r.assigned_to_user_name,
    numeroNome: r.numero,
    desde: comoIso(r.desde),
  };
}

/**
 * Chamada pelo turno de mensagem DEPOIS de `isLeadInHandoff` dizer que pula.
 * Quando a causa é outra conversa, grava o rastro do turno e o log estruturado.
 * Nunca lança: o turno já ia voltar sem responder, e o rastro é melhor-esforço.
 */
export async function registrarPausaPorOutraConversa(
  pool: pg.Pool,
  alvo: { organizationId: string; jobId: string; contactId: string; conversationId: string },
  log?: Logger,
): Promise<OutraConversaComPessoa | null> {
  try {
    const outra = await lerOutraConversaComPessoa(pool, alvo);
    if (!outra) return null;
    log?.info("turno pulado — o contato está com uma pessoa em outra conversa", {
      job_id: alvo.jobId,
      conversation_id: alvo.conversationId,
      outra_conversation_id: outra.conversationId,
      com_pessoa: outra.pessoaId !== null,
      motivo: MOTIVO_DA_PAUSA_POR_OUTRA_CONVERSA,
    });
    await registrarTracoDoTurno(
      pool,
      montarTracoDoTurno({
        organizationId: alvo.organizationId,
        jobId: alvo.jobId,
        previewRunId: null,
        conversationId: alvo.conversationId,
        contactId: alvo.contactId,
        agentId: null,
        agentVersionId: null,
        isDryRun: false,
        status: "aborted",
        abortReason: MOTIVO_DA_PAUSA_POR_OUTRA_CONVERSA,
        errorCode: null,
        errorMessage: null,
        provider: null,
        model: null,
        messagesSent: 0,
        historicoMensagens: null,
        knowledgeSourceIds: [],
        ferramentas: [],
      }),
      log,
    );
    return outra;
  } catch (erro) {
    log?.warn("rastro da pausa por outra conversa não gravado", {
      job_id: alvo.jobId,
      error: (erro instanceof Error ? erro.message : String(erro)).slice(0, 160),
    });
    return null;
  }
}

/**
 * A mesma pergunta pelo supabase-js, para o assistente e a faixa da tela. Com o
 * cliente da SESSÃO, a RLS de `conversations` decide se a pessoa vê a outra
 * conversa: quem não a veria no Inbox não a vê aqui. Quem chama já sabe que
 * esta conversa está em "Automático" (sem silêncio próprio, sem trava no contato).
 */
export async function lerOutraConversaComPessoaViaSupabase(
  db: Pick<SupabaseClient, "from">,
  alvo: { organizationId: string; contactId: string; conversationId: string; agora?: Date },
): Promise<OutraConversaComPessoa | null> {
  const agora = (alvo.agora ?? new Date()).toISOString();
  const { data, error } = await db
    .from("conversations")
    .select("id, assigned_to_user_id, assigned_to_user_name, assigned_at, last_handoff_at, status_changed_at, channel_session_id")
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .neq("id", alvo.conversationId)
    .gt("bot_silenced_until", agora)
    .order("assigned_at", { ascending: false, nullsFirst: false })
    .limit(5);
  if (error) throw new Error(`outra conversa: ${error.message}`);
  const linhas = (data ?? []) as Array<{
    id: string;
    assigned_to_user_id: string | null;
    assigned_to_user_name: string | null;
    assigned_at: string | null;
    last_handoff_at: string | null;
    status_changed_at: string | null;
    channel_session_id: string | null;
  }>;
  const escolhida = linhas.find((l) => l.assigned_to_user_id !== null) ?? linhas[0];
  if (!escolhida) return null;
  let numeroNome: string | null = null;
  if (escolhida.channel_session_id) {
    const { data: numero } = await db
      .from("channel_sessions")
      .select("display_name")
      .eq("organization_id", alvo.organizationId)
      .eq("id", escolhida.channel_session_id)
      .maybeSingle();
    numeroNome = (numero as { display_name?: string | null } | null)?.display_name ?? null;
  }
  return {
    conversationId: escolhida.id,
    pessoaId: escolhida.assigned_to_user_id,
    pessoaNome: escolhida.assigned_to_user_name,
    numeroNome,
    desde: comoIso(escolhida.assigned_at ?? escolhida.last_handoff_at ?? escolhida.status_changed_at),
  };
}

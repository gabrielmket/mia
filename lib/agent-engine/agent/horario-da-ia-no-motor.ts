/**
 * FORK MIA (.85) — a FIAÇÃO de produção do horário da IA no motor.
 *
 * A decisão mora em `horario-da-ia-no-turno.ts` (sem banco); aqui as portas
 * dela ganham as leituras e os efeitos de verdade, com os MESMOS mecanismos do
 * turno do upstream: o contexto do lead (`getLeadContext`), o que o cliente
 * disse e ninguém respondeu (`inboundsNaoRespondidos`), a detecção de opt-out
 * provável e a passagem durável (`performHumanHandoff`).
 *
 * Os pontos de ligação no código do upstream, todos marcados `FORK MIA (.85)`:
 *
 *   - `inbound-turn.ts`, `createInboundTurnHandler`: depois de escolher o
 *     agente e antes do ramo assistido, `encerrarTurnoSeIaInativa`;
 *   - `inbound-turn.ts`, `executarTurnoDoAgente`: o retorno prometido
 *     (`followup_turn` sem régua) espera a próxima abertura;
 *   - `followup-turn.ts`: o toque da régua (escrito pela IA ou texto fixo pelo
 *     worker) espera a próxima abertura, ao lado da faixa própria do follow-up;
 *   - `lib/followup/janela-de-disparo.ts`: a terceira régua do atalho do texto
 *     fixo (`lib/followup/horario-da-ia-da-regua.ts`);
 *   - `agent-config.ts`: o horário lido da versão publicada, e o
 *     `business_hours` ignorado quando o nosso existe.
 */
import type pg from "pg";

import { montarBriefingDaPassagem } from "@/lib/escalacao/briefing-da-passagem";

import { cancelPendingCronsForLead } from "../cron/scheduler";
import { getLeadContext } from "../edge/crm/get-lead-context";
import { withFields } from "../obs/logger";
import type { JobRow, Queryable } from "../queue/queue";
import type { PublishedAgentConfig } from "./agent-config";
import { fusoDaOrganizacao } from "./fuso-da-org";
import { lerHorarioDaIa, type HorarioDaIa } from "./horario-da-ia";
import { turnoTerminaComIaInativa } from "./horario-da-ia-no-turno";
import { detectAmbiguousOptOut, performHumanHandoff } from "./human-handoff";
import {
  inboundsNaoRespondidos,
  latestCheckpoint,
  loadInboundBodyForJob,
  type InboundTurnDeps,
} from "./inbound-turn";

/**
 * O instante em que a mensagem fixada no job CHEGOU. O recorte é o de
 * `loadInboundBodyForJob` (organização, conversa, id e direção inbound): um id
 * de outra conversa, ou uma outbound, não vira "a mensagem atual".
 */
export async function instanteDaMensagem(
  db: Queryable,
  input: { tenantId: string; conversationId: string; inboundMessageId: string },
): Promise<Date | null> {
  const { rows } = await db.query<{ created_at: Date | string | null }>(
    `select created_at
       from messages
      where organization_id = $1
        and conversation_id = $2
        and id = $3
        and direction = 'inbound'
      limit 1`,
    [input.tenantId, input.conversationId, input.inboundMessageId],
  );
  const bruto = rows[0]?.created_at ?? null;
  if (bruto === null) return null;
  const instante = bruto instanceof Date ? bruto : new Date(bruto);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

/**
 * O turno inbound termina aqui? `true` = a IA estava inativa quando a mensagem
 * chegou: nada é enviado, nada é reagendado, e o pedido de parar (se houver)
 * já foi registrado sem mensagem automática.
 */
export async function encerrarTurnoSeIaInativa(
  pool: pg.Pool,
  deps: InboundTurnDeps,
  args: {
    job: JobRow;
    agent: PublishedAgentConfig;
    conversationId: string;
    inboundMessageId: string;
  },
): Promise<boolean> {
  const { job, agent, conversationId } = args;
  const tenantId = job.organization_id;
  const leadId = job.contact_id;
  if (leadId === null || !agent.horarioDaIa) return false;
  const log = withFields(deps.log, { job_id: job.id, tenant_id: tenantId, lead_id: leadId });
  const clock = deps.clock ?? ((): Date => new Date());

  return turnoTerminaComIaInativa({
    horario: agent.horarioDaIa,
    agora: clock(),
    agentId: agent.agentId,
    log,
    portas: {
      instanteDaMensagem: () =>
        instanteDaMensagem(pool, { tenantId, conversationId, inboundMessageId: args.inboundMessageId }),
      // A MESMA fonte do turno e do ramo assistido: o que o cliente disse desde
      // a última resposta (de pessoa ou da IA), não só a última linha. Sem o
      // contexto, a mensagem fixada no job é o plano B.
      lerPendentes: async () => {
        try {
          const contexto = await getLeadContext(
            pool,
            deps.crmCfg,
            { tenantId, leadId, conversationId, fuso: await fusoDaOrganizacao(pool, tenantId, log) },
            { historyLimit: agent.historyMessageWindow, maxTokens: agent.historyTokenWindow },
          );
          if (contexto.ok) {
            return {
              textos: inboundsNaoRespondidos(contexto.context.messages),
              bloqueado: contexto.context.contact.is_blocked,
            };
          }
          log.warn("horário da IA: contexto do lead não lido — a detecção cai na mensagem fixada", {
            code: contexto.error.code,
          });
        } catch (err) {
          log.warn("horário da IA: contexto do lead falhou — a detecção cai na mensagem fixada", {
            error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
          });
        }
        const fixada = await loadInboundBodyForJob(pool, {
          tenantId,
          conversationId,
          inboundMessageId: args.inboundMessageId,
        });
        return { textos: fixada && fixada.trim() !== "" ? [fixada] : [], bloqueado: false };
      },
      pedidoDeParar: detectAmbiguousOptOut,
      // O registro do turno ativo, sem `avisarLeadDaEscalacao`: com a IA
      // inativa nenhuma mensagem automática sai (a conversa é da equipe).
      registrarPedidoDeParar: async (pendentes) => {
        const briefing = montarBriefingDaPassagem({
          checkpoint: await latestCheckpoint(pool, tenantId, leadId),
          pendentesDoCliente: pendentes,
          motivo: { codigo: "suspected_optout" },
        });
        await performHumanHandoff(
          pool,
          { tenantId, leadId, conversationId },
          {
            reason: "suspected_optout",
            conversationSummary: briefing.body,
            inboxTitle: "Suspeita de opt-out — confirmar bloqueio do contato no CRM",
            passagem: { origem: "opt_out_provavel", motivoCodigo: "suspected_optout", briefing },
            log,
          },
        );
      },
      cancelarFollowups: () => cancelPendingCronsForLead(pool, tenantId, leadId),
    },
  });
}

/**
 * O horário da IA do agente pinado na inscrição da régua, pela versão
 * PUBLICADA atual dele: o par de `followupPublicadoDoEnrollment`
 * (`janela-de-followup.ts`), mesmas junções. Publicar um horário novo vale
 * para os próximos toques sem reescrever inscrições em voo.
 *
 * Sem agente ou sem versão publicada (dado legado) = `null`, sem horário.
 * Erro de banco SOBE, como lá: toque de follow-up é contato proativo, e sem
 * saber se a IA está ativa é mais seguro tentar de novo do que falar por cima
 * da equipe.
 */
export async function horarioDaIaDoEnrollment(
  db: Queryable,
  organizationId: string,
  enrollmentId: string,
): Promise<HorarioDaIa | null> {
  const { rows } = await db.query<{ trigger_config: unknown | null }>(
    `select v.trigger_config
       from followup_enrollments e
       left join ai_agents a
         on a.organization_id = e.organization_id
        and a.id = e.agent_id
       left join ai_agent_versions v
         on v.organization_id = e.organization_id
        and v.id = a.published_version_id
      where e.organization_id = $1
        and e.id = $2
      limit 1`,
    [organizationId, enrollmentId],
  );
  return lerHorarioDaIa(rows[0]?.trigger_config ?? null);
}

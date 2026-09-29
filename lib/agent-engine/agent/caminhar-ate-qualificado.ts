/**
 * FORK MIA — caminhar a máquina do funil do agente até `qualified`, um passo
 * válido por vez, com o espelho no card a cada avanço.
 *
 * Existe porque DOIS caminhos da passagem ao comercial precisam dele, e dois
 * laços escritos à mão divergiriam no primeiro conserto:
 *  - a ferramenta `crm_passar_para_o_comercial` (`lib/mcp/tools/passar-para-o-comercial.ts`);
 *  - a rede de segurança da passagem prometida (`./passagem-prometida-no-turno.ts`).
 *
 * É o MESMO efeito de o modelo chamar `update_lead_state` passo a passo no
 * turno (`inbound-turn.ts`): `applyLeadStateUpdate` grava a transição com o job
 * e a evidência, e `mirrorLeadStageToCrm` move o card e emite
 * `lead.stage_changed`; recusa do espelho vira aviso na Central pela mesma
 * `abreAvisoDoEspelhoRecusado`. Nenhum salto: o caminho é conferido contra o
 * grafo da máquina antes do primeiro passo.
 */
import type pg from "pg";

import type { Queryable } from "../queue/queue";
import { mirrorLeadStageToCrm, abreAvisoDoEspelhoRecusado } from "../edge/crm/move-lead-stage";
import type { CrmEdgeConfig } from "../edge/crm/mcp-client";
import { applyLeadStateUpdate, getLeadState, LEAD_STAGE_TRANSITIONS, type LeadStage } from "./lead-state";

/** O caminho da máquina até a passagem — só passos válidos, nunca salto. */
const CAMINHO_ATE_QUALIFICADO: readonly LeadStage[] = ["new", "contacted", "qualifying", "qualified"];

/** Etapas em que a passagem já aconteceu (ou o negócio já se encerrou). */
export const JA_PASSOU: ReadonlySet<LeadStage> = new Set<LeadStage>(["qualified", "negotiating", "won", "lost"]);

/**
 * Os passos que faltam, do estágio atual até `qualified`, conferidos contra o
 * grafo — se o grafo mudar e o caminho deixar de ser válido, devolve `null` e
 * quem chama recusa, em vez de tentar um salto.
 */
export function passosAteQualificado(atual: LeadStage): LeadStage[] | null {
  const i = CAMINHO_ATE_QUALIFICADO.indexOf(atual);
  if (i === -1) return null;
  const passos = CAMINHO_ATE_QUALIFICADO.slice(i + 1);
  let de = atual;
  for (const para of passos) {
    if (!LEAD_STAGE_TRANSITIONS[de].includes(para)) return null;
    de = para;
  }
  return passos;
}

export type ResultadoDoCaminho =
  | { ok: true; de: LeadStage; etapas: LeadStage[]; card: Array<{ etapa: LeadStage; moveu: boolean; motivo?: string }> }
  | { ok: false; motivo: "ja_passou"; ja_estava: LeadStage }
  | { ok: false; motivo: "caminho_invalido"; ja_estava: LeadStage }
  | {
      ok: false;
      motivo: "maquina_recusou";
      passo: LeadStage;
      mensagem: string;
      card: Array<{ etapa: LeadStage; moveu: boolean; motivo?: string }>;
    };

/** Onde está o funil do agente para este contato, e se ainda falta passar. */
export async function estagioAtual(db: Queryable, tenantId: string, contactId: string): Promise<LeadStage> {
  return (await getLeadState(db, tenantId, contactId))?.stage ?? "new";
}

export async function caminharAteQualificado(
  db: Pick<pg.Pool, "query">,
  cfg: CrmEdgeConfig,
  ids: { tenantId: string; contactId: string; jobId: string | null },
  entrada: {
    motivo: string;
    qualificacao?: { budget?: string; authority?: string; need?: string; timeline?: string };
    proximaAcao?: string;
  },
): Promise<ResultadoDoCaminho> {
  const atual = await estagioAtual(db, ids.tenantId, ids.contactId);
  if (JA_PASSOU.has(atual)) return { ok: false, motivo: "ja_passou", ja_estava: atual };
  const passos = passosAteQualificado(atual);
  if (!passos) return { ok: false, motivo: "caminho_invalido", ja_estava: atual };

  const card: Array<{ etapa: LeadStage; moveu: boolean; motivo?: string }> = [];
  for (const [i, passo] of passos.entries()) {
    const ultimo = i === passos.length - 1;
    const r = await applyLeadStateUpdate(
      db,
      { tenantId: ids.tenantId, leadId: ids.contactId, jobId: ids.jobId },
      {
        stage: passo,
        reason: entrada.motivo,
        ...(ultimo && entrada.qualificacao ? { qualification: entrada.qualificacao } : {}),
        ...(ultimo && entrada.proximaAcao !== undefined ? { next_action: entrada.proximaAcao } : {}),
      },
    );
    if (!r.ok) return { ok: false, motivo: "maquina_recusou", passo, mensagem: r.error.message, card };
    if (r.transition === null) continue;
    const espelho = await mirrorLeadStageToCrm(db, cfg, {
      tenantId: ids.tenantId,
      leadId: ids.contactId,
      toStage: r.transition.to,
      reason: entrada.motivo,
    });
    if (espelho.ok) {
      card.push({ etapa: r.transition.to, moveu: true });
    } else {
      card.push({ etapa: r.transition.to, moveu: false, motivo: espelho.reason });
      await abreAvisoDoEspelhoRecusado(db, ids.tenantId, {
        leadId: ids.contactId,
        motivo: espelho.reason,
        detalhe: espelho.detail,
        etapaDeDestino: r.transition.to,
      });
    }
  }
  return { ok: true, de: atual, etapas: passos, card };
}

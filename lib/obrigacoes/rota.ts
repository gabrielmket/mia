/**
 * FORK MIA — OBRIGAÇÕES · o que TODA rota de `/api/v1/obrigacoes` faz igual.
 *
 * Papel conferido, organização do cookie (nunca do corpo), o cliente da SESSÃO
 * (a RLS decide o que a pessoa vê e grava), o "hoje" do fuso da empresa e a
 * tradução das recusas do domínio para o envelope da API. A trava do suporte
 * somente leitura (`requireSupportWrite`) fica na própria rota, na primeira
 * linha de cada escrita: a cerca `suporte-cobertura-de-efeitos` lê lá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { avisarDocumentoRecebido } from "./avisos";
import { diaNoFuso, type Dia } from "./datas";
import { ErroDeObrigacao, type ContextoDaOperacao } from "./operacoes";
import type { Obrigacao } from "./tipos";

export interface RotaDeObrigacao {
  ctx: ContextoDaOperacao;
  supabase: SupabaseClient;
  /** O cliente de serviço, para o arquivo e para os avisos. `null` sem a chave de serviço. */
  admin: SupabaseClient | null;
  orgId: string;
  userId: string;
  hoje: Dia;
  requestId: string;
  t: (texto: string) => string;
}

/** Confere o papel e monta o contexto. `papel` é o piso: `viewer` lê, `agent` grava, `manager` configura. */
export async function prepararRota(
  papel: Role,
  requestId: string,
): Promise<{ ok: false; resposta: Response } | ({ ok: true } & RotaDeObrigacao)> {
  const authz = await requireRole(papel, { requestId, resource: "mia_obrigacoes" });
  if (!authz.ok) return { ok: false, resposta: authz.response };
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const hoje = diaNoFuso(new Date(), authz.org.timezone ?? null);
  return {
    ok: true,
    ctx: { db: supabase, org: authz.org.orgId, ator: authz.user.id, hoje },
    supabase,
    admin: isServiceRoleConfigured() ? (createAdminClient() as unknown as SupabaseClient) : null,
    orgId: authz.org.orgId,
    userId: authz.user.id,
    hoje,
    requestId,
    t: (texto: string) => traduzir(texto, authz.user.idioma),
  };
}

const STATUS_DO_ERRO = { validacao: 422, nao_encontrado: 404, conflito: 409, interno: 500 } as const;
const CODIGO_DO_ERRO = {
  validacao: "validation_failed",
  nao_encontrado: "not_found",
  conflito: "conflict",
  interno: "internal_error",
} as const;

/** A recusa do domínio no envelope da API. Erro desconhecido vira 500 sem vazar a mensagem crua. */
export function respostaDoErro(err: unknown, rota: Pick<RotaDeObrigacao, "requestId" | "t">): Response {
  if (err instanceof ErroDeObrigacao) {
    return fail(CODIGO_DO_ERRO[err.codigo], rota.t(err.message), STATUS_DO_ERRO[err.codigo], { requestId: rota.requestId });
  }
  return fail("internal_error", rota.t("Não consegui concluir. Tente de novo em instantes."), 500, {
    requestId: rota.requestId,
  });
}

/**
 * O rastro de um ato sobre um item: a auditoria e, quando o item é de um
 * negócio, a linha na história dele. O metadata leva o TIPO e as datas, nunca
 * nome de pessoa nem o arquivo.
 */
export async function registrarAto(
  rota: RotaDeObrigacao,
  ato: { acao: AuditAction; item: Obrigacao; porque: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const { item } = ato;
  await audit({
    organizationId: rota.orgId,
    actorUserId: rota.userId,
    action: ato.acao,
    resourceType: "mia_obrigacoes",
    resourceId: item.id,
    requestId: rota.requestId,
    metadata: {
      nome: item.nome,
      categoria: item.categoria,
      ciclo: item.ciclo,
      ligado_a: { negocio: Boolean(item.lead_id), empresa: Boolean(item.empresa_id), contato: Boolean(item.contact_id) },
      ...(ato.metadata ?? {}),
    },
  });
  if (item.lead_id) {
    // Fire-and-forget quanto a erro: a história do negócio não pode derrubar o ato que ela descreve.
    await emitLeadActivity(rota.supabase, {
      organizationId: rota.orgId,
      leadId: item.lead_id,
      contactId: item.contact_id,
      type: "lead_edited",
      sourceModule: "obrigacoes",
      sourceId: item.id,
      actor: { type: "user", id: rota.userId },
      reason: `${ato.porque}: ${item.nome}`,
      payload: { fields: ["obrigacoes"], obrigacao_id: item.id, ato: ato.acao },
    }).catch(() => undefined);
  }
}

/** Depois de um recebimento confirmado por uma pessoa: avisa as regras de "documento recebido". */
export async function avisarRecebimento(rota: RotaDeObrigacao, item: Obrigacao): Promise<number> {
  if (!rota.admin) return 0;
  return avisarDocumentoRecebido(rota.admin, rota.orgId, item, rota.hoje);
}

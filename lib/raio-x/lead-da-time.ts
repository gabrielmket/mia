/**
 * FORK MIA (.107) · TODO CADASTRO DO RAIO-X VIRA LEAD NO CRM DA TIME COMPANY
 * (decisão 5 de 06/11/2026), para a Time montar o fluxo de acompanhamento.
 *
 * A Time já tem, no CRM dela dentro da MIA, a FONTE DE FORMULÁRIO "Site ·
 * pedido de Raio-X" (destino: funil "MIA - SDR" › "Novo contato"). O cadastro
 * entra por ela, pela MESMA lógica de qualquer formulário: a rota de captação
 * `app/api/v1/webhooks/in/[token]` é chamada POR DENTRO (no mesmo processo,
 * com o token e a assinatura da fonte), e não por uma cópia dela. Assim o lead
 * passa pelo mesmo caminho de sempre: o histórico de captação, a deduplicação
 * pelo `external_id`, a atribuição de anúncio (utm, gclid, fbclid), a
 * classificação inicial e os eventos que as automações da Time escutam. Não há
 * função em `lib/webhooks/` com esse processamento inteiro: ele mora no POST da
 * rota (1.400 linhas do upstream), e chamá-lo é o que não diverge na próxima
 * sincronização.
 *
 * A fonte vem de configuração: `RAIO_X_FONTE_DO_CRM` = o id da fonte. Sem ela,
 * o cadastro segue (nunca quebra), o log avisa e a conta fica marcada
 * (`crm_erro = 'sem_fonte'`), que o Admin mostra.
 *
 * O `external_id` é estável por conta (`raiox-conta-<id>`): o mesmo cadastro
 * repetido cai no mesmo negócio. O que muda depois (o relatório saiu, pediu nova
 * análise, pagou) vai por cima do negócio JÁ criado, pelo caminho que o CRM tem:
 * os campos do negócio (`fn_lead_anotar_campos`, o merge atômico) e uma nota na
 * linha do tempo (`crm_lead_activities`, tipo `note`). Nunca vai telefone de
 * cliente do dono: só os números somados do relatório e o link.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
// FORK MIA (MIA-168): o núcleo "chamar a fonte por dentro" é comum ao cadastro do /signup.
import {
  enviarAFonteDaTime,
  orgDaFonte,
  type DependenciasDaCaptacao,
  type MotivoSemLead,
  type ProcessarCaptacao,
  type ResultadoDaCaptacao,
} from "@/lib/time/captacao-na-time";

import type { CampoDeOrigem } from "./cadastro";
import { whatsappParaLer, type Segmento } from "./regras";
import { ROTULO_DO_SEGMENTO } from "./segmentos";

export const VARIAVEL_DA_FONTE = "RAIO_X_FONTE_DO_CRM";
export const ORIGEM_DO_LEAD = "raio-x-gratis";

/** A conta como o lead precisa dela. */
export interface ContaDoLead {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  crm_lead_id: string | null;
}

export interface RaioXDoLead {
  empresa: string;
  segmento: string;
  whatsapp: string;
  quem_atende?: string | null;
}

/** O id externo do negócio: um por conta, para o mesmo cadastro cair no mesmo card. */
export function idExternoDaConta(contaId: string): string {
  return `raiox-conta-${contaId}`;
}

/** O corpo do envio, como um formulário mandaria (as chaves que a fonte mapeia). */
export function corpoDoLead(conta: ContaDoLead, raioX: RaioXDoLead | null, origem: Partial<Record<CampoDeOrigem, string>> = {}, extras: Record<string, string> = {}): Record<string, string> {
  const corpo: Record<string, string> = {
    external_id: idExternoDaConta(conta.id),
    nome: conta.nome,
    // O WhatsApp da PESSOA: é com ela que a Time vai falar.
    telefone: `+${conta.telefone}`,
    email: conta.email,
    origem: ORIGEM_DO_LEAD,
  };
  if (raioX) {
    corpo.empresa = raioX.empresa;
    corpo.segmento = ROTULO_DO_SEGMENTO[raioX.segmento as Segmento] ?? raioX.segmento;
    // O número analisado é da EMPRESA (o comercial). Vai com nome próprio para
    // não ser lido como o telefone da pessoa (`whatsapp` é apelido de telefone).
    corpo.whatsapp_analisado = whatsappParaLer(raioX.whatsapp);
  }
  for (const [k, v] of Object.entries(origem)) {
    // A origem do site ("site", "instagram"…) fica em campo próprio: `origem` é a do lead.
    if (k === "origem") corpo.origem_do_site = v;
    else if (v) corpo[k] = v;
  }
  return { ...corpo, ...extras };
}

export type { MotivoSemLead, ProcessarCaptacao };

export type DependenciasDoLead = DependenciasDaCaptacao;

export type ResultadoDoLead = { ok: true; leadId: string; organizationId: string } | { ok: false; motivo: MotivoSemLead };

async function marcarConta(admin: SupabaseClient, contaId: string, valores: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("mia_raio_x_contas").update(valores).eq("id", contaId);
  if (error) logger.warn("[raio-x] a conta não guardou o lead", { contaId, codigo: error.code ?? "sem_codigo" });
}

/**
 * Manda o cadastro à fonte da Time (cria o negócio, ou cai no mesmo pelo
 * `external_id`). Nunca lança: o cadastro da pessoa não depende do CRM.
 */
export async function enviarAoCrm(
  admin: SupabaseClient,
  entrada: { conta: ContaDoLead; raioX: RaioXDoLead | null; origem?: Partial<Record<CampoDeOrigem, string>>; extras?: Record<string, string> },
  deps: DependenciasDoLead = {},
): Promise<ResultadoDoLead> {
  const base = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const r: ResultadoDaCaptacao = await enviarAFonteDaTime(
    admin,
    {
      variavel: VARIAVEL_DA_FONTE,
      corpo: corpoDoLead(entrada.conta, entrada.raioX, entrada.origem ?? {}, entrada.extras ?? {}),
      userAgent: "mia-raio-x/1",
      referer: base ? `${base}/raio-x/gratis` : null,
    },
    deps,
  );
  if (r.ok) {
    await marcarConta(admin, entrada.conta.id, { crm_lead_id: r.leadId, crm_enviado_em: new Date().toISOString(), crm_erro: null });
    return r;
  }
  if (r.motivo === "sem_fonte") logger.warn(`[raio-x] ${VARIAVEL_DA_FONTE} não configurada: o cadastro não virou lead no CRM da Time`, { contaId: entrada.conta.id });
  else if (r.motivo === "fonte_inexistente") logger.warn("[raio-x] a fonte do CRM da Time não existe ou está desligada", { contaId: entrada.conta.id });
  else if (r.motivo === "recusado") logger.warn("[raio-x] a fonte do CRM da Time recusou o cadastro", { contaId: entrada.conta.id, status: r.status });
  else logger.warn("[raio-x] o lead no CRM da Time falhou", { contaId: entrada.conta.id, detail: r.detalhe ?? "erro" });
  await marcarConta(admin, entrada.conta.id, { crm_erro: r.motivo });
  return { ok: false, motivo: r.motivo };
}

/**
 * O negócio da conta: o que JÁ existe (`crm_lead_id`) é usado como está, sem
 * mandar o cadastro de novo (o reenvio poderia reescrever o contato). Sem
 * negócio ainda (a fonte faltou antes, ou o negócio foi apagado), manda o
 * cadastro com os dados GUARDADOS da conta. Nunca lança.
 */
export async function garantirLead(
  admin: SupabaseClient,
  conta: ContaDoLead,
  raioX: RaioXDoLead | null,
  deps: DependenciasDoLead = {},
): Promise<ResultadoDoLead> {
  if (!conta.crm_lead_id) return enviarAoCrm(admin, { conta, raioX }, deps);
  const org = await orgDaFonte(admin, VARIAVEL_DA_FONTE, deps);
  if (!org.ok) return { ok: false, motivo: org.motivo };
  return { ok: true, leadId: conta.crm_lead_id, organizationId: org.organizationId };
}

/** Uma nota na linha do tempo do negócio, e nada mais (o contato não muda). Nunca lança. */
export async function notarNoLead(
  admin: SupabaseClient,
  entrada: { conta: ContaDoLead; raioXId?: string | null; nota: string },
  deps: DependenciasDoLead = {},
): Promise<ResultadoDoLead> {
  const lead = await garantirLead(admin, entrada.conta, null, deps);
  if (!lead.ok) return lead;
  try {
    await emitLeadActivity(admin, {
      organizationId: lead.organizationId,
      leadId: lead.leadId,
      type: "note",
      sourceModule: "raio_x",
      sourceId: entrada.raioXId ?? null,
      actor: { type: "api_token", id: "raio_x" },
      reason: entrada.nota.slice(0, 500),
    });
  } catch (erro) {
    logger.warn("[raio-x] a nota do lead falhou", { contaId: entrada.conta.id, detail: erro instanceof Error ? erro.message : "erro" });
  }
  return lead;
}

/**
 * O que acontece DEPOIS do cadastro vai por cima do negócio: os campos do
 * raio-X (merge atômico) e uma nota na linha do tempo. O contato do negócio não
 * é tocado (`garantirLead`). Nunca lança.
 */
export async function anotarNoLead(
  admin: SupabaseClient,
  entrada: { conta: ContaDoLead; raioX: RaioXDoLead | null; raioXId?: string | null; campos: Record<string, string | number | null>; nota: string },
  deps: DependenciasDoLead = {},
): Promise<ResultadoDoLead> {
  const enviado = await garantirLead(admin, entrada.conta, entrada.raioX, deps);
  if (!enviado.ok) return enviado;
  try {
    const { error } = await admin.rpc("fn_lead_anotar_campos", { p_org: enviado.organizationId, p_lead: enviado.leadId, p_campos: entrada.campos });
    if (error) logger.warn("[raio-x] os campos do lead não gravaram", { contaId: entrada.conta.id, codigo: error.code ?? "sem_codigo" });
    await emitLeadActivity(admin, {
      organizationId: enviado.organizationId,
      leadId: enviado.leadId,
      type: "note",
      sourceModule: "raio_x",
      sourceId: entrada.raioXId ?? null,
      actor: { type: "api_token", id: "raio_x" },
      reason: entrada.nota.slice(0, 500),
    });
    return enviado;
  } catch (erro) {
    logger.warn("[raio-x] a nota do lead falhou", { contaId: entrada.conta.id, detail: erro instanceof Error ? erro.message : "erro" });
    return enviado;
  }
}

/**
 * O aviso à Time na Central de avisos da organização dela (a mesma do lead),
 * com o botão "Abrir negócio". Nunca lança.
 */
export async function avisarNaCentralDaTime(
  admin: SupabaseClient,
  lead: { organizationId: string; leadId: string },
  aviso: { titulo: string; corpo: string },
): Promise<boolean> {
  try {
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: lead.organizationId,
      kind: "other",
      severity: "info",
      title: aviso.titulo.slice(0, 200),
      body: aviso.corpo.slice(0, 1000),
      ref_kind: "lead",
      ref_id: lead.leadId,
    });
    if (error) logger.warn("[raio-x] o aviso da Central da Time não gravou", { codigo: error.code ?? "sem_codigo" });
    return !error;
  } catch {
    return false;
  }
}

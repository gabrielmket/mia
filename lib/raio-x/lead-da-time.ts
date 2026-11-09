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

import { createHmac } from "node:crypto";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { HEADER_ASSINATURA_DE_ENTRADA } from "@/lib/webhooks/assinatura";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

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

/** Chama a rota de captação por dentro, com o pedido montado como o de um formulário. */
export type ProcessarCaptacao = (token: string, corpo: string, headers: Record<string, string>) => Promise<Response>;

const processarPelaRota: ProcessarCaptacao = async (token, corpo, headers) => {
  const [{ NextRequest }, rota] = await Promise.all([import("next/server"), import("@/app/api/v1/webhooks/in/[token]/route")]);
  const base = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost").replace(/\/+$/, "");
  const req = new NextRequest(`${base}/api/v1/webhooks/in/${encodeURIComponent(token)}`, { method: "POST", headers, body: corpo });
  return rota.POST(req, { params: Promise.resolve({ token }) });
};

export interface DependenciasDoLead {
  /** Para o teste: a fonte (sem ela, `RAIO_X_FONTE_DO_CRM`). `null` = sem fonte. */
  fonteId?: string | null;
  processar?: ProcessarCaptacao;
}

export type MotivoSemLead = "sem_fonte" | "fonte_inexistente" | "recusado" | "falhou";

export type ResultadoDoLead =
  | { ok: true; leadId: string; organizationId: string }
  | { ok: false; motivo: MotivoSemLead };

interface FonteDoCrm {
  id: string;
  organizationId: string;
  token: string;
  segredo: string | null;
}

function idDaFonte(deps: DependenciasDoLead): string | null {
  const bruto = deps.fonteId !== undefined ? deps.fonteId : process.env[VARIAVEL_DA_FONTE];
  const id = typeof bruto === "string" ? bruto.trim() : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function lerFonte(admin: SupabaseClient, id: string): Promise<FonteDoCrm | null> {
  const { data, error } = await admin
    .from("webhook_sources")
    .select("id, organization_id, path_token, secret_encrypted, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const f = data as { id: string; organization_id: string; path_token: string | null; secret_encrypted: string | null; is_active: boolean };
  if (!f.is_active || !f.path_token) return null;
  const segredo = f.secret_encrypted ? await decryptWebhookSecret(admin, f.secret_encrypted) : null;
  return { id: f.id, organizationId: f.organization_id, token: f.path_token, segredo };
}

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
  const id = idDaFonte(deps);
  if (!id) {
    logger.warn(`[raio-x] ${VARIAVEL_DA_FONTE} não configurada: o cadastro não virou lead no CRM da Time`, { contaId: entrada.conta.id });
    await marcarConta(admin, entrada.conta.id, { crm_erro: "sem_fonte" });
    return { ok: false, motivo: "sem_fonte" };
  }
  try {
    const fonte = await lerFonte(admin, id);
    if (!fonte) {
      logger.warn("[raio-x] a fonte do CRM da Time não existe ou está desligada", { contaId: entrada.conta.id });
      await marcarConta(admin, entrada.conta.id, { crm_erro: "fonte_inexistente" });
      return { ok: false, motivo: "fonte_inexistente" };
    }
    const corpo = JSON.stringify(corpoDoLead(entrada.conta, entrada.raioX, entrada.origem ?? {}, entrada.extras ?? {}));
    const base = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "mia-raio-x/1",
      ...(base ? { referer: `${base}/raio-x/gratis` } : {}),
    };
    if (fonte.segredo) headers[HEADER_ASSINATURA_DE_ENTRADA] = createHmac("sha256", fonte.segredo).update(corpo).digest("hex");
    const resposta = await (deps.processar ?? processarPelaRota)(fonte.token, corpo, headers);
    const lido = (await resposta.json().catch(() => null)) as { data?: { lead_id?: string } } | null;
    const leadId = lido?.data?.lead_id;
    if (!resposta.ok || typeof leadId !== "string") {
      logger.warn("[raio-x] a fonte do CRM da Time recusou o cadastro", { contaId: entrada.conta.id, status: resposta.status });
      await marcarConta(admin, entrada.conta.id, { crm_erro: "recusado" });
      return { ok: false, motivo: "recusado" };
    }
    await marcarConta(admin, entrada.conta.id, { crm_lead_id: leadId, crm_enviado_em: new Date().toISOString(), crm_erro: null });
    return { ok: true, leadId, organizationId: fonte.organizationId };
  } catch (erro) {
    logger.warn("[raio-x] o lead no CRM da Time falhou", { contaId: entrada.conta.id, detail: erro instanceof Error ? erro.message : "erro" });
    await marcarConta(admin, entrada.conta.id, { crm_erro: "falhou" });
    return { ok: false, motivo: "falhou" };
  }
}

/**
 * O que acontece DEPOIS do cadastro vai por cima do negócio: os campos (merge
 * atômico) e uma nota na linha do tempo. Sem negócio ainda (a fonte faltou no
 * cadastro), manda o cadastro de novo primeiro. Nunca lança.
 */
export async function anotarNoLead(
  admin: SupabaseClient,
  entrada: { conta: ContaDoLead; raioX: RaioXDoLead | null; raioXId?: string | null; campos: Record<string, string | number | null>; nota: string },
  deps: DependenciasDoLead = {},
): Promise<ResultadoDoLead> {
  const enviado = await enviarAoCrm(admin, { conta: entrada.conta, raioX: entrada.raioX }, deps);
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

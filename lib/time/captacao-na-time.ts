/**
 * FORK MIA · CHAMAR A FONTE DA TIME POR DENTRO.
 *
 * O núcleo que o Raio-X (`lib/raio-x/lead-da-time.ts`, .107) e o cadastro do
 * /signup (`lib/planos-mia/lead-do-cadastro.ts`, MIA-168) usam para virar lead
 * no CRM da Time Company dentro da própria MIA.
 *
 * A Time tem, no CRM dela, uma FONTE DE FORMULÁRIO por porta de entrada (o id
 * vem de uma variável de ambiente). O pedido é montado como o de um formulário
 * e entregue à rota de captação `app/api/v1/webhooks/in/[token]` NO MESMO
 * PROCESSO, com o token e a assinatura da fonte, e não a uma cópia dela. Assim
 * o lead passa pelo caminho de sempre: o histórico de captação, a deduplicação
 * pelo `external_id`, a atribuição de anúncio (utm, gclid, fbclid, fbc, fbp), a
 * classificação inicial e os eventos que as automações da Time escutam. Não há
 * função em `lib/webhooks/` com esse processamento inteiro: ele mora no POST da
 * rota (do upstream), e chamá-lo é o que não diverge na próxima sincronização.
 *
 * Aqui não há nada de quem chama (nem tabela, nem log com o assunto dele): quem
 * chama guarda o erro onde o seu painel mostra. Nunca lança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createHmac } from "node:crypto";

import { env } from "@/lib/env";
import { HEADER_ASSINATURA_DE_ENTRADA } from "@/lib/webhooks/assinatura";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/** Chama a rota de captação por dentro, com o pedido montado como o de um formulário. */
export type ProcessarCaptacao = (token: string, corpo: string, headers: Record<string, string>) => Promise<Response>;

export const processarPelaRota: ProcessarCaptacao = async (token, corpo, headers) => {
  const [{ NextRequest }, rota] = await Promise.all([import("next/server"), import("@/app/api/v1/webhooks/in/[token]/route")]);
  const base = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost").replace(/\/+$/, "");
  const req = new NextRequest(`${base}/api/v1/webhooks/in/${encodeURIComponent(token)}`, { method: "POST", headers, body: corpo });
  return rota.POST(req, { params: Promise.resolve({ token }) });
};

export interface DependenciasDaCaptacao {
  /** Para o teste: a fonte (sem ela, a variável de quem chama). `null` = sem fonte. */
  fonteId?: string | null;
  processar?: ProcessarCaptacao;
}

export type MotivoSemLead = "sem_fonte" | "fonte_inexistente" | "recusado" | "falhou";

export type FalhaDaCaptacao = {
  ok: false;
  motivo: MotivoSemLead;
  /** O status da rota, na recusa (para o log de quem chama). */
  status?: number;
  /** A mensagem do erro, na falha (para o log de quem chama). */
  detalhe?: string;
};

export type ResultadoDaCaptacao = { ok: true; leadId: string; organizationId: string } | FalhaDaCaptacao;

export interface FonteDaTime {
  id: string;
  organizationId: string;
  token: string;
  segredo: string | null;
}

/** O id da fonte: o do teste, ou o da variável. Só um uuid vale. */
export function idDaFonte(variavel: string, deps: DependenciasDaCaptacao = {}): string | null {
  const bruto = deps.fonteId !== undefined ? deps.fonteId : process.env[variavel];
  const id = typeof bruto === "string" ? bruto.trim() : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** A fonte ligada, com o token e o segredo decifrado. `null` = não existe ou está desligada. */
export async function lerFonte(admin: SupabaseClient, id: string): Promise<FonteDaTime | null> {
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

/** A org da Time, dona da fonte (sem mandar nada). Nunca lança. */
export async function orgDaFonte(
  admin: SupabaseClient,
  variavel: string,
  deps: DependenciasDaCaptacao = {},
): Promise<{ ok: true; organizationId: string } | FalhaDaCaptacao> {
  const id = idDaFonte(variavel, deps);
  if (!id) return { ok: false, motivo: "sem_fonte" };
  try {
    const fonte = await lerFonte(admin, id);
    if (!fonte) return { ok: false, motivo: "fonte_inexistente" };
    return { ok: true, organizationId: fonte.organizationId };
  } catch {
    return { ok: false, motivo: "falhou" };
  }
}

/**
 * Manda o corpo à fonte da variável (cria o negócio, ou cai no mesmo pelo
 * `external_id` do corpo). Nunca lança.
 */
export async function enviarAFonteDaTime(
  admin: SupabaseClient,
  entrada: { variavel: string; corpo: Record<string, string>; userAgent: string; referer?: string | null },
  deps: DependenciasDaCaptacao = {},
): Promise<ResultadoDaCaptacao> {
  const id = idDaFonte(entrada.variavel, deps);
  if (!id) return { ok: false, motivo: "sem_fonte" };
  try {
    const fonte = await lerFonte(admin, id);
    if (!fonte) return { ok: false, motivo: "fonte_inexistente" };
    const corpo = JSON.stringify(entrada.corpo);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": entrada.userAgent,
      ...(entrada.referer ? { referer: entrada.referer } : {}),
    };
    if (fonte.segredo) headers[HEADER_ASSINATURA_DE_ENTRADA] = createHmac("sha256", fonte.segredo).update(corpo).digest("hex");
    const resposta = await (deps.processar ?? processarPelaRota)(fonte.token, corpo, headers);
    const lido = (await resposta.json().catch(() => null)) as { data?: { lead_id?: string } } | null;
    const leadId = lido?.data?.lead_id;
    if (!resposta.ok || typeof leadId !== "string") return { ok: false, motivo: "recusado", status: resposta.status };
    return { ok: true, leadId, organizationId: fonte.organizationId };
  } catch (erro) {
    return { ok: false, motivo: "falhou", detalhe: erro instanceof Error ? erro.message : "erro" };
  }
}

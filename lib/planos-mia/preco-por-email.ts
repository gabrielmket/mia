/**
 * FORK MIA (.95) · O PREÇO POR E-MAIL, com o plano (pedido do Gabriel em
 * 27/10/2026: "o valor do disparo de WhatsApp e do e-mail é diferente").
 *
 * O MESMO caminho do preço por mensagem (`preco-por-mensagem.ts`), perguntado
 * na hora e nunca copiado para a empresa:
 *   1. o preço definido à mão para a empresa
 *      (`tenant_broadcast_pricing.preco_por_email_cents`, 9060), quando existe;
 *   2. senão, o do plano ATUAL da assinatura (`mia_plano_modulos`, 9110), com a
 *      cobrança ligada; a empresa isenta não tem plano e pula este degrau;
 *   3. senão, o padrão do sistema (R$ 0,02, `PRECO_PADRAO_POR_EMAIL_CENTS`).
 * A única diferença para a mensagem é o fim da fila: sem preço, a mensagem
 * RECUSA e o e-mail cobra o padrão, como sempre cobrou (9060).
 *
 * A troca de plano leva o preço junto no dia em que a troca vale (no teste na
 * hora, subindo quando a diferença é paga, descendo na renovação), porque a
 * pergunta lê o `plano_id`. A campanha já confirmada não muda: o preço dela é
 * congelado na confirmação (`mia_email_campanhas.preco_cents`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PRECO_PADRAO_POR_EMAIL_CENTS } from "@/lib/email-marketing/regras";

import { precoDoPlanoDaEmpresa, precoPorMensagemDaEmpresa, type PrecoPorMensagem } from "./preco-por-mensagem";

export type OrigemDoPrecoPorEmail = "combinado" | "plano" | "padrao";

export interface PrecoPorEmail {
  cents: number;
  origem: OrigemDoPrecoPorEmail;
}

/**
 * O preço por e-mail que vale para a empresa. `combinadoCents` é o definido à
 * mão, já lido por quem chama (`null` = não há). LANÇA se a leitura do plano
 * falha: cobrar o padrão de quem tem outro preço no plano seria cobrar errado
 * em silêncio, e o envio prefere parar com o erro.
 */
export async function precoPorEmailDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
  combinadoCents: number | null,
): Promise<PrecoPorEmail> {
  if (combinadoCents !== null) return { cents: combinadoCents, origem: "combinado" };
  const doPlano = await precoDoPlanoDaEmpresa(admin, orgId, "preco_por_email_cents");
  return doPlano === null
    ? { cents: PRECO_PADRAO_POR_EMAIL_CENTS, origem: "padrao" }
    : { cents: doPlano, origem: "plano" };
}

export interface PrecosDaEmpresa {
  /** O plano da assinatura (o atual), para a tela dizer "pelo plano X". `null` = isenta. */
  plano: string | null;
  mensagem: PrecoPorMensagem & { combinado_cents: number | null };
  email: PrecoPorEmail & { combinado_cents: number | null };
}

const centavos = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Os dois preços da empresa, cada um com a origem, e o que foi definido à mão:
 * a carteira do painel da Time e a leitura da assinatura no MCP. LANÇA na falha.
 */
export async function lerPrecosDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
): Promise<PrecosDaEmpresa> {
  const [combinado, assinatura] = await Promise.all([
    admin
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents, preco_por_email_cents")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.from("cobranca_assinaturas").select("plano_id").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (combinado.error)
    throw new Error(`preço combinado: leitura falhou (${combinado.error.code ?? "sem_codigo"})`);
  if (assinatura.error)
    throw new Error(`assinatura: leitura falhou (${assinatura.error.code ?? "sem_codigo"})`);
  const linha = combinado.data as {
    preco_por_mensagem_cents?: number | null;
    preco_por_email_cents?: number | null;
  } | null;
  const mensagemAMao = centavos(linha?.preco_por_mensagem_cents);
  const emailAMao = centavos(linha?.preco_por_email_cents);
  const planoId = (assinatura.data as { plano_id?: string } | null)?.plano_id ?? null;
  const [mensagem, email, nome] = await Promise.all([
    precoPorMensagemDaEmpresa(admin, orgId, mensagemAMao),
    precoPorEmailDaEmpresa(admin, orgId, emailAMao),
    planoId
      ? admin.from("cobranca_planos").select("nome").eq("id", planoId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    plano: (nome.data as { nome?: string } | null)?.nome ?? null,
    mensagem: { ...mensagem, combinado_cents: mensagemAMao },
    email: { ...email, combinado_cents: emailAMao },
  };
}

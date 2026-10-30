/**
 * FORK MIA (.95) · A ENTRADA PAGA AINDA NÃO PAGA (teste do Gabriel em produção,
 * 27/10/2026).
 *
 * A empresa que nasce num plano de ENTRADA PAGA (0 dia de teste) fica suspensa
 * até o primeiro pagamento: o gatilho do upstream (0679,
 * `fn_trial_na_criacao_da_org`, e a criação pelo painel do dono) grava a
 * assinatura com `pagamento_inicial_pendente = true` e suspende com o tipo
 * `cobranca` e o motivo "Aguardando o primeiro pagamento". Para quem acabou de
 * assinar, o upstream dizia "Conta suspensa" na tela (`/account-suspended`) e
 * mandava "Conta suspensa por falta de pagamento" por e-mail e na Central. Ela
 * ainda não deve nada.
 *
 * O sinal é o da assinatura (`pagamento_inicial_pendente`): é a coluna que a
 * releitura do upstream desliga quando o provedor diz que o primeiro pagamento
 * EXISTE (`lib/cobranca/sincronizar.ts`; no Asaas, só cobrança paga). Na hora
 * da liberação essa coluna já desligou (a releitura grava antes de aplicar a
 * régua), e o sinal é o motivo da suspensão que vai ser desfeita, gravado pelo
 * gatilho (`MOTIVO_DA_ENTRADA_PAGA`). A suspensão por atraso (de quem já pagou)
 * tem outro motivo e fica com os textos de sempre.
 *
 * Os pontos de ligação, cada um com `FORK MIA (.95)`:
 *   - `app/account-suspended/page.tsx`: o topo e a LGPD só com pedido;
 *   - `lib/cobranca/sincronizar.ts` (`aplicarRegua`): sem aviso de "suspensa"
 *     enquanto a entrada não foi paga, e a liberação com a frase própria;
 *   - `lib/cobranca/emails.ts`: o botão "Entrar" do e-mail da liberação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AssuntoDoAviso, TextoDoAviso } from "@/lib/cobranca/avisos";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import type { TipoDeSuspensao } from "@/lib/organizacao/operante";

/** O motivo que o gatilho da entrada paga do upstream grava na suspensão (0679). */
export const MOTIVO_DA_ENTRADA_PAGA = "Aguardando o primeiro pagamento";

/** O botão do e-mail da liberação da entrada paga: entrar no sistema. */
export const BOTAO_DE_ENTRAR = { rotulo: "Entrar", caminho: "/app" } as const;

/**
 * O aviso da régua que se cala: "suspensa" enquanto a entrada paga não foi
 * paga (nem e-mail, nem Central). O atraso de quem já pagou segue avisando. Puro.
 */
export function calaOAvisoDaEntradaPaga(
  assunto: AssuntoDoAviso,
  pagamentoInicialPendente: boolean | null | undefined,
): boolean {
  return assunto === "suspensa" && pagamentoInicialPendente === true;
}

/** A suspensão que vai ser desfeita é a da entrada paga (pelo motivo gravado). Puro. */
export function ehLiberacaoDaEntradaPaga(motivoDaSuspensao: string | null | undefined): boolean {
  return (motivoDaSuspensao ?? "").trim() === MOTIVO_DA_ENTRADA_PAGA;
}

/**
 * A frase da liberação no PRIMEIRO pagamento da entrada paga: nada de "tudo
 * voltou a funcionar" nem de conversas da suspensão, porque não houve uso
 * antes. Puro.
 */
export function textoDaLiberacaoDaEntradaPaga(idioma: Idioma): TextoDoAviso {
  const t = (s: string) => traduzir(s, idioma);
  return {
    titulo: t("Pagamento confirmado: a sua conta está liberada"),
    corpo: t("Recebemos o primeiro pagamento. Entre para começar a usar."),
    severidade: "info",
  };
}

/**
 * A empresa está parada só porque a entrada paga ainda não foi paga: suspensão
 * de cobrança E assinatura com o primeiro pagamento pendente. Na falha, `false`
 * (o hub fica como o upstream o escreveu).
 */
export async function esperaOPrimeiroPagamento(
  admin: SupabaseClient,
  orgId: string,
  tipo: TipoDeSuspensao | null,
): Promise<boolean> {
  if (tipo !== "cobranca") return false;
  try {
    const { data, error } = await admin
      .from("cobranca_assinaturas")
      .select("pagamento_inicial_pendente")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) return false;
    return (data as { pagamento_inicial_pendente?: boolean } | null)?.pagamento_inicial_pendente === true;
  } catch {
    return false;
  }
}

/**
 * Há algum pedido de LGPD na empresa. Na entrada paga, a empresa é nova e vazia:
 * o bloco "Solicitações LGPD" só aparece se houver o que mostrar. Na falha,
 * `true` (o bloco aparece, como o upstream sempre mostrou).
 */
export async function temPedidoDeLgpd(admin: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { count, error } = await admin
      .from("lgpd_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (error) return true;
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}

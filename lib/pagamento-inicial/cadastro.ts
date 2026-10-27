/**
 * FORK MIA (.96) · O CADASTRO DA ENTRADA PAGA (protótipo "Pagamento no início",
 * tela 1; decisão 4).
 *
 * Num plano de ENTRADA PAGA (0 dia de teste), o cadastro pede também quem
 * assina (nome e WhatsApp) e os dados da empresa para a cobrança e a nota
 * fiscal. A action do cadastro (`app/actions/auth/signUp.ts`) confere aqui,
 * DEPOIS da tela, porque a tela é adulterável.
 *
 * Plano com teste grátis segue o cadastro de hoje (decisão 12): os dados
 * fiscais ficam para o passo "Pagamento", onde a pessoa escolhe como paga
 * depois do teste (com o cartão, o Asaas precisa deles já). Decisão anotada em
 * docs/fork/pagamento-no-inicio.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { conferirDadosFiscais, faltasDosDadosFiscais, type DadosFiscais } from "@/lib/dados-fiscais/regras";
import { moduloLigado } from "@/lib/instalacao/modulos";

export type ConferenciaDaEntradaPaga =
  | { ok: true; entradaPaga: false }
  | { ok: true; entradaPaga: true; dados: DadosFiscais; nome: string }
  | { ok: false; details: Record<string, string[]> };

/** O plano escolhido é de entrada paga? `null` = não deu para ler (quem decide é a action). */
export async function planoEhDeEntradaPaga(admin: SupabaseClient, planoId: string): Promise<boolean | null> {
  try {
    if (!(await moduloLigado(admin, "cobranca"))) return false;
    const { data, error } = await admin.from("cobranca_planos").select("trial_dias").eq("id", planoId).maybeSingle();
    if (error) return null;
    return (data as { trial_dias?: number } | null)?.trial_dias === 0;
  } catch {
    return null;
  }
}

/**
 * Confere quem assina e os dados fiscais quando o plano é de entrada paga.
 * Plano com teste, ou cobrança desligada: nada é exigido nem guardado.
 */
export async function conferirCadastroDaEntradaPaga(
  admin: SupabaseClient,
  planoId: string | undefined,
  entrada: { mia_nome?: string; mia_fiscal?: Record<string, string> },
): Promise<ConferenciaDaEntradaPaga> {
  if (!planoId) return { ok: true, entradaPaga: false };
  const entradaPaga = await planoEhDeEntradaPaga(admin, planoId);
  if (entradaPaga === false) return { ok: true, entradaPaga: false };
  if (entradaPaga === null) return { ok: false, details: { cobranca_plan_id: ["plano_obrigatorio"] } };
  const nome = (entrada.mia_nome ?? "").trim();
  const conferido = conferirDadosFiscais(entrada.mia_fiscal ?? {}, { exigeTelefone: true });
  const faltas = conferido.ok ? [] : faltasDosDadosFiscais(conferido.campos);
  if (nome.length < 2) faltas.unshift("seu nome");
  if (!conferido.ok || faltas.length > 0) return { ok: false, details: { mia_fiscal: faltas } };
  return { ok: true, entradaPaga: true, dados: conferido.dados, nome };
}

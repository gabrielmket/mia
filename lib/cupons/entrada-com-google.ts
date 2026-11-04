/**
 * FORK MIA (.99) · O CUPOM NO CADASTRO PELO GOOGLE.
 *
 * Quem chega por `/precos?cupom=CODIGO` fica com o cupom no navegador por 30 dias
 * (cookie `mia_cupom`, `lib/cupons/navegador.ts`). No cadastro por e-mail, a action
 * confere o cupom e o guarda em `mia_cupom_do_cadastro`, e o gatilho adiado da 9130
 * (`trg_mia_cupom_nasce_com_a_empresa`) o aplica quando a empresa nasce, com o
 * parceiro dele. No "Entrar com Google" não há formulário: o cupom se perdia, e o
 * parceiro deixava de receber a comissão.
 *
 * Aqui a volta do Google (`app/auth/callback/route.ts`) faz o mesmo que a action do
 * e-mail, com o cupom que o navegador trouxe, ANTES de a empresa nascer (na hora, no
 * cadastro aberto; ou na aprovação da Time, no cadastro com aprovação). A régua é a
 * do e-mail (`conferirCupomDoCadastro`), no plano da empresa do Google, que é o plano
 * padrão do cadastro. O que muda é a saída: sem tela para a frase, o cupom que não vale
 * só não é guardado, e a empresa nasce sem ele, como a 9130 faz com o cupom que deixou
 * de valer até a confirmação. Nunca lança: o cupom não atrasa nem recusa a entrada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { guardarCupomDoCadastro } from "./banco";
import { conferirCupomDoCadastro } from "./cadastro";

export type CupomDaEntradaComGoogle = "sem_cupom" | "guardado" | "nao_vale" | "nao_guardado";

export async function guardarCupomDaEntradaComGoogle(
  admin: SupabaseClient,
  userId: string,
  doNavegador: string | null | undefined,
  agora: Date = new Date(),
): Promise<CupomDaEntradaComGoogle> {
  if (typeof doNavegador !== "string" || doNavegador.trim() === "") return "sem_cupom";
  let bruto = doNavegador;
  try {
    bruto = decodeURIComponent(doNavegador);
  } catch {
    // Cookie com escape quebrado: segue o texto como veio, e a régua decide.
  }
  try {
    // O Google não leva a escolha do plano: a empresa dele nasce no padrão do cadastro.
    const conferido = await conferirCupomDoCadastro(admin, undefined, bruto, agora);
    if (!conferido.ok) return "nao_vale";
    if (conferido.codigo === null) return "sem_cupom";
    return (await guardarCupomDoCadastro(admin, userId, conferido.codigo)) ? "guardado" : "nao_guardado";
  } catch {
    return "nao_guardado";
  }
}

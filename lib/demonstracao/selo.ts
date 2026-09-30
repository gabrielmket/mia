/**
 * FORK MIA · CLIENTE MODELO — a empresa ativa é a de demonstração? Para o SELO.
 *
 * Tolerante de propósito, ao contrário de `travaDaDemonstracao`: aqui a
 * pergunta decide só se uma faixa aparece. Quem trava o envio é o banco
 * (migration 9010), e um erro de leitura que escondesse o selo não abre porta
 * nenhuma — enquanto um erro que derrubasse o layout derrubaria o produto
 * inteiro para uma empresa de verdade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function empresaEDemonstracao(
  admin: Pick<SupabaseClient, "from">,
  organizationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("organizations")
      .select("demonstracao")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) return false;
    return (data as { demonstracao?: unknown } | null)?.demonstracao === true;
  } catch {
    return false;
  }
}

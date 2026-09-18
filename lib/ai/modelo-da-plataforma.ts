/**
 * QUAL CÉREBRO O AGENTE USA — e por que a resposta não é do cliente.
 *
 * Mesma doutrina da chave de IA (`lib/ai/custo-e-da-plataforma.ts`): quem
 * comprou atendimento comprou um agente que funciona, não a tarefa de comparar
 * modelos e descobrir qual deles chama ferramenta direito. A escolha é nossa —
 * e a conta também.
 *
 * ⚠️ AUSÊNCIA faz cair para trás; RECUSA não existe aqui. Sem modelo escolhido
 * no painel (tabela vazia, migration não aplicada, leitura falhou), o sistema
 * volta exatamente ao comportamento de antes — `escolherModeloDoProvedor`
 * decide. O que este arquivo NUNCA faz é impedir uma publicação porque a
 * plataforma ainda não configurou nada: isso transformaria uma escolha nossa
 * que ficou para depois em cliente sem agente no ar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export interface ModeloDaPlataforma {
  provider: string;
  modelId: string;
}

/**
 * O par escolhido no painel, ou `null` quando ninguém decidiu.
 *
 * Nunca lança: uma falha de leitura aqui vira `null`, e `null` significa "use a
 * regra de antes". Propagar o erro faria a primeira publicação de um cliente
 * falhar por causa de uma tabela de configuração NOSSA.
 */
export async function modeloDaPlataforma(
  admin: SupabaseClient,
): Promise<ModeloDaPlataforma | null> {
  try {
    const { data, error } = await admin
      .from("platform_ia")
      .select("provider, model_id")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;

    const linha = data as { provider?: string | null; model_id?: string | null };
    if (!linha.provider || !linha.model_id) return null;
    return { provider: linha.provider, modelId: linha.model_id };
  } catch (err) {
    logger.warn("[modelo-da-plataforma] não deu para ler — vale a escolha automática", {
      detail: err instanceof Error ? err.message : "erro",
    });
    return null;
  }
}

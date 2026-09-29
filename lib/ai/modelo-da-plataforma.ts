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

import { escolherModeloNoCatalogo } from "@/lib/ai/agents/escolher-modelo";
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

/** O par provedor + modelo com que um agente nasce, sem credencial escolhida. */
export interface IaDoAgenteNovo {
  provider: string;
  model: string;
}

/**
 * O CÉREBRO DE UM AGENTE NOVO criado por quem não escolhe IA — o cliente.
 *
 * O editor de agente esconde o cartão de modelo e chave de quem não é da
 * plataforma (`podeConfigurarChaveDeIa`), mas o formulário continuava EXIGINDO
 * os dois, e o erro morava dentro do cartão escondido: o botão "Criar agente"
 * ficava cinza para sempre, sem dizer por quê. A tela de criar passa a receber
 * daqui o par que vale, com a mesma régua da primeira publicação do onboarding
 * (`first-publication.ts`): o modelo escolhido no painel vence; sem ele, o
 * provedor da organização e a escolha automática do catálogo.
 *
 * A credencial NÃO entra: o agente nasce com `credential_id: null`, que o
 * runtime resolve como a credencial validada da organização ou, na falta dela,
 * a chave da instalação (`resolveOrgLlmConfig`). Nenhuma chave chega à tela.
 *
 * `null` = não há par possível agora (catálogo vazio, leitura falhou). A tela
 * diz que é pendência da plataforma, em vez de inventar um modelo.
 */
export async function iaDoAgenteNovo(
  admin: SupabaseClient,
  provedorDaOrganizacao: string | null | undefined,
): Promise<IaDoAgenteNovo | null> {
  const daPlataforma = await modeloDaPlataforma(admin);
  if (daPlataforma) return { provider: daPlataforma.provider, model: daPlataforma.modelId };

  const provider = provedorDaOrganizacao?.trim() || "anthropic";
  const escolha = await escolherModeloNoCatalogo(admin, provider);
  if (!escolha || !escolha.escolhido) return null;
  return { provider, model: escolha.modelId };
}

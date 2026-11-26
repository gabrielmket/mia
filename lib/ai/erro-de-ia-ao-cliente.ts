/**
 * FORK MIA (MIA-262) — O ERRO DA IA, NA LINGUAGEM DE QUEM COMPROU ATENDIMENTO.
 *
 * As rotas de Propostas devolviam ao cliente a mensagem crua do motor: "modelo
 * não habilitado para a org (enabled_models): {id do modelo}", "provider LLM
 * desconhecido", ou "ajuste o teto em Uso de IA › Orçamento" (uma tela que dá
 * 403 a ele). Provedor, modelo e teto são da plataforma
 * (`lib/ai/custo-e-da-plataforma.ts`). No lugar, as frases que o sistema já usa:
 * a do teto do plano e a da IA configurada pela nossa equipe.
 */
import { LlmBudgetExceededError } from "@/lib/agent-engine/edge/llm/run-model-call";
import { tituloDoTetoDoPlano } from "@/lib/agent-engine/edge/llm/orcamento";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export function motivoDeIaAoCliente(err: unknown, idioma: Idioma): string {
  if (err instanceof LlmBudgetExceededError) return tituloDoTetoDoPlano(idioma);
  return traduzir(
    "A inteligência dos agentes desta conta é configurada pela nossa equipe e ainda não está pronta. Fale com o suporte.",
    idioma,
  );
}

/**
 * FORK MIA (MIA-262) — O AVISO DE ORÇAMENTO, NA LINGUAGEM DO PLANO.
 *
 * O teto de gasto da empresa (`ai_budgets`) é número da plataforma
 * (`lib/ai/custo-e-da-plataforma.ts`). O motor grava na Central o aviso e a
 * parada com o gasto e o teto em dólar no corpo, e manda ajustar em "Uso de IA
 * › Orçamento", uma tela que dá 403 ao cliente. O texto fica gravado assim (a
 * plataforma lê no relatório da operação, `lib/operacao/operacao-do-dia.ts`);
 * quem não vê custo recebe, na leitura, as frases do plano que o sistema já
 * usa. Vale também para os avisos antigos, gravados antes desta versão.
 *
 * O aviso do teto do PLANO (`ref_kind = "plano"`) já nasce nessa linguagem e
 * passa intacto.
 */
import { corpoDoTetoDoPlano, tituloDoTetoDoPlano } from "@/lib/agent-engine/edge/llm/orcamento";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

interface AvisoDaCentral {
  kind: string;
  ref_kind: string | null;
  title: string;
  body: string | null;
}

export function avisoDeOrcamentoAoCliente<T extends AvisoDaCentral>(
  aviso: T,
  veCusto: boolean,
  idioma: Idioma,
): T {
  if (veCusto || aviso.ref_kind !== "ai_budget") return aviso;
  if (aviso.kind === "budget_exceeded") {
    return { ...aviso, title: tituloDoTetoDoPlano(idioma), body: corpoDoTetoDoPlano(idioma) };
  }
  if (aviso.kind === "budget_warning") {
    return {
      ...aviso,
      title: traduzir("Uso de IA no mês", idioma),
      body: traduzir("A IA continua respondendo normalmente — isto é o aviso, não a parada.", idioma),
    };
  }
  return aviso;
}

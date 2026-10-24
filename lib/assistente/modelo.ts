/**
 * FORK MIA (.88) — O EMISSOR DO PONTO DE IA `assistente`: a única chamada de
 * modelo do assistente da MIA.
 *
 * Passa pelo seam (`runModelCall`) como todo ponto do registro: o painel de
 * Provedores escolhe o modelo do ponto (ou vale o padrão da organização), o
 * teto de orçamento vale, e cada chamada vira uma linha em `llm_calls` com a
 * organização. É isso que faz o gasto do assistente entrar no consumo de IA da
 * empresa (regra "Custo" do protótipo), visível para a plataforma no `/admin` e
 * no `plataforma_ver_assistente`.
 *
 * ── O que mora aqui e o que NÃO mora ────────────────────────────────────────
 *
 * Aqui mora a CHAMADA, com o `pg.Pool` que o seam usa para a telemetria e o
 * orçamento. As LEITURAS do turno não passam por aqui: elas moram nas
 * ferramentas (`ferramentas.ts`), com o cliente da SESSÃO de quem perguntou. O
 * turno (`turno.ts`) recebe esta função injetada e nunca vê o pool.
 */
import type pg from "pg";
import type { ModelMessage, ToolSet } from "ai";

import {
  runModelCall,
  type LlmEdgeConfig,
  type RunModelCallDeps,
} from "@/lib/agent-engine/edge/llm/run-model-call";

export const PONTO_DO_ASSISTENTE = "assistente";

export interface PedidoAoModelo {
  tenantId: string;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps: number;
}

export interface RespostaDoModelo {
  texto: string;
  callId: string | null;
}

export type ChamarModelo = (pedido: PedidoAoModelo) => Promise<RespostaDoModelo>;

/** A chamada pronta para a rota injetar no turno. */
export function chamadaDoAssistente(
  pool: pg.Pool,
  llmCfg: LlmEdgeConfig,
  deps: RunModelCallDeps = {},
): ChamarModelo {
  return async (pedido) => {
    const { result, callId } = await runModelCall(
      pool,
      llmCfg,
      {
        tenantId: pedido.tenantId,
        leadId: null,
        jobId: null,
        agentId: null,
        purpose: "assistente",
        system: pedido.system,
        messages: pedido.messages,
        tools: pedido.tools,
        maxSteps: pedido.maxSteps,
        // Uma resposta de assistente cabe em pouco: o teto é custo, não estilo.
        maxOutputTokens: 1500,
      },
      deps,
    );
    return { texto: (result.text ?? "").trim(), callId: callId ?? null };
  };
}

/**
 * Os tipos que TODA ferramenta do MCP de plataforma compartilha.
 *
 * Moram num arquivo próprio para os arquivos por área
 * (`lib/mcp-plataforma/ferramentas/*.ts`) importarem daqui, e não de
 * `ferramentas.ts`, que é quem junta todos: sem isto haveria um ciclo de import
 * entre a lista e os itens dela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

export interface ContextoDaFerramenta {
  admin: SupabaseClient;
  /** O usuário que criou o token: o ator gravado nas colunas de autoria. */
  autorUserId: string;
  tokenId: string;
  /** Correlação da chamada, a mesma que vai para a auditoria. */
  requestId: string;
  /**
   * FORK MIA (.91): o que a INSTALAÇÃO já sabe e quem chama passa pronto. O
   * "o que falta" do assistente roda as áreas do checklist com o cliente da
   * SESSÃO, que não lê `platform_config`; a rota lê a chave da cobrança com o
   * cliente de serviço (como o layout de `/app` faz) e passa aqui. Ausente, a
   * área lê do banco, como no MCP.
   */
  instalacao?: { cobrancaLigada?: boolean };
}

export interface FerramentaDePlataforma {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** `null` = leitura livre. Caso contrário, a chave que o token precisa ter. */
  operacao: string | null;
  handler: (ctx: ContextoDaFerramenta, args: Record<string, unknown>) => Promise<unknown>;
  /**
   * Uma chamada VÁLIDA de exemplo, com dados fictícios.
   *
   * Vai junto da recusa de validação, para o modelo corrigir sozinho na próxima
   * chamada. É conferida contra o próprio schema em
   * `tests/unit/mcp-de-implantacao-ferramentas.test.ts`: exemplo que deixa de
   * valer reprova o teste, em vez de ensinar errado.
   */
  exemplo?: Record<string, unknown>;
  /**
   * .81 — a redação dos argumentos para a auditoria (`plataforma.mcp_executado`),
   * quando um argumento é SEGREDO (a chave do servidor MCP externo). Sem ela, os
   * argumentos vão resumidos, mas inteiros no que é curto: uma chave de 30
   * caracteres ficaria na trilha append-only para sempre. As de importação já a
   * declaram (`importacao/tipos.ts`, obrigatória lá).
   */
  redigirParaAuditoria?: (args: Record<string, unknown>) => Record<string, unknown>;
}

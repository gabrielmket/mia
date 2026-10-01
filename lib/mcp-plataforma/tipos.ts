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
}

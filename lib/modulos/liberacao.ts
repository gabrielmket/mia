import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { type ChaveDeModulo } from "@/lib/modulos/vendaveis";

/**
 * "Esta organização contratou este módulo?"
 *
 * Uma pergunta, uma resposta, e ela é sobre LINHA VIVA: liberação revogada
 * continua na tabela (é o histórico comercial) e não libera nada.
 *
 * ⚠️ FALHA DE LEITURA RECUSA. A tentação é devolver `true` quando o banco não
 * responde, para "não quebrar o cliente que pagou" — e o efeito é liberar o
 * módulo para TODO MUNDO exatamente no minuto em que o banco oscila. Num
 * módulo que cobra por mensagem, isso é dinheiro saindo. Recusar é visível e
 * se conserta; liberar por engano não aparece em lugar nenhum.
 */
export async function moduloLiberado(
  db: SupabaseClient,
  organizationId: string,
  modulo: ChaveDeModulo,
): Promise<boolean> {
  const { data, error } = await db
    .from("organization_modules")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("modulo", modulo)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * Tudo que a organização tem contratado, de uma vez.
 *
 * Existe porque o menu precisa decidir sobre VÁRIAS telas numa renderização, e
 * uma consulta por tela transformaria a barra lateral em N idas ao banco.
 *
 * NUNCA LANÇA. Quem chama é o layout de `/app`, em TODA página: uma exceção
 * aqui (rede caída, cliente sem o método) derrubaria a casca inteira por causa
 * de um insumo de menu. Mesmo contrato do `modulosLigados` do upstream
 * (`lib/instalacao/modulos.ts`), que o layout chama logo ao lado: erro vira
 * lista vazia e aviso no log — nenhum módulo, nunca todos.
 */
export async function modulosDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from("organization_modules")
      .select("modulo")
      .eq("organization_id", organizationId)
      .is("revoked_at", null);
    // Mesmo critério do singular: erro não vira liberação.
    if (error) return new Set();
    return new Set((data ?? []).map((l) => l.modulo as string));
  } catch (erro) {
    logger.warn("módulos da organização: leitura falhou — tratando todos como não contratados", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return new Set();
  }
}

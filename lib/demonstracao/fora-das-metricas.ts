/**
 * FORK MIA · CLIENTE MODELO — a empresa de demonstração fica FORA dos números da
 * plataforma.
 *
 * Os dados dela são inventados: somá-los ao painel do dono da plataforma, ao
 * uso por cliente, ao custo da Meta ou ao resumo diário inflaria tudo com
 * atividade que não existiu. DENTRO dela, os relatórios continuam funcionando
 * (é para isso que ela existe) — o corte é só nas leituras que atravessam
 * empresas.
 *
 * Duas formas, porque as consultas da plataforma têm duas formas:
 *
 *  - partindo de `organizations`: `.not(...SEM_DEMONSTRACAO)`. `not is true` e
 *    não `eq false`: diz exatamente "tira a marcada", e continua certo num
 *    dublê de teste que não conhece a coluna;
 *  - partindo de uma tabela da empresa (`conversations`, `messages`,
 *    `job_queue`…): `excluirDemonstracao(consulta, ids)`, com os ids lidos UMA
 *    vez por `idsDasEmpresasDeDemonstracao`.
 *
 * O que NÃO sai daqui, de propósito: o SALDO e o gasto real da conta da
 * OpenAI (`/admin/ai-saldo`, `saldo-da-plataforma`). Aquilo é dinheiro que saiu
 * de verdade — se alguém testar a IA na demonstração, o custo é real, e tirar
 * a demonstração dali faria o "dura até" mentir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Para `.not(...SEM_DEMONSTRACAO)` numa consulta a `organizations`. */
export const SEM_DEMONSTRACAO = ["demonstracao", "is", true] as const;

/**
 * Os ids das empresas de demonstração. LANÇA em erro: um relatório que não
 * conseguiu saber quem excluir não pode sair como se tivesse excluído.
 */
export async function idsDasEmpresasDeDemonstracao(
  admin: Pick<SupabaseClient, "from">,
): Promise<string[]> {
  const { data, error } = await admin.from("organizations").select("id").eq("demonstracao", true);
  if (error) throw new Error(`nao_foi_possivel_ler_as_empresas_de_demonstracao: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((l) => l.id);
}

/** A lista no formato do filtro `in` do PostgREST, ou `null` quando não há o que excluir. */
export function listaParaExcluir(ids: readonly string[]): string | null {
  return ids.length > 0 ? `(${ids.join(",")})` : null;
}

interface ConsultaComNot<T> {
  not(coluna: string, operador: string, valor: unknown): T;
}

/** Tira as empresas de demonstração de uma consulta que tem `organization_id`. */
export function excluirDemonstracao<T extends ConsultaComNot<T>>(
  consulta: T,
  ids: readonly string[],
  coluna = "organization_id",
): T {
  const lista = listaParaExcluir(ids);
  return lista ? consulta.not(coluna, "in", lista) : consulta;
}

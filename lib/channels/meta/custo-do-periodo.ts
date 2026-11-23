/**
 * FORK MIA (MIA-99) · O CUSTO DE MENSAGEM DA META NUM PERÍODO, pelo preço que
 * valia no instante de cada mensagem (docs/fork/consumo-de-ia.md, seção 9).
 *
 * As leituras moram aqui, e a conta em `custo-da-conversa.ts` (que a tela de
 * preços importa no navegador e por isso não pode puxar o banco):
 *
 *   lerVigenciasDoPreco         o histórico de preços (`mia_precos_meta_vigencias`, 9165)
 *   lerCustoDeMensagemDoPeriodo as mensagens cobradas de UMA empresa no período, já com o custo
 *
 * A aba Uso do cliente (`/api/v1/admin/tenants/[id]/usage`) e o MCP
 * (`plataforma_ver_consumo_de_ia`) chamam a segunda; a tela do custo da Meta
 * (`/api/v1/admin/custo-da-meta`), que lê todas as empresas de uma vez, chama a
 * primeira e faz a conta com `calcularCustoPorVigencia`. Um preço, uma régua.
 *
 * O período chega pronto (`periodoDoPedido`, o mês ou os dias de Brasília da
 * MIA-78): nenhuma leitura daqui calcula janela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";

import {
  calcularCustoPorVigencia,
  type CustoDoCliente,
  type MensagemCobrada,
  type VigenciaDoPreco,
} from "./custo-da-conversa";

/** A tabela do histórico de preços (migration 9165). */
export const TABELA_DAS_VIGENCIAS = "mia_precos_meta_vigencias";

/**
 * Teto das mensagens cobradas de uma empresa: 50 páginas de 1000. Um mês de
 * empresa grande cabe; um ano não, e não precisa. Passou, sai `truncado`.
 */
const PAGINAS_DE_MENSAGENS = 50;

/**
 * Teto do histórico de preços: 5 páginas de 1000. São quatro categorias e um
 * reajuste de vez em quando; passar disso é defeito, e vira erro em vez de uma
 * conta feita com metade do histórico.
 */
const PAGINAS_DE_VIGENCIAS = 5;

export type LeituraDasVigencias = { vigencias: VigenciaDoPreco[] } | { erro: string };

/** Todo o histórico de preços. Leitura que falha é erro, nunca "sem preço". */
export async function lerVigenciasDoPreco(admin: Pick<SupabaseClient, "from">): Promise<LeituraDasVigencias> {
  const leitura = await lerTodasAsPaginas<VigenciaDoPreco>(
    (de, ate, pedirContagem) =>
      admin
        .from(TABELA_DAS_VIGENCIAS)
        .select("categoria, centavos_brl, vigente_desde, vigente_ate", pedirContagem ? { count: "exact" } : undefined)
        // Ordem única, que é o que deixa o `range` correto entre as páginas.
        .order("categoria", { ascending: true })
        .order("vigente_desde", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DE_VIGENCIAS },
  );
  if (leitura.erro) return { erro: leitura.erro };
  if (leitura.truncado) return { erro: "o histórico de preços da Meta passou do teto de leitura" };
  return { vigencias: leitura.linhas };
}

export interface CustoDeMensagemDoPeriodo extends CustoDoCliente {
  /** Quantas mensagens a Meta cobrou no período (as sem categoria inclusive). */
  total: number;
  /** A leitura das mensagens foi cortada no teto: o começo do período ficou de fora. */
  truncado: boolean;
}

export type LeituraDoCustoDeMensagem = CustoDeMensagemDoPeriodo | { erro: string };

export function falhouOCustoDeMensagem(r: LeituraDoCustoDeMensagem): r is { erro: string } {
  return "erro" in r;
}

/**
 * As mensagens que a Meta cobrou de UMA empresa em `[inicio, fim)`, cada uma ao
 * preço vigente no instante dela. Mensagem de contato pessoal entra: a Meta
 * cobra com ou sem pessoal (MIA-78, seção 8.2 do documento).
 */
export async function lerCustoDeMensagemDoPeriodo(
  admin: Pick<SupabaseClient, "from">,
  organizationId: string,
  periodo: { inicio: string; fim: string },
): Promise<LeituraDoCustoDeMensagem> {
  const [cobradas, precos] = await Promise.all([
    lerTodasAsPaginas<{ meta_pricing_category: string | null; created_at: string | Date }>(
      (de, ate, pedirContagem) =>
        admin
          .from("messages")
          .select("meta_pricing_category, created_at", pedirContagem ? { count: "exact" } : undefined)
          .eq("organization_id", organizationId)
          .eq("meta_billable", true)
          .gte("created_at", periodo.inicio)
          .lt("created_at", periodo.fim)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_DE_MENSAGENS },
    ),
    lerVigenciasDoPreco(admin),
  ]);
  if (cobradas.erro) return { erro: cobradas.erro };
  if ("erro" in precos) return { erro: precos.erro };

  return {
    total: cobradas.linhas.length,
    ...calcularCustoPorVigencia(cobradas.linhas.map(mensagemCobrada), precos.vigencias),
    truncado: cobradas.truncado,
  };
}

/**
 * A linha de `messages` como a conta a lê. Cobrada sem categoria é a Meta
 * mudando o formato: vira categoria com nome próprio em vez de sumir.
 */
export function mensagemCobrada(m: {
  meta_pricing_category: string | null;
  created_at: string | Date;
}): MensagemCobrada {
  return { categoria: m.meta_pricing_category ?? "sem_categoria", created_at: m.created_at };
}

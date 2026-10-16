/**
 * A GRAVAÇÃO DA META — um caminho só para a tela e para a implantação.
 *
 * `POST /api/v1/metas` (a tela de Desempenho) e `plataforma_configurar_empresa`
 * (o MCP de implantação, campo `meta_do_mes`) gravam a meta pelo MESMO upsert:
 * redefinir a meta do mês é o caminho normal (o número muda no meio do
 * trimestre), e a chave de conflito é a do índice `idx_sales_targets_unica_nn`
 * (`nulls not distinct`, migration 0253): lista de colunas, nunca expressão,
 * senão o `ON CONFLICT` morre em `42P10` (a lição registrada na rota).
 *
 * Quem chama decide o cliente (a sessão na tela, o de serviço no MCP) e a
 * permissão (gestor na tela; operação `implantar_configuracao` no MCP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MetaParaGravar {
  organizationId: string;
  /** AAAA-MM: a meta é do mês. */
  periodo: string;
  metrica:
    | "reunioes"
    | "reunioes_realizadas"
    | "receita_total"
    | "receita_recorrente"
    | "receita_avulsa"
    | "receita_originada";
  alvo_cents?: number | null;
  alvo_quantidade?: number | null;
  user_id?: string | null;
  agent_id?: string | null;
  created_by: string | null;
}

export const COLUNAS_DA_META = "id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id";

/** As métricas que se contam em unidades; as outras, em centavos. */
export function metaEDeAtividade(metrica: MetaParaGravar["metrica"]): boolean {
  return metrica === "reunioes" || metrica === "reunioes_realizadas";
}

export async function gravarMeta(db: Pick<SupabaseClient, "from">, meta: MetaParaGravar) {
  const atividade = metaEDeAtividade(meta.metrica);
  return db
    .from("sales_targets")
    .upsert(
      {
        organization_id: meta.organizationId,
        periodo: `${meta.periodo}-01`,
        metrica: meta.metrica,
        alvo_cents: atividade ? null : (meta.alvo_cents ?? null),
        alvo_quantidade: atividade ? (meta.alvo_quantidade ?? null) : null,
        user_id: meta.user_id ?? null,
        agent_id: meta.agent_id ?? null,
        created_by: meta.created_by,
      },
      { onConflict: "organization_id,periodo,metrica,user_id,agent_id" },
    )
    .select(COLUNAS_DA_META)
    .single();
}

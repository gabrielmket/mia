/**
 * FORK MIA (.79, empresa única) — as respostas das rotas de empresa que mais de
 * uma rota dá. Moram fora de `route.ts` porque arquivo de rota do Next só
 * exporta os verbos.
 */
import { fail } from "@/lib/api/wrappers";
import { nomeDaEmpresa } from "@/lib/empresas/fonte-unica";
import { createClient } from "@/lib/supabase/server";

/** A recusa da porta de escrita, na frase que a tela mostra. */
export async function recusaDaGravacao(
  r: { motivo: string; existenteId?: string; detalhe?: string },
  requestId: string,
): Promise<Response> {
  if (r.motivo === "cnpj_ja_cadastrado") {
    const supabase = await createClient();
    const { data } = r.existenteId
      ? await supabase.from("companies").select("id, trade_name, legal_name, normalized_cnpj").eq("id", r.existenteId).maybeSingle()
      : { data: null };
    return fail("cnpj_ja_cadastrado", "Este CNPJ já está cadastrado. Não dá para cadastrar de novo.", 409, {
      requestId,
      details: { existente: data ? { id: data.id, nome: nomeDaEmpresa(data), cnpj: data.normalized_cnpj } : null },
    });
  }
  if (r.motivo === "cnpj_invalido") return fail("validation_failed", "CNPJ tem 14 dígitos.", 422, { requestId });
  if (r.motivo === "empresa_sem_nome") return fail("validation_failed", "A empresa precisa de um nome.", 422, { requestId });
  if (r.motivo === "empresa_nao_encontrada") return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  if (r.motivo === "insufficient_role") return fail("forbidden", "Seu papel não permite esta ação.", 403, { requestId });
  return fail("db_error", r.detalhe ?? "Não consegui gravar a empresa.", 500, { requestId });
}

/** FORK MIA (.98) · A resposta das rotas que gravam um parceiro. */
import { fail, ok } from "@/lib/api/wrappers";
import type { ResultadoDoParceiro } from "@/lib/parceiros/banco";

export function respostaDoParceiro(r: ResultadoDoParceiro, requestId: string): Response {
  if (r.ok) return ok({ parceiro: r.parceiro, criado: r.criado, mudou: r.mudou }, { requestId });
  if (r.motivo === "invalido") return fail("validation_failed", "Confira os campos do parceiro.", 400, { requestId, details: { campos: r.campos } });
  if (r.motivo === "documento_invalido") return fail("validation_failed", "Confira o CPF ou CNPJ: os dígitos não batem.", 400, { requestId });
  if (r.motivo === "documento_de_outro") return fail("conflict", "Este CPF ou CNPJ já é de outro parceiro.", 409, { requestId });
  if (r.motivo === "anonimizado") return fail("conflict", "Este parceiro foi anonimizado e não muda mais.", 409, { requestId });
  if (r.motivo === "nao_encontrado") return fail("not_found", "Parceiro não encontrado.", 404, { requestId });
  return fail("internal_error", "Não foi possível salvar o parceiro. Tente de novo.", 500, { requestId });
}

/**
 * FORK MIA (.96) · A RESPOSTA DAS ROTAS DO PASSO "PAGAMENTO" e a leitura do corpo.
 * Separado da guarda (`./rota.ts`) para os testes provarem a leitura do corpo e a
 * resposta sem montar a sessão.
 */
import { fail, ok } from "@/lib/api/wrappers";

import type { ResultadoDoPasso } from "./servico";

/** A resposta de um resultado do serviço: o passo, ou a recusa com o código. */
export function responder(r: ResultadoDoPasso, requestId: string): Response {
  if (r.ok) return ok({ passo: r.passo }, { requestId });
  return fail(r.code, r.message, r.status, { requestId, ...(r.details === undefined ? {} : { details: r.details }) });
}

/**
 * O corpo em JSON SEM deixar o erro do parse escapar: a mensagem do
 * `JSON.parse` cita o texto recebido (no cartão, seria o número). `null` = não é JSON.
 */
export async function corpoJson(req: Request): Promise<unknown | null> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return null;
  }
}

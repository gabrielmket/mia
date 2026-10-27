/**
 * FORK MIA (.94) · POST /api/v1/assistente/propostas/[id]/ajustar: o "Ajustar"
 * do cartão, antes de aprovar (protótipo "ensina e faz", tela 3).
 *
 * `{ campos: { <campo>: <valor> } }`, os campos que o próprio cartão recebeu do
 * servidor. O ajuste PREPARA de novo, com a sessão de quem ajusta, e regrava o
 * cartão da proposta, que continua pendente: o que o cartão mostra é o que vai
 * ser gravado. Ajusta quem aprova, e quem pediu antes de mandar o pedido.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { ajustarProposta } from "@/lib/assistente/propostas/ajustar";
import { contextoDaRotaDasPropostas } from "@/lib/assistente/propostas/contexto-da-rota";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const corpo = z
  .object({
    campos: z
      .record(z.string().regex(/^[a-z0-9_]{1,20}$/), z.string().max(4096))
      .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 8, "de 1 a 8 campos"),
  })
  .strict();
const parametro = z.string().uuid();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const lidoDoCorpo = corpo.safeParse(await req.json().catch(() => null));
  const { id } = await params;
  const lidoDoId = parametro.safeParse(id);
  if (!lidoDoCorpo.success || !lidoDoId.success) return fail("validation_failed", "Pedido inválido.", 422, { requestId });

  const authz = await requireRole("agent", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const c = await contextoDaRotaDasPropostas(authz);
  const r = await ajustarProposta(
    {
      admin: c.admin,
      db: c.db,
      orgId: c.orgId,
      userId: c.userId,
      papel: c.papel,
      equipe: c.equipe,
      fuso: c.fuso,
      agora: new Date(),
      idioma: c.idioma,
      requestId,
    },
    lidoDoId.data,
    lidoDoCorpo.data.campos,
  );
  if (!r.ok) {
    const status = r.codigo === "nao_encontrada" ? 404 : r.codigo === "sem_permissao" ? 403 : r.codigo === "invalido" ? 422 : 409;
    return fail(r.codigo === "nao_encontrada" ? "not_found" : "state_conflict", t(r.mensagem), status, { requestId, details: { codigo: r.codigo } });
  }
  return ok({ proposta: r.proposta }, { requestId });
}

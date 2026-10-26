/**
 * FORK MIA (.91) — POST /api/v1/assistente/propostas/[id]: decidir uma proposta
 * do assistente. `{ decisao: "aplicar" | "rejeitar" }`.
 *
 *   aplicar   só ADMINISTRADOR. Aprova e aplica numa ida: a peça nasce aqui
 *             (o agente em rascunho, o funil do quadro pronto, o follow-up em
 *             rascunho armado no agente), pelo caminho da implantação
 *   rejeitar  gestor em diante (quem vê o cartão pode recusar)
 *
 * A guarda do suporte vem primeiro (o acompanhamento somente leitura não
 * decide nada); depois o papel, pela sessão; a empresa é a da sessão, nunca do
 * corpo. A escrita é do servidor (`decidirProposta`, cliente de serviço com a
 * empresa em todo filtro), porque a sessão não atualiza a proposta (9080). Cada
 * decisão grava o registro (`assistente.proposta_aplicada` /
 * `_rejeitada` / `_falhou`).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { decidirProposta } from "@/lib/assistente/propostas/decidir";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpo = z.object({ decisao: z.enum(["aplicar", "rejeitar"]) }).strict();
const parametro = z.string().uuid();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const lidoDoCorpo = corpo.safeParse(await req.json().catch(() => null));
  const { id } = await params;
  const lidoDoId = parametro.safeParse(id);
  if (!lidoDoCorpo.success || !lidoDoId.success) {
    return fail("validation_failed", "Pedido inválido.", 422, { requestId });
  }
  const decisao = lidoDoCorpo.data.decisao;

  // Aplicar é só de quem administra; recusar, de quem vê o cartão.
  const authz = await requireRole(decisao === "aplicar" ? "admin" : "manager", {
    requestId,
    resource: "mia_assistente_propostas",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const r = await decidirProposta(
    { admin: createAdminClient(), orgId: authz.org.orgId, userId: authz.user.id, requestId, via: "tela" },
    lidoDoId.data,
    decisao,
  );
  if (!r.ok) {
    const status = r.codigo === "nao_encontrada" ? 404 : r.codigo === "falhou" ? 422 : 409;
    return fail(r.codigo === "nao_encontrada" ? "not_found" : "state_conflict", t(r.mensagem), status, {
      requestId,
      details: { codigo: r.codigo, proposta: r.proposta ?? null },
    });
  }
  return ok({ desfecho: r.desfecho, proposta: r.proposta, avisos: r.avisos }, { requestId });
}

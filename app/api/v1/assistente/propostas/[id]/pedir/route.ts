/**
 * FORK MIA (.94) · POST /api/v1/assistente/propostas/[id]/pedir: o "Pedir a
 * <nome>" do cartão (protótipo "ensina e faz", tela 5, decisão 5).
 *
 * Quem não aprova a peça manda o cartão pronto a quem aprova: a proposta
 * continua pendente, o aviso chega no sino de quem aprova e o cartão aparece
 * em "Pedidos esperando você". Só quem pediu a proposta manda o pedido, só a
 * quem aprova aquele tipo, e só se a empresa deixa pedir. `{ para_user_id? }`:
 * sem ele, vai a quem aprova com o papel mais baixo (a etapa, à gestora; a
 * meta, ao administrador).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { contextoDaRotaDasPropostas } from "@/lib/assistente/propostas/contexto-da-rota";
import { pedirProposta } from "@/lib/assistente/propostas/pedir";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const corpo = z.object({ para_user_id: z.string().uuid().nullish() }).strict();
const parametro = z.string().uuid();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const lidoDoCorpo = corpo.safeParse((await req.json().catch(() => ({}))) ?? {});
  const { id } = await params;
  const lidoDoId = parametro.safeParse(id);
  if (!lidoDoCorpo.success || !lidoDoId.success) return fail("validation_failed", "Pedido inválido.", 422, { requestId });

  const authz = await requireRole("agent", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const rajada = await checkRateLimit(`assistente-pedir:${authz.user.id}`, 5, 600);
  if (!rajada.allowed) return fail("rate_limited", t("Muitos pedidos seguidos. Tente daqui a pouco."), 429, { requestId });

  const c = await contextoDaRotaDasPropostas(authz);
  const r = await pedirProposta(
    { admin: c.admin, orgId: c.orgId, userId: c.userId, nome: c.nome, papel: c.papel, requestId, equipe: c.equipe, podePedir: c.podePedir },
    lidoDoId.data,
    lidoDoCorpo.data.para_user_id ?? null,
  );
  if (!r.ok) {
    const status = r.codigo === "nao_encontrada" ? 404 : r.codigo === "nao_e_sua" || r.codigo === "desligado" ? 403 : 409;
    return fail(r.codigo === "nao_encontrada" ? "not_found" : "state_conflict", t(r.mensagem), status, { requestId, details: { codigo: r.codigo } });
  }
  return ok({ desfecho: r.desfecho, proposta: r.proposta, para: r.para }, { requestId });
}

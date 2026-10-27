/**
 * FORK MIA (.94) · POST /api/v1/assistente/propostas/[id]/desfazer: o
 * "Desfazer" do cartão (protótipo "ensina e faz", tela 3, decisões 4 e 6).
 *
 * Desfaz só o que a própria proposta fez, e só enquanto nada depende disso (a
 * trava é o uso, sem prazo). Desfaz quem aprova aquele tipo. Pelo LOGIN de
 * quem desfaz, com a função da tela (`lib/assistente/propostas/desfazer.ts`, o
 * MESMO caminho de `plataforma_desfazer_proposta_do_assistente`). Desfazer de
 * novo devolve `ja_estava`. A guarda do suporte vem primeiro; a etiqueta pede a
 * verificação em duas etapas, como a tela de Etiquetas.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { contextoDaRotaDasPropostas } from "@/lib/assistente/propostas/contexto-da-rota";
import { desfazerProposta } from "@/lib/assistente/propostas/desfazer";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const parametro = z.string().uuid();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const { id } = await params;
  const lidoDoId = parametro.safeParse(id);
  if (!lidoDoId.success) return fail("validation_failed", "Pedido inválido.", 422, { requestId });

  const authz = await requireRole("agent", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const c = await contextoDaRotaDasPropostas(authz);
  const { data } = await c.admin
    .from("mia_assistente_propostas")
    .select("tipo")
    .eq("organization_id", c.orgId)
    .eq("id", lidoDoId.data)
    .maybeSingle();
  if ((data as { tipo?: string } | null)?.tipo === "etiqueta" && (await mfaEmDivida())) {
    return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });
  }

  const r = await desfazerProposta(
    { db: c.db, admin: c.admin, pelaSessao: true, orgId: c.orgId, userId: c.userId, nome: c.nome, papel: c.papel, requestId, via: "tela" },
    lidoDoId.data,
    { conferirQuem: true },
  );
  if (!r.ok) {
    const status = r.codigo === "nao_encontrada" ? 404 : r.codigo === "sem_permissao" ? 403 : r.codigo === "falhou" ? 422 : 409;
    const codigo = r.codigo === "nao_encontrada" ? "not_found" : r.codigo === "sem_permissao" ? "forbidden_role" : "state_conflict";
    return fail(codigo, t(r.mensagem), status, { requestId, details: { codigo: r.codigo, proposta: r.proposta ?? null } });
  }
  return ok({ desfecho: r.desfecho, proposta: r.proposta, avisos: r.avisos }, { requestId });
}

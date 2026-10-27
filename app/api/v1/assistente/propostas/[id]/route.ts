/**
 * FORK MIA (.91, .94) — POST /api/v1/assistente/propostas/[id]: decidir uma
 * proposta do assistente. `{ decisao: "aplicar" | "rejeitar" }`.
 *
 *   aplicar   quem pode fazer o mesmo na tela (protótipo "ensina e faz",
 *             decisão 1): a gestora aprova a etapa, a atendente a resposta
 *             rápida dela, só o administrador a meta e as três peças do modelo
 *             (decisão 2). A peça nasce aqui, com o LOGIN de quem aprova, pela
 *             função da tela (as três da .91, pelo caminho da implantação)
 *   rejeitar  quem aprova, ou quem pediu (retira o próprio pedido)
 *
 * A guarda do suporte vem primeiro (o acompanhamento somente leitura não
 * decide nada); depois o papel mínimo (atendente), pela sessão; quem aprova
 * AQUELA peça é conferido por `decidirProposta`, no servidor. A etiqueta pede
 * a verificação em duas etapas, como a tela de Etiquetas. A empresa é a da
 * sessão, nunca do corpo. A linha da proposta é escrita pelo servidor (a
 * sessão não a atualiza, 9080), com o registro "via assistente".
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { contextoDaRotaDasPropostas } from "@/lib/assistente/propostas/contexto-da-rota";
import { decidirProposta } from "@/lib/assistente/propostas/decidir";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";

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

  // O piso é o atendente (o somente leitura não decide nada); quem aprova a
  // peça é conferido no servidor, pela regra do tipo.
  const authz = await requireRole("agent", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const c = await contextoDaRotaDasPropostas(authz);
  if (decisao === "aplicar") {
    const { data } = await c.admin
      .from("mia_assistente_propostas")
      .select("tipo")
      .eq("organization_id", c.orgId)
      .eq("id", lidoDoId.data)
      .maybeSingle();
    if ((data as { tipo?: string } | null)?.tipo === "etiqueta" && (await mfaEmDivida())) {
      return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });
    }
  }

  const r = await decidirProposta(
    {
      admin: c.admin,
      db: c.db,
      pelaSessao: true,
      orgId: c.orgId,
      userId: c.userId,
      papel: c.papel,
      nome: c.nome,
      requestId,
      via: "tela",
      conferirQuem: true,
    },
    lidoDoId.data,
    decisao,
  );
  if (!r.ok) {
    const status = r.codigo === "nao_encontrada" ? 404 : r.codigo === "sem_permissao" ? 403 : r.codigo === "falhou" ? 422 : 409;
    const codigo = r.codigo === "nao_encontrada" ? "not_found" : r.codigo === "sem_permissao" ? "forbidden_role" : "state_conflict";
    return fail(codigo, t(r.mensagem), status, { requestId, details: { codigo: r.codigo, proposta: r.proposta ?? null } });
  }
  return ok({ desfecho: r.desfecho, proposta: r.proposta, avisos: r.avisos }, { requestId });
}

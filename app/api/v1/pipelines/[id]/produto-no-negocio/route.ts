/**
 * FORK MIA (.109) · GET /api/v1/pipelines/[id]/produto-no-negocio
 * (docs/fork/produto-no-negocio.md).
 *
 * A palavra do funil para o que o negócio vende e as duas opções (pedir o
 * produto ao marcar como ganho, mostrar o valor recorrente), mais o que a janela
 * de ganho precisa (o nome do ganho e os motivos). Quem lê é o Novo negócio, que
 * esconde o valor recorrente, e a janela de ganho; o quadro já tem o funil.
 *
 * Qualquer papel lê, pela sessão (RLS de `crm_pipelines`). Gravar é pela tela de
 * Funis (`updatePipelineConfig`) e pelo MCP de plataforma.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerFunilDoProduto } from "@/lib/produto-no-negocio/servidor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const naoAchou = () =>
    fail("not_found", traduzir("Funil não encontrado.", authz.user.idioma), 404, { requestId });
  if (!z.string().uuid().safeParse(id).success) return naoAchou();
  try {
    const funil = await lerFunilDoProduto(await createClient(), authz.org.orgId, id);
    return funil ? ok(funil, { requestId }) : naoAchou();
  } catch (e) {
    return fail("internal_error", e instanceof Error ? e.message : String(e), 500, { requestId });
  }
}

import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/pipelines — lista os funis da org ativa (nome + slug), RLS-scoped.
 * Existia só o handler interno (usado pelo MCP); expõe REST pro Select de
 * pipeline do CreateSourceDialog (feature Webhooks).
 *
 * POST /api/v1/pipelines — cria um funil COM as etapas com que ele nasce.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { respostaDeRecusa } from "@/lib/api/recusa";
import { requireRole } from "@/lib/auth/require-role";
import { criarFunil } from "@/lib/pipelines/pipeline-operations";
import { createClient } from "@/lib/supabase/server";
import { corpo } from "./_funis";
import { listPipelinesHandler } from "./_handler";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const supabase = await createClient();
  try {
    const { pipelines } = await listPipelinesHandler(supabase, {
      organization_id: authz.org.orgId,
      actor: { type: "user", id: authz.user.id },
      requestId,
    });
    return ok(pipelines, { requestId });
  } catch {
    return fail("internal_error", t("Falha ao listar funis."), 500, { requestId });
  }
}

// `.max(80)`: o nome é o título de uma linha da lista e o topo do quadro, não um
// parágrafo. O banco não limita, mas a tela quebra muito antes disso.
const bodySchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(280).nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", t("Corpo não é JSON válido."), 400, { requestId });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", t("Dê um nome ao funil — é o que aparece na lista."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  // FORK MIA: a criação (validar o nome, slug, posição, padrão do primeiro funil,
  // etapas iniciais e a compensação) mora em `lib/pipelines/pipeline-operations.ts`,
  // compartilhada com o MCP de plataforma. Aqui só há transporte.
  const supabase = await createClient();
  try {
    const { funis } = await criarFunil(
      {
        supabase,
        organizationId: orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      { name: parsed.data.name, description: parsed.data.description },
    );
    return ok(corpo(funis), { status: 201, requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}

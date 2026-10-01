/**
 * POST /api/v1/agenda/agendamentos/{id}/microsoft/resolver: a pessoa responsável
 * decide o conflito com o Outlook, ou pede nova tentativa.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.8). Espelha
 * `.../google/resolver` do upstream: a decisão vale para a comparação que ela
 * viu (revisões e etag conferidos no banco), e o Outlook é relido antes de
 * aplicar.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "agenda" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const parsed = z
    .object({
      expected_domain_revision: z.string(),
      expected_local_revision: z.string(),
      etag: z.string().nullable(),
      choice: z.enum(["outlook", "local", "preserve_remote", "retry"]),
    })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return fail("validation_failed", "Atualize o compromisso antes de decidir.", 422, { requestId });
  }
  const { error } = await (await createClient()).rpc("fn_mia_agenda_microsoft_resolver", {
    p_org: auth.org.orgId,
    p_id: id,
    p_revision: parsed.data.expected_domain_revision,
    p_local_revision: parsed.data.expected_local_revision,
    p_etag: parsed.data.etag,
    p_escolha: parsed.data.choice,
  } as never);
  if (error) {
    const desatualizada = error.code === "40001";
    return fail(
      desatualizada ? "conflict" : "forbidden",
      desatualizada
        ? "O compromisso mudou. Atualize a comparação antes de decidir."
        : "Esta decisão pertence ao responsável pelo compromisso.",
      desatualizada ? 409 : 403,
      { requestId },
    );
  }
  void audit({
    action: "agenda.microsoft.decisao_registrada",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: "calendar_appointment",
    resourceId: id,
    requestId,
    metadata: { choice: parsed.data.choice },
  });
  return ok({ pending: true }, { requestId });
}

/**
 * POST /api/v1/agenda/microsoft/calendarios/atualizar: relê a lista de agendas
 * de uma conta do Outlook da própria pessoa ("Atualizar lista").
 *
 * FORK MIA. Espelha `/api/v1/agenda/google/calendarios/atualizar` do upstream.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { atualizarCatalogoMicrosoft } from "@/lib/agenda/microsoft/calendar-executor";
import { garantirAssinaturas } from "@/lib/agenda/microsoft/notificacoes";
import { tokenDaConexaoMicrosoft } from "@/lib/agenda/microsoft/conexao";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "agenda" });
  if (!auth.ok) return auth.response;
  const parsed = z.object({ connection_id: z.uuid() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Confira a conexão escolhida.", 422, { requestId });

  const { data, error } = await (await createClient())
    .from("mia_agenda_microsoft_conexoes")
    .select("id")
    .eq("organization_id", auth.org.orgId)
    .eq("user_id", auth.user.id)
    .eq("id", parsed.data.connection_id)
    .maybeSingle();
  if (error || !data) return fail("not_found", "Conexão indisponível.", 404, { requestId });

  const admin = createAdminClient();
  try {
    await atualizarCatalogoMicrosoft(admin, auth.org.orgId, data.id);
    const token = await tokenDaConexaoMicrosoft(admin, auth.org.orgId, data.id);
    await garantirAssinaturas(admin, auth.org.orgId, data.id, token);
    // A lista nova já vale para a próxima leitura: todas as agendas desta conta
    // entram na fila agora, sem esperar os 15 minutos.
    await admin
      .from("mia_agenda_microsoft_calendarios")
      .update({ proxima_leitura_em: new Date().toISOString() })
      .eq("organization_id", auth.org.orgId)
      .eq("conexao_id", data.id);
    void audit({
      action: "agenda.microsoft.catalogo_atualizado",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "mia_agenda_microsoft_conexoes",
      resourceId: data.id,
      requestId,
    });
    return ok({ refreshed: true }, { requestId });
  } catch {
    return fail("conflict", "Não foi possível atualizar. Confira a conexão e tente novamente.", 409, { requestId });
  }
}

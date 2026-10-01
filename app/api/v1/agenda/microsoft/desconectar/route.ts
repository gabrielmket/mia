/**
 * DELETE /api/v1/agenda/microsoft/desconectar: a pessoa desliga o Outlook.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md). O mesmo contrato do desconectar do
 * Google do upstream: desconectar a agenda de OUTRA pessoa é ato de gestão
 * (`manager`); a ocupação que veio do Outlook sai na hora (senão ela seguiria
 * bloqueando horário de uma agenda que ninguém lê mais); os tokens são apagados
 * e a conexão fica `disconnected`, o único estado que uma pessoa decide. As
 * assinaturas de notificação são canceladas na Microsoft antes (melhor esforço:
 * a Graph as expira sozinha em até 7 dias).
 */

import { type NextRequest } from "next/server";
import { z } from "zod";

import { tokenDaConexaoMicrosoft } from "@/lib/agenda/microsoft/conexao";
import { apagarAssinaturasDaConexao } from "@/lib/agenda/microsoft/notificacoes";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpo = z.object({ user_id: z.string().uuid().optional() }).strict();

export async function DELETE(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const autorizado = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!autorizado.ok) return autorizado.response;
  const t = (texto: string) => traduzir(texto, autorizado.user.idioma);
  const { user, org } = autorizado;

  const lido = corpo.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", t("Corpo inválido para desconectar."), 422, { requestId });
  let alvo = user.id;
  if (lido.data.user_id && lido.data.user_id !== user.id) {
    const gestor = await requireRole("manager", { requestId, resource: "calendar_connections" });
    if (!gestor.ok) return gestor.response;
    alvo = lido.data.user_id;
  }

  const admin = createAdminClient();
  const { data: conexoes, error } = await admin
    .from("mia_agenda_microsoft_conexoes")
    .select("id, conta_email, status")
    .eq("organization_id", org.orgId)
    .eq("user_id", alvo)
    .neq("status", "disconnected");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!conexoes || conexoes.length === 0) {
    return fail("not_found", t("Não há agenda do Outlook conectada para esta pessoa."), 404, { requestId });
  }

  for (const conexao of conexoes as Array<{ id: string; conta_email: string; status: string }>) {
    let token: string | null = null;
    try {
      token = await tokenDaConexaoMicrosoft(admin, org.orgId, conexao.id);
    } catch {
      token = null;
    }
    await apagarAssinaturasDaConexao(admin, org.orgId, conexao.id, token);

    const { error: erroEventos } = await admin
      .from("mia_agenda_microsoft_eventos")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("conexao_id", conexao.id);
    if (erroEventos) return fail("internal_error", erroEventos.message, 500, { requestId });

    const { error: erroCalendarios } = await admin
      .from("mia_agenda_microsoft_calendarios")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("conexao_id", conexao.id);
    if (erroCalendarios) return fail("internal_error", erroCalendarios.message, 500, { requestId });

    const { error: erroConexao } = await admin
      .from("mia_agenda_microsoft_conexoes")
      .update({
        status: "disconnected",
        access_token_cifrado: null,
        refresh_token_cifrado: null,
        token_expira_em: null,
        ultimo_erro: null,
      })
      .eq("organization_id", org.orgId)
      .eq("id", conexao.id);
    if (erroConexao) return fail("internal_error", erroConexao.message, 500, { requestId });

    await audit({
      action: "agenda.microsoft.conexao_desconectada",
      organizationId: org.orgId,
      resourceType: "mia_agenda_microsoft_conexoes",
      resourceId: conexao.id,
      metadata: { user_id: alvo, por: user.id, conta: conexao.conta_email },
    });
  }

  return ok({ desconectadas: conexoes.length }, { requestId });
}

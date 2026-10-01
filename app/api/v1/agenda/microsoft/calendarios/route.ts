/**
 * GET/PATCH /api/v1/agenda/microsoft/calendarios: as agendas do Outlook da
 * pessoa, e a escolha de fontes e destino entre Google e Outlook.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.5). O GET espelha o
 * `/api/v1/agenda/google/calendarios` do upstream (pela sessão, com a RLS de
 * "dono ou gerente"). O PATCH grava as DUAS listas numa transação só
 * (`fn_mia_agenda_selecao`): um destino por pessoa, entre os dois provedores.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const coberturaSchema = z
  .object({ window_start: z.string(), window_end: z.string(), completed_at: z.string() })
  .passthrough();

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "agenda" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const org = auth.org.orgId;

  const { data: conexoes, error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .select("id, conta_email, tipo_de_conta, status, ultimo_erro, ultima_leitura_em, revisao_da_escolha")
    .eq("organization_id", org)
    .eq("user_id", auth.user.id)
    .neq("status", "disconnected")
    .order("id");
  if (error) return fail("internal_error", "Não foi possível carregar suas agendas.", 500, { requestId });
  if (!conexoes?.length) return ok({ connections: [], calendars: [] }, { requestId });

  const { data: calendarios, error: ce } = await db
    .from("mia_agenda_microsoft_calendarios")
    .select(
      "id, conexao_id, nome, padrao, papel, disponivel, conta_como_ocupado, destino, reunioes_permitidas, ultima_leitura_em, erro_de_leitura, cobertura, assinatura_expira_em, assinatura_erro, ultima_notificacao_em",
    )
    .eq("organization_id", org)
    .in(
      "conexao_id",
      conexoes.map((c) => c.id),
    )
    .order("nome");
  if (ce) return fail("internal_error", "Não foi possível carregar suas agendas.", 500, { requestId });

  const saudavel = (conexaoId: string) => conexoes.some((c) => c.id === conexaoId && c.status === "healthy");
  return ok(
    {
      connections: conexoes.map((c) => ({
        id: c.id,
        account_email: c.conta_email,
        account_kind: c.tipo_de_conta,
        status: c.status,
        last_sync_error: c.ultimo_erro,
        last_sync_at: c.ultima_leitura_em,
        selection_revision: String(c.revisao_da_escolha),
      })),
      calendars: (calendarios ?? []).map((k) => ({
        id: k.id,
        connection_id: k.conexao_id,
        name: k.nome,
        is_default: k.padrao,
        counts_for_conflicts: k.conta_como_ocupado,
        is_destination: k.destino,
        can_read: k.disponivel && saudavel(k.conexao_id),
        can_write: k.disponivel && saudavel(k.conexao_id) && (k.papel === "owner" || k.papel === "writer"),
        teams: (k.reunioes_permitidas ?? []).includes("teamsForBusiness"),
        last_sync_at: k.ultima_leitura_em,
        sync_error: k.erro_de_leitura,
        sync_coverage: coberturaSchema.safeParse(k.cobertura).success ? coberturaSchema.parse(k.cobertura) : null,
        realtime: Boolean(k.assinatura_expira_em && Date.parse(k.assinatura_expira_em) > Date.now()),
        realtime_error: k.assinatura_erro,
      })),
    },
    { requestId },
  );
}

const revisoesSchema = z
  .array(z.object({ connection_id: z.uuid(), revision: z.string().regex(/^\d+$/) }).strict())
  .max(100);

const escolhaSchema = z
  .object({
    revisions: z.object({ google: revisoesSchema, microsoft: revisoesSchema }).strict(),
    sources: z.object({ google: z.array(z.uuid()).max(1000), microsoft: z.array(z.uuid()).max(1000) }).strict(),
    destination: z.object({ provider: z.enum(["google", "microsoft"]), id: z.uuid() }).strict(),
  })
  .strict();

export async function PATCH(req: Request) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "agenda" });
  if (!auth.ok) return auth.response;
  const parsed = escolhaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Confira as agendas escolhidas.", 422, { requestId });

  const db = await createClient();
  const { error } = await db.rpc("fn_mia_agenda_selecao", {
    p_org: auth.org.orgId,
    p_revisoes: parsed.data.revisions,
    p_fontes_google: parsed.data.sources.google,
    p_fontes_microsoft: parsed.data.sources.microsoft,
    p_destino_provedor: parsed.data.destination.provider,
    p_destino: parsed.data.destination.id,
  } as never);
  if (error) {
    const desatualizada = error.code === "40001";
    return fail(
      desatualizada ? "conflict" : "forbidden",
      desatualizada
        ? "Suas agendas mudaram. Atualize a lista antes de salvar."
        : "Escolha agendas disponíveis das suas próprias contas.",
      desatualizada ? 409 : 403,
      { requestId },
    );
  }
  void audit({
    action: "agenda.selecao_atualizada",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    requestId,
    metadata: {
      destino: parsed.data.destination,
      fontes_google: parsed.data.sources.google.length,
      fontes_microsoft: parsed.data.sources.microsoft.length,
    },
  });
  return ok({ saved: true }, { requestId });
}

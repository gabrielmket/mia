/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md).
 *
 * GET /api/v1/admin/coexistencia — a tabela "Coexistência por empresa" de
 *     /admin/meta: cada empresa com a chave, o número pelo app e a
 *     sincronização (só estados e contagens).
 * PUT /api/v1/admin/coexistencia — { organization_id, ligada }: liga ou
 *     desliga a chave. Escrita de plataforma: scope `full` e MFA em dia.
 *
 * A regra (recusas e aviso de número que continua) mora em
 * `lib/channels/meta/coexistencia/ligar.ts`, a mesma do MCP de plataforma.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { chavesDaCoexistencia } from "@/lib/channels/meta/coexistencia/chave";
import { numerosPeloApp } from "@/lib/channels/meta/coexistencia/leitura";
import { ligarCoexistencia } from "@/lib/channels/meta/coexistencia/ligar";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const mudarSchema = z.object({
  organization_id: z.string().uuid(),
  ligada: z.boolean(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, display_name, status, demonstracao")
    .is("redacted_at", null)
    .order("display_name", { ascending: true })
    .limit(1000);
  if (error) return fail("db_error", error.message, 500, { requestId });
  const empresas = (orgs ?? []) as Array<{ id: string; display_name: string | null; status: string | null; demonstracao?: boolean | null }>;
  const ids = empresas.map((o) => o.id);

  try {
    const [chaves, numeros] = await Promise.all([chavesDaCoexistencia(admin, ids), numerosPeloApp(admin, ids)]);
    return ok(
      {
        empresas: empresas.map((o) => {
          const chave = chaves.get(o.id) ?? { ligada: false, mudadaPor: null, mudadaEm: null };
          return {
            organization_id: o.id,
            nome: o.display_name,
            status: o.status,
            demonstracao: o.demonstracao === true,
            ligada: chave.ligada,
            mudada_em: chave.mudadaEm,
            mudada_por: chave.mudadaPor,
            numeros: numeros.get(o.id) ?? [],
          };
        }),
      },
      { requestId },
    );
  } catch (err) {
    return fail("db_error", err instanceof Error ? err.message : String(err), 500, { requestId });
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  let userId: string;
  try {
    const ctx = await requirePlatformAdminEscrita();
    userId = ctx.user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = mudarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const organizationId = parsed.data.organization_id;

  const admin = createAdminClient();
  const r = await ligarCoexistencia(admin, { organizationId, ligada: parsed.data.ligada, userId });
  if (!r.ok) {
    const status = r.motivo === "nao_existe" ? 404 : r.motivo === "falha" ? 500 : 409;
    return fail(r.motivo === "falha" ? "db_error" : "conflict", r.mensagem, status, { requestId, details: { motivo: r.motivo } });
  }

  if (!r.jaEstava) {
    void audit({
      action: "platform.coexistencia_alterada",
      actorUserId: userId,
      organizationId,
      resourceType: "organization",
      resourceId: organizationId,
      requestId,
      metadata: { ligada: parsed.data.ligada, numeros_que_continuam: r.numerosQueContinuam.length },
    });
  }

  return ok(
    {
      organization_id: organizationId,
      ligada: r.chave.ligada,
      ja_estava: r.jaEstava,
      mudada_em: r.chave.mudadaEm,
      numeros_que_continuam: r.numerosQueContinuam,
    },
    { requestId },
  );
}

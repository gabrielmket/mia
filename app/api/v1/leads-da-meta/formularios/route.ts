/**
 * FORK MIA — PUT /api/v1/leads-da-meta/formularios: escolher um formulário da
 * Meta para importar (ou mudar o destino dele, ou pausá-lo).
 *
 * Admin. Uma linha por formulário e empresa (índice único da 9003): salvar de
 * novo o mesmo formulário ATUALIZA, e a marca de leitura fica onde estava —
 * mudar o funil não pode fazer a importação recomeçar do zero e duplicar nada.
 *
 * Funil e etapa são conferidos contra a EMPRESA da sessão, e a etapa contra o
 * funil: um id de outra empresa vindo no corpo seria um negócio criado no funil
 * do vizinho pela rotina, que usa o service role.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const idDaMeta = z.string().regex(/^\d{1,30}$/, "Id da Meta inválido.");

const formularioSchema = z
  .object({
    page_id: idDaMeta,
    page_name: z.string().max(300).nullable().optional(),
    form_id: idDaMeta,
    form_name: z.string().max(300).nullable().optional(),
    perguntas: z.record(z.string().max(200), z.string().max(500)).optional(),
    pipeline_id: z.string().uuid(),
    stage_id: z.string().uuid(),
    ativo: z.boolean(),
  })
  .strict();

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "leads_da_meta" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const admin = createAdminClient();
  if (!(await leadsDaMetaLiberados(admin, org))) {
    return fail(
      "forbidden",
      "A importação dos leads da Meta não está contratada para esta empresa.",
      403,
      {
        requestId,
      },
    );
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = formularioSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Formulário inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const f = parsed.data;

  const { data: etapa } = await admin
    .from("crm_stages")
    .select("id, pipeline_id")
    .eq("organization_id", org)
    .eq("id", f.stage_id)
    .maybeSingle();
  if (!etapa || etapa.pipeline_id !== f.pipeline_id) {
    return fail("validation_failed", "Essa etapa não pertence a um funil desta empresa.", 422, {
      requestId,
    });
  }

  const agora = new Date().toISOString();
  const { data: salvo, error } = await admin
    .from("mia_leads_da_meta_formularios")
    .upsert(
      {
        organization_id: org,
        page_id: f.page_id,
        page_name: f.page_name ?? null,
        form_id: f.form_id,
        form_name: f.form_name ?? null,
        perguntas: f.perguntas ?? {},
        pipeline_id: f.pipeline_id,
        stage_id: f.stage_id,
        ativo: f.ativo,
        atualizado_em: agora,
        atualizado_por: authz.user.id,
      },
      { onConflict: "organization_id,form_id" },
    )
    .select("id, form_id, ativo, pipeline_id, stage_id, lido_ate")
    .maybeSingle();
  if (error || !salvo) {
    return fail("internal_error", "Não consegui salvar o formulário.", 500, { requestId });
  }

  void audit({
    action: "leads_da_meta.formulario_salvo",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "mia_leads_da_meta_formularios",
    resourceId: salvo.id as string,
    requestId,
    metadata: {
      form_id: f.form_id,
      page_id: f.page_id,
      pipeline_id: f.pipeline_id,
      stage_id: f.stage_id,
      ativo: f.ativo,
    },
  });

  return ok(salvo, { requestId });
}

"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { respostaParaOperador } from "@/lib/erros/para-operador";
import {
  pipelineConfigPatchSchema,
  type PipelineConfigPatch,
} from "@/lib/schemas/settings";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { gravarConfiguracaoDoFunil } from "@/lib/pipelines/pipeline-config";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";

export type UpdatePipelineConfigResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updatePipelineConfig(
  pipelineId: string,
  patch: PipelineConfigPatch,
): Promise<UpdatePipelineConfigResult> {
  if (!pipelineId || typeof pipelineId !== "string") {
    return { ok: false, error: "invalid_request" };
  }
  const parsed = pipelineConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(authUser, activeOrg)) {
    return { ok: false, error: "forbidden_role" };
  }
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  // FORK MIA: a mescla e a gravação moram em `lib/pipelines/pipeline-config.ts`,
  // compartilhadas com o MCP de plataforma. A recusa do upstream v1.86 (#2791:
  // campo que vira do Contato e que uma regra ativa do gatilho por data lê) foi
  // para lá, para valer também no MCP.
  const gravado = await gravarConfiguracaoDoFunil(supabase, {
    organizationId: activeOrg.orgId,
    pipelineId,
    patch: parsed.data,
    idioma: authUser.idioma,
  });
  if (!gravado.ok) {
    // Upstream v1.98 (#3747): a frase da tela vem do mapeador; o texto do
    // Postgres fica no log.
    if (gravado.falhaDoBanco) {
      return respostaParaOperador(gravado.falhaDoBanco.erro, {
        contexto:
          gravado.falhaDoBanco.etapa === "ler"
            ? "[pipeline.config] falha ao ler o pipeline"
            : "[pipeline.config] falha ao gravar a configuração do pipeline",
        idioma: authUser.idioma,
        campos: { pipeline_id: pipelineId },
      });
    }
    return { ok: false, error: gravado.error };
  }

  await audit({
    action: "pipeline.config_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: {
      vocabulary_changed: !!parsed.data.vocabulary,
      fields_count: parsed.data.fields?.length ?? null,
      lost_reasons_count: parsed.data.lost_reasons?.length ?? null,
      won_reasons_count: parsed.data.won_reasons?.length ?? null,
      won_reason_required: parsed.data.won_reason_required ?? null,
      reabertura: parsed.data.reabertura ?? null,
      entrada_do_inbox_ativa: parsed.data.entrada_do_inbox?.ativa ?? null,
      // #2995: quantos cards o quadro deixa de mostrar é decisão de quem opera
      // — a auditoria registra o número (ou `0`, o desligamento).
      ocultar_encerrados_dias: parsed.data.ocultar_encerrados_dias ?? null,
      // #3487: quantos atalhos o funil passa a oferecer. O CONTEÚDO não entra
      // na auditoria de propósito — o link montado carrega dado do cliente, e a
      // auditoria é lida por quem administra, não necessariamente por quem vê o
      // contato.
      atalhos_count: parsed.data.atalhos?.length ?? null,
    },
  });

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

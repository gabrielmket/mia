/**
 * FORK MIA — POST /api/v1/leads-da-meta/ler-agora: a mesma rodada da rotina de 5
 * em 5 minutos, só para a empresa da sessão, na hora.
 *
 * Existe para quem acabou de configurar (ou de criar um lead de teste na
 * ferramenta da Meta) ver o resultado sem esperar o relógio. O resultado volta na
 * resposta e fica no histórico, igual ao da rotina.
 *
 * Admin, e com teto de 4 por minuto por empresa: cada clique gasta chamadas na
 * cota da Meta da empresa, e a cota que acaba é a mesma que a rotina usa.
 */
import { randomUUID } from "node:crypto";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { rodarLeadsDaMeta } from "@/lib/leads-da-meta/rodada";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
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

  const limite = await checkRateLimit(`leads_da_meta_ler_agora:${org}`, 4, 60);
  if (!limite.allowed) {
    // 422 e não 429: o cliente de API re-tenta 429 sozinho, e cada tentativa
    // gastaria cota na Meta (mesma razão de `app/api/v1/ads/meta/_falha.ts`).
    return fail("rate_limited", "Muitas leituras seguidas. Espere um minuto.", 422, { requestId });
  }

  const { data: config } = await admin
    .from("mia_leads_da_meta_config")
    .select("ativo")
    .eq("organization_id", org)
    .maybeSingle();
  if (!config?.ativo) {
    return fail("validation_failed", "Ligue a importação antes de ler.", 422, { requestId });
  }

  let resumo;
  try {
    resumo = await rodarLeadsDaMeta(admin, { requestId, organizationId: org });
  } catch {
    return fail(
      "internal_error",
      "A leitura falhou antes de começar. Tente de novo em instantes.",
      500,
      {
        requestId,
      },
    );
  }

  void audit({
    action: "leads_da_meta.lido_agora",
    actorUserId: authz.user.id,
    organizationId: org,
    requestId,
    metadata: {
      formularios: resumo.formularios,
      novos: resumo.novos,
      repetidos: resumo.repetidos,
      recusados: resumo.recusados,
      erros: resumo.erros,
    },
  });

  return ok(
    {
      formularios: resumo.formularios,
      novos: resumo.novos,
      repetidos: resumo.repetidos,
      recusados: resumo.recusados,
      erros: resumo.erros,
      por_formulario: resumo.porFormulario.map((p) => ({
        formulario_id: p.formularioId,
        status: p.status,
        motivo: p.motivo,
        novos: p.novos,
        repetidos: p.repetidos,
        recusados: p.recusados,
      })),
    },
    { requestId },
  );
}

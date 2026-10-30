/**
 * FORK MIA (.98) · POST /api/v1/admin/repasses/extratos: "Mandar os extratos por
 * e-mail" de um mês já fechado, para todos os parceiros dele (de novo, inclusive).
 * O fechamento manda sozinho no dia configurado; aqui é a repetição à mão. Escrita
 * com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { mandarExtratos } from "@/lib/parceiros/extrato";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.strictObject({ competencia: z.string().regex(/^\d{4}-\d{2}-01$/) });

export async function POST(req: Request) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Escolha o mês.", 400, { requestId });
  const r = await mandarExtratos(admin, corpo.data.competencia, { reenviar: true });
  void audit({
    action: "repasse.extratos_enviados",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_repasses",
    requestId,
    metadata: { competencia: corpo.data.competencia, ...r },
  });
  return ok(r, { requestId });
}

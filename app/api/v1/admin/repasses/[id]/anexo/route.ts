/**
 * FORK MIA (.98) · POST e GET /api/v1/admin/repasses/[id]/anexo: a nota (CNPJ) ou
 * o recibo (CPF) que o parceiro manda e a Time anexa ao repasse (decisão 2). Sem o
 * anexo, o repasse fica "aguardando nota" e não dá para marcar como pago. O
 * arquivo mora no bucket privado `mia-repasses`; o GET devolve um link assinado de
 * 5 minutos. Escrita com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { anexarAoRepasse, linkDoAnexo, TETO_DO_ANEXO } from "@/lib/parceiros/repasses";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Repasse não encontrado.", 404, { requestId });
  }
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof Blob) || arquivo.size === 0) return fail("validation_failed", "Escolha o arquivo da nota ou do recibo.", 400, { requestId });
  if (arquivo.size > TETO_DO_ANEXO) return fail("validation_failed", "O arquivo passa de 10 MB.", 413, { requestId });
  const nome = arquivo instanceof File ? arquivo.name : "anexo";
  const r = await anexarAoRepasse(admin, { repasseId: id, arquivo, nome, tipo: arquivo.type, ator });
  if (!r.ok) {
    if (r.motivo === "nao_encontrado") return fail("not_found", "Repasse não encontrado.", 404, { requestId });
    if (r.motivo === "ja_pago") return fail("conflict", "Este repasse já foi pago: o anexo não muda mais.", 409, { requestId });
    if (r.motivo === "tipo_invalido") return fail("validation_failed", "Use PDF, XML, PNG ou JPG.", 400, { requestId });
    if (r.motivo === "grande_demais") return fail("validation_failed", "O arquivo passa de 10 MB.", 413, { requestId });
    return fail("internal_error", "Não foi possível guardar o arquivo. Tente de novo.", 500, { requestId });
  }
  void audit({
    action: "repasse.anexo_gravado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_repasses",
    resourceId: id,
    requestId,
    metadata: { tipo: arquivo.type, bytes: arquivo.size },
  });
  return ok({ repasse: r.repasse }, { requestId });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Repasse não encontrado.", 404, { requestId });
  const url = await linkDoAnexo(admin, id);
  if (!url) return fail("not_found", "Este repasse não tem anexo.", 404, { requestId });
  return ok({ url }, { requestId });
}

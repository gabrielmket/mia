/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/imagens: a imagem de um bloco
 * de campanha. Até 1 MB, PNG, JPEG ou GIF.
 *
 * Mora no bucket PÚBLICO `email-marketing-imagens` (9065): a imagem de um
 * e-mail é aberta pelo programa de e-mail de quem recebe, sem sessão e por
 * anos, e um link assinado venceria. Por isso só entra material de campanha:
 * nada de contato, nada de conversa. O caminho é `<empresa>/<uuid>.<ext>`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const BUCKET_DAS_IMAGENS = "email-marketing-imagens";
const TAMANHO_MAXIMO = 1024 * 1024;
const TIPOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

/** Os primeiros bytes de cada formato: o tipo declarado pelo navegador não basta. */
function tipoPelosBytes(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("validation_failed", "Envio inválido.", 422, { requestId: porta.requestId });
    }
    const arquivo = form.get("file");
    if (!(arquivo instanceof File))
      return fail("validation_failed", "Escolha uma imagem.", 422, { requestId: porta.requestId });
    if (arquivo.size > TAMANHO_MAXIMO)
      return fail("payload_too_large", "A imagem passa de 1 MB.", 413, {
        requestId: porta.requestId,
      });
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const tipo = tipoPelosBytes(bytes);
    if (!tipo || !TIPOS[tipo])
      return fail("validation_failed", "Use PNG, JPEG ou GIF.", 422, {
        requestId: porta.requestId,
      });
    const caminho = `${porta.org.orgId}/${randomUUID()}.${TIPOS[tipo]}`;
    const { error } = await porta.admin.storage
      .from(BUCKET_DAS_IMAGENS)
      .upload(caminho, bytes, { contentType: tipo, upsert: false });
    if (error)
      return fail("upload_failed", "Não consegui guardar a imagem.", 500, {
        requestId: porta.requestId,
      });
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET_DAS_IMAGENS}/${caminho}`;
    void audit({
      action: "email_marketing.imagem_enviada",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "storage",
      // A coluna é uuid: o caminho do arquivo vai no metadata.
      resourceId: null,
      requestId: porta.requestId,
      metadata: { caminho, tipo, tamanho: arquivo.size },
    });
    return ok({ url, caminho }, { requestId: porta.requestId, status: 201 });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

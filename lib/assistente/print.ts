/**
 * FORK MIA (.88) — o print do chamado no bucket privado `mia-assistente` (9050).
 *
 * Sem policy em `storage.objects`: só o servidor lê e grava, e a tela recebe
 * link assinado de 60 segundos. A chave é `<org>/<chamado>/<uuid>.<ext>`, e o
 * banco confere que o primeiro pedaço é a empresa do chamado. O print que nada
 * mais aponta vai para a fila de remoção pelo gatilho da 9050.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET_DO_ASSISTENTE = "mia-assistente";
export const TETO_DO_PRINT_EM_BYTES = 10 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function validarPrint(mime: string, bytes: number): { ok: true; ext: string } | { ok: false; motivo: string } {
  const ext = EXTENSAO[mime];
  if (!ext) return { ok: false, motivo: "O print precisa ser uma imagem PNG, JPG ou WEBP." };
  if (bytes <= 0) return { ok: false, motivo: "O arquivo do print veio vazio." };
  if (bytes > TETO_DO_PRINT_EM_BYTES) return { ok: false, motivo: "O print passa de 10 MB." };
  return { ok: true, ext };
}

export async function guardarPrint(
  admin: SupabaseClient,
  entrada: { organizationId: string; chamadoId: string; conteudo: Buffer; mime: string; ext: string },
): Promise<string> {
  const caminho = `${entrada.organizationId}/${entrada.chamadoId}/${randomUUID()}.${entrada.ext}`;
  const { error } = await admin.storage
    .from(BUCKET_DO_ASSISTENTE)
    .upload(caminho, entrada.conteudo, { contentType: entrada.mime, upsert: false });
  if (error) throw new Error(`não consegui guardar o print: ${error.message}`);
  return caminho;
}

export async function linkDoPrint(admin: SupabaseClient, caminho: string): Promise<string | null> {
  const { data, error } = await admin.storage.from(BUCKET_DO_ASSISTENTE).createSignedUrl(caminho, 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function descartarPrint(admin: SupabaseClient, caminho: string): Promise<void> {
  await admin.storage.from(BUCKET_DO_ASSISTENTE).remove([caminho]).catch(() => undefined);
}

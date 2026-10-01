/**
 * FORK MIA — OBRIGAÇÕES · o ARQUIVO do documento, em área privada.
 *
 * Bucket `mia-obrigacoes` (migration 9018): privado, sem policy. Só o servidor
 * lê e grava; a tela recebe um link assinado de vida curta, depois que a rota
 * conferiu o papel e leu o item pela RLS de quem pediu. É o desenho do anexo de
 * nota interna (`internal-media`).
 *
 * ── O arquivo que veio pelo WhatsApp é COPIADO ────────────────────────────
 *
 * A mídia da conversa mora em `whatsapp-media` e é apagada pela retenção (365
 * dias por padrão). Um alvará que vale três anos não pode sumir no primeiro: ao
 * confirmar a proposta do agente, o arquivo é copiado para cá e passa a seguir
 * a vida do item, e não a da conversa.
 *
 * ── A chave ───────────────────────────────────────────────────────────────
 *
 * `<organização>/<item>/<uuid>.<ext>`: só hexadecimal, hífen, ponto e barra,
 * dentro do alfabeto que o Storage aceita. O NOME que a pessoa deu ao arquivo
 * fica na coluna `arquivo_nome`, nunca na chave. O prefixo da organização é
 * conferido por CHECK no banco.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET_DAS_OBRIGACOES = "mia-obrigacoes";

/** O mesmo teto do bucket (25 MB): é documento digitalizado, não vídeo. */
export const TETO_DO_ARQUIVO_EM_BYTES = 26_214_400;

/** 60 s, como o anexo de nota: o documento é aberto e dispensado. */
const VIDA_DO_LINK_EM_SEGUNDOS = 60;

/** O que a tela deixa subir: documento e imagem de documento. */
const EXTENSAO_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export const MIMES_ACEITOS: readonly string[] = Object.keys(EXTENSAO_POR_MIME);

export interface ArquivoGuardado {
  path: string;
  nome: string;
  mime: string;
  bytes: number;
}

export type RecusaDeArquivo = { ok: false; codigo: "payload_too_large" | "unsupported_media_type" | "validation_failed"; mensagem: string };

/** O arquivo que a pessoa escolheu pode ser guardado? */
export function validarArquivo(mime: string, bytes: number): { ok: true; ext: string } | RecusaDeArquivo {
  if (bytes <= 0) return { ok: false, codigo: "validation_failed", mensagem: "O arquivo está vazio." };
  if (bytes > TETO_DO_ARQUIVO_EM_BYTES) {
    return { ok: false, codigo: "payload_too_large", mensagem: "Arquivo acima de 25 MB." };
  }
  const ext = EXTENSAO_POR_MIME[mime.toLowerCase()];
  if (!ext) {
    return {
      ok: false,
      codigo: "unsupported_media_type",
      mensagem: "Envie PDF, imagem (JPG, PNG, WEBP, HEIC) ou documento do Word ou do Excel.",
    };
  }
  return { ok: true, ext };
}

/** O nome que a tela mostra: sem caminho, sem caractere de controle, curto. */
export function nomeApresentavel(nome: string | null | undefined, ext: string): string {
  const limpo = (nome ?? "")
    .replace(/[\\/]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
  return limpo || `documento.${ext}`;
}

function chaveDoArquivo(organizationId: string, obrigacaoId: string, ext: string): string {
  return `${organizationId}/${obrigacaoId}/${randomUUID()}.${ext}`;
}

/** Guarda o arquivo que a pessoa subiu pela tela. */
export async function guardarArquivo(
  admin: SupabaseClient,
  entrada: { organizationId: string; obrigacaoId: string; conteudo: Buffer; mime: string; nome: string | null; ext: string },
): Promise<ArquivoGuardado> {
  const path = chaveDoArquivo(entrada.organizationId, entrada.obrigacaoId, entrada.ext);
  const { error } = await admin.storage
    .from(BUCKET_DAS_OBRIGACOES)
    .upload(path, entrada.conteudo, { contentType: entrada.mime, upsert: false });
  if (error) throw new Error(`não consegui guardar o arquivo: ${error.message}`);
  return {
    path,
    nome: nomeApresentavel(entrada.nome, entrada.ext),
    mime: entrada.mime,
    bytes: entrada.conteudo.length,
  };
}

/**
 * Copia para a área das obrigações o arquivo que chegou numa mensagem.
 *
 * Devolve `null` quando a mensagem não tem mais arquivo guardado (mídia que não
 * foi persistida, ou que a retenção já levou): o recebimento segue sem arquivo,
 * e quem chama avisa a pessoa.
 */
export async function copiarDaConversa(
  admin: SupabaseClient,
  entrada: { organizationId: string; obrigacaoId: string; mensagemId: string; nome: string | null },
): Promise<ArquivoGuardado | null> {
  const { data: mensagem, error } = await admin
    .from("messages")
    .select("id, media_storage_path, media_mime")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.mensagemId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a mensagem do arquivo: ${error.message}`);
  const linha = mensagem as { media_storage_path: string | null; media_mime: string | null } | null;
  if (!linha?.media_storage_path) return null;

  const { data: baixado, error: erroAoBaixar } = await admin.storage
    .from("whatsapp-media")
    .download(linha.media_storage_path);
  if (erroAoBaixar || !baixado) return null;

  const conteudo = Buffer.from(await baixado.arrayBuffer());
  if (conteudo.length === 0 || conteudo.length > TETO_DO_ARQUIVO_EM_BYTES) return null;
  const mime = (linha.media_mime ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
  // O que veio pelo WhatsApp já passou pela porta do canal: o formato fora da
  // lista da tela é guardado como veio, com extensão neutra.
  const ext = EXTENSAO_POR_MIME[mime] ?? "bin";
  return guardarArquivo(admin, {
    organizationId: entrada.organizationId,
    obrigacaoId: entrada.obrigacaoId,
    conteudo,
    mime,
    nome: entrada.nome,
    ext,
  });
}

/** O link assinado, de vida curta, para abrir o arquivo. */
export async function linkDoArquivo(admin: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(BUCKET_DAS_OBRIGACOES)
    .createSignedUrl(path, VIDA_DO_LINK_EM_SEGUNDOS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Desfaz um upload cujo registro no banco não entrou. Falha aqui vira órfão, não erro. */
export async function descartarArquivo(admin: SupabaseClient, path: string): Promise<void> {
  await admin.storage.from(BUCKET_DAS_OBRIGACOES).remove([path]).catch(() => undefined);
}

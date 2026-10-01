import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — GET|POST /api/v1/obrigacoes/[id]/arquivo — o arquivo do documento.
 *
 * POST (multipart, campo `file`) anexa ou troca o arquivo do ciclo em vigor,
 * sem abrir ciclo novo: é o arquivo que faltou na hora de adicionar o item.
 *
 * GET abre o arquivo:
 * 302 para um link assinado de 60 segundos do bucket privado `mia-obrigacoes`.
 * O item é lido pela RLS de quem pede (papel `agent` em diante, e só o que a
 * pessoa enxerga) ANTES de o servidor assinar: quem não vê o item não recebe
 * link. `?ciclo=<id>` abre o arquivo de um ciclo do histórico.
 *
 * `agent`, e não `viewer`: é o mesmo piso do anexo de nota interna. Documento
 * de cliente é mais do que a linha "tem arquivo" que o `viewer` já vê.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  TETO_DO_ARQUIVO_EM_BYTES,
  descartarArquivo,
  guardarArquivo,
  linkDoArquivo,
  validarArquivo,
  type ArquivoGuardado,
} from "@/lib/obrigacoes/arquivo";
import { lerObrigacao, paraATela } from "@/lib/obrigacoes/leitura";
import { anexarArquivo } from "@/lib/obrigacoes/operacoes";
import { prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;
  const { id } = await ctx.params;
  const UUID = z.string().uuid();
  if (!UUID.safeParse(id).success) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
  const cicloId = new URL(req.url).searchParams.get("ciclo");

  try {
    const item = await lerObrigacao(rota.supabase, rota.orgId, id);
    if (!item) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });

    let caminho = item.arquivo_path;
    if (cicloId) {
      if (!UUID.safeParse(cicloId).success) return fail("not_found", rota.t("Arquivo não encontrado."), 404, { requestId });
      const { data, error } = await rota.supabase
        .from("mia_obrigacoes_ciclos")
        .select("arquivo_path")
        .eq("organization_id", rota.orgId)
        .eq("obrigacao_id", id)
        .eq("id", cicloId)
        .maybeSingle();
      if (error) return fail("internal_error", rota.t("Erro ao buscar o arquivo."), 500, { requestId });
      caminho = (data as { arquivo_path: string | null } | null)?.arquivo_path ?? null;
    }
    if (!caminho) return fail("not_found", rota.t("Este item não tem arquivo."), 404, { requestId });
    // A chave tem de estar no espaço da organização de quem pede: defesa a mais
    // sobre o CHECK do banco, porque quem assina é o cliente de serviço.
    if (!caminho.startsWith(`${rota.orgId}/`) || !rota.admin) {
      return fail("internal_error", rota.t("Erro ao abrir o arquivo."), 500, { requestId });
    }

    const link = await linkDoArquivo(rota.admin, caminho);
    if (!link) return fail("internal_error", rota.t("Erro ao abrir o arquivo."), 500, { requestId });

    const resposta = NextResponse.redirect(link, 302);
    resposta.headers.set("X-Request-Id", requestId);
    // O link vale 60 s: guardá-lo no cache do navegador o tornaria longo na prática.
    resposta.headers.set("Cache-Control", "private, no-store");
    return resposta;
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
  }
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > TETO_DO_ARQUIVO_EM_BYTES + 1_048_576) {
    return fail("payload_too_large", rota.t("Arquivo acima de 25 MB."), 413, { requestId });
  }
  const formulario = await req.formData().catch(() => null);
  const enviado = formulario?.get("file");
  if (!(enviado instanceof File) || enviado.size === 0) {
    return fail("validation_failed", rota.t("Escolha o arquivo."), 422, { requestId });
  }
  const mime = enviado.type || "application/octet-stream";
  const veredito = validarArquivo(mime, enviado.size);
  if (!veredito.ok) {
    const status = veredito.codigo === "payload_too_large" ? 413 : veredito.codigo === "unsupported_media_type" ? 415 : 422;
    return fail(veredito.codigo, rota.t(veredito.mensagem), status, { requestId });
  }

  let guardado: ArquivoGuardado | null = null;
  try {
    // Lido pela RLS de quem pede antes do upload: quem não vê o item não grava no espaço dele.
    const atual = await lerObrigacao(rota.supabase, rota.orgId, id);
    if (!atual || atual.arquivado_em) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
    if (!rota.admin) {
      return fail("internal_error", rota.t("O armazenamento de arquivos não está configurado."), 500, { requestId });
    }
    guardado = await guardarArquivo(rota.admin, {
      organizationId: rota.orgId,
      obrigacaoId: id,
      conteudo: Buffer.from(await enviado.arrayBuffer()),
      mime,
      nome: enviado.name,
      ext: veredito.ext,
    });
    const item = await anexarArquivo(rota.ctx, id, guardado);
    await registrarAto(rota, {
      acao: "obrigacao.arquivo_anexado",
      item,
      porque: "Anexou o arquivo de um documento",
      metadata: { trocou: Boolean(atual.arquivo_path) },
    });
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, hoje: rota.hoje }, { requestId, status: 201 });
  } catch (err) {
    if (guardado && rota.admin) await descartarArquivo(rota.admin, guardado.path);
    return respostaDoErro(err, rota);
  }
}

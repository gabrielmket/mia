import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/obrigacoes/[id]/receber — "Marcar recebido" e
 * "Receber versão nova".
 *
 * Multipart: `valido_ate` (opcional, `AAAA-MM-DD`) e `file` (opcional). Receber
 * quando já havia um recebimento é RENOVAR: o ciclo anterior vai para o
 * histórico do item, com o arquivo dele, e o item segue com o ciclo novo. Sem
 * "válido até", o item fica "recebido · sem validade" e sai dos avisos de
 * vencimento.
 *
 * O arquivo vai para a área privada das obrigações (`lib/obrigacoes/arquivo.ts`)
 * ANTES da gravação do ciclo; se a gravação falhar, o arquivo é descartado.
 *
 * Só aqui (e na confirmação da proposta do agente) o gatilho "Documento
 * recebido" é avisado: foi uma pessoa que marcou.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  TETO_DO_ARQUIVO_EM_BYTES,
  descartarArquivo,
  guardarArquivo,
  validarArquivo,
  type ArquivoGuardado,
} from "@/lib/obrigacoes/arquivo";
import { comoDia } from "@/lib/obrigacoes/datas";
import { lerObrigacao, paraATela } from "@/lib/obrigacoes/leitura";
import { receberObrigacao } from "@/lib/obrigacoes/operacoes";
import { avisarRecebimento, prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
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

  // Guarda de tamanho ANTES de carregar o corpo na memória.
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > TETO_DO_ARQUIVO_EM_BYTES + 1_048_576) {
    return fail("payload_too_large", rota.t("Arquivo acima de 25 MB."), 413, { requestId });
  }

  const formulario = await req.formData().catch(() => null);
  if (!formulario) {
    return fail("validation_failed", rota.t("Envie os dados do recebimento."), 422, { requestId });
  }
  const validadeBruta = formulario.get("valido_ate");
  const temValidade = typeof validadeBruta === "string" && validadeBruta.trim() !== "";
  const validoAte = temValidade ? comoDia(validadeBruta) : null;
  if (temValidade && !validoAte) {
    return fail("validation_failed", rota.t("A data de \"válido até\" não existe no calendário."), 422, { requestId });
  }
  const arquivoEnviado = formulario.get("file");

  let guardado: ArquivoGuardado | null = null;
  try {
    // O item é lido pela RLS de quem pede ANTES de qualquer upload: quem não o
    // enxerga não grava arquivo no espaço dele.
    const atual = await lerObrigacao(rota.supabase, rota.orgId, id);
    if (!atual || atual.arquivado_em) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });

    if (arquivoEnviado instanceof File && arquivoEnviado.size > 0) {
      const mime = arquivoEnviado.type || "application/octet-stream";
      const veredito = validarArquivo(mime, arquivoEnviado.size);
      if (!veredito.ok) {
        const status = veredito.codigo === "payload_too_large" ? 413 : veredito.codigo === "unsupported_media_type" ? 415 : 422;
        return fail(veredito.codigo, rota.t(veredito.mensagem), status, { requestId });
      }
      if (!rota.admin) {
        return fail("internal_error", rota.t("O armazenamento de arquivos não está configurado."), 500, { requestId });
      }
      guardado = await guardarArquivo(rota.admin, {
        organizationId: rota.orgId,
        obrigacaoId: id,
        conteudo: Buffer.from(await arquivoEnviado.arrayBuffer()),
        mime,
        nome: arquivoEnviado.name,
        ext: veredito.ext,
      });
    }

    const { item, renovou } = await receberObrigacao(rota.ctx, id, { valido_ate: validoAte, arquivo: guardado });
    await registrarAto(rota, {
      acao: "obrigacao.recebida",
      item,
      porque: renovou ? "Recebeu a versão nova de um documento" : "Marcou um documento como recebido",
      metadata: { renovou, valido_ate: item.valido_ate, com_arquivo: Boolean(guardado), origem: "tela" },
    });
    const avisadas = await avisarRecebimento(rota, item);
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, renovou, regras_avisadas: avisadas, hoje: rota.hoje }, { requestId });
  } catch (err) {
    if (guardado && rota.admin) await descartarArquivo(rota.admin, guardado.path);
    return respostaDoErro(err, rota);
  }
}

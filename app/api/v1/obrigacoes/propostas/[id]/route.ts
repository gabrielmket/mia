import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/obrigacoes/propostas/[id] — a pessoa decide a
 * proposta do agente de IA.
 *
 * O agente reconheceu, na conversa, um arquivo que parece ser o documento
 * pedido e registrou uma PROPOSTA. Ele nunca marca recebido. Aqui uma pessoa
 * responde:
 *
 *   `confirmar`  "Sim, marcar recebido": o arquivo é COPIADO da conversa para a
 *                área privada das obrigações (a mídia da conversa some com a
 *                retenção; o documento não pode sumir junto) e o item é recebido
 *                com o "válido até" informado. Avisa o gatilho "Documento
 *                recebido". Se o arquivo da conversa já não existe, o item é
 *                recebido sem arquivo e a resposta diz isso.
 *   `recusar`    "Não é": o arquivo fica só na conversa e o item continua
 *                pendente. O aviso de "documento não enviado" que estava
 *                segurado volta a valer.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { copiarDaConversa, descartarArquivo, type ArquivoGuardado } from "@/lib/obrigacoes/arquivo";
import { lerObrigacao, paraATela } from "@/lib/obrigacoes/leitura";
import { lerPropostaPendente, receberObrigacao, recusarProposta } from "@/lib/obrigacoes/operacoes";
import { avisarRecebimento, prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Corpo = z
  .object({
    decisao: z.enum(["confirmar", "recusar"]),
    valido_ate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;
  const { id: propostaId } = await ctx.params;
  if (!z.string().uuid().safeParse(propostaId).success) {
    return fail("not_found", rota.t("Proposta não encontrada."), 404, { requestId });
  }
  const lido = Corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", rota.t("Diga se o arquivo é o documento pedido."), 422, {
      requestId,
      details: { issues: lido.error.issues },
    });
  }

  let copiado: ArquivoGuardado | null = null;
  try {
    if (lido.data.decisao === "recusar") {
      const { obrigacao_id: obrigacaoId } = await recusarProposta(rota.ctx, propostaId);
      const item = await lerObrigacao(rota.supabase, rota.orgId, obrigacaoId);
      if (item) {
        await registrarAto(rota, {
          acao: "obrigacao.proposta_recusada",
          item,
          porque: "Respondeu que o arquivo proposto pelo agente não é o documento pedido",
          metadata: { proposta_id: propostaId },
        });
      }
      return ok({ decisao: "recusada", obrigacao_id: obrigacaoId }, { requestId });
    }

    const proposta = await lerPropostaPendente(rota.ctx, propostaId);
    if (proposta.message_id && rota.admin) {
      copiado = await copiarDaConversa(rota.admin, {
        organizationId: rota.orgId,
        obrigacaoId: proposta.obrigacao_id,
        mensagemId: proposta.message_id,
        nome: proposta.arquivo_nome,
      });
    }
    const { item, renovou } = await receberObrigacao(rota.ctx, proposta.obrigacao_id, {
      valido_ate: lido.data.valido_ate ?? null,
      arquivo: copiado,
      proposta_id: propostaId,
    });
    await registrarAto(rota, {
      acao: "obrigacao.proposta_confirmada",
      item,
      porque: "Confirmou o arquivo que o agente reconheceu na conversa",
      metadata: { proposta_id: propostaId, renovou, valido_ate: item.valido_ate, com_arquivo: Boolean(copiado), origem: "agente" },
    });
    const avisadas = await avisarRecebimento(rota, item);
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok(
      {
        decisao: "confirmada",
        item: naTela,
        renovou,
        // A mídia da conversa pode já ter saído (retenção, ou nunca foi guardada).
        arquivo_copiado: Boolean(copiado),
        regras_avisadas: avisadas,
        hoje: rota.hoje,
      },
      { requestId },
    );
  } catch (err) {
    if (copiado && rota.admin) await descartarArquivo(rota.admin, copiado.path);
    return respostaDoErro(err, rota);
  }
}

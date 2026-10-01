import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — GET|PATCH /api/v1/obrigacoes/[id]
 *
 * GET devolve o item com o histórico: os ciclos que terminaram, os avisos que as
 * automações dispararam e as propostas do agente já decididas.
 *
 * PATCH edita o que não é ciclo: nome, quem entrega, recorrência, validade
 * padrão, antecedência dos avisos, responsável, observação, a quem está ligado,
 * a correção de uma data digitada errada, e `arquivado: true` para tirar o item
 * das listas sem apagar. Pedir, receber e marcar feita têm rota própria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerDetalhe, paraATela } from "@/lib/obrigacoes/leitura";
import { arquivarObrigacao, editarObrigacao } from "@/lib/obrigacoes/operacoes";
import { prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";
import { QUEM_ENTREGA, RECORRENCIAS } from "@/lib/obrigacoes/tipos";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const UUID = z.string().uuid();
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Corpo = z
  .object({
    nome: z.string().trim().min(1).max(120).optional(),
    nome_curto: z.string().trim().max(60).nullish(),
    quem_entrega: z.enum(QUEM_ENTREGA).optional(),
    recorrencia: z.enum(RECORRENCIAS).optional(),
    recorrencia_meses: z.number().int().min(1).max(240).nullish(),
    validade_meses: z.number().int().min(0).max(600).optional(),
    avisos_dias: z.array(z.number().int().min(1).max(3650)).max(3).optional(),
    dias_sem_resposta: z.number().int().min(1).max(365).optional(),
    responsavel_user_id: UUID.nullish(),
    observacao: z.string().max(2000).nullish(),
    prazo_em: DIA.nullish(),
    valido_ate: DIA.nullish(),
    proxima_em: DIA.nullish(),
    lead_id: UUID.nullish(),
    empresa_id: UUID.nullish(),
    contact_id: UUID.nullish(),
    arquivado: z.literal(true).optional(),
  })
  .strict();

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const rota = await prepararRota("viewer", requestId);
  if (!rota.ok) return rota.resposta;
  const { id } = await ctx.params;
  if (!UUID.safeParse(id).success) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
  try {
    const detalhe = await lerDetalhe(rota.supabase, rota.orgId, id);
    if (!detalhe) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
    return ok({ ...detalhe, hoje: rota.hoje }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;
  const { id } = await ctx.params;
  if (!UUID.safeParse(id).success) return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });

  const lido = Corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", rota.t("Revise os campos do item."), 422, {
      requestId,
      details: { issues: lido.error.issues },
    });
  }

  try {
    const { arquivado, ...edicao } = lido.data;
    if (arquivado) {
      const item = await arquivarObrigacao(rota.ctx, id);
      await registrarAto(rota, { acao: "obrigacao.arquivada", item, porque: "Arquivou um item de Documentos e obrigações" });
      return ok({ id, arquivado: true }, { requestId });
    }
    const { item, campos } = await editarObrigacao(rota.ctx, id, edicao);
    if (campos.length > 0) {
      await registrarAto(rota, {
        acao: "obrigacao.editada",
        item,
        porque: "Alterou um item de Documentos e obrigações",
        metadata: { campos },
      });
    }
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, campos, hoje: rota.hoje }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

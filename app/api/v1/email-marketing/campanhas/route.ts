/**
 * FORK MIA (.89) — /api/v1/email-marketing/campanhas: as campanhas de e-mail.
 *
 * GET  a lista, com o andamento de cada uma contado no banco.
 * POST um RASCUNHO novo (vazio, de um modelo ou de um segmento). Criar não
 *      dispara: o envio exige teste da versão atual e a confirmação na tela.
 *
 * Gestor para cima (protótipo: "gestor monta e envia").
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { blocosSchema } from "@/lib/email-marketing/blocos";
import {
  andamentoDaCampanha,
  blocosDoModelo,
  criarRascunho,
  listarCampanhas,
} from "@/lib/email-marketing/campanhas";
import { recorteSchema } from "@/lib/email-marketing/recorte";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { listarSegmentos } from "@/lib/email-marketing/segmentos-e-modelos";

export const dynamic = "force-dynamic";

const criarSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    modelo: z.string().trim().max(64).optional(),
    segmento_id: z.string().uuid().optional(),
    recorte: recorteSchema.optional(),
    base_legal: z.enum(["consent", "legitimate_interest"]).optional(),
    lia_ref: z.string().trim().max(120).nullable().optional(),
    assunto: z.string().max(200).optional(),
    pre_cabecalho: z.string().max(200).optional(),
    blocos: blocosSchema.optional(),
  })
  .strict();

export async function GET(_req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  try {
    const campanhas = await listarCampanhas(porta.admin, porta.org.orgId);
    const comAndamento = await Promise.all(
      campanhas.map(async (c) => ({
        id: c.id,
        nome: c.nome,
        status: c.status,
        assunto: c.assunto,
        base_legal: c.base_legal,
        agendada_para: c.agendada_para,
        iniciada_em: c.iniciada_em,
        concluida_em: c.concluida_em,
        total_previsto: c.total_previsto,
        preco_cents: c.preco_cents,
        motivo_da_pausa: c.motivo_da_pausa,
        created_at: c.created_at,
        andamento:
          c.status === "rascunho"
            ? null
            : await andamentoDaCampanha(porta.admin, porta.org.orgId, c.id),
      })),
    );
    return ok({ campanhas: comAndamento }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = criarSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Campanha inválida.",
        422,
      );
    const d = parsed.data;
    const doModelo = d.modelo ? await blocosDoModelo(porta.admin, porta.org.orgId, d.modelo) : null;
    if (d.modelo && !doModelo)
      throw new RecusaDaCampanha(
        "modelo_desconhecido",
        "Modelo não encontrado nesta empresa.",
        404,
      );
    const segmento = d.segmento_id
      ? (await listarSegmentos(porta.admin, porta.org.orgId)).find((s) => s.id === d.segmento_id)
      : null;
    if (d.segmento_id && !segmento)
      throw new RecusaDaCampanha("segmento_desconhecido", "Segmento não encontrado.", 404);
    const campanha = await criarRascunho(porta.admin, {
      organizationId: porta.org.orgId,
      autorId: porta.user.id,
      origem: "tela",
      dados: {
        nome: d.nome,
        assunto: d.assunto ?? doModelo?.assunto ?? "",
        pre_cabecalho: d.pre_cabecalho ?? doModelo?.pre_cabecalho ?? "",
        blocos: d.blocos ?? doModelo?.blocos ?? [],
        recorte: d.recorte ?? segmento?.recorte,
        segmento_id: segmento?.id ?? null,
        base_legal: d.base_legal ?? segmento?.base_legal ?? "consent",
        lia_ref: d.lia_ref ?? segmento?.lia_ref ?? null,
      },
    });
    void audit({
      action: "email_marketing.campanha_criada",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_campanhas",
      resourceId: campanha.id,
      requestId: porta.requestId,
      metadata: {
        nome: campanha.nome,
        modelo: d.modelo ?? null,
        segmento_id: segmento?.id ?? null,
        origem: "tela",
      },
    });
    return ok({ campanha }, { requestId: porta.requestId, status: 201 });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

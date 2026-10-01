import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — GET|PUT /api/v1/obrigacoes/tipos — o catálogo de tipos.
 *
 * GET devolve os tipos da empresa (por funil, ou da empresa inteira) e os
 * MODELOS por segmento que o produto traz (`lib/obrigacoes/catalogo.ts`). O
 * formulário de adicionar usa os dois: o catálogo do funil primeiro, os modelos
 * como ponto de partida.
 *
 * PUT garante os tipos de um funil (`pipeline_id`; nulo = todos os funis): a
 * lista informada (`tipos`) e/ou "usar o modelo do segmento"
 * (`modelo_do_segmento`). Reexecução segura: a chave é o nome dentro do funil;
 * o que o pedido não cita continua lá. É configuração do funil: gerente em
 * diante (a RLS da tabela cobra o mesmo).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { MODELOS_DE_TIPO, SEGMENTOS_DE_OBRIGACAO } from "@/lib/obrigacoes/catalogo";
import { aplicarModeloDoSegmento, garantirTipos, lerTipos, TETO_DE_TIPOS_POR_FUNIL } from "@/lib/obrigacoes/catalogo-servidor";
import { prepararRota, respostaDoErro } from "@/lib/obrigacoes/rota";
import { CATEGORIAS, LIGA_A, QUEM_ENTREGA, RECORRENCIAS } from "@/lib/obrigacoes/tipos";

export const dynamic = "force-dynamic";

const Tipo = z
  .object({
    nome: z.string().trim().min(1).max(120),
    nome_curto: z.string().trim().max(60).nullish(),
    categoria: z.enum(CATEGORIAS),
    quem_entrega: z.enum(QUEM_ENTREGA).optional(),
    recorrencia: z.enum(RECORRENCIAS).optional(),
    recorrencia_meses: z.number().int().min(1).max(240).nullish(),
    validade_meses: z.number().int().min(0).max(600).optional(),
    avisos_dias: z.array(z.number().int().min(1).max(3650)).max(3).optional(),
    dias_sem_resposta: z.number().int().min(1).max(365).optional(),
    liga_a: z.enum(LIGA_A).optional(),
    pede_arquivo: z.boolean().optional(),
  })
  .strict();

const Corpo = z
  .object({
    pipeline_id: z.string().uuid().nullable(),
    tipos: z.array(Tipo).max(TETO_DE_TIPOS_POR_FUNIL).optional(),
    modelo_do_segmento: z.enum(SEGMENTOS_DE_OBRIGACAO).optional(),
  })
  .strict()
  .refine((c) => (c.tipos?.length ?? 0) > 0 || c.modelo_do_segmento !== undefined, {
    message: "Informe os tipos ou escolha o modelo de um segmento.",
  });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const rota = await prepararRota("viewer", requestId);
  if (!rota.ok) return rota.resposta;
  try {
    const tipos = await lerTipos(rota.supabase, rota.orgId);
    return ok({ tipos, modelos: MODELOS_DE_TIPO }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("manager", requestId);
  if (!rota.ok) return rota.resposta;

  const lido = Corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", rota.t("Revise os tipos de obrigação."), 422, {
      requestId,
      details: { issues: lido.error.issues },
    });
  }

  try {
    const alvo = { org: rota.orgId, ator: rota.userId, pipelineId: lido.data.pipeline_id };
    const doModelo = lido.data.modelo_do_segmento
      ? await aplicarModeloDoSegmento(rota.supabase, alvo, lido.data.modelo_do_segmento)
      : [];
    const daLista = lido.data.tipos?.length ? await garantirTipos(rota.supabase, alvo, lido.data.tipos) : [];
    const resultado = [...doModelo, ...daLista];
    const mudaram = resultado.filter((r) => r.desfecho !== "ja_estava").length;
    if (mudaram > 0) {
      await audit({
        organizationId: rota.orgId,
        actorUserId: rota.userId,
        action: "obrigacao.tipos_atualizados",
        resourceType: "crm_pipelines",
        resourceId: lido.data.pipeline_id,
        requestId,
        metadata: {
          criados: resultado.filter((r) => r.desfecho === "criou").length,
          atualizados: resultado.filter((r) => r.desfecho === "atualizou").length,
          modelo_do_segmento: lido.data.modelo_do_segmento ?? null,
        },
      });
    }
    return ok({ resultado, tipos: await lerTipos(rota.supabase, rota.orgId) }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

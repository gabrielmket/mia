/**
 * FORK MIA (item 9) — GET/POST /api/v1/relatorios/paineis
 *
 * Os painéis montados pela pessoa (relatórios salvos e prontos lado a lado):
 * os dela e os compartilhados com a equipe (a RLS da 9040 decide). Todo membro
 * cria os próprios; compartilhar é de gestor e administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import { podeCompartilhar, podeEditar } from "@/lib/relatorios/acesso";
import { PERIODOS_DO_PAINEL, TAMANHOS } from "@/lib/relatorios/catalogo";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { adicionarAoPainel, criarPainel, lerPainel, listarPaineis } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const criarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80),
    periodo: z.enum(PERIODOS_DO_PAINEL).optional(),
    compartilhado: z.boolean().optional(),
    /** Já nasce com este relatório ("Adicionar a um painel" → "Novo painel"). */
    relatorio_id: z.string().uuid().nullish(),
    pronto: z.enum(PAINEIS_PRONTOS).nullish(),
    tamanho: z.enum(TAMANHOS).optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  try {
    const paineis = await listarPaineis(ctx.db, ctx.quem.organizationId);
    return ok(
      {
        paineis: paineis.map((p) => ({
          ...p,
          meu: p.criadoPor === ctx.quem.userId,
          podeEditar: podeEditar(p, { userId: ctx.quem.userId ?? "", role: ctx.role }),
        })),
        podeCompartilhar: podeCompartilhar(ctx.role),
      },
      { requestId },
    );
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const corpo = await lerCorpo(req, criarSchema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  if (d.compartilhado && !podeCompartilhar(ctx.role)) {
    return fail("forbidden", ctx.t("Só gestor e administrador compartilham com a equipe."), 403, { requestId });
  }
  try {
    const painel = await criarPainel(ctx.db, ctx.quem, {
      nome: d.nome,
      periodo: d.periodo,
      compartilhado: d.compartilhado ?? false,
    });
    if (d.relatorio_id || d.pronto) {
      await adicionarAoPainel(ctx.db, ctx.quem, painel.id, {
        relatorioId: d.relatorio_id ?? null,
        pronto: d.pronto ?? null,
        tamanho: d.tamanho,
      });
    }
    return ok({ painel: await lerPainel(ctx.db, ctx.quem.organizationId, painel.id) }, { requestId, status: 201 });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

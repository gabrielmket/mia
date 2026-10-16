/**
 * FORK MIA (item 9) — POST /api/v1/relatorios/exportar
 *
 * A planilha (CSV) do relatório (os números somados, sem nome de cliente) ou
 * da lista por trás de um número (linha a linha, com nome e telefone). Decisão
 * do protótipo: só gestor e administrador exportam, e cada exportação fica
 * registrada (quem, quando, o quê). O registro é gravado ANTES de a planilha
 * sair, pela sessão de quem exporta (a RLS da 9040 confere o papel e o id);
 * sem registro, não há planilha.
 *
 * Separador escolhível, decimais com vírgula, datas em dd/mm/aaaa, UTF-8 com
 * BOM (o Excel em português lê os acentos). Resposta `text/csv` como anexo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import { podeExportar } from "@/lib/relatorios/acesso";
import { configDoRelatorioSchema, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { grupoDaListaSchema } from "@/lib/relatorios/schemas";
import { exportarPlanilha } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    tipo: z.enum(["relatorio", "lista"]),
    nome: z.string().trim().min(1).max(200),
    relatorio_id: z.string().uuid().nullish(),
    pronto: z.enum(PAINEIS_PRONTOS).nullish(),
    config: configDoRelatorioSchema,
    separador: z.enum([";", ","]),
    grupo: z.string().max(200).nullish(),
    ...grupoDaListaSchema,
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!podeExportar(ctx.role)) {
    return fail(
      "forbidden",
      ctx.t("Exportar planilha é para gestor e administrador: a lista leva nome e telefone de cliente para fora do sistema."),
      403,
      { requestId },
    );
  }
  const corpo = await lerCorpo(req, schema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  try {
    const { data: org } = await ctx.db
      .from("organizations")
      .select("display_name, timezone, currency")
      .eq("id", ctx.quem.organizationId)
      .maybeSingle();
    const empresa = (org as { display_name?: string; timezone?: string | null; currency?: string | null } | null) ?? {};
    const fuso = empresa.timezone || "America/Sao_Paulo";
    const planilha = await exportarPlanilha(ctx.db, ctx.admin, ctx.quem, {
      tipo: d.tipo,
      nome: d.nome,
      relatorioId: d.relatorio_id ?? null,
      pronto: d.pronto ?? null,
      config: d.config as ConfigDoRelatorio,
      valores: ctx.valores,
      funilPadrao: ctx.funilPadrao,
      sep: d.separador,
      chave1: d.chave1 ?? null,
      chave2: d.chave2 ?? null,
      dobrados1: d.dobrados1 ?? null,
      dobrados2: d.dobrados2 ?? null,
      funil: d.funil ?? false,
      grupo: d.grupo ?? null,
      empresa: empresa.display_name ?? "empresa",
      fuso,
      f: { t: ctx.t, tag: tagDeIdioma(ctx.idioma), moeda: empresa.currency || "BRL" },
    });
    return new Response(planilha.texto, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${planilha.arquivo}"`,
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        "X-Linhas": String(planilha.linhas),
        "X-Cortada": planilha.cortada ? "1" : "0",
      },
    });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

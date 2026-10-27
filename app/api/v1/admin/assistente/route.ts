/**
 * FORK MIA (.93) — GET /api/v1/admin/assistente: onde os clientes travam, do
 * lado da Time (protótipo aprovado em 26/10/2026, tela 6).
 *
 * `?periodo=7|30|90` (padrão 30) e `?segmento=todos|clinica|academia|imobiliaria|industria|outro`.
 * Devolve os números juntados (temas, trilhas por passo, abandono, propostas)
 * e o texto só das perguntas sem resposta, sem quem perguntou (decisão 12), e a
 * lista de melhorias do produto (decisão 13). As empresas de demonstração não
 * entram. Só o administrador da plataforma.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { listarMelhorias } from "@/lib/assistente/trilhas/melhorias";
import { ondeOsClientesTravam, SEGMENTOS_DO_PAINEL, type PeriodoDoPainel } from "@/lib/assistente/trilhas/onde-travam";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const filtroSchema = z
  .object({
    periodo: z.enum(["7", "30", "90"]).optional(),
    segmento: z.enum(SEGMENTOS_DO_PAINEL as unknown as [string, ...string[]]).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const filtro = filtroSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!filtro.success) return fail("validation_failed", "Filtro inválido.", 422, { requestId });

  const admin = createAdminClient();
  try {
    const [painel, melhorias] = await Promise.all([
      ondeOsClientesTravam(admin, {
        periodoDias: Number(filtro.data.periodo ?? "30") as PeriodoDoPainel,
        segmento: (filtro.data.segmento ?? "todos") as (typeof SEGMENTOS_DO_PAINEL)[number],
      }),
      listarMelhorias(admin),
    ]);
    return ok({ painel, melhorias }, { requestId });
  } catch {
    return fail("internal_error", "Não consegui ler onde os clientes travam.", 500, { requestId });
  }
}

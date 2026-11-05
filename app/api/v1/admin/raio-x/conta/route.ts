/**
 * FORK MIA (.102) · GET /api/v1/admin/raio-x/conta?organization_id=&periodo_dias=&numeros=
 * — o que o "Novo raio-X" do CLIENTE ATIVO puxa da conta (protótipo de
 * 05/11/2026, tela 2; docs/fork/raio-x-do-atendimento.md, seção 13): se a
 * empresa é ativa, o segmento, o horário, quem administra, os números de
 * WhatsApp com as mensagens do período, o período limitado à primeira conversa
 * e a estimativa de custo. Só leitura, só quem administra a plataforma. Nenhum
 * dado de cliente sai daqui: só contagens e os números da EMPRESA.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { contaParaORaioX } from "@/lib/raio-x/conta";
import { PERIODOS_EM_DIAS } from "@/lib/raio-x/regras";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const consultaSchema = z.object({
  organization_id: z.string().uuid(),
  periodo_dias: z.coerce
    .number()
    .int()
    .refine((n) => (PERIODOS_EM_DIAS as readonly number[]).includes(n))
    .default(60),
  numeros: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).max(20).optional()),
});

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const busca = req.nextUrl.searchParams;
  const consulta = consultaSchema.safeParse({
    organization_id: busca.get("organization_id") ?? undefined,
    periodo_dias: busca.get("periodo_dias") ?? undefined,
    numeros: busca.get("numeros") ?? undefined,
  });
  if (!consulta.success) return fail("validation_failed", "Escolha a empresa e o período.", 400, { requestId });
  const conta = await contaParaORaioX(createAdminClient(), consulta.data.organization_id, consulta.data.periodo_dias, new Date(), consulta.data.numeros);
  if (!conta) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  return ok(conta, { requestId, headers: { "Cache-Control": "no-store" } });
}

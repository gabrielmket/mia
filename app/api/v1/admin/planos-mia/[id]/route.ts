/**
 * FORK MIA (.90) — PUT /api/v1/admin/planos-mia/[id]: o que é NOSSO num plano
 * de cobrança — os módulos que ele liga, o preço por mensagem do Broadcast, a
 * frase e o selo do cartão da página de preços (`mia_plano_modulos`, 9070).
 *
 * O plano em si (preço, teste, limites, teto, padrão, oferecido) continua na
 * rota do upstream (`/api/v1/admin/cobranca/planos/[id]`); esta só escreve a
 * tabela ao lado. Escrita de platform admin (scope full + MFA, a mesma régua do
 * upstream), 404 com a cobrança desligada. Tirar módulo ou mudar o preço por
 * mensagem de plano assinado: 409 `plano_com_assinantes` (a trava é do banco).
 * Ligar módulo vale na hora para as empresas do plano.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { MODULOS_DO_PLANO } from "@/lib/planos-mia/catalogo";
import { salvarLadoDoPlano } from "@/lib/planos-mia/garantir-planos";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z
  .strictObject({
    modulos: z.array(z.enum(MODULOS_DO_PLANO)).max(MODULOS_DO_PLANO.length),
    preco_por_mensagem_cents: z.number().int().min(0).max(100_000).nullable(),
    frase: z.string().trim().max(160).nullable(),
    destaque: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para mudar.");

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const admin = createAdminClient();
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Plano não encontrado", 404, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "Pedido inválido", 400, {
      requestId,
      details: corpo.error.flatten(),
    });
  }
  const { data: plano, error } = await admin
    .from("cobranca_planos")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível ler o plano", 500, { requestId });
  if (!plano) return fail("not_found", "Plano não encontrado", 404, { requestId });

  const frase =
    corpo.data.frase === undefined ? undefined : corpo.data.frase === "" ? null : corpo.data.frase;
  const r = await salvarLadoDoPlano(
    admin,
    id,
    { ...corpo.data, frase },
    { userId: adminCtx.user.id, requestId },
  );
  if (!r.ok) return fail("plano_com_assinantes", r.motivo, 409, { requestId });
  return ok(
    { mudou: r.mudou, ligou: r.ligou, empresas_com_modulo_novo: r.empresas },
    { requestId },
  );
}

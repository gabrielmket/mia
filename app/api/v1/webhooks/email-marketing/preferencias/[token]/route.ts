/**
 * FORK MIA (.89) — POST /api/v1/webhooks/email-marketing/preferencias/[token]:
 * o que a PÁGINA DE PREFERÊNCIAS (`/preferencias/[token]`, sem login) grava.
 *
 *   sair    sai de todo e-mail de marketing da empresa; opcionalmente também
 *           do marketing pelo WhatsApp (`consent.marketing.declined_at`)
 *   voltar  volta a receber: SÓ por aqui, pela própria pessoa, com o link de um
 *           e-mail que ela recebeu (a equipe não reinscreve ninguém)
 *
 * A empresa e a pessoa vêm do token assinado, conferido na linha do banco. No
 * e-mail de TESTE, nada muda.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import {
  descadastrar,
  resolverQuemRecebe,
  situacaoDaPessoa,
  voltarAReceberPeloTitular,
} from "@/lib/email-marketing/preferencias";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    acao: z.enum(["sair", "voltar"]),
    tambem_whatsapp: z.boolean().optional(),
    motivo: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (await authRateLimited("email_marketing_preferencias", null, { ip: 30, windowSec: 60 })) {
    return fail("rate_limited", "Muitas tentativas. Aguarde um minuto.", 429);
  }
  const { token } = await ctx.params;
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Pedido inválido.", 422);
  }
  const parsed = pedidoSchema.safeParse(corpo);
  if (!parsed.success) return fail("validation_failed", "Pedido inválido.", 422);
  try {
    const admin = createAdminClient();
    const quem = await resolverQuemRecebe(admin, token);
    if (!quem) return fail("not_found", "Este link não está disponível.", 404);
    if (quem.teste) return ok({ teste: true, situacao: await situacaoDaPessoa(admin, quem) });
    if (parsed.data.acao === "sair") {
      await descadastrar(admin, quem, {
        porta: "pagina",
        tambemWhatsapp: parsed.data.tambem_whatsapp === true,
        motivo: parsed.data.motivo ?? null,
      });
    } else {
      const r = await voltarAReceberPeloTitular(admin, quem);
      if (!r.voltou) return fail("nao_volta", "Este endereço não pode voltar a receber.", 409);
    }
    return ok({ teste: false, situacao: await situacaoDaPessoa(admin, quem) });
  } catch (err) {
    logger.error("[email-marketing] preferências não gravadas", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não deu certo agora. Tente de novo em alguns minutos.", 500);
  }
}

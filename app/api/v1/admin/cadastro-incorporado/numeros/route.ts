/**
 * POST /api/v1/admin/cadastro-incorporado/numeros — quais números esta conta tem.
 *
 * A conta que chega pelo cadastro incorporado vem SEM número: o `partner_added`
 * só avisa que uma empresa adicionou nosso app. E a amarração precisa de um
 * `phone_number_id` — é ele que vira o canal. Esta rota é a ponte: o operador
 * abre a fila, pede os números daquela conta, escolhe e amarra.
 *
 * Rota SEPARADA e não um campo a mais no POST de amarrar, porque são atos
 * diferentes: este é uma pergunta à Meta, que pode falhar por rede ou por
 * permissão e não muda nada do nosso lado; o outro cria um canal. Juntá-los
 * faria uma falha de leitura parecer falha de amarração.
 *
 * Só lê. Não grava o que descobriu: se gravasse, um número trocado do lado da
 * Meta ficaria congelado aqui, e a lista mostrada ao operador seria a de ontem
 * exatamente no dia em que ele precisa da de hoje.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { numerosDaWaba } from "@/lib/channels/meta/numeros-da-waba";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({
  waba_id: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Informe a conta.", 422, { requestId });

  const resultado = await numerosDaWaba({ wabaId: parsed.data.waba_id });
  if (!resultado.ok) {
    // 422 e não 500: quase sempre é configuração ou permissão do lado da Meta,
    // e o motivo já diz qual. Um 500 mandaria o operador procurar defeito no
    // servidor quando o que falta é um token ou um compartilhamento.
    return fail("invalid_request", resultado.motivo, 422, { requestId });
  }

  return ok(
    {
      numeros: resultado.numeros,
      /** Quantos de fato dão para conectar — o resto ainda está no aplicativo. */
      prontos: resultado.numeros.filter((n) => n.servePraCloudApi).length,
    },
    { requestId },
  );
}

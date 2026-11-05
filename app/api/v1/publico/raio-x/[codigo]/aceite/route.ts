/**
 * FORK MIA (.101) · POST /api/v1/publico/raio-x/[codigo]/aceite — "Autorizar e
 * conectar" (decisão 6). O dono, sem conta, aceita o termo: o aceite grava o
 * nome, a data e a hora, a versão e o texto INTEIRO que ele leu. Depois, o
 * leitor prepara a sessão do raio-X para o pareamento (código ou QR).
 *
 * Público: a identidade é o código do link (48 h). Teto por IP. Sem efeito em
 * empresa nenhuma da MIA.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { leitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { logger } from "@/lib/logger";
import { podeConectar, raioXPeloCodigo, registrarAceite } from "@/lib/raio-x/banco";
import { LIMITE_DA_PAGINA, ROTULO_DO_LIMITE_DA_PAGINA } from "@/lib/raio-x/publico";
import { VERSAO_DO_TERMO } from "@/lib/raio-x/termo";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  nome: z.string().trim().min(2).max(120),
  aceito: z.literal(true),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ codigo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  if (await authRateLimited(ROTULO_DO_LIMITE_DA_PAGINA, null, LIMITE_DA_PAGINA)) {
    return fail("rate_limited", "Muitas tentativas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const { codigo } = await params;
  const admin = createAdminClient();
  const r = await raioXPeloCodigo(admin, codigo);
  if (!r) return fail("not_found", "Link inválido ou encerrado.", 404, { requestId });
  if (!podeConectar(r)) return fail("conflict", "Este link venceu. Peça um novo à Time Company.", 409, { requestId });
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Escreva o seu nome e marque a autorização.", 400, { requestId });

  const { aceiteId, sessao } = await registrarAceite(admin, r, corpo.data.nome);
  void audit({
    action: "raio_x.aceite",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x",
    resourceId: r.id,
    requestId,
    // O nome de quem aceitou mora em mia_raio_x_aceites; a trilha guarda só a referência.
    metadata: { aceite_id: aceiteId, termo_versao: VERSAO_DO_TERMO },
  });

  const leitor = leitorDoRaioX();
  if (!leitor) return ok({ aceito: true, pronto_para_parear: false, motivo: "leitor_indisponivel" }, { requestId });
  try {
    const estado = await leitor.preparar(sessao);
    return ok({ aceito: true, pronto_para_parear: estado.estado === "esperando_pareamento", estado: estado.estado }, { requestId });
  } catch (err) {
    logger.warn("[raio-x] o leitor não preparou a sessão", { requestId, detail: err instanceof Error ? err.message : "erro" });
    return ok({ aceito: true, pronto_para_parear: false, motivo: "leitor_indisponivel" }, { requestId });
  }
}

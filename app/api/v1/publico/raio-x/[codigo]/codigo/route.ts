/**
 * FORK MIA (.101) · POST /api/v1/publico/raio-x/[codigo]/codigo — o código de 8
 * letras para "Conectar com número de telefone" (decisão 2). O dono digita no
 * próprio WhatsApp, em Aparelhos conectados, sem computador.
 *
 * O número do pareamento é SEMPRE o cadastrado pela Time (o termo é dele): o
 * corpo não escolhe número. Só depois do aceite. Teto por IP e por raio-X (o
 * código do WhatsApp vale ~3 minutos, e pedir outro invalida o anterior).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { LeitorRecusou, leitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { podeConectar, raioXPeloCodigo } from "@/lib/raio-x/banco";
import { LIMITE_DO_CODIGO, ROTULO_DO_LIMITE_DO_CODIGO } from "@/lib/raio-x/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const FRASES: Record<string, [number, string]> = {
  ja_conectado: [409, "Este WhatsApp já está conectado."],
  ainda_nao_pronto: [409, "A conexão ainda está sendo preparada. Aguarde alguns segundos e tente de novo."],
  codigo_recusado: [502, "O WhatsApp não gerou o código agora. Tente de novo ou use o QR."],
  codigo_invalido: [502, "O WhatsApp não gerou o código agora. Tente de novo ou use o QR."],
  telefone_invalido: [409, "O número cadastrado não está num formato que o WhatsApp aceite. Fale com a Time Company."],
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { codigo } = await params;
  if (await authRateLimited(ROTULO_DO_LIMITE_DO_CODIGO, codigo, LIMITE_DO_CODIGO)) {
    return fail("rate_limited", "Muitos códigos pedidos seguidos. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const admin = createAdminClient();
  const r = await raioXPeloCodigo(admin, codigo);
  if (!r) return fail("not_found", "Link inválido ou encerrado.", 404, { requestId });
  if (!podeConectar(r)) return fail("conflict", "Este link venceu. Peça um novo à Time Company.", 409, { requestId });
  if (r.situacao !== "conectando" || !r.sessao) {
    return fail("conflict", "Leia e aceite a autorização antes de conectar.", 409, { requestId });
  }
  // Um pedido a cada 30 s por raio-X: dois cliques seguidos não invalidam o código que acabou de sair.
  const porRaioX = await checkRateLimit(`raio-x-codigo:${r.id}`, 1, 30);
  if (!porRaioX.allowed) {
    return fail("rate_limited", "Aguarde 30 segundos antes de pedir outro código.", 429, { requestId, headers: { "Retry-After": "30" } });
  }
  const leitor = leitorDoRaioX();
  if (!leitor) return fail("upstream_unavailable", "A conexão não está disponível agora. Tente pelo QR ou fale com a Time Company.", 503, { requestId });
  try {
    const estado = await leitor.preparar(r.sessao);
    if (estado.estado === "conectado") return fail("conflict", FRASES.ja_conectado![1], 409, { requestId });
    const codigoDoWhatsapp = await leitor.pedirCodigo(r.sessao, `+${r.whatsapp}`);
    return ok({ codigo: codigoDoWhatsapp }, { requestId, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const motivo = err instanceof LeitorRecusou ? err.codigo : "";
    const [status, frase] = FRASES[motivo] ?? [502, "A conexão não respondeu. Tente de novo ou use o QR."];
    return fail("pairing_failed", frase, status, { requestId });
  }
}

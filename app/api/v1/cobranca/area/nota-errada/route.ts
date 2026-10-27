/**
 * FORK MIA (.96) · POST /api/v1/cobranca/area/nota-errada: "A nota saiu errada"
 * (decisão 10 do protótipo "Pagamento no início"). O pedido vira um CHAMADO para
 * a Time pelo sistema de chamados do assistente (.88), aberto pela sessão de
 * quem pede: a Time cancela a nota no Asaas e emite outra, dentro do prazo da
 * prefeitura. A cobrança é conferida contra o cliente do Asaas da empresa e
 * precisa estar paga. O contexto (hora, versão, navegador) é montado aqui, no
 * servidor, como o do assistente.
 */
import { fail } from "@/lib/api/wrappers";
import { navegadorLegivel } from "@/lib/assistente/chamado";
import { acessoDaArea, corpoJson, responderDaArea } from "@/lib/area-de-cobranca/rota";
import { pedirCorrecaoDaNota } from "@/lib/area-de-cobranca/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { rotuloLocal } from "@/lib/tempo/agora";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDaArea();
  if (acesso instanceof Response) return acesso;
  const corpo = await corpoJson(req);
  if (corpo === null || typeof corpo !== "object") {
    return fail("validation_failed", "Conte o que está errado na nota.", 400, { requestId: acesso.requestId });
  }
  const sessao = await createClient();
  const { data: empresa } = await sessao
    .from("organizations")
    .select("timezone, display_name")
    .eq("id", acesso.org.orgId)
    .maybeSingle();
  const e = empresa as { timezone?: string | null; display_name?: string | null } | null;
  const r = await pedirCorrecaoDaNota(sessao, acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    papel: acesso.org.role,
    entrada: corpo,
    requestId: acesso.requestId,
    contexto: {
      versao: process.env.APP_VERSION || "desconhecida",
      navegador: navegadorLegivel(req.headers.get("user-agent")),
      hora_local: rotuloLocal(new Date(), fusoUtilizavel(e?.timezone)),
      empresa: e?.display_name ?? acesso.org.name ?? null,
    },
  });
  return responderDaArea(r, acesso.requestId);
}

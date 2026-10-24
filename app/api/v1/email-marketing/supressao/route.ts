/**
 * FORK MIA (.89) — /api/v1/email-marketing/supressao: a lista de quem não
 * recebe e-mail de marketing de novo.
 *
 * GET  a lista (o começo do endereço, o motivo, de onde veio, quando), com
 *      filtro por motivo e busca pelo endereço inteiro. Gestor para cima.
 * POST acrescentar à mão (pedido por telefone, por WhatsApp...). Acrescentar é
 *      livre para gestor e administrador. TIRAR não existe em rota nenhuma:
 *      só a própria pessoa volta a receber, pelo link de um e-mail.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { emailComForma } from "@/lib/email-marketing/endereco";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, nomeDaPessoa, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { listarSupressao, suprimirEmail } from "@/lib/email-marketing/supressao";

export const dynamic = "force-dynamic";

const MOTIVOS = ["descadastro", "rejeicao", "reclamacao", "manual", "importada"] as const;

export async function GET(req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  try {
    const url = new URL(req.url);
    const motivo = url.searchParams.get("motivo");
    const r = await listarSupressao(porta.admin, {
      organizationId: porta.org.orgId,
      motivo: (MOTIVOS as readonly string[]).includes(motivo ?? "")
        ? (motivo as (typeof MOTIVOS)[number])
        : null,
      busca: url.searchParams.get("busca"),
      limite: 50,
    });
    return ok(r, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

const acrescentarSchema = z
  .object({ email: z.string().trim().max(254), motivo: z.string().trim().min(1).max(120) })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = acrescentarSchema.safeParse(await corpoJson(req));
    if (!parsed.success || !emailComForma(parsed.data.email))
      throw new RecusaDaCampanha("validation_failed", "Escreva um e-mail válido.", 422);
    const r = await suprimirEmail(porta.admin, {
      organizationId: porta.org.orgId,
      email: parsed.data.email,
      motivo: "manual",
      deOnde: `${parsed.data.motivo} · ${nomeDaPessoa(porta.user)}`,
      criadoPor: porta.user.id,
    });
    if (r.entrou) {
      void audit({
        action: "email_marketing.supressao_acrescentada",
        actorUserId: porta.user.id,
        organizationId: porta.org.orgId,
        resourceType: "campaign_suppressions",
        requestId: porta.requestId,
        metadata: { motivo: "manual" },
      });
    }
    return ok({ entrou: r.entrou, ja_estava: !r.entrou }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

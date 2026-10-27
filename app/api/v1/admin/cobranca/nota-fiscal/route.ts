/**
 * FORK MIA (.96) · GET e PUT /api/v1/admin/cobranca/nota-fiscal: a nota fiscal
 * de serviço pelo Asaas, emitida NA CONFIRMAÇÃO do pagamento (decisão 8 do
 * protótipo "Pagamento no início"). Admin › Cobrança › Conexão.
 *
 * É a configuração da INSTALAÇÃO (quem emite é a Time): o serviço municipal e os
 * impostos que o Asaas pede (`invoiceSettings` de cada assinatura). Mora em
 * `platform_config` (`MIA_NOTA_FISCAL_DO_ASAAS`, lib/asaas-mia/nota.ts). Gravar
 * é escrita de dono da instalação, com a verificação em duas etapas
 * (`requirePlatformAdminEscrita`); as assinaturas recebem a configuração nova
 * na próxima rodada horária da cobrança.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { gravarConfiguracaoDaNota, lerConfiguracaoDaNota } from "@/lib/asaas-mia/nota";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  return ok({ configuracao: await lerConfiguracaoDaNota(createAdminClient()) }, { requestId });
}

export async function PUT(req: Request) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const corpo = await req.json().catch(() => null);
  const r = await gravarConfiguracaoDaNota(createAdminClient(), corpo as never, ator);
  if (!r.ok) {
    return r.motivo === "invalida"
      ? fail("validation_failed", "Confira o código do serviço e os impostos (de 0 a 100%).", 400, { requestId })
      : fail("internal_error", "Não foi possível salvar. Tente de novo.", 500, { requestId });
  }
  void audit({
    action: "cobranca.nota_fiscal_configurada",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "platform_config",
    requestId,
    metadata: { com_codigo: Boolean(r.config.servicoMunicipalCodigo), com_id: Boolean(r.config.servicoMunicipalId) },
  });
  return ok({ configuracao: r.config }, { requestId });
}

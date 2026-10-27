/**
 * FORK MIA (.96, segunda frente) · POST /api/v1/admin/empresas-do-cadastro/[id]/apagar:
 * "Apagar o cadastro" em Admin › Empresas do cadastro (protótipo "Pagamento no
 * início", tela 4 e decisão 5).
 *
 * Só aparece, e só passa, depois de 30 dias sem nenhum pagamento; NUNCA roda
 * sozinho. Admin da plataforma com escopo `full` e a verificação em duas etapas
 * da sessão (`requirePlatformAdminEscrita`), como as outras escritas desta tela;
 * o corpo traz o nome curto (slug) digitado como confirmação. O procedimento
 * inteiro mora em `lib/pagamento-inicial/cadastro-sem-pagamento.ts`: cancela a
 * cobrança no Asaas, prepara no banco (9126) e chama a exclusão do upstream.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, type PlatformAdminContext } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { apagarCadastroSemPagamento } from "@/lib/pagamento-inicial/cadastro-sem-pagamento";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ confirmacao: z.string().trim().min(1).max(200) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Empresa não encontrada.", 404, { requestId });

  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  let corpo: z.infer<typeof corpoSchema>;
  try {
    corpo = corpoSchema.parse(await req.json());
  } catch {
    return fail("validation_failed", "Digite o nome curto da empresa para confirmar.", 400, { requestId });
  }

  const r = await apagarCadastroSemPagamento(createAdminClient(), {
    orgId: id,
    atorId: adminCtx.user.id,
    confirmacao: corpo.confirmacao,
    requestId,
  });
  if (!r.ok) return fail(r.code, r.message, r.status, { requestId });
  return ok(
    {
      dias: r.dias,
      logins_removidos: r.resultado.usuarios.removidos.length,
      logins_mantidos: r.resultado.usuarios.mantidos.length,
      arquivos: r.resultado.arquivos,
    },
    { requestId },
  );
}

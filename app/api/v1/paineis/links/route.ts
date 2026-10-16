/**
 * FORK MIA (9031) — GET/POST /api/v1/paineis/links
 *
 * Os links dos painéis prontos para o dono do negócio (`lib/paineis/link.ts`).
 *
 *  - GET: a lista da empresa, com o endereço de cada um ("Copiar link" funciona
 *    a qualquer hora: o token é derivado do id no servidor e nunca é gravado).
 *  - POST: cria um link. Valida painéis, período, validade e funil; o funil tem
 *    de ser da empresa. Audita `paineis.link_criado`, sem o token.
 *    FORK MIA (9042): ou os prontos (`paineis`) ou um painel do montador
 *    (`painel_id`, da mesma empresa): o link mostra os relatórios do painel,
 *    menos os que identificam pessoa da equipe (`lib/relatorios/link.ts`).
 *
 * Gestor e administrador (decisão do protótipo: quem cria e revoga são os que
 * respondem pela empresa). A tabela é só do servidor (RLS sem política): a
 * leitura e a escrita passam pelo cliente de serviço DEPOIS da conferência do
 * papel, com a organização da sessão, nunca do corpo. A empresa de
 * demonstração cria link normalmente: ele só lê os dados fictícios.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAINEIS_PRONTOS, PERIODOS_DOS_PAINEIS } from "@/lib/paineis/catalogo";
import { criarLink, LinkRecusado, listarLinks, type ValidadeEmDias } from "@/lib/paineis/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const criarSchema = z
  .object({
    para_quem: z.string().trim().min(1).max(120),
    paineis: z.array(z.enum(PAINEIS_PRONTOS)).max(PAINEIS_PRONTOS.length).default([]),
    painel_id: z.string().uuid().nullish(),
    periodo: z.enum(["escolhe", ...PERIODOS_DOS_PAINEIS]),
    mostrar_valores: z.boolean(),
    validade_dias: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
    pipeline_id: z.string().uuid().nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.painel_id) !== v.paineis.length > 0, { message: "os prontos OU um painel do montador" });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "paineis" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", t("O link para o dono não está disponível nesta instalação."), 503, { requestId });
  }
  const links = await listarLinks(createAdminClient(), authz.org.orgId);
  return ok({ links }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "paineis" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", t("O link para o dono não está disponível nesta instalação."), 503, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  }
  const lido = criarSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", t("Confira os campos do link."), 422, {
      requestId,
      details: lido.error.flatten() as unknown as Record<string, unknown>,
    });
  }
  const d = lido.data;
  try {
    const link = await criarLink(
      createAdminClient(),
      { organizationId: authz.org.orgId, actorUserId: authz.user.id, requestId, via: "tela" },
      {
        paraQuem: d.para_quem,
        paineis: d.paineis,
        painelId: d.painel_id ?? null,
        periodo: d.periodo,
        mostrarValores: d.mostrar_valores,
        pipelineId: d.pipeline_id ?? null,
        validadeDias: d.validade_dias as ValidadeEmDias | undefined,
      },
    );
    return ok({ link }, { requestId, status: 201 });
  } catch (e) {
    if (e instanceof LinkRecusado) {
      return fail("validation_failed", t(e.message), 422, { requestId });
    }
    throw e;
  }
}

import "server-only";

/**
 * FORK MIA (item 9) — o começo comum das rotas do montador
 * (`app/api/v1/relatorios/**`): quem pergunta, a empresa (do cookie validado,
 * nunca do corpo), o cliente da sessão, o cliente de serviço para os nomes da
 * equipe, o funil dos relatórios e a frase traduzida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

import { fail } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { RecusaDoMotor } from "@/lib/paineis/motor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { veValores } from "./acesso";
import { funisDosRelatorios, RelatorioRecusado, type FunilDaEmpresa, type QuemAge } from "./servidor";

export interface ContextoDaRota {
  db: SupabaseClient;
  admin: SupabaseClient | null;
  quem: QuemAge;
  role: string;
  idioma: Idioma;
  t: (texto: string) => string;
  valores: boolean;
  funilPadrao: FunilDaEmpresa | null;
}

export async function contextoDaRota(
  requestId: string,
  papel: Role = "viewer",
): Promise<{ ok: true; ctx: ContextoDaRota } | { ok: false; response: Response }> {
  const authz = await requireRole(papel, { requestId, resource: "relatorios" });
  if (!authz.ok) return { ok: false, response: authz.response };
  const db = await createClient();
  const idioma = authz.user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const { padrao } = await funisDosRelatorios(db, authz.org.orgId);
  return {
    ok: true,
    ctx: {
      db,
      admin: isServiceRoleConfigured() ? createAdminClient() : null,
      quem: { organizationId: authz.org.orgId, userId: authz.user.id, requestId, via: "tela" },
      role: authz.org.role,
      idioma,
      t,
      valores: veValores(authz.org.role),
      funilPadrao: padrao,
    },
  };
}

/** O corpo JSON conferido pelo schema, ou a resposta 422 com a frase. */
export async function lerCorpo<T>(
  req: NextRequest,
  schema: ZodType<T>,
  t: (s: string) => string,
  requestId: string,
): Promise<{ ok: true; dados: T } | { ok: false; response: Response }> {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return { ok: false, response: fail("validation_failed", t("Corpo inválido."), 422, { requestId }) };
  }
  const lido = schema.safeParse(corpo);
  if (!lido.success) {
    return {
      ok: false,
      response: fail("validation_failed", t("Confira os campos do relatório."), 422, {
        requestId,
        details: (lido.error as unknown as { flatten: () => Record<string, unknown> }).flatten(),
      }),
    };
  }
  return { ok: true, dados: lido.data };
}

/** A recusa do montador ou do motor como resposta HTTP legível; o resto sobe. */
export function respostaDaRecusa(e: unknown, t: (s: string) => string, requestId: string): Response {
  if (e instanceof RelatorioRecusado) {
    const status = e.motivo === "nao_encontrado" ? 404 : e.motivo === "sem_permissao" ? 403 : 422;
    const codigo = e.motivo === "nao_encontrado" ? "not_found" : e.motivo === "sem_permissao" ? "forbidden" : "validation_failed";
    return fail(codigo, t(e.message), status, { requestId });
  }
  if (e instanceof RecusaDoMotor) {
    if (e.semPermissao) {
      return fail("forbidden", t("Este relatório não está disponível para o seu acesso."), 403, { requestId });
    }
    return fail("validation_failed", t("Essa configuração não cabe no relatório."), 422, { requestId, details: { motor: e.message } });
  }
  throw e;
}

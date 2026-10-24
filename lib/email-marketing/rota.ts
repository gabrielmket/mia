import "server-only";

/**
 * FORK MIA (.89) — A PORTA das rotas do disparo de e-mail.
 *
 * Toda rota de `/api/v1/email-marketing` passa por três perguntas, nesta ordem:
 * papel (quem faz o quê: administrador configura, gestor envia), módulo
 * contratado (`email_marketing`, a guarda de VERDADE: o menu esconde, e
 * esconder não é recusar) e, nas que escrevem, o modo do suporte
 * (`requireSupportWrite`, antes do efeito). A organização vem da sessão, nunca
 * do corpo.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { ActiveOrg, AuthUser, Role } from "@/lib/auth/types";
import { logger } from "@/lib/logger";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";

import { RecusaDaCampanha } from "./recusa";
import { MODULO_EMAIL_MARKETING } from "./regras";

export interface PortaAberta {
  ok: true;
  requestId: string;
  user: AuthUser;
  org: ActiveOrg;
  admin: SupabaseClient;
}

export type Porta = PortaAberta | { ok: false; response: NextResponse<ApiError> };

export async function portaDoEmail(
  min: Role,
  opcoes: { escreve: boolean; exigeModulo?: boolean; resource?: string },
): Promise<Porta> {
  // `escreve`: a rota que escreve chama `requireSupportWrite()` ANTES desta
  // porta, no próprio handler (a cerca `suporte-cobertura-de-efeitos` lê o
  // handler). Aqui ele só documenta a intenção.
  void opcoes.escreve;
  const requestId = randomUUID();
  const authz = await requireRole(min, {
    requestId,
    resource: opcoes.resource ?? "email_marketing",
  });
  if (!authz.ok) return authz;
  const admin = createAdminClient();
  if (
    opcoes.exigeModulo !== false &&
    !(await moduloLiberado(admin, authz.org.orgId, MODULO_EMAIL_MARKETING))
  ) {
    return {
      ok: false,
      response: fail(
        "forbidden",
        "O disparo de e-mail não está contratado para esta empresa.",
        403,
        { requestId },
      ),
    };
  }
  return { ok: true, requestId, user: authz.user, org: authz.org, admin };
}

/** A recusa conhecida vira a resposta dela; o resto vira 500, com o cru só no log. */
export function respostaDoErro(err: unknown, requestId: string): NextResponse<ApiError> {
  if (err instanceof RecusaDaCampanha) {
    return fail(err.codigo, err.message, err.status, {
      requestId,
      ...(err.detalhes ? { details: err.detalhes } : {}),
    });
  }
  logger.error("[email-marketing] falha na rota", {
    request_id: requestId,
    error: err instanceof Error ? err.message : String(err),
  });
  return fail("internal_error", "Não deu certo agora. Tente de novo em instantes.", 500, {
    requestId,
  });
}

/** O corpo JSON, ou a recusa 422. */
export async function corpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new RecusaDaCampanha("validation_failed", "Corpo inválido.");
  }
}

/** O nome de quem está na sessão, para a declaração e para o registro. */
export function nomeDaPessoa(user: AuthUser): string {
  return user.full_name?.trim() || user.email || "a pessoa";
}

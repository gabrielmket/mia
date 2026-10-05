"use server";

/**
 * FORK MIA — as ações da tela Configurações › Conversões que continuam NOSSAS
 * depois que a régua por etapa da Meta do upstream (0524) virou a principal na
 * .72 (docs/fork/conversoes-da-meta.md):
 *
 *   · definirLeadsDeFormularioDaMeta   a chave "leads de formulário voltam"
 *   · testarConexaoDaMeta              o diagnóstico da Meta (só leitura)
 *
 * As regras de etapa são gravadas pela ação do upstream
 * (`salvarRegrasDeConversaoMeta.ts`), e o reenvio pela rota dele
 * (`/api/v1/leads/[id]/conversion/retry`).
 *
 * O MESMO gate das outras ações de Conversões (`salvarRegrasDeConversaoGoogle`,
 * `definirVendaPeloCanal`): sessão, suporte em modo leitura não escreve,
 * administrador da organização (`podeAdministrarEmpresa`, a regra única do
 * upstream), segundo fator em dia. O miolo da escrita mora em
 * `lib/conversoes-meta/`, porque a ferramenta do MCP de plataforma chama a
 * mesma função.
 *
 * ⚠️ SERVICE ROLE COM `organization_id` DE FONTE CONFIÁVEL: as tabelas só
 * aceitam escrita do servidor, e o id vem de `resolveActiveOrg`, nunca de
 * argumento.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { definirChaveDeFormulario, type QuemSalva } from "@/lib/conversoes-meta/config";
import { diagnosticarConexaoDaMeta, type DiagnosticoDaMeta } from "@/lib/conversoes-meta/diagnostico";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

type Recusa = "unauthenticated" | "forbidden_tenant" | "forbidden_role" | "mfa_required";

/**
 * Quem está pedindo, e se pode. `escreve: false` é o diagnóstico: exige o mesmo
 * papel, e não a guarda de escrita nem o segundo fator, porque nada é gravado.
 */
async function autorizar(escreve: boolean): Promise<{ ok: true; quem: QuemSalva } | { ok: false; error: Recusa }> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (escreve && supportWriteError(authUser.support)) return { ok: false, error: "forbidden_role" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(authUser, activeOrg)) return { ok: false, error: "forbidden_role" };
  // Depois do papel: quem nem tem o papel recebe a verdade sobre ele, não uma
  // cobrança de segundo fator.
  if (escreve && (await mfaEmDivida())) return { ok: false, error: "mfa_required" };

  const hdrs = await headers();
  return {
    ok: true,
    quem: {
      organizationId: activeOrg.orgId,
      autorUserId: authUser.id,
      requestId: hdrs.get("x-request-id") ?? undefined,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: hdrs.get("user-agent") ?? undefined,
      via: "tela",
    },
  };
}

// ── leads de formulário voltam para a Meta ──────────────────────────────────

export type DefinirLeadsDeFormularioResult =
  | { ok: true }
  | { ok: false; error: Recusa | "validation_failed" | "erro_ao_gravar" };

export async function definirLeadsDeFormularioDaMeta(ligar: boolean): Promise<DefinirLeadsDeFormularioResult> {
  const entrada = z.boolean().safeParse(ligar);
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const autorizado = await autorizar(true);
  if (!autorizado.ok) return autorizado;

  const resultado = await definirChaveDeFormulario(createAdminClient(), autorizado.quem, entrada.data);
  if (!resultado.ok) return { ok: false, error: resultado.erro };

  revalidatePath("/app/settings/conversoes");
  return { ok: true };
}

// ── o diagnóstico ───────────────────────────────────────────────────────────

export type TestarConexaoDaMetaResult =
  | { ok: true; diagnostico: DiagnosticoDaMeta }
  | { ok: false; error: Recusa | "leitura_indisponivel" };

/** Só leitura: três perguntas à Meta e duas ao histórico. Nenhum evento é enviado. */
export async function testarConexaoDaMeta(): Promise<TestarConexaoDaMetaResult> {
  const autorizado = await autorizar(false);
  if (!autorizado.ok) return autorizado;
  try {
    return {
      ok: true,
      diagnostico: await diagnosticarConexaoDaMeta(createAdminClient(), autorizado.quem.organizationId),
    };
  } catch {
    return { ok: false, error: "leitura_indisponivel" };
  }
}

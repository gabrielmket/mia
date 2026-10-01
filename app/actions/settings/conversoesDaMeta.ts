"use server";

/**
 * FORK MIA — as ações da tela Configurações › Conversões para a META por etapa
 * do funil (migration 9017, docs/fork/conversoes-da-meta.md):
 *
 *   · salvarRegrasDeConversaoMeta      o que cada etapa informa à Meta
 *   · definirLeadsDeFormularioDaMeta   a chave "leads de formulário voltam"
 *   · testarConexaoDaMeta              o diagnóstico (só leitura)
 *   · reenviarConversaoDaMeta          o reenvio de um evento de etapa
 *
 * O MESMO gate das outras ações de Conversões (`salvarRegrasDeConversaoGoogle`,
 * `definirVendaPeloCanal`): sessão, suporte em modo leitura não escreve,
 * administrador da organização, segundo fator em dia. O miolo de cada escrita
 * mora em `lib/conversoes-meta/`, porque a ferramenta do MCP de plataforma
 * chama a mesma função.
 *
 * ⚠️ SERVICE ROLE COM `organization_id` DE FONTE CONFIÁVEL: as tabelas só
 * aceitam escrita do servidor, e o id vem de `resolveActiveOrg`, nunca de
 * argumento.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { definirChaveDeFormulario } from "@/lib/conversoes-meta/config";
import { diagnosticarConexaoDaMeta, type DiagnosticoDaMeta } from "@/lib/conversoes-meta/diagnostico";
import {
  CHAVES_DOS_EVENTOS_DA_META,
  ehEventoDaMetaNoLivro,
  TETO_DO_VALOR_FIXO_CENTAVOS,
  VALORES_DE_CANAL_DA_META,
  VALORES_DE_MODO_DO_VALOR,
} from "@/lib/conversoes-meta/eventos";
import { salvarRegrasDaMeta, type QuemSalva } from "@/lib/conversoes-meta/regras";
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
  if (!(authUser.is_platform_admin && !authUser.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }
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

// ── o que cada etapa informa à Meta ─────────────────────────────────────────

const regraSchema = z
  .object({
    stage_id: z.uuid(),
    ligada: z.boolean(),
    evento: z.enum(CHAVES_DOS_EVENTOS_DA_META),
    canal: z.enum(VALORES_DE_CANAL_DA_META),
    modo_do_valor: z.enum(VALORES_DE_MODO_DO_VALOR),
    valor_fixo_centavos: z.number().int().positive().max(TETO_DO_VALOR_FIXO_CENTAVOS).nullable(),
  })
  .refine((r) => r.modo_do_valor !== "valor_fixo" || r.valor_fixo_centavos !== null, {
    message: "Valor fixo precisa de um valor maior que zero.",
  });

const regrasSchema = z
  .array(regraSchema)
  .max(200)
  .refine((lista) => new Set(lista.map((r) => r.stage_id)).size === lista.length, { message: "Etapa repetida." });

export type RegraDeConversaoMetaInput = z.input<typeof regraSchema>;

export type SalvarRegrasDaMetaResult =
  | { ok: true }
  | {
      ok: false;
      error: Recusa | "validation_failed" | "etapa_invalida" | "valor_fixo_invalido" | "erro_ao_gravar";
    };

export async function salvarRegrasDeConversaoMeta(
  input: RegraDeConversaoMetaInput[],
): Promise<SalvarRegrasDaMetaResult> {
  // Server Action é endpoint público: o tipo do parâmetro não chega ao servidor.
  const parsed = regrasSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const autorizado = await autorizar(true);
  if (!autorizado.ok) return autorizado;

  const resultado = await salvarRegrasDaMeta(
    createAdminClient(),
    autorizado.quem,
    parsed.data.map((r) => ({
      stageId: r.stage_id,
      ligada: r.ligada,
      evento: r.evento,
      canal: r.canal,
      modoDoValor: r.modo_do_valor,
      valorFixoCentavos: r.valor_fixo_centavos,
    })),
  );
  if (!resultado.ok) {
    return { ok: false, error: resultado.erro === "etapa_repetida" ? "validation_failed" : resultado.erro };
  }

  revalidatePath("/app/settings/conversoes");
  return { ok: true };
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

// ── o reenvio de um evento de etapa ─────────────────────────────────────────

export type ReenviarConversaoDaMetaResult =
  | { ok: true; agendado: boolean }
  | { ok: false; error: Recusa | "validation_failed" | "erro_ao_gravar" };

/**
 * Agenda o reenvio de um evento de ETAPA da Meta (`Meta:<evento>`). A compra e
 * os eventos do Google seguem pela rota do upstream
 * (`/api/v1/leads/[id]/conversion/retry`).
 *
 * `agendado: false` não é erro: o banco decidiu que não há o que reenviar (já
 * foi enviado, passou de 7 dias, já tem um pedido na fila).
 */
export async function reenviarConversaoDaMeta(
  leadId: string,
  evento: string,
): Promise<ReenviarConversaoDaMetaResult> {
  const entrada = z.object({ leadId: z.uuid(), evento: z.string().refine(ehEventoDaMetaNoLivro) }).safeParse({
    leadId,
    evento,
  });
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const autorizado = await autorizar(true);
  if (!autorizado.ok) return autorizado;
  const { quem } = autorizado;

  const { data, error } = await createAdminClient().rpc("fn_mia_solicitar_reenvio_conversao_meta" as never, {
    p_org: quem.organizationId,
    p_lead: entrada.data.leadId,
    p_event: entrada.data.evento,
  } as never);
  if (error) return { ok: false, error: "erro_ao_gravar" };

  const agendado = data === true;
  if (agendado) {
    await audit({
      action: "conversoes_meta.reenvio_solicitado",
      actorUserId: quem.autorUserId,
      organizationId: quem.organizationId,
      resourceType: "crm_leads",
      resourceId: entrada.data.leadId,
      requestId: quem.requestId,
      ip: quem.ip,
      userAgent: quem.userAgent,
      metadata: { event_name: entrada.data.evento },
    });
    revalidatePath("/app/settings/conversoes");
  }
  return { ok: true, agendado };
}

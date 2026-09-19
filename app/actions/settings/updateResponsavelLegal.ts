"use server";

import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import {
  responsavelLegalSchema,
  type ResponsavelLegalInput,
} from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type UpdateResponsavelLegalResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

/**
 * Declara quem responde legalmente por ESTA instalação (item E7, migration 0267).
 *
 * ── O que esta escrita muda ───────────────────────────────────────────────
 *
 * `/legal/privacy` e `/legal/terms` nomeiam o operador. Até a 0267 esse nome
 * saía da ORGANIZAÇÃO ATIVA DA SESSÃO — correto num self-host, falso numa
 * instalação gerenciada, onde fazia o documento declarar que um CLIENTE instalou
 * e opera o servidor, e trocar de nome conforme quem estava logado.
 *
 * Preencher a razão social aqui é o interruptor: o documento passa a nomear
 * ESTE operador para todo leitor, com sessão ou sem. Apagá-la devolve a
 * instalação ao modo self-host.
 *
 * ── Por que `is_platform_admin`, e não `admin` do tenant ──────────────────
 *
 * Mesma razão de `updateBranding.ts`, e mais pesada: o que se edita aqui é o
 * texto jurídico que vale para TODOS os tenants. Um admin de cliente que
 * pudesse escrever isto poderia declarar a própria empresa controladora dos
 * dados dos outros clientes da instalação.
 *
 * ── Por que NÃO invalida o cache da marca ─────────────────────────────────
 *
 * `invalidarMarcaDaInstalacao()` existe porque a marca é lida a cada render de
 * toda tela e vive num memo com TTL. Estas colunas são lidas só por
 * `/legal/*`, que é `force-dynamic` e consulta o banco a cada visita — não há
 * cache a invalidar, e chamar a invalidação aqui faria parecer que há.
 */
export async function updateResponsavelLegal(
  input: ResponsavelLegalInput,
): Promise<UpdateResponsavelLegalResult> {
  const parsed = responsavelLegalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const { user: authUser } = await requirePlatformAdmin();

  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const { error } = await createAdminClient()
    .from("platform_branding")
    // `upsert` pela mesma razão que `updateBranding.ts`: numa instalação que
    // nunca tocou na marca a linha `id = 1` ainda não existe, e um `update`
    // casaria zero linhas devolvendo sucesso — a tela diria "salvo" e o
    // documento legal continuaria nomeando o cliente.
    .upsert({ id: 1, ...parsed.data }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  await audit({
    action: "platform_branding.responsavel_legal_updated",
    actorUserId: authUser.id,
    // Sem `organizationId`: o responsável legal da instalação não pertence a
    // tenant nenhum, e carimbar a organização ativa de quem salvou faria a
    // trilha sugerir que a mudança foi daquele cliente.
    resourceType: "platform_branding",
    // `null` e não `"1"`: `api_audit_log.resource_id` é `uuid`, e a chave
    // natural do singleton estouraria o INSERT com 22P02 — que, sendo o audit
    // fire-and-forget, sumiria sem sintoma em tela nenhuma.
    resourceId: null,
    requestId,
    ip,
    userAgent,
    actingAsPlatformAdmin: true,
    metadata: {
      // FORMA, nunca IDENTIDADE — a mesma disciplina do resto da auditoria de
      // plataforma. Quem responde legalmente é dado público no documento, mas a
      // trilha não é o lugar de repeti-lo.
      modo: parsed.data.operador_razao_social ? "gerenciado" : "self_host",
      cnpj_declarado: parsed.data.operador_cnpj !== null,
      dpo_declarado: parsed.data.operador_dpo_email !== null,
      politica_declarada: parsed.data.operador_politica_url !== null,
    },
  });

  return { ok: true };
}

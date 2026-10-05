import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/ai/knowledge/sources — os materiais da organização
 * POST /api/v1/ai/knowledge/sources — cadastra um material
 *
 * Desde a 0181 o acervo é da ORGANIZAÇÃO, não de um agente. `agent_id` continua
 * aceito e vira registro histórico de onde o material nasceu; quem lê o quê é
 * escolha da versão publicada de cada assistente
 * (`ai_agent_versions.knowledge_source_ids`).
 *
 * Auth: sessão por cookie, papel >= manager para escrever.
 * `organization_id` SEMPRE sai da sessão autenticada — nunca do corpo.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi, requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { criarMaterial } from "@/lib/ai/rag/criar-material";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  locale: z.string().optional().default("pt-BR"),
});

/**
 * O tipo chega como texto livre e é CANONIZADO na borda.
 *
 * Um `z.enum` aqui recusaria os nomes legados (`policy`, `conversations`) que
 * quem integrou por API ainda manda — e o CHECK do banco saiu justamente para o
 * vocabulário poder crescer sem migration. `canonizarTipoDeFonte` traduz; o que
 * não traduzir é recusado com a lista do que existe.
 */
const createSourceSchema = z.object({
  /** Opcional desde a 0181: o material é da organização. */
  agent_id: z.string().uuid().optional(),
  source_type: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  items: z.array(faqItemSchema).optional(),
  markdown_blob: z.string().optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const SELECT_COLUNAS =
  "id, agent_id, organization_id, source_type, name, status, last_index_status, " +
  "last_index_error, last_indexed_at, chunks_count, is_active, source_metadata, " +
  "active_kb_version_id, ingested_at, created_at, updated_at";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) {
    return fail("forbidden", "Nenhuma organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_knowledge_sources")
    .select(SELECT_COLUNAS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ai-knowledge-sources] GET falhou:", error.message);
    return fail("internal_error", "Erro ao listar os materiais.", 500, { requestId });
  }

  // `ok()` já embrulha em `{ data }`. Com `{ data: data ?? [] }` o corpo saía
  // `{ data: { data: [...] } }` e o hook fazia `.filter` sobre o envelope.
  return ok(data ?? [], { requestId });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg } = authz;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }

  const parsed = createSourceSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  // FORK MIA: a criação (tipo, conteúdo, arquivo do texto colado, itens, evento
  // de indexação) mora em `lib/ai/rag/criar-material.ts`, compartilhada com o
  // MCP de plataforma. Aqui só há transporte e a tradução da frase.
  const criado = await criarMaterial(
    { admin: createAdminClient(), leitura: await createClient(), organizationId: activeOrg.orgId },
    parsed.data,
  );
  if (!criado.ok) return fail(criado.code, t(criado.message), criado.status, { requestId });

  return ok(
    { id: criado.id, items_count: criado.items_count, indexacao_habilitada: criado.indexacao_habilitada },
    { status: 201, requestId },
  );
}

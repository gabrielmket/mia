/**
 * GET|PATCH|DELETE /api/v1/empresas/[id] — a ficha de uma empresa.
 *
 * O GET traz a empresa COM as pessoas e os negócios dela. É a razão de existir
 * da entidade: se a ficha abrisse só com os dados cadastrais, ela seria uma
 * agenda de CNPJ, e a pergunta que fez a empresa existir ("quem fala com a
 * gente lá dentro, e quanto já negociamos") continuaria sem resposta.
 *
 * DELETE apaga só a empresa. Os contatos e os negócios ficam, sem vínculo — o
 * `on delete set null` da migration 0255. Um clique numa tela de cadastro não
 * pode custar o histórico de venda de um cliente.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { empresaUpdateSchema } from "@/lib/schemas/empresas";
import { createClient } from "@/lib/supabase/server";

import { COLUNAS_DA_EMPRESA } from "../route";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: empresa, error } = await supabase
    .from("crm_empresas")
    .select(COLUNAS_DA_EMPRESA)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("db_error", error.message, 500, { requestId });
  if (!empresa) return fail("not_found", "Empresa não encontrada.", 404, { requestId });

  const [{ data: contatos }, { data: negocios }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, display_name, name, phone_number, email")
      .eq("organization_id", authz.org.orgId)
      .eq("empresa_id", id)
      .order("display_name", { ascending: true })
      .limit(200),
    supabase
      .from("crm_leads")
      .select("id, title, status, value_cents, currency, stage_id, created_at")
      .eq("organization_id", authz.org.orgId)
      .eq("empresa_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  /**
   * O total soma só negócio GANHO.
   *
   * "Quanto essa empresa já nos rendeu" e "quanto tem em aberto com ela" são
   * perguntas diferentes, e somar as duas num número só produz um valor que não
   * responde nenhuma — o mais caro dos relatórios: o que parece certo.
   */
  const ganhoCents = (negocios ?? [])
    .filter((n) => (n as { status?: string }).status === "won")
    .reduce((soma, n) => soma + Number((n as { value_cents?: number | null }).value_cents ?? 0), 0);

  return ok(
    {
      ...empresa,
      contatos: contatos ?? [],
      negocios: negocios ?? [],
      total_ganho_cents: ganhoCents,
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = empresaUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [campo, valor] of Object.entries(parsed.data)) {
    if (valor === undefined) continue;
    // Campo de texto apagado pelo usuário vira `null`, não `''` — é a mesma
    // razão do POST: `''` colide no índice único do CNPJ, e "vazio" e "nunca
    // preenchido" devem ser a mesma coisa para quem lê a ficha.
    // Objeto vazio é valor legítimo em `custom_fields` ("apaguei todos os
    // campos"), e a regra de string vazia não o alcança — ela é para texto.
    patch[campo] = typeof valor === "string" && valor.trim() === "" ? null : valor;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_empresas")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DA_EMPRESA)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma empresa com esse CNPJ.", 409, { requestId });
    }
    return fail("db_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Empresa não encontrada.", 404, { requestId });

  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_empresas")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (error) return fail("db_error", error.message, 500, { requestId });

  return ok({ id }, { requestId });
}

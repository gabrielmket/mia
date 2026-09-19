/**
 * GET  /api/v1/empresas — a lista de empresas do tenant (com busca).
 * POST /api/v1/empresas — cadastra uma.
 *
 * A leitura é de qualquer membro (`viewer`): a lista de clientes é informação
 * de operação, e esconder dela quem atende faria o atendente perguntar ao
 * cliente o nome da própria empresa. A escrita começa em `agent`, o mesmo
 * degrau de quem cria negócio.
 *
 * O escopo por organização é da RLS (`crm_empresas_select`/`_escrita`,
 * migration 0255), por isso aqui se usa o client de SESSÃO e não o admin: o
 * filtro por tenant fica no banco, onde não dá para esquecer.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { empresaCreateSchema, empresaListQuerySchema } from "@/lib/schemas/empresas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const COLUNAS_DA_EMPRESA =
  "id, nome, cnpj, site, telefone, email, endereco, observacoes, tags, custom_fields, created_at, updated_at";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const parsed = empresaListQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) return fail("validation_failed", "Busca inválida.", 422, { requestId });
  const { q, limit, offset } = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("crm_empresas")
    .select(COLUNAS_DA_EMPRESA, { count: "exact" })
    .eq("organization_id", authz.org.orgId)
    .order("nome", { ascending: true })
    .range(offset, offset + limit - 1);

  if (q) {
    /**
     * Procura no nome E no documento, porque quem tem a lista na frente digita
     * o nome e quem tem a nota fiscal digita o CNPJ. O documento é guardado só
     * com dígitos, então o que a pessoa colar com pontuação é limpo antes —
     * senão `12.345` nunca acha `12345`.
     */
     const digitos = q.replace(/\D/g, "");
     const alvo = digitos.length >= 3 ? `nome.ilike.%${q}%,cnpj.ilike.%${digitos}%` : `nome.ilike.%${q}%`;
     query = query.or(alvo);
  }

  const { data, error, count } = await query;
  if (error) return fail("db_error", error.message, 500, { requestId });

  return ok(data ?? [], { requestId, meta: { total: count ?? 0, limit, offset } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const parsed = empresaCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_empresas")
    .insert({
      organization_id: authz.org.orgId,
      nome: parsed.data.nome,
      // String vazia vira `null`: o índice único de CNPJ ignora nulo, mas trata
      // `''` como valor — duas empresas salvas com o campo em branco colidiriam
      // uma com a outra num erro que não diz nada a quem cadastrou.
      cnpj: parsed.data.cnpj || null,
      site: parsed.data.site || null,
      telefone: parsed.data.telefone || null,
      email: parsed.data.email || null,
      endereco: parsed.data.endereco || null,
      observacoes: parsed.data.observacoes || null,
      tags: parsed.data.tags ?? [],
      custom_fields: parsed.data.custom_fields ?? {},
      created_by_user_id: authz.user.id,
    })
    .select(COLUNAS_DA_EMPRESA)
    .single();

  if (error) {
    // 23505 só pode ser o CNPJ — é o único índice único desta tabela. A frase
    // diz o que fazer; "duplicate key value violates unique constraint" não.
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma empresa com esse CNPJ.", 409, { requestId });
    }
    return fail("db_error", error.message, 500, { requestId });
  }

  return ok(data, { requestId, status: 201 });
}

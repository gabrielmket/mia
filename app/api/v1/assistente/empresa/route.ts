/**
 * FORK MIA (.88) — GET/PUT/POST/DELETE /api/v1/assistente/empresa: o que o
 * ADMINISTRADOR da empresa ajusta no assistente da MIA.
 *
 *   GET     a configuração (quem usa, o limite, o resumo padrão), a base própria
 *           ("como trabalhamos aqui") e as perguntas que ficaram sem resposta.
 *   PUT     `{ papeis }`: quais papéis usam o assistente (regra "Quem usa": o
 *           administrador pode desligar por papel). O limite diário e o
 *           liga/desliga da empresa são da plataforma (MCP), porque a IA é dela.
 *   POST    `{ titulo, texto, ativo? }`: garante um item da base própria.
 *   DELETE  `?titulo=`: tira um item.
 *
 * As perguntas sem resposta saem pela SESSÃO: a RLS da 9050 mostra ao
 * administrador só a PERGUNTA marcada sem resposta, nunca a resposta nem o resto
 * da conversa de alguém. A base própria também é gravada pela sessão (a RLS só
 * deixa o administrador). A configuração é tabela só do servidor: a escrita
 * passa pelo cliente de serviço, com a empresa da sessão.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerConfigDoAssistente } from "@/lib/assistente/config";
import { garantirConhecimento } from "@/lib/assistente/conhecimento";
import { PAPEIS_DO_ASSISTENTE } from "@/lib/assistente/tipos";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const papeisSchema = z.object({ papeis: z.array(z.enum(PAPEIS_DO_ASSISTENTE)).max(4) }).strict();
const itemSchema = z
  .object({
    titulo: z.string().trim().min(1).max(120),
    texto: z.string().trim().min(1).max(2000),
    ativo: z.boolean().optional(),
  })
  .strict();

/** As perguntas sem resposta dos últimos 30 dias, agrupadas pelo texto. */
function agruparPerguntas(linhas: Array<{ texto: string; created_at: string }>) {
  const grupos = new Map<string, { texto: string; vezes: number; ultima_em: string }>();
  for (const l of linhas) {
    const chave = l.texto.trim().toLowerCase();
    const g = grupos.get(chave);
    if (g) {
      g.vezes += 1;
      if (l.created_at > g.ultima_em) g.ultima_em = l.created_at;
    } else grupos.set(chave, { texto: l.texto.trim(), vezes: 1, ultima_em: l.created_at });
  }
  return [...grupos.values()].sort((a, b) => b.vezes - a.vezes || b.ultima_em.localeCompare(a.ultima_em)).slice(0, 50);
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const db = await createClient();
  const config = await lerConfigDoAssistente(db, orgId);
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [base, semResposta] = await Promise.all([
    db
      .from("mia_assistente_conhecimento")
      .select("id, titulo, texto, ativo, updated_at")
      .eq("organization_id", orgId)
      .order("titulo", { ascending: true })
      .limit(60),
    db
      .from("mia_assistente_mensagens")
      .select("texto, created_at")
      .eq("organization_id", orgId)
      .eq("tipo", "pergunta")
      .eq("sem_resposta", true)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (base.error || semResposta.error) {
    return fail("unavailable", t("Não deu para ler a configuração do assistente agora."), 503, { requestId });
  }
  return ok(
    {
      config: {
        ligado: config.ligado,
        papeis: config.papeis,
        perguntas_por_pessoa_por_dia: config.perguntasPorPessoaPorDia,
        resumo_da_manha_padrao: config.resumoDaManhaPadrao,
      },
      base: base.data ?? [],
      sem_resposta: agruparPerguntas((semResposta.data ?? []) as Array<{ texto: string; created_at: string }>),
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = papeisSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Pedido inválido."), 422, { requestId });
  const papeis = [...new Set(parsed.data.papeis)];

  const admin = createAdminClient();
  const { error } = await admin
    .from("mia_assistente_config")
    .upsert(
      { organization_id: authz.org.orgId, papeis, updated_by: authz.user.id, updated_at: new Date().toISOString() },
      { onConflict: "organization_id" },
    );
  if (error) return fail("unavailable", t("Não deu para guardar a configuração agora."), 503, { requestId });

  void audit({
    action: "assistente.configurado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "mia_assistente_config",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { papeis, via: "tela" },
  });
  return ok({ papeis }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = itemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Item inválido."), 422, { requestId });

  const db = await createClient();
  let resultado;
  try {
    resultado = await garantirConhecimento(db, {
      organizationId: authz.org.orgId,
      itens: [parsed.data],
      autorUserId: authz.user.id,
      via: "tela",
    });
  } catch {
    return fail("unavailable", t("Não deu para guardar agora."), 503, { requestId });
  }
  if (resultado.recusados.length > 0) {
    return fail("validation_failed", t(resultado.recusados[0]!.motivo), 422, { requestId });
  }
  if (resultado.criados.length + resultado.atualizados.length > 0) {
    void audit({
      action: "assistente.conhecimento_alterado",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "mia_assistente_conhecimento",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { criados: resultado.criados.length, atualizados: resultado.atualizados.length, via: "tela" },
    });
  }
  return ok(resultado, { requestId });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const titulo = new URL(req.url).searchParams.get("titulo")?.trim() ?? "";
  if (!titulo) return fail("validation_failed", t("Diga qual item tirar."), 422, { requestId });

  const db = await createClient();
  let resultado;
  try {
    resultado = await garantirConhecimento(db, {
      organizationId: authz.org.orgId,
      itens: [],
      remover: [titulo],
      autorUserId: authz.user.id,
      via: "tela",
    });
  } catch {
    return fail("unavailable", t("Não deu para tirar agora."), 503, { requestId });
  }
  if (resultado.removidos.length > 0) {
    void audit({
      action: "assistente.conhecimento_alterado",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "mia_assistente_conhecimento",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { removidos: resultado.removidos.length, via: "tela" },
    });
  }
  return ok(resultado, { requestId });
}

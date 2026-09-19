/**
 * PATCH|DELETE /api/v1/channels/templates/[id] — editar e excluir na Meta.
 *
 * `[id]` é o id da NOSSA linha (`meta_templates.id`), não o da Meta: é o que a
 * tela tem em mãos, e o da Meta sai daqui de dentro.
 *
 * A tela criava e sincronizava. Corrigir um texto ou apagar um modelo em desuso
 * exigia abrir o painel da Meta — e quem abre "só ajeita por lá", fazendo o
 * nosso banco divergir do dela. O disparo depois falha com um erro que não
 * menciona nenhuma das duas edições.
 *
 * ⚠️ Editar um template APROVADO o devolve para análise, e ele para de poder
 * ser disparado até a Meta aprovar de novo. A resposta devolve `voltou_para_analise`
 * para a tela poder avisar ANTES que uma campanha agendada morra calada.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { componentesDaMeta, type NovoTemplate } from "@/lib/channels/meta/criar-template";
import { editarTemplate, excluirTemplate } from "@/lib/channels/meta/editar-template";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const edicaoSchema = z.object({
  body: z.string().trim().min(1).max(1024),
  header_texto: z.string().trim().max(60).optional(),
  footer: z.string().trim().max(60).optional(),
  exemplos: z.array(z.string().max(200)).max(10).optional(),
});

/** A linha nossa + o que a Meta precisa para ser editada. */
async function carregar(orgId: string, id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meta_templates")
    .select("id, name, language, category, status, meta_template_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return data as {
    id: string;
    name: string;
    language: string;
    category: string | null;
    status: string;
    meta_template_id: string | null;
  } | null;
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  // Mesmo piso de quem cria: editar fala em nome da marca na Meta, e uma
  // reprovação suja a conta inteira.
  const authz = await requireRole("admin", { requestId, resource: "channels_templates" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Template inválido.", 422, { requestId });

  const linha = await carregar(authz.org.orgId, id);
  if (!linha) return fail("not_found", "Template não encontrado.", 404, { requestId });
  if (!linha.meta_template_id) {
    /**
     * Ausência esperada, e a frase diz o que fazer.
     *
     * O id da Meta só passou a ser guardado na migration 0261; as linhas
     * anteriores o ganham na próxima sincronização. Chamar isto de erro do
     * sistema mandaria o operador procurar defeito onde não há.
     */
    return fail(
      "invalid_request",
      "Sincronize os templates uma vez antes de editar — este ainda não tem o identificador da Meta.",
      409,
      { requestId },
    );
  }

  const creds = await credenciaisDaOrg(authz.org.orgId);
  if (!creds) return fail("invalid_request", "Nenhum canal oficial conectado.", 400, { requestId });

  /**
   * Os componentes são montados pela MESMA função da criação.
   *
   * Duas montagens divergiriam no primeiro campo novo, e a divergência só
   * apareceria como uma recusa da Meta em quem editou — não em quem criou.
   */
  const components = componentesDaMeta({
    name: linha.name,
    language: linha.language,
    category: (linha.category ?? "UTILITY") as NovoTemplate["category"],
    body: parsed.data.body,
    header_texto: parsed.data.header_texto,
    footer: parsed.data.footer,
    exemplos: parsed.data.exemplos,
  } as NovoTemplate);

  const r = await editarTemplate({
    templateId: linha.meta_template_id,
    token: creds.token,
    graphVersion: creds.graphVersion,
    components,
  });
  if (!r.ok) return fail("upstream_error", r.detalhe, 502, { requestId });

  void audit({
    action: "channels.template_editado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { name: linha.name, language: linha.language },
  });

  return ok(
    {
      // A tela usa isto para avisar que a mensagem fica indisponível até a nova
      // aprovação — e é o aviso que salva uma campanha agendada.
      voltou_para_analise: linha.status === "APPROVED",
    },
    { requestId },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_templates" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const linha = await carregar(authz.org.orgId, id);
  if (!linha) return fail("not_found", "Template não encontrado.", 404, { requestId });

  const creds = await credenciaisDaOrg(authz.org.orgId);
  if (!creds) return fail("invalid_request", "Nenhum canal oficial conectado.", 400, { requestId });

  const r = await excluirTemplate({
    wabaId: creds.wabaId,
    token: creds.token,
    graphVersion: creds.graphVersion,
    name: linha.name,
  });
  if (!r.ok) return fail("upstream_error", r.detalhe, 502, { requestId });

  /**
   * Apaga a NOSSA linha também, e por NOME.
   *
   * A Meta apaga todos os idiomas daquele nome — ela não oferece apagar um só.
   * Se o banco apagasse só a linha do idioma clicado, os outros idiomas ficariam
   * no nosso banco parecendo disponíveis e o disparo falharia com "template não
   * existe", que é o erro que ninguém liga à exclusão feita semanas antes.
   */
  const supabase = await createClient();
  await supabase
    .from("meta_templates")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("name", linha.name);

  void audit({
    action: "channels.template_excluido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { name: linha.name },
  });

  return ok({ name: linha.name }, { requestId });
}

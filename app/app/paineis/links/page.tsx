import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { isServiceRoleConfigured } from "@/lib/audit";
import { empresaEDemonstracao } from "@/lib/demonstracao/selo";
import { listarLinks } from "@/lib/paineis/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { LinksDoDonoClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Links para o dono do negócio" };

/**
 * FORK MIA (9031) — LINKS PARA O DONO DO NEGÓCIO (protótipo aprovado em
 * 15/10/2026, tela 7).
 *
 * Gestor e administrador criam, listam, copiam, revogam e renovam. A tabela é
 * só do servidor (`mia_paineis_links`, RLS sem política): a lista é lida aqui
 * com o cliente de serviço DEPOIS de conferir o papel, com a organização da
 * sessão. Quem não é gestor volta para os painéis.
 *
 * O título do painel de agenda e os funis vêm da sessão (o que a pessoa já vê),
 * para o formulário falar a palavra do segmento.
 */
export default async function LinksDoDonoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/app/paineis");

  const disponivel = isServiceRoleConfigured();
  const admin = disponivel ? createAdminClient() : null;
  const sessao = await createClient();
  const [links, funis, demonstracao] = await Promise.all([
    admin ? listarLinks(admin, activeOrg.orgId) : Promise.resolve([]),
    sessao
      .from("crm_pipelines")
      .select("id, name, vocabulary, is_default, is_archived, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true }),
    admin ? empresaEDemonstracao(admin, activeOrg.orgId) : Promise.resolve(false),
  ]);

  const listaDeFunis = ((funis.data ?? []) as Array<{
    id: string;
    name: string;
    vocabulary: Record<string, unknown> | null;
    is_default: boolean;
  }>).map((f) => ({
    id: f.id,
    nome: f.name,
    principal: f.is_default,
    agenda: typeof f.vocabulary?.compromisso_plural === "string" ? (f.vocabulary.compromisso_plural as string) : null,
  }));

  return (
    <LinksDoDonoClient
      linksIniciais={links}
      funis={listaDeFunis}
      demonstracao={demonstracao}
      disponivel={disponivel}
    />
  );
}

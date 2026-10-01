/**
 * FORK MIA — a FICHA DA EMPRESA em página própria: `/app/empresas/<id>`.
 *
 * O cartão aberto do negócio, a ficha do contato e o painel do atendimento levam
 * à empresa pelo nome dela. A organização ativa é conferida aqui, e não só pela
 * RLS: para quem é membro de duas organizações a policy deixa passar as duas.
 */
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { FichaDaEmpresa } from "@/components/cartoes/fichas/FichaDaEmpresa";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Empresa" };

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_empresas")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  return <FichaDaEmpresa empresaId={id} />;
}

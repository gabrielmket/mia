/**
 * FORK MIA (.79, empresa única) — a FICHA DA EMPRESA: `/app/companies/<id>`.
 *
 * A ficha é a do fork (components/cartoes/fichas/FichaDaEmpresa.tsx), em cima
 * do cadastro do upstream; a dele (`./_client.tsx`) fica no repositório como
 * ele a escreveu. A organização ativa é conferida aqui, e não só pela RLS: para
 * quem é membro de duas organizações a policy deixa passar as duas.
 *
 * Empresa que foi juntada a outra (ou casada com outra na cópia da 9033) leva
 * para a que ficou: quem tinha o endereço antigo salvo cai na empresa certa.
 */
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { FichaDaEmpresa } from "@/components/cartoes/fichas/FichaDaEmpresa";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Empresa" };

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!data) {
    const { data: lapide } = await supabase
      .from("mia_companies_mescladas")
      .select("mesclada_com")
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();
    if (lapide?.mesclada_com) redirect(`/app/companies/${lapide.mesclada_com}`);
    notFound();
  }
  return <FichaDaEmpresa empresaId={id} />;
}

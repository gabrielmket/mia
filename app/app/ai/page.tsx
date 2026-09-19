import type { Metadata } from "next";
import { NavHub } from "@/components/shell/NavHub";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { modulosDaOrganizacao } from "@/lib/modulos/liberacao";
import { modoDeVendaDaOrganizacao } from "@/lib/empresas/modo-de-venda";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agente MIA" };

/**
 * Hub da área de IA.
 *
 * Substitui as abas que só apareciam para quem JÁ estava dentro de `/app/ai/*`:
 * Conhecimento, Credenciais, Uso, Casos e Alertas eram invisíveis de qualquer
 * outro lugar do sistema. Aqui as dez telas aparecem juntas, na jornada de quem
 * opera um agente — montar, ensinar, acompanhar.
 */
export default async function AiHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // O hub é INVENTÁRIO: ele mostra o que existe. Módulo não contratado não
  // existe para esta empresa, então some daqui pelo mesmo critério do menu.
  const modulos = activeOrg
    ? [...(await modulosDaOrganizacao(await createClient(), activeOrg.orgId))]
    : undefined;
  // O mesmo critério do menu (item C2): quem vende para pessoa não vê a
  // entidade empresa nem no inventário.
  const modoDeVenda = activeOrg
    ? await modoDeVendaDaOrganizacao(await createClient(), activeOrg.orgId)
    : undefined;

  return (
    <NavHub
      group="ia"
      isPlatformAdmin={user.is_platform_admin && !user.support}
      role={activeOrg?.role ?? null}
      interfaceSettings={activeOrg?.interface_settings}
      modulos={modulos}
      modoDeVenda={modoDeVenda}
      title="Agente MIA"
      subtitle="Tudo que define quem atende por você — e como acompanhar o que ele faz."
    />
  );
}

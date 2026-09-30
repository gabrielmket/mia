import { notFound } from "next/navigation";

import { PaginasDaMeta } from "@/components/admin/paginas-da-meta/PaginasDaMeta";
import { loadAuthUser } from "@/lib/auth/server";

export const metadata = { title: "Páginas da Meta" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.61) — de qual empresa é cada Página da Meta (migration 9004).
 *
 * Fica no painel da plataforma, e não em Configurações da empresa, porque o
 * token que alcança as Páginas é o da agência e enxerga as de todos os
 * clientes: quem decide o dono de cada uma é quem opera a instalação.
 *
 * O layout de `(protected)` já roda `requirePlatformAdmin()`; o gate local fica
 * porque um layout pode ser movido (mesma decisão de `/admin/meta`).
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  return <PaginasDaMeta />;
}

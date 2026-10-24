import { notFound } from "next/navigation";

import { ChamadosDaPlataforma } from "@/components/admin/chamados/ChamadosDaPlataforma";
import { loadAuthUser } from "@/lib/auth/server";

export const metadata = { title: "Chamados do assistente" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.88) — os chamados que as equipes dos clientes abriram pelo assistente
 * da MIA, do lado da Time Company: a lista, o contexto, o print e a resposta.
 *
 * O layout de `(protected)` já roda `requirePlatformAdmin()`; o gate local fica
 * porque um layout pode ser movido (mesma decisão de `/admin/meta`).
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  return <ChamadosDaPlataforma />;
}

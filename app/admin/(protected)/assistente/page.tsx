import { notFound } from "next/navigation";

import { OndeOsClientesTravam } from "@/components/admin/assistente/OndeOsClientesTravam";
import { loadAuthUser } from "@/lib/auth/server";

export const metadata = { title: "Assistente nos clientes" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.93) — onde os clientes travam com o assistente, do lado da Time
 * Company: os temas mais perguntados, o passo onde cada trilha para, as trilhas
 * abandonadas, as propostas desfeitas, as perguntas sem resposta (só o texto,
 * sem nome de ninguém) e a lista de melhorias do produto.
 *
 * O layout de `(protected)` já roda `requirePlatformAdmin()`; o gate local fica
 * porque um layout pode ser movido (mesma decisão de `/admin/chamados`).
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  return <OndeOsClientesTravam />;
}

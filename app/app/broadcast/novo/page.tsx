import type { Metadata } from "next";

import { AvisoDeAcesso } from "@/components/broadcast/AvisoDeAcesso";
import { NovoDisparo } from "@/components/broadcast/NovoDisparo";
import { acessoAoBroadcast } from "@/lib/broadcast/acesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo disparo" };

/**
 * FORK MIA — escolher por onde o disparo sai (docs/fork/broadcast-unificado.md).
 * A porta é o botão "Novo disparo" da lista do Broadcast.
 */
export default async function NovoDisparoPage({
  searchParams,
}: {
  searchParams: Promise<{ por?: string }>;
}) {
  const { acesso } = await acessoAoBroadcast();
  if (acesso.estado !== "liberado") return <AvisoDeAcesso acesso={acesso} />;
  const { por } = await searchParams;
  return <NovoDisparo canais={acesso.canais} inicial={por === "oficial" ? "oficial" : null} />;
}

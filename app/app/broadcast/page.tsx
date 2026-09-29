import type { Metadata } from "next";

import { AvisoDeAcesso } from "@/components/broadcast/AvisoDeAcesso";
import { ListaDoBroadcast } from "@/components/broadcast/ListaDoBroadcast";
import { acessoAoBroadcast } from "@/lib/broadcast/acesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Broadcast" };

/**
 * FORK MIA — o Broadcast unificado (1.21.0-mia.58): os disparos pelo número
 * oficial e pelo número por QR numa lista só. Desenho em
 * docs/fork/broadcast-unificado.md.
 *
 * manager+: cada mensagem oficial gasta dinheiro do cliente e cada uma por QR
 * arrisca o número dele — quem atende não decide nenhuma das duas coisas. As
 * rotas recusam pelo mesmo critério; aqui é para a porta dizer por quê.
 */
export default async function BroadcastPage() {
  const { acesso } = await acessoAoBroadcast();
  if (acesso.estado !== "liberado") return <AvisoDeAcesso acesso={acesso} />;
  return <ListaDoBroadcast canais={acesso.canais} />;
}

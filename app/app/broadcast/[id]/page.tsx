import type { Metadata } from "next";

import { AvisoDeAcesso } from "@/components/broadcast/AvisoDeAcesso";
import { DetalheDoOficial } from "@/components/broadcast/DetalheDoOficial";
import { acessoAoBroadcast } from "@/lib/broadcast/acesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanha" };

/**
 * FORK MIA — o detalhe de um disparo pelo número oficial. O disparo por QR abre
 * no detalhe das Campanhas do upstream (`/app/campaigns/[id]`), intacto.
 */
export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { acesso } = await acessoAoBroadcast();
  // Sem o número oficial liberado, as rotas deste detalhe recusam: dizer por
  // quê é melhor que uma tela de "não consegui carregar".
  if (acesso.estado !== "liberado") return <AvisoDeAcesso acesso={acesso} />;
  if (!acesso.canais.oficial) return <AvisoDeAcesso acesso={{ estado: "nao_contratado" }} />;
  const { id } = await params;
  return <DetalheDoOficial id={id} />;
}

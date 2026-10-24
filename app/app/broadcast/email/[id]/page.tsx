import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AvisoDeAcesso } from "@/components/broadcast/AvisoDeAcesso";
import { CampanhaDeEmail } from "@/components/email-marketing/CampanhaDeEmail";
import { acessoAoBroadcast } from "@/lib/broadcast/acesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanha de e-mail" };

/**
 * FORK MIA (.89) — uma campanha de e-mail, o terceiro caminho do Broadcast
 * (docs/fork/email-marketing.md): Público, Mensagem, Enviar e Resultados.
 *
 * A porta é a do Broadcast (gestor para cima) e o módulo `email_marketing`. A
 * lista do Broadcast e o "Novo disparo" levam até aqui.
 */
export default async function CampanhaDeEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { acesso } = await acessoAoBroadcast();
  if (acesso.estado !== "liberado") return <AvisoDeAcesso acesso={acesso} />;
  if (!acesso.canais.email) return <AvisoDeAcesso acesso={{ estado: "nao_contratado" }} />;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <CampanhaDeEmail id={id} />;
}

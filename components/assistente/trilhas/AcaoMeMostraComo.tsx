"use client";

/**
 * FORK MIA (.93) — o botão "Me mostra como" que chega na resposta do assistente
 * (`AcaoDoAssistente` do tipo `me_mostra_como`): a trilha do catálogo, ou o
 * guia curto do manual que tem tela. O endereço do guia passa por `hrefDoApp`
 * de novo: o histórico é gravado pela sessão, e a tela confere.
 */
import { hrefDoApp, type AcaoDoAssistente } from "@/lib/assistente/tipos";
import { ehIdDeTrilha } from "@/lib/assistente/trilhas/catalogo";

import { BotaoDoGuiaDoManual, BotaoMeMostraComo } from "./BotaoMeMostraComo";

export function AcaoMeMostraComo({
  acao,
  aoComecar,
}: {
  acao: Extract<AcaoDoAssistente, { tipo: "me_mostra_como" }>;
  aoComecar?: () => void;
}) {
  if (acao.trilha_id && ehIdDeTrilha(acao.trilha_id)) return <BotaoMeMostraComo trilha={acao.trilha_id} aoComecar={aoComecar} />;
  const guia = acao.guia;
  const href = guia ? hrefDoApp(guia.href) : null;
  if (!guia || !href || !Array.isArray(guia.passos)) return null;
  return (
    <BotaoDoGuiaDoManual
      manual={{ id: String(guia.id), titulo: String(guia.titulo), href, passos: guia.passos.filter((p) => typeof p === "string").slice(0, 12) }}
      aoComecar={aoComecar}
    />
  );
}

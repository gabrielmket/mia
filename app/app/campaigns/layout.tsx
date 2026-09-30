import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { FaixaDoQr } from "@/components/broadcast/FaixaDoQr";
import { acessoAoBroadcast } from "@/lib/broadcast/acesso";

/**
 * FORK MIA (1.21.0-mia.58) — as Campanhas do upstream são o Broadcast pelo
 * número por QR (docs/fork/broadcast-unificado.md).
 *
 * Arquivo NOSSO numa pasta do upstream, e é de propósito: um layout embrulha
 * todas as telas de `/app/campaigns/*` sem tocar em nenhuma delas. Faz duas
 * coisas:
 *
 *   1. A PORTA. Quem não pode usar o caminho por QR (sem o papel, ou sem o
 *      módulo `disparador` com `QR_EXIGE_O_MODULO` ligado) volta para o
 *      Broadcast, que diz por quê. As rotas de API recusam pelo mesmo critério
 *      (`lib/modulos/recusa-por-recurso.ts`); aqui é para a pessoa não cair
 *      numa tela que só mostra erro.
 *   2. A COSTURA. A faixa "Broadcast › Número por QR" com a volta e o risco.
 *
 * Se o upstream um dia criar um layout aqui, a fusão acusa (dois arquivos com o
 * mesmo caminho) em vez de um sobrescrever o outro em silêncio.
 */
export default async function CampanhasLayout({ children }: { children: ReactNode }) {
  const { acesso } = await acessoAoBroadcast();
  if (acesso.estado !== "liberado" || !acesso.canais.qr) redirect("/app/broadcast");
  return (
    <>
      <FaixaDoQr />
      {children}
    </>
  );
}

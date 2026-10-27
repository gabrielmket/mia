/**
 * FORK MIA (.93) — "Toda resposta de 'como faço' que tem tela ganha o 'Me mostra
 * como'" (regra do protótipo aprovado em 26/10/2026).
 *
 * Depois de `buscar_ajuda`, o turno pergunta aqui: o manual que vai responder
 * (o primeiro, que é o que o assistente usa) tem uma TRILHA no catálogo? Então
 * o botão começa a trilha. Não tem, mas tem tela que a pessoa abre? Então o
 * botão começa o GUIA CURTO do manual: abrir a tela (conferida) e os passos do
 * manual. Sem tela, ou sem a pessoa abrir a tela, não há botão: o assistente
 * explica e diz quem pode.
 *
 * Módulo PURO, sem IA.
 */
import type { Role } from "@/lib/auth/types";

import type { AchadosDaAjuda } from "../leituras/ajuda";
import { hrefDoApp, type AcaoDoAssistente } from "../tipos";
import { papelFaz, trilhaDoManual } from "./catalogo";

export function acaoMeMostraComo(achados: Pick<AchadosDaAjuda, "manuais">, papel: Role): AcaoDoAssistente | null {
  const manual = achados.manuais[0];
  if (!manual || !manual.voce_pode) return null;
  const trilha = trilhaDoManual(manual.id);
  if (trilha && papelFaz(trilha, papel)) {
    return { tipo: "me_mostra_como", rotulo: "Me mostra como", trilha_id: trilha.id };
  }
  const href = hrefDoApp(manual.href);
  if (!href || manual.passos.length === 0) return null;
  return {
    tipo: "me_mostra_como",
    rotulo: "Me mostra como",
    guia: { id: manual.id, titulo: manual.titulo, href, passos: manual.passos.slice(0, 12) },
  };
}

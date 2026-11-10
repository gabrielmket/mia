"use client";
/**
 * FORK MIA (.107) · a faixa "IA pausada" no cabeçalho da conversa.
 *
 * Decisão do dono do produto (10/11/2026): se uma pessoa assumiu QUALQUER
 * conversa do contato, a IA se cala em todos os números dele
 * (`isLeadInHandoff`). O defeito era o silêncio sem aviso: esta conversa
 * mostrava "Automático", o cliente escrevia e ninguém respondia. A faixa diz
 * quem está com o contato e em que número, e leva até aquela conversa.
 *
 * Aparece só com a conversa em "Automático" (quem decide é o cabeçalho, pela
 * regra única `comandoDaConversa`): em qualquer outro estado o próprio
 * cabeçalho já diz por que a IA não responde. O dado vem da MESMA consulta do
 * selo do horário da conversa (`useHorarioDaIaDaConversa`, a rota
 * `/api/v1/ai/horario-da-ia?conversa=`), então a faixa não custa requisição a
 * mais. A rota lê a outra conversa pela sessão: quem não a veria no Inbox não
 * vê a faixa.
 */
import { useContext } from "react";
import Link from "next/link";
import { QueryClientContext } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useHorarioDaIaDaConversa } from "@/hooks/ai/useHorarioDaIa";
import { useT } from "@/hooks/i18n/useT";

export function FaixaDaPausaPorOutraConversa({
  conversationId,
  automatico,
}: {
  conversationId: string;
  /** `comandoDaConversa(...).comando.quem === "automatico"`. */
  automatico: boolean;
}) {
  // Sem QueryClient (testes do cabeçalho que não montam o provedor) não há o que ler.
  const temQueryClient = useContext(QueryClientContext) !== undefined;
  if (!automatico || !temQueryClient) return null;
  return <Faixa conversationId={conversationId} />;
}

function Faixa({ conversationId }: { conversationId: string }) {
  const t = useT();
  const { data } = useHorarioDaIaDaConversa(conversationId);
  const pausa = data?.pausa_por_outra_conversa ?? null;
  if (!pausa) return null;

  const numero = pausa.numero ?? t("outro número");
  const texto = pausa.pessoa
    ? t("IA pausada: {pessoa} está atendendo este contato no número {numero}.")
        .replace("{pessoa}", pausa.pessoa)
        .replace("{numero}", numero)
    : t("IA pausada: este contato está com a IA pausada no número {numero}.").replace("{numero}", numero);

  return (
    <div
      role="status"
      data-testid="faixa-pausa-por-outra-conversa"
      title={t(
        "Enquanto uma pessoa atende o contato em qualquer número, a IA fica calada em todos os números dele. Para a IA voltar aqui, devolva aquela conversa para a IA ou feche-a.",
      )}
      className="flex w-full flex-wrap items-center gap-2 rounded-md border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg"
    >
      <span className="min-w-0 flex-1 break-words">{texto}</span>
      <Button asChild size="sm" variant="outline">
        <Link href={`/app/inbox?id=${pausa.conversation_id}`} data-testid="abrir-aquela-conversa">
          {t("Abrir aquela conversa")}
        </Link>
      </Button>
    </div>
  );
}

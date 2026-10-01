"use client";

/**
 * FORK MIA — as obrigações no bloco FOCO do cartão aberto.
 *
 * Só o que pede ação AGORA: a proposta do agente esperando confirmação ("o
 * cliente mandou um arquivo; é o alvará pedido?") e os itens vencidos, vencendo
 * ou pedidos sem resposta, do mais urgente para o menos, cada um com a ação
 * direta. O que está em dia não aparece aqui: fica na seção "Documentos e
 * obrigações", logo abaixo.
 */
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import type { LeituraNaTela } from "@/hooks/obrigacoes/useObrigacoes";
import { grupoNoNegocio } from "@/lib/obrigacoes/heranca";
import { porUrgencia, textoDaSituacao, urgencia, type TipoDeUrgencia } from "@/lib/obrigacoes/situacao";
import type { ObrigacaoNaTela } from "@/lib/obrigacoes/tipos";
import { cn } from "@/lib/utils";
import { FolhaDaObrigacao, type PedidoDeFolha } from "./FolhaDaObrigacao";
import { BotoesDoItem, PropostaDoAgente } from "./pecas";

/** Os itens do Foco: com proposta pendente, ou vencido, vencendo, pedido sem resposta. */
export function obrigacoesDoFoco(dados: LeituraNaTela | undefined): { propostas: ObrigacaoNaTela[]; urgentes: ObrigacaoNaTela[] } {
  if (!dados) return { propostas: [], urgentes: [] };
  const ordenados = porUrgencia(dados.itens, dados.hoje);
  return {
    propostas: ordenados.filter((i) => i.proposta),
    urgentes: ordenados.filter((i) => urgencia(i, dados.hoje).tipo !== null),
  };
}

const TOM = {
  vencido: "bg-error-bg text-error-fg",
  vencendo: "bg-warning-bg text-warning-fg",
  sem_resposta: "bg-accent/10 text-accent",
} as const satisfies Record<TipoDeUrgencia, string>;

const DE_QUEM = { negocio: "do negócio", empresa: "da empresa", contato: "do contato" } as const;

export function ObrigacoesNoFoco({ dados }: { dados: LeituraNaTela | undefined }) {
  const t = useT();
  const [folha, setFolha] = useState<PedidoDeFolha | null>(null);
  const { propostas, urgentes } = obrigacoesDoFoco(dados);
  if (!dados || (propostas.length === 0 && urgentes.length === 0)) {
    return <FolhaDaObrigacao pedido={folha} aoFechar={() => setFolha(null)} />;
  }
  const negocio = dados.contexto.negocio;
  return (
    <div className="space-y-2" data-testid="obrigacoes-no-foco">
      {propostas.map((item) => (
        <PropostaDoAgente
          key={`proposta-${item.id}`}
          item={item}
          proposta={item.proposta!}
          aoConfirmar={(i, proposta) => setFolha({ id: i.id, receber: true, proposta })}
        />
      ))}
      {urgentes.length > 0 ? (
        <ul className="space-y-2">
          {urgentes.map((item) => {
            const tipo = urgencia(item, dados.hoje).tipo as TipoDeUrgencia;
            const grupo = negocio ? grupoNoNegocio(item, negocio) : null;
            return (
              <li key={item.id} className="flex gap-2" data-obrigacao={item.id}>
                <span
                  aria-hidden
                  className={cn("mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[10px] font-semibold", TOM[tipo])}
                >
                  {item.categoria === "atividade" ? "ATV" : "DOC"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs font-medium text-text">{item.nome}</p>
                  <p className="break-words text-[11px] text-text-muted">
                    {textoDaSituacao(item, dados.hoje, t)}
                    {grupo ? ` · ${t(DE_QUEM[grupo])}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <BotoesDoItem item={item} hoje={dados.hoje} aoReceber={(i) => setFolha({ id: i.id, receber: true })} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <FolhaDaObrigacao pedido={folha} aoFechar={() => setFolha(null)} />
    </div>
  );
}

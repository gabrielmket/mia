"use client";

/**
 * FORK MIA (.91) — O CARTÃO DA PROPOSTA do assistente (fase 2 do desenho do
 * upstream, #2860): uma peça, o que muda, e a decisão.
 *
 *   Aprovar e aplicar   só quem administra. Desabilitado para os outros, com
 *                       o porquê ao lado ("Só quem administra aplica.")
 *   Recusar             quem vê o cartão (gestor em diante)
 *
 * Decidida, o cartão mostra a situação (aplicada, recusada, vencida) e o erro
 * quando a peça não pôde ser criada (a proposta continua aprovada, e aplicar
 * de novo retoma). A situação vem do banco, não do clique: o cartão relê.
 */
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDecidirProposta, usePropostas } from "@/hooks/assistente/usePrimeirosPassos";
import { useT } from "@/hooks/i18n/useT";

export interface CartaoDaPropostaProps {
  propostaId: string;
  titulo: string;
  mudancas: ReadonlyArray<{ rotulo: string; valor: string }>;
}

const ROTULO_DA_SITUACAO: Record<string, string> = {
  aplicada: "aplicada",
  rejeitada: "recusada",
  expirada: "vencida",
  aprovada: "aprovada",
};

export function CartaoDaProposta({ propostaId, titulo, mudancas }: CartaoDaPropostaProps) {
  const t = useT();
  const router = useRouter();
  const estado = usePropostas([propostaId]);
  const decidir = useDecidirProposta();
  const proposta = estado.data?.propostas.find((p) => p.id === propostaId) ?? null;
  const podeAplicar = estado.data?.pode_aplicar ?? false;
  const situacao = proposta?.situacao ?? "pendente";
  const aberta = situacao === "pendente" || situacao === "aprovada";

  function decidirA(decisao: "aplicar" | "rejeitar") {
    decidir.mutate(
      { id: propostaId, decisao },
      {
        onSuccess: (r) => {
          toast.success(r.desfecho === "rejeitada" ? t("Proposta recusada.") : t("Proposta aplicada. A peça nasceu em rascunho."));
          // O passo a passo e o Início releem o que mudou (o funil, o agente).
          router.refresh();
        },
        onError: (e) => toast.error(t(e instanceof Error && e.message ? e.message : "Não deu para decidir agora.")),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm" data-testid="cartao-da-proposta" data-situacao={situacao}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0">{titulo}</strong>
        <Badge variant="warning">{t("atenção")}</Badge>
        <Badge variant="neutral">{t("1 proposta = 1 peça")}</Badge>
      </div>
      <dl className="grid gap-1">
        {mudancas.map((m) => (
          <div key={`${m.rotulo}-${m.valor}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-xs text-text-muted">{t(m.rotulo)}</dt>
            <dd className="text-xs">{m.valor}</dd>
          </div>
        ))}
      </dl>
      {proposta?.erro && aberta ? (
        <p role="alert" className="rounded-md bg-warning-bg p-2 text-xs text-warning-fg">
          {t("Não deu para aplicar:")} {proposta.erro}
        </p>
      ) : null}
      {aberta ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-11 lg:h-8"
            disabled={!podeAplicar || decidir.isPending}
            onClick={() => decidirA("aplicar")}
          >
            {decidir.isPending ? t("Aplicando...") : t("Aprovar e aplicar")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 lg:h-8"
            disabled={decidir.isPending}
            onClick={() => decidirA("rejeitar")}
          >
            {t("Recusar")}
          </Button>
          {!podeAplicar ? <span className="text-xs text-text-muted">{t("Só quem administra aplica.")}</span> : null}
        </div>
      ) : (
        <Badge variant={situacao === "aplicada" ? "success" : "neutral"} className="self-start">
          {t(ROTULO_DA_SITUACAO[situacao] ?? situacao)}
        </Badge>
      )}
    </div>
  );
}

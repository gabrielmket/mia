"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";
// FORK MIA — aprovar cria a tarefa (lib/cartoes/tarefa-da-proxima-acao.ts).
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

interface DecidirArgs {
  leadId: string;
  decision: "approve" | "dismiss";
  /** QUAL proposta estava na tela — a trava do servidor compara esta identidade. */
  approvedSeq: number;
}

/**
 * A decisão humana sobre a próxima ação proposta pelo agente.
 *
 * Manda a IDENTIDADE da proposta que a pessoa leu: se o agente a reescreveu
 * entre o render e o clique, o servidor recusa com 409 em vez de executar a
 * proposta nova em nome de quem autorizou a antiga. Identidade e não texto —
 * a mesma frase escrita de novo é outra proposta.
 */
export function useDecidirProximaAcao(pipelineId: string) {
  const qc = useQueryClient();
  const t = useT();
  const queryKey = ["board", pipelineId] as const;

  return useMutation({
    mutationFn: async ({ leadId, decision, approvedSeq }: DecidirArgs) => {
      // Decidir muda o lead (a atividade carimba `last_activity_at`), então é
      // eco local como qualquer outra mutação — senão o card pulsa na cara de
      // quem acabou de clicar.
      marcarEcoLocal(leadId);
      return apiClient.post<{
        data: {
          lead_id: string;
          decision: string;
          tarefa?: { id: string; title: string; due_date: string } | null;
        };
      }>(
        `/api/v1/leads/${leadId}/next-action`,
        { decision, approved_seq: approvedSeq },
      );
    },
    // FORK MIA — a aprovação vira tarefa: quem clicou vê a tarefa nascer, e o
    // cartão aberto e a lista de Tarefas se atualizam.
    onSuccess: (res, args) => {
      if (args.decision !== "approve") return;
      const tarefa = res?.data?.tarefa;
      if (tarefa) toast.success(`${t("Tarefa criada")}: ${tarefa.title}`);
      else toast.warning(t("A aprovação foi registrada, mas a tarefa não foi criada. Crie a tarefa pela lista de Tarefas."));
      qc.invalidateQueries({ queryKey: ["crm_tasks"] });
      qc.invalidateQueries({ queryKey: ["cartao-aberto", args.leadId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        // A proposta mudou (ou sumiu): recarregar é o que mostra a nova.
        qc.invalidateQueries({ queryKey });
      }
      showApiError(err);
    },
    onSettled: (_data, _err, args) => {
      liberarEcoLocal(args.leadId);
      qc.invalidateQueries({ queryKey });
    },
  });
}

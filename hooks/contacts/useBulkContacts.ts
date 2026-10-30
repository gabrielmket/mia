"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  rodarLoteEmPartes,
  type AlvoDoLote,
  type ProgressoDoLote,
  type RespostaDaParte,
  type ResumoDoLote,
} from "@/lib/contacts/lote-em-partes";

/** As ações em lote da tela de Contatos — o mesmo discriminante da rota (#2484, F3). */
export type AcaoEmLoteDeContatos =
  | { action: "tag"; op: "add" | "remove"; tag: string }
  | { action: "carteira"; dono_user_id: string | null; origem?: "manual" }
  | { action: "custom-field"; chave: string; valor: string | number | boolean | null };

/** Uma linha do relatório por item, como a rota devolve. */
export interface ResultadoDoItem {
  id: string;
  feito: boolean;
  codigo?: string;
  motivo?: string;
  request_id?: string;
}

/** O relatório inteiro da chamada em lote. */
export interface RelatorioDoLote {
  acao: string;
  teto: number;
  total: number;
  feitos: number;
  recusados: number;
  resultados: ResultadoDoItem[];
}

/**
 * A camada de lote dos contatos: UMA ação para N contatos (#2484, F3).
 *
 * As rotas são duas (`POST /api/v1/contacts/bulk`, por ids, e `.../bulk/filtro`,
 * FORK MIA .97, pelo filtro inteiro); o hook espelha o discriminante delas. Nada
 * de permissão, organização ou auditoria aqui — cada item é resolvido pelo
 * caminho individual (o PATCH da ficha ou o da carteira), e o que volta é o
 * relatório por item.
 *
 * FORK MIA (.97): quem usa não tem teto. A rota continua recebendo até 100 por
 * chamada, e o hook repete até acabar (`lib/contacts/lote-em-partes.ts`), com
 * `progresso` para a barra dizer quantos já foram.
 *
 * O toast de sucesso CONTA os dois lados: um lote pela metade não é sucesso nem
 * erro, e quem clicou precisa saber quantos contatos sobraram por fazer — com
 * o motivo de cada recusa, que a rota já manda traduzido.
 */
export function useBulkContacts() {
  const qc = useQueryClient();
  const t = useT();
  const [progresso, setProgresso] = useState<ProgressoDoLote | null>(null);

  const mutacao = useMutation({
    mutationFn: async (args: AlvoDoLote & AcaoEmLoteDeContatos) => {
      const { action } = args;
      const acao: AcaoEmLoteDeContatos =
        action === "tag"
          ? { action, op: args.op, tag: args.tag }
          : action === "carteira"
            ? { action, dono_user_id: args.dono_user_id, ...(args.origem ? { origem: args.origem } : {}) }
            : { action, chave: args.chave, valor: args.valor };
      const alvo: AlvoDoLote = "ids" in args ? { ids: args.ids } : { filtro: args.filtro, total: args.total };

      const resumo = await rodarLoteEmPartes(
        alvo,
        {
          porIds: async (ids) => {
            const { data } = await apiClient.post<{ data: RelatorioDoLote }>("/api/v1/contacts/bulk", {
              ...acao,
              ids,
            });
            return {
              feitos: data.feitos,
              recusados: data.recusados,
              recusas: data.resultados.filter((r) => !r.feito),
            };
          },
          porFiltro: async (filtro, cursor) => {
            const { data } = await apiClient.post<{ data: RespostaDaParte }>("/api/v1/contacts/bulk/filtro", {
              ...acao,
              filtro,
              ...(cursor ? { cursor } : {}),
            });
            return data;
          },
        },
        setProgresso,
        t("Recusado."),
      );
      return { resumo, acao };
    },
    onError: (err) => {
      // 403/422 da PRIMEIRA chamada (sem permissão, corpo inválido): nada começou.
      showApiError(err);
    },
    onSuccess: ({ resumo, acao }) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact"] });
      // A etiqueta nova aparece no filtro da lista e no seletor do Broadcast.
      qc.invalidateQueries({ queryKey: ["contact-tags"] });
      avisarDoResumo(resumo, acao, t);
    },
    onSettled: () => setProgresso(null),
  });

  return { ...mutacao, progresso };
}

/** O retorno de quantos foram: o verbo da ação, no número certo. */
function fraseDosFeitos(resumo: ResumoDoLote, acao: AcaoEmLoteDeContatos, t: (texto: string) => string): string {
  const n = resumo.feitos;
  if (acao.action === "tag" && acao.op === "add") {
    return n === 1 ? t("1 contato etiquetado.") : t("{n} contatos etiquetados.").replace("{n}", String(n));
  }
  if (acao.action === "tag") {
    return n === 1
      ? t("Etiqueta removida de 1 contato.")
      : t("Etiqueta removida de {n} contatos.").replace("{n}", String(n));
  }
  // Texto próprio dos contatos: "atualizadas"/"recusadas" são as chaves
  // das conversas (F1) e davam "2 contatos atualizadas".
  return n === 1 ? t("1 contato atualizado.") : `${n} ${t("contatos atualizados")}.`;
}

function avisarDoResumo(resumo: ResumoDoLote, acao: AcaoEmLoteDeContatos, t: (texto: string) => string): void {
  // Só um lote que correu inteiro, sem recusa, é verde.
  if (resumo.recusados === 0 && !resumo.interrompido) {
    toast.success(fraseDosFeitos(resumo, acao, t));
    return;
  }
  const descricao = resumo.motivos.map((m) => (m.quantos > 1 ? `${m.quantos} × ${m.motivo}` : m.motivo));
  if (resumo.interrompido) {
    toast.warning(`${fraseDosFeitos(resumo, acao, t)} ${t("A ação parou antes do fim: repita para continuar.")}`, {
      description: [resumo.erro, ...descricao].filter(Boolean).join(" · "),
    });
    return;
  }
  // Número e palavra concordam: "1 atualizados, 1 recusados." foi medido na tela (#2913).
  const feitos = `${resumo.feitos} ${resumo.feitos === 1 ? t("atualizado") : t("atualizados")}`;
  const recusas = `${resumo.recusados} ${resumo.recusados === 1 ? t("recusado") : t("recusados")}`;
  toast.warning(`${feitos}, ${recusas}.`, { description: descricao.join(" · ") });
}

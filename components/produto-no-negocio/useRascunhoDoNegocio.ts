"use client";
/**
 * FORK MIA (.109) · o rascunho do bloco de itens e do valor, ligado à leitura e à
 * gravação (docs/fork/produto-no-negocio.md). Quem usa: o formulário do negócio
 * (`LeadFieldsForm`, Editar negócio e o cartão aberto) e a janela de ganho.
 *
 * O rascunho nasce do que está gravado quando a leitura chega e só é refeito
 * quando o negócio muda ou quando a gravação devolve o estado novo: uma releitura
 * no meio da edição não apaga o que a pessoa está mexendo.
 */
import { useCallback, useState } from "react";

import { useGravarItensDoNegocio, useItensDoNegocio, type ItensDoNegocio } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";
import {
  pedidoDoRascunho,
  rascunhoInicial,
  rascunhoMudou,
  valorDoRascunho,
  type RascunhoDoNegocio,
} from "@/lib/produto-no-negocio/rascunho";

export type DesfechoDoSalvar =
  | { ok: true; mudou: boolean; updatedAt: string | null; valorCents: number | null }
  | { ok: false; motivo: "valor_invalido" | "nao_carregado" | "falhou" };

export function useRascunhoDoNegocio(leadId: string, pipelineId: string | null, ligado = true) {
  const leitura = useItensDoNegocio(leadId, ligado);
  const gravar = useGravarItensDoNegocio(leadId, pipelineId);
  const [rascunho, setRascunho] = useState<RascunhoDoNegocio | null>(null);
  const [daLeitura, setDaLeitura] = useState<string | null>(null);

  // Só vale a leitura com a forma da rota: qualquer outra coisa (um proxy, uma
  // rota de outra versão) conta como falha, e o formulário volta ao Valor de antes.
  const dados: ItensDoNegocio | undefined = formaDaRota(leitura.data) ? leitura.data : undefined;
  const leituraTorta = leitura.isSuccess && !dados;

  // O ajuste DURANTE o render (o padrão do React para estado que nasce de uma
  // prop), e não num efeito: o rascunho já sai certo no mesmo render em que a
  // leitura chega, sem um render a mais com o rascunho do negócio anterior.
  if (dados && daLeitura !== dados.lead_id) {
    setDaLeitura(dados.lead_id);
    setRascunho(rascunhoInicial(dados));
  }

  const moeda = dados?.moeda ?? "BRL";
  const pronto = !!(dados && rascunho && daLeitura === dados.lead_id);
  const sujo = pronto ? rascunhoMudou(rascunho!, dados!, moeda) : false;

  const salvar = useCallback(async (): Promise<DesfechoDoSalvar> => {
    if (!dados || !rascunho) return { ok: false, motivo: "nao_carregado" };
    if (!rascunhoMudou(rascunho, dados, moeda)) {
      return { ok: true, mudou: false, updatedAt: null, valorCents: dados.valor.valorCents };
    }
    const p = pedidoDoRascunho(rascunho, moeda);
    if (!p.ok) return { ok: false, motivo: p.motivo };
    try {
      const r = await gravar.mutateAsync(p.pedido);
      setRascunho(rascunhoInicial(r));
      return { ok: true, mudou: r.mudou, updatedAt: r.updated_at, valorCents: r.valor.valorCents };
    } catch {
      return { ok: false, motivo: "falhou" };
    }
  }, [dados, rascunho, moeda, gravar]);

  return {
    /** A leitura falhou: quem monta volta ao campo Valor de antes. */
    falhou: leitura.isError || leituraTorta,
    carregando: leitura.isLoading,
    pronto,
    sujo,
    dados,
    moeda,
    rascunho,
    setRascunho,
    /** O valor que o negócio terá ao salvar (`undefined` = digitado inválido). */
    valorAoSalvar: pronto ? valorDoRascunho(rascunho!, moeda) : undefined,
    salvar,
    salvando: gravar.isPending,
  };
}

function formaDaRota(d: unknown): d is ItensDoNegocio {
  if (!d || typeof d !== "object") return false;
  const x = d as Partial<ItensDoNegocio>;
  return typeof x.lead_id === "string" && Array.isArray(x.itens) && !!x.valor && typeof x.valor.modo === "string";
}

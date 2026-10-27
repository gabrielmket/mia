/**
 * FORK MIA (.96, segunda frente) · A SITUAÇÃO DO PAGAMENTO NA LISTA DA TIME
 * (Admin › Empresas do cadastro; protótipo "Pagamento no início", tela 4 e
 * decisão 5; docs/fork/area-de-cobranca.md).
 *
 * Puro. Da assinatura do upstream e da linha do passo (9121) sai a coluna
 * "Situação do pagamento": Pix gerado, boleto em compensação, cartão recusado,
 * pago, sem pagamento há N dias... e se o botão "Apagar o cadastro" aparece:
 * SÓ depois de 30 dias sem nenhum pagamento, e nunca sozinho.
 */
export const DIAS_PARA_APAGAR = 30;

export type ChaveDaSituacaoNaLista =
  | "pago"
  | "pix_gerado"
  | "boleto_em_compensacao"
  | "cartao_recusado"
  | "cartao_em_analise"
  | "aguardando"
  | "sem_cobranca"
  | "sem_pagamento_ha_dias"
  | "teste_cartao"
  | "teste_pix";

export interface SituacaoDoPagamentoNaLista {
  chave: ChaveDaSituacaoNaLista;
  /** Dias desde o cadastro (a empresa nascer). */
  dias: number;
  forma: "pix" | "cartao" | "boleto" | "outra" | null;
  /** O que mais a tela diz embaixo: o vencimento, as recusas, quando gerou, quando pagou. */
  vence_em: string | null;
  recusas: number;
  gerada_em: string | null;
  pago_em: string | null;
  /** O teste acabou sem a primeira mensalidade paga (9122). */
  fim_do_teste: boolean;
  /** "Apagar o cadastro" aparece. */
  pode_apagar: boolean;
}

export interface AssinaturaParaALista {
  pagamento_inicial_pendente: boolean;
  proximo_vencimento: string | null;
  periodo_pago_desde: string | null;
}

export interface PassoParaALista {
  modo: string;
  situacao: string;
  forma: string | null;
  vence_em: string | null;
  gerada_em: string | null;
  cartao_recusas: number;
  pago_em: string | null;
  forma_paga: string | null;
}

/** O rótulo de cada situação (a tela troca {dias}). */
export const ROTULO_DA_SITUACAO_DO_PAGAMENTO: Record<ChaveDaSituacaoNaLista, string> = {
  pago: "pago",
  pix_gerado: "Pix gerado, sem pagamento",
  boleto_em_compensacao: "boleto em compensação",
  cartao_recusado: "cartão recusado",
  cartao_em_analise: "cartão em análise",
  aguardando: "esperando o pagamento",
  sem_cobranca: "nunca gerou cobrança",
  sem_pagamento_ha_dias: "sem pagamento há {dias} dias",
  teste_cartao: "teste · cartão cadastrado",
  teste_pix: "teste · paga por Pix no fim",
};

const forma = (f: string | null): SituacaoDoPagamentoNaLista["forma"] =>
  f === "pix" || f === "cartao" || f === "boleto" ? f : f ? "outra" : null;

/**
 * A situação da empresa na lista. `null` = a empresa não passou pelo passo do
 * pagamento (implantada pela Time, isenta, anterior à .96): a coluna fica vazia.
 */
export function situacaoDoPagamentoNaLista(p: {
  assinatura: AssinaturaParaALista | null;
  passo: PassoParaALista | null;
  criadaEm: string;
  agora: Date;
}): SituacaoDoPagamentoNaLista | null {
  const { assinatura, passo } = p;
  if (!assinatura) return null;
  const dias = Math.max(0, Math.floor((p.agora.getTime() - Date.parse(p.criadaEm)) / 86_400_000));
  const base = {
    dias,
    forma: forma(passo?.forma ?? null),
    vence_em: passo?.vence_em ?? null,
    recusas: passo?.cartao_recusas ?? 0,
    gerada_em: passo?.gerada_em ?? null,
    pago_em: passo?.pago_em ?? null,
    fim_do_teste: assinatura.pagamento_inicial_pendente && passo?.modo === "teste",
  };
  const pagou =
    passo?.situacao === "pago" || assinatura.proximo_vencimento !== null || assinatura.periodo_pago_desde !== null;

  if (!assinatura.pagamento_inicial_pendente) {
    if (!passo) return null;
    if (passo.situacao === "pago") return { ...base, chave: "pago", forma: forma(passo.forma_paga ?? passo.forma), pode_apagar: false };
    if (passo.modo === "teste" && passo.situacao === "escolhida") {
      return { ...base, chave: passo.forma === "cartao" ? "teste_cartao" : "teste_pix", pode_apagar: false };
    }
    return null;
  }

  const podeApagar = !pagou && dias >= DIAS_PARA_APAGAR;
  if (podeApagar) return { ...base, chave: "sem_pagamento_ha_dias", pode_apagar: true };
  const chave: ChaveDaSituacaoNaLista =
    !passo || passo.situacao === "sem_cobranca"
      ? "sem_cobranca"
      : passo.situacao === "recusado"
        ? "cartao_recusado"
        : passo.situacao === "em_analise"
          ? "cartao_em_analise"
          : passo.situacao === "aguardando" && passo.forma === "boleto"
            ? "boleto_em_compensacao"
            : passo.situacao === "aguardando" && passo.forma === "pix"
              ? "pix_gerado"
              : "aguardando";
  return { ...base, chave, pode_apagar: false };
}

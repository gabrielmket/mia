/**
 * FORK MIA — as partes de uma venda ganha nas metas e no relatório de vendas
 * (0243), depois que o upstream passou a guardar a mensalidade numa coluna
 * própria (v1.99, #3602: `crm_leads.recurring_value_cents`, com
 * `recurring_period` e a MESMA `recurring_months` que o fork já usava como
 * "meses de contrato").
 *
 * Antes da v1.99, no fork, um negócio `revenue_kind = 'recorrente'` guardava a
 * MENSALIDADE em `value_cents`. Desde a v1.99 a tela edita a mensalidade no
 * campo "Valor recorrente (mensal)" e deixa `value_cents` para o valor único
 * (setup, implantação). As duas leituras convivem:
 *
 *   - com mensalidade gravada (`recurring_value_cents`), ela é a parte
 *     RECORRENTE, em qualquer tipo de receita: mensalidade é recorrência por
 *     definição. O valor único vai para o lado do tipo; no negócio marcado
 *     `recorrente`, o valor único é o setup, que a régua do fork (0243) chama de
 *     AVULSO ("projeto, setup, venda única");
 *   - sem mensalidade gravada (o negócio de antes da v1.99), vale a leitura de
 *     sempre: o `value_cents` do recorrente é a mensalidade.
 *
 * Nada aqui é gravado: a régua é só de leitura, e um negócio antigo continua
 * exatamente com o número que tinha.
 */

export interface VendaComPartes {
  value_cents: number | null;
  revenue_kind: "recorrente" | "avulso" | null;
  /** A mensalidade do upstream (v1.99). Ausente ou nula = negócio sem ela. */
  recurring_value_cents?: number | null;
}

export interface PartesDaVenda {
  recorrente: number;
  avulso: number;
  naoClassificada: number;
  /** A mensalidade que multiplica o prazo do contrato; `null` quando não há. */
  mensalidade: number | null;
}

export function partesDaVenda(venda: VendaComPartes): PartesDaVenda {
  const unico = venda.value_cents ?? 0;
  const mensal = venda.recurring_value_cents ?? null;
  if (mensal !== null) {
    return {
      recorrente: mensal,
      avulso: venda.revenue_kind === "recorrente" || venda.revenue_kind === "avulso" ? unico : 0,
      naoClassificada: venda.revenue_kind === null ? unico : 0,
      mensalidade: mensal,
    };
  }
  if (venda.revenue_kind === "recorrente") {
    return { recorrente: unico, avulso: 0, naoClassificada: 0, mensalidade: unico };
  }
  if (venda.revenue_kind === "avulso") {
    return { recorrente: 0, avulso: unico, naoClassificada: 0, mensalidade: null };
  }
  return { recorrente: 0, avulso: 0, naoClassificada: unico, mensalidade: null };
}

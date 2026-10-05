/**
 * FORK MIA — O SALDO DA CARTEIRA, lido num lugar só e sem parar na linha 1000.
 *
 * ── O defeito que isto fecha ────────────────────────────────────────────────
 *
 * O saldo é a soma do extrato (`derivarSaldo`), e o extrato tem UMA linha de
 * débito por mensagem enviada. Seis lugares liam `tenant_wallet_ledger` com
 * `.limit(100_000)` (ou `5_000`) e somavam o que vinha. O PostgREST corta toda
 * resposta em 1000 linhas sem avisar, e sem `ORDER BY` ele costuma devolver as
 * mais ANTIGAS: numa carteira com R$ 1.000,00 de crédito e 3.000 mensagens de
 * R$ 0,20, a soma via o crédito e 999 débitos e dizia R$ 800,20 no lugar de
 * R$ 400,00. A tela mostrava saldo que não existia, e a trava do disparo
 * deixava passar lista que o saldo de verdade não cobria.
 *
 * ── Um lugar só ─────────────────────────────────────────────────────────────
 *
 * A tela do cliente, a do painel, a criação do disparo, o início do disparo, o
 * motor e o MCP de plataforma passam por aqui. Seis cópias da mesma leitura
 * divergiam (uma delas somava com outra regra de sinal).
 *
 * ── O teto, e o próximo passo ───────────────────────────────────────────────
 *
 * 100 páginas de 1000: os 100 mil lançamentos que o código já declarava. Acima
 * disso o saldo sai `truncado` e fica registrado em log. Saldo é soma sobre um
 * extrato que só cresce, e o lugar certo dela é o banco (o idioma do upstream
 * em `fn_relatorio_financeiro`): uma função nossa `security invoker`, em
 * migration, que troca o miolo DESTA função e de mais nada. Fica para a entrega
 * que puder levar migration e ensaio de banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { logger } from "@/lib/logger";

import { derivarSaldo, type LancamentoDaCarteira, type SaldoDaCarteira } from "./saldo";

/** 100 páginas = 100 mil lançamentos, o teto que as leituras antigas declaravam. */
export const PAGINAS_MAXIMAS_DO_EXTRATO = 100;

export interface SaldoLido extends SaldoDaCarteira {
  /**
   * O extrato passou do teto de leitura: a soma cobre só os lançamentos mais
   * recentes e NÃO é o saldo. Quem mostra, avisa.
   */
  truncado: boolean;
  /** A mensagem do banco, se a leitura falhou. O saldo vem zerado. */
  erro: string | null;
}

/**
 * Lê o extrato inteiro da organização e soma.
 *
 * Não lança. Com erro de leitura o saldo vem ZERO, que é o que cada chamador
 * já fazia com a leitura antiga: a trava do disparo recusa (falta de saldo) em
 * vez de liberar no escuro. Quem precisa distinguir "zero" de "não consegui
 * ler" olha `erro`.
 */
export async function lerSaldoDaCarteira(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
): Promise<SaldoLido> {
  const lido = await lerTodasAsPaginas<LancamentoDaCarteira>(
    (de, ate, pedirContagem) =>
      db
        .from("tenant_wallet_ledger")
        .select("tipo, amount_cents, occurred_at", pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        // Ordem única (o `id` desempata): paginar por `range` só é correto
        // assim. Do mais novo para o mais antigo, como o extrato da tela.
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    { paginasMaximas: PAGINAS_MAXIMAS_DO_EXTRATO },
  );

  if (lido.erro) {
    logger.error("[carteira] não consegui ler o extrato", {
      organization_id: organizationId,
      detalhe: lido.erro.slice(0, 300),
    });
  } else if (lido.truncado) {
    logger.error("[carteira] extrato acima do teto de leitura: o saldo somado é parcial", {
      organization_id: organizationId,
      lidos: lido.linhas.length,
      no_banco: lido.total,
    });
  }

  const lancamentos = lido.linhas.map((l) => ({
    tipo: l.tipo,
    amount_cents: Number(l.amount_cents),
    occurred_at: l.occurred_at,
  }));

  return { ...derivarSaldo(lancamentos), truncado: lido.truncado, erro: lido.erro };
}

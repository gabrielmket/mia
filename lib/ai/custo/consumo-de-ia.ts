/**
 * FORK MIA — QUANTO A PLATAFORMA CONSUMIU DE IA, sem parar na linha 1000.
 *
 * ── O defeito que isto fecha ────────────────────────────────────────────────
 *
 * O saldo do provedor é `última leitura + recargas − consumo desde a leitura`,
 * e o "dura até" sai da média dos últimos 30 dias. As duas somas liam
 * `llm_calls` com `.limit(100_000)`, em dois lugares (a rota do painel e
 * `saldoDaPlataforma`, que o vigia do crédito usa). O PostgREST corta toda
 * resposta em 1000 linhas sem avisar: numa instalação com dezenas de milhares
 * de chamadas no período, o consumo saía da soma de 1000 chamadas arbitrárias.
 * O saldo aparecia quase igual à última leitura, a média diária quase zero, e o
 * aviso de "crédito acabando" não tinha como disparar.
 *
 * ── Uma leitura, as duas somas ──────────────────────────────────────────────
 *
 * As duas janelas se sobrepõem (uma está dentro da outra), então a leitura é
 * UMA, a partir do corte mais antigo, da chamada mais nova para a mais antiga,
 * e cada linha entra na soma da janela em que cabe.
 *
 * ── O teto, e o próximo passo ───────────────────────────────────────────────
 *
 * 100 páginas de 1000: as 100 mil chamadas que o código já declarava. Acima
 * disso (ou se a leitura falhar) a soma que não coube sai marcada como parcial
 * (`desdeLeituraParcial`, `janelaParcial`), quem mostra avisa, o vigia do
 * crédito avisa no grupo, e fica em log. Com volume acima do teto o número
 * continua SUPERESTIMADO, só que dito: a soma certa é no banco. O upstream está fazendo isso para o uso de IA
 * por organização (PR #2139, `fn_uso_de_ia`, migration 0549); quando ela
 * chegar pela sincronização, o miolo DESTA função passa a perguntar a ela, por
 * organização, e o teto deixa de existir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { logger } from "@/lib/logger";

/** 100 páginas = 100 mil chamadas, o teto que as leituras antigas declaravam. */
export const PAGINAS_MAXIMAS_DO_CONSUMO = 100;

export interface ConsumoDeIa {
  /** Em DÓLAR. Zero quando não há leitura registrada (não há intervalo). */
  consumoDesdeLeituraUsd: number;
  /** Em DÓLAR, dos últimos `diasDaMedia` dias. */
  consumoDaJanelaUsd: number;
  /**
   * O consumo DESDE A LEITURA não cobre o intervalo inteiro (teto de páginas, ou
   * falha). O consumo real é maior, e o saldo calculado com ele é um TETO: o
   * saldo de verdade é menor.
   */
  desdeLeituraParcial: boolean;
  /**
   * O consumo da JANELA da média não cobre os dias todos. A média diária sai
   * subestimada, e o "dura até" calculado com ela, tarde demais.
   */
  janelaParcial: boolean;
}

export async function lerConsumoDeIa(
  admin: Pick<SupabaseClient, "from">,
  cortes: {
    /** O instante da última leitura do saldo. `null` = nunca registraram uma. */
    desdeLeitura: string | null;
    /** O começo da janela da média diária. */
    desdeJanela: string;
  },
): Promise<ConsumoDeIa> {
  const inicioDaLeitura = cortes.desdeLeitura === null ? null : Date.parse(cortes.desdeLeitura);
  const inicioDaJanela = Date.parse(cortes.desdeJanela);
  // O corte mais antigo cobre as duas janelas.
  const desde =
    inicioDaLeitura !== null && inicioDaLeitura < inicioDaJanela
      ? (cortes.desdeLeitura as string)
      : cortes.desdeJanela;

  const lido = await lerTodasAsPaginas<{ cost_cents: number | string | null; created_at: string }>(
    (de, ate, pedirContagem) =>
      admin
        .from("llm_calls")
        .select("cost_cents, created_at", pedirContagem ? { count: "exact" } : undefined)
        .gte("created_at", desde)
        // Da mais nova para a mais antiga, com `id` de desempate: ordem única,
        // e se o teto cortar, o que fica de fora é o começo do período.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    { paginasMaximas: PAGINAS_MAXIMAS_DO_CONSUMO },
  );

  if (lido.erro) {
    logger.error("[ia] não consegui ler o consumo de IA da plataforma", {
      detalhe: lido.erro.slice(0, 300),
    });
  } else if (lido.truncado) {
    logger.error("[ia] consumo de IA acima do teto de leitura: o saldo calculado é maior que o real", {
      lidas: lido.linhas.length,
      no_banco: lido.total,
    });
  }

  let desdeLeituraCents = 0;
  let daJanelaCents = 0;
  let maisAntigaLida = Number.POSITIVE_INFINITY;
  for (const chamada of lido.linhas) {
    const quando = Date.parse(chamada.created_at);
    if (quando < maisAntigaLida) maisAntigaLida = quando;
    const custo = Number(chamada.cost_cents ?? 0);
    if (!Number.isFinite(custo)) continue;
    if (inicioDaLeitura !== null && quando >= inicioDaLeitura) desdeLeituraCents += custo;
    if (quando >= inicioDaJanela) daJanelaCents += custo;
  }

  /**
   * Qual das duas somas ficou pela metade.
   *
   * A leitura vem da chamada mais NOVA para a mais antiga. Se o teto cortou, o
   * que faltou é o começo do período: uma janela está inteira quando a leitura
   * já passou do começo DELA (a chamada mais antiga lida é anterior a ele).
   * Assim, com uma leitura de saldo recente, o saldo continua exato mesmo que
   * os 30 dias da média não caibam. Leitura que falhou não cobre nada.
   */
  const cobriu = (inicio: number) => !lido.truncado || maisAntigaLida < inicio;
  const falhou = lido.erro !== null;

  return {
    consumoDesdeLeituraUsd: desdeLeituraCents / 100,
    consumoDaJanelaUsd: daJanelaCents / 100,
    // Sem leitura registrada não há intervalo, nem saldo: nada a marcar.
    desdeLeituraParcial: inicioDaLeitura !== null && (falhou || !cobriu(inicioDaLeitura)),
    janelaParcial: falhou || !cobriu(inicioDaJanela),
  };
}

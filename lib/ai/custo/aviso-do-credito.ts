/**
 * FORK MIA — O QUE O VIGIA DIZ SOBRE O CRÉDITO DE IA, e quando ele não pode calar.
 *
 * A pergunta do vigia (`cron/report-da-plataforma`) era uma só: o saldo está
 * abaixo do limite? Ela pressupõe que o saldo calculado é o saldo. Não é quando
 * o consumo veio PARCIAL (`consumoParcial`): a leitura de `llm_calls` passou do
 * teto de páginas, ou falhou, e o que se somou é menos do que se gastou. Aí o
 * saldo calculado é um TETO, o de verdade é menor, e "está acima do limite"
 * deixa de ser resposta.
 *
 * ── O lado seguro ───────────────────────────────────────────────────────────
 *
 * Calar nesse caso é o defeito que a .74 veio fechar com outra roupa: o crédito
 * acaba, a chave continua válida, a IA para em todos os clientes ao mesmo
 * tempo, e o vigia tinha dito que estava tudo bem. Então:
 *
 *   · saldo calculado no limite ou abaixo: "acabando", como sempre. Se o consumo
 *     veio parcial, o recado diz que o saldo real é MENOR ainda.
 *   · saldo calculado acima do limite, mas com consumo parcial: um SEGUNDO
 *     recado, com chave própria, dizendo que não deu para conferir e o que
 *     fazer (olhar a conta do provedor e registrar uma leitura, que encurta o
 *     intervalo e devolve a conta exata).
 *   · sem leitura registrada (`saldoUsd` nulo): nada, como antes. É a instalação
 *     que não usa o livro-caixa, e avisar todo dia seria alarme falso para sempre.
 *
 * O ritmo parcial sozinho (`ritmoParcial`) não gera recado: ele atrasa o "dura
 * mais ou menos", que é só uma linha do aviso, e o aviso diz que ela é otimista.
 *
 * Puro: recebe o saldo e o limite, devolve o recado ou `null`. Quem manda (e
 * quem trava em um por dia) é o `reportar`, pela `chave`.
 */
import type { SaldoDaPlataforma } from "./saldo-da-plataforma";

export interface AvisoDoCredito {
  /** A chave da trava anti-ruído: um recado por dia por chave. */
  chave: "saldo_baixo" | "saldo_nao_conferido";
  texto: string;
  detalhe: Record<string, unknown>;
}

function dinheiro(usd: number): string {
  return usd.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

export function avisoDoCreditoDeIa(
  saldo: Pick<SaldoDaPlataforma, "saldoUsd" | "diasRestantes" | "consumoParcial" | "ritmoParcial">,
  limiteUsd: number,
): AvisoDoCredito | null {
  // Nunca registraram uma leitura: não há saldo, e não é "acabou".
  if (saldo.saldoUsd === null) return null;

  if (saldo.saldoUsd <= limiteUsd) {
    const dias =
      saldo.diasRestantes === null
        ? ""
        : `\n*Dura mais ou menos:* ${Math.max(0, Math.floor(saldo.diasRestantes))} dia(s)` +
          (saldo.ritmoParcial || saldo.consumoParcial ? " (conta otimista: o consumo lido está incompleto)" : "");
    const parcial = saldo.consumoParcial
      ? `\n\n*Atenção:* a soma do consumo veio incompleta. O saldo de verdade é MENOR que este.`
      : "";
    return {
      chave: "saldo_baixo",
      texto:
        `⚠️ *Crédito de IA acabando*\n\n` +
        `*Saldo:* ${dinheiro(saldo.saldoUsd)}` +
        `\n*Limite do aviso:* ${dinheiro(limiteUsd)}${dias}${parcial}\n\n` +
        `Quando o crédito acaba, a chave continua válida e a chamada volta recusada: ` +
        `o sintoma chega como "a IA parou de responder", em todos os clientes ao mesmo tempo.`,
      detalhe: { saldo_usd: saldo.saldoUsd, consumo_parcial: saldo.consumoParcial },
    };
  }

  if (saldo.consumoParcial) {
    return {
      chave: "saldo_nao_conferido",
      texto:
        `⚠️ *Não deu para conferir o crédito de IA*\n\n` +
        `A soma do consumo desde a última leitura veio incompleta (volume acima do que o sistema lê de uma vez, ou a leitura falhou).\n\n` +
        `*Saldo calculado:* ${dinheiro(saldo.saldoUsd)}, e ele é um TETO: o de verdade é menor, e pode estar abaixo do limite de ${dinheiro(limiteUsd)}.\n\n` +
        `*O que fazer:* olhe o saldo na conta do provedor e registre uma leitura de saldo no painel (/admin/usage). ` +
        `Com a leitura nova o intervalo encurta e a conta volta a fechar.`,
      detalhe: { saldo_calculado_usd: saldo.saldoUsd, consumo_parcial: true },
    };
  }

  return null;
}

/**
 * FORK MIA — OBRIGAÇÕES · o que cada botão faz com as datas, e o próximo ciclo.
 *
 * Porta das ações do protótipo aprovado (`ob-pedir`, `ob-receber-ok`,
 * `ob-feita`, `novo-ok`, `painelReceber`, `proxCicloTxt`). Aqui só se CALCULA:
 * quem grava é `lib/obrigacoes/operacoes.ts` (e a função do banco que fecha o
 * ciclo numa transação). A tela usa as mesmas contas para mostrar a prévia
 * antes do clique, e por isso o módulo é PURO.
 */
import { diaPorExtenso, somarDias, somarMeses, type Dia } from "./datas";
import { aguardando, maiorAviso, mesesDaRecorrencia } from "./situacao";
import { PRAZO_DO_PEDIDO_EM_DIAS, type ItemParaSituacao } from "./tipos";

type Traduzir = (texto: string) => string;

/** O que "Marcar pedido" e "Pedir de novo" mudam no item. */
export type EfeitoDoPedido =
  | { modo: "pedido" | "renovacao_pedida"; pedido_em: Dia; prazo_em: Dia; cobrado_em: null }
  | { modo: "pedido_de_novo"; cobrado_em: Dia };

/**
 * Pedir: sem pedido em aberto, registra o pedido de hoje com prazo de 7 dias
 * (é "renovação pedida" quando já houve um recebimento). Com pedido em aberto,
 * é uma cobrança: a data do pedido não muda, e o gatilho "documento não
 * enviado" não rearma.
 */
export function aoPedir(item: ItemParaSituacao, hoje: Dia): EfeitoDoPedido {
  if (!aguardando(item)) {
    return {
      modo: item.recebido_em ? "renovacao_pedida" : "pedido",
      pedido_em: hoje,
      prazo_em: somarDias(hoje, PRAZO_DO_PEDIDO_EM_DIAS),
      cobrado_em: null,
    };
  }
  return { modo: "pedido_de_novo", cobrado_em: hoje };
}

/**
 * O "válido até" que a tela SUGERE ao receber: a validade anterior mais um
 * período quando o item se repete; senão, hoje mais a validade padrão do tipo.
 * `null` quando o tipo não tem validade: o item fica "recebido · sem validade"
 * e sai dos avisos de vencimento.
 */
export function validadeSugerida(item: ItemParaSituacao, hoje: Dia): Dia | null {
  const meses = mesesDaRecorrencia(item);
  if (item.valido_ate && meses > 0) return somarMeses(item.valido_ate, meses);
  if (item.validade_meses > 0) return somarMeses(hoje, item.validade_meses);
  return null;
}

/** Receber uma versão quando já havia outra é RENOVAR: o ciclo anterior vai para o histórico. */
export function receberRenova(item: ItemParaSituacao): boolean {
  return Boolean(item.recebido_em || item.valido_ate);
}

/** A próxima data de uma atividade depois de marcada feita. `null` = não se repete. */
export function proximaDataDaAtividade(item: ItemParaSituacao, hoje: Dia): Dia | null {
  const meses = mesesDaRecorrencia(item);
  if (meses <= 0) return null;
  return somarMeses(item.proxima_em ?? hoje, meses);
}

/**
 * As datas de um item que nasce, como o formulário as entrega.
 *
 * Documento: "válido até" vazio com recebimento informado é calculado pela
 * validade padrão. Atividade: sem próxima data, nasce para daqui a um período.
 */
export function datasAoAdicionar(
  entrada: {
    categoria: ItemParaSituacao["categoria"];
    recorrencia: ItemParaSituacao["recorrencia"];
    recorrencia_meses: number | null;
    validade_meses: number;
    pedido_em?: Dia | null;
    prazo_em?: Dia | null;
    recebido_em?: Dia | null;
    valido_ate?: Dia | null;
    proxima_em?: Dia | null;
    feita_em?: Dia | null;
  },
  hoje: Dia,
): Pick<ItemParaSituacao, "pedido_em" | "prazo_em" | "recebido_em" | "valido_ate" | "proxima_em" | "feita_em"> {
  if (entrada.categoria === "atividade") {
    const meses = mesesDaRecorrencia(entrada) || 1;
    return {
      pedido_em: null,
      prazo_em: null,
      recebido_em: null,
      valido_ate: null,
      proxima_em: entrada.proxima_em || somarMeses(hoje, meses),
      feita_em: entrada.feita_em ?? null,
    };
  }
  const recebido = entrada.recebido_em ?? null;
  const validade =
    entrada.valido_ate || (recebido && entrada.validade_meses > 0 ? somarMeses(recebido, entrada.validade_meses) : null);
  return {
    pedido_em: entrada.pedido_em ?? null,
    prazo_em: entrada.prazo_em ?? null,
    recebido_em: recebido,
    valido_ate: validade,
    proxima_em: null,
    feita_em: null,
  };
}

/** A frase do painel de receber: o que acontece com o item depois da confirmação. */
export function textoDoProximoCiclo(item: ItemParaSituacao, validoAte: Dia | null, t: Traduzir): string {
  if (!validoAte) {
    return t("Sem \"válido até\", o item fica como recebido e não entra nos avisos de vencimento.");
  }
  const antecedencia = maiorAviso(item);
  const partes = [
    `${mesesDaRecorrencia(item) > 0 ? t("Próximo ciclo: vence em") : t("Vence em")} ${diaPorExtenso(validoAte)}.`,
    item.avisos_dias.length > 0
      ? `${t("Primeiro aviso em")} ${diaPorExtenso(somarDias(validoAte, -antecedencia))} (${antecedencia} ${t("dias antes")}).`
      : t("Este item está sem aviso de vencimento."),
  ];
  if (item.recebido_em) partes.push(t("O ciclo atual vai para o histórico do item."));
  return partes.join(" ");
}

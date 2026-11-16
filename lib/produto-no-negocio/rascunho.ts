/**
 * FORK MIA (.109) · o rascunho do bloco do negócio: o que a pessoa mexe em
 * Editar negócio e na janela de ganho antes de salvar (telas 2 e 3 do protótipo).
 *
 * Puro de propósito: "Digitar o valor à mão", "Usar a soma", o valor que segue a
 * soma e o pedido que vai para `PUT /api/v1/leads/[id]/itens` são regras, e
 * regra se prova em teste de unidade, não pela tela.
 */
import { parseReaisToCents } from "@/lib/money";

import {
  centavosParaTexto,
  somaEsperada,
  type EstadoDoValor,
  type ItemDoNegocio,
  type ModoDoValor,
} from "./regras";

export interface RascunhoDoNegocio {
  /** Os do bloco (editáveis) e os da proposta (só leitura), na ordem do bloco. */
  itens: ItemDoNegocio[];
  modo: ModoDoValor;
  /** Negócio de antes dos itens: a frase do valor à mão é a dele. */
  antigo: boolean;
  /** O texto do campo Valor quando ele é à mão. */
  valorTexto: string;
}

export function rascunhoInicial(dados: { itens: readonly ItemDoNegocio[]; valor: EstadoDoValor }): RascunhoDoNegocio {
  return {
    itens: dados.itens.map((i) => ({ ...i })),
    modo: dados.valor.modo,
    antigo: dados.valor.antigo,
    valorTexto: dados.valor.modo === "a_mao" ? centavosParaTexto(dados.valor.valorCents) : "",
  };
}

/** "Digitar o valor à mão": o campo abre com a soma de agora, para a pessoa partir dela. */
export function digitarAMao(r: RascunhoDoNegocio): RascunhoDoNegocio {
  return { ...r, modo: "a_mao", valorTexto: centavosParaTexto(somaEsperada(r.itens)) };
}

/** "Usar a soma" (ou "Voltar a somar", sem item): o valor volta a seguir os itens. */
export function usarASoma(r: RascunhoDoNegocio): RascunhoDoNegocio {
  return { ...r, modo: "soma", antigo: false, valorTexto: "" };
}

/** O valor digitado em centavos: `null` vazio ("Sem valor"), `undefined` inválido. */
export function valorDigitado(r: RascunhoDoNegocio, moeda: string): number | null | undefined {
  const texto = r.valorTexto.trim();
  if (!texto) return null;
  const cents = parseReaisToCents(texto, moeda);
  return cents === null ? undefined : cents;
}

/** O valor que o negócio terá ao salvar: a soma, ou o digitado (`undefined` se inválido). */
export function valorDoRascunho(r: RascunhoDoNegocio, moeda: string): number | null | undefined {
  return r.modo === "soma" ? somaEsperada(r.itens) : valorDigitado(r, moeda);
}

export type PedidoDoRascunho =
  | {
      ok: true;
      pedido: {
        itens: Array<{ id?: string; product_id?: string; quantidade: number; desconto_cents: number }>;
        valor: { modo: "soma" } | { modo: "a_mao"; value_cents: number | null };
      };
    }
  | { ok: false; motivo: "valor_invalido" };

/** O corpo do PUT: só os itens do bloco (os da proposta mudam pela proposta) e o modo do valor. */
export function pedidoDoRascunho(r: RascunhoDoNegocio, moeda: string): PedidoDoRascunho {
  const itens = r.itens
    .filter((i) => i.origem === "negocio")
    .map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      ...(i.productId ? { product_id: i.productId } : {}),
      quantidade: i.quantidade,
      desconto_cents: i.descontoCents,
    }));
  if (r.modo === "soma") return { ok: true, pedido: { itens, valor: { modo: "soma" } } };
  const v = valorDigitado(r, moeda);
  if (v === undefined) return { ok: false, motivo: "valor_invalido" };
  return { ok: true, pedido: { itens, valor: { modo: "a_mao", value_cents: v } } };
}

/** O rascunho mudou alguma coisa do que está gravado? Sem mudança, nada vai ao servidor. */
export function rascunhoMudou(r: RascunhoDoNegocio, gravado: { itens: readonly ItemDoNegocio[]; valor: EstadoDoValor }, moeda: string): boolean {
  const meus = (lista: readonly ItemDoNegocio[]) =>
    lista
      .filter((i) => i.origem === "negocio")
      .map((i) => `${i.id ?? "novo"}|${i.productId ?? ""}|${i.quantidade}|${i.descontoCents}`)
      .join(";");
  if (meus(r.itens) !== meus(gravado.itens)) return true;
  if (r.modo !== gravado.valor.modo) return true;
  if (r.modo === "a_mao") return valorDigitado(r, moeda) !== gravado.valor.valorCents;
  return false;
}

/**
 * FORK MIA (.109) · os dois quadros novos do Relatório de vendas
 * (docs/fork/produto-no-negocio.md, tela 5 do protótipo).
 *
 *   VENDIDOS NO MÊS        por produto: quantas unidades, em quantos negócios e
 *                          por quanto. O negócio com dois produtos aparece nos
 *                          dois; a quantidade soma as unidades (dois implantes
 *                          contam 2); o valor de cada linha é preço × quantidade,
 *                          menos o desconto.
 *   TEMPO ATÉ FECHAR       por produto: do dia em que o negócio nasceu até o dia
 *                          em que fechou (a MESMA conta do Ciclo de venda), com
 *                          mediana e média. Com menos de 3 vendas no mês, a
 *                          linha avisa que é pouco para tirar conclusão.
 *
 * ── O total bate com a Receita do mês ───────────────────────────────────────
 *
 * Quem recebe as vendas é a rota, já filtradas pela MESMA régua da receita
 * (ganhas no mês, nos funis em que vencer é receita, `lib/crm/relatorio/vendas.ts`).
 * Para o total do quadro ser a Receita do mês, três linhas fecham a conta além
 * dos produtos: "Sem <produto>" (o negócio sem item, de antes ou não), o ajuste
 * do valor digitado à mão (o que o negócio fechou acima ou abaixo da soma) e a
 * mensalidade (a receita conta o valor recorrente, que não é item).
 */
import { valorDoItem, type ItemDoNegocio } from "./regras";

/** Abaixo disso a linha do tempo até fechar avisa que é pouco. */
export const VENDAS_PARA_CONCLUIR = 3;

export interface VendaDoMes {
  leadId: string;
  /** O valor do negócio (o valor único). */
  valueCents: number | null;
  /** A mensalidade, que a Receita do mês soma ao valor único. */
  recurringValueCents?: number | null;
  createdAt: string;
  closedAt: string | null;
  itens: readonly ItemDoNegocio[];
}

/** O produto: pelo id do catálogo; o item de proposta digitado à mão, pelo texto. */
export function chaveDoProduto(it: Pick<ItemDoNegocio, "productId" | "nome">): string {
  return it.productId ? `p:${it.productId}` : `t:${it.nome.trim().toLocaleLowerCase("pt-BR")}`;
}

function nomeDoProduto(it: ItemDoNegocio): string {
  return (it.nomeNoCatalogo ?? "").trim() || it.nome.trim();
}

export interface LinhaVendida {
  chave: string;
  nome: string;
  quantidade: number;
  negocios: number;
  valorCents: number;
}

export interface VendidosNoMes {
  linhas: LinhaVendida[];
  /** Negócios fechados sem item. */
  sem: { negocios: number; valorCents: number };
  /** Negócios cujo valor não é a soma dos itens: o que passou (ou faltou) da soma. */
  ajuste: { negocios: number; valorCents: number };
  /** A mensalidade dos negócios fechados (fora da soma dos itens). */
  recorrente: { negocios: number; valorCents: number };
  total: { quantidade: number; negocios: number; valorCents: number };
  /** Negócios com pelo menos um item. */
  negociosComItem: number;
}

export function vendidosNoMes(vendas: readonly VendaDoMes[]): VendidosNoMes {
  const por = new Map<string, LinhaVendida>();
  const sem = { negocios: 0, valorCents: 0 };
  const ajuste = { negocios: 0, valorCents: 0 };
  const recorrente = { negocios: 0, valorCents: 0 };
  let quantidade = 0;
  let valorTotal = 0;
  let negociosComItem = 0;

  for (const v of vendas) {
    const valor = v.valueCents ?? 0;
    valorTotal += valor;
    const mensal = v.recurringValueCents ?? 0;
    if (mensal > 0) {
      recorrente.negocios += 1;
      recorrente.valorCents += mensal;
      valorTotal += mensal;
    }
    if (v.itens.length === 0) {
      sem.negocios += 1;
      sem.valorCents += valor;
      continue;
    }
    negociosComItem += 1;
    let soma = 0;
    const vistos = new Set<string>();
    for (const it of v.itens) {
      const chave = chaveDoProduto(it);
      const linha = por.get(chave) ?? { chave, nome: nomeDoProduto(it), quantidade: 0, negocios: 0, valorCents: 0 };
      const val = valorDoItem(it);
      linha.quantidade += it.quantidade;
      linha.valorCents += val;
      if (!vistos.has(chave)) {
        linha.negocios += 1;
        vistos.add(chave);
      }
      por.set(chave, linha);
      soma += val;
      quantidade += it.quantidade;
    }
    if (valor !== soma) {
      ajuste.negocios += 1;
      ajuste.valorCents += valor - soma;
    }
  }

  const linhas = [...por.values()].sort((a, b) => b.valorCents - a.valorCents || a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    linhas,
    sem,
    ajuste,
    recorrente,
    total: { quantidade, negocios: vendas.length, valorCents: valorTotal },
    negociosComItem,
  };
}

/** Dias de vida do negócio (nasceu → fechou), `null` quando as datas não servem. A régua de `cicloDeVenda`. */
export function diasAteFechar(v: Pick<VendaDoMes, "createdAt" | "closedAt">): number | null {
  if (!v.closedAt) return null;
  const nasceu = new Date(v.createdAt).getTime();
  const fechou = new Date(v.closedAt).getTime();
  if (!Number.isFinite(nasceu) || !Number.isFinite(fechou) || fechou < nasceu) return null;
  return (fechou - nasceu) / 86_400_000;
}

export function mediana(valores: readonly number[]): number {
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

export function media(valores: readonly number[]): number {
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

const umaCasa = (n: number) => Math.round(n * 10) / 10;

export interface LinhaDoTempo {
  chave: string;
  nome: string;
  vendas: number;
  medianaDias: number;
  mediaDias: number;
  /** Menos de 3 vendas no mês: pouco para tirar conclusão. */
  poucas: boolean;
}

export interface TempoAteFechar {
  linhas: LinhaDoTempo[];
  /** Os negócios sem item, na mesma conta (ou `null` se todos tinham item). */
  sem: Omit<LinhaDoTempo, "chave" | "nome"> | null;
}

export function tempoAteFechar(vendas: readonly VendaDoMes[]): TempoAteFechar {
  const por = new Map<string, { nome: string; dias: number[] }>();
  const semDias: number[] = [];
  for (const v of vendas) {
    const dias = diasAteFechar(v);
    if (dias === null) continue;
    if (v.itens.length === 0) {
      semDias.push(dias);
      continue;
    }
    const vistos = new Set<string>();
    for (const it of v.itens) {
      const chave = chaveDoProduto(it);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const g = por.get(chave) ?? { nome: nomeDoProduto(it), dias: [] };
      g.dias.push(dias);
      por.set(chave, g);
    }
  }
  const resumo = (dias: number[]) => ({
    vendas: dias.length,
    medianaDias: umaCasa(mediana(dias)),
    mediaDias: umaCasa(media(dias)),
    poucas: dias.length < VENDAS_PARA_CONCLUIR,
  });
  const linhas = [...por.entries()]
    .map(([chave, g]) => ({ chave, nome: g.nome, ...resumo(g.dias) }))
    .sort((a, b) => b.medianaDias - a.medianaDias || a.nome.localeCompare(b.nome, "pt-BR"));
  return { linhas, sem: semDias.length > 0 ? resumo(semDias) : null };
}

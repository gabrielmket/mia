/**
 * O RELATÓRIO DE VENDAS — as perguntas que a tela de funil não responde.
 *
 * `Desempenho` já mostra quantos negócios estão em cada etapa AGORA. Isso é uma
 * fotografia, e fotografia não responde gestão:
 *
 *   • por que perdemos? (motivo de perda, agrupado)
 *   • quanto tempo leva para fechar? (ciclo de venda)
 *   • o mês está melhor ou pior? (evolução, não um número solto)
 *   • quanto é recorrente e quanto é projeto? (natureza da receita)
 *
 * Tudo puro: recebe as linhas e devolve os números. Quem lê banco é a rota.
 *
 * ── A régua de receita é a MESMA do módulo de metas ─────────────────────────
 *
 * Ganhar num funil de SDR (onde vencer é "reunião agendada") não é receita.
 * Este arquivo recebe o conjunto de funis que contam e aplica o mesmo filtro —
 * duas réguas de receita no mesmo produto dariam dois totais para o mesmo mês,
 * e aí nenhum dos dois é confiável.
 */

import { mesNoFuso } from "@/lib/crm/metas/fuso";
import { partesDaVenda } from "@/lib/crm/metas/partes-da-venda";

export interface LeadDoRelatorio {
  status: string;
  pipeline_id: string;
  value_cents: number | null;
  revenue_kind: "recorrente" | "avulso" | null;
  recurring_months: number | null;
  /** FORK MIA: a mensalidade do upstream (v1.99); ver `lib/crm/metas/partes-da-venda.ts`. */
  recurring_value_cents?: number | null;
  lost_reason: string | null;
  created_at: string;
  closed_at: string | null;
}

export type FunisDeReceita = ReadonlySet<string> | null;

function contaComoReceita(l: LeadDoRelatorio, funis: FunisDeReceita): boolean {
  return funis === null || funis.has(l.pipeline_id);
}

export interface MotivoDePerda {
  motivo: string;
  quantidade: number;
  /** Quanto de pipeline foi embora por este motivo. */
  valorCents: number;
}

/**
 * Por que perdemos — agrupado e ordenado pelo que mais dói.
 *
 * Ordena por VALOR e não por quantidade: dez leads pequenos perdidos por preço
 * e um contrato grande perdido por prazo não são o mesmo problema, e uma lista
 * por contagem esconderia o segundo embaixo do primeiro.
 *
 * ⚠️ Perda entra de QUALQUER funil, inclusive os que não contam receita. Perder
 * no funil do SDR é perder uma reunião — informação de gestão legítima, e
 * filtrá-la aqui esconderia metade do problema de quem prospecta.
 */
export function motivosDePerda(
  leads: readonly LeadDoRelatorio[],
  periodo: string,
  fuso: string,
): MotivoDePerda[] {
  const porMotivo = new Map<string, MotivoDePerda>();
  for (const l of leads) {
    if (l.status !== "lost") continue;
    if (mesNoFuso(l.closed_at, fuso) !== periodo.slice(0, 7)) continue;
    // Perda sem motivo declarado é um estado real (importação, correção manual)
    // e vira uma linha própria — somá-la a "outro" misturaria quem respondeu
    // "outro" com quem não respondeu nada.
    const motivo = l.lost_reason?.trim() || "(sem motivo declarado)";
    const atual = porMotivo.get(motivo) ?? { motivo, quantidade: 0, valorCents: 0 };
    atual.quantidade += 1;
    atual.valorCents += l.value_cents ?? 0;
    porMotivo.set(motivo, atual);
  }
  return [...porMotivo.values()].sort((a, b) => b.valorCents - a.valorCents);
}

export interface CicloDeVenda {
  /** Dias entre a criação e o fechamento, em média. `null` sem venda no mês. */
  mediaDias: number | null;
  /** A mediana: com um contrato de 8 meses no meio, ela é a que representa. */
  medianaDias: number | null;
  vendas: number;
}

/**
 * Quanto tempo leva para fechar.
 *
 * Devolve média E mediana de propósito. A média sozinha mente quando um negócio
 * arrastado de oito meses entra no mês: ela sobe, e quem lê conclui que o ciclo
 * piorou quando o que houve foi um caso isolado. A mediana mostra o típico, e a
 * distância entre as duas é, ela mesma, a informação de que há um fora da curva.
 */
export function cicloDeVenda(
  leads: readonly LeadDoRelatorio[],
  periodo: string,
  fuso: string,
  funis: FunisDeReceita,
): CicloDeVenda {
  const dias: number[] = [];
  for (const l of leads) {
    if (l.status !== "won") continue;
    if (!contaComoReceita(l, funis)) continue;
    if (mesNoFuso(l.closed_at, fuso) !== periodo.slice(0, 7)) continue;
    if (!l.closed_at) continue;
    const nasceu = new Date(l.created_at).getTime();
    const fechou = new Date(l.closed_at).getTime();
    if (!Number.isFinite(nasceu) || !Number.isFinite(fechou) || fechou < nasceu) continue;
    dias.push((fechou - nasceu) / 86_400_000);
  }
  if (dias.length === 0) return { mediaDias: null, medianaDias: null, vendas: 0 };

  const soma = dias.reduce((a, b) => a + b, 0);
  const ordenado = [...dias].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  const mediana =
    ordenado.length % 2 === 0 ? (ordenado[meio - 1]! + ordenado[meio]!) / 2 : ordenado[meio]!;

  return {
    mediaDias: Math.round((soma / dias.length) * 10) / 10,
    medianaDias: Math.round(mediana * 10) / 10,
    vendas: dias.length,
  };
}

export interface MesDoHistorico {
  /** AAAA-MM. */
  periodo: string;
  receitaCents: number;
  recorrenteCents: number;
  avulsoCents: number;
  vendas: number;
  perdas: number;
}

/**
 * A evolução dos últimos meses.
 *
 * Um número solto não diz nada: R$ 40 mil é ótimo depois de R$ 20 mil e ruim
 * depois de R$ 80 mil. O relatório existe para mostrar a direção, e por isso os
 * meses SEM venda também entram — um buraco no meio da série é informação, e
 * omiti-lo faria a linha parecer contínua.
 */
export function historico(
  leads: readonly LeadDoRelatorio[],
  ateOPeriodo: string,
  meses: number,
  fuso: string,
  funis: FunisDeReceita,
): MesDoHistorico[] {
  const partes = ateOPeriodo.slice(0, 7).split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);

  const linha = new Map<string, MesDoHistorico>();
  for (let i = meses - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    const p = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    linha.set(p, {
      periodo: p,
      receitaCents: 0,
      recorrenteCents: 0,
      avulsoCents: 0,
      vendas: 0,
      perdas: 0,
    });
  }

  for (const l of leads) {
    const p = mesNoFuso(l.closed_at, fuso);
    const alvo = linha.get(p);
    if (!alvo) continue;
    if (l.status === "lost") {
      alvo.perdas += 1;
      continue;
    }
    if (l.status !== "won" || !contaComoReceita(l, funis)) continue;
    // FORK MIA (upstream v1.99): a mensalidade pode estar na coluna própria.
    const partes = partesDaVenda(l);
    alvo.receitaCents += partes.recorrente + partes.avulso + partes.naoClassificada;
    alvo.vendas += 1;
    alvo.recorrenteCents += partes.recorrente;
    alvo.avulsoCents += partes.avulso;
  }

  return [...linha.values()];
}

export interface TaxaDeGanho {
  ganhos: number;
  perdidos: number;
  /** ganhos ÷ (ganhos + perdidos). `null` sem nenhum fechamento no mês. */
  taxa: number | null;
}

/**
 * Quantos dos negócios FECHADOS no mês foram ganhos.
 *
 * O denominador é só o que fechou — não o que está aberto. Incluir os abertos
 * faria a taxa despencar sempre que entrasse gente nova no funil, que é
 * exatamente o oposto do que significa entrar gente nova.
 */
export function taxaDeGanho(
  leads: readonly LeadDoRelatorio[],
  periodo: string,
  fuso: string,
  funis: FunisDeReceita,
): TaxaDeGanho {
  let ganhos = 0;
  let perdidos = 0;
  for (const l of leads) {
    if (mesNoFuso(l.closed_at, fuso) !== periodo.slice(0, 7)) continue;
    if (l.status === "won" && contaComoReceita(l, funis)) ganhos += 1;
    else if (l.status === "lost") perdidos += 1;
  }
  const fechados = ganhos + perdidos;
  return { ganhos, perdidos, taxa: fechados > 0 ? ganhos / fechados : null };
}

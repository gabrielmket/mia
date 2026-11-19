/**
 * FORK MIA (MIA-44) — os atalhos de período das duas telas de uso do painel
 * (`/admin/usage` e a aba Uso do cliente): 7, 30 e 90 dias, "Este mês" e "Mês
 * passado".
 *
 * O mês é o do calendário em Brasília, e quem diz qual é o mês atual e o
 * anterior é `mesAtualEAnterior`, a mesma conta da rota e do MCP
 * (`lib/ai/usage/consumo-do-periodo.ts`). Este arquivo só traduz o botão em
 * `dias` ou `mes`: não calcula início nem fim, que são da rota.
 *
 * Seguro no cliente: nem este módulo nem o que ele importa tocam servidor.
 */
import { mesAtualEAnterior } from "@/lib/ai/usage/consumo-do-periodo";

export type AtalhoDePeriodo = "7d" | "30d" | "90d" | "este_mes" | "mes_passado";

export const ATALHOS_DE_PERIODO: ReadonlyArray<{ valor: AtalhoDePeriodo; rotulo: string }> = [
  { valor: "7d", rotulo: "Últimos 7 dias" },
  { valor: "30d", rotulo: "Últimos 30 dias" },
  { valor: "90d", rotulo: "Últimos 90 dias" },
  { valor: "este_mes", rotulo: "Este mês" },
  { valor: "mes_passado", rotulo: "Mês passado" },
];

export type PedidoDePeriodo = { tipo: "dias"; dias: 7 | 30 | 90 } | { tipo: "mes"; mes: string };

/** O que cada atalho pede à rota: uma janela em dias ou um mês AAAA-MM. */
export function pedidoDoAtalho(atalho: AtalhoDePeriodo, agora: Date = new Date()): PedidoDePeriodo {
  switch (atalho) {
    case "7d":
      return { tipo: "dias", dias: 7 };
    case "90d":
      return { tipo: "dias", dias: 90 };
    case "este_mes":
      return { tipo: "mes", mes: mesAtualEAnterior(agora).atual };
    case "mes_passado":
      return { tipo: "mes", mes: mesAtualEAnterior(agora).anterior };
    default:
      return { tipo: "dias", dias: 30 };
  }
}

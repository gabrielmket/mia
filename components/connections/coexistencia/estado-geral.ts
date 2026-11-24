/**
 * FORK MIA · coexistência (S3): o estado que a tela mostra, a partir dos dois
 * pedidos da sincronização. Puro, para o teste e para o /admin/meta.
 *
 * Segue o pedido do HISTÓRICO (o que a empresa mais espera); o de contatos
 * aparece no número de contatos.
 */
import type { PedidoDaSincronizacaoNaTela } from "@/hooks/channels/useCoexistencia";

export type EstadoGeral = "pedida" | "andamento" | "concluida" | "falhou" | "recusou" | "incerto" | "prazo";

export function estadoGeralDaSincronizacao(pedidos: readonly PedidoDaSincronizacaoNaTela[]): EstadoGeral {
  const historico = pedidos.find((p) => p.tipo === "historico");
  const contatos = pedidos.find((p) => p.tipo === "contatos");
  const base = historico ?? contatos;
  if (!base) return "pedida";
  switch (base.estado) {
    case "concluida":
      return "concluida";
    case "recusada_pelo_dono":
      return "recusou";
    case "falhou":
      return "falhou";
    case "sem_resposta":
      return contatos?.estado === "em_andamento" ? "andamento" : "incerto";
    case "prazo_vencido":
      return "prazo";
    case "em_andamento":
      return "andamento";
    default:
      return contatos?.estado === "em_andamento" ? "andamento" : "pedida";
  }
}


/**
 * FORK MIA — OBRIGAÇÕES · os FILTROS da lista geral (a agenda de renovações da
 * carteira). Porta de `passaLista` e dos contadores do protótipo aprovado.
 *
 * ⚠️ Módulo PURO: a tela filtra na hora, sem ir ao servidor, e o MCP de
 * plataforma usa o mesmo corte por situação.
 */
import type { Dia } from "./datas";
import { emDia, semResposta, situacao, urgencia, venceEm, type Situacao } from "./situacao";
import type { Categoria, ItemParaSituacao } from "./tipos";

export const PRAZOS_DO_FILTRO = ["todos", "vencidos", "7", "15", "30", "60"] as const;
export type PrazoDoFiltro = (typeof PRAZOS_DO_FILTRO)[number];

export const LIGADO_A_DO_FILTRO = ["todos", "negocio", "empresa", "contato"] as const;
export type LigadoADoFiltro = (typeof LIGADO_A_DO_FILTRO)[number];

export interface FiltrosDaLista {
  situacao: Situacao | "todas";
  /** "todos", "documento", "atividade", ou o NOME de um tipo. */
  tipo: string;
  /** O id de quem responde, ou "todos". */
  responsavel: string;
  prazo: PrazoDoFiltro;
  ligado: LigadoADoFiltro;
  /** Os dois contadores que não são prazo: pedidos sem resposta e em dia. */
  rapido: "" | "sem_resposta" | "em_dia";
}

export const FILTROS_ZERADOS: FiltrosDaLista = {
  situacao: "todas",
  tipo: "todos",
  responsavel: "todos",
  prazo: "todos",
  ligado: "todos",
  rapido: "",
};

type ItemDaLista = ItemParaSituacao & {
  nome: string;
  categoria: Categoria;
  responsavel_user_id: string | null;
  lead_id: string | null;
  empresa_id: string | null;
  contact_id: string | null;
};

export function passaNaLista(item: ItemDaLista, f: FiltrosDaLista, hoje: Dia): boolean {
  if (f.situacao !== "todas" && situacao(item, hoje) !== f.situacao) return false;
  if (f.tipo === "documento" || f.tipo === "atividade") {
    if (item.categoria !== f.tipo) return false;
  } else if (f.tipo !== "todos" && item.nome !== f.tipo) {
    return false;
  }
  if (f.responsavel !== "todos" && item.responsavel_user_id !== f.responsavel) return false;
  if (f.ligado === "negocio" && !item.lead_id) return false;
  if (f.ligado === "empresa" && !item.empresa_id) return false;
  if (f.ligado === "contato" && !item.contact_id) return false;
  if (f.prazo === "vencidos") {
    if (urgencia(item, hoje).tipo !== "vencido") return false;
  } else if (f.prazo !== "todos" && !venceEm(item, Number(f.prazo), hoje)) {
    return false;
  }
  if (f.rapido === "sem_resposta" && !semResposta(item, hoje)) return false;
  if (f.rapido === "em_dia" && !emDia(item, hoje)) return false;
  return true;
}

/** Os quatro contadores, na ordem da tela, com o filtro que cada um liga. */
export const CONTADORES_DA_LISTA = [
  { chave: "vencidos", rotulo: "Vencidos", tom: "perigo" },
  { chave: "vencendo_em_30_dias", rotulo: "Vencendo em 30 dias", tom: "alerta" },
  { chave: "pedidos_sem_resposta", rotulo: "Pedidos sem resposta", tom: "info" },
  { chave: "em_dia", rotulo: "Em dia", tom: "ok" },
] as const;

export type ChaveDoContador = (typeof CONTADORES_DA_LISTA)[number]["chave"];

/** O contador está ligado nos filtros atuais? */
export function contadorLigado(chave: ChaveDoContador, f: FiltrosDaLista): boolean {
  if (chave === "vencidos") return f.prazo === "vencidos" && !f.rapido;
  if (chave === "vencendo_em_30_dias") return f.prazo === "30" && !f.rapido;
  if (chave === "pedidos_sem_resposta") return f.rapido === "sem_resposta";
  return f.rapido === "em_dia";
}

/** Clicar num contador: liga só ele (e limpa o resto); clicar de novo, desliga. */
export function aoClicarNoContador(chave: ChaveDoContador, f: FiltrosDaLista): FiltrosDaLista {
  if (contadorLigado(chave, f)) return { ...FILTROS_ZERADOS };
  if (chave === "vencidos") return { ...FILTROS_ZERADOS, prazo: "vencidos" };
  if (chave === "vencendo_em_30_dias") return { ...FILTROS_ZERADOS, prazo: "30" };
  if (chave === "pedidos_sem_resposta") return { ...FILTROS_ZERADOS, rapido: "sem_resposta" };
  return { ...FILTROS_ZERADOS, rapido: "em_dia" };
}

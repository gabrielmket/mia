/**
 * FORK MIA (item 9) — QUEM PODE O QUÊ no montador (as decisões do protótipo,
 * "Quem vê e quem faz"), do lado do TypeScript.
 *
 * O banco já garante cada uma (RLS e gatilho da 9040, provados em
 * `tests/invariants/montador-de-relatorios.test.ts`). Estas funções existem
 * para a TELA desligar o botão e dizer por quê antes de a pessoa tentar, e
 * para as rotas recusarem com uma frase legível em vez de um 42501 cru.
 *
 * ⚠️ Módulo PURO.
 */
import { ROLE_RANK, type Role } from "@/lib/auth/types";

function rank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : 0;
}

/** "Só gestor e administrador compartilham com a equipe e geram link para o dono." */
export function podeCompartilhar(role: string | null | undefined): boolean {
  return rank(role) >= ROLE_RANK.manager;
}

/** "Exportar planilha: só gestor e administrador, e cada exportação fica registrada." */
export function podeExportar(role: string | null | undefined): boolean {
  return rank(role) >= ROLE_RANK.manager;
}

/** Anúncios (o que foi informado à Meta e ao Google): o piso da tela de Conversões. */
export function podeVerAnuncios(role: string | null | undefined): boolean {
  return rank(role) >= ROLE_RANK.manager;
}

/**
 * "Valor em reais aparece para quem já vê valor no funil. A regra já existe no
 * funil; o montador só obedece."
 *
 * Hoje o funil do produto mostra o valor do negócio a TODO membro que enxerga
 * o negócio (não há papel que esconda valor no quadro). Por isso a resposta é
 * sim para todos. Esta função é o ÚNICO ponto que o montador consulta: no dia
 * em que o funil ganhar um papel sem valor, a mudança é aqui, e o motor já
 * devolve o dinheiro nulo (`p_valores = false`) e a lista já some com a coluna.
 */
export function veValores(_role: string | null | undefined): boolean {
  return true;
}

/** "Quem edita um relatório compartilhado? Quem criou e o administrador. Os outros veem e podem copiar." */
export function podeEditar(
  item: { criadoPor: string | null; compartilhado: boolean },
  quem: { userId: string; role: string | null | undefined },
): boolean {
  if (item.criadoPor === quem.userId) return true;
  return item.compartilhado && rank(quem.role) >= ROLE_RANK.admin;
}

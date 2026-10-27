/**
 * FORK MIA (.94) · QUEM APROVA O QUÊ (protótipo "ensina e faz", tela 5). Puro.
 *
 * A regra em uma frase (decisão 1): pelo assistente, aprova quem pode fazer a
 * mesma coisa na tela. Ninguém ganha poder por causa do assistente, e ninguém
 * perde. As exceções são mais fechadas que a tela (decisão 2): as três peças do
 * modelo (.91) e a meta do mês ficam só com o administrador.
 *
 *   etapa (criar e renomear), etiqueta,     gestor ou administrador (Etapas do
 *   rascunho de follow-up, conhecimento     funil, Etiquetas, Follow-ups e
 *                                           Conhecimento pedem gestor na tela)
 *   resposta rápida e relatório SÓ SEUS     quem pediu: a peça é dela, e na tela
 *                                           só a dona grava a sua (a RLS de
 *                                           `message_templates` e de
 *                                           `mia_relatorios`)
 *   resposta e relatório DA EQUIPE          gestor ou administrador
 *   tarefa para si                          quem pediu, ou gestor e administrador
 *   tarefa para outra pessoa                gestor ou administrador (o
 *                                           protótipo fecha aqui o que a tela
 *                                           deixa o atendente fazer)
 *   meta do mês, agente, funil e            só o administrador
 *   follow-up do modelo
 *
 * Desfazer é de quem aprova aquele tipo. Propor é de atendente em diante (o
 * somente leitura só lê); a meta, só de gestor em diante, porque o atendente
 * não vê a meta da equipe pelo assistente.
 */
import { roleAtLeast, type Role } from "@/lib/auth/types";

import type { PedidoDaProposta, TipoDeProposta } from "./tipos";

export interface RegraDeAprovacao {
  /** O papel mínimo que aprova (fora o caso de quem pediu). */
  papel: Role;
  /** A peça é de quem pediu: só ela aprova (resposta e relatório "só meus"). */
  soQuemPediu: boolean;
  /** Quem pediu também aprova (a tarefa para si). */
  ouQuemPediu: boolean;
  /** Como o cartão diz. */
  rotulo: string;
}

const SO_O_ADMINISTRADOR: RegraDeAprovacao = { papel: "admin", soQuemPediu: false, ouQuemPediu: false, rotulo: "só o administrador" };
const GESTOR: RegraDeAprovacao = { papel: "manager", soQuemPediu: false, ouQuemPediu: false, rotulo: "gestor ou administrador" };
const SO_QUEM_PEDIU: RegraDeAprovacao = { papel: "agent", soQuemPediu: true, ouQuemPediu: false, rotulo: "quem pediu: é só dela" };
const QUEM_PEDIU_OU_GESTOR: RegraDeAprovacao = {
  papel: "manager",
  soQuemPediu: false,
  ouQuemPediu: true,
  rotulo: "quem pediu, ou gestor e administrador",
};

/** A regra de uma proposta, pelo tipo e pelo pedido (para quem é a peça). */
export function regraDeAprovacao(proposta: Pick<PedidoDaProposta, "tipo" | "pedido">, criadaPor: string | null): RegraDeAprovacao {
  switch (proposta.tipo) {
    case "agente":
    case "funil":
    case "followup":
    case "meta":
      return SO_O_ADMINISTRADOR;
    case "etapa_criar":
    case "etapa_renomear":
    case "etiqueta":
    case "rascunho_de_followup":
    case "conhecimento":
      return GESTOR;
    case "resposta":
    case "relatorio":
      return (proposta.pedido as { para?: string }).para === "eu" ? SO_QUEM_PEDIU : GESTOR;
    case "tarefa":
      return criadaPor && (proposta.pedido as { para_user_id?: string }).para_user_id === criadaPor ? QUEM_PEDIU_OU_GESTOR : GESTOR;
  }
}

export interface PessoaQueDecide {
  userId: string;
  papel: Role | null | undefined;
}

/** Esta pessoa aprova (e desfaz) esta proposta? */
export function podeAprovar(regra: RegraDeAprovacao, pessoa: PessoaQueDecide, criadaPor: string | null): boolean {
  const ehQuemPediu = criadaPor !== null && pessoa.userId === criadaPor && roleAtLeast(pessoa.papel ?? null, "agent");
  if (regra.soQuemPediu) return ehQuemPediu;
  if (regra.ouQuemPediu && ehQuemPediu) return true;
  return roleAtLeast(pessoa.papel ?? null, regra.papel);
}

/** Quem pode PROPOR este tipo: atendente em diante; a meta, gestor em diante. */
export function podePropor(tipo: TipoDeProposta, papel: Role | null | undefined): boolean {
  if (!roleAtLeast(papel ?? null, "agent")) return false;
  if (tipo === "meta") return roleAtLeast(papel ?? null, "manager");
  return true;
}

/**
 * A quem pedir: quem aprova, sem quem pediu, do papel mais baixo para o mais
 * alto (a etapa vai à gestora; a meta, ao administrador). No máximo três.
 */
export function aQuemPedir<P extends { user_id: string; nome: string; papel: Role }>(
  regra: RegraDeAprovacao,
  equipe: readonly P[],
  criadaPor: string | null,
): P[] {
  if (regra.soQuemPediu) return [];
  const peso = (p: Role) => (p === "admin" ? 2 : p === "manager" ? 1 : 0);
  return equipe
    .filter((p) => p.user_id !== criadaPor && roleAtLeast(p.papel, regra.papel))
    .sort((a, b) => peso(a.papel) - peso(b.papel) || a.nome.localeCompare(b.nome))
    .slice(0, 3);
}

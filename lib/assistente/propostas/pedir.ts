/**
 * FORK MIA (.94) — PEDIR a quem aprova, com o cartão pronto (protótipo "ensina
 * e faz", tela 5, decisão 5), e AVISAR quem pediu do resultado.
 *
 * Quem não aprova a peça pode pedir: a proposta continua PENDENTE e ganha a
 * quem foi pedida (`pedida_a`, 9100); o aviso chega no sino dessa pessoa e o
 * cartão aparece em "Pedidos esperando você", no assistente de quem aprova. É
 * o "Pedir à pessoa" da .88 com a proposta junto: nada muda ainda.
 *
 * Quando alguém decide (aplica, recusa ou desfaz) a proposta de outra pessoa,
 * o resultado volta para quem pediu: no mesmo cartão (a RLS da 9100 deixa ela
 * ler a própria proposta) e no sino.
 *
 * Servidor: grava com o cliente de serviço, a empresa de fonte confiável. A
 * empresa pode desligar o pedido (`mia_assistente_config.pode_pedir`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { Role } from "@/lib/auth/types";

import { avisarNoSino } from "../avisos";
import type { PessoaDaEquipe } from "../leituras/comum";
import { aQuemPedir, podeAprovar, regraDeAprovacao } from "./quem-aprova";
import { COLUNAS_DA_PROPOSTA, type PedidoDaProposta, type PropostaLida } from "./tipos";

export interface QuemPede {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  nome: string | null;
  papel: Role;
  requestId: string;
  equipe: readonly PessoaDaEquipe[];
  /** A empresa deixa pedir (`mia_assistente_config.pode_pedir`). */
  podePedir: boolean;
}

export type DesfechoDoPedido =
  | { ok: true; desfecho: "pedida" | "ja_estava"; proposta: PropostaLida; para: { user_id: string; nome: string } }
  | { ok: false; codigo: "nao_encontrada" | "ja_decidida" | "nao_e_sua" | "voce_aprova" | "desligado" | "sem_quem_aprove"; mensagem: string };

export async function pedirProposta(q: QuemPede, propostaId: string, paraUserId: string | null): Promise<DesfechoDoPedido> {
  if (!q.podePedir) {
    return { ok: false, codigo: "desligado", mensagem: "Nesta empresa, o pedido pelo assistente está desligado: fale direto com quem aprova." };
  }
  const { data } = await q.admin
    .from("mia_assistente_propostas")
    .select(`${COLUNAS_DA_PROPOSTA}, pedido`)
    .eq("organization_id", q.orgId)
    .eq("id", propostaId)
    .maybeSingle();
  const proposta = data as (PropostaLida & { pedido: unknown }) | null;
  if (!proposta) return { ok: false, codigo: "nao_encontrada", mensagem: "Proposta não encontrada nesta empresa." };
  if (proposta.situacao !== "pendente") return { ok: false, codigo: "ja_decidida", mensagem: "A proposta já foi decidida." };
  if (proposta.criada_por !== q.userId) return { ok: false, codigo: "nao_e_sua", mensagem: "Só quem pediu a proposta manda o pedido." };

  const regra = regraDeAprovacao({ tipo: proposta.tipo, pedido: proposta.pedido } as PedidoDaProposta, proposta.criada_por);
  if (podeAprovar(regra, { userId: q.userId, papel: q.papel }, proposta.criada_por)) {
    return { ok: false, codigo: "voce_aprova", mensagem: "Essa você mesma aprova: use Aprovar e aplicar." };
  }
  const candidatos = aQuemPedir(regra, q.equipe, proposta.criada_por);
  const para = (paraUserId ? candidatos.find((p) => p.user_id === paraUserId) : candidatos[0]) ?? null;
  if (!para) return { ok: false, codigo: "sem_quem_aprove", mensagem: `Ninguém na equipe aprova isso agora (${regra.rotulo}).` };

  const { pedido: _pedido, ...semPedido } = proposta;
  void _pedido;
  if (proposta.pedida_a === para.user_id) {
    return { ok: true, desfecho: "ja_estava", proposta: semPedido, para: { user_id: para.user_id, nome: para.nome } };
  }

  const agora = new Date().toISOString();
  const { data: gravada, error } = await q.admin
    .from("mia_assistente_propostas")
    .update({ pedida_a: para.user_id, pedida_em: agora })
    .eq("organization_id", q.orgId)
    .eq("id", propostaId)
    .eq("situacao", "pendente")
    .select(COLUNAS_DA_PROPOSTA);
  if (error) throw new Error(`não consegui registrar o pedido: ${error.message}`);
  const linha = (gravada ?? [])[0] as PropostaLida | undefined;
  if (!linha) return { ok: false, codigo: "ja_decidida", mensagem: "A proposta mudou enquanto você pedia. Recarregue." };

  const quem = q.nome?.trim() || "Alguém da equipe";
  await avisarNoSino(q.admin, {
    organizationId: q.orgId,
    paraUserId: para.user_id,
    titulo: `${quem} pediu pelo assistente: ${proposta.titulo}`,
    corpo: "O cartão está pronto: aprove, ajuste ou recuse no assistente. Nada muda antes disso.",
    refKind: "mia_assistente_proposta",
    refId: propostaId,
    push: { titulo: "Pedido pelo assistente", href: "/app/assistente?aba=propostas", tag: `mia-proposta-${propostaId}` },
  });
  void audit({
    action: "assistente.proposta_pedida",
    actorUserId: q.userId,
    organizationId: q.orgId,
    resourceType: "mia_assistente_propostas",
    resourceId: propostaId,
    requestId: q.requestId,
    metadata: { tipo: proposta.tipo, pedida_a: para.user_id, via_assistente: true },
  });
  return { ok: true, desfecho: "pedida", proposta: linha, para: { user_id: para.user_id, nome: para.nome } };
}

const FRASE_DO_RESULTADO = {
  aplicada: "Aplicado o que você pediu",
  rejeitada: "Recusado o que você pediu",
  desfeita: "Desfeito o que você pediu",
} as const;

/** O resultado volta para quem pediu, quando quem decidiu foi outra pessoa. Nunca lança. */
export async function avisarDoResultado(
  admin: SupabaseClient,
  entrada: {
    orgId: string;
    proposta: Pick<PropostaLida, "id" | "titulo" | "criada_por">;
    quemDecidiu: string;
    nomeDeQuemDecidiu?: string | null;
    desfecho: keyof typeof FRASE_DO_RESULTADO;
  },
): Promise<void> {
  const dona = entrada.proposta.criada_por;
  if (!dona || dona === entrada.quemDecidiu) return;
  await avisarNoSino(admin, {
    organizationId: entrada.orgId,
    paraUserId: dona,
    titulo: `${FRASE_DO_RESULTADO[entrada.desfecho]}: ${entrada.proposta.titulo}`,
    corpo: entrada.nomeDeQuemDecidiu ? `Por ${entrada.nomeDeQuemDecidiu}.` : null,
    refKind: "mia_assistente_proposta",
    refId: entrada.proposta.id,
  }).catch(() => false);
}

/**
 * FORK MIA (.94) — O CARTÃO de cada proposta, montado no SERVIDOR: os nomes de
 * quem pediu, de quem aprovou e de quem desfez, quem aprova aquele tipo, o que
 * a pessoa que olha pode fazer (aprovar, pedir, ajustar, desfazer) e, na
 * aplicada, o que trava o desfazer.
 *
 * A tela só desenha: permissão e trava não são decididas no navegador. O
 * `pedido` (o texto do agente proposto, por exemplo) não sai daqui.
 *
 * As listas da página do assistente (tela 3 do protótipo):
 *
 *   pedidos       as pendentes que alguém pediu e que esta pessoa aprova
 *                 ("Pedidos esperando você")
 *   meus_pedidos  as pendentes que esta pessoa fez e não aprova ("Seus pedidos")
 *   feitas        as aplicadas e as desfeitas ("O que o assistente fez")
 *   pendentes     as pendentes da empresa (o que a .91 já listava)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/auth/types";

import type { PessoaDaEquipe } from "../leituras/comum";
import { camposDeAjuste } from "./ajustar";
import { avisoDoConhecimento, CATALOGO_DAS_PECAS } from "./catalogo";
import { travaDoDesfazer } from "./desfazer";
import { aQuemPedir, podeAprovar, regraDeAprovacao } from "./quem-aprova";
import {
  COLUNAS_DA_PROPOSTA,
  type PedidoDaProposta,
  type PedidoDeItemDeConhecimento,
  type PropostaLida,
  type PropostaNoCartao,
} from "./tipos";

export const LISTAS_DE_PROPOSTAS = ["pedidos", "meus_pedidos", "feitas", "pendentes"] as const;
export type ListaDePropostas = (typeof LISTAS_DE_PROPOSTAS)[number];

export interface QuemOlha {
  /** A sessão de quem olha: a RLS da 9100 decide o que ela lê. */
  db: SupabaseClient;
  /** O cliente de serviço: só para contar a trava do desfazer (a empresa inteira). */
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  papel: Role;
  equipe: readonly PessoaDaEquipe[];
  fuso: string;
  /** A empresa deixa pedir com o cartão pronto. */
  podePedir: boolean;
}

type Linha = PropostaLida & { pedido: unknown };

/** O "Ver na tela" da peça aplicada, o mais perto possível dela. */
function hrefDaPeca(p: Linha): string {
  const base = CATALOGO_DAS_PECAS[p.tipo].href;
  const r = p.resultado ?? {};
  if (p.situacao !== "aplicada") return base;
  if ((p.tipo === "rascunho_de_followup" || p.tipo === "followup") && typeof r.fluxo_id === "string") return `/app/ai/followups/${r.fluxo_id}`;
  if (p.tipo === "agente" && typeof r.agente_id === "string") return `/app/ai/agents/${r.agente_id}`;
  return base;
}

export async function cartoesDasPropostas(q: QuemOlha, linhas: readonly Linha[]): Promise<PropostaNoCartao[]> {
  const nome = (id: string | null) => (id ? (q.equipe.find((p) => p.user_id === id)?.nome ?? "alguém que saiu da equipe") : null);
  return Promise.all(
    linhas.map(async (p): Promise<PropostaNoCartao> => {
      const regra = regraDeAprovacao({ tipo: p.tipo, pedido: p.pedido } as PedidoDaProposta, p.criada_por);
      const aprova = podeAprovar(regra, { userId: q.userId, papel: q.papel }, p.criada_por);
      const ehQuemPediu = p.criada_por === q.userId;
      const pendente = p.situacao === "pendente";
      const podeAjustar = pendente && (aprova || (ehQuemPediu && !p.pedida_em));
      const trava = p.situacao === "aplicada" ? await travaDoDesfazer(q.admin, q.orgId, p).catch(() => null) : null;
      const aviso =
        p.tipo === "conhecimento"
          ? avisoDoConhecimento(p.pedido as PedidoDeItemDeConhecimento)
          : CATALOGO_DAS_PECAS[p.tipo].aviso;
      const { pedido: _pedido, ...linha } = p;
      void _pedido;
      return {
        ...linha,
        quem_pediu: nome(p.criada_por),
        pedida_a_nome: nome(p.pedida_a),
        aprovada_por_nome: nome(p.aprovada_por),
        rejeitada_por_nome: nome(p.rejeitada_por),
        desfeita_por_nome: nome(p.desfeita_por),
        quem_aprova: regra.rotulo,
        pode_aprovar: aprova,
        pode_recusar: (pendente || p.situacao === "aprovada") && (aprova || ehQuemPediu),
        pode_pedir: pendente && ehQuemPediu && !aprova && q.podePedir,
        pedir_a: pendente && ehQuemPediu && !aprova ? aQuemPedir(regra, q.equipe, p.criada_por).map((x) => ({ user_id: x.user_id, nome: x.nome })) : [],
        pode_ajustar: podeAjustar,
        ajustes: podeAjustar
          ? await camposDeAjuste(p, { db: q.db, organizationId: q.orgId, fuso: q.fuso, equipe: q.equipe }).catch(() => [])
          : [],
        aviso,
        pode_desfazer: p.situacao === "aplicada" && aprova && !trava,
        trava_do_desfazer: trava,
        href: hrefDaPeca(p),
      };
    }),
  );
}

/** As propostas de uma lista, lidas pela SESSÃO de quem olha. */
export async function lerLista(
  q: QuemOlha,
  filtro: { ids?: readonly string[]; lista?: ListaDePropostas },
): Promise<PropostaNoCartao[] | null> {
  let consulta = q.db
    .from("mia_assistente_propostas")
    .select(`${COLUNAS_DA_PROPOSTA}, pedido`)
    .eq("organization_id", q.orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (filtro.ids && filtro.ids.length > 0) consulta = consulta.in("id", [...filtro.ids]);
  else if (filtro.lista === "feitas") consulta = consulta.in("situacao", ["aplicada", "desfeita"]);
  else if (filtro.lista === "meus_pedidos") consulta = consulta.eq("criada_por", q.userId).eq("situacao", "pendente");
  else if (filtro.lista === "pedidos") consulta = consulta.eq("situacao", "pendente").not("pedida_em", "is", null);
  else consulta = consulta.eq("situacao", "pendente");
  const { data, error } = await consulta;
  if (error) return null;
  let linhas = (data ?? []) as Linha[];
  if (filtro.lista === "feitas") {
    linhas = linhas.sort((a, b) => Date.parse(b.aplicada_em ?? b.created_at) - Date.parse(a.aplicada_em ?? a.created_at));
  }
  const cartoes = await cartoesDasPropostas(q, linhas);
  if (filtro.lista === "pedidos") return cartoes.filter((c) => c.pode_aprovar);
  if (filtro.lista === "meus_pedidos") return cartoes.filter((c) => !c.pode_aprovar);
  return cartoes;
}

/**
 * FORK MIA (.91) — DECIDIR uma proposta: aprovar e aplicar, ou rejeitar.
 *
 * Um caminho só para a rota da tela (`/api/v1/assistente/propostas/[id]`) e
 * para o MCP de plataforma (`plataforma_decidir_proposta_do_assistente`). Quem
 * chama já conferiu quem pode: aplicar é de administrador (a rota exige o
 * papel; no MCP, a operação `implantar_configuracao` do token). Aqui o cliente
 * é o de serviço, a organização vem de fonte confiável e entra em todo filtro.
 *
 * ── A ordem, e por que ela é do banco ───────────────────────────────────────
 *
 *   1. reivindicar: pendente → aprovada, com a condição `situacao = pendente`
 *      no próprio UPDATE (dois cliques ao mesmo tempo: um só aprova);
 *   2. aplicar a peça (`aplicarPeca`);
 *   3. aprovada → aplicada, com o resultado; se a peça falhou, a proposta
 *      continua APROVADA com o erro, e aplicar de novo retoma daqui.
 *
 * O gatilho da 9080 recusa pular o passo 1: nem este código consegue aplicar
 * uma proposta pendente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { aplicarPeca } from "./aplicar";
import { COLUNAS_DA_PROPOSTA, type PedidoDaProposta, type PropostaLida } from "./tipos";

export type DecisaoDaProposta = "aplicar" | "rejeitar";

export type DesfechoDaDecisao =
  | { ok: true; desfecho: "aplicada" | "rejeitada" | "ja_estava"; proposta: PropostaLida; avisos: string[] }
  | { ok: false; codigo: "nao_encontrada" | "ja_decidida" | "vencida" | "falhou"; mensagem: string; proposta?: PropostaLida };

interface Quem {
  admin: SupabaseClient;
  orgId: string;
  /** Quem decide: a pessoa da sessão, ou quem criou o token do MCP. */
  userId: string;
  requestId: string;
  via: "tela" | "mcp_plataforma";
}

async function ler(admin: SupabaseClient, orgId: string, id: string): Promise<(PropostaLida & { pedido: unknown }) | null> {
  const { data } = await admin
    .from("mia_assistente_propostas")
    .select(`${COLUNAS_DA_PROPOSTA}, pedido`)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as (PropostaLida & { pedido: unknown }) | null) ?? null;
}

function semPedido(p: PropostaLida & { pedido?: unknown }): PropostaLida {
  const { pedido: _pedido, ...resto } = p as PropostaLida & { pedido?: unknown };
  void _pedido;
  return resto;
}

export async function decidirProposta(quem: Quem, propostaId: string, decisao: DecisaoDaProposta): Promise<DesfechoDaDecisao> {
  const { admin, orgId } = quem;
  const proposta = await ler(admin, orgId, propostaId);
  if (!proposta) return { ok: false, codigo: "nao_encontrada", mensagem: "Proposta não encontrada nesta empresa." };

  if (proposta.situacao === "aplicada") {
    return decisao === "aplicar"
      ? { ok: true, desfecho: "ja_estava", proposta: semPedido(proposta), avisos: [] }
      : { ok: false, codigo: "ja_decidida", mensagem: "A proposta já foi aplicada e não pode mais ser recusada.", proposta: semPedido(proposta) };
  }
  if (proposta.situacao === "rejeitada" || proposta.situacao === "expirada") {
    return {
      ok: false,
      codigo: "ja_decidida",
      mensagem: proposta.situacao === "rejeitada" ? "A proposta já foi recusada. Peça de novo ao assistente." : "A proposta venceu. Peça de novo ao assistente.",
      proposta: semPedido(proposta),
    };
  }

  // ── rejeitar ──
  if (decisao === "rejeitar") {
    const { data, error } = await admin
      .from("mia_assistente_propostas")
      .update({ situacao: "rejeitada", rejeitada_por: quem.userId, rejeitada_em: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", propostaId)
      .in("situacao", ["pendente", "aprovada"])
      .select(COLUNAS_DA_PROPOSTA);
    if (error) throw new Error(`não consegui recusar a proposta: ${error.message}`);
    const linha = (data ?? [])[0] as PropostaLida | undefined;
    if (!linha) return { ok: false, codigo: "ja_decidida", mensagem: "A proposta mudou enquanto você decidia. Recarregue." };
    void audit({
      action: "assistente.proposta_rejeitada",
      actorUserId: quem.userId,
      organizationId: orgId,
      resourceType: "mia_assistente_propostas",
      resourceId: propostaId,
      requestId: quem.requestId,
      metadata: { tipo: linha.tipo, via: quem.via },
    });
    return { ok: true, desfecho: "rejeitada", proposta: linha, avisos: [] };
  }

  // ── aprovar (a reivindicação) ──
  if (proposta.situacao === "pendente") {
    if (Date.parse(proposta.expira_em) < Date.now()) {
      return { ok: false, codigo: "vencida", mensagem: "A proposta venceu. Peça de novo ao assistente.", proposta: semPedido(proposta) };
    }
    const { data, error } = await admin
      .from("mia_assistente_propostas")
      .update({ situacao: "aprovada", aprovada_por: quem.userId, aprovada_em: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", propostaId)
      .eq("situacao", "pendente")
      .select("id");
    if (error) throw new Error(`não consegui aprovar a proposta: ${error.message}`);
    if ((data ?? []).length === 0) {
      const agora = await ler(admin, orgId, propostaId);
      if (agora?.situacao === "aplicada") return { ok: true, desfecho: "ja_estava", proposta: semPedido(agora), avisos: [] };
      if (agora?.situacao !== "aprovada") {
        return { ok: false, codigo: "ja_decidida", mensagem: "A proposta mudou enquanto você decidia. Recarregue." };
      }
    }
  }

  // ── aplicar ──
  let resultado: Record<string, unknown>;
  let avisos: string[];
  try {
    const org = await organizacaoDaImplantacao(admin, orgId);
    const aplicada = await aplicarPeca(
      { admin, orgId, autorUserId: quem.userId, requestId: quem.requestId },
      org,
      { tipo: proposta.tipo, pedido: proposta.pedido } as PedidoDaProposta,
    );
    resultado = aplicada.resultado;
    avisos = aplicada.avisos;
  } catch (err) {
    const mensagem = err instanceof Recusa || err instanceof Error ? err.message : "não deu para aplicar agora";
    await admin
      .from("mia_assistente_propostas")
      .update({ erro: mensagem.slice(0, 1000) })
      .eq("organization_id", orgId)
      .eq("id", propostaId)
      .eq("situacao", "aprovada");
    void audit({
      action: "assistente.proposta_falhou",
      actorUserId: quem.userId,
      organizationId: orgId,
      resourceType: "mia_assistente_propostas",
      resourceId: propostaId,
      requestId: quem.requestId,
      metadata: { tipo: proposta.tipo, via: quem.via },
    });
    const depois = await ler(admin, orgId, propostaId);
    return { ok: false, codigo: "falhou", mensagem, ...(depois ? { proposta: semPedido(depois) } : {}) };
  }

  const { data: final, error: erroFinal } = await admin
    .from("mia_assistente_propostas")
    .update({ situacao: "aplicada", aplicada_por: quem.userId, aplicada_em: new Date().toISOString(), resultado, erro: null })
    .eq("organization_id", orgId)
    .eq("id", propostaId)
    .eq("situacao", "aprovada")
    .select(COLUNAS_DA_PROPOSTA);
  if (erroFinal) throw new Error(`a peça foi criada, mas não consegui marcar a proposta: ${erroFinal.message}`);
  const linha = ((final ?? [])[0] as PropostaLida | undefined) ?? semPedido({ ...proposta, situacao: "aplicada", resultado });

  void audit({
    action: "assistente.proposta_aplicada",
    actorUserId: quem.userId,
    organizationId: orgId,
    resourceType: "mia_assistente_propostas",
    resourceId: propostaId,
    requestId: quem.requestId,
    metadata: { tipo: proposta.tipo, via: quem.via, peca: resultado },
  });
  return { ok: true, desfecho: "aplicada", proposta: linha, avisos };
}

/**
 * FORK MIA (.91, .94) — DECIDIR uma proposta: aprovar e aplicar, ou rejeitar.
 *
 * Um caminho só para a rota da tela (`/api/v1/assistente/propostas/[id]`) e
 * para o MCP de plataforma (`plataforma_decidir_proposta_do_assistente`).
 *
 * ── Quem decide (.94) ───────────────────────────────────────────────────────
 *
 * Pelo cartão, aprova quem pode fazer o mesmo na tela (`quem-aprova.ts`): a
 * gestora aprova a etapa, a atendente aprova a resposta rápida dela, só o
 * administrador aprova a meta e as três peças do modelo. Recusar é de quem
 * aprova e de quem pediu (retirar o próprio pedido). Pelo MCP, a operação
 * `implantar_configuracao` do token já decidiu (`conferirQuem: false`).
 *
 * ── Com o login de quem aprova (.94) ────────────────────────────────────────
 *
 * As nove peças do dia a dia nascem com o cliente de quem aprovou (`db`, a
 * sessão no cartão), pela função da tela (`aplicar-do-dia-a-dia.ts`). As três
 * da .91 seguem pelo caminho da implantação, com o cliente de serviço, como
 * sempre foram (só o administrador as aprova).
 *
 * ── A ordem, e por que ela é do banco ───────────────────────────────────────
 *
 *   1. reivindicar: pendente → aprovada, com a condição `situacao = pendente`
 *      no próprio UPDATE (dois cliques ao mesmo tempo: um só aprova);
 *   2. aplicar a peça;
 *   3. aprovada → aplicada, com o resultado; se a peça falhou, a proposta
 *      continua APROVADA com o erro, e aplicar de novo retoma daqui.
 *
 * O gatilho da 9080/9100 recusa pular o passo 1: nem este código consegue
 * aplicar uma proposta pendente. O registro diz quem pediu, quem aprovou e por
 * onde ("via assistente"), e o resultado volta para quem pediu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { Role } from "@/lib/auth/types";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { aplicarPeca } from "./aplicar";
import { aplicarPecaDoDiaADia } from "./aplicar-do-dia-a-dia";
import { avisarDoResultado } from "./pedir";
import { podeAprovar, regraDeAprovacao } from "./quem-aprova";
import {
  COLUNAS_DA_PROPOSTA,
  TIPOS_DA_NOVENTA_E_UM,
  type PedidoDaProposta,
  type PropostaLida,
  type TipoDaNoventaEUm,
  type TipoDoDiaADia,
} from "./tipos";
import { conferirPedido } from "./validar";

export type DecisaoDaProposta = "aplicar" | "rejeitar";

export type DesfechoDaDecisao =
  | { ok: true; desfecho: "aplicada" | "rejeitada" | "ja_estava"; proposta: PropostaLida; avisos: string[] }
  | {
      ok: false;
      codigo: "nao_encontrada" | "ja_decidida" | "vencida" | "falhou" | "sem_permissao";
      mensagem: string;
      proposta?: PropostaLida;
    };

export interface QuemDecide {
  /** O cliente de serviço: a linha da proposta é escrita só pelo servidor (9080). */
  admin: SupabaseClient;
  /** O cliente com que a peça do dia a dia nasce: a sessão no cartão, o de serviço no MCP. */
  db?: SupabaseClient;
  /** `db` é a sessão de quem decide. */
  pelaSessao?: boolean;
  orgId: string;
  /** Quem decide: a pessoa da sessão, ou quem criou o token do MCP. */
  userId: string;
  /** O papel de quem decide (o do token do MCP vale como administrador). */
  papel?: Role;
  nome?: string | null;
  requestId: string;
  via: "tela" | "mcp_plataforma";
  /** Pelo cartão, confere quem aprova; pelo MCP, o token já decidiu. */
  conferirQuem?: boolean;
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

const ehDaNoventaEUm = (tipo: string): tipo is TipoDaNoventaEUm => (TIPOS_DA_NOVENTA_E_UM as readonly string[]).includes(tipo);

export async function decidirProposta(quem: QuemDecide, propostaId: string, decisao: DecisaoDaProposta): Promise<DesfechoDaDecisao> {
  const { admin, orgId } = quem;
  const papel: Role = quem.papel ?? "admin";
  const proposta = await ler(admin, orgId, propostaId);
  if (!proposta) return { ok: false, codigo: "nao_encontrada", mensagem: "Proposta não encontrada nesta empresa." };

  // ── quem decide ──
  const regra = regraDeAprovacao({ tipo: proposta.tipo, pedido: proposta.pedido } as PedidoDaProposta, proposta.criada_por);
  if (quem.conferirQuem) {
    const aprova = podeAprovar(regra, { userId: quem.userId, papel }, proposta.criada_por);
    const ehQuemPediu = proposta.criada_por === quem.userId;
    if (decisao === "aplicar" && !aprova) {
      return { ok: false, codigo: "sem_permissao", mensagem: `Quem aprova isto: ${regra.rotulo}. Você pode pedir a quem aprova.`, proposta: semPedido(proposta) };
    }
    if (decisao === "rejeitar" && !aprova && !ehQuemPediu) {
      return { ok: false, codigo: "sem_permissao", mensagem: `Quem recusa isto: ${regra.rotulo}, ou quem pediu.`, proposta: semPedido(proposta) };
    }
  }

  if (proposta.situacao === "aplicada") {
    return decisao === "aplicar"
      ? { ok: true, desfecho: "ja_estava", proposta: semPedido(proposta), avisos: [] }
      : { ok: false, codigo: "ja_decidida", mensagem: "A proposta já foi aplicada e não pode mais ser recusada. Ela pode ser desfeita.", proposta: semPedido(proposta) };
  }
  if (proposta.situacao === "rejeitada" || proposta.situacao === "expirada" || proposta.situacao === "desfeita") {
    const frase =
      proposta.situacao === "rejeitada"
        ? "A proposta já foi recusada. Peça de novo ao assistente."
        : proposta.situacao === "desfeita"
          ? "A proposta já foi aplicada e desfeita. Peça de novo ao assistente."
          : "A proposta venceu. Peça de novo ao assistente.";
    return { ok: false, codigo: "ja_decidida", mensagem: frase, proposta: semPedido(proposta) };
  }

  const registro = {
    tipo: proposta.tipo,
    via: quem.via,
    via_assistente: true,
    pedida_por: proposta.criada_por,
    pedida_a: proposta.pedida_a,
  };

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
      metadata: { ...registro, rejeitada_por: quem.userId },
    });
    await avisarDoResultado(admin, { orgId, proposta: linha, quemDecidiu: quem.userId, nomeDeQuemDecidiu: quem.nome ?? null, desfecho: "rejeitada" });
    return { ok: true, desfecho: "rejeitada", proposta: linha, avisos: [] };
  }

  // ── a forma do pedido, antes de reivindicar (as nove do dia a dia) ──
  let doDiaADia: Extract<PedidoDaProposta, { tipo: TipoDoDiaADia }> | null = null;
  if (!ehDaNoventaEUm(proposta.tipo)) {
    const conferido = conferirPedido(proposta.tipo, proposta.pedido);
    if (!conferido.ok) return { ok: false, codigo: "falhou", mensagem: conferido.mensagem, proposta: semPedido(proposta) };
    doDiaADia = conferido.proposta;
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
    if (doDiaADia) {
      const aplicada = await aplicarPecaDoDiaADia(
        {
          db: quem.db ?? admin,
          admin,
          pelaSessao: quem.pelaSessao === true,
          orgId,
          userId: quem.userId,
          papel,
          criadaPor: proposta.criada_por,
          requestId: quem.requestId,
          via: quem.via,
        },
        doDiaADia,
      );
      resultado = aplicada.resultado;
      avisos = aplicada.avisos;
    } else {
      const org = await organizacaoDaImplantacao(admin, orgId);
      const aplicada = await aplicarPeca(
        { admin, orgId, autorUserId: quem.userId, requestId: quem.requestId },
        org,
        { tipo: proposta.tipo, pedido: proposta.pedido } as Extract<PedidoDaProposta, { tipo: TipoDaNoventaEUm }>,
      );
      resultado = aplicada.resultado;
      avisos = aplicada.avisos;
    }
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
      metadata: registro,
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
    metadata: { ...registro, aprovada_por: quem.userId, peca: resultado },
  });
  await avisarDoResultado(admin, { orgId, proposta: linha, quemDecidiu: quem.userId, nomeDeQuemDecidiu: quem.nome ?? null, desfecho: "aplicada" });
  return { ok: true, desfecho: "aplicada", proposta: linha, avisos };
}

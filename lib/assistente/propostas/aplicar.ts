/**
 * FORK MIA (.91) — APLICAR uma proposta aprovada: é aqui, e só aqui, que a peça
 * nasce.
 *
 * Cada peça passa pelo caminho que a implantação já usa (`lib/implantacao/`,
 * o mesmo das ferramentas do MCP de plataforma, que reusam o caminho da tela):
 *
 *   agente     `garantirAgente`: o agente nasce em RASCUNHO, com o texto do
 *              modelo do segmento e autorizado no funil padrão. Sem agente
 *              padrão na empresa, ele vira o padrão (o mesmo que o passo
 *              "Treinar" do upstream monta), para o ensaio e o passo a passo
 *              o acharem
 *   funil      `garantirFunil` com o quadro pronto, adotando o funil que
 *              nasceu com a empresa (o de e-commerce) se ele não tem negócio.
 *              Ainda no passo a passo, o passo "Onde ele organiza" fica feito
 *   followup   `garantirFollowup` com o modelo do segmento, em rascunho, e
 *              `garantirAgente` arma o fluxo no rascunho do agente, com a janela
 *              de horário comercial. Ele sai junto com o agente publicado
 *              (`sai-com-o-agente.ts`)
 *
 * Nada aqui publica: publicar é clique humano.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { garantirAgente, lerAgentes, lerVersoes } from "@/lib/implantacao/agente";
import type { Implantacao, OrganizacaoDaImplantacao } from "@/lib/implantacao/base";
import { garantirFollowup } from "@/lib/implantacao/followup";
import { garantirFunil } from "@/lib/implantacao/funil";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { modeloDoSegmento } from "@/lib/onboarding/modelos-de-agente-da-mia";

import type { PedidoDaProposta } from "./tipos";

export interface PecaAplicada {
  resultado: Record<string, unknown>;
  avisos: string[];
}

async function funilPadrao(c: Implantacao): Promise<{ id: string; name: string } | null> {
  const { data } = await c.admin
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", c.orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

/**
 * Ainda no passo a passo, o funil aplicado pela proposta conta como o passo
 * "Onde ele organiza" (`onboarding_state.funil`, a mesma forma que o passo
 * grava): a pessoa não precisa montar de novo o que acabou de aprovar.
 */
async function marcarPassoDoFunil(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  funil: { pipelineId: string; etapas: number },
): Promise<void> {
  const { data } = await admin.from("organizations").select("onboarding_state, onboarded_at").eq("id", orgId).maybeSingle();
  const linha = data as { onboarding_state?: Record<string, unknown> | null; onboarded_at?: string | null } | null;
  if (!linha || linha.onboarded_at) return;
  const estado = linha.onboarding_state ?? {};
  if (estado.funil) return;
  await admin
    .from("organizations")
    .update({ onboarding_state: { ...estado, funil: { pipeline_id: funil.pipelineId, origem: "pacote", etapas: funil.etapas } } })
    .eq("id", orgId)
    .is("onboarded_at", null);
}

/** Uma etapa como o quadro do onboarding a grava (`fn_aplicar_quadro_do_onboarding`). */
export interface EtapaDoRetrato {
  nome: string;
  slug: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  agent_stage_hint: string | null;
}

/**
 * FORK MIA (.94): o funil padrão que o quadro pronto vai adotar (nenhum funil
 * tem o nome pedido), com as etapas ativas. `null` quando nada será adotado.
 */
async function retratoDoFunilAdotado(
  c: Implantacao,
  nomePedido: string,
): Promise<{ id: string; nome: string; slug: string; etapas: EtapaDoRetrato[] } | null> {
  const { data: funis } = await c.admin
    .from("crm_pipelines")
    .select("id, name, slug, is_default")
    .eq("organization_id", c.orgId)
    .eq("is_archived", false);
  const lista = (funis ?? []) as Array<{ id: string; name: string; slug: string; is_default: boolean }>;
  const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (lista.some((f) => chave(f.name) === chave(nomePedido))) return null;
  const padrao = lista.find((f) => f.is_default);
  if (!padrao) return null;
  const { data: etapas } = await c.admin
    .from("crm_stages")
    .select("name, slug, position, is_won, is_lost, agent_stage_hint")
    .eq("organization_id", c.orgId)
    .eq("pipeline_id", padrao.id)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  return {
    id: padrao.id,
    nome: padrao.name,
    slug: padrao.slug,
    etapas: ((etapas ?? []) as Array<Record<string, unknown>>).map((e) => ({
      nome: String(e.name),
      slug: String(e.slug),
      position: Number(e.position),
      is_won: e.is_won === true,
      is_lost: e.is_lost === true,
      agent_stage_hint: typeof e.agent_stage_hint === "string" ? e.agent_stage_hint : null,
    })),
  };
}

export async function aplicarPeca(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  proposta: Extract<PedidoDaProposta, { tipo: "agente" | "funil" | "followup" }>,
): Promise<PecaAplicada> {
  if (proposta.tipo === "agente") {
    const p = proposta.pedido;
    const funil = await funilPadrao(c);
    const g = await garantirAgente(c, org, {
      nome: p.nome,
      descricao: `Agente do modelo de ${modeloDoSegmento(p.segmento).curto}, preparado pelo assistente da MIA.`,
      prompt: p.prompt,
      ...(funil ? { funis: [funil.id] } : {}),
    });
    const { count } = await c.admin
      .from("ai_agents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", c.orgId)
      .eq("is_default", true);
    if (!count) {
      await c.admin.from("ai_agents").update({ is_default: true }).eq("id", g.agente.id).eq("organization_id", c.orgId);
    }
    return {
      resultado: { agente_id: g.agente.id, agente_nome: g.agente.nome, versao_id: g.versao.id },
      avisos: g.avisos,
    };
  }

  if (proposta.tipo === "funil") {
    const p = proposta.pedido;
    // FORK MIA (.94): o retrato do funil que o quadro pronto vai ADOTAR, antes
    // de trocar as etapas. É ele que o desfazer devolve (`desfazer.ts`).
    const antes = await retratoDoFunilAdotado(c, p.nome);
    const g = await garantirFunil(c, { nome: p.nome, etapas: p.etapas, adotar_funil_padrao: true, padrao: true });
    await marcarPassoDoFunil(c.admin as ReturnType<typeof createAdminClient>, c.orgId, {
      pipelineId: g.funil.id,
      etapas: g.etapas.length,
    });
    return {
      resultado: {
        funil_id: g.funil.id,
        funil_nome: g.funil.nome,
        ...(antes && antes.id === g.funil.id ? { antes: { nome: antes.nome, slug: antes.slug, etapas: antes.etapas } } : {}),
      },
      avisos: g.avisos,
    };
  }

  const p = proposta.pedido;
  const agentes = await lerAgentes(c.admin, c.orgId);
  const agente = agentes.find((a) => a.id === p.agente_id && !a.archived_at);
  if (!agente) throw new Recusa("O agente desta proposta não existe mais. Peça a proposta de novo.");

  let etapa: { funil: string; etapa: string } | undefined;
  if (p.passo) {
    const funil = await funilPadrao(c);
    const { data } = funil
      ? await c.admin
          .from("crm_stages")
          .select("name")
          .eq("organization_id", c.orgId)
          .eq("pipeline_id", funil.id)
          .eq("agent_stage_hint", p.passo)
          .eq("is_archived", false)
          .limit(1)
          .maybeSingle()
      : { data: null };
    const nomeDaEtapa = (data as { name?: string } | null)?.name;
    if (!funil || !nomeDaEtapa) {
      throw new Recusa(
        "Este follow-up dispara por etapa do funil, e o funil padrão ainda não tem a etapa dele. Aprove antes o funil do quadro pronto.",
      );
    }
    etapa = { funil: funil.name, etapa: nomeDaEtapa };
  }

  const fu = await garantirFollowup(c, { modelo: p.modelo, nome: p.nome, ...(etapa ? { etapa } : {}) });

  // Arma no rascunho do agente, sem tirar os fluxos que ele já tinha.
  const versoes = await lerVersoes(c.admin, c.orgId, agente.id);
  const base = escolherVersoesDaTela(versoes, agente.published_version_id).base as { followup?: { flow_pointer_ids?: string[] } | null } | null;
  const jaArmados = base?.followup?.flow_pointer_ids ?? [];
  const g = await garantirAgente(c, org, {
    nome: agente.name,
    agente_id: agente.id,
    followups: { fluxos: [...new Set([...jaArmados, fu.fluxo.id])], janela: p.janela },
  });
  return {
    resultado: { fluxo_id: fu.fluxo.id, fluxo_nome: fu.fluxo.nome, agente_id: agente.id, versao_id: g.versao.id },
    avisos: [...fu.avisos, ...g.avisos],
  };
}

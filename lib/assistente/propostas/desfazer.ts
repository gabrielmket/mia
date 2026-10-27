/**
 * FORK MIA (.94) — DESFAZER uma proposta aplicada (protótipo "ensina e faz",
 * tela 3, decisões 4 e 6).
 *
 * ── Desfazer não é apagar ───────────────────────────────────────────────────
 *
 * Desfaz só o que a PRÓPRIA proposta fez, e só enquanto nada depende disso. A
 * trava é o USO, sem prazo (decisão 4): prazo fixo travaria um desfazer seguro
 * e liberaria um perigoso.
 *
 *   etapa_criar            a etapa está vazia (nenhum negócio, nenhuma entrada
 *                          automática): ela é ARQUIVADA, como a tela faz
 *   etapa_renomear         ninguém renomeou de novo: volta o nome antigo
 *   resposta               ninguém editou: sai
 *   etiqueta               nenhum contato, negócio ou conversa a tem: sai do
 *                          vocabulário
 *   tarefa                 não foi concluída nem cancelada: sai
 *   rascunho_de_followup   continua rascunho, sem ninguém na régua e sem agente
 *                          que o arme: sai
 *   conhecimento           sempre: o item sai do material (o material novo,
 *                          vazio, é arquivado); se alguém mudou o item, trava
 *   relatorio              não está em painel nenhum: sai
 *   meta                   ninguém mudou a meta: volta a anterior
 *   agente (.91)           nunca foi publicado e nenhum follow-up proposto
 *                          depende dele: é arquivado, e o nome fica livre
 *   funil (.91)            nenhum negócio entrou: o funil volta ao quadro que
 *                          tinha antes
 *   followup (.91)         não saiu com o agente publicado: sai do rascunho do
 *                          agente e é apagado
 *
 * Um caminho só para o botão do cartão e para o MCP
 * (`plataforma_desfazer_proposta_do_assistente`), com as mesmas travas.
 * Desfazer de novo devolve `ja_estava`. A peça que já não estava lá (alguém a
 * tirou pela tela) também deixa a proposta desfeita, com o aviso.
 *
 * Pelo cartão, o desfazer usa o login de quem desfaz (a mesma função da tela);
 * as travas são contadas pelo servidor, que enxerga a empresa inteira. As peças
 * da .91 seguem pelo caminho da implantação, como o aplicar delas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import type { Role } from "@/lib/auth/types";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { garantirAgente, lerVersoes } from "@/lib/implantacao/agente";
import { chaveDoNome, mudarSettingsDaOrganizacao, organizacaoDaImplantacao } from "@/lib/implantacao/base";
import { garantirConhecimento } from "@/lib/implantacao/conhecimento";
import { arquivarEtapa, atualizarEtapa, type DepsDeEtapa } from "@/lib/leads/stage-operations";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { gravarMeta } from "@/lib/crm/metas/gravar";
import { apagarRelatorio, RelatorioRecusado } from "@/lib/relatorios/servidor";
import type { createAdminClient } from "@/lib/supabase/admin";
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";

import type { EtapaDoRetrato } from "./aplicar";
import { avisarDoResultado } from "./pedir";
import { podeAprovar, regraDeAprovacao } from "./quem-aprova";
import { COLUNAS_DA_PROPOSTA, type PedidoDaProposta, type PropostaLida, type TravaDoDesfazer } from "./tipos";

export interface QuemDesfaz {
  /** A sessão de quem desfaz (cartão) ou o cliente de serviço (MCP). */
  db: SupabaseClient;
  admin: SupabaseClient;
  pelaSessao: boolean;
  orgId: string;
  userId: string;
  /** O nome de quem desfaz, para o aviso a quem pediu. */
  nome?: string | null;
  papel: Role;
  requestId: string;
  via: "tela" | "mcp_plataforma";
}

export type DesfechoDoDesfazer =
  | { ok: true; desfecho: "desfeita" | "ja_estava"; proposta: PropostaLida; avisos: string[] }
  | {
      ok: false;
      codigo: "nao_encontrada" | "nao_aplicada" | "travada" | "sem_permissao" | "falhou";
      mensagem: string;
      proposta?: PropostaLida;
    };

/** O quadro que nasce com toda empresa (`fn_seed_default_pipeline_for_org`). */
export const QUADRO_SEMEADO: { nome: string; slug: string; etapas: EtapaDoRetrato[] } = {
  nome: "Pedidos",
  slug: "pedidos",
  etapas: [
    ["Carrinho abandonado", "carrinho_abandonado", false, false],
    ["Aguardando pagamento", "aguardando_pagamento", false, false],
    ["Pago", "pago", true, false],
    ["Em separação", "em_separacao", false, false],
    ["Enviado", "enviado", false, false],
    ["Entregue", "entregue", false, false],
    ["Pós-venda", "pos_venda", false, false],
    ["Cancelado", "cancelado", false, true],
  ].map(([nome, slug, ganho, perda], i) => ({
    nome: nome as string,
    slug: slug as string,
    position: (i + 1) * 1000,
    is_won: ganho as boolean,
    is_lost: perda as boolean,
    agent_stage_hint: null,
  })),
};

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** As linhas de uma tabela da empresa que casam com o filtro. */
async function quantos(admin: SupabaseClient, tabela: string, orgId: string, coluna: string, valor: string): Promise<number> {
  const { count } = await admin.from(tabela).select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq(coluna, valor);
  return count ?? 0;
}

/** As linhas com a etiqueta (`text[]`), na grafia gravada e na minúscula. */
async function usoDaEtiqueta(admin: SupabaseClient, orgId: string, nome: string): Promise<number> {
  let total = 0;
  for (const tabela of ["contacts", "crm_leads", "conversations"]) {
    for (const grafia of [...new Set([nome, nome.toLowerCase()])]) {
      const { count } = await admin.from(tabela).select("id", { count: "exact", head: true }).eq("organization_id", orgId).contains("tags", [grafia]);
      total += count ?? 0;
    }
  }
  return total;
}

type Resultado = Record<string, unknown>;
const texto = (r: Resultado | null, k: string): string | null => (typeof r?.[k] === "string" ? (r[k] as string) : null);

/**
 * O que trava o desfazer desta proposta aplicada, AGORA. `null` = dá para
 * desfazer. Sempre com o cliente de serviço: a contagem é da empresa inteira,
 * não do que a pessoa vê (um negócio que ela não enxerga também trava a etapa).
 */
export async function travaDoDesfazer(
  admin: SupabaseClient,
  orgId: string,
  proposta: Pick<PropostaLida, "tipo" | "resultado" | "saiu_com_o_agente_em"> & { pedido?: unknown },
): Promise<TravaDoDesfazer | null> {
  const r = proposta.resultado;
  switch (proposta.tipo) {
    case "etapa_criar": {
      const etapa = texto(r, "etapa_id");
      if (!etapa) return null;
      const negocios = await quantos(admin, "crm_leads", orgId, "stage_id", etapa);
      if (negocios > 0) {
        return {
          motivo: `${negocios} ${plural(negocios, "negócio já está", "negócios já estão")} nesta etapa. Para tirar a etapa, mova ${plural(negocios, "o negócio", "os negócios")} e use Etapas do funil.`,
        };
      }
      const entradas = await quantos(admin, "webhook_sources", orgId, "default_stage_id", etapa);
      if (entradas > 0) return { motivo: "Uma entrada automática de leads cai nesta etapa. Aponte a entrada para outra etapa antes, em Entradas automáticas." };
      const { data } = await admin.from("crm_stages").select("is_won, is_lost").eq("organization_id", orgId).eq("id", etapa).maybeSingle();
      const e = data as { is_won: boolean; is_lost: boolean } | null;
      if (e && (e.is_won || e.is_lost)) return { motivo: "A etapa virou a de ganho ou a de perda pela tela. Mudar isso é em Etapas do funil." };
      return null;
    }
    case "etapa_renomear": {
      const etapa = texto(r, "etapa_id");
      if (!etapa) return null;
      const { data } = await admin.from("crm_stages").select("name, is_archived").eq("organization_id", orgId).eq("id", etapa).maybeSingle();
      const e = data as { name: string; is_archived: boolean } | null;
      if (!e || e.is_archived) return null;
      if (chaveDoNome(e.name) !== chaveDoNome(texto(r, "para") ?? "")) {
        return { motivo: "Alguém já mudou o nome de novo pela tela. O nome de agora é o que vale." };
      }
      return null;
    }
    case "resposta": {
      const id = texto(r, "resposta_id");
      if (!id) return null;
      const { data } = await admin.from("message_templates").select("updated_at").eq("organization_id", orgId).eq("id", id).maybeSingle();
      const t = data as { updated_at: string } | null;
      if (t && texto(r, "atualizada_em") && Date.parse(t.updated_at) !== Date.parse(texto(r, "atualizada_em")!)) {
        return { motivo: "Alguém já editou a resposta pela tela. Para tirar, use Respostas rápidas." };
      }
      return null;
    }
    case "etiqueta": {
      const nome = texto(r, "etiqueta");
      if (!nome) return null;
      const uso = await usoDaEtiqueta(admin, orgId, nome);
      if (uso > 0) {
        return {
          motivo: `${uso} ${plural(uso, "contato, negócio ou conversa já tem", "contatos, negócios ou conversas já têm")} a etiqueta. Tirar a etiqueta deles é pela tela, um a um ou pelo filtro.`,
        };
      }
      return null;
    }
    case "tarefa": {
      const id = texto(r, "tarefa_id");
      if (!id) return null;
      const { data } = await admin.from("crm_tasks").select("status").eq("organization_id", orgId).eq("id", id).maybeSingle();
      const t = data as { status: string } | null;
      if (t?.status === "done") return { motivo: "A tarefa já foi concluída. Ela fica no histórico." };
      if (t?.status === "cancelled") return { motivo: "A tarefa já foi cancelada pela tela. Ela fica no histórico." };
      return null;
    }
    case "rascunho_de_followup":
    case "followup": {
      const id = texto(r, "fluxo_id");
      if (!id) return null;
      if (proposta.tipo === "followup" && proposta.saiu_com_o_agente_em) {
        return { motivo: "Ele já saiu junto com o agente publicado. Para parar, use Follow-ups." };
      }
      const { data } = await admin
        .from("followup_flow_pointers")
        .select("status, active_version_id")
        .eq("organization_id", orgId)
        .eq("id", id)
        .maybeSingle();
      const f = data as { status: string; active_version_id: string | null } | null;
      if (!f) return null;
      if (f.status !== "draft" || f.active_version_id) return { motivo: "O follow-up foi publicado pela tela. Para parar, use Follow-ups." };
      const inscritos = await quantos(admin, "followup_enrollments", orgId, "pointer_id", id);
      if (inscritos > 0) return { motivo: "Já há pessoas na régua deste follow-up. Para parar, use Follow-ups." };
      const { data: versoes } = await admin
        .from("ai_agent_versions")
        .select("followup")
        .eq("organization_id", orgId)
        .eq("status", "published")
        .limit(100);
      const armado = ((versoes ?? []) as Array<{ followup?: { flow_pointer_ids?: string[] } | null }>).some((v) =>
        (v.followup?.flow_pointer_ids ?? []).includes(id),
      );
      if (armado) return { motivo: "Um agente no ar já arma este follow-up. Para parar, use Follow-ups e Agentes." };
      if (proposta.tipo === "rascunho_de_followup") {
        const { data: rascunhos } = await admin
          .from("ai_agent_versions")
          .select("followup")
          .eq("organization_id", orgId)
          .eq("status", "draft")
          .limit(100);
        const noRascunho = ((rascunhos ?? []) as Array<{ followup?: { flow_pointer_ids?: string[] } | null }>).some((v) =>
          (v.followup?.flow_pointer_ids ?? []).includes(id),
        );
        if (noRascunho) return { motivo: "Alguém já ligou este follow-up num agente. Tire do agente antes, em Agentes." };
      }
      return null;
    }
    case "conhecimento": {
      const material = texto(r, "material_id");
      if (!material) return null;
      const { data } = await admin
        .from("ai_faq_items")
        .select("question, answer")
        .eq("organization_id", orgId)
        .eq("knowledge_source_id", material)
        .limit(500);
      const item = ((data ?? []) as Array<{ question: string; answer: string }>).find(
        (i) => chaveDoNome(i.question) === chaveDoNome(texto(r, "pergunta") ?? ""),
      );
      if (item && item.answer.trim() !== (texto(r, "resposta") ?? "").trim()) {
        return { motivo: "Alguém já mudou o item pela tela. Para tirar, use Conhecimento." };
      }
      return null;
    }
    case "relatorio": {
      const id = texto(r, "relatorio_id");
      if (!id) return null;
      const paineis = await quantos(admin, "mia_paineis_usuario_itens", orgId, "relatorio_id", id);
      if (paineis > 0) return { motivo: "O relatório já está num painel. Para tirar, tire do painel primeiro, em Painéis." };
      return null;
    }
    case "meta": {
      const mes = texto(r, "mes");
      if (!mes) return null;
      const { data } = await admin
        .from("sales_targets")
        .select("alvo_cents")
        .eq("organization_id", orgId)
        .eq("periodo", `${mes}-01`)
        .eq("metrica", "receita_total")
        .is("user_id", null)
        .is("agent_id", null)
        .maybeSingle();
      const atual = (data as { alvo_cents?: number | string | null } | null)?.alvo_cents;
      if (atual !== null && atual !== undefined && Number(atual) !== Number(r?.valor_cents)) {
        return { motivo: "Alguém já mudou a meta pela tela. A de agora é a que vale." };
      }
      return null;
    }
    case "agente": {
      const id = texto(r, "agente_id");
      if (!id) return null;
      const { data } = await admin
        .from("ai_agents")
        .select("published_version_id, archived_at")
        .eq("organization_id", orgId)
        .eq("id", id)
        .maybeSingle();
      const a = data as { published_version_id: string | null; archived_at: string | null } | null;
      if (!a || a.archived_at) return null;
      const { count: publicadas } = await admin
        .from("ai_agent_versions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("agent_id", id)
        .or("status.in.(published,superseded),published_at.not.is.null");
      if (a.published_version_id || (publicadas ?? 0) > 0) {
        return { motivo: "Ele já foi publicado. Para tirar do ar, use Agentes." };
      }
      const { data: followups } = await admin
        .from("mia_assistente_propostas")
        .select("resultado")
        .eq("organization_id", orgId)
        .eq("tipo", "followup")
        .eq("situacao", "aplicada")
        .limit(20);
      const depende = ((followups ?? []) as Array<{ resultado: Resultado | null }>).some((f) => texto(f.resultado, "agente_id") === id);
      if (depende) return { motivo: "O follow-up do modelo depende dele. Desfaça o follow-up antes." };
      return null;
    }
    case "funil": {
      const id = texto(r, "funil_id");
      if (!id) return null;
      const negocios = await quantos(admin, "crm_leads", orgId, "pipeline_id", id);
      if (negocios > 0) {
        return {
          motivo: `${negocios} ${plural(negocios, "negócio já entrou", "negócios já entraram")} neste funil. Mudar as etapas agora é em Etapas do funil.`,
        };
      }
      const { data: etapas } = await admin.from("crm_stages").select("id").eq("organization_id", orgId).eq("pipeline_id", id);
      const ids = ((etapas ?? []) as Array<{ id: string }>).map((e) => e.id);
      if (ids.length > 0) {
        const { count } = await admin
          .from("webhook_sources")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("default_stage_id", ids);
        if ((count ?? 0) > 0) return { motivo: "Uma entrada automática de leads cai neste funil. Aponte a entrada para outro funil antes." };
      }
      return null;
    }
  }
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

function depsDeEtapa(q: QuemDesfaz): DepsDeEtapa {
  return { supabase: q.db, organizationId: q.orgId, actor: { type: "user", id: q.userId, role: q.papel }, requestId: q.requestId };
}

/** Tira a peça. Devolve os avisos; lança `Recusa` com a frase quando não dá. */
async function tirarPeca(q: QuemDesfaz, proposta: PropostaLida & { pedido: unknown }): Promise<string[]> {
  const r = proposta.resultado ?? {};
  const avisos: string[] = [];
  const naoEstava = () => avisos.push("A peça já não estava lá: alguém a tirou pela tela. A proposta fica desfeita.");

  switch (proposta.tipo) {
    case "etapa_criar": {
      const etapa = texto(r, "etapa_id")!;
      const funil = texto(r, "funil_id")!;
      const { data } = await q.admin.from("crm_stages").select("is_archived").eq("organization_id", q.orgId).eq("id", etapa).maybeSingle();
      if (!data || (data as { is_archived: boolean }).is_archived) {
        naoEstava();
        return avisos;
      }
      await arquivarEtapa(depsDeEtapa(q), { pipelineId: funil, stageId: etapa, destinoId: null });
      return avisos;
    }
    case "etapa_renomear": {
      const { data } = await q.admin
        .from("crm_stages")
        .select("is_archived")
        .eq("organization_id", q.orgId)
        .eq("id", texto(r, "etapa_id")!)
        .maybeSingle();
      if (!data || (data as { is_archived: boolean }).is_archived) {
        naoEstava();
        return avisos;
      }
      await atualizarEtapa(depsDeEtapa(q), { pipelineId: texto(r, "funil_id")!, stageId: texto(r, "etapa_id")!, pedido: { name: texto(r, "de")! } });
      return avisos;
    }
    case "resposta": {
      const respostaId = texto(r, "resposta_id")!;
      const { data, error } = await q.db
        .from("message_templates")
        .delete()
        .eq("organization_id", q.orgId)
        .eq("id", respostaId)
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "42501") throw new Recusa("O seu papel não apaga essa resposta.");
        throw new Error(`não consegui tirar a resposta: ${error.message}`);
      }
      if (!data) {
        const { data: ainda } = await q.admin.from("message_templates").select("id").eq("organization_id", q.orgId).eq("id", texto(r, "resposta_id")!).maybeSingle();
        if (ainda) throw new Recusa("Essa resposta é de outra pessoa: só a dona tira.");
        naoEstava();
        return avisos;
      }
      void audit({
        action: "template.deleted",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "message_template",
        resourceId: respostaId,
        requestId: q.requestId,
        metadata: { via: "assistente" },
      });
      return avisos;
    }
    case "etiqueta": {
      const nome = texto(r, "etiqueta")!;
      if (q.pelaSessao) {
        const { error } = await q.db.rpc("fn_vocabulario_de_tags_operar", {
          p_org: q.orgId,
          p_acao: "excluir",
          p_tag: nome,
          p_destino: null,
          p_cor: null,
        });
        if (error) {
          if (error.code === "42501") throw new Recusa("O seu papel não tira etiqueta.");
          throw new Error(`não consegui tirar a etiqueta: ${error.message}`);
        }
      } else {
        await mudarSettingsDaOrganizacao(q.admin as ReturnType<typeof createAdminClient>, q.orgId, (settings) => {
          const lista = Array.isArray(settings.tags) ? (settings.tags as unknown[]) : [];
          const sobra = lista.filter((x) => {
            const n = typeof x === "string" ? x : typeof x === "object" && x !== null ? String((x as { tag?: unknown }).tag ?? "") : "";
            return chaveDaEtiqueta(n) !== chaveDaEtiqueta(nome);
          });
          return sobra.length === lista.length ? null : { ...settings, tags: sobra };
        });
      }
      void audit({
        action: "tag_vocabulary.changed",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "organization",
        resourceId: q.orgId,
        requestId: q.requestId,
        metadata: { acao: "excluir", tag: nome, via: "assistente" },
      });
      return avisos;
    }
    case "tarefa": {
      const tarefaId = texto(r, "tarefa_id")!;
      const { data, error } = await q.db
        .from("crm_tasks")
        .delete()
        .eq("organization_id", q.orgId)
        .eq("id", tarefaId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`não consegui tirar a tarefa: ${error.message}`);
      if (!data) {
        naoEstava();
        return avisos;
      }
      void audit({
        action: "crm_task.deleted",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "crm_task",
        resourceId: tarefaId,
        requestId: q.requestId,
        metadata: { via: "assistente" },
      });
      return avisos;
    }
    case "rascunho_de_followup":
    case "followup": {
      const fluxoId = texto(r, "fluxo_id")!;
      const fluxo = fluxoId;
      // O follow-up do modelo (.91) está armado no rascunho do agente: sai de lá antes.
      if (proposta.tipo === "followup") {
        const agenteId = texto(r, "agente_id");
        if (agenteId) {
          const { data: agente } = await q.admin
            .from("ai_agents")
            .select("id, name, published_version_id, archived_at")
            .eq("organization_id", q.orgId)
            .eq("id", agenteId)
            .maybeSingle();
          const a = agente as { id: string; name: string; published_version_id: string | null; archived_at: string | null } | null;
          if (a && !a.archived_at) {
            const versoes = await lerVersoes(q.admin, q.orgId, a.id);
            const base = escolherVersoesDaTela(versoes, a.published_version_id).base as { followup?: { flow_pointer_ids?: string[] } | null } | null;
            const armados = base?.followup?.flow_pointer_ids ?? [];
            if (armados.includes(fluxo)) {
              const org = await organizacaoDaImplantacao(q.admin, q.orgId);
              await garantirAgente({ admin: q.admin, orgId: q.orgId, autorUserId: q.userId, requestId: q.requestId }, org, {
                nome: a.name,
                agente_id: a.id,
                followups: { fluxos: armados.filter((x) => x !== fluxo) },
              });
            }
          }
        }
      }
      const cliente = proposta.tipo === "followup" ? q.admin : q.db;
      const { data: existe } = await q.admin.from("followup_flow_pointers").select("id").eq("organization_id", q.orgId).eq("id", fluxo).maybeSingle();
      if (!existe) {
        naoEstava();
        return avisos;
      }
      // O mesmo caminho do DELETE da tela (`/api/v1/ai/followup-flows/[id]`).
      for (const passo of [
        () => cliente.from("followup_enrollments").delete().eq("pointer_id", fluxo).eq("organization_id", q.orgId),
        () => cliente.from("followup_flow_pointers").update({ active_version_id: null, updated_at: new Date().toISOString() }).eq("id", fluxo).eq("organization_id", q.orgId),
        () => cliente.from("followup_flow_versions").delete().eq("pointer_id", fluxo).eq("organization_id", q.orgId),
        () => cliente.from("followup_flow_pointers").delete().eq("id", fluxo).eq("organization_id", q.orgId),
      ]) {
        const { error } = await passo();
        if (error) {
          if (error.code === "42501") throw new Recusa("O seu papel não tira follow-up.");
          throw new Error(`não consegui tirar o follow-up: ${error.message}`);
        }
      }
      void audit({
        action: "followup_flow.deleted",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "followup_flow_pointer",
        resourceId: fluxoId,
        requestId: q.requestId,
        metadata: { via: "assistente" },
      });
      return avisos;
    }
    case "conhecimento": {
      const material = texto(r, "material_id")!;
      const { data: m } = await q.admin
        .from("ai_knowledge_sources")
        .select("id, name, is_active")
        .eq("organization_id", q.orgId)
        .eq("id", material)
        .maybeSingle();
      const lido = m as { id: string; name: string; is_active: boolean } | null;
      if (!lido || !lido.is_active) {
        naoEstava();
        return avisos;
      }
      const { data: itens } = await q.admin
        .from("ai_faq_items")
        .select("question, answer, tags, position")
        .eq("organization_id", q.orgId)
        .eq("knowledge_source_id", material)
        .order("position", { ascending: true });
      const todos = (itens ?? []) as Array<{ question: string; answer: string; tags: string[] | null }>;
      const sobra = todos.filter((i) => chaveDoNome(i.question) !== chaveDoNome(texto(r, "pergunta") ?? ""));
      if (sobra.length === todos.length) {
        naoEstava();
        return avisos;
      }
      if (sobra.length === 0) {
        // O material ficou vazio: é arquivado, como o "Arquivar" da tela, e sai da busca na hora.
        const { error } = await q.admin
          .from("ai_knowledge_sources")
          .update({ status: "archived", is_active: false })
          .eq("organization_id", q.orgId)
          .eq("id", material);
        if (error) throw new Error(`não consegui arquivar o material: ${error.message}`);
      } else {
        await garantirConhecimento(
          { admin: q.admin, orgId: q.orgId, autorUserId: q.userId, requestId: q.requestId },
          { nome: lido.name, tipo: "faq", perguntas: sobra.map((i) => ({ pergunta: i.question, resposta: i.answer, etiquetas: i.tags ?? [] })) },
        );
        avisos.push("O item saiu do material. A busca do agente para de achá-lo assim que a reindexação termina, em instantes.");
      }
      return avisos;
    }
    case "relatorio": {
      const id = texto(r, "relatorio_id")!;
      const { data } = await q.admin.from("mia_relatorios").select("id").eq("organization_id", q.orgId).eq("id", id).maybeSingle();
      if (!data) {
        naoEstava();
        return avisos;
      }
      await apagarRelatorio(q.db, { organizationId: q.orgId, userId: q.userId, requestId: q.requestId, via: q.via }, id);
      return avisos;
    }
    case "meta": {
      const mes = texto(r, "mes")!;
      const antes = r.antes_cents === null || r.antes_cents === undefined ? null : Number(r.antes_cents);
      if (antes === null) {
        const { error } = await q.db
          .from("sales_targets")
          .delete()
          .eq("organization_id", q.orgId)
          .eq("periodo", `${mes}-01`)
          .eq("metrica", "receita_total")
          .is("user_id", null)
          .is("agent_id", null);
        if (error) {
          if (error.code === "42501") throw new Recusa("O seu papel não muda a meta.");
          throw new Error(`não consegui tirar a meta: ${error.message}`);
        }
      } else {
        const { error } = await gravarMeta(q.db, {
          organizationId: q.orgId,
          periodo: mes,
          metrica: "receita_total",
          alvo_cents: antes,
          created_by: q.userId,
        });
        if (error) throw new Error(`não consegui voltar a meta: ${error.message}`);
      }
      void audit({
        action: "org.updated",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "organization",
        resourceId: q.orgId,
        requestId: q.requestId,
        metadata: { fields_changed: ["meta_do_mes"], mes, desfeita: true, via: "assistente" },
      });
      return avisos;
    }
    case "agente": {
      const id = texto(r, "agente_id")!;
      const { data } = await q.admin.from("ai_agents").select("name, archived_at").eq("organization_id", q.orgId).eq("id", id).maybeSingle();
      const a = data as { name: string; archived_at: string | null } | null;
      if (!a || a.archived_at) {
        naoEstava();
        return avisos;
      }
      // Arquivar, como a tela. O nome ganha a marca do desfazer para ficar
      // livre: `garantirAgente` recusa reaproveitar o nome de um arquivado.
      const marca = new Date().toISOString().slice(0, 16).replace("T", " ");
      const { error } = await q.admin
        .from("ai_agents")
        .update({
          archived_at: new Date().toISOString(),
          published_version_id: null,
          is_active: false,
          is_default: false,
          name: `${a.name} (desfeito ${marca})`.slice(0, 120),
        })
        .eq("organization_id", q.orgId)
        .eq("id", id);
      if (error) throw new Error(`não consegui arquivar o agente: ${error.message}`);
      void audit({
        action: "ai_agent.archived",
        actorUserId: q.userId,
        organizationId: q.orgId,
        resourceType: "ai_agent",
        resourceId: id,
        requestId: q.requestId,
        metadata: { via: "assistente" },
      });
      return avisos;
    }
    case "funil": {
      const id = texto(r, "funil_id")!;
      const antes = (r.antes as { nome: string; slug: string; etapas: EtapaDoRetrato[] } | undefined) ?? QUADRO_SEMEADO;
      if (!r.antes) avisos.push("O funil voltou ao quadro que veio com a empresa (Pedidos).");
      const { data, error } = await q.admin.rpc("fn_aplicar_quadro_do_onboarding", {
        p_organization_id: q.orgId,
        p_pipeline_id: id,
        p_nome: antes.nome,
        p_slug: antes.slug,
        p_etapas: antes.etapas.map((e) => ({
          nome: e.nome,
          slug: e.slug,
          position: e.position,
          is_won: e.is_won,
          is_lost: e.is_lost,
          agent_stage_hint: e.agent_stage_hint ?? "",
        })),
      });
      if (error) throw new Error(`não consegui voltar o funil: ${error.message}`);
      const res = (data ?? {}) as { ok?: boolean; motivo?: string };
      if (!res.ok) throw new Recusa(res.motivo === "tem_negocio" ? "Um negócio entrou no funil enquanto você decidia." : "O funil mudou e não dá mais para voltar. Use Etapas do funil.");
      // O passo "Onde ele organiza" que o aplicar marcou volta a faltar.
      const { data: org } = await q.admin.from("organizations").select("onboarding_state, onboarded_at").eq("id", q.orgId).maybeSingle();
      const linha = org as { onboarding_state?: Record<string, unknown> | null; onboarded_at?: string | null } | null;
      const marcado = (linha?.onboarding_state?.funil as { pipeline_id?: string; origem?: string } | undefined) ?? null;
      if (linha && !linha.onboarded_at && marcado?.pipeline_id === id && marcado.origem === "pacote") {
        const { funil: _funil, ...resto } = linha.onboarding_state ?? {};
        void _funil;
        await (q.admin as ReturnType<typeof createAdminClient>)
          .from("organizations")
          .update({ onboarding_state: resto })
          .eq("id", q.orgId)
          .is("onboarded_at", null);
      }
      return avisos;
    }
  }
}

/**
 * Desfaz a proposta. `conferirQuem`: pelo cartão, só quem aprova aquele tipo
 * desfaz; pelo MCP, a operação do token já decidiu.
 */
export async function desfazerProposta(q: QuemDesfaz, propostaId: string, opcoes: { conferirQuem: boolean }): Promise<DesfechoDoDesfazer> {
  const proposta = await ler(q.admin, q.orgId, propostaId);
  if (!proposta) return { ok: false, codigo: "nao_encontrada", mensagem: "Proposta não encontrada nesta empresa." };
  if (proposta.situacao === "desfeita") return { ok: true, desfecho: "ja_estava", proposta: semPedido(proposta), avisos: [] };
  if (proposta.situacao !== "aplicada") {
    return { ok: false, codigo: "nao_aplicada", mensagem: "Só a proposta aplicada é desfeita. Esta não mudou nada.", proposta: semPedido(proposta) };
  }
  if (opcoes.conferirQuem) {
    const regra = regraDeAprovacao({ tipo: proposta.tipo, pedido: proposta.pedido } as PedidoDaProposta, proposta.criada_por);
    if (!podeAprovar(regra, { userId: q.userId, papel: q.papel }, proposta.criada_por)) {
      return { ok: false, codigo: "sem_permissao", mensagem: `Só quem aprova desfaz: ${regra.rotulo}.`, proposta: semPedido(proposta) };
    }
  }

  const trava = await travaDoDesfazer(q.admin, q.orgId, proposta);
  if (trava) {
    void audit({
      action: "assistente.desfazer_travado",
      actorUserId: q.userId,
      organizationId: q.orgId,
      resourceType: "mia_assistente_propostas",
      resourceId: propostaId,
      requestId: q.requestId,
      metadata: { tipo: proposta.tipo, via: q.via, via_assistente: true },
    });
    return { ok: false, codigo: "travada", mensagem: trava.motivo, proposta: semPedido(proposta) };
  }

  let avisos: string[];
  try {
    avisos = await tirarPeca(q, proposta);
  } catch (err) {
    const mensagem =
      err instanceof Recusa || (err instanceof ApiError && err.status < 500) || err instanceof RelatorioRecusado
        ? err.message
        : "Não deu para desfazer agora. Tente de novo em instantes.";
    return { ok: false, codigo: err instanceof Recusa || err instanceof ApiError || err instanceof RelatorioRecusado ? "travada" : "falhou", mensagem, proposta: semPedido(proposta) };
  }

  const agora = new Date().toISOString();
  const { data: final, error } = await q.admin
    .from("mia_assistente_propostas")
    .update({ situacao: "desfeita", desfeita_por: q.userId, desfeita_em: agora })
    .eq("organization_id", q.orgId)
    .eq("id", propostaId)
    .eq("situacao", "aplicada")
    .select(COLUNAS_DA_PROPOSTA);
  if (error) throw new Error(`a peça saiu, mas não consegui marcar a proposta: ${error.message}`);
  const linha = ((final ?? [])[0] as PropostaLida | undefined) ?? { ...semPedido(proposta), situacao: "desfeita" as const, desfeita_por: q.userId, desfeita_em: agora };

  void audit({
    action: "assistente.proposta_desfeita",
    actorUserId: q.userId,
    organizationId: q.orgId,
    resourceType: "mia_assistente_propostas",
    resourceId: propostaId,
    requestId: q.requestId,
    metadata: {
      tipo: proposta.tipo,
      via: q.via,
      via_assistente: true,
      pedida_por: proposta.criada_por,
      aprovada_por: proposta.aprovada_por,
      desfeita_por: q.userId,
      peca: proposta.resultado,
    },
  });
  await avisarDoResultado(q.admin, { orgId: q.orgId, proposta: linha, quemDecidiu: q.userId, nomeDeQuemDecidiu: q.nome ?? null, desfecho: "desfeita" });
  return { ok: true, desfecho: "desfeita", proposta: linha, avisos };
}

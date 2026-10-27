/**
 * FORK MIA (.94) — APLICAR as nove peças do dia a dia: é aqui, e só aqui, que
 * a peça nasce.
 *
 * ── Com o login de quem aprova ──────────────────────────────────────────────
 *
 * O assistente não tem acesso próprio. Pelo cartão, o `db` é o cliente da
 * SESSÃO de quem aprovou, e cada peça passa pela MESMA função (ou a mesma
 * gravação) que a tela usa: a RLS e o papel valem como valeriam no clique.
 *
 *   etapa_criar      `criarEtapa` e `atualizarEtapa({ depois_de })`, de
 *                    Etapas do funil
 *   etapa_renomear   `atualizarEtapa({ name })`
 *   resposta         o insert de `POST /api/v1/message-templates`
 *   etiqueta         `fn_vocabulario_de_tags_operar('definir_cor')`, a função
 *                    da tela de Etiquetas
 *   tarefa           o insert de `POST /api/v1/tasks`
 *   rascunho de      o modelo de retomada em rascunho, com as mensagens
 *   follow-up        escritas, como o `from-model` da tela
 *   conhecimento     `garantirConhecimento` (a tela de Conhecimento grava o
 *                    material com o cliente de serviço depois de conferir o
 *                    papel, e aqui também)
 *   relatorio        `criarRelatorio`, o do montador
 *   meta             `gravarMeta`, o upsert da tela de Desempenho
 *
 * Pelo MCP de plataforma o cliente é o de serviço e quem age é quem criou o
 * token, como em toda ferramenta de implantação. A peça "só minha" (resposta e
 * relatório) continua de quem pediu.
 *
 * Nada aqui publica nem manda mensagem para ninguém.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import type { Role } from "@/lib/auth/types";
import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { modeloPorId } from "@/lib/followup/modelos";
import { rotuloDaEspera } from "@/lib/followup/modelos/escada";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { gravarMeta } from "@/lib/crm/metas/gravar";
import { chaveDoNome } from "@/lib/implantacao/base";
import { garantirConhecimento } from "@/lib/implantacao/conhecimento";
import { garantirEtiquetas } from "@/lib/implantacao/etiquetas";
import { criarEtapa, atualizarEtapa, type DepsDeEtapa } from "@/lib/leads/stage-operations";
import { posicaoEntre } from "@/lib/leads/stage-editing";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { criarRelatorio, RelatorioRecusado } from "@/lib/relatorios/servidor";
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";

import { atalhoLimpo, MATERIAL_DO_DIA_A_DIA, nomesDoVocabulario } from "./preparar-do-dia-a-dia";
import type { PedidoDaProposta, TipoDoDiaADia } from "./tipos";

export interface QuemAplica {
  /** O cliente da sessão de quem aprovou (cartão) ou o de serviço (MCP). */
  db: SupabaseClient;
  /** O cliente de serviço: só para o que a própria tela grava com ele (o material de conhecimento). */
  admin: SupabaseClient;
  /** `true` = `db` é a sessão (a RLS de quem aprovou vale). */
  pelaSessao: boolean;
  orgId: string;
  /** Quem aprovou (ou quem criou o token do MCP). */
  userId: string;
  papel: Role;
  /** Quem pediu: a peça "só minha" é dela. */
  criadaPor: string | null;
  requestId: string;
  via: "tela" | "mcp_plataforma";
}

export interface PecaDoDiaADia {
  resultado: Record<string, unknown>;
  avisos: string[];
}

const DIA_MS = 86_400_000;

/** O erro da função da tela vira a frase do cartão (o técnico não sai). */
function frase(err: unknown): never {
  if (err instanceof Recusa) throw err;
  if (err instanceof ApiError && err.status < 500) throw new Recusa(err.message);
  if (err instanceof RelatorioRecusado) throw new Recusa(err.message);
  throw err;
}

function depsDeEtapa(q: QuemAplica): DepsDeEtapa {
  return { supabase: q.db, organizationId: q.orgId, actor: { type: "user", id: q.userId, role: q.papel }, requestId: q.requestId };
}

/** O vizinho da esquerda de `antesDe` entre as etapas ativas, sem a nova. */
async function vizinhoDaEsquerda(q: QuemAplica, funilId: string, antesDe: string, nova: string): Promise<string | null | undefined> {
  const { data } = await q.db
    .from("crm_stages")
    .select("id, position")
    .eq("organization_id", q.orgId)
    .eq("pipeline_id", funilId)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  const ativas = ((data ?? []) as Array<{ id: string }>).filter((e) => e.id !== nova);
  const i = ativas.findIndex((e) => e.id === antesDe);
  if (i < 0) return undefined;
  return i === 0 ? null : ativas[i - 1]!.id;
}

export async function aplicarPecaDoDiaADia(
  q: QuemAplica,
  proposta: Extract<PedidoDaProposta, { tipo: TipoDoDiaADia }>,
): Promise<PecaDoDiaADia> {
  const avisos: string[] = [];
  try {
    switch (proposta.tipo) {
      case "etapa_criar": {
        const p = proposta.pedido;
        const criada = await criarEtapa(depsDeEtapa(q), { pipelineId: p.funil_id, nome: p.nome });
        if (p.antes_de_id) {
          const depoisDe = await vizinhoDaEsquerda(q, p.funil_id, p.antes_de_id, criada.stageId);
          if (depoisDe === undefined) {
            avisos.push(`A etapa «${p.antes_de_nome ?? ""}» não está mais no funil: a nova ficou no fim. Arraste a coluna em Etapas do funil.`);
          } else {
            await atualizarEtapa(depsDeEtapa(q), { pipelineId: p.funil_id, stageId: criada.stageId, pedido: { depois_de: depoisDe } });
          }
        }
        return { resultado: { funil_id: p.funil_id, etapa_id: criada.stageId, etapa_nome: p.nome }, avisos };
      }

      case "etapa_renomear": {
        const p = proposta.pedido;
        const { data } = await q.db
          .from("crm_stages")
          .select("name, is_archived")
          .eq("organization_id", q.orgId)
          .eq("id", p.etapa_id)
          .maybeSingle();
        const atual = data as { name: string; is_archived: boolean } | null;
        if (!atual || atual.is_archived) throw new Recusa("A etapa não está mais no funil. Peça de novo ao assistente.");
        if (chaveDoNome(atual.name) !== chaveDoNome(p.de)) {
          throw new Recusa(`A etapa mudou de nome desde a proposta (agora é «${atual.name}»). Peça de novo ao assistente.`);
        }
        await atualizarEtapa(depsDeEtapa(q), { pipelineId: p.funil_id, stageId: p.etapa_id, pedido: { name: p.para } });
        return { resultado: { funil_id: p.funil_id, etapa_id: p.etapa_id, de: atual.name, para: p.para }, avisos };
      }

      case "resposta": {
        const p = proposta.pedido;
        const dona = p.para === "eu" ? q.criadaPor : null;
        if (p.para === "eu" && !dona) throw new Recusa("A resposta era só de quem pediu, e essa pessoa não está mais aqui.");
        const atalho = atalhoLimpo(p.atalho);
        const { data: existentes } = await q.db
          .from("message_templates")
          .select("id, title, shortcut, ordem")
          .eq("organization_id", q.orgId)
          .order("ordem", { ascending: true })
          .limit(500);
        const lista = (existentes ?? []) as Array<{ title: string; shortcut: string | null; ordem: number }>;
        if (lista.some((t) => t.shortcut && atalhoLimpo(t.shortcut) === atalho)) {
          throw new Recusa(`Já existe uma resposta com o atalho /${atalho}. Ajuste o cartão ou peça de novo.`);
        }
        const menor = lista[0]?.ordem ?? null;
        const { data, error } = await q.db
          .from("message_templates")
          .insert({
            organization_id: q.orgId,
            owner_user_id: dona,
            title: p.titulo,
            body: p.texto,
            shortcut: atalho,
            midias: [],
            created_by_user_id: q.userId,
            ordem: posicaoEntre(null, menor === null ? null : Number(menor)) ?? 0,
          })
          .select("id, updated_at")
          .single();
        if (error || !data) {
          if ((error as { code?: string } | null)?.code === "42501") throw new Recusa("O seu papel não grava essa resposta.");
          throw new Error(`não consegui gravar a resposta rápida: ${error?.message ?? "sem linha"}`);
        }
        const linha = data as { id: string; updated_at: string };
        void audit({
          action: "template.created",
          actorUserId: q.userId,
          organizationId: q.orgId,
          resourceType: "message_template",
          resourceId: linha.id,
          requestId: q.requestId,
          metadata: { shared: dona === null, title: p.titulo, via: "assistente" },
        });
        return { resultado: { resposta_id: linha.id, atualizada_em: linha.updated_at }, avisos };
      }

      case "etiqueta": {
        const p = proposta.pedido;
        const { data: org } = await q.db.from("organizations").select("settings").eq("id", q.orgId).maybeSingle();
        const nomes = nomesDoVocabulario((org as { settings?: unknown } | null)?.settings ?? {});
        if (nomes.some((n) => chaveDaEtiqueta(n) === chaveDaEtiqueta(p.nome))) {
          throw new Recusa(`A etiqueta «${p.nome}» já existe. Nada foi mudado.`);
        }
        if (q.pelaSessao) {
          // A função da tela de Etiquetas: confere o papel pelo `auth.uid()`.
          const { error } = await q.db.rpc("fn_vocabulario_de_tags_operar", {
            p_org: q.orgId,
            p_acao: "definir_cor",
            p_tag: p.nome,
            p_destino: null,
            p_cor: p.cor,
          });
          if (error) {
            if (error.code === "42501") throw new Recusa("O seu papel não cria etiqueta.");
            throw new Error(`não consegui criar a etiqueta: ${error.message}`);
          }
          void audit({
            action: "tag_vocabulary.changed",
            actorUserId: q.userId,
            organizationId: q.orgId,
            resourceType: "organization",
            resourceId: q.orgId,
            requestId: q.requestId,
            metadata: { acao: "definir_cor", tag: p.nome, via: "assistente" },
          });
        } else {
          await garantirEtiquetas({ admin: q.admin, orgId: q.orgId, autorUserId: q.userId, requestId: q.requestId }, [{ nome: p.nome, cor: p.cor }]);
        }
        return { resultado: { etiqueta: p.nome, cor: p.cor }, avisos };
      }

      case "tarefa": {
        const p = proposta.pedido;
        const { data, error } = await q.db
          .from("crm_tasks")
          .insert({
            organization_id: q.orgId,
            title: p.titulo,
            due_date: p.vence_em,
            assigned_to: p.para_user_id,
            created_by: q.userId,
            status: "pending",
            priority: "medium",
          })
          .select("id")
          .single();
        if (error || !data) {
          if ((error as { code?: string } | null)?.code === "42501") throw new Recusa("O seu papel não cria essa tarefa.");
          throw new Error(`não consegui criar a tarefa: ${error?.message ?? "sem linha"}`);
        }
        const id = (data as { id: string }).id;
        void audit({
          action: "crm_task.created",
          actorUserId: q.userId,
          organizationId: q.orgId,
          resourceType: "crm_task",
          resourceId: id,
          requestId: q.requestId,
          metadata: { assigned_to: p.para_user_id, via: "assistente" },
        });
        return { resultado: { tarefa_id: id }, avisos };
      }

      case "rascunho_de_followup": {
        const p = proposta.pedido;
        const modelo = modeloPorId(p.modelo);
        if (!modelo || modelo.pedeEtapa) throw new Recusa("O modelo de retomada não existe nesta versão. Peça de novo ao assistente.");
        const esperas: Record<string, number> = { "espera-2": p.esperas_dias[0] * DIA_MS, "espera-3": p.esperas_dias[1] * DIA_MS };
        const grafo: FlowGraph = {
          ...modelo.grafo,
          nodes: modelo.grafo.nodes.map((n) => {
            const m = /^msg-(\d)$/.exec(n.id);
            if (m) {
              const texto = p.mensagens[Number(m[1]) - 1];
              return texto ? { ...n, config: { ...(n.config as Record<string, unknown>), mode: "text", body: texto } } : n;
            }
            const espera = esperas[n.id];
            if (espera) return { ...n, label: rotuloDaEspera(espera), config: { ...(n.config as Record<string, unknown>), mode: "fixed", duration_ms: espera } };
            return n;
          }),
        } as FlowGraph;
        const lido = flowGraphSchema.safeParse(grafo);
        const gatilho = triggerConfigSchema.safeParse(modelo.gatilho({}));
        const publicavel = lido.success ? validateFlowForPublish(lido.data) : null;
        if (!lido.success || !gatilho.success || (publicavel && !publicavel.ok)) {
          throw new Recusa("As mensagens não fecham um fluxo válido. Ajuste o cartão e tente de novo.");
        }
        const { data, error } = await q.db
          .from("followup_flow_pointers")
          .insert({
            organization_id: q.orgId,
            name: p.nome,
            draft_graph: lido.data,
            trigger_config: gatilho.data,
            handoff_policy: modelo.handoffPolicy,
          })
          .select("id, name")
          .single();
        if (error || !data) {
          if ((error as { code?: string } | null)?.code === "23505") throw new Recusa(`Já existe um follow-up chamado «${p.nome}».`);
          if ((error as { code?: string } | null)?.code === "42501") throw new Recusa("O seu papel não cria follow-up.");
          throw new Error(`não consegui criar o rascunho do follow-up: ${error?.message ?? "sem linha"}`);
        }
        const linha = data as { id: string; name: string };
        void audit({
          action: "followup_flow.created",
          actorUserId: q.userId,
          organizationId: q.orgId,
          resourceType: "followup_flow_pointer",
          resourceId: linha.id,
          requestId: q.requestId,
          metadata: { name: linha.name, model_id: modelo.id, trigger_kind: gatilho.data.kind, via: "assistente" },
        });
        avisos.push("O follow-up nasceu em rascunho: nenhuma mensagem sai até alguém publicar na tela de Follow-ups.");
        return { resultado: { fluxo_id: linha.id, fluxo_nome: linha.name }, avisos };
      }

      case "conhecimento": {
        const p = proposta.pedido;
        // O material de agora (pode ter mudado de nome ou saído desde a proposta).
        let material: { id: string; name: string } | null = null;
        if (p.material_id) {
          const { data } = await q.admin
            .from("ai_knowledge_sources")
            .select("id, name, source_type, is_active")
            .eq("organization_id", q.orgId)
            .eq("id", p.material_id)
            .maybeSingle();
          const m = data as { id: string; name: string; source_type: string; is_active: boolean } | null;
          if (m && m.is_active && m.source_type === "faq") material = { id: m.id, name: m.name };
        }
        if (!material) {
          const { data } = await q.admin
            .from("ai_knowledge_sources")
            .select("id, name, source_type")
            .eq("organization_id", q.orgId)
            .eq("is_active", true)
            .eq("source_type", "faq")
            .limit(200);
          const achado = ((data ?? []) as Array<{ id: string; name: string }>).find((m) => chaveDoNome(m.name) === chaveDoNome(MATERIAL_DO_DIA_A_DIA));
          material = achado ?? null;
        }
        let atuais: Array<{ pergunta: string; resposta: string; etiquetas: string[] }> = [];
        if (material) {
          const { data } = await q.admin
            .from("ai_faq_items")
            .select("question, answer, tags, position")
            .eq("organization_id", q.orgId)
            .eq("knowledge_source_id", material.id)
            .order("position", { ascending: true });
          atuais = ((data ?? []) as Array<{ question: string; answer: string; tags: string[] | null }>).map((i) => ({
            pergunta: i.question,
            resposta: i.answer,
            etiquetas: i.tags ?? [],
          }));
          if (atuais.some((i) => chaveDoNome(i.pergunta) === chaveDoNome(p.pergunta))) {
            throw new Recusa(`O material «${material.name}» já tem o item «${p.pergunta}».`);
          }
        }
        const nome = material?.name ?? MATERIAL_DO_DIA_A_DIA;
        const g = await garantirConhecimento(
          { admin: q.admin, orgId: q.orgId, autorUserId: q.userId, requestId: q.requestId },
          { nome, tipo: "faq", perguntas: [...atuais, { pergunta: p.pergunta, resposta: p.resposta, etiquetas: [] }] },
        );
        // O registro é o da proposta (`assistente.proposta_aplicada`, com o
        // material): o material não tem código próprio no Audit Log.
        avisos.push(...g.avisos);
        return {
          resultado: {
            material_id: g.material.id,
            material_nome: g.material.nome,
            pergunta: p.pergunta,
            resposta: p.resposta,
            material_novo: g.material.desfecho === "criou",
          },
          avisos,
        };
      }

      case "relatorio": {
        const p = proposta.pedido;
        const dona = p.para === "eu" ? q.criadaPor : q.userId;
        const r = await criarRelatorio(
          q.db,
          { organizationId: q.orgId, userId: dona, requestId: q.requestId, via: q.via },
          {
            nome: p.nome,
            config: {
              fonte: "negocios",
              medida: "qtd",
              dim1: p.agrupar,
              dim2: null,
              filtros: p.funil_id ? { funil: p.funil_id } : {},
              periodo: p.periodo,
              de: null,
              ate: null,
              comparar: false,
              visualizacao: "barras",
            } as Parameters<typeof criarRelatorio>[2]["config"],
            compartilhado: p.para === "equipe",
          },
        );
        return { resultado: { relatorio_id: r.id, relatorio_nome: r.nome }, avisos };
      }

      case "meta": {
        const p = proposta.pedido;
        const { data: antes } = await q.db
          .from("sales_targets")
          .select("alvo_cents")
          .eq("organization_id", q.orgId)
          .eq("periodo", `${p.mes}-01`)
          .eq("metrica", "receita_total")
          .is("user_id", null)
          .is("agent_id", null)
          .maybeSingle();
        const antesCents = (antes as { alvo_cents?: number | string | null } | null)?.alvo_cents;
        const { error } = await gravarMeta(q.db, {
          organizationId: q.orgId,
          periodo: p.mes,
          metrica: "receita_total",
          alvo_cents: p.valor_cents,
          created_by: q.userId,
        });
        if (error) {
          if (error.code === "42501") throw new Recusa("O seu papel não grava a meta.");
          throw new Error(`não consegui gravar a meta: ${error.message}`);
        }
        void audit({
          action: "org.updated",
          actorUserId: q.userId,
          organizationId: q.orgId,
          resourceType: "organization",
          resourceId: q.orgId,
          requestId: q.requestId,
          metadata: { fields_changed: ["meta_do_mes"], mes: p.mes, via: "assistente" },
        });
        return {
          resultado: { mes: p.mes, valor_cents: p.valor_cents, antes_cents: antesCents === null || antesCents === undefined ? null : Number(antesCents) },
          avisos,
        };
      }
    }
  } catch (err) {
    frase(err);
  }
}

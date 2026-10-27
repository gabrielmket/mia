/**
 * FORK MIA (.93) — AS LEITURAS QUE CONFEREM UMA TRILHA, com o login de quem usa.
 *
 * Cada passo que grava alguma coisa, e o objetivo de cada trilha, é conferido
 * AQUI, no sistema: o número conectado, o funil salvo, a versão publicada. Não
 * pelo clique (o assistente nunca clica) nem pela palavra de ninguém.
 *
 * ── O cliente é o da SESSÃO ─────────────────────────────────────────────────
 *
 * A regra da .88: o assistente não tem acesso próprio. A rota passa o cliente
 * de quem está na trilha, e a RLS de cada tabela filtra como nas telas. O que o
 * papel não lê volta como "ainda não vejo", nunca como erro: a trilha espera.
 * Este arquivo não importa o cliente de serviço (`assistente-turno-usa-a-sessao`).
 *
 * ── "Desde" ─────────────────────────────────────────────────────────────────
 *
 * As trilhas de cada pessoa ("Criar um funil") contam o que apareceu DEPOIS que
 * a pessoa começou (`desde`, gravado no banco, não o que o navegador manda): um
 * funil antigo não faz a trilha nova ficar feita. As da empresa ("Ligar o
 * primeiro número") olham o estado de agora, venha de quem vier: se alguém fez
 * por outro caminho, conta.
 *
 * Só leituras fixas, sem IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeituraDoSistema } from "./catalogo";

/** O status do número que funciona (o mesmo de `lib/channels/health.ts`). */
const NUMERO_FUNCIONANDO = "WORKING";

export interface ContextoDaLeitura {
  organizationId: string;
  userId: string;
  /** Quando a pessoa começou a trilha (ISO). `null` = o estado de agora, sem corte. */
  desde: string | null;
  agora?: Date;
}

export interface ResultadoDaLeitura {
  ok: boolean;
  /** O que entra no texto ("{nome}", "{etapas}"). Nunca dado de contato. */
  vars?: Record<string, string>;
  /** Os ids que os passos seguintes usam no destaque (`etapas-{funil}`). */
  ids?: Record<string, string>;
}

type Db = Pick<SupabaseClient, "from">;
type Leitor = (db: Db, ctx: ContextoDaLeitura) => Promise<ResultadoDaLeitura>;

const NAO: ResultadoDaLeitura = { ok: false };

/** Leitura que falha (RLS, tabela que o banco ainda não tem) é "ainda não vejo". */
async function linhas<T>(consulta: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try {
    const r = await consulta;
    if (r.error) return [];
    return Array.isArray(r.data) ? (r.data as T[]) : [];
  } catch {
    return [];
  }
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nomeDoNumero(n: { display_name?: unknown; phone_number?: unknown }): string {
  return texto(n.display_name) || texto(n.phone_number) || "o número";
}

/** O horário da IA gravado na versão (`trigger_config.filters.horario_da_ia`, .85). */
function temHorarioDaIa(triggerConfig: unknown): boolean {
  const filtros = (triggerConfig as { filters?: { horario_da_ia?: unknown } } | null)?.filters;
  const h = filtros?.horario_da_ia as { faixas?: unknown } | null | undefined;
  return Boolean(h && typeof h === "object" && Array.isArray(h.faixas) && h.faixas.length > 0);
}

async function agentesNoAr(db: Db, org: string): Promise<Array<{ id: string; name: string; published_version_id: string }>> {
  const agentes = await linhas<{ id: string; name: string; published_version_id: string | null; archived_at: string | null; paused_at?: string | null }>(
    db
      .from("ai_agents")
      .select("id, name, published_version_id, archived_at, paused_at")
      .eq("organization_id", org)
      .is("archived_at", null)
      .not("published_version_id", "is", null)
      .limit(50),
  );
  return agentes
    .filter((a) => a.published_version_id && !a.paused_at)
    .map((a) => ({ id: a.id, name: a.name, published_version_id: a.published_version_id as string }));
}

const LEITORES: Record<LeituraDoSistema, Leitor> = {
  async numero_conectado(db, ctx) {
    const numeros = await linhas<{ display_name: string | null; phone_number: string | null }>(
      db
        .from("channel_sessions")
        .select("id, display_name, phone_number, status")
        .eq("organization_id", ctx.organizationId)
        .is("archived_at", null)
        .eq("status", NUMERO_FUNCIONANDO)
        .limit(20),
    );
    const n = numeros[0];
    return n ? { ok: true, vars: { nome: nomeDoNumero(n) } } : NAO;
  },

  async numero_com_nome(db, ctx) {
    const numeros = await linhas<{ display_name: string | null; phone_number: string | null }>(
      db
        .from("channel_sessions")
        .select("id, display_name, phone_number, status")
        .eq("organization_id", ctx.organizationId)
        .is("archived_at", null)
        .eq("status", NUMERO_FUNCIONANDO)
        .limit(20),
    );
    const n = numeros.find((x) => texto(x.display_name).length > 0);
    return n ? { ok: true, vars: { nome: nomeDoNumero(n) } } : NAO;
  },

  async agente_criado(db, ctx) {
    const agentes = await linhas<{ name: string }>(
      db
        .from("ai_agents")
        .select("id, name, updated_at")
        .eq("organization_id", ctx.organizationId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(1),
    );
    return agentes[0] ? { ok: true, vars: { nome: texto(agentes[0].name) || "o agente" } } : NAO;
  },

  async agente_no_ar(db, ctx) {
    const a = (await agentesNoAr(db, ctx.organizationId))[0];
    return a ? { ok: true, vars: { nome: texto(a.name) || "o agente" } } : NAO;
  },

  async rascunho_com_horario(db, ctx) {
    const versoes = await linhas<{ trigger_config: unknown }>(
      db
        .from("ai_agent_versions")
        .select("id, agent_id, trigger_config")
        .eq("organization_id", ctx.organizationId)
        .eq("status", "draft")
        .limit(50),
    );
    return versoes.some((v) => temHorarioDaIa(v.trigger_config)) ? { ok: true } : NAO;
  },

  async horario_publicado(db, ctx) {
    const agentes = await agentesNoAr(db, ctx.organizationId);
    if (agentes.length === 0) return NAO;
    const versoes = await linhas<{ id: string; trigger_config: unknown }>(
      db
        .from("ai_agent_versions")
        .select("id, trigger_config")
        .eq("organization_id", ctx.organizationId)
        .in(
          "id",
          agentes.map((a) => a.published_version_id),
        )
        .limit(50),
    );
    const comHorario = versoes.find((v) => temHorarioDaIa(v.trigger_config));
    if (!comHorario) return NAO;
    const agente = agentes.find((a) => a.published_version_id === comHorario.id);
    return { ok: true, vars: { nome: texto(agente?.name) || "o agente" } };
  },

  async equipe_com_mais_gente(db, ctx) {
    const pessoas = await linhas<{ user_id: string }>(
      db.from("user_organizations").select("user_id").eq("organization_id", ctx.organizationId).is("revoked_at", null).limit(3),
    );
    if (pessoas.length >= 2) return { ok: true };
    const convites = await linhas<{ email: string }>(
      db
        .from("team_invites")
        .select("email")
        .eq("organization_id", ctx.organizationId)
        .is("revoked_at", null)
        .is("accepted_at", null)
        .gt("expires_at", (ctx.agora ?? new Date()).toISOString())
        .limit(1),
    );
    return convites.length > 0 ? { ok: true } : NAO;
  },

  async convite_enviado(db, ctx) {
    let q = db
      .from("team_invites")
      .select("email, created_at, last_sent_at")
      .eq("organization_id", ctx.organizationId)
      .is("revoked_at", null)
      .is("accepted_at", null)
      .gt("expires_at", (ctx.agora ?? new Date()).toISOString());
    if (ctx.desde) q = q.gte("last_sent_at", ctx.desde);
    const convites = await linhas<{ email: string }>(q.order("last_sent_at", { ascending: false }).limit(1));
    return convites[0] ? { ok: true, vars: { nome: texto(convites[0].email) } } : NAO;
  },

  async fluxo_criado(db, ctx) {
    let q = db.from("followup_flow_pointers").select("id, name, created_at").eq("organization_id", ctx.organizationId);
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const fluxos = await linhas<{ id: string; name: string }>(q.order("created_at", { ascending: false }).limit(1));
    const f = fluxos[0];
    return f ? { ok: true, vars: { nome: texto(f.name) }, ids: { fluxo: f.id } } : NAO;
  },

  async fluxo_com_gatilho(db, ctx) {
    let q = db.from("followup_flow_pointers").select("id, name, trigger_config, updated_at").eq("organization_id", ctx.organizationId);
    if (ctx.desde) q = q.gte("updated_at", ctx.desde);
    const fluxos = await linhas<{ id: string; name: string; trigger_config: { kind?: string } | null }>(
      q.order("updated_at", { ascending: false }).limit(20),
    );
    const f = fluxos.find((x) => (x.trigger_config?.kind ?? "manual") !== "manual");
    return f ? { ok: true, vars: { nome: texto(f.name) }, ids: { fluxo: f.id } } : NAO;
  },

  async followup_publicado(db, ctx) {
    let versoesQ = db.from("followup_flow_versions").select("id, created_at").eq("organization_id", ctx.organizationId);
    if (ctx.desde) versoesQ = versoesQ.gte("created_at", ctx.desde);
    const versoes = await linhas<{ id: string }>(versoesQ.order("created_at", { ascending: false }).limit(50));
    if (versoes.length === 0) return NAO;
    const fluxos = await linhas<{ id: string; name: string }>(
      db
        .from("followup_flow_pointers")
        .select("id, name, status, active_version_id")
        .eq("organization_id", ctx.organizationId)
        .eq("status", "active")
        .in(
          "active_version_id",
          versoes.map((v) => v.id),
        )
        .limit(1),
    );
    const f = fluxos[0];
    return f ? { ok: true, vars: { nome: texto(f.name) }, ids: { fluxo: f.id } } : NAO;
  },

  async funil_criado(db, ctx) {
    let q = db.from("crm_pipelines").select("id, name, created_at").eq("organization_id", ctx.organizationId).eq("is_archived", false);
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const funis = await linhas<{ id: string; name: string }>(q.order("created_at", { ascending: false }).limit(1));
    const f = funis[0];
    return f ? { ok: true, vars: { nome: texto(f.name) }, ids: { funil: f.id } } : NAO;
  },

  async funil_com_ganho_e_perda(db, ctx) {
    const criado = await LEITORES.funil_criado(db, ctx);
    const funil = criado.ids?.funil;
    if (!criado.ok || !funil) return NAO;
    const etapas = await linhas<{ is_won: boolean; is_lost: boolean }>(
      db.from("crm_stages").select("id, is_won, is_lost").eq("pipeline_id", funil).eq("is_archived", false).limit(100),
    );
    if (!etapas.some((e) => e.is_won) || !etapas.some((e) => e.is_lost)) return NAO;
    return { ok: true, vars: { nome: criado.vars?.nome ?? "", etapas: String(etapas.length) }, ids: { funil } };
  },

  async resposta_criada(db, ctx) {
    let q = db
      .from("message_templates")
      .select("id, title, shortcut, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("created_by_user_id", ctx.userId);
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const respostas = await linhas<{ title: string; shortcut: string | null }>(q.order("created_at", { ascending: false }).limit(1));
    const r = respostas[0];
    return r ? { ok: true, vars: { nome: texto(r.shortcut) || texto(r.title) } } : NAO;
  },

  async negocio_perdido(db, ctx) {
    let q = db.from("crm_leads").select("id, title, lost_reason, closed_at").eq("organization_id", ctx.organizationId).eq("status", "lost");
    if (ctx.desde) q = q.gte("closed_at", ctx.desde);
    const negocios = await linhas<{ title: string; lost_reason: string | null }>(q.order("closed_at", { ascending: false }).limit(1));
    const n = negocios[0];
    return n ? { ok: true, vars: { nome: texto(n.title), motivo: texto(n.lost_reason) || "sem motivo" } } : NAO;
  },

  async relatorio_salvo(db, ctx) {
    let q = db.from("mia_relatorios").select("id, nome, created_at").eq("organization_id", ctx.organizationId).eq("created_by", ctx.userId);
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const relatorios = await linhas<{ nome: string }>(q.order("created_at", { ascending: false }).limit(1));
    return relatorios[0] ? { ok: true, vars: { nome: texto(relatorios[0].nome) } } : NAO;
  },

  async campanha_criada(db, ctx) {
    const [oficial, porQr] = await Promise.all([
      linhas<{ nome: string }>(
        filtrarDesde(
          db.from("broadcasts").select("id, nome, created_at").eq("organization_id", ctx.organizationId).eq("created_by", ctx.userId),
          ctx.desde,
        )
          .order("created_at", { ascending: false })
          .limit(1),
      ),
      linhas<{ name: string }>(
        filtrarDesde(
          db.from("campaigns").select("id, name, created_at").eq("organization_id", ctx.organizationId).eq("created_by", ctx.userId),
          ctx.desde,
        )
          .order("created_at", { ascending: false })
          .limit(1),
      ),
    ]);
    const nome = texto(oficial[0]?.nome) || texto(porQr[0]?.name);
    return nome ? { ok: true, vars: { nome } } : NAO;
  },

  async campanha_saiu(db, ctx) {
    const [oficial, porQr] = await Promise.all([
      linhas<{ nome: string; status: string }>(
        filtrarDesde(
          db
            .from("broadcasts")
            .select("id, nome, status, created_at")
            .eq("organization_id", ctx.organizationId)
            .eq("created_by", ctx.userId)
            .in("status", ["agendada", "enviando", "pausada", "concluida"]),
          ctx.desde,
        ).limit(1),
      ),
      linhas<{ name: string; status: string }>(
        filtrarDesde(
          db
            .from("campaigns")
            .select("id, name, status, created_at")
            .eq("organization_id", ctx.organizationId)
            .eq("created_by", ctx.userId)
            .in("status", ["scheduled", "running", "paused", "completed"]),
          ctx.desde,
        ).limit(1),
      ),
    ]);
    if (oficial[0]) {
      return { ok: true, vars: { nome: texto(oficial[0].nome), situacao: oficial[0].status === "agendada" ? "agendada" : "enviada" } };
    }
    if (porQr[0]) {
      return { ok: true, vars: { nome: texto(porQr[0].name), situacao: porQr[0].status === "scheduled" ? "agendada" : "enviada" } };
    }
    return NAO;
  },

  async dominio_verificado(db, ctx) {
    const dominios = await linhas<{ dominio: string }>(
      db
        .from("mia_email_dominios")
        .select("dominio, verificado_em")
        .eq("organization_id", ctx.organizationId)
        .not("verificado_em", "is", null)
        .limit(1),
    );
    return dominios[0] ? { ok: true, vars: { nome: texto(dominios[0].dominio) } } : NAO;
  },

  async email_teste_enviado(db, ctx) {
    let q = db.from("mia_email_testes").select("id, enviado_em").eq("organization_id", ctx.organizationId).eq("enviado_por", ctx.userId);
    if (ctx.desde) q = q.gte("enviado_em", ctx.desde);
    return (await linhas(q.limit(1))).length > 0 ? { ok: true } : NAO;
  },

  async email_saiu(db, ctx) {
    let q = db
      .from("mia_email_campanhas")
      .select("id, nome, status, confirmada_em")
      .eq("organization_id", ctx.organizationId)
      .eq("confirmada_por", ctx.userId)
      .in("status", ["agendada", "enviando", "pausada", "concluida"]);
    if (ctx.desde) q = q.gte("confirmada_em", ctx.desde);
    const campanhas = await linhas<{ nome: string; status: string }>(q.order("confirmada_em", { ascending: false }).limit(1));
    const c = campanhas[0];
    return c ? { ok: true, vars: { nome: texto(c.nome), situacao: c.status === "agendada" ? "agendada" : "enviada" } } : NAO;
  },

  async contatos_importados(db, ctx) {
    let q = db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .eq("source", "import_csv")
      .eq("created_by_user_id", ctx.userId);
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    try {
      const r = (await q) as { count: number | null; error: unknown };
      const quantos = r.error ? 0 : (r.count ?? 0);
      return quantos > 0 ? { ok: true, vars: { quantos: String(quantos) } } : NAO;
    } catch {
      return NAO;
    }
  },

  async conversa_assumida(db, ctx) {
    let q = db
      .from("conversation_assignment_events")
      .select("conversation_id, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("changed_by", ctx.userId)
      .eq("reason", "claim");
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const eventos = await linhas<{ conversation_id: string }>(q.order("created_at", { ascending: false }).limit(1));
    return eventos[0] ? { ok: true, ids: { conversa: eventos[0].conversation_id } } : NAO;
  },

  async conversa_devolvida(db, ctx) {
    let q = db
      .from("conversation_assignment_events")
      .select("conversation_id, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("changed_by", ctx.userId)
      .eq("reason", "release");
    if (ctx.desde) q = q.gte("created_at", ctx.desde);
    const eventos = await linhas<{ conversation_id: string }>(q.order("created_at", { ascending: false }).limit(20));
    if (eventos.length === 0) return NAO;
    // "Liberar" também solta a conversa; devolver é ela voltar para a IA.
    const comAIa = await linhas<{ id: string }>(
      db
        .from("conversations")
        .select("id, assignee_kind")
        .eq("organization_id", ctx.organizationId)
        .eq("assignee_kind", "ai")
        .in(
          "id",
          eventos.map((e) => e.conversation_id),
        )
        .limit(1),
    );
    return comAIa[0] ? { ok: true, ids: { conversa: comAIa[0].id } } : NAO;
  },
};

function filtrarDesde<Q extends { gte: (coluna: string, valor: string) => Q }>(q: Q, desde: string | null): Q {
  return desde ? q.gte("created_at", desde) : q;
}

/** Roda UMA leitura. Erro nunca vaza: vira "ainda não vejo". */
export async function lerDoSistema(db: Db, leitura: LeituraDoSistema, ctx: ContextoDaLeitura): Promise<ResultadoDaLeitura> {
  const leitor = LEITORES[leitura];
  if (!leitor) return NAO;
  try {
    return await leitor(db, ctx);
  } catch {
    return NAO;
  }
}

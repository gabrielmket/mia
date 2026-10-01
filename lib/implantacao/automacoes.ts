/**
 * FORK MIA — GARANTIR e LIGAR uma regra de automação de um cliente.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 *   criar    `POST /api/v1/automation-rules`: `createAutomationRuleSchema`
 *            (os mesmos gatilhos e ações), a regra NASCE DESLIGADA
 *   editar   `PATCH /api/v1/automation-rules/[id]`: `updateAutomationRuleSchema`
 *            e a autoria da mudança (quem ligou a regra aparece na tela)
 *   ligar    o mesmo PATCH, com `is_active`
 *
 * ── As duas coisas que a ferramenta confere a mais ────────────────────────
 *
 * 1. Os ids citados nas ações (funil, etapa, número, agente, fluxo, pessoa)
 *    são conferidos contra a ORGANIZAÇÃO. Na tela eles vêm de seletores que só
 *    mostram o que é da empresa; aqui chegam como texto, e o cliente é o
 *    `service_role`: um id de outra organização entraria no jsonb sem erro.
 * 2. O segredo do webhook (`secret`) NÃO entra por aqui. É credencial: fica com
 *    o humano, na tela, e não num argumento que a auditoria da plataforma
 *    registra. A ação `call_webhook` sem segredo é aceita.
 *
 * ── A empresa de demonstração ─────────────────────────────────────────────
 *
 * Regra ATIVA com `call_webhook` ou `notify_group` é recusada pelo banco na
 * empresa de demonstração (migration 9010). A recusa volta com a frase da
 * trava, em vez de um erro de permissão sem explicação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ehRecusaDaDemonstracao, FRASE_DA_DEMONSTRACAO } from "@/lib/demonstracao/trava";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { autoriaDaMudanca } from "@/lib/operacao/autoria";
import { createAutomationRuleSchema, updateAutomationRuleSchema } from "@/lib/schemas/webhooks";

import { acharPorNomeOuId, atorDaImplantacao, chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";

export interface PedidoDeAutomacao {
  nome: string;
  gatilho: string;
  condicoes?: Array<{ field: string; op: "eq" | "neq" | "contains"; value: string }>;
  acoes: Array<{ type: string; config: Record<string, unknown> }>;
  configuracao_do_gatilho?: Record<string, unknown>;
}

export interface LinhaDaRegra {
  id: string;
  name: string;
  trigger_event: string;
  conditions: unknown;
  actions: unknown;
  trigger_config: unknown;
  is_active: boolean;
  created_at: string;
}

export async function lerRegras(admin: SupabaseClient, orgId: string): Promise<LinhaDaRegra[]> {
  const { data, error } = await admin
    .from("automation_rules")
    .select("id, name, trigger_event, conditions, actions, trigger_config, is_active, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler as automações: ${error.message}`);
  return (data ?? []) as unknown as LinhaDaRegra[];
}

/** Onde cada id de uma ação mora, e que tabela o confirma na organização. */
const REFERENCIAS: Array<{ campo: string; tabela: string; oQue: string; ondeAchar: string }> = [
  { campo: "pipeline_id", tabela: "crm_pipelines", oQue: "funil", ondeAchar: "plataforma_ver_funis" },
  { campo: "stage_id", tabela: "crm_stages", oQue: "etapa", ondeAchar: "plataforma_ver_funis" },
  { campo: "channel_session_id", tabela: "channel_sessions", oQue: "número", ondeAchar: "plataforma_ver_configuracao (seção canais)" },
  { campo: "agent_id", tabela: "ai_agents", oQue: "agente", ondeAchar: "plataforma_ver_agentes" },
  { campo: "flow_pointer_id", tabela: "followup_flow_pointers", oQue: "fluxo de follow-up", ondeAchar: "plataforma_ver_configuracao (seção followups)" },
];

async function conferirReferencias(c: Implantacao, acoes: Array<{ type: string; config: Record<string, unknown> }>): Promise<void> {
  for (const [i, acao] of acoes.entries()) {
    for (const ref of REFERENCIAS) {
      const id = acao.config[ref.campo];
      if (typeof id !== "string") continue;
      const { data, error } = await c.admin
        .from(ref.tabela)
        .select("id")
        .eq("id", id)
        .eq("organization_id", c.orgId)
        .maybeSingle();
      if (error) throw new Error(`não consegui conferir ${ref.oQue}: ${error.message}`);
      if (!data) {
        throw new Recusa(
          `acoes[${i}].config.${ref.campo}: não existe ${ref.oQue} com o id ${id} nesta organização. Os ids estão em ${ref.ondeAchar}.`,
        );
      }
    }
    // Quem recebe o negócio ou a tarefa precisa ser da equipe desta empresa.
    const atribuir = acao.config.atribuir_a;
    const pessoa =
      typeof acao.config.user_id === "string"
        ? acao.config.user_id
        : atribuir && typeof atribuir === "object"
          ? (atribuir as { usuario_id?: unknown }).usuario_id
          : undefined;
    if (typeof pessoa === "string") {
      const { data, error } = await c.admin
        .from("user_organizations")
        .select("user_id, revoked_at")
        .eq("organization_id", c.orgId)
        .eq("user_id", pessoa)
        .maybeSingle();
      if (error) throw new Error(`não consegui conferir a pessoa: ${error.message}`);
      if (!data || (data as { revoked_at: string | null }).revoked_at) {
        throw new Recusa(
          `acoes[${i}]: a pessoa ${pessoa} não faz parte da equipe desta organização. Os ids estão em plataforma_ver_configuracao (seção equipe).`,
        );
      }
    }
    if (acao.type === "call_webhook" && (acao.config.secret !== undefined || acao.config.secret_enc !== undefined)) {
      throw new Recusa(
        `acoes[${i}]: o segredo do webhook é credencial e não entra pela ferramenta. Crie a ação sem \`secret\`; uma pessoa põe o segredo pela tela (Automações), se o sistema de destino exigir.`,
      );
    }
  }
}

function recusaDoSchema(erro: { issues: Array<{ path: PropertyKey[]; message: string }> }): never {
  const linhas = erro.issues.slice(0, 8).map((i) => {
    const onde = i.path.join(".").replace(/^actions/, "acoes").replace(/^conditions/, "condicoes").replace(/^trigger_event/, "gatilho").replace(/^trigger_config/, "configuracao_do_gatilho").replace(/^name/, "nome");
    return `\`${onde}\`: ${/^Invalid/i.test(i.message) ? "valor não aceito" : i.message}`;
  });
  throw new Recusa(
    `A regra não passou na conferência:\n- ${linhas.join("\n- ")}\n` +
      "Os gatilhos, os tipos de ação e o formato de cada `config` estão em plataforma_listar_modelos, seção automacoes.",
  );
}

export async function garantirAutomacao(
  c: Implantacao,
  pedido: PedidoDeAutomacao,
): Promise<{ regra: { id: string; nome: string; ligada: boolean; desfecho: Desfecho; mudancas: string[] }; avisos: string[] }> {
  const avisos: string[] = [];
  const lido = createAutomationRuleSchema.safeParse({
    name: pedido.nome,
    trigger_event: pedido.gatilho,
    conditions: pedido.condicoes ?? [],
    actions: pedido.acoes,
    ...(pedido.configuracao_do_gatilho !== undefined ? { trigger_config: pedido.configuracao_do_gatilho } : {}),
  });
  if (!lido.success) recusaDoSchema(lido.error);
  const regra = lido.data;
  await conferirReferencias(c, regra.actions as Array<{ type: string; config: Record<string, unknown> }>);

  const regras = await lerRegras(c.admin, c.orgId);
  const comEsteNome = regras.filter((r) => chaveDoNome(r.name) === chaveDoNome(regra.name));
  if (comEsteNome.length > 1) {
    throw new Recusa(
      `Há ${comEsteNome.length} regras chamadas «${regra.name}» nesta organização, e a ferramenta não sabe qual atualizar. ` +
        "Renomeie ou apague as repetidas pela tela (Automações), e chame de novo.",
    );
  }
  const existente = comEsteNome[0];

  if (!existente) {
    const { data: criada, error } = await c.admin
      .from("automation_rules")
      .insert({
        organization_id: c.orgId,
        created_by_user_id: c.autorUserId,
        name: regra.name,
        trigger_event: regra.trigger_event,
        conditions: regra.conditions,
        actions: regra.actions,
        trigger_config: regra.trigger_config ?? {},
      })
      .select("id, name, is_active")
      .single();
    if (error || !criada) throw new Error(`não consegui criar a regra: ${error?.message ?? "sem linha"}`);
    const linha = criada as { id: string; name: string; is_active: boolean };
    void audit({
      action: "automation.rule_created",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "automation_rule",
      resourceId: linha.id,
      requestId: c.requestId,
      metadata: { name: regra.name, trigger_event: regra.trigger_event, via: "mcp_plataforma" },
    });
    avisos.push("A regra nasceu DESLIGADA, como na tela. Para ela rodar, chame plataforma_ligar_automacao.");
    return { regra: { id: linha.id, nome: linha.name, ligada: linha.is_active, desfecho: "criou", mudancas: [] }, avisos };
  }

  const patch: Record<string, unknown> = {};
  if (existente.name !== regra.name) patch.name = regra.name;
  if (existente.trigger_event !== regra.trigger_event) patch.trigger_event = regra.trigger_event;
  if (!mesmoConteudo(existente.conditions ?? [], regra.conditions)) patch.conditions = regra.conditions;
  if (!mesmoConteudo(semSegredos(existente.actions), regra.actions)) patch.actions = regra.actions;
  if (!mesmoConteudo(existente.trigger_config ?? {}, regra.trigger_config ?? {})) patch.trigger_config = regra.trigger_config ?? {};

  if (Object.keys(patch).length === 0) {
    return { regra: { id: existente.id, nome: existente.name, ligada: existente.is_active, desfecho: "ja_estava", mudancas: [] }, avisos };
  }

  // Regra ligada roda no próximo evento: editar o que ela faz é mexer no que já
  // fala com o cliente final, e montar não faz isso.
  if (existente.is_active) {
    throw new Recusa(
      `A regra «${existente.name}» está LIGADA, e a mudança valeria no próximo evento. ` +
        "Desligue a regra (plataforma_ligar_automacao com `ligada: false`), chame de novo e religue.",
    );
  }

  const conferido = updateAutomationRuleSchema.safeParse(patch);
  if (!conferido.success) recusaDoSchema(conferido.error);
  if (patch.actions !== undefined && temSegredo(existente.actions)) {
    throw new Recusa(
      `A regra «${existente.name}» tem um webhook com segredo gravado pela tela. Reescrever as ações por aqui apagaria o segredo. Edite esta regra pela tela (Automações).`,
    );
  }

  const { error: updErr } = await c.admin
    .from("automation_rules")
    .update({ ...conferido.data, updated_at: new Date().toISOString(), ...autoriaDaMudanca(atorDaImplantacao(c)) })
    .eq("id", existente.id)
    .eq("organization_id", c.orgId);
  if (updErr) {
    if (ehRecusaDaDemonstracao(updErr)) throw new Recusa(`${FRASE_DA_DEMONSTRACAO} Uma regra ligada não pode ganhar webhook nem aviso de grupo aqui.`);
    throw new Error(`não consegui atualizar a regra: ${updErr.message}`);
  }
  const mudancas = Object.keys(patch).map(
    (k) => ({ name: "nome", trigger_event: "gatilho", conditions: "condições", actions: "ações", trigger_config: "configuração do gatilho" })[k] ?? k,
  );
  void audit({
    action: "automation.rule_updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "automation_rule",
    resourceId: existente.id,
    requestId: c.requestId,
    metadata: { fields_changed: Object.keys(patch), via: "mcp_plataforma" },
  });
  return { regra: { id: existente.id, nome: regra.name, ligada: existente.is_active, desfecho: "atualizou", mudancas }, avisos };
}

function temSegredo(acoes: unknown): boolean {
  return Array.isArray(acoes) && acoes.some((a) => (a as { config?: { secret_enc?: unknown } } | null)?.config?.secret_enc !== undefined);
}

/** As ações sem o campo cifrado, para comparar com o que o pedido descreve. */
function semSegredos(acoes: unknown): unknown {
  if (!Array.isArray(acoes)) return [];
  return acoes.map((a) => {
    const acao = a as { type?: string; config?: Record<string, unknown> };
    if (!acao.config) return acao;
    const { secret_enc: _fora, ...config } = acao.config;
    return { ...acao, config };
  });
}

export async function ligarAutomacao(
  c: Implantacao,
  pedido: { regra: string; ligada: boolean },
): Promise<{ regra: { id: string; nome: string; ligada: boolean }; desfecho: "atualizou" | "ja_estava" }> {
  const regras = await lerRegras(c.admin, c.orgId);
  const regra = acharPorNomeOuId(regras, pedido.regra, (r) => r.name, {
    singular: "a regra de automação",
    comoListar: "Crie a regra com plataforma_garantir_automacao.",
  });
  if (regra.is_active === pedido.ligada) {
    return { regra: { id: regra.id, nome: regra.name, ligada: regra.is_active }, desfecho: "ja_estava" };
  }
  const { error } = await c.admin
    .from("automation_rules")
    .update({ is_active: pedido.ligada, updated_at: new Date().toISOString(), ...autoriaDaMudanca(atorDaImplantacao(c)) })
    .eq("id", regra.id)
    .eq("organization_id", c.orgId);
  if (error) {
    if (ehRecusaDaDemonstracao(error)) {
      throw new Recusa(`${FRASE_DA_DEMONSTRACAO} A regra «${regra.name}» chama um webhook ou avisa um grupo, e por isso não liga na empresa de demonstração.`);
    }
    throw new Error(`não consegui ${pedido.ligada ? "ligar" : "desligar"} a regra: ${error.message}`);
  }
  void audit({
    action: "automation.rule_updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "automation_rule",
    resourceId: regra.id,
    requestId: c.requestId,
    metadata: { is_active: pedido.ligada, via: "mcp_plataforma" },
  });
  return { regra: { id: regra.id, nome: regra.name, ligada: pedido.ligada }, desfecho: "atualizou" };
}

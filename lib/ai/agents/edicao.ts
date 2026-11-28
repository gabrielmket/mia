/**
 * EDITAR UM AGENTE DE IA — as três escritas que a tela do agente faz, num lugar
 * só: salvar rascunho, publicar e reverter para uma versão anterior.
 *
 * Moravam inline nas server actions de `app/app/ai/agents/[id]/_actions.ts`. O
 * MCP do CRM passou a oferecer as mesmas operações (dono corrigindo o prompt
 * pelo ChatGPT), e duas cópias da orquestração seriam duas réguas: a da tela e
 * a do MCP. Aqui fica a regra; a action e a ferramenta só traduzem quem chama.
 *
 * O que NÃO mudou ao extrair (é a mesma sequência, linha a linha):
 *   - rascunho: `versionCreateSchema` → agente da organização e não arquivado →
 *     `validarEscopoDaVersao` → o rascunho VIGENTE pela régua da tela
 *     (`escolherVersoesDaTela`, com o ponteiro `published_version_id`) → PATCH
 *     nele com `versionPatchSchema`, ou INSERT v(max+1) com nova tentativa em
 *     23505 → auditoria `ai_agent.version_updated` / `ai_agent.version_created`;
 *   - publicar: ids de ferramenta aceitos pelo catálogo → `publishAgentVersion`
 *     (`fn_publish_ai_agent_version`, a única que troca o ponteiro) →
 *     `event_log` + `ai_agent.published`;
 *   - reverter: clona a versão de origem num rascunho novo e o publica; se a
 *     publicação recusa, o rascunho clonado é apagado → `ai_agent.reverted`.
 *
 * O que é novo: quem chama passa o ATOR (pessoa ou token). Pela tela é a
 * pessoa; pelo MCP é o token da conexão, e a auditoria grava
 * `actor_api_token_id` — a mesma forma da rota REST.
 *
 * ⚠️ A organização vem SEMPRE de quem chama (sessão ou token), nunca do pedido.
 * O client é service-role: o filtro por `organization_id` em cada consulta é o
 * que separa os tenants aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { codigoDoEscopo, mensagemDoEscopo, validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { PUBLISH_ERROR_CODES, versionCreateSchema, versionPatchSchema } from "@/lib/ai/agents/validation";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { toolIdAceito } from "@/lib/mcp/servidor-externo/ids";
// Do catálogo estático, e não de `@/lib/mcp/tools`: as ferramentas do MCP que
// editam agentes importam ESTE módulo, e o índice delas importaria a si mesmo.
import { VALID_TOOL_IDS } from "@/lib/mcp/tools/catalog";
import { VERSION_COLUMNS, linhaDoRascunhoClonado, type LinhaDaVersao } from "./linha-da-versao";
// FORK MIA: a trava da IA (provedor, modelo, chave e modelo do Operador são da
// plataforma) mora AQUI desde que a v1.121 tirou estas escritas da action da tela:
// vale para a tela e para o MCP do CRM, que chama as mesmas funções pelo token.
import {
  iaPodeIrAoAr,
  MENSAGEM_IA_DA_PLATAFORMA,
  FREIOS_DE_GASTO,
  semCamposDaIa,
  travarIaDaVersaoNova,
} from "@/lib/ai/trava-da-ia";
import { TOKEN_NAO_ESCOLHE_IA, type QuemPedeIa } from "@/lib/ai/trava-da-ia-na-rota";

export { VERSION_COLUMNS, linhaDoRascunhoClonado, type LinhaDaVersao } from "./linha-da-versao";

/** Quem edita. Pela tela, a pessoa; pelo MCP, o token (e `userId` nulo). */
export interface AtorDaEdicao {
  userId: string | null;
  apiTokenId: string | null;
  requestId: string;
  /**
   * FORK MIA: quem pede, para a trava da IA (lib/ai/trava-da-ia.ts). A tela passa
   * o usuário da sessão. Ausente = quem não escolhe IA (o token do MCP, que é da
   * empresa e nunca da plataforma): falha fechada, a resposta mais restritiva.
   */
  quemPede?: QuemPedeIa;
  /**
   * FORK MIA (MIA-358): por onde a edição veio, quando não é a tela nem o token
   * da empresa. O MCP de plataforma age em nome de quem criou o token
   * (`userId`, sem `apiTokenId`), e sem isto a reversão dele seria lida na
   * trilha como um clique na tela. Vai para o `metadata` da auditoria.
   */
  via?: "mcp_plataforma";
}

/**
 * FORK MIA: sem `quemPede`, ninguém escolhe IA. A mesma constante das rotas com
 * token (`TOKEN_NAO_ESCOLHE_IA`): uma régua só. A cerca é o `describe` "edição
 * pelo token do MCP" em tests/unit/trava-da-ia-portas.test.ts.
 */
function quemPedeDa(ator: AtorDaEdicao): QuemPedeIa {
  return ator.quemPede ?? TOKEN_NAO_ESCOLHE_IA;
}

export type ResultadoDaEdicao<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string; details?: unknown };

export interface AgenteDaEdicao {
  id: string;
  kind: string;
  archived_at: string | null;
  name: string | null;
  description: string | null;
  priority: number | null;
  published_version_id: string | null;
}

async function proximoNumero(admin: SupabaseClient, orgId: string, agentId: string): Promise<number> {
  const { data: maxRow } = await admin
    .from("ai_agent_versions")
    .select("version_number")
    .eq("agent_id", agentId)
    .eq("organization_id", orgId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((maxRow as { version_number?: number } | null)?.version_number ?? 0) + 1;
}

async function lerAgente(admin: SupabaseClient, orgId: string, agentId: string): Promise<AgenteDaEdicao | null> {
  const { data } = await admin
    .from("ai_agents")
    .select("id, kind, archived_at, name, description, priority, published_version_id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as AgenteDaEdicao | null) ?? null;
}

// ---------------------------------------------------------------------------
// Salvar rascunho
// ---------------------------------------------------------------------------

export async function salvarRascunhoDaVersao(
  admin: SupabaseClient,
  args: { orgId: string; agentId: string; payload: unknown; ator: AtorDaEdicao },
): Promise<ResultadoDaEdicao<{ version_id: string; version_number: number; criada: boolean; agente: AgenteDaEdicao }>> {
  const { orgId, agentId, payload, ator } = args;

  const parsed = versionCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }
  const v = parsed.data;

  const agente = await lerAgente(admin, orgId, agentId);
  if (!agente) return { ok: false, error: "not_found" };
  if (agente.archived_at) return { ok: false, error: "agent_archived" };

  // O escopo aponta para coisas que EXISTEM nesta organização.
  const escopo = await validarEscopoDaVersao(admin, orgId, {
    provider: v.provider,
    pipeline_ids: v.pipeline_ids,
    knowledge_source_ids: v.knowledge_source_ids,
    skill_names: v.skill_names,
    credential_id: v.credential_id,
    channel_session_id: v.channel_session_id,
  });
  if (!escopo.ok) {
    return { ok: false, error: codigoDoEscopo(escopo), message: mensagemDoEscopo(escopo) };
  }

  // Em QUAL rascunho esta escrita cai — pela MESMA régua que a tela usa para
  // decidir qual versão abrir. Ver o histórico do defeito em `_actions.ts`
  // (rascunho SUPERADO não é regravado; o ponteiro é medida, não palpite).
  const { data: versoes } = await admin
    .from("ai_agent_versions")
    .select("id, version_number, status")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("version_number", { ascending: false });
  const { draft: rascunhoVigente } = escolherVersoesDaTela(versoes ?? [], agente.published_version_id ?? null);

  if (rascunhoVigente) {
    const patch = versionPatchSchema.safeParse(payload);
    if (!patch.success) {
      return { ok: false, error: "validation_failed", details: patch.error.flatten() };
    }
    // FORK MIA: provedor, modelo, chave e modelo do Operador são da plataforma.
    // Para quem não escolhe IA eles saem do patch, venha o que vier no corpo —
    // a tela só esconde o cartão, e o corpo se escreve à mão (lib/ai/trava-da-ia.ts).
    const update: Record<string, unknown> = semCamposDaIa(quemPedeDa(ator), { ...patch.data });
    const { data: atualizada, error } = await admin
      .from("ai_agent_versions")
      .update(update)
      .eq("id", rascunhoVigente.id)
      .eq("organization_id", orgId)
      .select(VERSION_COLUMNS)
      .single();
    if (error || !atualizada) {
      return { ok: false, error: "internal_error", message: error?.message };
    }
    void audit({
      action: "ai_agent.version_updated",
      actorUserId: ator.userId,
      actorApiTokenId: ator.apiTokenId,
      organizationId: orgId,
      resourceType: "ai_agent_version",
      resourceId: rascunhoVigente.id,
      requestId: ator.requestId,
      metadata: { agent_id: agentId, fields: Object.keys(update) },
    });
    return {
      ok: true,
      data: {
        version_id: rascunhoVigente.id,
        version_number: rascunhoVigente.version_number,
        criada: false,
        agente,
      },
    };
  }

  // FORK MIA: a versão nova de quem não escolhe IA herda a IA atual do agente,
  // não a do corpo (lib/ai/trava-da-ia.ts).
  const travada = await travarIaDaVersaoNova(
    admin,
    { user: quemPedeDa(ator), orgId, agenteDeReferencia: agentId },
    v,
  );
  if (!travada.ok) return { ok: false, error: "validation_failed", message: travada.mensagem };
  const ia = travada.corpo;

  // Cria rascunho v(max+1) com nova tentativa em 23505.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const numero = await proximoNumero(admin, orgId, agentId);
    const { data: criada, error } = await admin
      .from("ai_agent_versions")
      .insert({
        organization_id: orgId,
        agent_id: agentId,
        version_number: numero,
        system_prompt: v.system_prompt,
        provider: ia.provider,
        model: ia.model,
        credential_id: ia.credential_id,
        tool_ids: v.tool_ids,
        trigger_config: v.trigger_config ?? undefined,
        channel_session_id: v.channel_session_id,
        max_steps: v.max_steps,
        // FORK MIA (MIA-262): os freios de gasto que saíram da trava (para quem
        // não escolhe a IA, os da versão de referência; sem ela, o default).
        token_budget: ia.token_budget,
        cost_budget_cents: ia.cost_budget_cents,
        history_message_window: v.history_message_window,
        history_token_window: v.history_token_window,
        handoff_keywords: v.handoff_keywords,
        handoff_tool_enabled: v.handoff_tool_enabled,
        handoff_legal_enabled: v.handoff_legal_enabled,
        image_vision_enabled: v.image_vision_enabled,
        proposal_ai_draft_enabled: v.proposal_ai_draft_enabled,
        cases_enabled: v.cases_enabled,
        operator_enabled: v.operator_enabled,
        operator_model: ia.operator_model,
        operator_tool_ids: v.operator_tool_ids,
        pipeline_ids: v.pipeline_ids,
        knowledge_source_ids: v.knowledge_source_ids,
        skill_names: v.skill_names,
        split_messages: v.split_messages,
        split_max_chars: v.split_max_chars,
        inbound_debounce_ms: v.inbound_debounce_ms ?? null,
        reply_min_interval_ms: v.reply_min_interval_ms ?? null,
        followup: v.followup,
        voz_enabled: v.voz_enabled,
        voz_quando: v.voz_quando,
        status: "draft",
        created_by: ator.userId,
      })
      .select("id, version_number")
      .single();

    if (!error && criada) {
      void audit({
        action: "ai_agent.version_created",
        actorUserId: ator.userId,
        actorApiTokenId: ator.apiTokenId,
        organizationId: orgId,
        resourceType: "ai_agent_version",
        resourceId: criada.id,
        requestId: ator.requestId,
        metadata: { agent_id: agentId, version_number: criada.version_number },
      });
      return {
        ok: true,
        data: { version_id: criada.id, version_number: criada.version_number, criada: true, agente },
      };
    }
    if (error?.code !== "23505") {
      return { ok: false, error: "internal_error", message: error?.message };
    }
  }
  return { ok: false, error: "internal_error", message: "Conflito de versionamento." };
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

function registrarPublicacao(
  admin: SupabaseClient,
  orgId: string,
  r: { agent_id: string; version_id: string; previous_version_id: string | null; published_at: string },
): void {
  void admin
    .from("event_log")
    .insert({
      organization_id: orgId,
      event_type: "ai_agent.published",
      // `entity_kind` é NOT NULL sem default: sem ele o evento nunca é gravado.
      entity_kind: "ai_agent",
      payload: {
        agent_id: r.agent_id,
        version_id: r.version_id,
        previous_version_id: r.previous_version_id,
        published_at: r.published_at,
      },
    })
    .then(({ error }) => {
      if (error) logger.error("[ai_agents/edicao] event_log error", { error: error.message });
    });
}

function ferramentasInvalidas(toolIds: string[] | null | undefined): string[] {
  const validos = new Set<string>(VALID_TOOL_IDS as readonly string[]);
  return (toolIds ?? []).filter((t) => !toolIdAceito(t, validos));
}

export async function publicarVersao(
  admin: SupabaseClient,
  args: { orgId: string; agentId: string; versionId: string; ator: AtorDaEdicao },
): Promise<ResultadoDaEdicao<{ version_id: string; previous_version_id: string | null; published_at: string }>> {
  const { orgId, agentId, versionId, ator } = args;

  const { data: alvo } = await admin
    .from("ai_agent_versions")
    .select("id, agent_id, tool_ids, provider, model, credential_id, operator_model")
    .eq("id", versionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!alvo || (alvo as { agent_id: string }).agent_id !== agentId) {
    return { ok: false, error: "version_not_found" };
  }
  // FORK MIA: publicar aceita rascunho E versão antiga (`superseded`); sem esta
  // pergunta, pôr no ar a v5 trocava o modelo do agente sem tocar em campo de IA.
  if (
    !(await iaPodeIrAoAr(admin, {
      user: quemPedeDa(ator),
      orgId,
      agentId,
      versao: alvo as Record<string, unknown>,
    }))
  ) {
    return { ok: false, error: "ia_da_plataforma", message: MENSAGEM_IA_DA_PLATAFORMA };
  }
  const invalidas = ferramentasInvalidas((alvo as { tool_ids: string[] | null }).tool_ids);
  if (invalidas.length > 0) {
    return { ok: false, error: "tool_id_invalid", details: { invalid: invalidas } };
  }

  const r = await publishAgentVersion(admin, {
    orgId,
    agentId,
    versionId,
    quemPublicou: { actorUserId: ator.userId, actorApiTokenId: ator.apiTokenId, requestId: ator.requestId },
  });
  if (!r.ok) {
    return { ok: false, error: PUBLISH_ERROR_CODES.has(r.code as string) ? r.code : "internal_error" };
  }

  registrarPublicacao(admin, orgId, r);
  void audit({
    action: "ai_agent.published",
    actorUserId: ator.userId,
    actorApiTokenId: ator.apiTokenId,
    organizationId: orgId,
    resourceType: "ai_agent",
    resourceId: agentId,
    requestId: ator.requestId,
    metadata: { version_id: r.version_id, previous_version_id: r.previous_version_id },
  });

  return {
    ok: true,
    data: { version_id: r.version_id, previous_version_id: r.previous_version_id, published_at: r.published_at },
  };
}

// ---------------------------------------------------------------------------
// Reverter
// ---------------------------------------------------------------------------

/**
 * Cria uma nova versão idêntica a `versionId` e a publica. Mesma validação de
 * ferramentas e de escopo do publicar. Se a publicação recusa, o rascunho
 * clonado é apagado — reverter não deixa lixo no Histórico.
 */
export async function reverterParaVersao(
  admin: SupabaseClient,
  args: { orgId: string; agentId: string; versionId: string; ator: AtorDaEdicao },
): Promise<
  ResultadoDaEdicao<{ new_version_id: string; new_version_number: number; previous_version_id: string | null }>
> {
  const { orgId, agentId, versionId, ator } = args;

  const agente = await lerAgente(admin, orgId, agentId);
  if (!agente) return { ok: false, error: "not_found" };
  if (agente.archived_at) return { ok: false, error: "agent_archived" };

  const { data: origem } = await admin
    .from("ai_agent_versions")
    .select(VERSION_COLUMNS)
    .eq("id", versionId)
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (!origem) return { ok: false, error: "version_not_found" };
  const src = origem as unknown as LinhaDaVersao;

  const invalidas = ferramentasInvalidas(src.tool_ids);
  if (invalidas.length > 0) {
    return { ok: false, error: "tool_id_invalid", details: { invalid: invalidas } };
  }

  // FORK MIA: reverter volta o prompt, as ferramentas e o escopo daquela versão,
  // mas NÃO o cérebro dela. Para quem não escolhe IA, a cópia fica com a IA atual
  // do agente — senão "Reverter para a v5" era o jeito de voltar a um modelo
  // antigo que a plataforma já tinha trocado (lib/ai/trava-da-ia.ts).
  const travada = await travarIaDaVersaoNova(
    admin,
    { user: quemPedeDa(ator), orgId, agenteDeReferencia: agentId },
    {
      provider: src.provider,
      model: src.model,
      credential_id: src.credential_id,
      operator_model: src.operator_model,
    },
  );
  if (!travada.ok) return { ok: false, error: "validation_failed", message: travada.mensagem };
  const ia = travada.corpo;

  // Voltar a uma versão de quando a assinatura estava ligada regravaria o
  // provedor que a instalação desligou — a mesma régua do salvar. (FORK MIA:
  // confere o provedor que vai ser GRAVADO, o que saiu da trava acima.)
  const escopo = await validarEscopoDaVersao(admin, orgId, { provider: ia.provider });
  if (!escopo.ok) {
    return { ok: false, error: codigoDoEscopo(escopo), message: mensagemDoEscopo(escopo) };
  }

  let criadaId: string | null = null;
  let criadaNumero: number | null = null;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const numero = await proximoNumero(admin, orgId, agentId);
    const { data: criada, error } = await admin
      .from("ai_agent_versions")
      .insert({
        organization_id: orgId,
        agent_id: agentId,
        version_number: numero,
        ...linhaDoRascunhoClonado(src),
        // FORK MIA (MIA-262): para quem não escolhe a IA, os freios de gasto são
        // os da versão de referência (a trava os pôs no corpo), não os da antiga.
        ...Object.fromEntries(
          FREIOS_DE_GASTO.filter((c) => c in ia).map((c) => [c, (ia as unknown as Record<string, unknown>)[c]]),
        ),
        // FORK MIA: a IA que saiu da trava, não a da versão de origem.
        provider: ia.provider,
        model: ia.model,
        credential_id: ia.credential_id,
        operator_model: ia.operator_model,
        status: "draft",
        created_by: ator.userId,
      })
      .select("id, version_number")
      .single();
    if (!error && criada) {
      criadaId = criada.id;
      criadaNumero = criada.version_number;
      break;
    }
    if (error?.code !== "23505") {
      return { ok: false, error: "internal_error", message: error?.message };
    }
  }
  if (!criadaId || criadaNumero == null) {
    return { ok: false, error: "internal_error", message: "Conflito de versionamento." };
  }

  const r = await publishAgentVersion(admin, {
    orgId,
    agentId,
    versionId: criadaId,
    quemPublicou: { actorUserId: ator.userId, actorApiTokenId: ator.apiTokenId, requestId: ator.requestId },
  });
  if (!r.ok) {
    await admin
      .from("ai_agent_versions")
      .delete()
      .eq("id", criadaId)
      .eq("organization_id", orgId)
      .eq("status", "draft");
    return { ok: false, error: PUBLISH_ERROR_CODES.has(r.code as string) ? r.code : "internal_error" };
  }

  registrarPublicacao(admin, orgId, r);
  void audit({
    action: "ai_agent.reverted",
    actorUserId: ator.userId,
    actorApiTokenId: ator.apiTokenId,
    organizationId: orgId,
    resourceType: "ai_agent",
    resourceId: agentId,
    requestId: ator.requestId,
    metadata: {
      from_version_id: versionId,
      new_version_id: criadaId,
      new_version_number: criadaNumero,
      previous_version_id: r.previous_version_id,
      ...(ator.via ? { via: ator.via } : {}),
    },
  });

  return {
    ok: true,
    data: { new_version_id: criadaId, new_version_number: criadaNumero, previous_version_id: r.previous_version_id },
  };
}

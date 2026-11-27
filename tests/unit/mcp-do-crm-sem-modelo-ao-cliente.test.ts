// @vitest-environment node
/**
 * FORK MIA (MIA-304) — O MCP DO CRM NÃO DEVOLVE PROVEDOR NEM MODELO.
 *
 * Cerca do achado da MIA-262: `crm_list_ai_agents`, `crm_get_ai_agent_version`
 * e `crm_get_ai_agent_turn` devolviam `modelo` (e a segunda, `provedor`) ao
 * admin da empresa pelo ChatGPT. O MCP do CRM é sempre da EMPRESA: o token e a
 * conexão OAuth nunca são da plataforma (`TOKEN_NAO_ESCOLHE_IA`), e a IA é da
 * plataforma (`docs/fork/ia-da-plataforma.md`, seção 7). Quem precisa do modelo
 * de uma empresa usa o MCP de plataforma (`plataforma_ver_ia_das_empresas`).
 *
 * O banco falso TEM provedor e modelo em toda linha. Reprova se:
 *  - o campo (com qualquer um dos nomes) ou o valor voltar em alguma resposta;
 *  - uma das três leituras voltar a PEDIR as colunas ao banco;
 *  - papel abaixo de admin passar pelo portão das três;
 *  - o resto da leitura (versão, instruções, canal, ferramentas, turnos) sumir.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { crmGetAiAgentTurn, crmGetAiAgentVersion, crmListAiAgents } from "@/lib/mcp/tools/agentes";
import type { McpContext } from "@/lib/mcp/types";
import { ROLE_RANK, type Role } from "@/lib/auth/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "a1a1a1a1-0000-4000-8000-000000000001";
const CONVERSA = "c1c1c1c1-0000-4000-8000-000000000001";
const MODELO = "modelo-da-plataforma-x";
const PROVEDOR = "provedor-da-plataforma-y";

let pedidos: Array<{ tabela: string; colunas: string }> = [];

const TABELAS: Record<string, Array<Record<string, unknown>>> = {
  ai_agents: [
    { id: AGENTE, organization_id: ORG, name: "Atendente IA", kind: "inbox_agent", archived_at: null, paused_at: null, published_version_id: "v-pub" },
  ],
  ai_agent_versions: [
    {
      id: "v-pub",
      agent_id: AGENTE,
      organization_id: ORG,
      version_number: 7,
      status: "published",
      model: MODELO,
      provider: PROVEDOR,
      credential_id: "cred-1",
      operator_model: MODELO,
      channel_session_id: "canal-1",
      voz_enabled: false,
      voz_quando: "nunca",
      created_at: "2026-11-10T00:00:00Z",
      published_at: "2026-11-11T00:00:00Z",
      system_prompt: "Você é o atendente. Responda em português.",
      tool_ids: ["crm_search_contacts"],
      handoff_keywords: ["humano"],
      handoff_tool_enabled: true,
      handoff_legal_enabled: true,
      split_messages: true,
      split_max_chars: 600,
      image_vision_enabled: true,
    },
  ],
  channel_sessions: [{ id: "canal-1", organization_id: ORG, display_name: "Loja Exemplo", phone_number: null, provider: null }],
  conversations: [{ id: CONVERSA, organization_id: ORG }],
  agent_turn_traces: [
    {
      id: "t1",
      organization_id: ORG,
      conversation_id: CONVERSA,
      is_dry_run: false,
      created_at: "2026-11-12T00:00:00Z",
      agent_id: AGENTE,
      agent_version_id: "v-pub",
      status: "ok",
      abort_reason: null,
      error_code: null,
      provider: PROVEDOR,
      model: MODELO,
      messages_sent: 1,
      ferramentas: [],
      skills: [],
      historico_mensagens: 4,
      latency_ms: 900,
    },
  ],
  messages: [],
};

/** Banco falso que devolve só as colunas pedidas, como o PostgREST. */
function ctx(role: Role, actor: McpContext["actor"]): McpContext {
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let inFiltro: { k: string; ids: unknown[] } | null = null;
    let colunas = "*";
    const linhas = () =>
      (TABELAS[tabela] ?? [])
        .filter(
          (l) =>
            Object.entries(filtros).every(([k, v]) => l[k] === v) &&
            (inFiltro === null || inFiltro.ids.includes(l[inFiltro.k])),
        )
        .map((l) => {
          if (colunas.trim() === "*") return l;
          const nomes = colunas.split(",").map((c) => c.trim()).filter(Boolean);
          return Object.fromEntries(nomes.filter((n) => n in l).map((n) => [n, l[n]]));
        });
    const chain: Record<string, unknown> = {
      select: (c: string) => {
        colunas = c;
        pedidos.push({ tabela, colunas: c });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      eq: (k: string, v: unknown) => {
        filtros[k] = v;
        return chain;
      },
      in: (k: string, ids: unknown[]) => {
        inFiltro = { k, ids };
        return chain;
      },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => ok({ data: linhas(), error: null }),
    };
    return chain;
  };
  return {
    organizationId: ORG,
    role,
    actor,
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: { from } as unknown as McpContext["supabase"],
  } as McpContext;
}

const NOMES_PROIBIDOS = new Set(["modelo", "provedor", "model", "provider", "operator_model", "credential_id", "model_label"]);

/** Todas as chaves da resposta, em qualquer nível. */
function chaves(valor: unknown, acc: string[] = []): string[] {
  if (Array.isArray(valor)) valor.forEach((v) => chaves(v, acc));
  else if (valor && typeof valor === "object")
    for (const [k, v] of Object.entries(valor)) {
      acc.push(k);
      chaves(v, acc);
    }
  return acc;
}

const LEITURAS = [
  { nome: "crm_list_ai_agents", chamar: (c: McpContext) => crmListAiAgents.handler({}, c) },
  { nome: "crm_get_ai_agent_version", chamar: (c: McpContext) => crmGetAiAgentVersion.handler({ agent_id: AGENTE, versao: "publicada" }, c) },
  { nome: "crm_get_ai_agent_turn", chamar: (c: McpContext) => crmGetAiAgentTurn.handler({ conversation_id: CONVERSA, limite: 3 }, c) },
] as const;

/** Quem chega às três: o admin da empresa, por token ou pela conexão do ChatGPT. */
const QUEM_CHEGA: Array<[string, McpContext["actor"]]> = [
  ["admin da empresa por token", { type: "api_token", id: "tok-1", role: "admin" } as McpContext["actor"]],
  ["admin da empresa pelo ChatGPT (OAuth)", { type: "user", id: "usuario-1", role: "admin" }],
];

beforeEach(() => {
  pedidos = [];
});

describe.each(QUEM_CHEGA)("%s", (_quem, actor) => {
  it.each(LEITURAS.map((l) => [l.nome, l] as const))("%s: sem provedor nem modelo", async (_nome, leitura) => {
    const resposta = await leitura.chamar(ctx("admin", actor));
    expect(resposta).not.toHaveProperty("erro");
    expect(chaves(resposta).filter((k) => NOMES_PROIBIDOS.has(k))).toEqual([]);
    const texto = JSON.stringify(resposta);
    expect(texto).not.toContain(MODELO);
    expect(texto).not.toContain(PROVEDOR);
  });
});

describe("as leituras de resumo e de turno nem pedem as colunas", () => {
  it.each([
    ["crm_list_ai_agents", 0],
    ["crm_get_ai_agent_turn", 2],
  ] as const)("%s", async (_nome, i) => {
    await LEITURAS[i].chamar(ctx("admin", QUEM_CHEGA[0]![1]));
    const lidas = pedidos.filter((p) => p.tabela === "ai_agent_versions" || p.tabela === "agent_turn_traces");
    expect(lidas.length).toBeGreaterThan(0);
    for (const p of lidas) expect(p.colunas, p.tabela).not.toMatch(/\b(model|provider)\b/);
  });
});

/** A régua de `ensureRole` (lib/mcp/auth.ts), que o servidor aplica antes do handler. */
describe("papel por papel: abaixo de admin nem chega às três", () => {
  const ABAIXO: Role[] = ["viewer", "agent", "ai_operator", "manager"];
  it.each(LEITURAS.flatMap((l) => ABAIXO.map((r) => [l.nome, r] as const)))("%s recusa %s", (nome, role) => {
    const ferramenta = [crmListAiAgents, crmGetAiAgentVersion, crmGetAiAgentTurn].find((f) => f.name === nome)!;
    expect(ferramenta.requiresRole).toBe("admin");
    expect(ROLE_RANK[role]).toBeLessThan(ROLE_RANK[ferramenta.requiresRole]);
  });
});

describe("a função continua: o que o dono usa para corrigir o assistente", () => {
  const admin = () => ctx("admin", QUEM_CHEGA[0]![1]);

  it("lista: o assistente, o canal e a versão publicada", async () => {
    const r = (await crmListAiAgents.handler({}, admin())) as { assistentes: Array<Record<string, unknown>> };
    expect(r.assistentes[0]).toMatchObject({
      id: AGENTE,
      nome: "Atendente IA",
      canal: "Loja Exemplo",
      publicada: { versao: 7, voz: "nunca", publicada_em: "2026-11-11T00:00:00Z" },
    });
  });

  it("versão: as instruções, o canal, as ferramentas e a passagem para humano", async () => {
    const r = (await crmGetAiAgentVersion.handler({ agent_id: AGENTE, versao: "publicada" }, admin())) as Record<string, unknown>;
    expect(r).toMatchObject({
      versao: 7,
      estado: "publicada",
      instrucoes: "Você é o atendente. Responda em português.",
      canal: "Loja Exemplo",
      ferramentas: ["crm_search_contacts"],
      passar_para_humano: { palavras: ["humano"], pode_chamar_humano: true, assunto_juridico: true },
    });
  });

  it("turno: qual assistente e qual versão responderam", async () => {
    const r = (await crmGetAiAgentTurn.handler({ conversation_id: CONVERSA, limite: 3 }, admin())) as {
      turnos: Array<Record<string, unknown>>;
    };
    expect(r.turnos[0]).toMatchObject({
      assistente: { id: AGENTE, nome: "Atendente IA" },
      versao_das_instrucoes: 7,
      estado: "ok",
      mensagens_enviadas: 1,
    });
  });
});

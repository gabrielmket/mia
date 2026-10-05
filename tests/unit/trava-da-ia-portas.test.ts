/**
 * FORK MIA — TODA PORTA DO SERVIDOR RESPEITA "A IA DOS AGENTES É DA PLATAFORMA".
 *
 * A .56 escondeu o cartão da IA na tela do cliente, e o commit dela deixou dito:
 * "as rotas e ações do servidor ainda aceitam o provider/model que vierem no
 * corpo". Este arquivo é o ataque, porta a porta: o admin da EMPRESA manda
 * provedor, modelo, chave e modelo do Operador à mão — pelo devtools ou pela
 * API — e o que se mede é o que foi GRAVADO no banco (em memória, com tabelas
 * de verdade: tests/helpers/banco-em-memoria.ts), não o que a resposta diz.
 *
 * Cada porta tem o seu controle: o admin da PLATAFORMA manda o mesmo corpo e
 * grava o que escolheu. Sem o controle, uma porta que descartasse o campo para
 * todo mundo (ou que quebrasse) ficaria verde aqui.
 *
 * A régua mora em lib/ai/trava-da-ia.ts; a mesma regra, para quem escreve
 * direto no PostgREST, está no banco (migration 9002 e
 * tests/invariants/ia-dos-agentes-e-da-plataforma.test.ts).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "22222222-2222-4222-8222-222222222222";
const LEGADO = "22222222-2222-4222-8222-2222222222aa";
const CRED = "33333333-3333-4333-8333-333333333333";
const CRED_DO_ATAQUE = "33333333-3333-4333-8333-3333333333ff";
const CANAL = "44444444-4444-4444-8444-444444444444";
const ROTEADOR = "55555555-5555-4555-8555-555555555555";
/** Id da versão n: as rotas conferem formato de UUID. */
const V = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;

const CLIENTE = { id: "admin-da-empresa", idioma: "pt-BR", is_platform_admin: false, support: null };
const PLATAFORMA = { id: "dono-da-plataforma", idioma: "pt-BR", is_platform_admin: true, support: null };

const estado = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  banco: null as unknown as ReturnType<typeof bancoEmMemoria>,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    org: { orgId: "11111111-1111-4111-8111-111111111111", role: "admin", name: "Org" },
    user: estado.user,
  })),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({ email: "x@example.com", full_name: "X", ...estado.user })),
  resolveActiveOrg: vi.fn(async () => ({
    orgId: "11111111-1111-4111-8111-111111111111",
    name: "Org",
    role: "admin",
  })),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
  supportWriteError: vi.fn(() => null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.banco.cliente }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => estado.banco.cliente }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/agents/escopo", () => ({
  validarEscopoDaVersao: vi.fn(async () => ({ ok: true })),
  mensagemDoEscopo: () => "Escopo inválido.",
}));
vi.mock("@/lib/ai/agents/publish", () => ({
  publishAgentVersion: vi.fn(async (_admin: unknown, a: { agentId: string; versionId: string }) => ({
    ok: true,
    agent_id: a.agentId,
    version_id: a.versionId,
    previous_version_id: null,
    published_at: "2026-09-29T00:00:00Z",
  })),
}));
vi.mock("@/lib/ai/agents/first-publication", () => ({
  publishFirstVersion: vi.fn(async () => ({ published: true })),
}));
vi.mock("@/lib/ai/credenciais/guardar", () => ({
  guardarCredencial: vi.fn(async () => ({ ok: true, id: "c", last4: "1234" })),
  rotacionarCredencial: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/ai/pontos/padrao-da-organizacao", () => ({
  definirPadraoDeIaDaOrganizacao: vi.fn(async () => ({ ok: true, provider: "openai", modelo: "luna" })),
}));

import { publishFirstVersion } from "@/lib/ai/agents/first-publication";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { guardarCredencial } from "@/lib/ai/credenciais/guardar";

import {
  createMcpAgentAction,
  publishAgentAction,
  revertToVersionAction,
  saveAgentDraftAction,
} from "@/app/app/ai/agents/[id]/_actions";
import { duplicateAgentAction } from "@/app/app/ai/agents/_actions";
import { salvarChaveDaIa } from "@/app/actions/onboarding/chaveDaIa";
import { POST as criarAgente } from "@/app/api/v1/ai/agents/route";
import { PATCH as editarAgente } from "@/app/api/v1/ai/agents/[id]/route";
import { POST as duplicarAgente } from "@/app/api/v1/ai/agents/[id]/duplicate/route";
import { POST as publicarVersao } from "@/app/api/v1/ai/agents/[id]/publish/route";
import { POST as reconciliar } from "@/app/api/v1/ai/agents/[id]/reconcile/route";
import { POST as criarVersao } from "@/app/api/v1/ai/agents/[id]/versions/route";
import { PATCH as editarVersao } from "@/app/api/v1/ai/agents/[id]/versions/[vid]/route";
import { DELETE as apagarChave, PATCH as editarChave } from "@/app/api/v1/ai/credentials/[id]/route";
import {
  GET as painelDeProvedores,
  PATCH as padraoDaEmpresa,
  PUT as modeloDoPonto,
} from "@/app/api/v1/ai/providers/route";
import { POST as criarRoteador } from "@/app/api/v1/ai/routers/route";
import { PATCH as editarRoteador } from "@/app/api/v1/ai/routers/[id]/route";

/** O que o atacante manda à mão em toda porta. */
const ATAQUE = {
  provider: "anthropic",
  model: "claude-opus-4-7",
  credential_id: CRED_DO_ATAQUE,
  operator_model: "o3-pro",
} as const;
/** A IA que a plataforma pôs no agente e que tem de sobreviver ao ataque. */
const IA_ATUAL = { provider: "openai", model: "luna", credential_id: CRED, operator_model: null };

function versao(n: number, model: string, status: string, extra: Linha = {}): Linha {
  return {
    id: V(n),
    organization_id: ORG,
    agent_id: AGENTE,
    version_number: n,
    status,
    system_prompt: `prompt da v${n}, com texto suficiente`,
    provider: "openai",
    model,
    credential_id: CRED,
    operator_model: null,
    tool_ids: [],
    trigger_config: null,
    channel_session_id: CANAL,
    max_steps: 10,
    token_budget: 50000,
    cost_budget_cents: 50,
    history_message_window: 20,
    history_token_window: 8000,
    handoff_keywords: [],
    handoff_tool_enabled: true,
    proposal_ai_draft_enabled: true,
    cases_enabled: false,
    operator_enabled: false,
    operator_tool_ids: [],
    pipeline_ids: [],
    knowledge_source_ids: [],
    split_messages: false,
    split_max_chars: 600,
    followup: { enabled: false, flow_pointer_ids: [] },
    ...extra,
  };
}

function novoBanco() {
  return bancoEmMemoria({
    organizations: [{ id: ORG, settings: { llm: { provider: "openai" } } }],
    platform_ia: [{ id: 1, provider: "openai", model_id: "luna" }],
    ai_agents: [
      {
        id: AGENTE,
        organization_id: ORG,
        kind: "mcp_agent",
        name: "Ana",
        description: null,
        priority: 0,
        archived_at: null,
        published_version_id: V(5),
        system_prompt: "prompt do cadastro",
        model: "openai/luna",
        config: { temperature: 0.4, voice_model: "gpt-realtime" },
        guardrails: [],
      },
      {
        id: LEGADO,
        organization_id: ORG,
        kind: "rag_bot",
        name: "Legado",
        archived_at: null,
        published_version_id: null,
        system_prompt: "prompt legado",
        model: "anthropic/claude-sonnet-4-6",
        config: { temperature: 0.4, voice_model: "gpt-realtime" },
        guardrails: [],
      },
    ],
    // O retrato da produção: rascunho antigo e versão superada com o modelo de
    // ANTES, e a versão no ar com o de agora.
    ai_agent_versions: [versao(2, "terra", "draft"), versao(3, "terra", "superseded"), versao(5, "luna", "published")],
    channel_sessions: [{ id: CANAL, organization_id: ORG, archived_at: null, status: "WORKING" }],
    ai_routers: [
      {
        id: ROTEADOR,
        organization_id: ORG,
        name: "r",
        channel_session_id: CANAL,
        config: { classifier_model: "mini", sticky: true },
      },
    ],
  });
}

const CORPO_DA_VERSAO = {
  system_prompt: "Você é a recepção. Atenda com educação.",
  ...ATAQUE,
  tool_ids: [],
  channel_session_id: CANAL,
  followup: { enabled: false, flow_pointer_ids: [] },
};

function req(url: string, metodo: string, corpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
}
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

/** A IA da ÚLTIMA versão gravada (insert) em `ai_agent_versions`. */
function iaGravada() {
  const ins = estado.banco.escritas.filter((e) => e.tabela === "ai_agent_versions" && e.op === "insert").at(-1);
  expect(ins, "nenhuma versão foi gravada").toBeDefined();
  const l = ins!.linhas[0]!;
  return { provider: l.provider, model: l.model, credential_id: l.credential_id ?? null, operator_model: l.operator_model ?? null };
}

function como(user: typeof CLIENTE | typeof PLATAFORMA) {
  estado.user = user;
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.banco = novoBanco();
  como(CLIENTE);
});

describe("editor de agente (ações do servidor)", () => {
  it("salvar rascunho NOVO: a versão do cliente sai com a IA atual; a da plataforma, com a escolhida", async () => {
    const r = await saveAgentDraftAction(AGENTE, CORPO_DA_VERSAO);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(iaGravada()).toEqual(IA_ATUAL);

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await saveAgentDraftAction(AGENTE, CORPO_DA_VERSAO);
    expect(iaGravada()).toEqual(ATAQUE);
  });

  it("salvar rascunho EXISTENTE: o patch do cliente não leva a IA; o resto grava", async () => {
    estado.banco.tabela("ai_agent_versions").push(versao(6, "luna", "draft"));
    const r = await saveAgentDraftAction(AGENTE, CORPO_DA_VERSAO);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const v6 = estado.banco.tabela("ai_agent_versions").find((v) => v.id === V(6))!;
    expect({ provider: v6.provider, model: v6.model, credential_id: v6.credential_id, operator_model: v6.operator_model }).toEqual(IA_ATUAL);
    expect(v6.system_prompt).toBe(CORPO_DA_VERSAO.system_prompt);
  });

  it("criar agente: o do cliente nasce com o par da plataforma e a chave da instalação", async () => {
    const r = await createMcpAgentAction({ name: "Novo", version: CORPO_DA_VERSAO });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(iaGravada()).toEqual({ provider: "openai", model: "luna", credential_id: null, operator_model: null });

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await createMcpAgentAction({ name: "Novo", version: CORPO_DA_VERSAO });
    expect(iaGravada()).toEqual(ATAQUE);
  });

  it("reverter para a v3 (modelo antigo): o cliente volta o conteúdo, não o cérebro", async () => {
    const r = await revertToVersionAction(AGENTE, V(3));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(iaGravada()).toEqual(IA_ATUAL);

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await revertToVersionAction(AGENTE, V(3));
    expect(iaGravada().model).toBe("terra");
  });

  it("publicar a v3 (modelo antigo): recusado para o cliente, liberado para a plataforma", async () => {
    const r = await publishAgentAction(AGENTE, V(3));
    expect(r).toMatchObject({ ok: false, error: "ia_da_plataforma" });
    expect(publishAgentVersion).not.toHaveBeenCalled();

    como(PLATAFORMA);
    expect((await publishAgentAction(AGENTE, V(3))).ok).toBe(true);
  });

  it("CONTROLE: o cliente publica o rascunho que tem a IA atual", async () => {
    estado.banco.tabela("ai_agent_versions").push(versao(6, "luna", "draft"));
    expect((await publishAgentAction(AGENTE, V(6))).ok).toBe(true);
  });

  it("duplicar pela lista: a cópia do cliente leva a IA atual, não a do rascunho antigo", async () => {
    const r = await duplicateAgentAction(AGENTE);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(iaGravada()).toEqual(IA_ATUAL);

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await duplicateAgentAction(AGENTE);
    expect(iaGravada().model).toBe("terra");
  });
});

describe("API REST de agentes", () => {
  it("POST /agents com versão: o do cliente nasce com o par da plataforma", async () => {
    const res = await criarAgente(req("/api/v1/ai/agents", "POST", { name: "Novo", version: CORPO_DA_VERSAO }));
    expect(res.status).toBe(201);
    expect(iaGravada()).toEqual({ provider: "openai", model: "luna", credential_id: null, operator_model: null });

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await criarAgente(req("/api/v1/ai/agents", "POST", { name: "Novo", version: CORPO_DA_VERSAO }));
    expect(iaGravada()).toEqual(ATAQUE);
  });

  it("POST /agents legado: o modelo do cliente não vale — o cadastro e a v1 nascem com a IA da plataforma", async () => {
    // Desde a 1.73 do upstream o corpo legado também nasce com versão (issue
    // #1357): o `model` dele vira o modelo da v1, a trava o troca pelo par da
    // plataforma, e o cadastro do agente espelha a v1.
    await criarAgente(
      req("/api/v1/ai/agents", "POST", { name: "Legado novo", model: "anthropic/claude-opus-4-7" }),
    );
    const ins = estado.banco.escritas.filter((e) => e.tabela === "ai_agents" && e.op === "insert").at(-1)!;
    expect(ins.linhas[0]!.model).toBe("openai/luna");
    const v1 = estado.banco.escritas.filter((e) => e.tabela === "ai_agent_versions" && e.op === "insert").at(-1)!;
    expect(v1.linhas[0]!.provider).toBe("openai");
    expect(v1.linhas[0]!.model).toBe("luna");
  });

  it("PATCH /agents/:id: o cliente não troca modelo do cadastro nem modelo de voz", async () => {
    // Agente sem versão no ar: é onde o upstream deixa gravar `model` no cadastro
    // (com versão no ar, `model` no corpo é 409 para todo mundo, como antes).
    const res = await editarAgente(
      req(`/api/v1/ai/agents/${LEGADO}`, "PATCH", {
        name: "Legado renomeado",
        model: "anthropic/claude-opus-4-7",
        config: { voice_model: "gpt-realtime-mini", temperature: 0.2 },
      }),
      ctx({ id: LEGADO }),
    );
    expect(res.status).toBe(200);
    const agente = estado.banco.tabela("ai_agents").find((a) => a.id === LEGADO)!;
    expect(agente.name).toBe("Legado renomeado");
    expect(agente.model).toBe("anthropic/claude-sonnet-4-6");
    expect((agente.config as Record<string, unknown>).voice_model).toBe("gpt-realtime");
    expect((agente.config as Record<string, unknown>).temperature).toBe(0.2);

    como(PLATAFORMA);
    await editarAgente(
      req(`/api/v1/ai/agents/${LEGADO}`, "PATCH", { model: "anthropic/claude-opus-4-7" }),
      ctx({ id: LEGADO }),
    );
    expect(estado.banco.tabela("ai_agents").find((a) => a.id === LEGADO)!.model).toBe("anthropic/claude-opus-4-7");
  });

  it("POST /versions: a versão nova do cliente herda a IA atual", async () => {
    const res = await criarVersao(req(`/api/v1/ai/agents/${AGENTE}/versions`, "POST", CORPO_DA_VERSAO), ctx({ id: AGENTE }));
    expect(res.status).toBe(201);
    expect(iaGravada()).toEqual(IA_ATUAL);

    estado.banco = novoBanco();
    como(PLATAFORMA);
    await criarVersao(req(`/api/v1/ai/agents/${AGENTE}/versions`, "POST", CORPO_DA_VERSAO), ctx({ id: AGENTE }));
    expect(iaGravada()).toEqual(ATAQUE);
  });

  it("PATCH /versions/:vid: só IA no corpo é recusado; misturado, a IA some e o resto grava", async () => {
    estado.banco.tabela("ai_agent_versions").push(versao(6, "luna", "draft"));
    const url = `/api/v1/ai/agents/${AGENTE}/versions/${V(6)}`;

    const soIa = await editarVersao(req(url, "PATCH", { model: "claude-opus-4-7" }), ctx({ id: AGENTE, vid: V(6) }));
    expect(soIa.status).toBe(403);

    const misto = await editarVersao(
      req(url, "PATCH", { system_prompt: "Prompt novo com texto suficiente.", ...ATAQUE }),
      ctx({ id: AGENTE, vid: V(6) }),
    );
    expect(misto.status).toBe(200);
    const v6 = estado.banco.tabela("ai_agent_versions").find((v) => v.id === V(6))!;
    expect(v6.model).toBe("luna");
    expect(v6.credential_id).toBe(CRED);
    expect(v6.system_prompt).toBe("Prompt novo com texto suficiente.");
  });

  it("POST /publish da v3: recusado ao cliente, liberado à plataforma", async () => {
    const nao = await publicarVersao(req("/x", "POST", { version_id: V(99) }), ctx({ id: AGENTE }));
    // id que não existe: 404 — a trava não mascara o "não achei".
    expect(nao.status).toBe(404);

    const cliente = await publicarVersao(req("/x", "POST", { version_id: V(3) }), ctx({ id: AGENTE }));
    expect(cliente.status).toBe(403);
    expect(publishAgentVersion).not.toHaveBeenCalled();

    como(PLATAFORMA);
    const plataforma = await publicarVersao(req("/x", "POST", { version_id: V(3) }), ctx({ id: AGENTE }));
    expect(plataforma.status).toBe(200);
  });

  it("POST /duplicate: a cópia do cliente leva a IA atual", async () => {
    const res = await duplicarAgente(req(`/x`, "POST"), ctx({ id: AGENTE }));
    expect(res.status).toBe(201);
    expect(iaGravada()).toEqual(IA_ATUAL);
  });

  it("POST /reconcile: o legado do cliente vai ao ar com o par da plataforma, não com a chave do corpo", async () => {
    await reconciliar(
      req(`/x`, "POST", { channel_id: CANAL, provider: "anthropic", model: "claude-opus-4-7", credential_id: CRED_DO_ATAQUE }),
      ctx({ id: LEGADO }),
    );
    expect(vi.mocked(publishFirstVersion).mock.calls[0]?.[5]).toEqual({
      channelId: CANAL,
      provider: "openai",
      model: "luna",
      credentialId: null,
    });
  });
});

describe("chave, provedores e roteador", () => {
  it("credenciais: trocar e apagar a chave são da plataforma", async () => {
    const id = { id: CRED };
    expect((await editarChave(req(`/x`, "PATCH", { label: "minha" }), ctx(id))).status).toBe(403);
    expect((await apagarChave(req(`/x`, "DELETE"), ctx(id))).status).toBe(403);

    como(PLATAFORMA);
    expect((await apagarChave(req(`/x`, "DELETE"), ctx(id))).status).not.toBe(403);
  });

  it("provedores: modelo por ponto e padrão da empresa são da plataforma", async () => {
    expect((await modeloDoPonto(req(`/x`, "PUT", { purpose: "compaction", provider: "openai", model_id: "x" }))).status).toBe(403);
    expect((await padraoDaEmpresa(req(`/x`, "PATCH", { provider: "openai", default_model: "x" }))).status).toBe(403);
    expect(estado.banco.escritas).toEqual([]);

    como(PLATAFORMA);
    expect((await padraoDaEmpresa(req(`/x`, "PATCH", { provider: "openai", default_model: "x" }))).status).not.toBe(403);
  });

  // A e2e do upstream que prova o painel (prova-painel-provedores) passou a
  // dirigi-lo como dono da plataforma, porque é ele quem edita aqui. O que ela
  // provava do cliente — ver o painel e os seletores — vira isto: o cliente VÊ
  // o painel (200, com os pontos), mas sem controle de edição.
  it("provedores: o cliente vê o painel só de leitura; a plataforma edita", async () => {
    const doCliente = await painelDeProvedores();
    expect(doCliente.status).toBe(200);
    const corpoDoCliente = (await doCliente.json()) as { data: { podeEditar: boolean; pontos: unknown[] } };
    expect(corpoDoCliente.data.pontos.length).toBeGreaterThan(0);
    expect(corpoDoCliente.data.podeEditar).toBe(false);

    como(PLATAFORMA);
    const daPlataforma = (await (await painelDeProvedores()).json()) as { data: { podeEditar: boolean } };
    expect(daPlataforma.data.podeEditar).toBe(true);
  });

  it("roteador: o novo do cliente nasce no Automático; o existente não troca de classificador", async () => {
    const criado = await criarRoteador(
      req(`/x`, "POST", {
        name: "novo",
        channel_session_id: CANAL,
        config: { classifier_model: "o3-pro", classifier_provider: "openai", sticky: false },
      }),
    );
    expect(criado.status).toBe(201);
    const ins = estado.banco.escritas.find((e) => e.tabela === "ai_routers" && e.op === "insert")!;
    expect(ins.linhas[0]!.config).toEqual({ sticky: false, classifier_model: null, classifier_provider: null });

    await editarRoteador(req(`/x`, "PATCH", { config: { classifier_model: "o3-pro", sticky: false } }), ctx({ id: ROTEADOR }));
    const r = estado.banco.tabela("ai_routers").find((x) => x.id === ROTEADOR)!;
    expect(r.config).toEqual({ classifier_model: "mini", sticky: false });

    como(PLATAFORMA);
    await editarRoteador(req(`/x`, "PATCH", { config: { classifier_model: "o3-pro" } }), ctx({ id: ROTEADOR }));
    expect((estado.banco.tabela("ai_routers").find((x) => x.id === ROTEADOR)!.config as Linha).classifier_model).toBe("o3-pro");
  });

  it("onboarding: colar a chave da IA é da plataforma", async () => {
    const form = new FormData();
    form.set("provider", "openai");
    form.set("api_key", "sk-do-cliente-1234567890");
    const r = await salvarChaveDaIa(form);
    expect(r.ok).toBe(false);
    expect(guardarCredencial).not.toHaveBeenCalled();

    como(PLATAFORMA);
    await salvarChaveDaIa(form);
    expect(guardarCredencial).toHaveBeenCalled();
  });
});

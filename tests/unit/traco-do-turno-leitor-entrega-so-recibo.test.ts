import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/ai/turn-traces/route";
import { COLUNAS_DO_TRACO } from "@/lib/agent-engine/agent/recibo-do-traco";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// FORK MIA (MIA-251 G): desde a 9175 a plataforma lê o traço pelo cliente admin;
// o gerente, pela sessão. O mesmo banco falso responde pelos dois.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AI_TELEMETRY_RETENTION_DAYS: undefined } }));

const ID = "b3201000-0000-4000-8000-000000000001";
const PESSOAL = "Pessoa Sintética recibo3201@example.test +5511999032010 123.456.789-09";
const SEGREDO = "sk-synthetic-3201-never-real-never-used";

function banco(data: unknown[], error: unknown = null) {
  const query: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "gte", "lt", "order", "limit"]) query[metodo] = () => query;
  query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return { from: () => query };
}

/** FORK MIA (MIA-251 G): o mesmo banco falso pela sessão e pelo cliente admin. */
function usarBanco(cliente: unknown) {
  vi.mocked(createClient).mockResolvedValue(cliente as never);
  vi.mocked(createAdminClient).mockReturnValue(cliente as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    // FORK MIA (MIA-262): provedor, modelo, tokens e custo do recibo são da
    // plataforma; a projeção é conferida pelo admin dela. O gerente da empresa
    // está no último caso deste arquivo.
    user: { id: ID, idioma: "pt-BR", is_platform_admin: true, support: null },
    org: { orgId: ID, role: "manager" },
  } as never);
});

const pedir = () => GET(new NextRequest("http://localhost/api/v1/ai/turn-traces"));

describe("o leitor entrega recibos e não o texto livre guardado no legado", () => {
  it("projeta conteúdo técnico e remove PII, segredo e chaves JSON arbitrárias", async () => {
    usarBanco(
      banco([
        {
          id: ID,
          job_id: ID,
          preview_run_id: null,
          conversation_id: ID,
          contact_id: ID,
          agent_id: ID,
          agent_version_id: ID,
          is_dry_run: false,
          status: "failed",
          abort_reason: PESSOAL,
          error_code: "TypeError",
          error_message: `${PESSOAL} ${SEGREDO}`,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          messages_sent: 0,
          historico_mensagens: null,
          tokens_in: 10,
          tokens_out: 5,
          cost_cents: 1,
          latency_ms: 25,
          skills: [{ nome: PESSOAL, versao_id: ID, gatilho: SEGREDO, extra: PESSOAL }],
          ferramentas: [
            {
              nome: "crm_get_contact",
              estado: "falhou",
              erro: `${PESSOAL} ${SEGREDO}`,
              duracao_ms: 12,
              arguments: { body: PESSOAL },
            },
            { nome: PESSOAL, estado: SEGREDO, erro: { body: PESSOAL }, duracao_ms: PESSOAL },
          ],
          ferramentas_truncadas: false,
          kb_sources: [{ id: ID, versao: ID, hash: "a".repeat(64), ligada: true, body: PESSOAL }],
          created_at: new Date().toISOString(),
          extra: PESSOAL,
        },
      ]) as never,
    );
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    const payload = await resposta.json();
    const texto = JSON.stringify(payload);
    for (const proibido of [
      PESSOAL,
      SEGREDO,
      "recibo3201@example.test",
      "arguments",
      "error_message",
      "extra",
      '"body"',
    ])
      expect(texto).not.toContain(proibido);
    const traco = payload.data.tracos[0];
    expect(traco).toMatchObject({
      id: ID,
      error_code: "TypeError",
      abort_reason: null,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      tokens_in: 10,
      tokens_out: 5,
    });
    expect(traco.ferramentas).toEqual([
      { nome: "crm_get_contact", estado: "falhou", erro: "internal_error", duracao_ms: 12 },
      { nome: null, estado: null, erro: "internal_error", duracao_ms: null },
    ]);
    expect(traco.skills).toEqual([{ versao_id: ID }]);
    expect(traco.kb_sources).toEqual([{ id: ID, versao: ID, hash: "a".repeat(64), ligada: true }]);
    expect(COLUNAS_DO_TRACO).not.toContain("error_message");
  });

  it("um código livre não vira recibo só por caber em uma string", async () => {
    usarBanco(
      banco([
        {
          id: ID,
          status: "failed",
          error_code: PESSOAL,
          abort_reason: SEGREDO,
          ferramentas: [],
          skills: [],
          kb_sources: [],
        },
      ]) as never,
    );
    const payload = await (await pedir()).json();
    expect(payload.data.tracos[0]).toMatchObject({
      error_code: "internal_error",
      abort_reason: null,
    });
    expect(JSON.stringify(payload)).not.toContain(PESSOAL);
    expect(JSON.stringify(payload)).not.toContain(SEGREDO);
  });

  it("um erro de consulta retorna fail genérico sem ecoar valores de banco", async () => {
    usarBanco(
      banco([], { message: `${PESSOAL} ${SEGREDO}` }) as never,
    );
    const resposta = await pedir();
    expect(resposta.status).toBe(500);
    const payload = await resposta.json();
    expect(payload).toMatchObject({ error: { code: "query_failed" } });
    expect(JSON.stringify(payload)).not.toContain(PESSOAL);
    expect(JSON.stringify(payload)).not.toContain(SEGREDO);
  });

  it("uma exceção inesperada de consulta também respeita a resposta canônica", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error(`${PESSOAL} ${SEGREDO}`));
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error(`${PESSOAL} ${SEGREDO}`);
    });
    const resposta = await pedir();
    expect(resposta.status).toBe(500);
    const payload = await resposta.json();
    expect(payload).toMatchObject({ error: { code: "query_failed" } });
    expect(JSON.stringify(payload)).not.toContain(PESSOAL);
    expect(JSON.stringify(payload)).not.toContain(SEGREDO);
  });
});

describe("FORK MIA (MIA-262): o gerente da empresa recebe o recibo sem a IA da plataforma", () => {
  it("provedor, modelo, tokens e custo vêm nulos; o status e o erro ficam", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: ID, idioma: "pt-BR", is_platform_admin: false, support: null },
      org: { orgId: ID, role: "manager" },
    } as never);
    usarBanco(
      banco([
        {
          id: ID,
          status: "failed",
          error_code: "TypeError",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          tokens_in: 10,
          tokens_out: 5,
          cost_cents: 3,
          created_at: "2026-11-20T12:00:00.000Z",
        },
      ]) as never,
    );
    const payload = await (await pedir()).json();
    const traco = payload.data.tracos[0];
    expect(traco).toMatchObject({ id: ID, status: "failed", error_code: "TypeError" });
    expect(traco).toMatchObject({ provider: null, model: null, tokens_in: null, tokens_out: null, cost_cents: null });
  });
});

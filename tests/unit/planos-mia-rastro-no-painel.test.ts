/**
 * FORK MIA (MIA-256) — O ANTES E O DEPOIS DO PLANO PELO PAINEL.
 *
 * As rotas da aba Planos (`POST`/`PATCH /api/v1/admin/cobranca/planos`, do
 * upstream, com uma linha nossa) e o preço do setup
 * (`PUT /api/v1/admin/planos-mia/[id]/setup`) gravam na auditoria o antes e o
 * depois, só dos campos que mudaram. Os testes do upstream das rotas ficam como
 * estão: estes moram aqui para não somar conflito na fusão.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { argumentos, bancoFalso, operacao, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({
  ator: "aaaaaaaa-0000-4000-8000-000000000001",
  escrita: vi.fn(),
  audit: vi.fn(),
  banco: undefined as unknown as BancoFalso,
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: async () => false, loadAuthUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/requirePlatformAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/requirePlatformAdmin")>()),
  requirePlatformAdminEscrita: h.escrita,
}));
vi.mock("@/lib/instalacao/modulos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instalacao/modulos")>()),
  moduloLigado: async (_db: unknown, modulo: string) => modulo === "cobranca",
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/cobranca/configuracao", () => ({ provedorDaInstalacao: async () => "stripe" }));

import { POST } from "@/app/api/v1/admin/cobranca/planos/route";
import { PATCH } from "@/app/api/v1/admin/cobranca/planos/[id]/route";
import { PUT as PUT_SETUP } from "@/app/api/v1/admin/planos-mia/[id]/setup/route";

const ID = "cccccccc-0000-4000-8000-000000000001";
const ATUAL = {
  id: ID,
  nome: "Básico",
  preco_cents: 4990,
  moeda: "BRL",
  intervalo: "mes",
  trial_dias: 7,
  max_assentos: 3,
  max_canais: 1,
  teto_ia_usd_cents: null,
  padrao_no_cadastro: false,
  oferecido_ao_cliente: true,
  arquivado_em: null as string | null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const metadataDa = (acao: string) =>
  (h.audit.mock.calls.map(([e]) => e).find((e) => e.action === acao) as { metadata: Record<string, unknown> } | undefined)?.metadata;

let setup: number | null;
function responder(c: Cadeia): Resposta {
  if (c.tabela === "cobranca_assinaturas") return { count: 0 };
  if (c.tabela === "mia_plano_setup") return operacao(c) === "select" ? { data: setup === null ? null : { preco_cents: setup } } : {};
  if (operacao(c) === "insert") return { data: { ...ATUAL, ...(argumentos(c, "insert")?.[0] as object) } };
  if (operacao(c) === "update") return { data: { ...ATUAL, ...(argumentos(c, "update")?.[0] as object), updated_at: "2026-11-26T00:00:00Z" } };
  return { data: { ...ATUAL } };
}

beforeEach(() => {
  vi.clearAllMocks();
  setup = null;
  h.escrita.mockResolvedValue({ user: { id: h.ator }, platformAdmin: { user_id: h.ator, scope: "full", mfa_required: false } });
  h.banco = bancoFalso(responder);
});

describe("o antes e o depois pelo painel", () => {
  it("⭐ PATCH: só os campos que mudaram, com o valor anterior", async () => {
    const res = await PATCH(json(`http://localhost/api/v1/admin/cobranca/planos/${ID}`, "PATCH", { nome: "Essencial", trial_dias: 7, max_canais: 2 }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(200);
    const m = metadataDa("cobranca.plano_salvo")!;
    expect(m.antes).toEqual({ nome: "Básico", max_canais: 1 });
    expect(m.depois).toEqual({ nome: "Essencial", max_canais: 2 });
  });

  it("POST: o antes é nulo e o depois é o plano criado", async () => {
    const corpo = { nome: "Novo", preco_cents: 9700, intervalo: "mes", trial_dias: 14 };
    const res = await POST(json("http://localhost/api/v1/admin/cobranca/planos", "POST", corpo));
    expect(res.status).toBe(201);
    const m = metadataDa("cobranca.plano_salvo")!;
    expect(m.antes).toBeNull();
    expect(m.depois).toMatchObject(corpo);
  });

  it("o preço do setup guarda o anterior", async () => {
    setup = 150_000;
    const res = await PUT_SETUP(json(`http://localhost/api/v1/admin/planos-mia/${ID}/setup`, "PUT", { preco_cents: 200_000 }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(200);
    expect(metadataDa("setup.preco_do_plano")).toMatchObject({ antes: { preco_cents: 150_000 }, depois: { preco_cents: 200_000 } });
  });
});

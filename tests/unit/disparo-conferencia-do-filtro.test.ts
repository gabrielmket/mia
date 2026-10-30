/**
 * FORK MIA (.97) — "0 destinatários · 0 sem telefone · 0 repetidos · 0 pediram para
 * sair · 0 contatos pessoais", com 25 contatos na etiqueta, todos sem telefone.
 *
 * O caso é o da conferência de verdade: a rota que monta a lista, contra um banco
 * que aplica os filtros de fato (`tests/helpers/postgrest-com-teto.ts`). Os quatro
 * zeros querem dizer que a lista veio vazia, porque a peneira só vê quem passou no
 * filtro; o esperado era "25 sem telefone".
 *
 *     npx vitest run --project produto tests/unit/disparo-conferencia-do-filtro.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/modulos/liberacao", () => ({ moduloLiberado: vi.fn(async () => true) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const ETAPA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function contato(i: number, over: Linha = {}): Linha {
  return {
    id: `contato-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    phone_number: null,
    name: `Contato ${i}`,
    display_name: null,
    is_blocked: false,
    is_personal: false,
    consent: null,
    tags: ["lista de outubro"],
    kind: "person",
    is_anonymized: false,
    is_merged_into: null,
    created_at: new Date(Date.parse("2026-01-01T12:00:00.000Z") + i * 1_000).toISOString(),
    ...over,
  };
}

function ligar(contatos: Linha[], extra: Record<string, Linha[]> = {}) {
  const banco = postgrestComTeto({
    contacts: contatos,
    meta_templates: [{ organization_id: ORG, name: "modelo_de_teste", language: "pt_BR", status: "APPROVED" }],
    tenant_wallet_ledger: [],
    tenant_broadcast_pricing: [],
    broadcasts: [],
    broadcast_recipients: [],
    crm_leads: [],
    ...extra,
  });
  vi.mocked(createClient).mockResolvedValue(banco.cliente as never);
  vi.mocked(createAdminClient).mockReturnValue(banco.cliente as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "55555555-5555-4555-8555-555555555555", idioma: "pt-BR" } as unknown as AuthUser,
    org: { orgId: ORG, name: "Empresa Modelo", role: "manager" },
  });
  return banco;
}

interface Conferencia {
  destinatarios: number;
  fora: Record<string, number>;
  motivo: string | null;
}

async function montar(filtro: { tags?: string[]; etapas?: string[] }): Promise<Conferencia> {
  const { POST } = await import("@/app/api/v1/broadcasts/route");
  const res = await POST(
    new NextRequest("http://localhost/api/v1/broadcasts", {
      method: "POST",
      body: JSON.stringify({
        nome: "Campanha",
        template_name: "modelo_de_teste",
        template_language: "pt_BR",
        valores_padrao: {},
        tags: filtro.tags ?? [],
        etapas: filtro.etapas ?? [],
        variavel_do_nome: "1",
      }),
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Conferencia }).data;
}

const QUATRO_ZEROS = { sem_telefone: 0, repetidos: 0, pediram_para_sair: 0, pessoais: 0 };
const VINTE_E_CINCO = Array.from({ length: 25 }, (_, i) => contato(i));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a conferência conta quem ficou de fora", () => {
  it("o que o seletor oferece: os 25 sem telefone aparecem como 25 sem telefone", async () => {
    ligar(VINTE_E_CINCO);

    const c = await montar({ tags: ["lista de outubro"] });

    expect(c.destinatarios).toBe(0);
    expect(c.fora).toMatchObject({ sem_telefone: 25, repetidos: 0, pediram_para_sair: 0, pessoais: 0 });
    expect(c.motivo).toBe("lista_vazia");
  });

  it("A TELA DO DEFEITO: a grafia com que a etiqueta nasceu não dá mais quatro zeros", async () => {
    ligar(VINTE_E_CINCO);

    const c = await montar({ tags: ["Lista de Outubro"] });

    expect(c.fora).toMatchObject({ sem_telefone: 25 });
  });

  it("etiqueta E etapa, nenhum negócio aberto: os 25 são contados pela etapa", async () => {
    ligar(VINTE_E_CINCO);

    const c = await montar({ tags: ["lista de outubro"], etapas: [ETAPA] });

    expect(c.destinatarios).toBe(0);
    expect(c.fora).toEqual({ ...QUATRO_ZEROS, sem_negocio_na_etapa: 25 });
  });

  it("etiqueta que ninguém tem: quatro zeros de verdade, e a auditoria guarda o filtro", async () => {
    ligar(VINTE_E_CINCO);

    const c = await montar({ tags: ["outra"] });

    expect(c.fora).toEqual({ ...QUATRO_ZEROS, sem_negocio_na_etapa: 0 });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "broadcast.criado",
        metadata: expect.objectContaining({ filtro: { etiquetas: ["outra"], etapas: [] } }),
      }),
    );
  });

  it("com telefone entra, sem telefone conta, e anonimizado não aparece em lugar nenhum", async () => {
    ligar([
      contato(0, { phone_number: "+5511900000001" }),
      contato(1),
      contato(2, { is_anonymized: true }),
      contato(3, { is_merged_into: "contato-000000" }),
    ]);

    const c = await montar({ tags: ["lista de outubro"] });

    expect(c.destinatarios).toBe(1);
    expect(c.fora).toMatchObject({ sem_telefone: 1 });
  });
});

describe("as Campanhas por QR (o campo de texto do upstream)", () => {
  it("a etiqueta digitada casa com o que está gravado, inclusive a que exclui", async () => {
    const { filtroDeAudienciaSchema } = await import("@/lib/campanhas/audiencia");

    const filtro = filtroDeAudienciaSchema.parse({
      com_alguma_tag: ["Lista de Outubro"],
      com_todas_tags: ["  VIP "],
      sem_tags: ["Pediu Para Sair"],
    });

    expect(filtro).toMatchObject({
      com_alguma_tag: ["lista de outubro"],
      com_todas_tags: ["vip"],
      sem_tags: ["pediu para sair"],
    });
  });
});

describe("remontar a lista pela edição", () => {
  it("devolve o motivo: sem telefone e sem negócio na etapa", async () => {
    ligar(VINTE_E_CINCO, {
      broadcasts: [{ id: "disparo-1", organization_id: ORG, status: "rascunho", nome: "C", valores_padrao: {} }],
    });
    const { PATCH } = await import("@/app/api/v1/broadcasts/[id]/route");

    const res = await PATCH(
      new NextRequest("http://localhost/api/v1/broadcasts/disparo-1", {
        method: "PATCH",
        body: JSON.stringify({ tags: ["Lista de Outubro"], etapas: [] }),
      }),
      { params: Promise.resolve({ id: "disparo-1" }) },
    );

    const { data } = (await res.json()) as { data: { peneira: Record<string, number> } };
    expect(data.peneira).toMatchObject({ enviar: 0, semTelefone: 25, semNegocioNaEtapa: 0 });
  });
});

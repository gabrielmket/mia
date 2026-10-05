/**
 * FORK MIA — O DISPARO NÃO SAI PARCIAL EM SILÊNCIO.
 *
 * ## O que estava errado
 *
 * Três lugares em que o número da tela não era o número de verdade, todos sem
 * erro nenhum:
 *
 *  · criar ou remontar a lista lia os contatos com `.limit(50_000)`: o PostgREST
 *    devolvia 1000, e a tela dizia "1.000 destinatários" para uma lista de 2.500;
 *  · gravar os destinatários ignorava o erro de cada bloco: um bloco recusado
 *    deixava o disparo com menos gente do que a resposta dizia;
 *  · a lista de disparos contava o andamento no JavaScript sobre até 1000
 *    linhas: uma campanha de 3.000 aparecia com "1.000 na lista".
 *
 * ## O que cada caso prova
 *
 * Contra um servidor que corta em 1000 linhas e grava de verdade
 * (`tests/helpers/postgrest-com-teto.ts`): o que a resposta diz é o que ficou
 * gravado; lista acima do teto é RECUSADA antes de qualquer escrita; e bloco
 * recusado desfaz o que entrou.
 *
 *     npx vitest run --project produto tests/unit/disparo-nao-sai-parcial.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { LISTA_ACIMA_DO_TETO, TETO_DA_LISTA_DO_DISPARO } from "@/lib/broadcast/quem-entra-na-lista";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/modulos/liberacao", () => ({ moduloLiberado: vi.fn(async () => true) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { postgrestComTeto, type Linha, type OpcoesDoDuble, type PostgrestComTeto } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const GESTORA = "55555555-5555-4555-8555-555555555555";

function sessao(idioma: "pt-BR" | "es" = "pt-BR"): void {
  const user = {
    id: GESTORA,
    email: "gestora@empresa-modelo.example",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma,
    organizations: [{ organization_id: ORG, organization_name: "Empresa Modelo", role: "manager" }],
  } as unknown as AuthUser;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG, name: "Empresa Modelo", role: "manager" },
  });
}

function ligar(banco: PostgrestComTeto): void {
  vi.mocked(createClient).mockResolvedValue(banco.cliente as never);
  vi.mocked(createAdminClient).mockReturnValue(banco.cliente as never);
}

function contato(i: number): Linha {
  return {
    id: `contato-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    phone_number: `+55119${String(10_000_000 + i)}`,
    name: `Contato ${i}`,
    display_name: null,
    is_blocked: false,
    consent: null,
    tags: [],
    created_at: new Date(Date.parse("2026-01-01T12:00:00.000Z") + i * 1_000).toISOString(),
  };
}

function banco(contatos: number, extra: Record<string, Linha[]> = {}, opcoes: OpcoesDoDuble = {}) {
  return postgrestComTeto(
    {
      contacts: Array.from({ length: contatos }, (_, i) => contato(i)),
      meta_templates: [{ organization_id: ORG, name: "modelo_de_teste", language: "pt_BR", status: "APPROVED" }],
      tenant_wallet_ledger: [],
      tenant_broadcast_pricing: [],
      broadcasts: [],
      broadcast_recipients: [],
      ...extra,
    },
    opcoes,
  );
}

const corpoDeCriar = {
  nome: "Volta às aulas",
  template_name: "modelo_de_teste",
  template_language: "pt_BR",
  valores_padrao: {},
  tags: [],
  etapas: [],
  variavel_do_nome: "1",
};

async function criar(corpo: unknown = corpoDeCriar): Promise<Response> {
  const { POST } = await import("@/app/api/v1/broadcasts/route");
  return POST(
    new NextRequest("http://localhost/api/v1/broadcasts", { method: "POST", body: JSON.stringify(corpo) }),
  );
}

async function listar(): Promise<Response> {
  const { GET } = await import("@/app/api/v1/broadcasts/route");
  return GET(new NextRequest("http://localhost/api/v1/broadcasts"));
}

async function editar(id: string, corpo: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/broadcasts/[id]/route");
  return PATCH(
    new NextRequest(`http://localhost/api/v1/broadcasts/${id}`, { method: "PATCH", body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criar o disparo", () => {
  it("2.500 contatos na lista: a resposta diz 2.500 e há 2.500 destinatários gravados", async () => {
    sessao();
    const db = banco(2_500);
    ligar(db);

    const res = await criar();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string; destinatarios: number } };

    expect(data.destinatarios).toBe(2_500);
    const gravados = db.tabelas.broadcast_recipients!.filter((l) => l.broadcast_id === data.id);
    expect(gravados).toHaveLength(2_500);
    expect(new Set(gravados.map((l) => l.phone_e164)).size).toBe(2_500);
  });

  it("lista acima do teto: 422 com a frase, e NADA é gravado", async () => {
    sessao();
    const db = banco(TETO_DA_LISTA_DO_DISPARO + 1);
    ligar(db);

    const res = await criar();

    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("validation_failed");
    expect(corpo.error.message).toBe(LISTA_ACIMA_DO_TETO);
    // Recusou ANTES de existir disparo: nenhuma escrita, em tabela nenhuma.
    expect(db.escritas).toEqual([]);
    expect(db.tabelas.broadcasts).toEqual([]);
  });

  it("a frase da recusa sai no idioma de quem pediu", async () => {
    sessao("es");
    const db = banco(TETO_DA_LISTA_DO_DISPARO + 1);
    ligar(db);

    const res = await criar();
    const corpo = (await res.json()) as { error: { message: string } };

    expect(corpo.error.message).toBe(traduzir(LISTA_ACIMA_DO_TETO, "es"));
    expect(corpo.error.message).not.toBe(LISTA_ACIMA_DO_TETO);
  });

  it("um bloco de destinatários recusado pelo banco: 500, e o disparo é desfeito inteiro", async () => {
    sessao();
    // 2.500 destinatários = 5 blocos de 500; o banco recusa o terceiro.
    const db = banco(2_500, {}, {
      falhaNaEscrita: (n, tabela, op) =>
        tabela === "broadcast_recipients" && op === "insert" && n === 3 ? "duplicate key value" : null,
    });
    ligar(db);

    const res = await criar();

    expect(res.status).toBe(500);
    // Sem isto ficaria um rascunho com 1.000 dos 2.500, e a tela diria 2.500.
    expect(db.tabelas.broadcast_recipients).toEqual([]);
    expect(db.tabelas.broadcasts).toEqual([]);
  });
});

describe("remontar a lista de um rascunho", () => {
  const rascunho = (): Linha => ({
    id: "disparo-rascunho",
    organization_id: ORG,
    status: "rascunho",
    nome: "Nome antigo",
    template_name: "modelo_de_teste",
    template_language: "pt_BR",
    valores_padrao: {},
  });
  const listaAntiga = (): Linha[] =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `antigo-${i}`,
      organization_id: ORG,
      broadcast_id: "disparo-rascunho",
      contact_id: null,
      phone_e164: `+551180000000${i}`,
      valores: {},
      status: "pendente",
    }));

  it("2.500 contatos: a lista remontada tem 2.500, e a resposta diz 2.500", async () => {
    sessao();
    const db = banco(2_500, { broadcasts: [rascunho()], broadcast_recipients: listaAntiga() });
    ligar(db);

    const res = await editar("disparo-rascunho", { tags: [] });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { peneira: { enviar: number } } };

    expect(data.peneira.enviar).toBe(2_500);
    expect(db.tabelas.broadcast_recipients).toHaveLength(2_500);
  });

  it("lista acima do teto: 422, o nome NÃO muda e a lista antiga fica inteira", async () => {
    sessao();
    const db = banco(TETO_DA_LISTA_DO_DISPARO + 1, {
      broadcasts: [rascunho()],
      broadcast_recipients: listaAntiga(),
    });
    ligar(db);

    const res = await editar("disparo-rascunho", { nome: "Nome novo", tags: [] });

    expect(res.status).toBe(422);
    expect(db.escritas).toEqual([]);
    expect(db.tabelas.broadcasts![0]!.nome).toBe("Nome antigo");
    expect(db.tabelas.broadcast_recipients).toHaveLength(3);
  });

  it("um bloco recusado ao remontar: 500, e o rascunho fica SEM destinatários (não com parte deles)", async () => {
    sessao();
    const db = banco(2_500, { broadcasts: [rascunho()], broadcast_recipients: listaAntiga() }, {
      // 1ª escrita na tabela é o `delete` da lista velha; o 2º bloco é a 3ª.
      falhaNaEscrita: (n, tabela, op) =>
        tabela === "broadcast_recipients" && op === "insert" && n === 3 ? "statement timeout" : null,
    });
    ligar(db);

    const res = await editar("disparo-rascunho", { tags: [] });

    expect(res.status).toBe(500);
    expect(db.tabelas.broadcast_recipients).toEqual([]);
  });
});

describe("o andamento na lista de disparos", () => {
  const destinatarios = (campanha: string, quantos: number, status: string, de = 0): Linha[] =>
    Array.from({ length: quantos }, (_, i) => ({
      id: `${campanha}-${status}-${String(de + i).padStart(6, "0")}`,
      organization_id: ORG,
      broadcast_id: campanha,
      status,
    }));

  const campanha = (id: string, criadaHa: number): Linha => ({
    id,
    organization_id: ORG,
    nome: id,
    template_name: "modelo_de_teste",
    template_language: "pt_BR",
    status: "enviando",
    preco_cents: 20,
    agendado_para: null,
    iniciado_em: null,
    concluido_em: null,
    motivo_da_parada: null,
    created_at: new Date(Date.now() - criadaHa * 60_000).toISOString(),
  });

  const cenario = () =>
    banco(0, {
      broadcasts: [campanha("grande", 2), campanha("media", 1)],
      broadcast_recipients: [
        ...destinatarios("grande", 2_000, "enviada"),
        ...destinatarios("grande", 600, "pendente"),
        ...destinatarios("grande", 400, "falhou"),
        ...destinatarios("media", 900, "lida"),
        ...destinatarios("media", 300, "pendente"),
      ],
    });

  it("campanha de 3.000 e campanha de 1.200: cada uma com o seu total e os seus estados", async () => {
    sessao();
    const db = cenario();
    ligar(db);

    const res = await listar();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { campanhas: Array<{ id: string; andamento: Record<string, number> }> };
    };

    const de = (id: string) => data.campanhas.find((c) => c.id === id)?.andamento;
    expect(de("grande")).toEqual({ total: 3_000, enviada: 2_000, pendente: 600, falhou: 400 });
    expect(de("media")).toEqual({ total: 1_200, lida: 900, pendente: 300 });
    // Nenhuma linha de destinatário foi trazida: só contagens.
    expect(
      db.pedidos.filter((p) => p.tabela === "broadcast_recipients").every((p) => p.devolvidas === 0 && p.pediuContagem),
    ).toBe(true);
  });

  it("controle negativo: a soma antiga (.limit(200_000)) via 1000 linhas das 4.200", async () => {
    const db = cenario();

    const antiga = await db.cliente
      .from("broadcast_recipients")
      .select("broadcast_id, status")
      .in("broadcast_id", ["grande", "media"])
      .limit(200_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    // As 1000 que vinham eram todas da primeira campanha: a "grande" aparecia
    // com 1.000 na lista e a "media" com zero.
    expect((antiga.data ?? []).filter((l) => l.broadcast_id === "media")).toHaveLength(0);
  });

  it("contagem que falha: 500, e não uma lista de disparos zerada", async () => {
    sessao();
    const db = banco(
      0,
      { broadcasts: [campanha("grande", 1)], broadcast_recipients: destinatarios("grande", 10, "pendente") },
      { falhaEm: (_n, tabela) => (tabela === "broadcast_recipients" ? "statement timeout" : null) },
    );
    ligar(db);

    const res = await listar();

    expect(res.status).toBe(500);
  });
});

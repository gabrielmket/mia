/**
 * FORK MIA (.97) — a ação em lote valendo para o filtro inteiro.
 *
 * O que esta rota decide é pouco, de propósito: quem entra é o `listContactsHandler`
 * (coberto pelos testes da lista) e o que acontece com cada um é a rota de lote
 * (coberta em `../route.test.ts`, com os caminhos individuais de verdade). Aqui se
 * prende o encaixe: a organização vem da sessão, a ordem não muda com a própria
 * ação, cada parte respeita o teto, e papel recusa na chamada.
 *
 *     npx vitest run --project produto app/api/v1/contacts/bulk/filtro/route.test.ts
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { listContactsHandler } from "../../_handler";
import { POST as rodarOLote } from "../route";
import { POST } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../_handler", () => ({ listContactsHandler: vi.fn() }));
vi.mock("../route", () => ({ POST: vi.fn(), TETO_DO_LOTE: 100 }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-3333-4000-8000-000000000003";
const SUPABASE = { fake: "sessao" };

function sessao(papel: "agent" | "manager" = "agent") {
  vi.mocked(requireRole).mockImplementation(async (minimo) => {
    const niveis = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (niveis[minimo as keyof typeof niveis] > niveis[papel]) {
      return { ok: false, response: NextResponse.json({ error: { code: "forbidden" } }, { status: 403 }) } as never;
    }
    return {
      ok: true,
      user: { id: USER, idioma: "pt-BR" },
      org: { orgId: ORG, name: "Org", role: papel },
    } as never;
  });
}

function chamar(corpo: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/v1/contacts/bulk/filtro", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

function relatorio(ids: string[], recusados: string[] = []): Response {
  return NextResponse.json({
    data: {
      acao: "tag",
      feitos: ids.length - recusados.length,
      recusados: recusados.length,
      resultados: ids.map((id) =>
        recusados.includes(id)
          ? { id, feito: false, codigo: "not_found", motivo: "Contato não encontrado." }
          : { id, feito: true },
      ),
    },
  });
}

const ETIQUETAR = { action: "tag", op: "add", tag: "Lista de Outubro" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(createClient).mockResolvedValue(SUPABASE as never);
  sessao();
});

describe("POST /api/v1/contacts/bulk/filtro", () => {
  it("resolve o filtro com a sessão e manda os ids à rota de lote, com o cursor da próxima parte", async () => {
    vi.mocked(listContactsHandler).mockResolvedValue({
      contacts: [{ id: "c-1" }, { id: "c-2" }] as never,
      cursor: "proxima",
      has_more: true,
    });
    vi.mocked(rodarOLote).mockResolvedValue(relatorio(["c-1", "c-2"]));

    const res = await chamar({ ...ETIQUETAR, filtro: { tag: ["vip"], source: "import_csv" }, cursor: "anterior" });

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toEqual({
      acao: "tag",
      processados: 2,
      feitos: 2,
      recusados: 0,
      recusas: [],
      cursor: "proxima",
      has_more: true,
    });

    // A organização vem da sessão, e o cliente é o da sessão (RLS).
    const [cliente, ctx, consulta] = vi.mocked(listContactsHandler).mock.calls[0]!;
    expect(cliente).toBe(SUPABASE);
    expect(ctx).toMatchObject({ organization_id: ORG, actor: { type: "user", id: USER } });
    // A ordem de `created_at`: a própria ação não mexe nela, e ninguém é pulado.
    expect(consulta).toMatchObject({
      tag: ["vip"],
      source: "import_csv",
      cursor: "anterior",
      limit: 100,
      order_by: "created_at",
      order_dir: "asc",
    });

    const pedido = vi.mocked(rodarOLote).mock.calls[0]![0];
    expect(await pedido.json()).toEqual({ ...ETIQUETAR, ids: ["c-1", "c-2"] });
  });

  it("organização no corpo não entra: o schema nem tem o campo", async () => {
    vi.mocked(listContactsHandler).mockResolvedValue({ contacts: [], cursor: null, has_more: false });

    await chamar({ ...ETIQUETAR, filtro: {}, organization_id: "bbbbbbbb-0000-4000-8000-000000000002" });

    expect(vi.mocked(listContactsHandler).mock.calls[0]![1]).toMatchObject({ organization_id: ORG });
  });

  it("devolve as recusas sem os feitos: o relatório inteiro seria peso sem uso", async () => {
    vi.mocked(listContactsHandler).mockResolvedValue({
      contacts: [{ id: "c-1" }, { id: "c-2" }] as never,
      cursor: null,
      has_more: false,
    });
    vi.mocked(rodarOLote).mockResolvedValue(relatorio(["c-1", "c-2"], ["c-2"]));

    const { data } = (await (await chamar({ ...ETIQUETAR, filtro: {} })).json()) as {
      data: { feitos: number; recusados: number; recusas: unknown[]; has_more: boolean };
    };

    expect(data).toMatchObject({ feitos: 1, recusados: 1, has_more: false });
    expect(data.recusas).toEqual([{ id: "c-2", codigo: "not_found", motivo: "Contato não encontrado." }]);
  });

  it("filtro sem ninguém: nenhuma chamada de escrita", async () => {
    vi.mocked(listContactsHandler).mockResolvedValue({ contacts: [], cursor: null, has_more: false });

    const { data } = (await (await chamar({ ...ETIQUETAR, filtro: { search: "a" } })).json()) as {
      data: { processados: number; has_more: boolean };
    };

    expect(data).toMatchObject({ processados: 0, has_more: false });
    expect(rodarOLote).not.toHaveBeenCalled();
  });

  it("viewer recebe 403 na chamada, e nada é lido", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "forbidden" } }, { status: 403 }),
    } as never);

    const res = await chamar({ ...ETIQUETAR, filtro: {} });

    expect(res.status).toBe(403);
    expect(listContactsHandler).not.toHaveBeenCalled();
  });

  it("responsável é de gerente: o atendente recusa na chamada, e não uma vez por contato", async () => {
    sessao("agent");

    const res = await chamar({ action: "carteira", dono_user_id: USER, filtro: {} });

    expect(res.status).toBe(403);
    expect(listContactsHandler).not.toHaveBeenCalled();
    expect(rodarOLote).not.toHaveBeenCalled();
  });

  it("gerente muda o responsável do filtro", async () => {
    sessao("manager");
    vi.mocked(listContactsHandler).mockResolvedValue({
      contacts: [{ id: "c-1" }] as never,
      cursor: null,
      has_more: false,
    });
    vi.mocked(rodarOLote).mockResolvedValue(relatorio(["c-1"]));

    const res = await chamar({ action: "carteira", dono_user_id: USER, origem: "manual", filtro: {} });

    expect(res.status).toBe(200);
    expect(await vi.mocked(rodarOLote).mock.calls[0]![0].json()).toEqual({
      action: "carteira",
      dono_user_id: USER,
      origem: "manual",
      ids: ["c-1"],
    });
  });

  it("recusa da chamada de lote sobe como veio", async () => {
    vi.mocked(listContactsHandler).mockResolvedValue({
      contacts: [{ id: "c-1" }] as never,
      cursor: null,
      has_more: false,
    });
    vi.mocked(rodarOLote).mockResolvedValue(NextResponse.json({ error: { code: "forbidden" } }, { status: 403 }));

    expect((await chamar({ ...ETIQUETAR, filtro: {} })).status).toBe(403);
  });

  it("corpo inválido é 422, sem ler ninguém", async () => {
    expect((await chamar({ action: "outra", filtro: {} })).status).toBe(422);
    expect((await chamar({ action: "tag", op: "add", tag: "x" })).status).toBe(422);
    expect(listContactsHandler).not.toHaveBeenCalled();
  });

  it("cursor inválido da lista vira o erro dela", async () => {
    vi.mocked(listContactsHandler).mockRejectedValue(new ApiError(400, "invalid_cursor", undefined, "r", "Cursor inválido."));

    const res = await chamar({ ...ETIQUETAR, filtro: {}, cursor: "lixo" });

    expect(res.status).toBe(400);
  });
});

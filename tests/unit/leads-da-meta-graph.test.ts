/**
 * FORK MIA — a leitura dos leads na Meta com a Graph SIMULADA
 * (`lib/plataformas-de-anuncio/meta/leads.ts` e `lib/leads-da-meta/diagnostico.ts`).
 *
 * Nenhuma chamada sai da máquina: o `fetch` é um dublê que responde como a Graph
 * responde (formato do fio copiado da documentação da Meta). O que se prova:
 *
 *   - o token vai no CABEÇALHO, nunca na URL — nem na segunda página;
 *   - o filtro por `time_created` carrega a janela pedida;
 *   - a paginação segue o cursor `after`, e o teto de páginas vira `truncado`;
 *   - sem permissão para os campos do anúncio, o lead vem SEM a origem e com a
 *     ressalva, em vez de a leitura inteira cair;
 *   - 100/33 (objeto fora do alcance) é permissão, não "campo inválido";
 *   - o diagnóstico diz exatamente qual permissão falta e qual Página não abriu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { diagnosticar, permissoesQueFaltam } from "@/lib/leads-da-meta/diagnostico";
import {
  AVISO_SEM_ORIGEM_DO_ANUNCIO,
  MAXIMO_DE_PAGINAS_DE_LEADS,
  classificarErroDeLeads,
  lerLeadsDoFormulario,
  lerPermissoes,
  listarPaginas,
} from "@/lib/plataformas-de-anuncio/meta/leads";

type Resposta = { status?: number; corpo: unknown };
type Chamada = { url: URL; autorizacao: string | null };

function grafoFalso(responder: (url: URL, n: number) => Resposta) {
  const chamadas: Chamada[] = [];
  const fetchFalso = vi.fn(async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const headers = new Headers(init?.headers);
    chamadas.push({ url, autorizacao: headers.get("authorization") });
    const r = responder(url, chamadas.length);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchFalso);
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

const JANELA = { de: new Date("2026-09-22T00:00:00Z"), ate: new Date("2026-09-29T00:00:00Z") };

describe("os leads de um formulário", () => {
  it("token no cabeçalho, janela no filtro, e nada de token na URL", async () => {
    const chamadas = grafoFalso(() => ({ corpo: { data: [{ id: "1" }] } }));
    const r = await lerLeadsDoFormulario("TOKEN-DA-PAGINA", "555", JANELA);

    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    const [c] = chamadas;
    expect(c!.autorizacao).toBe("Bearer TOKEN-DA-PAGINA");
    expect(c!.url.toString()).not.toContain("TOKEN-DA-PAGINA");
    expect(c!.url.pathname).toMatch(/\/555\/leads$/);
    const filtro = JSON.parse(c!.url.searchParams.get("filtering")!) as Array<{
      field: string;
      operator: string;
      value: number;
    }>;
    expect(filtro).toEqual([
      { field: "time_created", operator: "GREATER_THAN", value: JANELA.de.getTime() / 1000 - 1 },
      { field: "time_created", operator: "LESS_THAN", value: JANELA.ate.getTime() / 1000 + 1 },
    ]);
    expect(c!.url.searchParams.get("fields")).toContain("campaign_id");
  });

  it("segue o cursor `after` e não o `next` cru (que traz o token na query)", async () => {
    const chamadas = grafoFalso((_url, n) =>
      n === 1
        ? {
            corpo: {
              data: [{ id: "1" }],
              paging: {
                cursors: { after: "CURSOR2" },
                next: "https://graph.facebook.com/v22.0/555/leads?access_token=VAZOU&after=CURSOR2",
              },
            },
          }
        : { corpo: { data: [{ id: "2" }], paging: { cursors: { after: "X" } } } },
    );
    const r = await lerLeadsDoFormulario("T", "555", JANELA);
    expect(r.ok && r.dados.leads.map((l) => l.id)).toEqual(["1", "2"]);
    expect(chamadas[1]!.url.searchParams.get("after")).toBe("CURSOR2");
    expect(chamadas[1]!.url.toString()).not.toContain("VAZOU");
  });

  it("mais páginas que o teto: a leitura diz que ficou truncada", async () => {
    grafoFalso(() => ({
      corpo: { data: [{ id: "x" }], paging: { cursors: { after: "c" }, next: "https://x/next" } },
    }));
    const r = await lerLeadsDoFormulario("T", "555", JANELA);
    expect(r.ok && r.dados.truncado).toBe(true);
    expect(r.ok && r.dados.leads).toHaveLength(MAXIMO_DE_PAGINAS_DE_LEADS);
  });

  it("sem permissão para a origem do anúncio: repete sem esses campos e avisa", async () => {
    const chamadas = grafoFalso((url) =>
      url.searchParams.get("fields")!.includes("campaign_id")
        ? {
            status: 403,
            corpo: { error: { code: 200, message: "(#200) Requires ads_management permission" } },
          }
        : { corpo: { data: [{ id: "1", field_data: [] }] } },
    );
    const r = await lerLeadsDoFormulario("T", "555", JANELA);
    expect(r.ok).toBe(true);
    expect(r.ok && r.aviso).toBe(AVISO_SEM_ORIGEM_DO_ANUNCIO);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url.searchParams.get("fields")).not.toContain("ad_id");
  });

  it("se a repetição também falha, vale a recusa ORIGINAL", async () => {
    grafoFalso(() => ({
      status: 403,
      corpo: { error: { code: 200, message: "(#200) sem leads_retrieval" } },
    }));
    const r = await lerLeadsDoFormulario("T", "555", JANELA);
    expect(r).toEqual({
      ok: false,
      falha: "permissao_insuficiente",
      detalhe: "(#200) sem leads_retrieval",
    });
  });

  it("token vencido (190) não repete: não há o que salvar", async () => {
    const chamadas = grafoFalso(() => ({
      status: 400,
      corpo: { error: { code: 190, message: "Error validating access token" } },
    }));
    const r = await lerLeadsDoFormulario("T", "555", JANELA);
    expect(r.ok === false && r.falha).toBe("token_invalido");
    expect(chamadas).toHaveLength(1);
  });

  it("100 com subcódigo 33 é objeto fora do alcance do token: permissão, não bug do sistema", () => {
    expect(classificarErroDeLeads(400, 100, 33)).toBe("permissao_insuficiente");
    expect(classificarErroDeLeads(400, 100, null)).toBe("campo_invalido");
  });
});

describe("Páginas e permissões", () => {
  it("as Páginas vêm com o token de cada uma; sem token vira nulo", async () => {
    grafoFalso(() => ({
      corpo: {
        data: [
          { id: "p1", name: "Clínica", access_token: "TP1", tasks: ["ADVERTISE"] },
          { id: "p2", name: "Outra" },
        ],
      },
    }));
    const r = await listarPaginas("T");
    expect(r.ok && r.dados).toEqual([
      { id: "p1", nome: "Clínica", tokenDaPagina: "TP1", tarefas: ["ADVERTISE"] },
      { id: "p2", nome: "Outra", tokenDaPagina: null, tarefas: [] },
    ]);
  });

  it("só as concedidas contam como permissão", async () => {
    grafoFalso(() => ({
      corpo: {
        data: [
          { permission: "ads_read", status: "granted" },
          { permission: "leads_retrieval", status: "declined" },
        ],
      },
    }));
    const r = await lerPermissoes("T");
    expect(r.ok && r.dados).toEqual(["ads_read"]);
  });

  it("a falta é dita pelo nome, separando obrigatória de recomendada", () => {
    expect(permissoesQueFaltam(["ads_read", "pages_show_list"])).toEqual({
      faltandoObrigatorias: ["leads_retrieval", "pages_read_engagement", "pages_manage_ads"],
      faltandoRecomendadas: ["ads_management"],
    });
  });
});

describe("o diagnóstico da tela", () => {
  it("permissões, Páginas e formulários, com o motivo de cada ausência", async () => {
    grafoFalso((url) => {
      if (url.pathname.endsWith("/me/permissions")) {
        return {
          corpo: {
            data: [
              { permission: "pages_show_list", status: "granted" },
              { permission: "pages_read_engagement", status: "granted" },
              { permission: "ads_read", status: "granted" },
            ],
          },
        };
      }
      if (url.pathname.endsWith("/me/accounts")) {
        return {
          corpo: {
            data: [
              { id: "p1", name: "Clínica", access_token: "TP1" },
              { id: "p2", name: "Sem acesso" },
              { id: "p3", name: "Leads fechados", access_token: "TP3" },
            ],
          },
        };
      }
      if (url.pathname.endsWith("/p1/leadgen_forms")) {
        return {
          corpo: {
            data: [
              {
                id: "f1",
                name: "Avaliação grátis",
                status: "ACTIVE",
                questions: [{ key: "full_name", label: "Nome completo" }],
              },
            ],
          },
        };
      }
      return {
        status: 400,
        corpo: { error: { code: 100, error_subcode: 33, message: "sem acesso" } },
      };
    });

    const d = await diagnosticar("T");
    expect(d.permissoes).toEqual({
      verificadas: true,
      faltandoObrigatorias: ["leads_retrieval", "pages_manage_ads"],
      faltandoRecomendadas: ["ads_management"],
    });
    expect(d.erro).toBeNull();
    expect(d.paginas.map((p) => [p.id, p.erro, p.formularios.map((f) => f.id)])).toEqual([
      ["p1", null, ["f1"]],
      ["p2", "sem_token_da_pagina", []],
      ["p3", "permissao_insuficiente", []],
    ]);
    expect(d.paginas[0]!.formularios[0]!.perguntas).toEqual({ full_name: "Nome completo" });
    // O token de Página nunca sai no diagnóstico (ele vai para a tela).
    expect(JSON.stringify(d)).not.toContain("TP1");
  });

  it("token recusado inteiro: o erro vem no topo, com a classe", async () => {
    grafoFalso(() => ({ status: 400, corpo: { error: { code: 190, message: "expirado" } } }));
    const d = await diagnosticar("T");
    expect(d.erro).toEqual({ falha: "token_invalido", detalhe: "expirado" });
    expect(d.permissoes.verificadas).toBe(false);
  });
});

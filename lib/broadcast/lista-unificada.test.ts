import { describe, expect, it } from "vitest";

import { STATUS_DA_CAMPANHA } from "@/lib/campanhas/tipos";

import {
  daCampanhaQr,
  doDisparoOficial,
  mesclarDisparos,
  STATUS_DO_BROADCAST_NA_LISTA,
  type CampanhaQrNaEntrada,
  type DisparoOficialNaEntrada,
} from "./lista-unificada";

/**
 * FORK MIA — a lista única do Broadcast (docs/fork/broadcast-unificado.md).
 *
 *     npx vitest run lib/broadcast/lista-unificada.test.ts
 */

function qr(id: string, criada: string, extra: Partial<CampanhaQrNaEntrada> = {}): CampanhaQrNaEntrada {
  return {
    id,
    name: `QR ${id}`,
    status: "draft",
    snapshot_eligible: 0,
    snapshot_excluded: 0,
    scheduled_at: null,
    started_at: null,
    completed_at: null,
    created_at: criada,
    ...extra,
  };
}

function oficial(
  id: string,
  criada: string,
  extra: Partial<DisparoOficialNaEntrada> = {},
): DisparoOficialNaEntrada {
  return {
    id,
    nome: `Oficial ${id}`,
    template_name: "retomada",
    status: "rascunho",
    preco_cents: 12,
    agendado_para: null,
    iniciado_em: null,
    concluido_em: null,
    created_at: criada,
    andamento: { total: 10 },
    ...extra,
  };
}

describe("um vocabulário de estado para os dois canais", () => {
  it("todo estado do oficial tem par no vocabulário das Campanhas", () => {
    for (const par of Object.values(STATUS_DO_BROADCAST_NA_LISTA)) {
      expect(STATUS_DA_CAMPANHA).toContain(par);
    }
    expect(Object.keys(STATUS_DO_BROADCAST_NA_LISTA).sort()).toEqual(
      ["agendada", "cancelada", "concluida", "enviando", "pausada", "rascunho"].sort(),
    );
  });

  it("cada linha leva ao detalhe do SEU motor", () => {
    expect(daCampanhaQr(qr("a", "2026-09-01T00:00:00Z")).href).toBe("/app/campaigns/a");
    expect(doDisparoOficial(oficial("b", "2026-09-01T00:00:00Z")).href).toBe("/app/broadcast/b");
  });
});

describe("o resumo do disparo oficial", () => {
  it("'saiu' soma enviada, entregue e lida — o mesmo envio em três momentos, contado uma vez", () => {
    const d = doDisparoOficial(
      oficial("x", "2026-09-01T00:00:00Z", {
        status: "enviando",
        andamento: { total: 10, enviada: 2, entregue: 3, lida: 1, falhou: 1 },
      }),
    );
    expect(d.status).toBe("running");
    expect(d.resumo).toMatchObject({ canal: "oficial", naLista: 10, saiu: 6, falhou: 1, custoCents: 120 });
  });

  it("sem preço gravado, o custo é desconhecido — nunca zero", () => {
    const d = doDisparoOficial(oficial("x", "2026-09-01T00:00:00Z", { preco_cents: null }));
    expect(d.resumo).toMatchObject({ custoCents: null });
  });

  it("a data que importa depende do estado", () => {
    const agendada = doDisparoOficial(
      oficial("x", "2026-09-01T00:00:00Z", { status: "agendada", agendado_para: "2026-09-30T12:00:00Z" }),
    );
    expect(agendada.quando).toEqual({ tipo: "comeca", em: "2026-09-30T12:00:00Z" });
    const concluida = doDisparoOficial(
      oficial("y", "2026-09-01T00:00:00Z", {
        status: "concluida",
        iniciado_em: "2026-09-02T00:00:00Z",
        concluido_em: "2026-09-03T00:00:00Z",
      }),
    );
    expect(concluida.quando).toEqual({ tipo: "terminou", em: "2026-09-03T00:00:00Z" });
  });
});

describe("mesclar os dois motores numa lista só", () => {
  it("do mais novo para o mais velho, intercalando os canais", () => {
    const l = mesclarDisparos(
      [qr("q1", "2026-09-20T10:00:00Z"), qr("q2", "2026-09-10T10:00:00Z")],
      [oficial("o1", "2026-09-25T10:00:00Z"), oficial("o2", "2026-09-15T10:00:00Z")],
      { qrTemMais: false },
    );
    expect(l.map((d) => d.id)).toEqual(["o1", "q1", "o2", "q2"]);
  });

  it("compara a DATA, não o texto: fusos escritos diferente não embaralham", () => {
    const l = mesclarDisparos(
      [qr("q", "2026-09-20T09:00:00-03:00")], // 12:00 UTC
      [oficial("o", "2026-09-20T11:00:00+00:00")],
      { qrTemMais: false },
    );
    expect(l.map((d) => d.id)).toEqual(["q", "o"]);
  });

  it("com página de QR por vir, o oficial mais velho que a última campanha carregada espera a vez", () => {
    const paginaDeQr = [qr("q1", "2026-09-20T00:00:00Z"), qr("q2", "2026-09-10T00:00:00Z")];
    const oficiais = [oficial("novo", "2026-09-15T00:00:00Z"), oficial("velho", "2026-08-01T00:00:00Z")];
    expect(mesclarDisparos(paginaDeQr, oficiais, { qrTemMais: true }).map((d) => d.id)).toEqual([
      "q1",
      "novo",
      "q2",
    ]);
    // Quando a última página chega, ele aparece — no lugar dele.
    expect(mesclarDisparos(paginaDeQr, oficiais, { qrTemMais: false }).map((d) => d.id)).toEqual([
      "q1",
      "novo",
      "q2",
      "velho",
    ]);
  });

  it("filtro de canal: só um dos dois — e 'só oficial' não espera página de QR nenhuma", () => {
    const paginaDeQr = [qr("q1", "2026-09-20T00:00:00Z")];
    const oficiais = [oficial("velho", "2026-08-01T00:00:00Z")];
    expect(
      mesclarDisparos(paginaDeQr, oficiais, { qrTemMais: true, filtros: { canal: "oficial" } }).map((d) => d.id),
    ).toEqual(["velho"]);
    expect(
      mesclarDisparos(paginaDeQr, oficiais, { qrTemMais: false, filtros: { canal: "qr" } }).map((d) => d.id),
    ).toEqual(["q1"]);
  });

  it("filtro de situação vale para os dois, no vocabulário das Campanhas", () => {
    const l = mesclarDisparos(
      [qr("q-rasc", "2026-09-20T00:00:00Z"), qr("q-env", "2026-09-19T00:00:00Z", { status: "running" })],
      [oficial("o-env", "2026-09-18T00:00:00Z", { status: "enviando" }), oficial("o-rasc", "2026-09-17T00:00:00Z")],
      { qrTemMais: false, filtros: { status: "running" } },
    );
    expect(l.map((d) => d.id)).toEqual(["q-env", "o-env"]);
  });

  it("listas vazias dão lista vazia (o estado vazio da tela depende disso)", () => {
    expect(mesclarDisparos([], [], { qrTemMais: false })).toEqual([]);
  });
});

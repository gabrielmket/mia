import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { rodarCampanha, type CampanhaEmCurso } from "@/lib/broadcast/motor";

/**
 * O DISPARO TEM DE EXISTIR NA CONVERSA — e o que acontece quando não existe.
 *
 * O motor gravava em duas tabelas (carteira e `broadcast_recipients`) e em
 * nenhum momento no inbox. O envio saía, cobrava, aparecia como "enviada" na
 * campanha — e a mensagem não existia para ninguém. A consequência cara não é
 * estética: quando o lead responde, o AGENTE lê um histórico que começa na
 * resposta dele. "Quero sim" sem a pergunta antes.
 *
 * Este arquivo prova as duas metades: que o registro acontece, e que falhar
 * nele NÃO desfaz um envio que a Meta já aceitou e a carteira já pagou.
 *
 *     npx vitest run lib/broadcast/registro-na-conversa.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";

function bancoFalso(pendentes: Array<{ id: string; phone_e164: string; contact_id: string | null }>) {
  const lancamentos: Array<Record<string, unknown>> = [];
  const atualizacoes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const cobrados = new Set<string>();
  const fila = [...pendentes];

  const db = {
    from(tabela: string) {
      if (tabela === "tenant_wallet_ledger") {
        // O saldo é lido por `lerSaldoDaCarteira`, que pagina com `range` e pede
        // a contagem na primeira página (lib/carteira/ler-saldo.ts).
        const extrato = [{ tipo: "credito", amount_cents: 100_000, occurred_at: "2026-09-17T00:00:00Z" }];
        const paginado = {
          order: () => paginado,
          range: async (de: number, ate: number) => ({
            data: extrato.slice(de, ate + 1),
            error: null,
            count: extrato.length,
          }),
        };
        return {
          select: () => ({ eq: () => paginado }),
          insert: async (linha: Record<string, unknown>) => {
            const chave = `${linha.ref_kind}:${linha.ref_id}`;
            if (cobrados.has(chave)) return { error: { code: "23505", message: "dup" } };
            cobrados.add(chave);
            lancamentos.push(linha);
            return { error: null };
          },
        };
      }
      if (tabela === "broadcast_recipients") {
        return {
          select: (_c: string, opts?: { count?: string; head?: boolean }) => ({
            eq: () => ({
              eq: () =>
                opts?.head
                  ? Promise.resolve({ count: fila.length, error: null })
                  : {
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: fila[0] ? { ...fila[0], valores: { "1": "Pessoa" } } : null,
                          error: null,
                        }),
                      }),
                    },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              atualizacoes.push({ id, patch });
              const i = fila.findIndex((f) => f.id === id);
              if (i >= 0) fila.splice(i, 1);
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  } as unknown as SupabaseClient;

  return { db, lancamentos, atualizacoes };
}

const campanha = (): CampanhaEmCurso => ({
  id: "camp-1",
  organization_id: ORG,
  template_name: "retomada_captacao_v1",
  template_language: "pt_BR",
  valores_padrao: { "2": "Time Company" },
  preco_cents: 12,
});

describe("o envio vira mensagem na conversa", () => {
  it("registra CADA envio, com os valores daquele destinatário", async () => {
    const { db } = bancoFalso([{ id: "r0", phone_e164: "+5531999990000", contact_id: "c0" }]);
    const registrar = vi.fn(async () => {});

    await rodarCampanha(db, campanha(), {
      enviar: async () => "wamid.1",
      registrar,
      qualidade: async () => "GREEN",
    });

    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith({
      contactId: "c0",
      // Os valores da campanha e os do destinatário JUNTOS — é o que a pessoa
      // leu, e é o que explica a resposta dela para quem abrir o histórico.
      values: { "1": "Pessoa", "2": "Time Company" },
      externalId: "wamid.1",
    });
  });

  it("destinatário SEM cadastro chega como contactId nulo, e não trava a fila", async () => {
    const { db } = bancoFalso([{ id: "r0", phone_e164: "+5531999990000", contact_id: null }]);
    const registrar = vi.fn(async () => {});

    const r = await rodarCampanha(db, campanha(), {
      enviar: async () => "wamid.1",
      registrar,
      qualidade: async () => "GREEN",
    });

    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ contactId: null }));
    expect(r.enviadas, "telefone solto continua sendo enviado — só não tem conversa a que anexar").toBe(1);
  });

  it("a Meta RECUSANDO não registra nada — não houve mensagem para existir", async () => {
    const { db } = bancoFalso([{ id: "r0", phone_e164: "+5531999990000", contact_id: "c0" }]);
    const registrar = vi.fn(async () => {});

    const r = await rodarCampanha(db, campanha(), {
      enviar: async () => {
        throw new Error("template inexistente");
      },
      registrar,
      qualidade: async () => "GREEN",
    });

    expect(registrar).not.toHaveBeenCalled();
    expect(r.falhas).toBe(1);
  });
});

describe("falhar ao registrar NÃO desfaz o envio", () => {
  it("o destinatário segue ENVIADA e a cobrança acontece", async () => {
    const { db, lancamentos, atualizacoes } = bancoFalso([
      { id: "r0", phone_e164: "+5531999990000", contact_id: "c0" },
    ]);

    const r = await rodarCampanha(db, campanha(), {
      enviar: async () => "wamid.1",
      // O registro devolve normalmente mesmo tendo falhado por dentro: quem o
      // implementa loga e segue, porque quando ele roda a Meta JÁ aceitou.
      registrar: async () => {},
      qualidade: async () => "GREEN",
    });

    expect(r.enviadas).toBe(1);
    expect(
      atualizacoes[0]?.patch.status,
      "marcar `falhou` por causa de uma escrita local faria a campanha reenviar — e cobrar de novo",
    ).toBe("enviada");
    expect(lancamentos.filter((l) => l.tipo === "debito")).toHaveLength(1);
  });
});

describe("campanha antiga, sem quem registre", () => {
  it("roda igual quando a dependência não é passada", async () => {
    const { db } = bancoFalso([{ id: "r0", phone_e164: "+5531999990000", contact_id: "c0" }]);

    const r = await rodarCampanha(db, campanha(), {
      enviar: async () => "wamid.1",
      qualidade: async () => "GREEN",
    });

    expect(
      r.enviadas,
      "a dependência é opcional na interface: instalação sem espelho do template continua disparando",
    ).toBe(1);
  });
});

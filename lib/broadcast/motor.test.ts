import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { estornar, rodarCampanha, type CampanhaEmCurso } from "@/lib/broadcast/motor";

/**
 * O CAMINHO DO DINHEIRO, PROVADO NOS DESFECHOS RUINS.
 *
 * O caminho feliz (manda, cobra, segue) é o fácil. O que arruína um produto de
 * cobrança por mensagem são os outros quatro:
 *
 *   • a Meta recusa  → não pode cobrar
 *   • o processo morre entre enviar e cobrar → a retentativa não pode cobrar 2x
 *   • o crédito acaba no meio → tem de parar, não estourar
 *   • o número cai para vermelho → tem de parar, mesmo com crédito sobrando
 *
 *     npx vitest run lib/broadcast/motor.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";

interface EstadoDoBanco {
  pendentes: Array<{ id: string; phone_e164: string; valores: Record<string, string> }>;
  lancamentos: Array<Record<string, unknown>>;
  atualizacoes: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Simula o índice único da 0244: (org, ref_kind, ref_id) não repete. */
  cobrados: Set<string>;
}

function bancoFalso(estado: EstadoDoBanco): SupabaseClient {
  const saldoDoExtrato = () =>
    estado.lancamentos.reduce(
      (acc, l) =>
        acc + (l.tipo === "debito" ? -Number(l.amount_cents) : Number(l.amount_cents)),
      0,
    );

  return {
    from(tabela: string) {
      if (tabela === "tenant_wallet_ledger") {
        // O saldo é lido por `lerSaldoDaCarteira`, que pagina com `range` e pede
        // a contagem na primeira página (lib/carteira/ler-saldo.ts).
        const paginado = {
          order: () => paginado,
          range: async (de: number, ate: number) => ({
            data: estado.lancamentos.slice(de, ate + 1).map((l) => ({
              tipo: l.tipo,
              amount_cents: l.amount_cents,
              occurred_at: "2026-09-16T00:00:00Z",
            })),
            error: null,
            count: estado.lancamentos.length,
          }),
        };
        return {
          select: () => ({ eq: () => paginado }),
          insert: async (linha: Record<string, unknown>) => {
            const chave = `${linha.ref_kind}:${linha.ref_id}`;
            if (estado.cobrados.has(chave)) return { error: { code: "23505", message: "dup" } };
            estado.cobrados.add(chave);
            estado.lancamentos.push(linha);
            return { error: null };
          },
        };
      }
      if (tabela === "broadcast_recipients") {
        return {
          select: (_cols: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: () => ({
                  eq: async () => ({ count: estado.pendentes.length, error: null }),
                }),
              };
            }
            return {
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: estado.pendentes[0] ?? null,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              estado.atualizacoes.push({ id, patch });
              estado.pendentes = estado.pendentes.filter((p) => p.id !== id);
              return { error: null };
            },
          }),
        };
      }
      throw new Error("tabela inesperada: " + tabela);
    },
  } as unknown as SupabaseClient;

  void saldoDoExtrato;
}

function campanha(preco: number | null): CampanhaEmCurso {
  return {
    id: "camp-1",
    organization_id: ORG,
    template_name: "mia_primeiro_contato",
    template_language: "pt_BR",
    valores_padrao: { "2": "Rafa", "3": "Time Company" },
    preco_cents: preco,
  };
}

function estadoCom(qtd: number, creditoCents: number): EstadoDoBanco {
  return {
    pendentes: Array.from({ length: qtd }, (_, i) => ({
      id: `r${i}`,
      phone_e164: `553199999000${i}`,
      valores: { "1": `Pessoa ${i}` },
    })),
    lancamentos: creditoCents
      ? [{ tipo: "credito", amount_cents: creditoCents, ref_kind: "recarga_manual", ref_id: null }]
      : [],
    atualizacoes: [],
    cobrados: new Set(),
  };
}

describe("o motor cobra o que a Meta aceitou", () => {
  it("envia, marca e debita — nessa ordem", async () => {
    const estado = estadoCom(2, 10_000);
    const enviar = vi.fn(async () => "wamid.1");
    const r = await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar,
      qualidade: async () => "GREEN",
    });

    expect(r.enviadas).toBe(2);
    expect(r.cobradoCents).toBe(24);
    const debitos = estado.lancamentos.filter((l) => l.tipo === "debito");
    expect(debitos).toHaveLength(2);
    expect(
      debitos[0]!.ref_id,
      "o débito aponta para a LINHA do destinatário — é o que permite a retentativa saber que já cobrou",
    ).toBe("r0");
  });

  it("os valores do destinatário mandam sobre os da campanha", async () => {
    const estado = estadoCom(1, 10_000);
    const enviar = vi.fn(async () => "wamid.1");
    await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar,
      qualidade: async () => "GREEN",
    });
    expect(enviar).toHaveBeenCalledWith(
      expect.objectContaining({ values: { "1": "Pessoa 0", "2": "Rafa", "3": "Time Company" } }),
    );
  });

  it("a Meta RECUSANDO não cobra — e a linha guarda o motivo", async () => {
    const estado = estadoCom(1, 10_000);
    const r = await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar: async () => {
        throw new Error("meta_131047: fora da janela");
      },
      qualidade: async () => "GREEN",
    });

    expect(r.falhas).toBe(1);
    expect(
      estado.lancamentos.filter((l) => l.tipo === "debito"),
      "cobrou por mensagem que a Meta recusou",
    ).toHaveLength(0);
    expect(String(estado.atualizacoes[0]!.patch.erro)).toContain("131047");
  });

  it("cobrança REPETIDA é engolida como sucesso — é a retentativa, não erro", async () => {
    const estado = estadoCom(1, 10_000);
    // Simula o débito já gravado por uma rodada que morreu depois de cobrar.
    estado.cobrados.add("broadcast_message:r0");
    const r = await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar: async () => "wamid.1",
      qualidade: async () => "GREEN",
    });
    expect(r.enviadas, "a retentativa tratou 'já cobrada' como falha e perdeu o envio").toBe(1);
    expect(
      estado.lancamentos.filter((l) => l.tipo === "debito"),
      "cobrou duas vezes a mesma mensagem",
    ).toHaveLength(0);
  });
});

describe("o motor para quando tem de parar", () => {
  it("crédito que acaba no meio PARA — não estoura para negativo", async () => {
    // R$ 0,30 de saldo, R$ 0,12 por mensagem: cabem 2, a lista tem 5.
    const estado = estadoCom(5, 30);
    const r = await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar: async () => "wamid.1",
      qualidade: async () => "GREEN",
    });
    expect(r.enviadas).toBe(2);
    expect(r.parou).toBe("saldo_acabou");
    expect(r.restam, "quem sobrou continua pendente, para a próxima rodada").toBe(3);
  });

  it("número em VERMELHO para antes da primeira, mesmo com crédito de sobra", async () => {
    const estado = estadoCom(5, 100_000);
    const enviar = vi.fn(async () => "wamid.1");
    const r = await rodarCampanha(bancoFalso(estado), campanha(12), {
      enviar,
      qualidade: async () => "RED",
    });
    expect(r.enviadas).toBe(0);
    expect(r.parou).toBe("numero_em_risco");
    expect(enviar, "mandou mensagem num número que a Meta já está para desligar").not.toHaveBeenCalled();
  });

  it("cortesia (preço zero) não gera lançamento nenhum", async () => {
    const estado = estadoCom(3, 0);
    const r = await rodarCampanha(bancoFalso(estado), campanha(0), {
      enviar: async () => "wamid.1",
      qualidade: async () => "GREEN",
    });
    expect(r.enviadas).toBe(3);
    expect(
      estado.lancamentos,
      "uma linha de R$ 0,00 por mensagem encheria o extrato do cliente de ruído",
    ).toHaveLength(0);
  });
});

describe("o estorno", () => {
  it("entra como lançamento NOVO, não apaga o débito", async () => {
    const estado = estadoCom(0, 0);
    estado.cobrados.add("broadcast_message:r0");
    const ok = await estornar(bancoFalso(estado), {
      organizationId: ORG,
      recipientId: "r0",
      precoCents: 12,
    });
    expect(ok).toBe(true);
    expect(
      estado.lancamentos[0]!.ref_id,
      "o estorno colidiu com o débito no índice único: sem sufixo próprio ele nunca seria gravado",
    ).toBe("r0:estorno");
    expect(estado.lancamentos[0]!.tipo).toBe("estorno");
  });
});

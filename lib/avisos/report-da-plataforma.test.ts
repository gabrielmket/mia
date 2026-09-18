import { describe, expect, it, vi } from "vitest";

const enviados = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      enviados.push(envelope);
      return { externalId: "msg-1" };
    },
  }),
}));

import { CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";

import { reportar } from "./report-da-plataforma";

/**
 * O GRUPO QUE RECEBE DEMAIS É IGNORADO EM UMA SEMANA.
 *
 * E aí o aviso que importa — o crédito que acabou às 2h de sábado — chega junto
 * com o lixo e ninguém lê. Este repositório já mediu esse defeito duas vezes:
 * alertas que nunca se fechavam, e avisos fantasma que sobreviviam à condição
 * que os criou.
 *
 * O cron roda a cada 10 minutos e as condições são ESTADOS que duram dias. Sem
 * a trava, um saldo baixo por uma semana renderia mil recados. Por isso a trava
 * é testada como parte da feature, e não como detalhe de implementação.
 *
 *     npx vitest run lib/avisos/report-da-plataforma.test.ts
 */

const GRUPO = "120363405136320907@g.us";
const sessao = { provider: CHANNEL_PROVIDER_WAHA, waha_session_name: "plataforma" };

/**
 * Banco de mentira com só o que a função lê. `enviadoHa` em horas: `null` = o
 * aviso nunca saiu.
 */
function bancoCom(opcoes: { grupo: unknown; enviadoHaHoras: number | null; temNumero?: boolean }) {
  const marcados: Array<Record<string, unknown>> = [];
  return {
    marcados,
    db: {
      from: (tabela: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (tabela === "platform_avisos") return { data: opcoes.grupo, error: null };
              if (tabela === "platform_avisos_enviados") {
                return {
                  data:
                    opcoes.enviadoHaHoras === null
                      ? null
                      : {
                          enviado_em: new Date(
                            Date.now() - opcoes.enviadoHaHoras * 60 * 60 * 1000,
                          ).toISOString(),
                        },
                  error: null,
                };
              }
              // channel_sessions
              return { data: opcoes.temNumero === false ? null : sessao, error: null };
            },
          }),
        }),
        upsert: async (linha: Record<string, unknown>) => {
          marcados.push(linha);
          return { error: null };
        },
      }),
    } as never,
  };
}

const configurado = {
  grupo_id: GRUPO,
  grupo_nome: "Report Time Company",
  limite_saldo_usd: 20,
  resumo_diario: true,
};

describe("o report no grupo interno", () => {
  it("manda quando o aviso nunca saiu, e marca que saiu", async () => {
    enviados.length = 0;
    const { db, marcados } = bancoCom({ grupo: configurado, enviadoHaHoras: null });

    const saiu = await reportar(db, { chave: "saldo_baixo", horas: 24, texto: "acabando" });

    expect(saiu).toBe(true);
    expect(enviados[0]!.to).toBe(GRUPO);
    expect(
      marcados[0]?.chave,
      "o recado saiu e a trava não gravou: na próxima rodada ele sai de novo, e em dez minutos o grupo vira ruído",
    ).toBe("saldo_baixo");
  });

  it("CALA quando o mesmo aviso já saiu dentro da janela", async () => {
    enviados.length = 0;
    const { db } = bancoCom({ grupo: configurado, enviadoHaHoras: 2 });

    const saiu = await reportar(db, { chave: "saldo_baixo", horas: 24, texto: "acabando" });

    expect(saiu).toBe(false);
    expect(
      enviados,
      "o cron roda a cada 10 minutos: sem esta trava, um saldo baixo por uma semana rende mil recados e o grupo deixa de ser lido",
    ).toHaveLength(0);
  });

  it("volta a mandar depois que a janela passa — o problema continua de pé", async () => {
    enviados.length = 0;
    const { db } = bancoCom({ grupo: configurado, enviadoHaHoras: 30 });

    expect(await reportar(db, { chave: "saldo_baixo", horas: 24, texto: "ainda acabando" })).toBe(
      true,
    );
  });

  it("CALA quando ninguém escolheu um grupo — nunca inventa destino", async () => {
    enviados.length = 0;
    const { db } = bancoCom({ grupo: { grupo_id: null, grupo_nome: null }, enviadoHaHoras: null });

    expect(await reportar(db, { chave: "x", horas: 24, texto: "oi" })).toBe(false);
    expect(
      enviados,
      "um report interno traz saldo, nome de cliente e estado da instalação: chegando ao grupo errado é pior que não chegar",
    ).toHaveLength(0);
  });

  it("CALA quando o id salvo não é de grupo — telefone colado no lugar", async () => {
    enviados.length = 0;
    const { db } = bancoCom({
      grupo: { ...configurado, grupo_id: "5531999999999@c.us" },
      enviadoHaHoras: null,
    });

    expect(await reportar(db, { chave: "x", horas: 24, texto: "oi" })).toBe(false);
  });

  it("CALA quando não há número de avisos marcado, em vez de estourar", async () => {
    enviados.length = 0;
    const { db } = bancoCom({ grupo: configurado, enviadoHaHoras: null, temNumero: false });

    expect(await reportar(db, { chave: "x", horas: 24, texto: "oi" })).toBe(false);
  });
});

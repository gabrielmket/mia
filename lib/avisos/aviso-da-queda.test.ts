import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enviados = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      enviados.push(envelope);
      return { externalId: `msg-${enviados.length}` };
    },
  }),
}));

import { PROVIDER_EM_QUE_O_NUMERO_E_A_CONEXAO as QR } from "@/lib/channels/capabilities";
import { logger } from "@/lib/logger";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

import {
  avisarQuedasEVoltas,
  chaveDaQueda,
  chaveDaVolta,
  chaveDeForaDesde,
  ESPERA_ANTES_DE_AVISAR_MIN,
  estadoDoAvisoDaQueda,
  rotuloDoNumero,
  textoDaQueda,
  textoDaVolta,
} from "./aviso-da-queda";

/**
 * FORK MIA (MIA-48) — O AVISO DA QUEDA E DA VOLTA DO NÚMERO NO GRUPO DO CLIENTE.
 *
 * O que se mede é o que CHEGA a cada grupo (o envelope do envio), rodada após
 * rodada do cron, com o relógio andando. Tudo fictício: Academia Alfa, Academia
 * Beta, o telefone +55 31 900000002 e grupos `1203630000000000xx@g.us`.
 *
 *     npx vitest run lib/avisos/aviso-da-queda.test.ts
 */

const ALFA = "0a000000-0000-4000-8000-0000000000a1";
const BETA = "0a000000-0000-4000-8000-0000000000b2";
const GAMA = "0a000000-0000-4000-8000-0000000000c3";
const PLATAFORMA = "0a000000-0000-4000-8000-0000000000f0";

const GRUPO_ALFA = "120363000000000011@g.us";
const GRUPO_BETA = "120363000000000022@g.us";

const SESSAO_ALFA = "0e000000-0000-4000-8000-0000000000a1";
const SESSAO_BETA = "0e000000-0000-4000-8000-0000000000b2";
const SESSAO_GAMA = "0e000000-0000-4000-8000-0000000000c3";
const SESSAO_AVISOS = "0e000000-0000-4000-8000-0000000000f0";

const INICIO = new Date("2026-11-17T14:00:00Z");
const MINUTO = 60 * 1000;

function org(id: string, nome: string, settings: Linha, status = "active"): Linha {
  return { id, display_name: nome, status, settings };
}

function sessao(id: string, organizationId: string, extra: Linha = {}): Linha {
  return {
    id,
    organization_id: organizationId,
    provider: QR,
    display_name: "Recepção",
    phone_number: "+55 31 900000002",
    status: "WORKING",
    archived_at: null,
    e_numero_de_avisos: false,
    ...extra,
  };
}

function cenario(
  opcoes: { alfa?: Linha; beta?: Linha; orgAlfa?: Linha; marcas?: Linha[]; maxRows?: number } = {},
) {
  return bancoEmMemoria({
    organizations: [
      opcoes.orgAlfa ?? org(ALFA, "Academia Alfa", { grupo_de_avisos: { id: GRUPO_ALFA, nome: "Avisos Alfa" } }),
      org(BETA, "Academia Beta", { grupo_de_avisos: { id: GRUPO_BETA, nome: "Avisos Beta" } }),
      // Sem grupo de avisos configurado.
      org(GAMA, "Academia Gama", {}),
      org(PLATAFORMA, "Plataforma", {}),
    ],
    channel_sessions: [
      sessao(SESSAO_AVISOS, PLATAFORMA, { display_name: "Avisos", phone_number: "+55 31 900000009", e_numero_de_avisos: true }),
      sessao(SESSAO_ALFA, ALFA, opcoes.alfa),
      sessao(SESSAO_BETA, BETA, { display_name: "Comercial", phone_number: "+55 31 900000003", ...opcoes.beta }),
    ],
    platform_avisos_enviados: opcoes.marcas ?? [],
  }, {}, { maxRows: opcoes.maxRows });
}

type Banco = ReturnType<typeof cenario>;

const sessaoDe = (b: Banco, id: string) => b.tabela("channel_sessions").find((s) => s.id === id)!;
const chaves = (b: Banco) => b.tabela("platform_avisos_enviados").map((m) => m.chave);

/** Roda o cron `vezes` vezes, um minuto entre cada, a partir de `minuto`. */
async function rodar(b: Banco, minuto: number, vezes = 1): Promise<void> {
  for (let i = 0; i < vezes; i++) {
    vi.setSystemTime(new Date(INICIO.getTime() + (minuto + i) * MINUTO));
    await avisarQuedasEVoltas(b.cliente as never, new Date());
  }
}

beforeEach(() => {
  enviados.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("os textos que o cliente recebe", () => {
  it("a queda diz qual número caiu (nome e final do telefone) e o passo a passo do QR", () => {
    const texto = textoDaQueda({ display_name: "Recepção", phone_number: "+55 31 900000002" });
    expect(texto).toContain("*Número:* Recepção (final 0002)");
    expect(texto).toContain("/app/connections");
    expect(texto).toContain("*Reconectar*");
    expect(texto).toContain("*Dispositivos conectados*");
    expect(texto, "o telefone inteiro não vai para o grupo: o final basta para reconhecer").not.toContain("900000002");
  });

  it("a volta é curta e fala do mesmo número", () => {
    const texto = textoDaVolta({ display_name: "Recepção", phone_number: "+55 31 900000002" });
    expect(texto).toContain("voltou");
    expect(texto).toContain("Recepção (final 0002)");
    expect(texto.split("\n").length).toBeLessThan(6);
  });

  it("número sem nome vira só o final do telefone", () => {
    expect(rotuloDoNumero({ display_name: null, phone_number: "+55 31 900000002" })).toBe("final 0002");
    expect(rotuloDoNumero({ display_name: "  ", phone_number: "+55 31 900000002" })).toBe("final 0002");
  });
});

describe("a queda gera UM aviso só, mesmo com o cron rodando várias vezes", () => {
  it("⭐ espera a queda durar, avisa uma vez e cala pelo resto do dia", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });

    // A primeira rodada só começa a contar: o reinício do contêiner também deixa a sessão parada por um minuto.
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN);
    expect(enviados, "antes da espera, nenhum recado: senão todo deploy vira um 'caiu' e um 'voltou'").toHaveLength(0);
    expect(chaves(b)).toContain(chaveDeForaDesde(SESSAO_ALFA));

    await rodar(b, ESPERA_ANTES_DE_AVISAR_MIN, 1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.to).toBe(GRUPO_ALFA);
    expect(enviados[0]!.body).toContain("Recepção (final 0002)");

    // O cron segue rodando de minuto em minuto por quase um dia.
    await rodar(b, ESPERA_ANTES_DE_AVISAR_MIN + 1, 30);
    await rodar(b, 23 * 60, 5);
    expect(enviados, "o cron roda de minuto em minuto: sem a trava, a queda de um dia rende 1.440 recados").toHaveLength(1);
    expect(chaves(b)).toContain(chaveDaQueda(SESSAO_ALFA));
  });

  it("a queda que dura mais de um dia é lembrada uma vez por dia, como no report interno", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    expect(enviados).toHaveLength(1);
    await rodar(b, ESPERA_ANTES_DE_AVISAR_MIN + 24 * 60 + 1, 3);
    expect(enviados).toHaveLength(2);
  });

  it("STARTING não é queda (é o estado de todo boot)", async () => {
    const b = cenario({ alfa: { status: "STARTING" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 5);
    expect(enviados).toHaveLength(0);
  });

  it("linha morta sem telefone é QR que ninguém leu, não queda", async () => {
    const b = cenario({ alfa: { status: "FAILED", phone_number: null } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 5);
    expect(enviados).toHaveLength(0);
  });
});

describe("a volta gera a confirmação", () => {
  it("⭐ depois da queda avisada, o número volta e o grupo recebe UMA confirmação", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    expect(enviados).toHaveLength(1);

    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 60, 10);

    expect(enviados).toHaveLength(2);
    expect(enviados[1]!.to).toBe(GRUPO_ALFA);
    expect(enviados[1]!.body).toContain("voltou");
    expect(chaves(b)).toContain(chaveDaVolta(SESSAO_ALFA));
    expect(chaves(b), "o relógio da queda zera quando o número volta").not.toContain(chaveDeForaDesde(SESSAO_ALFA));
  });

  it("sem queda avisada, sem volta avisada: o número que caiu e voltou dentro da espera não rende recado", async () => {
    const b = cenario({ alfa: { status: "STOPPED" } });
    await rodar(b, 0, 2);
    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 2, 20);
    expect(enviados).toHaveLength(0);
    expect(chaves(b)).toEqual([]);
  });

  it("caiu de novo no mesmo dia depois de voltar: a trava de um aviso por dia vale, e sem queda avisada não há volta", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 60, 1);
    expect(enviados).toHaveLength(2);

    sessaoDe(b, SESSAO_ALFA).status = "FAILED";
    await rodar(b, 120, ESPERA_ANTES_DE_AVISAR_MIN + 5);
    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 200, 3);
    expect(enviados).toHaveLength(2);
  });
});

describe("cliente sem grupo, chave desligada, empresa parada", () => {
  it("cliente sem grupo configurado não quebra nada e não recebe nada", async () => {
    const b = cenario();
    b.tabela("channel_sessions").push(sessao(SESSAO_GAMA, GAMA, { status: "FAILED" }));
    await expect(rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 3)).resolves.toBeUndefined();
    expect(enviados).toHaveLength(0);
    // Volta sem queda avisada: nada.
    sessaoDe(b, SESSAO_GAMA).status = "WORKING";
    await rodar(b, 60, 2);
    expect(enviados).toHaveLength(0);
  });

  it("a chave desligada cala o grupo do cliente", async () => {
    const b = cenario({
      alfa: { status: "FAILED" },
      orgAlfa: org(ALFA, "Academia Alfa", {
        grupo_de_avisos: { id: GRUPO_ALFA, nome: "Avisos Alfa" },
        aviso_da_queda_do_numero: false,
      }),
    });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 3);
    expect(enviados).toHaveLength(0);
  });

  it("empresa suspensa não recebe recado", async () => {
    const b = cenario({
      alfa: { status: "FAILED" },
      orgAlfa: org(ALFA, "Academia Alfa", { grupo_de_avisos: { id: GRUPO_ALFA, nome: "Avisos Alfa" } }, "suspended"),
    });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 3);
    expect(enviados).toHaveLength(0);
  });

  it("desligaram a chave depois da queda: a volta é dada por fechada, sem recado", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    expect(enviados).toHaveLength(1);
    const alfa = b.tabela("organizations").find((o) => o.id === ALFA)!;
    alfa.settings = { ...(alfa.settings as Linha), aviso_da_queda_do_numero: false };

    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 60, 3);
    expect(enviados).toHaveLength(1);

    // Religar a chave dias depois não ressuscita uma volta velha.
    alfa.settings = { ...(alfa.settings as Linha), aviso_da_queda_do_numero: true };
    await rodar(b, 3 * 24 * 60, 2);
    expect(enviados).toHaveLength(1);
  });
});

describe("o aviso da Academia Alfa nunca vai para o grupo da Academia Beta", () => {
  it("⭐ as duas caem ao mesmo tempo: cada recado vai ao grupo da própria empresa", async () => {
    const b = cenario({ alfa: { status: "FAILED" }, beta: { status: "SCAN_QR_CODE" } });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);

    expect(enviados).toHaveLength(2);
    const paraAlfa = enviados.filter((e) => e.organizationId === ALFA);
    const paraBeta = enviados.filter((e) => e.organizationId === BETA);
    expect(paraAlfa.map((e) => e.to)).toEqual([GRUPO_ALFA]);
    expect(paraBeta.map((e) => e.to)).toEqual([GRUPO_BETA]);
    expect(paraAlfa[0]!.body).toContain("Recepção (final 0002)");
    expect(paraBeta[0]!.body).toContain("Comercial (final 0003)");
    expect(paraBeta[0]!.body).not.toContain("0002");

    // E na volta de uma só, só o grupo dela recebe.
    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 60, 2);
    expect(enviados).toHaveLength(3);
    expect(enviados[2]!.to).toBe(GRUPO_ALFA);
  });
});

describe("quem caiu é o próprio número de avisos", () => {
  it("⭐ nada sai para cliente nenhum (o report interno é quem trata dele)", async () => {
    const b = cenario();
    sessaoDe(b, SESSAO_AVISOS).status = "FAILED";
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 5);
    expect(enviados).toHaveLength(0);
    expect(chaves(b), "a queda do número de avisos não abre relógio nem trava de cliente").toEqual([]);

    sessaoDe(b, SESSAO_AVISOS).status = "WORKING";
    await rodar(b, 60, 2);
    expect(enviados).toHaveLength(0);
  });

  it("com ele fora, a queda do cliente espera, sem marcar, e sai quando ele volta", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    sessaoDe(b, SESSAO_AVISOS).status = "FAILED";
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 5);
    expect(enviados).toHaveLength(0);
    expect(chaves(b)).not.toContain(chaveDaQueda(SESSAO_ALFA));

    sessaoDe(b, SESSAO_AVISOS).status = "WORKING";
    await rodar(b, 30, 3);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.to).toBe(GRUPO_ALFA);
  });
});

describe("o volume de marcas não cala o aviso (o corte de 1000 linhas do PostgREST)", () => {
  /**
   * A marca da queda e a da volta ficam para sempre (são a trava de 24h): duas
   * linhas por número que já caiu um dia. Com 1200 marcas antigas antes, uma
   * leitura de todas as marcas pelo prefixo voltava cortada em 1000 linhas, sem a
   * marca `fora` da queda nova. O código achava que era a primeira vez, regravava
   * o relógio a cada minuto e a espera de 10 minutos nunca vencia: o cliente
   * nunca era avisado, sem erro e sem log.
   */
  const antigas = (n: number): Linha[] =>
    Array.from({ length: n }, (_, i) => {
      const id = `0e000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const em = new Date(INICIO.getTime() - 30 * 24 * 60 * MINUTO).toISOString();
      return [
        { chave: chaveDaQueda(id), enviado_em: em, detalhe: {} },
        { chave: chaveDaVolta(id), enviado_em: em, detalhe: { enviada: true } },
      ];
    }).flat();

  it("⭐ com 1200 marcas antigas, a queda nova ainda é avisada depois da espera", async () => {
    const b = cenario({ alfa: { status: "FAILED" }, marcas: antigas(600), maxRows: 1000 });

    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 5);

    const fora = b.tabela("platform_avisos_enviados").find((m) => m.chave === chaveDeForaDesde(SESSAO_ALFA));
    expect(fora?.enviado_em, "o relógio da queda é gravado uma vez, não regravado a cada minuto").toBe(
      INICIO.toISOString(),
    );
    expect(enviados.map((e) => e.to)).toEqual([GRUPO_ALFA]);
  });

  it("⭐ e a volta também sai, com as mesmas 1200 marcas antigas", async () => {
    const b = cenario({ alfa: { status: "FAILED" }, marcas: antigas(600), maxRows: 1000 });
    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    expect(enviados).toHaveLength(1);

    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, ESPERA_ANTES_DE_AVISAR_MIN + 1, 3);

    expect(enviados).toHaveLength(2);
    expect(String(enviados[1]!.body)).toContain("voltou");
    expect(chaves(b)).not.toContain(chaveDeForaDesde(SESSAO_ALFA));
  });

  it("a sessão arquivada enquanto estava caída não deixa a marca do relógio para sempre", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    await rodar(b, 0);
    expect(chaves(b)).toContain(chaveDeForaDesde(SESSAO_ALFA));

    sessaoDe(b, SESSAO_ALFA).archived_at = new Date(INICIO.getTime() + MINUTO).toISOString();
    await rodar(b, 1);

    expect(chaves(b)).not.toContain(chaveDeForaDesde(SESSAO_ALFA));
    expect(enviados).toHaveLength(0);
  });

  it("o relógio que o banco recusa (o `error` do supabase, sem lançar) vai para o log", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    const real = b.cliente as unknown as { from: (t: string) => Record<string, unknown> };
    const cliente = {
      ...real,
      from: (t: string) => {
        const q = real.from(t);
        if (t !== "platform_avisos_enviados") return q;
        return {
          ...q,
          upsert: (linha: Linha, ...resto: unknown[]) =>
            String(linha.chave) === chaveDeForaDesde(SESSAO_ALFA)
              ? Promise.resolve({ data: null, error: { message: "falha de teste" } })
              : (q.upsert as (...a: unknown[]) => unknown)(linha, ...resto),
        };
      },
    };
    const aviso = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    try {
      await avisarQuedasEVoltas(cliente as never, new Date());
      expect(chaves(b)).not.toContain(chaveDeForaDesde(SESSAO_ALFA));
      expect(aviso).toHaveBeenCalledWith(
        expect.stringContaining("o relógio da queda não gravou"),
        expect.objectContaining({ organizationId: ALFA, sessionId: SESSAO_ALFA, detail: "falha de teste" }),
      );
    } finally {
      aviso.mockRestore();
    }
  });
});

describe("o estado para o MCP", () => {
  it("diz se está ligada, se há grupo, e os últimos avisos de queda e de volta", async () => {
    const b = cenario({ alfa: { status: "FAILED" } });
    const settings = b.tabela("organizations").find((o) => o.id === ALFA)!.settings;

    const antes = await estadoDoAvisoDaQueda(b.cliente as never, ALFA, settings);
    expect(antes).toEqual({
      ligada: true,
      grupo_configurado: true,
      vai_avisar: true,
      ultimo_aviso_de_queda: null,
      ultimo_aviso_de_volta: null,
    });

    await rodar(b, 0, ESPERA_ANTES_DE_AVISAR_MIN + 1);
    sessaoDe(b, SESSAO_ALFA).status = "WORKING";
    await rodar(b, 60, 1);

    const depois = await estadoDoAvisoDaQueda(b.cliente as never, ALFA, settings);
    expect(depois.ultimo_aviso_de_queda?.numero).toBe("Recepção (final 0002)");
    expect(depois.ultimo_aviso_de_volta?.numero).toBe("Recepção (final 0002)");
    expect(depois.ultimo_aviso_de_volta!.em > depois.ultimo_aviso_de_queda!.em).toBe(true);

    // A Beta não enxerga os avisos da Alfa.
    const beta = await estadoDoAvisoDaQueda(b.cliente as never, BETA, {});
    expect(beta).toMatchObject({ grupo_configurado: false, vai_avisar: false, ultimo_aviso_de_queda: null });
  });
});

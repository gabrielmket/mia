import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { mexeuNaJanela } from "@/lib/ai/pacing/reprogramar-adiados";

/**
 * ALARGAR A JANELA PRECISA REPROGRAMAR QUEM ESTAVA ESPERANDO POR ELA.
 *
 * Auditoria de 18/09/2026, defeito 2 — o pior dos seis, porque é o único que
 * deixa o produto sem saída PELA TELA.
 *
 * `inbound-turn.ts` adia o turno quando a janela anti-ban está fechada e congela
 * `run_after` na abertura calculada NAQUELE instante. Nada revisitava jobs
 * pendentes quando os knobs mudavam. Evidência de produção: job `d2504332…`,
 * `inbound_turn`, `pending`, `run_after` 07:00 local, com `channel_knobs` já em
 * 0h–23h — o operador tinha alargado a janela justamente para destravar um
 * teste, e o sistema não respondeu.
 *
 * O caminho que uma pessoa percorre para se salvar sozinha não pode ser o
 * caminho que não faz nada: ela conclui que a configuração está quebrada.
 */

const update = vi.fn();
const select = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      filtros.tabela = tabela;
      return cadeia;
    },
  }),
}));

const filtros: Record<string, unknown> = {};

/** Cadeia do supabase-js que anota cada filtro aplicado, e nada mais. */
const cadeia: Record<string, (...args: unknown[]) => unknown> = {
  update: (patch: unknown) => {
    update(patch);
    return cadeia;
  },
  eq: (col: unknown, val: unknown) => {
    filtros[`eq:${String(col)}`] = val;
    return cadeia;
  },
  gt: (col: unknown, val: unknown) => {
    filtros[`gt:${String(col)}`] = val;
    return cadeia;
  },
  select: () => select(),
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(filtros)) delete filtros[k];
});

describe("mexeuNaJanela: quando vale a pena mexer na fila", () => {
  it("campo de janela → sim", () => {
    expect(mexeuNaJanela({ window_start_hour: 0 })).toBe(true);
    expect(mexeuNaJanela({ window_end_hour: 23 })).toBe(true);
    expect(mexeuNaJanela({ allow_sunday: true })).toBe(true);
    expect(mexeuNaJanela({ timezone: "America/Sao_Paulo" })).toBe(true);
  });

  it("janela de RESPOSTA (0495) → sim: é ela que adia o turno de quem escreveu", () => {
    // FORK MIA: desde a v1.66.0 do upstream o turno inbound é adiado pela janela
    // de resposta. Abrir a resposta para 0h-24h sem reprogramar a fila deixaria o
    // turno de madrugada preso no horário calculado com a janela antiga.
    expect(mexeuNaJanela({ resposta_start_hour: 0 })).toBe(true);
    expect(mexeuNaJanela({ resposta_end_hour: 24 })).toBe(true);
    expect(mexeuNaJanela({ resposta_start_hour: null, resposta_end_hour: null })).toBe(true);
  });

  it("só espaçamento entre envios → não", () => {
    // `throttle_ms`/`jitter_max_ms` mudam o RITMO, não a permissão de enviar. Um
    // turno adiado pela janela não está esperando por eles, e mexer na fila sem
    // motivo é ruído numa tabela quente.
    expect(mexeuNaJanela({ throttle_ms: 1200, jitter_max_ms: 800 })).toBe(false);
  });

  it("null explícito ainda é declaração — volta ao default e pode reabrir", () => {
    // `window_start_hour: null` é "volta ao default do motor", que é uma janela
    // DIFERENTE da que estava gravada. Olhar o valor em vez da PRESENÇA da chave
    // deixaria esse caso de fora.
    expect(mexeuNaJanela({ window_start_hour: null })).toBe(true);
  });

  it("PUT vazio → não", () => {
    expect(mexeuNaJanela({})).toBe(false);
  });
});

describe("reprogramarTurnosAdiadosPelaJanela: o que ela toca, e o que não", () => {
  it("traz para agora SÓ o que está adiado pela janela, neste canal e nesta org", async () => {
    select.mockResolvedValue({ data: [{ id: "j1" }, { id: "j2" }], error: null });
    const { reprogramarTurnosAdiadosPelaJanela } = await import(
      "@/lib/ai/pacing/reprogramar-adiados"
    );

    const n = await reprogramarTurnosAdiadosPelaJanela({
      organizationId: "org-1",
      channelSessionId: "canal-1",
    });

    expect(n).toBe(2);
    expect(filtros["tabela"]).toBe("job_queue");

    // TENANCY: o admin client passa por cima da RLS, então o filtro de
    // organização é manual — e vem do authz da rota, nunca do body.
    expect(filtros["eq:organization_id"]).toBe("org-1");
    expect(filtros["eq:payload->>channel_session_id"]).toBe("canal-1");

    // O MOTIVO vem da COLUNA, não de comparar o texto de `last_error`: filtrar
    // por frase quebra calado no dia em que alguém melhorar a frase.
    expect(filtros["eq:deferred_reason"]).toBe("janela_anti_ban");
    expect(filtros["eq:kind"]).toBe("inbound_turn");
    expect(filtros["eq:status"]).toBe("pending");

    // Só o que ainda está no futuro: job já vencido não precisa de empurrão, e
    // reescrever seu `run_after` só o faria perder a vez na ordem do claim.
    expect(filtros["gt:run_after"]).toBeTypeOf("string");

    // E o motivo é LIMPO junto — o job deixou de estar adiado pela janela, e
    // deixá-lo marcado o faria ser reprogramado de novo no próximo PUT.
    const patch = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch["deferred_reason"]).toBeNull();
    expect(patch["run_after"]).toBeTypeOf("string");
  });

  it("falha de consulta devolve NULL, nunca 0", async () => {
    // A distinção é a lição de `channel_knobs.updated_at`, que custou uma hora:
    // devolver 0 afirmaria "não havia turno esperando", que é uma afirmação
    // sobre o mundo que ninguém mediu. Quem chama precisa poder dizer "não sei".
    select.mockResolvedValue({ data: null, error: { message: "relation down" } });
    const { reprogramarTurnosAdiadosPelaJanela } = await import(
      "@/lib/ai/pacing/reprogramar-adiados"
    );

    const n = await reprogramarTurnosAdiadosPelaJanela({
      organizationId: "org-1",
      channelSessionId: "canal-1",
    });

    expect(n).toBeNull();
    expect(n).not.toBe(0);
  });

  it("exceção inesperada não derruba o PUT — os knobs já foram salvos", async () => {
    // Quando esta função roda, o `upsert` de `channel_knobs` JÁ aconteceu.
    // Deixar a exceção subir devolveria "falha ao salvar" para uma configuração
    // que ESTÁ salva, e mandaria a pessoa tentar de novo contra um estado que já
    // mudou. Também aqui a resposta é `null` ("não sei"), nunca `0`.
    select.mockImplementation(() => {
      throw new Error("PostgREST fora do ar");
    });
    const { reprogramarTurnosAdiadosPelaJanela } = await import(
      "@/lib/ai/pacing/reprogramar-adiados"
    );

    await expect(
      reprogramarTurnosAdiadosPelaJanela({
        organizationId: "org-1",
        channelSessionId: "canal-1",
      }),
    ).resolves.toBeNull();
  });
});

/**
 * O MOTIVO DO ADIAMENTO É COLUNA, E CADA CHAMADOR DECLARA O SEU.
 *
 * Auditoria de 18/09, defeito 2 — o passo anterior ao conserto. Filtrar jobs
 * comparando o texto de `last_error` funcionaria hoje e quebraria CALADO no dia
 * em que alguém melhorasse a frase.
 */
describe("rescheduleJob: os três motivos, cada um no seu lugar", () => {
  const turno = readFileSync(
    join(process.cwd(), "lib", "agent-engine", "agent", "inbound-turn.ts"),
    "utf8",
  );
  const envio = readFileSync(
    join(process.cwd(), "lib", "agent-engine", "edge", "crm", "send-message.ts"),
    "utf8",
  );

  it("a janela anti-ban declara `janela_anti_ban` — é o único que a tela reprograma", () => {
    expect(turno).toContain("motivo: 'janela_anti_ban'");
  });

  it("o horário do agente declara motivo PRÓPRIO, não o da janela", () => {
    // Trazê-lo junto com a janela o adiaria de novo no mesmo segundo: ele depende
    // da versão publicada do agente, não do knob do canal.
    expect(turno).toContain("motivo: 'horario_do_agente'");
  });

  it("a sessão do canal fora declara `canal_fora`", () => {
    expect(envio).toContain("motivo: 'canal_fora'");
  });

  it("todo motivo de ADIAMENTO está no vocabulário que o banco aceita", async () => {
    const { MOTIVOS_DE_ADIAMENTO } = await import("@/lib/agent-engine/queue/queue");

    // ⚠️ `motivo:` é nome de campo REUTILIZADO neste repositório — `avisarLeadDaEscalacao`
    // usa `motivo: 'pediu_humano'`, o orçamento usa `motivo: 'orcamento_de_ia'`.
    // Varrer o arquivo inteiro por `motivo:` acusa esses e reprova por motivo
    // falso, que foi o que esta versão do teste fez na primeira execução. O
    // recorte é o BLOCO da chamada a `rescheduleJob`, e só ele.
    const blocosDeReagendamento = (fonte: string): string[] =>
      [...fonte.matchAll(/rescheduleJob\(/g)].map((m) => fonte.slice(m.index, m.index + 600));

    const usados = [...blocosDeReagendamento(turno), ...blocosDeReagendamento(envio)]
      .flatMap((bloco) => [...bloco.matchAll(/\bmotivo: '([a-z_]+)'/g)])
      .map((m) => m[1]!);

    // Guarda de vacuidade: o recorte precisa achar os três de fato.
    expect(new Set(usados).size).toBe(3);
    for (const m of usados) {
      expect(MOTIVOS_DE_ADIAMENTO as readonly string[]).toContain(m);
    }
  });
});

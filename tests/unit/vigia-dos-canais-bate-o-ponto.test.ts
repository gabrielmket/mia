/**
 * FORK MIA (MIA-154) — o vigia dos números bate o ponto no fim da rodada.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * Numa rodada estável (todo número `WORKING`, contador zero) o vigia
 * (`app/api/v1/cron/channel-health`) não escreve nada: é de propósito. O efeito
 * é que ninguém sabia se ele tinha passado, e em 23/11 a ronda concluiu que a
 * checagem tinha parado desde 19/11 lendo uma coluna de outra tela (MIA-152).
 *
 * ─── O que se prova aqui (casos EXECUTADOS, com o banco dublado) ───────────
 *
 *  - a rodada estável grava EXATAMENTE um batimento, na rota do vigia, com o
 *    resumo que a rota responde, e só contagens;
 *  - o batimento que falha (erro do PostgREST ou exceção) não muda a resposta;
 *  - a consulta das sessões que falha não bate o ponto: o vigia não rodou;
 *  - a saída ociosa não bate o ponto: ela não toca o PostgREST (#3731, prova
 *    do upstream em `tests/unit/piso-ocioso-das-filas.test.ts`).
 *
 * O sabote de apagar a chamada a `registrarBatimento` na rota deixa o caso ⭐
 * vermelho.
 *
 *     npx vitest run tests/unit/vigia-dos-canais-bate-o-ponto.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/cron/channel-health/route";
import { ROTA_DO_VIGIA_DOS_CANAIS, TABELA_DO_BATIMENTO } from "@/lib/cron/batimento";

type Linha = Record<string, unknown>;

const duble = vi.hoisted(() => {
  const estado = {
    linhas: [] as Record<string, unknown>[],
    ops: [] as { tabela: string; op: string; payload?: unknown; opcoes?: unknown }[],
    /** Como o batimento responde: normal, com `{ error }` ou lançando. */
    batimento: "ok" as "ok" | "erro" | "lanca",
    /** A consulta de `channel_sessions` falha. */
    consultaFalha: false,
    ocioso: false,
    avisos: [] as unknown[],
  };

  const admin = {
    from(tabela: string) {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        is: () => cadeia,
        in: () => cadeia,
        limit: () => cadeia,
        update(payload?: unknown) {
          estado.ops.push({ tabela, op: "update", payload });
          return cadeia;
        },
        upsert(payload?: unknown, opcoes?: unknown) {
          estado.ops.push({ tabela, op: "upsert", payload, opcoes });
          if (tabela === "mia_batimentos_de_cron" && estado.batimento === "lanca") {
            throw new Error("conexão recusada");
          }
          const error =
            tabela === "mia_batimentos_de_cron" && estado.batimento === "erro"
              ? { message: 'relation "public.mia_batimentos_de_cron" does not exist' }
              : null;
          return Promise.resolve({ data: null, error });
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(cumprido: (v: unknown) => unknown, recusado?: (m: unknown) => unknown) {
          const dados =
            tabela === "channel_sessions" && estado.consultaFalha
              ? { data: null, error: { message: "tempo esgotado" } }
              : { data: tabela === "channel_sessions" ? estado.linhas : [], error: null };
          return Promise.resolve(dados).then(cumprido, recusado);
        },
      };
      return cadeia;
    },
  };

  return { estado, admin };
});

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: () => undefined,
    error: () => undefined,
    warn: (msg: string, ctx: unknown) => duble.estado.avisos.push({ msg, ctx }),
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => duble.admin }));
vi.mock("@/lib/cron/piso-ocioso", () => ({ recursoOcioso: async () => duble.estado.ocioso }));

// A sincronização do aviso é de outro teste (`channel-health-aviso.test.ts`):
// aqui a rodada estável não muda nada na Central.
vi.mock("@/lib/channels/health", async (original) => ({
  ...(await original<typeof import("@/lib/channels/health")>()),
  sincronizarSaudeDaConexao: async () => "sem_mudanca",
}));

vi.mock("@/lib/channels", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "provider, waha_session_name",
  DEFAULT_CHANNEL_PROVIDER: "waha",
  canalConhecidoSemMensagem: () => false,
  resolveSessionRef: (s: { waha_session_name?: string | null }) => s.waha_session_name ?? null,
  getAdapter: () => ({
    checkHealth: async () => ({ reachable: true, status: "WORKING", detail: null }),
  }),
}));

function sessao(n: number): Linha {
  return {
    id: `sessao-${n}`,
    organization_id: `org-${n}`,
    status: "WORKING",
    status_reason: null,
    display_name: `Canal ${n}`,
    phone_number: `+55119999900${n}`,
    archived_at: null,
    consecutive_health_fails: 0,
    last_status_change_at: "2026-11-20T10:00:00.000Z",
    metadata: null,
    provider: "waha",
    waha_session_name: `org_${n}_comercial`,
  };
}

const requisicao = () =>
  new NextRequest("http://localhost/api/v1/cron/channel-health", {
    headers: { authorization: "Bearer segredo" },
  });

async function rodar() {
  const res = await GET(requisicao());
  return { http: res.status, corpo: (await res.json()) as { data: Record<string, unknown> } };
}

const batimentos = () => duble.estado.ops.filter((o) => o.tabela === TABELA_DO_BATIMENTO);

beforeEach(() => {
  duble.estado.linhas = [sessao(1), sessao(2), sessao(3)];
  duble.estado.ops = [];
  duble.estado.batimento = "ok";
  duble.estado.consultaFalha = false;
  duble.estado.ocioso = false;
  duble.estado.avisos = [];
});

describe("o vigia dos números bate o ponto (MIA-154)", () => {
  it("⭐ rodada com todos os números WORKING grava exatamente um batimento, e nada mais", async () => {
    const { http, corpo } = await rodar();

    expect(http).toBe(200);
    expect(corpo.data).toEqual({ sessoes: 3, verificadas: 3, ignoradas: 0, sem_mudanca: 3 });

    // A rodada estável continua sem escrever em `channel_sessions`: o único
    // registro é o batimento.
    expect(duble.estado.ops.map((o) => `${o.tabela}.${o.op}`)).toEqual([`${TABELA_DO_BATIMENTO}.upsert`]);

    const [bateu] = batimentos();
    expect(bateu?.opcoes).toEqual({ onConflict: "rota" });
    const linha = bateu?.payload as { rota: string; ultima_rodada_em: string; resumo: unknown };
    expect(linha.rota).toBe(ROTA_DO_VIGIA_DOS_CANAIS);
    expect(Number.isFinite(Date.parse(linha.ultima_rodada_em))).toBe(true);
    expect(linha.resumo).toEqual(corpo.data);
  });

  it("o resumo do batimento só tem contagens: nenhum id, nome ou telefone", async () => {
    await rodar();
    const texto = JSON.stringify(batimentos()[0]?.payload);
    for (const proibido of ["sessao-1", "org-1", "Canal 1", "+551199999001", "org_1_comercial"]) {
      expect(texto, `o batimento levou "${proibido}"`).not.toContain(proibido);
    }
  });

  it.each(["erro", "lanca"] as const)("batimento que falha (%s) não muda a resposta, e deixa o rastro", async (modo) => {
    const normal = (await rodar()).corpo;

    duble.estado.ops = [];
    duble.estado.batimento = modo;
    const { http, corpo } = await rodar();

    expect(http).toBe(200);
    expect(corpo.data).toEqual(normal.data);
    expect(batimentos()).toHaveLength(1);
    expect(duble.estado.avisos).toEqual([
      expect.objectContaining({
        msg: "[batimento] não gravou",
        ctx: expect.objectContaining({ rota: ROTA_DO_VIGIA_DOS_CANAIS }),
      }),
    ]);
  });

  it("a consulta das sessões que falha não bate o ponto: o vigia não rodou", async () => {
    duble.estado.consultaFalha = true;
    const { http } = await rodar();
    expect(http).toBe(500);
    expect(batimentos()).toEqual([]);
  });

  it("a saída ociosa não toca o banco, nem para bater o ponto (#3731)", async () => {
    duble.estado.ocioso = true;
    const { http, corpo } = await rodar();
    expect(http).toBe(200);
    expect(corpo.data).toEqual({ pulado: "recurso_ocioso" });
    expect(duble.estado.ops).toEqual([]);
  });
});

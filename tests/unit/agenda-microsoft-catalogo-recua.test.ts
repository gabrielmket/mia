/**
 * FORK MIA (.82, migration 9044) — O CATÁLOGO DO OUTLOOK QUE FALHA ESPERA.
 *
 * O upstream v1.84 passou o cron da agenda do Google para 1 minuto e deu recuo
 * de 15 minutos à leitura do catálogo que falha (`catalog_retry_at`, 0668), com
 * a prova em `agenda-google-cota-por-hora.test.ts`. O cron do Outlook
 * (`agenda-microsoft-sync`) já rodava a cada minuto e tinha o mesmo buraco: só o
 * sucesso marca o catálogo como conferido, então a conta com defeito era tentada
 * a cada tick, e cinco contas assim tomavam as cinco vagas de catálogo de toda
 * rodada.
 *
 * Aqui a rota é a de produção; o banco, a Graph (o executor do catálogo) e o
 * relógio são dublês. Mede-se quantas vezes por hora o catálogo é tentado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/cron/agenda-microsoft-sync/route";
import { atualizarCatalogoMicrosoft } from "@/lib/agenda/microsoft/calendar-executor";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: "cron" } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/agenda/google/membros", () => ({
  apenasDeMembrosAtivos: vi.fn(async (_db, rows) => rows),
}));
vi.mock("@/lib/agenda/microsoft/calendar-executor", () => ({
  atualizarCatalogoMicrosoft: vi.fn(),
  lerCalendarioMicrosoft: vi.fn(async () => "complete"),
}));
vi.mock("@/lib/agenda/microsoft/sync-executor", () => ({
  compromissoDoEventoMicrosoft: vi.fn(async () => null),
  reconciliarCompromissoMicrosoft: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const INICIO = Date.parse("2026-10-17T12:00:00.000Z");
const HORAS = 2;
const ORG = "bbbbbbbb-0000-4000-8000-000000000001";

interface Conexao {
  id: string;
  organization_id: string;
  user_id: string;
  catalogo_tentar_apos: string | null;
  ultimo_erro: string | null;
}

function conexao(n: number): Conexao {
  return {
    id: `bbbbbbbb-0000-4000-8000-00000000010${n}`,
    organization_id: ORG,
    user_id: `bbbbbbbb-0000-4000-8000-00000000020${n}`,
    catalogo_tentar_apos: null,
    ultimo_erro: null,
  };
}

/** O banco: as conexões, um catálogo de dois dias atrás em todas, nenhuma agenda vencida. */
function bancoCom(conexoes: Conexao[]) {
  const catalogoVelho = new Date(INICIO - 2 * 86_400_000).toISOString();
  return {
    from: (tabela: string) => {
      let patch: Record<string, unknown> | null = null;
      let idDaConexao: string | null = null;
      const executar = () => {
        if (tabela === "mia_agenda_microsoft_conexoes") {
          if (patch) {
            const alvo = conexoes.find((c) => c.id === idDaConexao);
            if (alvo) Object.assign(alvo, patch);
            return { data: null, error: null };
          }
          return { data: conexoes.map((c) => ({ ...c })), error: null };
        }
        if (tabela === "mia_agenda_microsoft_calendarios") {
          if (patch) return { data: null, error: null };
          // Duas perguntas na rota: o catálogo mais velho da conta (`limit(1)`)
          // e as agendas vencidas. Nenhuma vencida: só o catálogo é medido.
          return { data: [{ catalogo_conferido_em: catalogoVelho }], error: null };
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      };
      let pedeVencidas = false;
      const q = {
        select: () => q,
        eq: (coluna: string, valor: string) => {
          if (coluna === "id") idDaConexao = valor;
          return q;
        },
        order: () => q,
        lte: () => ((pedeVencidas = true), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        limit: async () => (pedeVencidas ? { data: [], error: null } : executar()),
        then: (resolve: (value: unknown) => void) => resolve(executar()),
      };
      return q;
    },
  };
}

async function rodarPorHoras(conexoes: Conexao[]): Promise<void> {
  vi.mocked(createAdminClient).mockReturnValue(bancoCom(conexoes) as never);
  for (let minuto = 0; minuto < HORAS * 60; minuto += 1) {
    vi.setSystemTime(INICIO + minuto * 60_000 + 500);
    const res = await GET(new NextRequest("http://local/cron", { headers: { authorization: "Bearer cron" } }));
    expect(res.status).toBe(200);
  }
}

function tentativasPorConexao(): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const chamada of vi.mocked(atualizarCatalogoMicrosoft).mock.calls) {
    const id = String(chamada[2]);
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }
  return contagem;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("o catálogo do Outlook que falha (9044)", () => {
  it("espera 15 minutos: no máximo 4 tentativas por hora, e o prazo fica gravado na conexão", async () => {
    vi.mocked(atualizarCatalogoMicrosoft).mockRejectedValue(new Error("graph_429"));
    const contas = [conexao(1)];
    await rodarPorHoras(contas);
    const porHora = (tentativasPorConexao().get(contas[0]!.id) ?? 0) / HORAS;
    expect(porHora, `medido: ${porHora}/h`).toBeLessThanOrEqual(4);
    expect(porHora, "o recuo não pode calar a conta de vez").toBeGreaterThan(0);
    expect(contas[0]!.catalogo_tentar_apos).not.toBeNull();
    expect(contas[0]!.ultimo_erro).toMatch(/lista de agendas/);
  });

  it("cinco contas com defeito não tomam as vagas: a sexta, saudável, é lida", async () => {
    const contas = [1, 2, 3, 4, 5, 6].map(conexao);
    const saudavel = contas[5]!.id;
    vi.mocked(atualizarCatalogoMicrosoft).mockImplementation(async (_db, _org, id) => {
      if (id !== saudavel) throw new Error("graph_503");
    });
    await rodarPorHoras(contas);
    expect(tentativasPorConexao().get(saudavel) ?? 0).toBeGreaterThan(0);
  });

  it("CONTROLE: sem o prazo gravado (o código de antes), a conta com defeito seria tentada a cada minuto", async () => {
    // Prova que o dublê mede o que diz: com o prazo apagado a cada tick, o
    // número volta a ser um por minuto.
    vi.mocked(atualizarCatalogoMicrosoft).mockRejectedValue(new Error("graph_429"));
    const contas = [conexao(1)];
    const banco = bancoCom(contas);
    vi.mocked(createAdminClient).mockReturnValue(banco as never);
    for (let minuto = 0; minuto < 60; minuto += 1) {
      contas[0]!.catalogo_tentar_apos = null;
      vi.setSystemTime(INICIO + minuto * 60_000 + 500);
      await GET(new NextRequest("http://local/cron", { headers: { authorization: "Bearer cron" } }));
    }
    expect(tentativasPorConexao().get(contas[0]!.id)).toBe(60);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA (MIA-48) — O CRON DO REPORT COM O AVISO DA QUEDA AO CLIENTE.
 *
 * O que este arquivo mede é a COSTURA: o aviso ao grupo do cliente entrou no
 * mesmo cron, e o report INTERNO tem de seguir igual (mesmo texto, mesma chave
 * `canal_caiu:<sessão>`, mesmo destino). E, quando quem caiu é o próprio número
 * de avisos, só o report interno fala.
 *
 * Dados fictícios: Academia Alfa, Academia Gama (sem grupo), +55 31 900000002.
 *
 *     npx vitest run app/api/v1/cron/report-da-plataforma/route.test.ts
 */

const h = vi.hoisted(() => ({
  cliente: null as unknown,
  enviados: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      h.enviados.push(envelope);
      return { externalId: `msg-${h.enviados.length}` };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.cliente }));
vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/backup/aviso-do-backup", () => ({ vigiarBackup: async () => ({ avisados: [], resolvidos: [] }) }));
vi.mock("@/lib/ai/custo/saldo-da-plataforma", () => ({
  saldoDaPlataformaParaOVigia: async () => ({ saldoUsd: null, diasRestantes: null, consumoParcial: false, ritmoParcial: false }),
}));
vi.mock("@/lib/planos-mia/recados", () => ({ mandarRecadosDaJornada: async () => [] }));
// O passo 3b (MIA-218, empresa sem chave de IA) roda no minuto 0 e tem o próprio
// teste (`tests/unit/report-da-plataforma-ia-sem-chave.test.ts`); aqui nenhuma
// empresa fica sem chave, para o grupo interno receber só o report da queda.
vi.mock("@/lib/ai/ia-da-empresa", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  iaDasEmpresas: async () => [],
}));

import { PROVIDER_EM_QUE_O_NUMERO_E_A_CONEXAO as QR } from "@/lib/channels/capabilities";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

import { ESPERA_ANTES_DE_AVISAR_MIN } from "@/lib/avisos/aviso-da-queda";

const { GET } = await import("./route");

const ALFA = "0a000000-0000-4000-8000-0000000000a1";
const GAMA = "0a000000-0000-4000-8000-0000000000c3";
const PLATAFORMA = "0a000000-0000-4000-8000-0000000000f0";
const GRUPO_INTERNO = "120363000000000099@g.us";
const GRUPO_ALFA = "120363000000000011@g.us";
const SESSAO_ALFA = "0e000000-0000-4000-8000-0000000000a1";
const SESSAO_GAMA = "0e000000-0000-4000-8000-0000000000c3";
const SESSAO_AVISOS = "0e000000-0000-4000-8000-0000000000f0";

// 14h em UTC = 11h em São Paulo: fora da hora do resumo do dia.
const INICIO = new Date("2026-11-17T14:00:00Z");
const MINUTO = 60 * 1000;

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

function cenario(sessoes: Linha[], opcoes: { comGrupoInterno?: boolean } = {}) {
  const b = bancoEmMemoria({
    platform_avisos:
      opcoes.comGrupoInterno === false
        ? []
        : [{ id: 1, grupo_id: GRUPO_INTERNO, grupo_nome: "Report", limite_saldo_usd: 20, resumo_diario: true }],
    organizations: [
      { id: ALFA, display_name: "Academia Alfa", status: "active", settings: { grupo_de_avisos: { id: GRUPO_ALFA, nome: "Avisos Alfa" } } },
      { id: GAMA, display_name: "Academia Gama", status: "active", settings: {} },
      { id: PLATAFORMA, display_name: "Plataforma", status: "active", settings: {} },
    ],
    channel_sessions: [
      sessao(SESSAO_AVISOS, PLATAFORMA, { display_name: "Avisos", phone_number: "+55 31 900000009", e_numero_de_avisos: true }),
      ...sessoes,
    ],
    platform_avisos_enviados: [],
  });
  h.cliente = b.cliente;
  return b;
}

async function rodarCron(minuto: number, vezes = 1): Promise<void> {
  for (let i = 0; i < vezes; i++) {
    vi.setSystemTime(new Date(INICIO.getTime() + (minuto + i) * MINUTO));
    const r = await GET(new Request("http://localhost/api/v1/cron/report-da-plataforma") as never);
    expect(r.status).toBe(200);
  }
}

const paraOGrupoInterno = () => h.enviados.filter((e) => e.to === GRUPO_INTERNO);
const paraClientes = () => h.enviados.filter((e) => e.to !== GRUPO_INTERNO);

beforeEach(() => {
  h.enviados.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("o cron do report com o aviso da queda ao cliente", () => {
  it("⭐ o número da Academia Alfa cai: o grupo interno recebe o report de sempre, e o da Alfa recebe UM aviso", async () => {
    const b = cenario([sessao(SESSAO_ALFA, ALFA, { status: "FAILED" })]);
    await rodarCron(0, ESPERA_ANTES_DE_AVISAR_MIN + 5);

    expect(paraOGrupoInterno()).toHaveLength(1);
    expect(paraOGrupoInterno()[0]!.body).toBe(
      "⚠️ *Número fora do ar*\n\n*Cliente:* Academia Alfa\n*Número:* Recepção\n*Estado:* FAILED",
    );
    expect(paraClientes()).toHaveLength(1);
    expect(paraClientes()[0]!.to).toBe(GRUPO_ALFA);
    expect(b.tabela("platform_avisos_enviados").map((m) => m.chave)).toContain(`canal_caiu:${SESSAO_ALFA}`);
  });

  it("cliente sem grupo configurado não quebra nada, e o report interno segue igual", async () => {
    cenario([sessao(SESSAO_GAMA, GAMA, { status: "FAILED" })]);
    await rodarCron(0, ESPERA_ANTES_DE_AVISAR_MIN + 5);

    expect(paraClientes()).toHaveLength(0);
    expect(paraOGrupoInterno()).toHaveLength(1);
    expect(paraOGrupoInterno()[0]!.body).toContain("*Cliente:* Academia Gama");
  });

  it("sem grupo INTERNO escolhido, o cliente ainda é avisado: um não depende do outro", async () => {
    cenario([sessao(SESSAO_ALFA, ALFA, { status: "FAILED" })], { comGrupoInterno: false });
    await rodarCron(0, ESPERA_ANTES_DE_AVISAR_MIN + 2);

    expect(paraOGrupoInterno()).toHaveLength(0);
    expect(paraClientes()).toHaveLength(1);
    expect(paraClientes()[0]!.to).toBe(GRUPO_ALFA);
  });

  it("⭐ quem caiu é o próprio número de avisos: nada sai para cliente, só o report interno", async () => {
    const b = cenario([sessao(SESSAO_ALFA, ALFA)]);
    b.tabela("channel_sessions").find((s) => s.id === SESSAO_AVISOS)!.status = "FAILED";
    await rodarCron(0, ESPERA_ANTES_DE_AVISAR_MIN + 5);

    expect(paraClientes()).toHaveLength(0);
    expect(paraOGrupoInterno()).toHaveLength(1);
    expect(paraOGrupoInterno()[0]!.body).toContain("O NÚMERO DE AVISOS caiu");
  });
});

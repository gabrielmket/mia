import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA · coexistência (S3): A CONEXÃO PELO APP, DE PONTA A PONTA NO SERVIDOR,
 * COM A META SIMULADA.
 *
 * O que a tela faz depois que a janela da Meta devolve o código
 * (`conectarPeloApp`), rodando contra o banco, com a Graph simulada por um
 * `fetch` que responde e CONTA cada chamada:
 *
 *   - o número fica NA EMPRESA QUE ABRIU A JANELA, já `WORKING`, com a origem
 *     `embedded_signup` do upstream (9328) e o cadastro incorporado amarrado:
 *     nada fica para o operador em /admin/meta;
 *   - o ciclo da coexistência abre e o pedido da sincronização vai ao worker
 *     (um evento);
 *   - o canal por QR do MESMO número, na mesma empresa, é arquivado (D5);
 *   - a mesma volta de novo: uma sessão, um ciclo, um pedido;
 *   - o número já conectado em outra empresa é recusado, sem gravar nada.
 *
 * O e2e de tela fica para quando o `e2e.yml` puder apontar a Graph para um
 * dublê: hoje ele fixa `META_GRAPH_BASE_URL` numa porta que recusa, e outras
 * specs dependem disso.
 *
 * Dado fictício: Academia Alfa e Academia Beta, número +55 31 900000002.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async () => "token-ficticio-da-empresa",
  encryptWebhookSecret: async () => "\\x0102",
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 4,
});
estado.cliente = await pgComoSupabaseMia(pool);
const db = estado.cliente as Parameters<typeof import("@/lib/channels/meta/coexistencia/conectar").conectarPeloApp>[0];

const { conectarPeloApp } = await import("@/lib/channels/meta/coexistencia/conectar");
const { EVENTO_DA_SINCRONIZACAO } = await import("@/lib/channels/meta/coexistencia/sincronizacao");

const ALFA = "c0e59164-0000-4000-8000-0000000000c1";
const BETA = "c0e59164-0000-4000-8000-0000000000c2";
const ANA = "c0e59164-1111-4000-8000-0000000000c1";
const QR_DO_MESMO_NUMERO = "c0e59164-4444-4000-8000-0000000000c1";
const WABA = "987650009164";
const NUMERO = "123450009164";
const WABA_DA_BETA = "987650009165";
const NUMERO_DA_BETA = "123450009165";
const TELEFONE = "+55 31 90000-0002";

/** A Graph simulada. Responde pelo caminho e guarda "MÉTODO caminho" de cada chamada. */
const chamadas: string[] = [];
const graph = (async (alvo: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(alvo));
  const metodo = (init?.method ?? "GET").toUpperCase();
  const caminho = url.pathname.replace(/^\/v\d+\.\d+/, "");
  chamadas.push(`${metodo} ${caminho}`);
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (caminho === "/oauth/access_token") return json({ access_token: "EAAficticio9164", token_type: "bearer" });
  if (caminho.endsWith("/phone_numbers")) {
    const numero = caminho.startsWith(`/${WABA_DA_BETA}`) ? NUMERO_DA_BETA : NUMERO;
    return json({
      data: [{ id: numero, display_phone_number: TELEFONE, verified_name: "Academia Alfa", platform_type: "CLOUD_API" }],
    });
  }
  if (caminho.endsWith("/subscribed_apps")) return json({ success: true });
  if (metodo === "POST") return json({ success: true });
  return json({ display_phone_number: TELEFONE, verified_name: "Academia Alfa", quality_rating: "GREEN" });
}) as typeof fetch;

const ENTRADA = {
  organizationId: ALFA,
  userId: ANA,
  code: "codigo-ficticio-9164",
  wabaId: WABA,
  baseDoWebhook: "http://127.0.0.1:3000",
  requestId: "inv-9164-conexao",
};

const ambienteAntes = { ...process.env };

beforeAll(async () => {
  vi.stubGlobal("fetch", graph);
  process.env.META_APP_ID = "app-ficticio-9164";
  process.env.META_APP_SECRET = "segredo-ficticio-9164";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-ficticio-9164";
  process.env.META_GRAPH_BASE_URL = "http://127.0.0.1:9";
  for (const [id, slug, nome] of [
    [ALFA, "academia-alfa-9164c", "Academia Alfa"],
    [BETA, "academia-beta-9164c", "Academia Beta"],
  ] as const) {
    await pool.query(
      `insert into public.organizations (id, slug, legal_name, display_name) values ($1, $2, $3, $3) on conflict (id) do nothing`,
      [id, slug, nome],
    );
    await pool.query(
      `insert into public.mia_coexistencia_da_empresa (organization_id, ligada) values ($1, true) on conflict (organization_id) do nothing`,
      [id],
    );
  }
  // O canal por QR que a Alfa já usava NESTE número (o QR grava sem o +).
  await pool.query(
    `insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, phone_number, status)
       values ($1, $2, 'qr-academia-alfa-9164', '\\x00'::bytea, '5531900000002', 'WORKING') on conflict (id) do nothing`,
    [QR_DO_MESMO_NUMERO, ALFA],
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  process.env = ambienteAntes;
  await pool.end();
});

async function sessoesOficiais(org: string) {
  const { rows } = await pool.query(
    `select id, status, phone_number, meta_phone_number_id, meta_waba_id, meta_connection_origin, archived_at
       from public.channel_sessions where organization_id = $1 and provider = 'meta_cloud'`,
    [org],
  );
  return rows;
}

describe("a conexão pelo app, com a Meta simulada", () => {
  it("o número fica na empresa que abriu a janela, com a origem do upstream, e o pedido vai ao worker", async () => {
    const r = await conectarPeloApp(db, ENTRADA, { fetch: graph });
    expect(r).toMatchObject({ ok: true, cicloNovo: true, phoneNumber: "+5531900000002", pedidoEmitido: true, qrDesligados: 1 });

    const sessoes = await sessoesOficiais(ALFA);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]).toMatchObject({
      status: "WORKING",
      phone_number: "+5531900000002",
      meta_phone_number_id: NUMERO,
      meta_waba_id: WABA,
      meta_connection_origin: "embedded_signup",
      archived_at: null,
    });

    // O cadastro incorporado já amarrado: nada na fila de /admin/meta.
    const { rows: cadastro } = await pool.query(
      `select organization_id, channel_session_id, bound_by from public.meta_onboardings where waba_id = $1`,
      [WABA],
    );
    expect(cadastro).toEqual([{ organization_id: ALFA, channel_session_id: sessoes[0].id, bound_by: ANA }]);

    const { rows: ciclos } = await pool.query(
      `select estado, aberta_por, phone_number_id from public.mia_coexistencia_conexoes where channel_session_id = $1`,
      [sessoes[0].id],
    );
    expect(ciclos).toEqual([{ estado: "no_ar", aberta_por: "conexao_pelo_app", phone_number_id: NUMERO }]);

    const { rows: eventos } = await pool.query(
      `select count(*)::int as n from public.event_log where organization_id = $1 and event_type = $2`,
      [ALFA, EVENTO_DA_SINCRONIZACAO],
    );
    expect(eventos[0].n).toBe(1);

    // D5: o canal por QR do mesmo número saiu do ar, arquivado (o histórico fica).
    const { rows: qr } = await pool.query(`select status, archived_at from public.channel_sessions where id = $1`, [
      QR_DO_MESMO_NUMERO,
    ]);
    expect(qr[0].status).toBe("STOPPED");
    expect(qr[0].archived_at).not.toBeNull();

    // A conversa com a Meta: código → token, número da conta, validação e webhook. Nada de /register.
    expect(chamadas).toContain("GET /oauth/access_token");
    expect(chamadas).toContain(`GET /${WABA}/phone_numbers`);
    expect(chamadas).toContain(`POST /${WABA}/subscribed_apps`);
    expect(chamadas.some((c) => c.endsWith("/register"))).toBe(false);
    expect(chamadas.some((c) => c.includes("smb_app_data"))).toBe(false);
  });

  it("a mesma volta de novo: uma sessão, um ciclo e um pedido", async () => {
    const r = await conectarPeloApp(db, ENTRADA, { fetch: graph });
    expect(r).toMatchObject({ ok: true, cicloNovo: false, pedidoEmitido: false });
    const sessoes = await sessoesOficiais(ALFA);
    expect(sessoes).toHaveLength(1);
    const { rows: ciclos } = await pool.query(
      `select count(*)::int as n from public.mia_coexistencia_conexoes where channel_session_id = $1`,
      [sessoes[0].id],
    );
    expect(ciclos[0].n).toBe(1);
    const { rows: eventos } = await pool.query(
      `select count(*)::int as n from public.event_log where organization_id = $1 and event_type = $2`,
      [ALFA, EVENTO_DA_SINCRONIZACAO],
    );
    expect(eventos[0].n).toBe(1);
  });

  it("o número de outra empresa é recusado, sem gravar nada na que tentou", async () => {
    const r = await conectarPeloApp(db, { ...ENTRADA, organizationId: BETA, phoneNumberId: NUMERO }, { fetch: graph });
    expect(r).toEqual({ ok: false, motivo: "numero_de_outra_empresa" });
    expect(await sessoesOficiais(BETA)).toEqual([]);
  });

  it("controle: a Beta conecta o número DELA normalmente", async () => {
    const r = await conectarPeloApp(db, { ...ENTRADA, organizationId: BETA, wabaId: WABA_DA_BETA }, { fetch: graph });
    expect(r).toMatchObject({ ok: true, cicloNovo: true });
    expect(await sessoesOficiais(BETA)).toHaveLength(1);
  });
});

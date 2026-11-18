import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abrirCiclo } from "@/lib/channels/meta/coexistencia/conectar";
import { pedirSincronizacao } from "@/lib/channels/meta/coexistencia/sincronizacao";
import { varrerCoexistencia } from "@/lib/channels/meta/coexistencia/varredura";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA · coexistência (S3): O PEDIDO DA SINCRONIZAÇÃO SAI UMA VEZ SÓ.
 *
 * A Meta aceita o pedido dos contatos e do histórico (`smb_app_data`) UMA vez
 * por conexão, até 24 h depois dela. Um segundo pedido é recusado e queima a
 * chance. Aqui o CÓDIGO roda contra o banco (`pgComoSupabaseMia`) e a Meta é
 * simulada por um `fetch` que CONTA as chamadas:
 *
 *   - três chegadas ao mesmo tempo (o worker, o worker repetido, a varredura)
 *     dão UMA chamada de cada tipo: a trava é `unique (conexao_id, tipo)`;
 *   - reexecução e varredura depois do pedido: zero chamadas;
 *   - erro da Meta: `falhou` com o código dela, um aviso na Central, e zero
 *     chamadas depois (sem segunda tentativa cega);
 *   - contatos recusados: o histórico é pedido mesmo assim (D1);
 *   - rede caída: `sem_resposta`, e zero chamadas depois;
 *   - `pedindo` parado (o processo morreu): a varredura muda para
 *     `sem_resposta` SEM chamar a Meta;
 *   - passou das 24 h: `prazo_vencido`, sem chamar;
 *   - ciclo fora do ar: nada é pedido;
 *   - a janela concluída duas vezes ao mesmo tempo abre UM ciclo.
 *
 * Dado fictício: Academia Alfa, número +55 31 900000002.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 5,
});
const db = await pgComoSupabaseMia(pool);

const ORG = "c0e59164-0000-4000-8000-00000000000a";
const NUMERO = "pn-academia-alfa-9164";
const WABA = "waba-academia-alfa-9164";
const HORA = 60 * 60 * 1000;

/** Uma sessão por cenário: o ciclo vivo é único por sessão. */
const SESSOES = {
  simultaneas: "c0e59164-4444-4000-8000-000000000001",
  erro: "c0e59164-4444-4000-8000-000000000002",
  contatosRecusados: "c0e59164-4444-4000-8000-000000000003",
  semResposta: "c0e59164-4444-4000-8000-000000000004",
  parado: "c0e59164-4444-4000-8000-000000000005",
  prazo: "c0e59164-4444-4000-8000-000000000006",
  foraDoAr: "c0e59164-4444-4000-8000-000000000007",
  janela: "c0e59164-4444-4000-8000-000000000008",
} as const;

type Resposta = { status: number; corpo: unknown } | "rede_caiu";

/** A Meta simulada: conta cada `sync_type` pedido e responde o que o cenário mandar. */
function metaSimulada(responder: (syncType: string) => Resposta, atrasoMs = 30) {
  const chamadas: string[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as { sync_type?: string };
    const syncType = String(corpo.sync_type);
    chamadas.push(syncType);
    await new Promise((r) => setTimeout(r, atrasoMs));
    const r = responder(syncType);
    if (r === "rede_caiu") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, chamadas };
}

const ACEITA = (syncType: string): Resposta => ({
  status: 200,
  corpo: { messaging_product: "whatsapp", request_id: `req-${syncType}-9164` },
});

async function novoCiclo(sessao: string, opcoes: { conectadaEm?: Date; estado?: string } = {}): Promise<string> {
  const { rows } = await pool.query(
    `insert into public.mia_coexistencia_conexoes
       (organization_id, channel_session_id, waba_id, phone_number_id, aberta_por, conectada_em, estado)
     values ($1, $2, $3, $4, 'conexao_pelo_app', $5, $6) returning id`,
    [ORG, sessao, WABA, NUMERO, (opcoes.conectadaEm ?? new Date()).toISOString(), opcoes.estado ?? "no_ar"],
  );
  return rows[0].id as string;
}

async function pedidos(conexaoId: string) {
  const { rows } = await pool.query(
    `select tipo, estado, request_id, erro_codigo from public.mia_coexistencia_sincronizacoes
      where conexao_id = $1 order by tipo`,
    [conexaoId],
  );
  return rows as Array<{ tipo: string; estado: string; request_id: string | null; erro_codigo: string | null }>;
}

async function avisosAbertos(sessao: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from public.agent_inbox_items
      where organization_id = $1 and kind = 'other' and ref_kind = 'channel_session' and ref_id = $2 and status = 'open'`,
    [ORG, sessao],
  );
  return rows[0].n as number;
}

const tokenAntes = process.env.META_SYSTEM_USER_TOKEN;
const numeroAntes = process.env.META_PHONE_NUMBER_ID;

beforeAll(async () => {
  // A credencial da instalação (o degrau do `.env`), só para este número fictício.
  process.env.META_SYSTEM_USER_TOKEN = "token-ficticio-9164";
  process.env.META_PHONE_NUMBER_ID = NUMERO;
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
       values ($1, 'academia-alfa-9164', 'Academia Alfa 9164', 'Academia Alfa') on conflict (id) do nothing`,
    [ORG],
  );
  for (const [nome, id] of Object.entries(SESSOES)) {
    await pool.query(
      `insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, meta_phone_number_id, meta_waba_id)
         values ($1, $2, $3, '\\x00'::bytea, $4, $5) on conflict (id) do nothing`,
      [id, ORG, `coexistencia-9164-${nome}`, `${NUMERO}-${nome}`, WABA],
    );
  }
});

afterAll(async () => {
  process.env.META_SYSTEM_USER_TOKEN = tokenAntes;
  process.env.META_PHONE_NUMBER_ID = numeroAntes;
  await pool.end();
});

describe("o pedido único da sincronização", () => {
  it("três chegadas ao mesmo tempo: UMA chamada de cada tipo à Meta", async () => {
    const ciclo = await novoCiclo(SESSOES.simultaneas);
    const meta = metaSimulada(ACEITA);
    const entrada = { organizationId: ORG, conexaoId: ciclo };
    await Promise.all([
      pedirSincronizacao(db, entrada, { fetch: meta.f }),
      pedirSincronizacao(db, entrada, { fetch: meta.f }),
      pedirSincronizacao(db, entrada, { fetch: meta.f }),
    ]);
    expect([...meta.chamadas].sort()).toEqual(["history", "smb_app_state_sync"]);
    expect(await pedidos(ciclo)).toEqual([
      { tipo: "contatos", estado: "pedida", request_id: "req-smb_app_state_sync-9164", erro_codigo: null },
      { tipo: "historico", estado: "pedida", request_id: "req-history-9164", erro_codigo: null },
    ]);

    // Reexecução (o event_log refazendo) e a varredura: nenhuma chamada nova.
    const depois = metaSimulada(ACEITA);
    const r = await pedirSincronizacao(db, entrada, { fetch: depois.f });
    expect(r).toEqual({ contatos: "ja_pedido", historico: "ja_pedido" });
    await varrerCoexistencia(db, { fetch: depois.f });
    expect(depois.chamadas).toEqual([]);
  });

  it("erro da Meta: falhou com o código, um aviso, e nenhuma segunda tentativa", async () => {
    const ciclo = await novoCiclo(SESSOES.erro);
    const meta = metaSimulada((tipo) =>
      tipo === "history"
        ? { status: 400, corpo: { error: { code: 131000, message: "Something went wrong", error_user_title: "Erro de teste" } } }
        : ACEITA(tipo),
    );
    const r = await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: meta.f });
    expect(r).toEqual({ contatos: "pedida", historico: "falhou" });
    expect((await pedidos(ciclo)).find((p) => p.tipo === "historico")).toMatchObject({
      estado: "falhou",
      erro_codigo: "131000",
    });
    expect(await avisosAbertos(SESSOES.erro)).toBe(1);

    const depois = metaSimulada(ACEITA);
    await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: depois.f });
    await varrerCoexistencia(db, { fetch: depois.f });
    expect(depois.chamadas).toEqual([]);
    expect(await avisosAbertos(SESSOES.erro)).toBe(1);
  });

  it("contatos recusados: o histórico é pedido mesmo assim (D1)", async () => {
    const ciclo = await novoCiclo(SESSOES.contatosRecusados);
    const meta = metaSimulada((tipo) =>
      tipo === "smb_app_state_sync" ? { status: 400, corpo: { error: { code: 100, message: "Invalid parameter" } } } : ACEITA(tipo),
    );
    const r = await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: meta.f });
    expect(r).toEqual({ contatos: "falhou", historico: "pedida" });
    expect(meta.chamadas).toEqual(["smb_app_state_sync", "history"]);
  });

  it("rede caída: sem_resposta, e a MIA não pede de novo", async () => {
    const ciclo = await novoCiclo(SESSOES.semResposta);
    const meta = metaSimulada(() => "rede_caiu");
    const r = await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: meta.f });
    expect(r).toEqual({ contatos: "sem_resposta", historico: "sem_resposta" });
    expect((await pedidos(ciclo)).map((p) => p.estado)).toEqual(["sem_resposta", "sem_resposta"]);
    expect(await avisosAbertos(SESSOES.semResposta)).toBeGreaterThanOrEqual(1);

    const depois = metaSimulada(ACEITA);
    await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: depois.f });
    await varrerCoexistencia(db, { fetch: depois.f });
    expect(depois.chamadas).toEqual([]);
  });

  it("pedindo parado (o processo morreu): a varredura muda para sem_resposta sem chamar a Meta", async () => {
    const ciclo = await novoCiclo(SESSOES.parado);
    const antes = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    for (const tipo of ["contatos", "historico"]) {
      await pool.query(
        `insert into public.mia_coexistencia_sincronizacoes (organization_id, conexao_id, tipo, estado, pedida_em)
           values ($1, $2, $3, 'pedindo', $4)`,
        [ORG, ciclo, tipo, antes],
      );
    }
    const meta = metaSimulada(ACEITA);
    const r = await varrerCoexistencia(db, { fetch: meta.f });
    expect(r.semResposta).toBeGreaterThanOrEqual(2);
    expect((await pedidos(ciclo)).map((p) => p.estado)).toEqual(["sem_resposta", "sem_resposta"]);
    expect(meta.chamadas).toEqual([]);
  });

  it("passou das 24 h: prazo_vencido, sem chamar a Meta", async () => {
    const ciclo = await novoCiclo(SESSOES.prazo, { conectadaEm: new Date(Date.now() - 25 * HORA) });
    const meta = metaSimulada(ACEITA);
    const r = await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: meta.f });
    expect(r).toEqual({ contatos: "prazo_vencido", historico: "prazo_vencido" });
    expect(meta.chamadas).toEqual([]);
    expect(await avisosAbertos(SESSOES.prazo)).toBe(2);
  });

  it("ciclo fora do ar: nada é pedido", async () => {
    const ciclo = await novoCiclo(SESSOES.foraDoAr, { estado: "fora_do_ar" });
    const meta = metaSimulada(ACEITA);
    const r = await pedirSincronizacao(db, { organizationId: ORG, conexaoId: ciclo }, { fetch: meta.f });
    expect(r).toEqual({ contatos: "ciclo_fora_do_ar", historico: "ciclo_fora_do_ar" });
    expect(meta.chamadas).toEqual([]);
    expect(await pedidos(ciclo)).toEqual([]);
  });
});

describe("o ciclo da janela da Meta", () => {
  const entrada = {
    organizationId: ORG,
    userId: "c0e59164-1111-4000-8000-00000000000a",
    code: "codigo-ficticio",
    wabaId: WABA,
    baseDoWebhook: "http://127.0.0.1",
    requestId: "inv-9164",
  };

  it("a mesma volta duas vezes ao mesmo tempo abre UM ciclo", async () => {
    const agora = new Date();
    const dados = { channelSessionId: SESSOES.janela, phoneNumberId: NUMERO, agora };
    const [a, b] = await Promise.all([abrirCiclo(db, entrada, dados), abrirCiclo(db, entrada, dados)]);
    expect(a.conexaoId).toBe(b.conexaoId);
    expect([a.cicloNovo, b.cicloNovo].filter(Boolean)).toHaveLength(1);
    const { rows } = await pool.query(
      `select count(*)::int as n from public.mia_coexistencia_conexoes where channel_session_id = $1 and estado <> 'encerrada'`,
      [SESSOES.janela],
    );
    expect(rows[0].n).toBe(1);
  });

  it("passar pela janela de novo depois abre ciclo NOVO e encerra o velho", async () => {
    const depois = new Date(Date.now() + 11 * 60 * 1000);
    const novo = await abrirCiclo(db, entrada, { channelSessionId: SESSOES.janela, phoneNumberId: NUMERO, agora: depois });
    expect(novo.cicloNovo).toBe(true);
    const { rows } = await pool.query(
      `select estado, count(*)::int as n from public.mia_coexistencia_conexoes where channel_session_id = $1 group by estado order by estado`,
      [SESSOES.janela],
    );
    expect(rows).toEqual([
      { estado: "encerrada", n: 1 },
      { estado: "no_ar", n: 1 },
    ]);
  });
});

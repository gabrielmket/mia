import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA · coexistência (S4): O NÚMERO SAI DO AR E VOLTA SEM DUPLICAR
 * CONTATO, CONVERSA NEM CARTÃO; A EDIÇÃO E O APAGAR CHEGAM NA MENSAGEM.
 *
 * Contra o banco (as constraints da 9162 valem de verdade), com o código que a
 * rota do webhook chama:
 *
 *   - `PARTNER_REMOVED`: o ciclo vai a `fora_do_ar` com o motivo, a sessão sai
 *     de `WORKING` e abre UM aviso na Central; o mesmo evento de novo, ainda um;
 *   - `ACCOUNT_RECONNECTED` mais velho que a saída: nada muda;
 *   - `ACCOUNT_RECONNECTED` novo: o MESMO ciclo e a MESMA sessão voltam, o aviso
 *     de fora do ar é resolvido, e contatos, conversas, cartões, sessões e
 *     ciclos têm a mesma contagem de antes;
 *   - `ACCOUNT_OFFBOARDED` e depois o "Conectar de novo" pela janela da Meta
 *     (`conectarPeloApp`, Graph simulada): a MESMA sessão, ciclo novo (o velho
 *     `encerrada`), o aviso resolvido e, de novo, nada duplicado;
 *   - a edição e o apagar do cliente e do dono pelo app: o corpo muda, a
 *     apagada continua na tabela com o corpo, a reentrega não muda nada.
 *
 * Dado fictício: Academia Alfa, número +55 31 900000002, cliente Ana Exemplo.
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
const db = estado.cliente as never;

const { receberSaidaEVolta } = await import("@/lib/channels/meta/coexistencia/saida-e-volta");
const { aplicarEdicaoDaMeta } = await import("@/lib/channels/meta/coexistencia/edicao");
const { conectarPeloApp } = await import("@/lib/channels/meta/coexistencia/conectar");
const { parseMetaWebhook } = await import("@/lib/channels/meta/webhook");

const ALFA = "c0e59290-0000-4000-8000-0000000000a1";
const SESSAO = "c0e59290-4444-4000-8000-0000000000a1";
const CICLO = "c0e59290-9999-4000-8000-0000000000a1";
const ANA = "c0e59290-3333-4000-8000-0000000000a1";
const CONVERSA = "c0e59290-5555-4000-8000-0000000000a1";
const FUNIL = "c0e59290-6666-4000-8000-0000000000a1";
const ETAPA = "c0e59290-7777-4000-8000-0000000000a1";
const NEGOCIO = "c0e59290-8888-4000-8000-0000000000a1";
const QUEM_CONECTA = "c0e59290-1111-4000-8000-0000000000a1";
const WABA = "987650009290";
const NUMERO = "123450009290";
const TELEFONE = "+5531900000002";
const ANA_TEL = "5531900000002";
const RECEBIDA = "wamid.coex9290.ana.1";
const DO_APP = "wamid.coex9290.app.1";
const T0 = Math.floor(Date.now() / 1000) - 3 * 86_400;

const SESSAO_DO_TOKEN = { id: SESSAO, organizationId: ALFA, wabaId: WABA };
const opcoes = { requestId: "inv-9290", sessionDoToken: SESSAO_DO_TOKEN, porWaba: async () => null };

function conta(value: Record<string, unknown>, time: number) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: WABA, time, changes: [{ field: "account_update", value }] }],
  } as never;
}
const saiu = (time: number) =>
  conta(
    {
      event: "PARTNER_REMOVED",
      waba_info: { waba_id: WABA, owner_business_id: "2329417887457253" },
      disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
    },
    time,
  );
const voltou = (time: number) => conta({ event: "ACCOUNT_RECONNECTED" }, time);
const desligou = (time: number) => conta({ event: "ACCOUNT_OFFBOARDED" }, time);

/** A Graph simulada da conexão de novo pela janela. */
const graph = (async (alvo: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(alvo));
  const metodo = (init?.method ?? "GET").toUpperCase();
  const caminho = url.pathname.replace(/^\/v\d+\.\d+/, "");
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (caminho === "/oauth/access_token") return json({ access_token: "EAAficticio9290", token_type: "bearer" });
  if (caminho.endsWith("/phone_numbers")) {
    return json({ data: [{ id: NUMERO, display_phone_number: TELEFONE, verified_name: "Academia Alfa", platform_type: "CLOUD_API" }] });
  }
  if (caminho.endsWith("/subscribed_apps")) return json({ success: true });
  if (metodo === "POST") return json({ success: true });
  return json({ display_phone_number: TELEFONE, verified_name: "Academia Alfa", quality_rating: "GREEN" });
}) as typeof fetch;

async function linha<T = Record<string, unknown>>(texto: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(texto, valores);
  return rows[0] as T;
}

/** O que NÃO pode crescer na volta. */
async function contagens() {
  return linha<Record<string, number>>(
    `select
       (select count(*)::int from public.contacts where organization_id = $1) as contatos,
       (select count(*)::int from public.conversations where organization_id = $1) as conversas,
       (select count(*)::int from public.crm_leads where organization_id = $1) as cartoes,
       (select count(*)::int from public.channel_sessions where organization_id = $1) as sessoes,
       (select count(*)::int from public.messages where organization_id = $1) as mensagens`,
    [ALFA],
  );
}

const ciclo = (id = CICLO) =>
  linha<{ estado: string; fora_do_ar_motivo: string | null; fora_do_ar_iniciado_por: string | null; voltou_em: string | null }>(
    "select estado, fora_do_ar_motivo, fora_do_ar_iniciado_por, voltou_em::text from public.mia_coexistencia_conexoes where id = $1",
    [id],
  );
const sessao = () =>
  linha<{ status: string; status_reason: string | null }>("select status, status_reason from public.channel_sessions where id = $1", [SESSAO]);
const avisos = async (status: string) =>
  (
    await pool.query(
      "select title from public.agent_inbox_items where organization_id = $1 and ref_id = $2 and status = $3 order by created_at",
      [ALFA, SESSAO, status],
    )
  ).rows.map((r) => r.title as string);

const ambienteAntes = { ...process.env };
let antes: Record<string, number> = {};

beforeAll(async () => {
  vi.stubGlobal("fetch", graph);
  process.env.META_APP_ID = "app-ficticio-9290";
  process.env.META_APP_SECRET = "segredo-ficticio-9290";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-ficticio-9290";
  process.env.META_GRAPH_BASE_URL = "http://127.0.0.1:9";

  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
       values ($1, 'academia-alfa-9290', 'Academia Alfa 9290', 'Academia Alfa') on conflict (id) do nothing`,
    [ALFA],
  );
  await pool.query(
    `insert into public.mia_coexistencia_da_empresa (organization_id, ligada) values ($1, true) on conflict (organization_id) do nothing`,
    [ALFA],
  );
  await pool.query(
    `insert into public.channel_sessions
       (id, organization_id, provider, meta_phone_number_id, meta_waba_id, phone_number, status, webhook_secret_encrypted)
     values ($1, $2, 'meta_cloud', $3, $4, $5, 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSAO, ALFA, NUMERO, WABA, TELEFONE],
  );
  await pool.query(
    `insert into public.contacts (id, organization_id, display_name, phone_number)
       values ($1, $2, 'Ana Exemplo', '+5531900000002') on conflict (id) do nothing`,
    [ANA, ALFA],
  );
  await pool.query(
    `insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, last_message_at)
       values ($1, $2, $3, $4, 'open', to_timestamp($5)) on conflict (id) do nothing`,
    [CONVERSA, ALFA, ANA, SESSAO, T0 + 10],
  );
  await pool.query(
    `insert into public.messages
       (organization_id, conversation_id, channel_session_id, contact_id, external_id, type, direction, status, sent_via, body, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'crm', 'Quero o plano mensal', to_timestamp($7)),
            ($1, $2, $3, $4, $6, 'text', 'outbound', 'sent', 'external_device', 'Temos às 9h', to_timestamp($7 + 10))`,
    [ALFA, CONVERSA, SESSAO, ANA, RECEBIDA, DO_APP, T0],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug) values ($1, $2, 'Matrículas', 'matriculas-9290') on conflict (id) do nothing`,
    [FUNIL, ALFA],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
       values ($1, $2, $3, 'Avaliação', 'avaliacao-9290', 1000) on conflict (id) do nothing`,
    [ETAPA, ALFA, FUNIL],
  );
  await pool.query(
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
       values ($1, $2, $3, $4, 'Ana Exemplo · plano anual', $5) on conflict (id) do nothing`,
    [NEGOCIO, ALFA, FUNIL, ETAPA, ANA],
  );
  // O ciclo que a conexão pelo app abriu (S3), há uma hora.
  await pool.query(
    `insert into public.mia_coexistencia_conexoes (id, organization_id, channel_session_id, waba_id, phone_number_id, conectada_em)
       values ($1, $2, $3, $4, $5, now() - interval '1 hour') on conflict (id) do nothing`,
    [CICLO, ALFA, SESSAO, WABA, NUMERO],
  );
  antes = await contagens();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  process.env = ambienteAntes;
  await pool.end();
});

describe("o número sai do ar e volta pelo aviso da Meta", () => {
  it("PARTNER_REMOVED: fora do ar com o motivo, sessão parada, UM aviso; o mesmo evento de novo, ainda um", async () => {
    expect(await receberSaidaEVolta(db, saiu(T0 + 100), opcoes)).toEqual(["conta:fora_do_ar"]);
    expect(await ciclo()).toMatchObject({ estado: "fora_do_ar", fora_do_ar_motivo: "PRIMARY_INACTIVITY", fora_do_ar_iniciado_por: "SYSTEM" });
    expect(await sessao()).toEqual({ status: "STOPPED", status_reason: "coexistencia_fora_do_ar" });
    expect(await avisos("open")).toEqual([`${TELEFONE} fora do ar`]);

    expect(await receberSaidaEVolta(db, saiu(T0 + 160), opcoes)).toEqual(["conta:fora_do_ar_repetido"]);
    expect(await avisos("open")).toHaveLength(1);
  });

  it("a volta MAIS VELHA que a saída não muda nada", async () => {
    expect(await receberSaidaEVolta(db, voltou(T0 + 50), opcoes)).toEqual(["conta:evento_velho"]);
    expect((await ciclo()).estado).toBe("fora_do_ar");
  });

  it("ACCOUNT_RECONNECTED: o mesmo ciclo e a mesma sessão, o aviso resolvido, e nada duplicado", async () => {
    expect(await receberSaidaEVolta(db, voltou(T0 + 3600), opcoes)).toEqual(["conta:voltou"]);
    expect(await ciclo()).toMatchObject({ estado: "no_ar" });
    expect((await ciclo()).voltou_em).not.toBeNull();
    expect(await sessao()).toEqual({ status: "WORKING", status_reason: null });
    expect(await avisos("resolved")).toEqual([`${TELEFONE} fora do ar`]);
    expect(await avisos("open")).toEqual([`${TELEFONE} voltou`]);
    expect(await contagens()).toEqual(antes);
    const ciclos = await linha<{ n: number }>("select count(*)::int as n from public.mia_coexistencia_conexoes where organization_id = $1", [ALFA]);
    expect(ciclos.n).toBe(1);
    // A conversa continua presa à mesma sessão.
    expect((await linha<{ s: string }>("select channel_session_id::text as s from public.conversations where id = $1", [CONVERSA])).s).toBe(SESSAO);
  });
});

describe("o número sai do ar e volta pela janela da Meta (Conectar de novo)", () => {
  it("ACCOUNT_OFFBOARDED e a conexão de novo: a mesma sessão, ciclo novo, aviso resolvido, nada duplicado", async () => {
    expect(await receberSaidaEVolta(db, desligou(T0 + 7200), opcoes)).toEqual(["conta:fora_do_ar"]);
    expect(await ciclo()).toMatchObject({ estado: "fora_do_ar", fora_do_ar_motivo: "ACCOUNT_OFFBOARDED" });
    expect(await avisos("open")).toEqual([`${TELEFONE} fora do ar`]);

    const r = await conectarPeloApp(db, {
      organizationId: ALFA,
      userId: QUEM_CONECTA,
      code: "codigo-ficticio-9290",
      wabaId: WABA,
      baseDoWebhook: "http://127.0.0.1:3000",
      requestId: "inv-9290-de-novo",
    } as never);
    expect(r).toMatchObject({ ok: true });

    expect(await sessao()).toEqual({ status: "WORKING", status_reason: null });
    expect((await ciclo()).estado).toBe("encerrada");
    const vivos = await pool.query(
      "select id from public.mia_coexistencia_conexoes where organization_id = $1 and estado <> 'encerrada'",
      [ALFA],
    );
    expect(vivos.rows).toHaveLength(1);
    expect(vivos.rows[0].id).not.toBe(CICLO);
    expect(await avisos("open")).not.toContain(`${TELEFONE} fora do ar`);
    expect(await contagens()).toEqual(antes);
  });
});

describe("a edição e o apagar chegam na mensagem que já existe", () => {
  const mensagem = (externalId: string) =>
    linha<{ body: string; edited_at: string | null; revoked_at: string | null }>(
      "select body, edited_at::text, revoked_at::text from public.messages where organization_id = $1 and external_id = $2",
      [ALFA, externalId],
    );
  async function aplicar(campo: "messages" | "smb_message_echoes", raw: Record<string, unknown>) {
    const value =
      campo === "messages"
        ? { metadata: { phone_number_id: NUMERO }, contacts: [{ wa_id: ANA_TEL, profile: { name: "Ana Exemplo" } }], messages: [raw] }
        : { metadata: { phone_number_id: NUMERO }, message_echoes: [raw] };
    const [e] = parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: campo, value }] }] } as never);
    if (!e || e.kind !== "message_edit") throw new Error(`esperava message_edit, veio ${e?.kind}`);
    return aplicarEdicaoDaMeta(db, e, { organizationId: ALFA, requestId: "inv-9290-edicao" });
  }
  const editar = (id: string, quando: number, corpo: string) => ({
    from: ANA_TEL,
    id,
    timestamp: String(quando),
    type: "edit",
    edit: { original_message_id: RECEBIDA, message: { type: "text", text: { body: corpo } } },
  });

  it("a edição do cliente troca o corpo; a reentrega e a edição velha não mudam nada", async () => {
    expect(await aplicar("messages", editar("wamid.coex9290.edit.2", T0 + 200, "Quero o plano anual"))).toBe("editada");
    expect((await mensagem(RECEBIDA)).body).toBe("Quero o plano anual");
    expect(await aplicar("messages", editar("wamid.coex9290.edit.2", T0 + 200, "Quero o plano anual"))).toBe("sem_mudanca");
    expect(await aplicar("messages", editar("wamid.coex9290.edit.1", T0 + 100, "Versão velha"))).toBe("sem_mudanca");
    expect((await mensagem(RECEBIDA)).body).toBe("Quero o plano anual");
  });

  it("o dono edita e apaga pelo app: a linha fica, com o corpo, carimbada", async () => {
    const eco = (tipo: "edit" | "revoke", quando: number) => ({
      from: "5531900000001",
      to: ANA_TEL,
      id: `wamid.coex9290.eco.${tipo}`,
      timestamp: String(quando),
      type: tipo,
      [tipo]: tipo === "edit"
        ? { original_message_id: DO_APP, message: { type: "text", text: { body: "Temos às 10h" } } }
        : { original_message_id: DO_APP },
    });
    expect(await aplicar("smb_message_echoes", eco("edit", T0 + 300))).toBe("editada");
    expect(await aplicar("smb_message_echoes", eco("revoke", T0 + 400))).toBe("apagada");
    const m = await mensagem(DO_APP);
    expect(m.body).toBe("Temos às 10h");
    expect(m.revoked_at).not.toBeNull();
    expect(await aplicar("smb_message_echoes", eco("revoke", T0 + 400))).toBe("sem_mudanca");
  });

  it("o cliente apaga: a linha continua, nada some do banco, e nenhuma mensagem nova nasce", async () => {
    const total = (await contagens()).mensagens;
    expect(
      await aplicar("messages", {
        from: ANA_TEL,
        id: "wamid.coex9290.revoke.1",
        timestamp: String(T0 + 500),
        type: "revoke",
        revoke: { original_message_id: RECEBIDA },
      }),
    ).toBe("apagada");
    const m = await mensagem(RECEBIDA);
    expect(m.revoked_at).not.toBeNull();
    expect(m.body).toBe("Quero o plano anual");
    expect((await contagens()).mensagens).toBe(total);
  });
});

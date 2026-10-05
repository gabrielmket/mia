import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { clienteMcp, TODAS_AS_OPERACOES, TOKEN } from "@/tests/helpers/implantacao-em-memoria";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA — AS CONVERSÕES DA META POR ETAPA, NO POSTGRES DE VERDADE, depois da
 * fusão da 1.73 (.72).
 *
 * ═══ O QUE MUDOU ═══
 *
 * A régua por etapa da Meta passou a ser a do UPSTREAM (0524,
 * `meta_ads_conversion_rules`, consumidor `conversoes.etapa_meta`). A nossa
 * (9017) ficou obsoleta (9019) e o nosso consumidor de etapa saiu do registro.
 * Ficou nosso só o que o upstream não tem: a volta dos LEADS DE FORMULÁRIO
 * (consumidor `conversoes.meta_formulario`, chave `mia_conversoes_meta_config`),
 * o diagnóstico da Meta e as ferramentas do MCP de plataforma, que agora gravam
 * na tabela do upstream pela função da tela dele.
 *
 * ═══ ⭐ A REGRA DA CASA, PROVADA AQUI ═══
 *
 * Um negócio que muda de etapa gera NO MÁXIMO UM envio daquele evento para a
 * Meta. Os consumidores REGISTRADOS (os do upstream e o nosso) rodam juntos sobre
 * o MESMO banco, como o dreno os rodaria, para cada origem do negócio (clique,
 * página, formulário, formulário com clique, orgânico), e conta-se a ida à Meta
 * e a linha no livro-razão. E o nosso consumidor de etapa da .70
 * (`conversoes.meta_etapa`) não está mais registrado.
 *
 * ═══ O QUE NÃO É REPRODUZIDO (declarado) ═══
 *
 *  - A META. `fetch` é um dublê que guarda o corpo: nenhuma chamada sai da máquina.
 *  - A cifra do token: a função de decifrar é um dublê. A LEITURA da conexão
 *    (ligada, com destino, com token) é a de verdade, na tabela de verdade.
 *  - RLS: `pg` conecta como `postgres`, que é como o `service_role` dos
 *    consumidores enxerga o banco. A RLS das tabelas da MIA é medida em
 *    `rls-tabelas-da-mia.test.ts`.
 *
 * Sem dado de ninguém: empresas e negócios fictícios, telefone +5500 (DDD que
 * não existe), id de lead de formulário inventado.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async () => "token-ficticio-de-teste",
  encryptWebhookSecret: async () => null,
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/** O PostgREST devolve data como TEXTO; o `pg` devolveria `Date` e perderia os microssegundos. */
const comoOPostgrest = {
  getTypeParser(oid: number, formato?: string) {
    if (oid === 1700) return (v: string) => Number.parseFloat(v);
    if (oid === 20) return (v: string) => Number(v);
    if (oid === 1184) return (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
    if (oid === 1114) return (v: string) => v.replace(" ", "T");
    if (oid === 1082) return (v: string) => v;
    return pg.types.getTypeParser(oid, formato as "text");
  },
};

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 4,
  types: comoOPostgrest as never,
});

estado.cliente = await pgComoSupabaseMia(pool);

const { ensureHandlersRegistered } = await import("@/lib/event-log/register-handlers");
const { getRegisteredHandlers } = await import("@/lib/event-log/dispatcher");
const { conversaoDoLeadDeFormularioHandler } = await import("@/lib/conversoes-meta/formulario.handler");
const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const IMPLANTADOR = "90199019-1111-4000-8000-0000000000c1";

const REAL = "90199019-0000-4000-8000-0000000000a1";
const DEMO = "90199019-0000-4000-8000-0000000000ad";
const VIZINHA = "90199019-0000-4000-8000-0000000000a2";

const ID_DO_LEAD_DA_META = "12345678901234567";
const DE_CLIQUE = { ad_platform: "meta_ads", ad_source_id: "clique-ficticio" };
const DA_PAGINA = { ad_platform: "site", utm_source: "instagram" };
/** O contato do formulário traz a plataforma e NÃO traz clique (lib/leads-da-meta/mapear.ts). */
const DO_FORMULARIO = { ad_platform: "meta_ads", meta_lead_id: ID_DO_LEAD_DA_META };

/** Os ids de uma empresa: o mesmo desenho nas três, mudando o último dígito. */
function ids(org: string) {
  const d = org.slice(-2);
  return {
    funil: `90199019-1000-4000-8000-0000000000${d}`,
    qualificacao: `90199019-2001-4000-8000-0000000000${d}`,
    agendada: `90199019-2002-4000-8000-0000000000${d}`,
    compareceu: `90199019-2003-4000-8000-0000000000${d}`,
    ganho: `90199019-2009-4000-8000-0000000000${d}`,
    contato: `90199019-3000-4000-8000-0000000000${d}`,
    lead: `90199019-4000-4000-8000-0000000000${d}`,
  };
}

async function uma<T extends pg.QueryResultRow>(consulta: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<T>(consulta, valores);
  expect(rows, consulta).toHaveLength(1);
  return rows[0]!;
}

async function semear(org: string, tag: string, demonstracao: boolean) {
  const i = ids(org);
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name, demonstracao)
       values ($1, $2, $3, $3, $4) on conflict (id) do nothing`,
    [org, `mia-9019-${tag}`, `MIA 9019 ${tag}`, demonstracao],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug) values ($1, $2, 'Agendamentos', $3)
       on conflict (id) do nothing`,
    [i.funil, org, `agendamentos-9019-${tag}`],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won) values
       ($1, $5, $6, 'Qualificação', 'qualificacao', 1000, false),
       ($2, $5, $6, 'Avaliação agendada', 'avaliacao-agendada', 2000, false),
       ($3, $5, $6, 'Compareceu', 'compareceu', 3000, false),
       ($4, $5, $6, 'Fechou tratamento', 'fechou', 9000, true)
     on conflict (id) do nothing`,
    [i.qualificacao, i.agendada, i.compareceu, i.ganho, org, i.funil],
  );
  await pool.query(
    `insert into public.contacts (id, organization_id, name, phone_number, email, source_metadata)
       values ($1, $2, 'Pessoa de teste', $3, 'pessoa@exemplo.invalid', '{}'::jsonb)
       on conflict (id) do nothing`,
    [i.contato, org, `+55009000001${org.slice(-2).replace(/\D/g, "1").padStart(2, "0")}`],
  );
  await pool.query(
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status)
       values ($1, $2, $3, $4, $5, 'Negócio de teste', 'open') on conflict (id) do nothing`,
    [i.lead, org, i.funil, i.qualificacao, i.contato],
  );
}

/** A origem do negócio: o que fica no contato (atribuição) e no próprio negócio (formulário). */
async function origem(org: string, contato: Record<string, unknown>, negocio: Record<string, unknown>) {
  const i = ids(org);
  await pool.query("update public.contacts set source_metadata = $2::jsonb where id = $1", [i.contato, JSON.stringify(contato)]);
  await pool.query("update public.crm_leads set source_metadata = $2::jsonb where id = $1", [i.lead, JSON.stringify(negocio)]);
}

/** A regra do UPSTREAM (0524) numa etapa. `configured_at` é carimbado pelo gatilho dele. */
async function regraDoUpstream(org: string, etapa: string, metaEvent = "QualifiedLead", ligada = true) {
  await pool.query(
    `insert into public.meta_ads_conversion_rules (organization_id, stage_id, event_name, meta_event, enabled)
       values ($1, $2, $3, $4, $5)
     on conflict (organization_id, stage_id) do update set meta_event = excluded.meta_event, enabled = excluded.enabled`,
    [org, etapa, `MetaEtapa:${etapa}`, metaEvent, ligada],
  );
}

async function chaveDosFormularios(org: string, ligada: boolean) {
  await pool.query(
    `insert into public.mia_conversoes_meta_config (organization_id, leads_de_formulario) values ($1, $2)
       on conflict (organization_id) do update set leads_de_formulario = excluded.leads_de_formulario`,
    [org, ligada],
  );
}

/** A hora do BANCO deslocada: o relógio da máquina e o do contêiner não precisam bater. */
async function hora(deslocamento: string): Promise<string> {
  return (await uma<{ t: string }>(`select (now() + $1::interval) as t`, [deslocamento])).t;
}

function entrou(org: string, etapa: string, quando: string, over: Partial<EventRow> = {}): EventRow {
  return {
    id: "evento",
    entity_id: ids(org).lead,
    entity_kind: "crm_lead",
    organization_id: org,
    event_type: "lead.stage_changed",
    payload: { to_stage_id: etapa },
    metadata: {},
    attempts: 0,
    consumed_by: [],
    created_at: quando,
    ...over,
  };
}

const livro = (org: string) =>
  pool
    .query<{ event_name: string; platform: string; status: string; reason: string | null; meta_event_name: string | null }>(
      "select event_name, platform, status, reason, meta_event_name from public.ad_conversion_dispatches where organization_id = $1 order by event_name",
      [org],
    )
    .then((r) => r.rows);

let enviados: Array<{ url: string; corpo: Record<string, unknown> }>;
/** As respostas da Meta de mentira, na ordem; vazia = aceito. */
let respostas: Array<{ status: number; corpo: unknown }>;
const idasAMeta = () => enviados.filter((e) => /\/events$/.test(e.url));
const itemEnviado = (n = 0) => (idasAMeta()[n]!.corpo.data as Array<Record<string, unknown>>)[0]!;

/** Os consumidores de conversão REGISTRADOS, na ordem do registro: os que podem falar com a Meta. */
function consumidoresDeConversao() {
  ensureHandlersRegistered();
  return getRegisteredHandlers().filter((h) => h.key.startsWith("conversoes."));
}

/** O dreno, para um evento: cada consumidor de conversão que escuta aquele tipo, como `dispatchEvent`. */
async function drenar(row: EventRow) {
  for (const h of consumidoresDeConversao()) {
    if (h.events.includes(row.event_type)) await h.handle(row);
  }
}

beforeAll(async () => {
  await semear(REAL, "real", false);
  await semear(VIZINHA, "vizinha", false);
  await semear(DEMO, "demo", true);
  // A conexão LIGADA da empresa de verdade. O token cifrado é um byte qualquer:
  // quem decifra, neste arquivo, é o dublê.
  await pool.query(
    `insert into public.ad_platform_connections (organization_id, platform, dataset_id, access_token_encrypted, enabled)
       values ($1, 'meta_ads', '900000000000001', '\\x00'::bytea, true)
     on conflict do nothing`,
    [REAL],
  );
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  enviados = [];
  respostas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      enviados.push({ url: String(url), corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      const r = respostas.shift() ?? { status: 200, corpo: { events_received: 1 } };
      return new Response(JSON.stringify(r.corpo), { status: r.status });
    }),
  );
  const todas = [[REAL, DEMO, VIZINHA]];
  await pool.query("delete from public.ad_conversion_dispatches where organization_id = any($1)", todas);
  await pool.query("delete from public.meta_ads_conversion_rules where organization_id = any($1)", todas);
  await pool.query("delete from public.mia_conversoes_meta_config where organization_id = any($1)", todas);
  await pool.query("delete from public.google_ads_conversion_rules where organization_id = any($1)", todas);
  await pool.query("update public.crm_leads set value_cents = null, status = 'open', closed_at = null where organization_id = any($1)", todas);
  await origem(REAL, {}, {});
});

afterEach(() => vi.unstubAllGlobals());

describe("o schema depois da 9019", () => {
  it("a régua da 9017 fica de pé, obsoleta e sem uso; nada a apagar nesta fusão", async () => {
    const c = await uma<{ comentario: string }>(
      "select obj_description('public.mia_conversoes_meta_regras'::regclass, 'pg_class') as comentario",
    );
    expect(c.comentario).toMatch(/^OBSOLETA desde a \.72 \(MIA 9019\)/);
    const f = await uma<{ comentario: string }>(
      "select obj_description('public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text)'::regprocedure, 'pg_proc') as comentario",
    );
    expect(f.comentario).toMatch(/^OBSOLETA desde a \.72/);
  });

  it("o reenvio nosso ficou inerte: devolve false e não emite o evento que perdeu o consumidor", async () => {
    const i = ids(REAL);
    await pool.query(
      `insert into public.ad_conversion_dispatches (organization_id, lead_id, platform, event_name, status, reason, event_occurred_at)
         values ($1, $2, 'meta_ads', 'Meta:agendou', 'error', 'recusado_pela_plataforma', now() - interval '1 day')`,
      [REAL, i.lead],
    );
    const antes = await uma<{ n: number }>("select count(*)::int as n from public.event_log where event_type = 'conversao_meta.retry_requested'");
    expect(
      (await uma<{ ok: boolean }>("select public.fn_mia_solicitar_reenvio_conversao_meta($1, $2, 'Meta:agendou') as ok", [REAL, i.lead])).ok,
    ).toBe(false);
    const depois = await uma<{ n: number }>("select count(*)::int as n from public.event_log where event_type = 'conversao_meta.retry_requested'");
    expect(depois.n).toBe(antes.n);
    // E nenhum consumidor registrado escuta mais aquele tipo.
    expect(consumidoresDeConversao().some((h) => h.events.includes("conversao_meta.retry_requested"))).toBe(false);
  });

  it("⭐ a chave dos formulários continua: guarda desde quando está ligada, e esquece ao desligar", async () => {
    const ligar = (valor: boolean) =>
      uma<{ desde: string | null }>(
        `insert into public.mia_conversoes_meta_config (organization_id, leads_de_formulario) values ($1, $2)
           on conflict (organization_id) do update set leads_de_formulario = excluded.leads_de_formulario
         returning leads_de_formulario_desde as desde`,
        [REAL, valor],
      );
    const primeira = (await ligar(true)).desde;
    expect(primeira).not.toBeNull();
    expect((await ligar(true)).desde).toBe(primeira);
    expect((await ligar(false)).desde).toBeNull();
    const segunda = (await ligar(true)).desde;
    expect(Date.parse(segunda!)).toBeGreaterThan(Date.parse(primeira!));
  });
});

describe("⭐ A REGRA DA CASA: um movimento de etapa, no máximo UMA ida à Meta", () => {
  it("o registro tem os três consumidores de etapa do upstream e o nosso dos formulários; o nosso de etapa da .70 saiu", () => {
    const chaves = consumidoresDeConversao().map((h) => h.key).sort();
    expect(chaves).toEqual([
      "conversoes.etapa_meta",
      "conversoes.meta_formulario",
      "conversoes.qualificacao",
      "conversoes.venda",
    ]);
    expect(chaves).not.toContain("conversoes.meta_etapa");
  });

  it.each([
    ["clique em anúncio para o WhatsApp (upstream)", DE_CLIQUE, {}, "business_messaging"],
    ["página com UTM da Meta (upstream, #2076)", DA_PAGINA, {}, "system_generated"],
    ["formulário da Meta (a MIA)", DO_FORMULARIO, DO_FORMULARIO, "system_generated"],
    ["formulário E clique: vence a atribuição do upstream", DE_CLIQUE, DO_FORMULARIO, "business_messaging"],
  ] as const)("%s", async (_nome, doContato, doNegocio, porta) => {
    const i = ids(REAL);
    await origem(REAL, doContato, doNegocio);
    await regraDoUpstream(REAL, i.agendada, "LeadSubmitted");
    await chaveDosFormularios(REAL, true);

    await drenar(entrou(REAL, i.agendada, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(1);
    expect(itemEnviado()).toMatchObject({
      event_name: "LeadSubmitted",
      event_id: `${i.lead}:MetaEtapa:${i.agendada}`,
      action_source: porta,
    });
    expect(await livro(REAL)).toEqual([
      { event_name: `MetaEtapa:${i.agendada}`, platform: "meta_ads", status: "sent", reason: null, meta_event_name: "LeadSubmitted" },
    ]);

    // O mesmo movimento de novo (o dreno reentrega; alguém sai e volta à etapa):
    // nenhuma ida a mais, nenhuma linha a mais.
    await drenar(entrou(REAL, i.agendada, await hora("1 hour"), { id: "evento-2" }));
    expect(idasAMeta()).toHaveLength(1);
    expect(await livro(REAL)).toHaveLength(1);
  });

  it("negócio orgânico: ninguém fala com a Meta, e nada vira pendência", async () => {
    const i = ids(REAL);
    await regraDoUpstream(REAL, i.agendada, "LeadSubmitted");
    await chaveDosFormularios(REAL, true);
    await drenar(entrou(REAL, i.agendada, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(0);
    expect(await livro(REAL)).toEqual([]);
  });

  it("a venda do formulário: arrastar para o ganho e o `lead.won` juntos saem uma vez só", async () => {
    const i = ids(REAL);
    await origem(REAL, DO_FORMULARIO, DO_FORMULARIO);
    await chaveDosFormularios(REAL, true);
    // `crm_leads_closed_at_consistency`: ganho tem data de fechamento.
    await pool.query("update public.crm_leads set status = 'won', closed_at = now(), value_cents = 240000 where id = $1", [i.lead]);

    await drenar(entrou(REAL, i.ganho, await hora("1 second")));
    await drenar(entrou(REAL, i.ganho, await hora("1 second"), { id: "evento-won", event_type: "lead.won", payload: {} }));
    expect(idasAMeta()).toHaveLength(1);
    expect(itemEnviado()).toMatchObject({ event_name: "Purchase", event_id: `${i.lead}:Purchase`, action_source: "system_generated" });
    expect((await livro(REAL)).map((l) => [l.event_name, l.status])).toEqual([["Purchase", "sent"]]);
  });
});

describe("a volta dos leads de formulário, com o banco de verdade", () => {
  it("chave desligada (o padrão): o lead de formulário não volta, e nada vira pendência", async () => {
    const i = ids(REAL);
    await origem(REAL, DO_FORMULARIO, DO_FORMULARIO);
    await regraDoUpstream(REAL, i.agendada, "LeadSubmitted");
    await drenar(entrou(REAL, i.agendada, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(0);
    expect(await livro(REAL)).toEqual([]);
  });

  it("ligar a regra (o gatilho do upstream carimba `configured_at`) não envia o passado", async () => {
    const i = ids(REAL);
    await origem(REAL, DO_FORMULARIO, DO_FORMULARIO);
    await chaveDosFormularios(REAL, true);
    const antes = await hora("-1 hour");
    await regraDoUpstream(REAL, i.agendada, "LeadSubmitted");
    const r = await conversaoDoLeadDeFormularioHandler.handle(entrou(REAL, i.agendada, antes));
    expect(r).toMatchObject({ status: "skipped", detail: "anterior_a_configuracao" });
    expect(idasAMeta()).toHaveLength(0);
  });

  it("o corpo vai pela porta do CRM, com o id do lead em TEXTO", async () => {
    const i = ids(REAL);
    await origem(REAL, DO_FORMULARIO, DO_FORMULARIO);
    await chaveDosFormularios(REAL, true);
    await regraDoUpstream(REAL, i.qualificacao, "QualifiedLead");
    await drenar(entrou(REAL, i.qualificacao, await hora("1 second")));
    expect(itemEnviado()).toMatchObject({
      event_name: "QualifiedLead",
      action_source: "system_generated",
      custom_data: { event_source: "crm" },
    });
    expect(JSON.stringify(idasAMeta()[0]!.corpo)).toContain(`"lead_id":"${ID_DO_LEAD_DA_META}"`);
  });

  it("⭐ o reenvio é o do upstream (`fn_solicitar_reenvio_conversao`), e quem reenvia o lead de formulário é o nosso", async () => {
    const i = ids(REAL);
    await origem(REAL, DO_FORMULARIO, DO_FORMULARIO);
    await chaveDosFormularios(REAL, true);
    await regraDoUpstream(REAL, i.agendada, "LeadSubmitted");
    // A Meta recusou da primeira vez.
    respostas.push({ status: 400, corpo: { error: { code: 100, message: "Invalid parameter" } } });
    await drenar(entrou(REAL, i.agendada, await hora("1 second")));
    expect((await livro(REAL))[0]).toMatchObject({ status: "error", reason: "recusado_pela_plataforma", meta_event_name: "LeadSubmitted" });

    const pedido = await uma<{ ok: boolean }>("select public.fn_solicitar_reenvio_conversao($1, $2, $3) as ok", [
      REAL,
      i.lead,
      `MetaEtapa:${i.agendada}`,
    ]);
    expect(pedido.ok).toBe(true);
    const evento = await uma<{ id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>(
      `select id, event_type, payload, created_at from public.event_log
        where organization_id = $1 and entity_id = $2 and event_type = 'ad_conversion.retry_requested'
        order by created_at desc limit 1`,
      [REAL, i.lead],
    );
    await drenar({ ...entrou(REAL, i.agendada, evento.created_at), id: evento.id, event_type: evento.event_type, payload: evento.payload });
    expect(idasAMeta()).toHaveLength(2);
    expect(itemEnviado(1)).toMatchObject({ event_name: "LeadSubmitted", event_id: `${i.lead}:MetaEtapa:${i.agendada}` });
    expect((await livro(REAL))[0]).toMatchObject({ status: "sent" });
  });

  it("⭐ a empresa de demonstração: a regra e a chave existem, e nada sai (não há conexão ligada nela)", async () => {
    const d = ids(DEMO);
    await origem(DEMO, DO_FORMULARIO, DO_FORMULARIO);
    await chaveDosFormularios(DEMO, true);
    await regraDoUpstream(DEMO, d.agendada, "LeadSubmitted");
    await drenar(entrou(DEMO, d.agendada, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(0);
    expect((await livro(DEMO)).map((l) => [l.status, l.reason])).toEqual([["skipped", "sem_conexao"]]);
  });
});

describe("⭐ as ferramentas do MCP de plataforma, na tabela do upstream", () => {
  let mcp: Awaited<ReturnType<typeof clienteMcp>>;

  beforeAll(async () => {
    await pool.query(
      "insert into auth.users (id, email) values ($1, 'implantador-conversoes-9019@invariant.test') on conflict (id) do nothing",
      [IMPLANTADOR],
    );
    await pool.query(
      `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
         values ($1, 'invariante de conversões', 'dskp_inv', '\\x00'::bytea, $2, $3, 'invariante 9019')
       on conflict (id) do nothing`,
      [TOKEN, TODAS_AS_OPERACOES, IMPLANTADOR],
    );
    mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  });

  afterAll(async () => {
    await mcp?.fechar();
  });

  /** Cada coluna de cada linha das três tabelas que as ferramentas gravam, para uma empresa. */
  async function retrato(org: string): Promise<Record<string, string>> {
    const saida: Record<string, string> = {};
    for (const tabela of ["meta_ads_conversion_rules", "mia_conversoes_meta_config", "google_ads_conversion_rules"]) {
      const r = await uma<{ resumo: string }>(
        `select count(*)::text || ':' || md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as resumo
           from public."${tabela}" x where x.organization_id = $1`,
        [org],
      );
      saida[tabela] = r.resumo;
    }
    return saida;
  }

  async function ok(nome: string, args: Record<string, unknown>) {
    const r = await mcp.chamar(nome, args);
    expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
    return r;
  }

  const MONTAGEM = (org: string): Array<[string, Record<string, unknown>]> => [
    ["plataforma_garantir_conversoes_da_meta", {
      organization_id: org,
      funil: "Agendamentos",
      usar_recomendado: true,
      regras: [{ etapa: "Compareceu", evento: "InitiateCheckout" }],
    }],
    ["plataforma_garantir_conversoes_do_google", {
      organization_id: org,
      funil: "Agendamentos",
      regras: [{ etapa: "Avaliação agendada", nome: "Agendamento", acao_de_conversao_id: "7123456789", categoria: "BOOK_APPOINTMENT" }],
    }],
  ];
  const NO_AR = (org: string): Array<[string, Record<string, unknown>]> => [
    ["plataforma_ligar_conversoes", { organization_id: org, plataforma: "meta", funil: "Agendamentos", ligada: true }],
    ["plataforma_ligar_conversoes", { organization_id: org, plataforma: "google", funil: "Agendamentos", ligada: true }],
    ["plataforma_ligar_leads_de_formulario_da_meta", { organization_id: org, ligada: true }],
  ];

  it("montar grava as regras DESLIGADAS na tabela do upstream; ligar as liga e o gatilho dele anda a trava", async () => {
    const i = ids(REAL);
    for (const [nome, args] of MONTAGEM(REAL)) await ok(nome, args);

    const { rows: daMeta } = await pool.query<{ stage_id: string; event_name: string; meta_event: string; enabled: boolean; updated_by: string }>(
      "select stage_id, event_name, meta_event, enabled, updated_by from public.meta_ads_conversion_rules where organization_id = $1 order by stage_id",
      [REAL],
    );
    expect(daMeta).toEqual([
      { stage_id: i.qualificacao, event_name: `MetaEtapa:${i.qualificacao}`, meta_event: "QualifiedLead", enabled: false, updated_by: IMPLANTADOR },
      { stage_id: i.agendada, event_name: `MetaEtapa:${i.agendada}`, meta_event: "LeadSubmitted", enabled: false, updated_by: IMPLANTADOR },
      { stage_id: i.compareceu, event_name: `MetaEtapa:${i.compareceu}`, meta_event: "InitiateCheckout", enabled: false, updated_by: IMPLANTADOR },
    ]);
    const doGoogle = await uma<{ event_name: string; enabled: boolean }>(
      "select event_name, enabled from public.google_ads_conversion_rules where organization_id = $1",
      [REAL],
    );
    expect(doGoogle).toEqual({ event_name: `Etapa:${i.agendada}`, enabled: false });

    const antes = await uma<{ em: string }>(
      "select configured_at as em from public.meta_ads_conversion_rules where organization_id = $1 and stage_id = $2",
      [REAL, i.agendada],
    );
    for (const [nome, args] of NO_AR(REAL)) await ok(nome, args);
    const depois = await uma<{ em: string; enabled: boolean }>(
      "select configured_at as em, enabled from public.meta_ads_conversion_rules where organization_id = $1 and stage_id = $2",
      [REAL, i.agendada],
    );
    expect(depois.enabled).toBe(true);
    // Ligar pela ferramenta é ligar: a trava de retroatividade do upstream recomeça dali.
    expect(Date.parse(depois.em)).toBeGreaterThan(Date.parse(antes.em));
    expect(
      await uma<{ ligada: boolean; tem_desde: boolean }>(
        "select leads_de_formulario as ligada, leads_de_formulario_desde is not null as tem_desde from public.mia_conversoes_meta_config where organization_id = $1",
        [REAL],
      ),
    ).toEqual({ ligada: true, tem_desde: true });
    // E a régua obsoleta da 9017 não é tocada.
    expect((await uma<{ n: number }>("select count(*)::int as n from public.mia_conversoes_meta_regras where organization_id = $1", [REAL])).n).toBe(0);
  });

  it("⭐ rodar de novo não muda uma linha: o retrato do banco é idêntico", async () => {
    for (const [nome, args] of [...MONTAGEM(REAL), ...NO_AR(REAL)]) await ok(nome, args);
    const antes = await retrato(REAL);
    // O instrumento enxerga uma regravação: sem isto, retrato igual não provaria nada.
    await pool.query("update public.meta_ads_conversion_rules set updated_by = null where organization_id = $1", [REAL]);
    expect((await retrato(REAL)).meta_ads_conversion_rules).not.toBe(antes.meta_ads_conversion_rules);

    const base = await retrato(REAL);
    const saidas = [];
    for (const [nome, args] of [...MONTAGEM(REAL), ...NO_AR(REAL)]) saidas.push([nome, await ok(nome, args)] as const);
    for (const [nome, r] of saidas) {
      expect(r.texto, `${nome} respondeu que criou ou atualizou na segunda passada`).not.toMatch(/"desfecho": "(criou|atualizou)"/);
    }
    expect(await retrato(REAL)).toEqual(base);
  });

  it("a regra que a ferramenta liga é a mesma que o consumidor do upstream lê: o movimento seguinte vai à Meta uma vez", async () => {
    const i = ids(REAL);
    for (const [nome, args] of [...MONTAGEM(REAL), ...NO_AR(REAL)]) await ok(nome, args);
    await origem(REAL, DE_CLIQUE, {});
    await drenar(entrou(REAL, i.compareceu, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(1);
    expect(itemEnviado()).toMatchObject({ event_name: "InitiateCheckout", action_source: "business_messaging" });
  });

  it("na empresa de demonstração: a regra é gravada e ligada, e o movimento seguinte não envia nada", async () => {
    const d = ids(DEMO);
    await ok("plataforma_garantir_conversoes_da_meta", { organization_id: DEMO, funil: "Agendamentos", usar_recomendado: true });
    const ligar = await ok("plataforma_ligar_conversoes", { organization_id: DEMO, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(String(ligar.dados.aviso)).toContain("Empresa de demonstração");
    await origem(DEMO, DE_CLIQUE, {});
    await drenar(entrou(DEMO, d.agendada, await hora("1 second")));
    expect(idasAMeta()).toHaveLength(0);
  });
});

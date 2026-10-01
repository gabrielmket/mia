import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { clienteMcp, TODAS_AS_OPERACOES, TOKEN } from "@/tests/helpers/implantacao-em-memoria";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA (migration 9017) — AS CONVERSÕES DA META POR ETAPA, NO POSTGRES DE VERDADE.
 *
 * ═══ O QUE ESTE ARQUIVO PROVA QUE O TESTE DE UNIDADE NÃO PROVA ═══
 *
 * `tests/unit/conversoes-da-meta-consumidor.test.ts` roda o consumidor contra
 * tabelas em memória. Aqui as tabelas, os CHECK, os gatilhos e as funções são os
 * de verdade: `mia_conversoes_meta_regras` e o gatilho que carimba
 * `configurada_em`, a chave dos formulários e o gatilho do `desde`, o índice
 * único do livro-razão (`ad_conversion_dispatches`, do upstream), o gatilho que
 * não deixa um envio `sent` ser rebaixado, a função do reenvio e a trava da
 * empresa de demonstração (9010). Uma coluna que não existe, um CHECK que recusa
 * o valor ou um gatilho que o código não conhecia aparecem aqui e em nenhum
 * outro lugar.
 *
 * ═══ AS TRAVAS, UMA A UMA ═══
 *
 *   1. uma vez por negócio e evento (sair e voltar, e o mesmo evento em outra
 *      etapa, não duplicam);
 *   2. ligar uma regra não envia o passado;
 *   3. o canal de entrada do negócio;
 *   4. o valor do evento;
 *   5. a empresa de demonstração: a regra pode existir, e nada sai.
 *
 * ═══ E AS FERRAMENTAS DO MCP, NO MESMO BANCO ═══
 *
 * As ferramentas de conversões gravam pelas mesmas funções da tela. Aqui elas
 * rodam pelo protocolo contra as tabelas de verdade, e a reexecução é medida pelo
 * RETRATO do banco (cada coluna de cada linha, inclusive `atualizada_em`): uma
 * ferramenta que respondesse "já estava" e regravasse a linha reprova.
 *
 * ═══ O QUE NÃO É REPRODUZIDO (declarado) ═══
 *
 *  - A META. `fetch` é um dublê que guarda o corpo: nenhuma chamada sai da máquina.
 *  - A cifra do token: a função de decifrar é um dublê. A LEITURA da conexão
 *    (ligada, com destino, com token) é a de verdade, na tabela de verdade.
 *  - RLS: `pg` conecta como `postgres`, que é como o `service_role` do consumidor
 *    enxerga o banco. A RLS das duas tabelas é medida em `rls-tabelas-da-mia.test.ts`.
 *
 * Sem dado de ninguém: empresas e negócios fictícios, telefone +5500 (DDD que
 * não existe).
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

const { conversaoDeEtapaDaMetaHandler } = await import("@/lib/conversoes-meta/etapa.handler");
const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const IMPLANTADOR = "90179017-1111-4000-8000-0000000000c1";

const REAL = "90179017-0000-4000-8000-0000000000a1";
const DEMO = "90179017-0000-4000-8000-0000000000ad";
const VIZINHA = "90179017-0000-4000-8000-0000000000a2";

/** Os ids de uma empresa: o mesmo desenho nas três, mudando o último dígito. */
function ids(org: string) {
  const d = org.slice(-2);
  return {
    funil: `90179017-1000-4000-8000-0000000000${d}`,
    qualificacao: `90179017-2001-4000-8000-0000000000${d}`,
    agendada: `90179017-2002-4000-8000-0000000000${d}`,
    compareceu: `90179017-2003-4000-8000-0000000000${d}`,
    ganho: `90179017-2009-4000-8000-0000000000${d}`,
    contato: `90179017-3000-4000-8000-0000000000${d}`,
    lead: `90179017-4000-4000-8000-0000000000${d}`,
  };
}

async function uma<T extends pg.QueryResultRow>(consulta: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<T>(consulta, valores);
  expect(rows, consulta).toHaveLength(1);
  return rows[0]!;
}

/** O código do erro do Postgres, ou "passou". */
async function tentar(consulta: string, valores: unknown[] = []): Promise<string> {
  try {
    await pool.query(consulta, valores);
    return "passou";
  } catch (e) {
    return (e as { code?: string }).code ?? "erro";
  }
}

async function semear(org: string, tag: string, demonstracao: boolean) {
  const i = ids(org);
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name, demonstracao)
       values ($1, $2, $3, $3, $4) on conflict (id) do nothing`,
    [org, `mia-9017-${tag}`, `MIA 9017 ${tag}`, demonstracao],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug) values ($1, $2, 'Agendamentos', $3)
       on conflict (id) do nothing`,
    [i.funil, org, `agendamentos-9017-${tag}`],
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
    `insert into public.contacts (id, organization_id, name, phone_number, source_metadata)
       values ($1, $2, 'Pessoa de teste', $3, '{"ad_platform":"meta_ads","ad_source_id":"clique-ficticio"}'::jsonb)
       on conflict (id) do nothing`,
    [i.contato, org, `+55009000000${org.slice(-2).replace(/\D/g, "1").padStart(2, "0")}`],
  );
  await pool.query(
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status)
       values ($1, $2, $3, $4, $5, 'Negócio de teste', 'open') on conflict (id) do nothing`,
    [i.lead, org, i.funil, i.qualificacao, i.contato],
  );
}

/** Grava (ou regrava) a regra de uma etapa e devolve quando ela foi configurada. */
async function regra(org: string, etapa: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = { evento: "lead_qualificado", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null, ligada: true, ...over };
  const linha = await uma<{ configurada_em: string }>(
    `insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento, canal, modo_do_valor, valor_fixo_centavos, ligada)
       values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, stage_id) do update set
       evento = excluded.evento, canal = excluded.canal, modo_do_valor = excluded.modo_do_valor,
       valor_fixo_centavos = excluded.valor_fixo_centavos, ligada = excluded.ligada
     returning configurada_em`,
    [org, etapa, r.evento, r.canal, r.modo_do_valor, r.valor_fixo_centavos, r.ligada],
  );
  return linha.configurada_em;
}

/** A hora do BANCO deslocada: o relógio da máquina e o do contêiner não precisam bater. */
async function hora(deslocamento: string): Promise<string> {
  return (await uma<{ t: string }>(`select (now() + $1::interval) as t`, [deslocamento])).t;
}

function entrou(org: string, etapa: string, quando: string): EventRow {
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
  };
}

const livro = (org: string) =>
  pool
    .query<{ event_name: string; platform: string; status: string; reason: string | null; value_cents: number | null }>(
      "select event_name, platform, status, reason, value_cents from public.ad_conversion_dispatches where organization_id = $1 order by event_name",
      [org],
    )
    .then((r) => r.rows);

let enviados: Array<Record<string, unknown>>;
const itemEnviado = (n = 0) => (enviados[n]!.data as Array<Record<string, unknown>>)[0]!;

beforeAll(async () => {
  await semear(REAL, "real", false);
  await semear(VIZINHA, "vizinha", false);
  await semear(DEMO, "demo", true);
  // A conexão LIGADA da empresa de verdade. O token cifrado é um byte qualquer:
  // quem decifra, neste arquivo, é o dublê.
  await pool.query(
    `insert into public.ad_platform_connections (organization_id, platform, dataset_id, access_token_encrypted, enabled)
       values ($1, 'meta_ads', '900000000000001', '\\x00'::bytea, true)`,
    [REAL],
  );
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  enviados = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      enviados.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }),
  );
  await pool.query("delete from public.ad_conversion_dispatches where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
  await pool.query("delete from public.mia_conversoes_meta_regras where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
  await pool.query("delete from public.mia_conversoes_meta_config where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
  await pool.query("delete from public.google_ads_conversion_rules where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
  await pool.query("delete from public.crm_lead_links where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
  await pool.query("update public.crm_leads set value_cents = null where organization_id = any($1)", [[REAL, DEMO, VIZINHA]]);
});

afterEach(() => vi.unstubAllGlobals());

describe("o schema: o que o banco recusa sozinho", () => {
  it("evento, canal e modo do valor fora do vocabulário são recusados", async () => {
    const i = ids(REAL);
    const inserir = (colunas: string, valores: string) =>
      tentar(
        `insert into public.mia_conversoes_meta_regras (organization_id, stage_id, ${colunas}) values ($1, $2, ${valores})`,
        [REAL, i.qualificacao],
      );
    expect(await inserir("evento", "'comprou_tudo'")).toBe("23514");
    expect(await inserir("evento, canal", "'agendou', 'sms'")).toBe("23514");
    expect(await inserir("evento, modo_do_valor", "'agendou', 'gratis'")).toBe("23514");
  });

  it("valor fixo sem valor (ou com zero), e valor guardado fora do modo de valor fixo, são recusados", async () => {
    const i = ids(REAL);
    const inserir = (modo: string, valor: string) =>
      tentar(
        `insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento, modo_do_valor, valor_fixo_centavos)
           values ($1, $2, 'agendou', '${modo}', ${valor})`,
        [REAL, i.agendada],
      );
    expect(await inserir("valor_fixo", "null")).toBe("23514");
    expect(await inserir("valor_fixo", "0")).toBe("23514");
    expect(await inserir("sem_valor", "15000")).toBe("23514");
    expect(await inserir("valor_fixo", "15000")).toBe("passou");
  });

  it("uma regra por etapa, e etapa de OUTRA empresa não entra", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    expect(
      await tentar(`insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento) values ($1, $2, 'agendou')`, [
        REAL,
        i.qualificacao,
      ]),
    ).toBe("23505");
    expect(
      await tentar(`insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento) values ($1, $2, 'agendou')`, [
        REAL,
        ids(VIZINHA).qualificacao,
      ]),
    ).toBe("23503");
  });

  it("a regra nasce DESLIGADA quando ninguém diz o contrário", async () => {
    const i = ids(REAL);
    const linha = await uma<{ ligada: boolean; canal: string; modo_do_valor: string }>(
      `insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento) values ($1, $2, 'agendou')
         returning ligada, canal, modo_do_valor`,
      [REAL, i.agendada],
    );
    expect(linha).toEqual({ ligada: false, canal: "todos", modo_do_valor: "sem_valor" });
  });

  it("⭐ `configurada_em` anda quando a regra é LIGADA ou troca de evento, e fica onde está no resto", async () => {
    const i = ids(REAL);
    const nasceu = await regra(REAL, i.qualificacao, { ligada: false });
    const mexer = async (sql: string) =>
      (
        await uma<{ configurada_em: string }>(
          `update public.mia_conversoes_meta_regras set ${sql} where organization_id = $1 and stage_id = $2 returning configurada_em`,
          [REAL, i.qualificacao],
        )
      ).configurada_em;
    // Cada UPDATE é uma transação: `now()` de cada uma é depois da anterior.
    expect(await mexer("canal = 'whatsapp'")).toBe(nasceu);
    expect(await mexer("modo_do_valor = 'valor_fixo', valor_fixo_centavos = 15000")).toBe(nasceu);
    const ligou = await mexer("ligada = true");
    expect(Date.parse(ligou)).toBeGreaterThan(Date.parse(nasceu));
    expect(await mexer("ligada = false")).toBe(ligou);
    const trocou = await mexer("evento = 'agendou'");
    expect(Date.parse(trocou)).toBeGreaterThan(Date.parse(ligou));
    // E ninguém consegue voltar o relógio à mão.
    expect(await mexer("configurada_em = timestamptz '2020-01-01'")).toBe(trocou);
  });

  it("⭐ a chave dos formulários guarda desde quando está ligada, e esquece ao desligar", async () => {
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

describe("⭐ as travas, com o consumidor de verdade e o banco de verdade", () => {
  it("1 · uma vez por negócio e evento: o primeiro movimento envia, e voltar à etapa não", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    const quando = await hora("1 second");

    expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, quando))).status).toBe("ok");
    expect(enviados).toHaveLength(1);
    expect(itemEnviado()).toMatchObject({
      event_name: "QualifiedLead",
      event_id: `${i.lead}:Meta:lead_qualificado`,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
    });
    expect(await livro(REAL)).toEqual([
      { event_name: "Meta:lead_qualificado", platform: "meta_ads", status: "sent", reason: null, value_cents: null },
    ]);

    const voltou = await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, await hora("1 hour")));
    expect(voltou).toMatchObject({ status: "skipped", detail: "ja_enviada" });
    expect(enviados).toHaveLength(1);
    expect(await livro(REAL)).toHaveLength(1);
  });

  it("1 · o mesmo evento ligado em duas etapas só sai na primeira; eventos diferentes saem os dois", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    await regra(REAL, i.compareceu);
    await regra(REAL, i.agendada, { evento: "agendou" });
    const quando = await hora("1 second");

    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, quando));
    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.agendada, quando));
    const repetido = await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.compareceu, quando));
    expect(repetido).toMatchObject({ status: "skipped", detail: "ja_enviada" });
    expect(enviados.map((_, n) => itemEnviado(n).event_name)).toEqual(["QualifiedLead", "Schedule"]);
    expect((await livro(REAL)).map((l) => [l.event_name, l.status])).toEqual([
      ["Meta:agendou", "sent"],
      ["Meta:lead_qualificado", "sent"],
    ]);
  });

  it("1 · um envio aceito nunca é rebaixado, mesmo que alguém tente regravar a linha", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, await hora("1 second")));
    await pool.query(
      "update public.ad_conversion_dispatches set status = 'skipped', reason = 'sem_conexao' where organization_id = $1",
      [REAL],
    );
    expect((await livro(REAL))[0]).toMatchObject({ status: "sent", reason: null });
  });

  it("2 · ligar uma regra não envia o passado: o movimento anterior à configuração fica como decisão", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    const antes = await hora("-1 day");

    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, antes));
    expect(r).toMatchObject({ status: "skipped", detail: "anterior_a_regra" });
    expect(enviados).toHaveLength(0);
    expect(await livro(REAL)).toEqual([
      { event_name: "Meta:lead_qualificado", platform: "meta_ads", status: "skipped", reason: "anterior_a_regra", value_cents: null },
    ]);
  });

  it("2 · regra desligada e religada: o que aconteceu no intervalo também é passado", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao, { ligada: false });
    const noIntervalo = await hora("0 seconds");
    await regra(REAL, i.qualificacao, { ligada: true });

    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, noIntervalo));
    expect(r).toMatchObject({ detail: "anterior_a_regra" });
    expect(enviados).toHaveLength(0);
  });

  it("3 · canal de entrada: \"só WhatsApp\" não envia o negócio sem conversa, e envia o que tem", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao, { canal: "whatsapp" });
    const quando = await hora("1 second");

    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, quando))).toMatchObject({
      status: "skipped",
      detail: "canal_fora_da_regra",
    });
    expect(enviados).toHaveLength(0);
    expect(await livro(REAL)).toEqual([]);

    await pool.query(
      `insert into public.crm_lead_links (organization_id, lead_id, target_kind, target_id, link_kind)
         values ($1, $2, 'conversation', gen_random_uuid(), 'origin')`,
      [REAL, i.lead],
    );
    expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, quando))).status).toBe("ok");
    expect(enviados).toHaveLength(1);
  });

  it("4 · o valor: fixo leva o valor da regra; do negócio leva o do negócio; sem valor no negócio, sai sem valor", async () => {
    const i = ids(REAL);
    await regra(REAL, i.agendada, { evento: "agendou", modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000 });
    await regra(REAL, i.qualificacao, { evento: "lead_qualificado", modo_do_valor: "valor_do_negocio" });
    await regra(REAL, i.compareceu, { evento: "pediu_orcamento", modo_do_valor: "valor_do_negocio" });
    const quando = await hora("1 second");

    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.agendada, quando));
    expect(itemEnviado(0).custom_data).toEqual({ value: 150, currency: "BRL" });

    // O negócio ainda não tem valor: o evento de etapa sai, sem valor.
    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.qualificacao, quando));
    expect(itemEnviado(1)).not.toHaveProperty("custom_data");

    await pool.query("update public.crm_leads set value_cents = 240000 where id = $1", [i.lead]);
    await conversaoDeEtapaDaMetaHandler.handle(entrou(REAL, i.compareceu, quando));
    expect(itemEnviado(2).custom_data).toEqual({ value: 2400, currency: "BRL" });

    expect((await livro(REAL)).map((l) => [l.event_name, l.status, l.value_cents])).toEqual([
      ["Meta:agendou", "sent", 15000],
      ["Meta:lead_qualificado", "sent", null],
      ["Meta:pediu_orcamento", "sent", 240000],
    ]);
  });

  it("a regra de uma empresa não vale para o negócio de outra", async () => {
    const i = ids(REAL);
    await regra(REAL, i.qualificacao);
    // A vizinha não tem regra nem conexão: o mesmo movimento, lá, não envia nada.
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(VIZINHA, ids(VIZINHA).qualificacao, await hora("1 second")));
    expect(r.status).toBe("skipped");
    expect(enviados).toHaveLength(0);
    expect(await livro(VIZINHA)).toEqual([]);
  });
});

describe("⭐ 5 · a empresa de demonstração: a regra pode existir, e nada sai", () => {
  it("a regra LIGADA é gravada na demonstração (controle: é a mesma escrita da empresa de verdade)", async () => {
    const d = ids(DEMO);
    expect(
      await tentar(
        `insert into public.mia_conversoes_meta_regras (organization_id, stage_id, evento, ligada) values ($1, $2, 'lead_qualificado', true)`,
        [DEMO, d.qualificacao],
      ),
    ).toBe("passou");
    expect(
      await tentar(`insert into public.mia_conversoes_meta_config (organization_id, leads_de_formulario) values ($1, true)`, [DEMO]),
    ).toBe("passou");
  });

  it("a conexão de conversões LIGADA não nasce nela (a trava da 9010), e desligada pode existir", async () => {
    const ligada = `insert into public.ad_platform_connections (organization_id, platform, dataset_id, access_token_encrypted, enabled)
                      values ($1, 'meta_ads', '900000000000002', '\\x00'::bytea, true)`;
    expect(await tentar(ligada, [DEMO])).toBe("42501");
    expect(await tentar(ligada.replace("true)", "false)"), [DEMO])).toBe("passou");
    await pool.query("delete from public.ad_platform_connections where organization_id = $1", [DEMO]);
  });

  it("sem conexão: o negócio entra na etapa com regra ligada, e NADA vai para a Meta", async () => {
    const d = ids(DEMO);
    await regra(DEMO, d.qualificacao);
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(DEMO, d.qualificacao, await hora("1 second")));
    expect(r).toMatchObject({ status: "skipped", detail: "sem_conexao" });
    expect(enviados).toHaveLength(0);
    expect(await livro(DEMO)).toEqual([
      { event_name: "Meta:lead_qualificado", platform: "meta_ads", status: "skipped", reason: "sem_conexao", value_cents: null },
    ]);
  });

  it("com a conexão gravada e desligada (o máximo que a demonstração aceita): também não sai", async () => {
    const d = ids(DEMO);
    await pool.query(
      `insert into public.ad_platform_connections (organization_id, platform, dataset_id, access_token_encrypted, enabled)
         values ($1, 'meta_ads', '900000000000002', '\\x00'::bytea, false)`,
      [DEMO],
    );
    await regra(DEMO, d.qualificacao);
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(DEMO, d.qualificacao, await hora("1 second")));
    expect(r).toMatchObject({ status: "skipped", detail: "conexao_desabilitada" });
    expect(enviados).toHaveLength(0);
    await pool.query("delete from public.ad_platform_connections where organization_id = $1", [DEMO]);
  });
});

describe("o reenvio de um evento de etapa", () => {
  const pedir = (org: string, lead: string, evento: string) =>
    uma<{ ok: boolean }>("select public.fn_mia_solicitar_reenvio_conversao_meta($1, $2, $3) as ok", [org, lead, evento]).then(
      (r) => r.ok,
    );
  const linha = (org: string, lead: string, evento: string, status: string, motivo: string | null, ocorreu: string | null) =>
    pool.query(
      `insert into public.ad_conversion_dispatches (organization_id, lead_id, platform, event_name, status, reason, event_occurred_at, value_cents, currency)
         values ($1, $2, 'meta_ads', $3, $4, $5, now() + $6::interval, 15000, 'BRL')`,
      [org, lead, evento, status, motivo, ocorreu],
    );

  it("só o servidor chama: anon e authenticated não têm EXECUTE", async () => {
    const acl = await uma<{ anon: boolean; autenticado: boolean; servico: boolean }>(
      `select has_function_privilege('anon', 'public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text)', 'execute') as autenticado,
              has_function_privilege('service_role', 'public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text)', 'execute') as servico`,
    );
    expect(acl).toEqual({ anon: false, autenticado: false, servico: true });
  });

  it("⭐ recusado e dentro de 7 dias: agenda, uma vez, e o consumidor reenvia com o RETRATO do primeiro envio", async () => {
    const i = ids(REAL);
    await regra(REAL, i.agendada, { evento: "agendou", modo_do_valor: "valor_fixo", valor_fixo_centavos: 99900 });
    await linha(REAL, i.lead, "Meta:agendou", "error", "recusado_pela_plataforma", "-2 days");
    const retrato = await uma<{ em: string }>(
      "select event_occurred_at as em from public.ad_conversion_dispatches where organization_id = $1",
      [REAL],
    );

    expect(await pedir(REAL, i.lead, "Meta:agendou")).toBe(true);
    // Um pedido pendente não vira dois.
    expect(await pedir(REAL, i.lead, "Meta:agendou")).toBe(false);

    const evento = await uma<{ id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>(
      `select id, event_type, payload, created_at from public.event_log
        where organization_id = $1 and entity_id = $2 and event_type = 'conversao_meta.retry_requested'`,
      [REAL, i.lead],
    );
    expect(evento.payload).toEqual({ event_name: "Meta:agendou" });
    expect((await livro(REAL))[0]).toMatchObject({ status: "error", reason: "reprocessamento_solicitado" });
    // O tipo é escutado pelo consumidor: não é um comando sem dono.
    expect(conversaoDeEtapaDaMetaHandler.events).toContain(evento.event_type);

    const r = await conversaoDeEtapaDaMetaHandler.handle({
      ...entrou(REAL, i.agendada, evento.created_at),
      id: evento.id,
      event_type: evento.event_type,
      payload: evento.payload,
    });
    expect(r.status).toBe("ok");
    // A data e o valor do PRIMEIRO envio, e não os da regra de agora (R$ 999).
    expect(itemEnviado().event_time).toBe(Math.floor(Date.parse(retrato.em) / 1000));
    expect(itemEnviado().custom_data).toEqual({ value: 150, currency: "BRL" });
    expect((await livro(REAL))[0]).toMatchObject({ status: "sent", value_cents: 15000 });
  });

  it("o que não tem reenvio que resolva: já enviado, decisão das travas, mais de 7 dias, evento que não é da Meta, negócio de outra empresa", async () => {
    const i = ids(REAL);
    expect(await pedir(REAL, i.lead, "Meta:agendou")).toBe(false);

    await linha(REAL, i.lead, "Meta:agendou", "sent", null, "-1 day");
    await linha(REAL, i.lead, "Meta:lead_qualificado", "skipped", "anterior_a_regra", "-1 day");
    await linha(REAL, i.lead, "Meta:pediu_orcamento", "skipped", "formulario_desligado", "-1 day");
    await linha(REAL, i.lead, "Meta:novo_lead", "error", "recusado_pela_plataforma", "-8 days");
    await linha(REAL, i.lead, "Meta:iniciou_compra", "error", "recusado_pela_plataforma", null);
    for (const evento of ["Meta:agendou", "Meta:lead_qualificado", "Meta:pediu_orcamento", "Meta:novo_lead", "Meta:iniciou_compra"]) {
      expect(await pedir(REAL, i.lead, evento), evento).toBe(false);
    }
    for (const evento of ["Purchase", "QualifiedLead", "Meta:AGENDOU", "Meta:"]) {
      expect(await pedir(REAL, i.lead, evento), evento).toBe(false);
    }
    // A linha é da REAL: a vizinha não a alcança pedindo com o id do negócio alheio.
    expect(await pedir(VIZINHA, i.lead, "Meta:novo_lead")).toBe(false);
    expect(
      (
        await uma<{ n: number }>(
          "select count(*)::int as n from public.event_log where event_type = 'conversao_meta.retry_requested' and organization_id = any($1)",
          [[REAL, VIZINHA]],
        )
      ).n,
    ).toBe(1); // só o do caso anterior
  });
});

describe("⭐ as ferramentas do MCP de plataforma, no banco de verdade", () => {
  let mcp: Awaited<ReturnType<typeof clienteMcp>>;

  beforeAll(async () => {
    await pool.query(
      "insert into auth.users (id, email) values ($1, 'implantador-conversoes-9017@invariant.test') on conflict (id) do nothing",
      [IMPLANTADOR],
    );
    await pool.query(
      `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
         values ($1, 'invariante de conversões', 'dskp_inv', '\\x00'::bytea, $2, $3, 'invariante 9017')
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
    for (const tabela of ["mia_conversoes_meta_regras", "mia_conversoes_meta_config", "google_ads_conversion_rules"]) {
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
      regras: [{ etapa: "Compareceu", evento: "pediu_orcamento", canal: "whatsapp", valor: "valor_fixo", valor_fixo_centavos: 15000 }],
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

  it("montar grava as regras DESLIGADAS nas tabelas de verdade; ligar as liga e anda o relógio da trava", async () => {
    const i = ids(REAL);
    for (const [nome, args] of MONTAGEM(REAL)) await ok(nome, args);

    const { rows: daMeta } = await pool.query<{ stage_id: string; evento: string; canal: string; modo_do_valor: string; valor_fixo_centavos: number | null; ligada: boolean; atualizada_por: string }>(
      "select stage_id, evento, canal, modo_do_valor, valor_fixo_centavos, ligada, atualizada_por from public.mia_conversoes_meta_regras where organization_id = $1 order by stage_id",
      [REAL],
    );
    expect(daMeta).toEqual([
      // A primeira etapa aberta do funil é onde o negócio nasce: novo lead.
      { stage_id: i.qualificacao, evento: "novo_lead", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null, ligada: false, atualizada_por: IMPLANTADOR },
      { stage_id: i.agendada, evento: "agendou", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null, ligada: false, atualizada_por: IMPLANTADOR },
      { stage_id: i.compareceu, evento: "pediu_orcamento", canal: "whatsapp", modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000, ligada: false, atualizada_por: IMPLANTADOR },
    ]);
    const doGoogle = await uma<{ event_name: string; enabled: boolean; google_action_id: string; category: string }>(
      "select event_name, enabled, google_action_id, category from public.google_ads_conversion_rules where organization_id = $1",
      [REAL],
    );
    expect(doGoogle).toEqual({ event_name: `Etapa:${i.agendada}`, enabled: false, google_action_id: "7123456789", category: "BOOK_APPOINTMENT" });

    const antes = await uma<{ em: string }>(
      "select configurada_em as em from public.mia_conversoes_meta_regras where organization_id = $1 and stage_id = $2",
      [REAL, i.agendada],
    );
    for (const [nome, args] of NO_AR(REAL)) await ok(nome, args);
    const depois = await uma<{ em: string; ligada: boolean }>(
      "select configurada_em as em, ligada from public.mia_conversoes_meta_regras where organization_id = $1 and stage_id = $2",
      [REAL, i.agendada],
    );
    expect(depois.ligada).toBe(true);
    // Ligar pela ferramenta é ligar: a trava de retroatividade recomeça dali.
    expect(Date.parse(depois.em)).toBeGreaterThan(Date.parse(antes.em));
    expect((await uma<{ enabled: boolean }>("select enabled from public.google_ads_conversion_rules where organization_id = $1", [REAL])).enabled).toBe(true);
    expect(
      await uma<{ ligada: boolean; tem_desde: boolean }>(
        "select leads_de_formulario as ligada, leads_de_formulario_desde is not null as tem_desde from public.mia_conversoes_meta_config where organization_id = $1",
        [REAL],
      ),
    ).toEqual({ ligada: true, tem_desde: true });
  });

  it("⭐ rodar de novo não muda uma linha: o retrato do banco é idêntico", async () => {
    for (const [nome, args] of [...MONTAGEM(REAL), ...NO_AR(REAL)]) await ok(nome, args);
    const antes = await retrato(REAL);
    // O instrumento enxerga uma regravação: sem isto, retrato igual não provaria nada.
    await pool.query("update public.mia_conversoes_meta_regras set canal = canal where organization_id = $1", [REAL]);
    const mexido = await retrato(REAL);
    expect(mexido.mia_conversoes_meta_regras).not.toBe(antes.mia_conversoes_meta_regras);

    const base = await retrato(REAL);
    const respostas = [];
    for (const [nome, args] of [...MONTAGEM(REAL), ...NO_AR(REAL)]) respostas.push([nome, await ok(nome, args)] as const);
    for (const [nome, r] of respostas) {
      expect(r.texto, `${nome} respondeu que criou ou atualizou na segunda passada`).not.toMatch(/"desfecho": "(criou|atualizou)"/);
    }
    expect(await retrato(REAL)).toEqual(base);
  });

  it("a leitura devolve as regras gravadas e a conexão sem segredo", async () => {
    for (const [nome, args] of MONTAGEM(REAL)) await ok(nome, args);
    const r = await ok("plataforma_ver_conversoes", { organization_id: REAL });
    expect((r.dados.conexoes as { meta: Record<string, unknown> }).meta).toEqual({
      conectada: true,
      destino_de_conversoes: "900000000000001",
      tem_token: true,
      envio_ligado: true,
      modo_de_teste: false,
    });
    expect(r.texto).not.toContain("token-ficticio-de-teste");
    const funil = (r.dados.funis as Array<{ funil: string; etapas: Array<{ etapa: string; meta: { evento: string } | null }> }>).find(
      (f) => f.funil === "Agendamentos",
    )!;
    expect(funil.etapas.map((e) => [e.etapa, e.meta?.evento ?? null])).toEqual([
      ["Qualificação", "novo_lead"],
      ["Avaliação agendada", "agendou"],
      ["Compareceu", "pediu_orcamento"],
    ]);
  });

  it("na empresa de demonstração: a regra é gravada e ligada, e o movimento seguinte não envia nada", async () => {
    const d = ids(DEMO);
    await pool.query("delete from public.ad_platform_connections where organization_id = $1", [DEMO]);
    await ok("plataforma_garantir_conversoes_da_meta", { organization_id: DEMO, funil: "Agendamentos", usar_recomendado: true });
    const ligar = await ok("plataforma_ligar_conversoes", { organization_id: DEMO, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(String(ligar.dados.aviso)).toContain("Empresa de demonstração");

    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(DEMO, d.agendada, await hora("1 second")));
    expect(r).toMatchObject({ status: "skipped", detail: "sem_conexao" });
    expect(enviados).toHaveLength(0);
  });
});

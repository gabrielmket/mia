/**
 * FORK MIA (MIA-169) — as CONVERSÕES DO SITE no motor de sempre
 * (`lib/conversoes/site.ts`, `etapa-site.handler.ts` e o ramo FORK MIA de
 * `envio.handler.ts`), contra tabelas em memória.
 *
 * Os modos de falha vigiados:
 *  - o negócio do cadastro entra na etapa com regra do site e nada sai, ou sai
 *    pela credencial errada (a conexão da Meta da empresa, que é outro dataset);
 *  - as travas dos consumidores do upstream não valem (regra desligada,
 *    movimento anterior à regra, etapa de ganho, já enviado);
 *  - o reenvio pelo retrato (`ad_conversion.retry_requested`, pelos consumidores
 *    do UPSTREAM) não acha a regra do site;
 *  - ⭐ outra empresa usa a credencial da variável;
 *  - a compra do cadastro sai duas vezes (pela etapa e pela venda): `venda_pelo_site`;
 *  - o Google sem valor, ou com `validateOnly` ligado fora do teste.
 *
 * ⚠️ NUNCA fala com a Meta nem com o Google: `fetch` é um dublê. Dado fictício
 * (Ana Exemplo, domínio de exemplo, IP de documentação, DDD 00).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, google: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// A conexão do Google da empresa (a do site usa a mesma): a leitura é dublê,
// para o teste não depender da cifra. A Meta do site NÃO passa por aqui.
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({
  lerCredencial: vi.fn(async (_a: unknown, _o: string, plataforma: string) =>
    plataforma === "google_ads" && estado.google
      ? { ok: true, credencial: structuredClone(estado.google) }
      : { ok: false, motivo: "sem_conexao" },
  ),
}));
vi.mock("@/lib/plataformas-de-anuncio/google/config", () => ({
  configuracaoDoGoogleAds: () => ({ clientId: "cid", clientSecret: "s", developerToken: "dev", redirectUri: "https://example.test/cb" }),
}));
vi.mock("@/lib/plataformas-de-anuncio/google/token", () => ({
  renovarToken: async () => ({ ok: true, token: { access_token: "token-google-ficticio" } }),
}));

const { conversaoDeEtapaDoSiteHandler } = await import("@/lib/conversoes/etapa-site.handler");
const { conversaoDeEtapaMetaHandler } = await import("@/lib/conversoes/etapa-meta.handler");
const { conversaoDeQualificacaoHandler } = await import("@/lib/conversoes/qualificacao.handler");
const { conversaoDeVendaHandler } = await import("@/lib/conversoes/envio.handler");
const { credencialDaMetaDoSite, montarConversaoDoSite } = await import("@/lib/conversoes/site");
const { transporteGoogle } = await import("@/lib/plataformas-de-anuncio/google/conversions");

import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OUTRA = "0a000000-0000-4000-8000-000000000002";
const FONTE = "0f000000-0000-4000-8000-0000000000f1";
const LEAD = "0e000000-0000-4000-8000-000000000001";
const CONTATO = "0c000000-0000-4000-8000-000000000001";
const EMPRESA = "0a000000-0000-4000-8000-0000000000e1";
const ETAPA = { cadastro: "0d000000-0000-4000-8000-0000000000e1", assinante: "0d000000-0000-4000-8000-0000000000e2", ganho: "0d000000-0000-4000-8000-0000000000e9" };
const REGRA = {
  cadastroMeta: "0b000000-0000-4000-8000-0000000000a1",
  cadastroGoogle: "0b000000-0000-4000-8000-0000000000a2",
  subscribe: "0b000000-0000-4000-8000-0000000000a3",
  purchase: "0b000000-0000-4000-8000-0000000000a4",
};
const DATASET_DO_SITE = "900000000000777";
const DATASET_DA_CONEXAO = "900000000000111";
const MOVIMENTO = new Date(Date.now() - 60_000).toISOString();

const regra = (id: string, stage: string, over: Linha = {}): Linha => ({
  id,
  organization_id: ORG,
  stage_id: stage,
  plataforma: "meta_ads",
  evento_meta: "CompleteRegistration",
  google_acao_id: null,
  leva_valor: false,
  enabled: true,
  configured_at: "2026-01-01T00:00:00Z",
  created_at: `2026-01-01T00:00:0${id.slice(-1)}Z`,
  ...over,
});

let banco: ReturnType<typeof bancoEmMemoria>;
/** O que a `fn_mia_e_demonstracao` responde: a empresa é de demonstração, não é, ou a leitura falha. */
let demonstracao: boolean | "erro" = false;
const fetch = vi.fn();
const tabela = (n: string) => banco.tabela(n) as Linha[];

function montar(org = ORG) {
  banco = bancoEmMemoria({
    webhook_sources: [{ id: FONTE, organization_id: ORG }],
    crm_stages: [
      { id: ETAPA.cadastro, organization_id: org, is_won: false, is_lost: false },
      { id: ETAPA.assinante, organization_id: org, is_won: false, is_lost: false },
      { id: ETAPA.ganho, organization_id: org, is_won: true, is_lost: false },
    ],
    crm_leads: [{ id: LEAD, organization_id: org, status: "open", value_cents: 19700, currency: "BRL", closed_at: null, contact_id: CONTATO }],
    contacts: [
      // Sem atribuição no carimbo: a do site vem só da `mia_cadastro_na_time`.
      { id: CONTATO, organization_id: org, name: "Ana Exemplo", display_name: null, email: "ana.exemplo@example.com", phone_number: "5500900000000", source_metadata: {} },
    ],
    mia_cadastro_na_time: [
      {
        organization_id: org,
        lead_id: LEAD,
        empresa_cliente_id: EMPRESA,
        ip: "203.0.113.10",
        navegador: "Mozilla/5.0 (teste)",
        pagina: "https://app.exemplo.test/signup",
        fbp: "fb.1.1.1",
        fbc: null,
        consentimento: "medicao",
        gclid: "gclid-ficticio",
        gbraid: null,
        wbraid: null,
        pedido_id: "pay_ficticio_1",
      },
    ],
    // A conexão da Meta da empresa existe e aponta para OUTRO dataset: o site nunca a usa.
    ad_platform_connections: [{ organization_id: org, platform: "meta_ads", dataset_id: DATASET_DA_CONEXAO, enabled: true }],
    mia_regras_de_conversao_do_site: [
      regra(REGRA.cadastroMeta, ETAPA.cadastro, { organization_id: org }),
      regra(REGRA.cadastroGoogle, ETAPA.cadastro, { organization_id: org, plataforma: "google_ads", evento_meta: null, google_acao_id: "7000000001" }),
      regra(REGRA.subscribe, ETAPA.assinante, { organization_id: org, evento_meta: "Subscribe", leva_valor: true }),
      regra(REGRA.purchase, ETAPA.assinante, { organization_id: org, evento_meta: "Purchase", leva_valor: true }),
    ],
    ad_conversion_dispatches: [],
  }, {
    fn_mia_e_demonstracao: () =>
      demonstracao === "erro" ? { data: null, error: { message: "indisponivel" } } : { data: demonstracao, error: null },
  });
  estado.cliente = banco.cliente;
}

function movimento(etapa: string, over: Partial<EventRow> = {}): EventRow {
  return {
    id: "evt-1",
    organization_id: ORG,
    event_type: "lead.stage_changed",
    entity_kind: "crm_lead",
    entity_id: LEAD,
    payload: { to_stage_id: etapa },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: MOVIMENTO,
    ...over,
  };
}

const idasAMeta = () => fetch.mock.calls.filter(([u]) => String(u).includes("graph.facebook.com"));
const idasAoGoogle = () => fetch.mock.calls.filter(([u]) => String(u).includes("googleads.googleapis.com"));
const corpo = (chamada: unknown[]) => JSON.parse(String((chamada[1] as RequestInit).body));
const livro = (chave: string) => tabela("ad_conversion_dispatches").find((l) => l.event_name === chave);

beforeEach(() => {
  demonstracao = false;
  montar();
  estado.google = {
    datasetId: "",
    accessToken: "",
    testEventCode: null,
    google: { api: "google_ads", refreshToken: "refresh-ficticio", customerId: "1234567890", loginCustomerId: null, conversionActionId: "" },
  };
  vi.stubEnv("CADASTRO_FONTE_DO_CRM", FONTE);
  vi.stubEnv("MIA_META_DATASET_DO_SITE", DATASET_DO_SITE);
  vi.stubEnv("MIA_META_TOKEN_DO_SITE", "token-do-site-ficticio");
  vi.stubEnv("META_TEST_EVENT_CODE", "");
  fetch.mockReset();
  fetch.mockImplementation(async (url: string) =>
    String(url).includes("graph.facebook.com")
      ? new Response(JSON.stringify({ events_received: 1 }), { status: 200 })
      : new Response(JSON.stringify({ results: [{ conversionAction: "customers/1234567890/conversionActions/7000000001" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("o consumidor das conversões do site", () => {
  it("⭐ a etapa manda cada regra pelo motor: Meta pela variável (dataset do site) e Google pela conexão, e o livro-razão guarda o retrato", async () => {
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(r.status, r.detail).toBe("ok");

    expect(idasAMeta()).toHaveLength(1);
    const [url, init] = idasAMeta()[0] as [string, RequestInit];
    expect(url).toContain(`/${DATASET_DO_SITE}/events`);
    expect(url).not.toContain(DATASET_DA_CONEXAO);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-do-site-ficticio");
    const evento = corpo(idasAMeta()[0]!).data[0];
    expect(evento).toMatchObject({ event_name: "CompleteRegistration", action_source: "website", event_id: `${LEAD}:MetaEtapa:${REGRA.cadastroMeta}` });
    expect(evento.user_data.fbp).toBe("fb.1.1.1");

    expect(idasAoGoogle()).toHaveLength(1);
    const google = corpo(idasAoGoogle()[0]!);
    expect(google.conversions[0]).toMatchObject({ gclid: "gclid-ficticio", conversionAction: "customers/1234567890/conversionActions/7000000001" });
    // Sem `leva_valor`, sem valor; e o validateOnly é só da ferramenta de teste.
    expect(google.conversions[0]).not.toHaveProperty("conversionValue");
    expect(google).not.toHaveProperty("validateOnly");

    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ status: "sent", platform: "meta_ads", meta_event_name: "CompleteRegistration", event_occurred_at: MOVIMENTO });
    expect(livro(`Etapa:${REGRA.cadastroGoogle}`)).toMatchObject({ status: "sent", platform: "google_ads", google_action_id: "7000000001" });

    // ⭐ Os consumidores do upstream não fazem nada no mesmo movimento (não há regra deles).
    fetch.mockClear();
    await conversaoDeEtapaMetaHandler.handle(movimento(ETAPA.cadastro));
    await conversaoDeQualificacaoHandler.handle(movimento(ETAPA.cadastro));
    await conversaoDeVendaHandler.handle(movimento(ETAPA.cadastro));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("⭐ o que já foi enviado não sai de novo (sair e voltar à etapa)", async () => {
    await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    fetch.mockClear();
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro, { id: "evt-2" }));
    expect(r.status).toBe("skipped");
    expect(r.detail).toContain("ja_enviada");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("⭐ movimento anterior à regra não envia (ligar não despeja o histórico)", async () => {
    for (const l of tabela("mia_regras_de_conversao_do_site")) l.configured_at = new Date().toISOString();
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(r.detail).toContain("anterior_a_configuracao");
    expect(fetch).not.toHaveBeenCalled();
    expect(tabela("ad_conversion_dispatches")).toEqual([]);
  });

  it("regra desligada, etapa de ganho e negócio que não veio do cadastro: nada sai", async () => {
    for (const l of tabela("mia_regras_de_conversao_do_site")) l.enabled = false;
    expect((await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro))).detail).toBe("etapa_sem_regra_do_site");

    montar();
    tabela("mia_regras_de_conversao_do_site").push(regra("0b000000-0000-4000-8000-0000000000a9", ETAPA.ganho));
    expect((await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.ganho))).detail).toBe("etapa_invalida");

    montar();
    banco.db.mia_cadastro_na_time = [];
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(r.detail).toContain("sem_cadastro_do_site");
    expect(fetch).not.toHaveBeenCalled();
    // Sem atribuição não há pendência: nenhuma linha no livro-razão.
    expect(tabela("ad_conversion_dispatches")).toEqual([]);
  });

  it("Google só com o clique do Google guardado", async () => {
    tabela("mia_cadastro_na_time")[0]!.gclid = null;
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(r.detail).toContain("sem_clique_do_google");
    expect(idasAMeta()).toHaveLength(1);
    expect(idasAoGoogle()).toHaveLength(0);
  });

  it("⭐ `leva_valor`: Subscribe e Purchase levam o valor do negócio, o id do pedido e BRL; sem valor, pendência sem_valor", async () => {
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.assinante));
    expect(r.status, r.detail).toBe("ok");
    const eventos = idasAMeta().map((c) => corpo(c).data[0]);
    expect(eventos.map((e) => e.event_name).sort()).toEqual(["Purchase", "Subscribe"]);
    for (const e of eventos) expect(e.custom_data).toEqual({ value: 197, currency: "BRL", order_id: "pay_ficticio_1" });
    expect(livro(`MetaEtapa:${REGRA.purchase}`)).toMatchObject({ status: "sent", value_cents: 19700, currency: "BRL" });

    montar();
    tabela("crm_leads")[0]!.value_cents = null;
    fetch.mockClear();
    await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.assinante));
    expect(fetch).not.toHaveBeenCalled();
    expect(livro(`MetaEtapa:${REGRA.purchase}`)).toMatchObject({ status: "skipped", reason: "sem_valor" });
  });

  it("com META_TEST_EVENT_CODE o evento vai em teste e o livro-razão marca evento_de_teste", async () => {
    vi.stubEnv("META_TEST_EVENT_CODE", "TESTE123");
    await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(corpo(idasAMeta()[0]!).test_event_code).toBe("TESTE123");
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ status: "skipped", reason: "evento_de_teste" });
  });

  it("sem o dataset ou o token do site no ambiente: pendência site_sem_credencial, e a conexão da empresa NÃO é usada", async () => {
    vi.stubEnv("MIA_META_TOKEN_DO_SITE", "");
    await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(idasAMeta()).toHaveLength(0);
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ status: "skipped", reason: "site_sem_credencial" });
  });
});

describe("o reenvio pelo retrato, pelos consumidores do upstream", () => {
  it("⭐ `MetaEtapa:<id da regra>` reenvia pelo dataset do site, com o evento do retrato", async () => {
    tabela("ad_conversion_dispatches").push({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "meta_ads",
      event_name: `MetaEtapa:${REGRA.cadastroMeta}`,
      status: "error",
      reason: "reprocessamento_solicitado",
      event_occurred_at: MOVIMENTO,
      meta_event_name: "CompleteRegistration",
    });
    // A regra mudou de evento depois: o retrato vence.
    tabela("mia_regras_de_conversao_do_site")[0]!.evento_meta = "StartTrial";
    const pedido = movimento(ETAPA.cadastro, { event_type: "ad_conversion.retry_requested", payload: { event_name: `MetaEtapa:${REGRA.cadastroMeta}` } });

    // O da venda não pega o reenvio de etapa.
    expect((await conversaoDeVendaHandler.handle(pedido)).detail).toBe("outro_evento");
    // O nosso não escuta reenvio (senão mandaria duas vezes).
    expect(conversaoDeEtapaDoSiteHandler.events).toEqual(["lead.stage_changed"]);

    const r = await conversaoDeEtapaMetaHandler.handle(pedido);
    expect(r.status, r.detail).toBe("ok");
    expect(idasAMeta()).toHaveLength(1);
    expect(String(idasAMeta()[0]![0])).toContain(`/${DATASET_DO_SITE}/events`);
    expect(corpo(idasAMeta()[0]!).data[0].event_name).toBe("CompleteRegistration");
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ status: "sent" });
  });

  it("`Etapa:<id da regra>` reenvia ao Google com a ação do retrato", async () => {
    tabela("ad_conversion_dispatches").push({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "google_ads",
      event_name: `Etapa:${REGRA.cadastroGoogle}`,
      status: "error",
      reason: "reprocessamento_solicitado",
      event_occurred_at: MOVIMENTO,
      google_action_id: "7000000001",
    });
    const r = await conversaoDeQualificacaoHandler.handle(
      movimento(ETAPA.cadastro, { event_type: "ad_conversion.retry_requested", payload: { event_name: `Etapa:${REGRA.cadastroGoogle}` } }),
    );
    expect(r.status, r.detail).toBe("ok");
    expect(corpo(idasAoGoogle()[0]!).conversions[0].conversionAction).toBe("customers/1234567890/conversionActions/7000000001");
  });

  it("regra apagada com retrato de evento de site: não cai no transporte do upstream", async () => {
    tabela("ad_conversion_dispatches").push({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "meta_ads",
      event_name: `MetaEtapa:${REGRA.cadastroMeta}`,
      status: "error",
      event_occurred_at: MOVIMENTO,
      meta_event_name: "CompleteRegistration",
    });
    banco.db.mia_regras_de_conversao_do_site = [];
    const r = await conversaoDeEtapaMetaHandler.handle(
      movimento(ETAPA.cadastro, { event_type: "ad_conversion.retry_requested", payload: { event_name: `MetaEtapa:${REGRA.cadastroMeta}` } }),
    );
    expect(r.detail).toBe("regra_do_site_removida");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("⭐ outra empresa nunca usa a credencial da variável", () => {
  it("a regra e o cadastro gravados à mão em outra empresa ficam pendentes, e nada vai à Meta", async () => {
    montar(OUTRA);
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro, { organization_id: OUTRA }));
    expect(idasAMeta()).toHaveLength(0);
    expect(r.detail).toContain("site_fora_da_empresa_da_fonte");
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ organization_id: OUTRA, reason: "site_fora_da_empresa_da_fonte" });
  });

  it("a regra pura: só a empresa da fonte recebe a credencial; sem a fonte, ninguém", () => {
    const ambiente = { MIA_META_DATASET_DO_SITE: DATASET_DO_SITE, MIA_META_TOKEN_DO_SITE: "t" } as unknown as NodeJS.ProcessEnv;
    expect(credencialDaMetaDoSite(ORG, ORG, ambiente).ok).toBe(true);
    expect(credencialDaMetaDoSite(OUTRA, ORG, ambiente)).toEqual({ ok: false, motivo: "site_fora_da_empresa_da_fonte" });
    expect(credencialDaMetaDoSite(ORG, null, ambiente)).toEqual({ ok: false, motivo: "site_fora_da_empresa_da_fonte" });
    expect(credencialDaMetaDoSite(ORG, ORG, {} as NodeJS.ProcessEnv)).toEqual({ ok: false, motivo: "site_sem_credencial" });
  });

  it("sem CADASTRO_FONTE_DO_CRM, nem a empresa da Time usa", async () => {
    vi.stubEnv("CADASTRO_FONTE_DO_CRM", "");
    await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(idasAMeta()).toHaveLength(0);
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ reason: "site_fora_da_empresa_da_fonte" });
  });
});

describe("⭐ a empresa de demonstração não manda pela variável", () => {
  // O ramo da Meta do site não lê a conexão, então não passa pelo gatilho da
  // 9010: o motor pergunta à `fn_mia_e_demonstracao` antes de mandar.
  it("a fonte do cadastro apontando para uma empresa de demonstração: nada vai à Meta", async () => {
    demonstracao = true;
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(idasAMeta()).toHaveLength(0);
    expect(r.detail).toContain("site_empresa_de_demonstracao");
    expect(livro(`MetaEtapa:${REGRA.cadastroMeta}`)).toMatchObject({ status: "skipped", reason: "site_empresa_de_demonstracao" });
    expect(banco.chamadasRpc.some((c) => c.nome === "fn_mia_e_demonstracao")).toBe(true);
  });

  it("sem confirmar que a empresa é de verdade, também não manda, e tenta de novo", async () => {
    demonstracao = "erro";
    const r = await conversaoDeEtapaDoSiteHandler.handle(movimento(ETAPA.cadastro));
    expect(idasAMeta()).toHaveLength(0);
    expect(r.status).toBe("retry");
    expect(r.detail).toContain("site_demonstracao_nao_confirmada");
  });
});

describe("⭐ a guarda venda_pelo_site", () => {
  it("o negócio do cadastro ganho não manda o Purchase da venda; o negócio que não veio do cadastro segue o caminho de sempre", async () => {
    Object.assign(tabela("crm_leads")[0]!, { status: "won", closed_at: MOVIMENTO });
    tabela("contacts")[0]!.source_metadata = { ad_platform: "meta_ads", ad_source_id: "ctwa-ficticio" };
    const ganho = movimento(ETAPA.ganho, { event_type: "lead.won", payload: {} });

    const r = await conversaoDeVendaHandler.handle(ganho);
    expect(r.detail).toBe("venda_pelo_site");
    expect(fetch).not.toHaveBeenCalled();
    expect(tabela("ad_conversion_dispatches")).toEqual([]);

    banco.db.mia_cadastro_na_time = [];
    const sem = await conversaoDeVendaHandler.handle(ganho);
    expect(sem.detail).not.toBe("venda_pelo_site");
    // Segue para o caminho do upstream (aqui, sem conexão direta legível: pendência dele).
    expect(livro("Purchase")).toBeDefined();
  });
});

describe("o Google do site", () => {
  it("⭐ com `leva_valor` sai com o valor; com `somenteValidar` (só a ferramenta de teste) sai com validateOnly", async () => {
    const conversao = montarConversaoDoSite({
      organizationId: ORG,
      leadId: LEAD,
      evento: `Etapa:${REGRA.cadastroGoogle}`,
      ocorridoEm: new Date(MOVIMENTO),
      eventoMeta: null,
      valorCentavos: 19700,
      moeda: "BRL",
      telefone: null,
      email: null,
      nome: null,
      cadastro: { empresaClienteId: null, ip: null, navegador: null, pagina: null, fbp: null, fbc: null, consentimento: null, gclid: "gclid-ficticio", gbraid: null, wbraid: null, pedidoId: null },
      identificadoresGoogle: { gclid: "gclid-ficticio" },
    });
    const credencial = structuredClone(estado.google) as Parameters<typeof transporteGoogle.enviar>[0];
    credencial.google!.conversionActionId = "7000000004";

    await transporteGoogle.enviar(credencial, conversao);
    const normal = corpo(idasAoGoogle()[0]!);
    expect(normal.conversions[0]).toMatchObject({ conversionValue: 197, currencyCode: "BRL" });
    expect(normal).not.toHaveProperty("validateOnly");

    await transporteGoogle.enviar(credencial, { ...conversao, site: { ...conversao.site!, somenteValidar: true } });
    expect(corpo(idasAoGoogle()[1]!).validateOnly).toBe(true);
  });
});

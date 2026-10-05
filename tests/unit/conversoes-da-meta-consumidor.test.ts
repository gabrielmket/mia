/**
 * FORK MIA — O CONSUMIDOR da volta dos leads de formulário da Meta
 * (`lib/conversoes-meta/formulario.handler.ts`), e a regra da casa: um negócio
 * que muda de etapa gera NO MÁXIMO UM envio daquele evento para a Meta, com os
 * consumidores do upstream ligados ao lado.
 *
 * Desde a .72 a régua por etapa da Meta é a do upstream (0524,
 * `meta_ads_conversion_rules`). Este consumidor só age no negócio SEM atribuição
 * de anúncio que nasceu de um formulário da Meta, e escreve no mesmo livro-razão
 * com a mesma chave (`MetaEtapa:<uuid>`).
 *
 * As tabelas são de verdade, em memória (`tests/helpers/banco-em-memoria.ts`):
 * o teste mede O QUE FOI GRAVADO no livro-razão e O QUE SAIU no fio. A prova
 * contra o Postgres de verdade mora em
 * `tests/invariants/conversoes-da-meta-por-etapa.test.ts`.
 *
 * ⚠️ NUNCA fala com a Meta: `fetch` é um dublê que guarda o corpo enviado.
 *
 * Sem dado de ninguém: negócios fictícios, telefone +5500 (DDD que não existe).
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({
  cliente: null as unknown,
  credencial: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => estado.credencial }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { conversaoDoLeadDeFormularioHandler, CHAVE_DO_CONSUMIDOR_DE_FORMULARIO } = await import(
  "@/lib/conversoes-meta/formulario.handler"
);
const { conversaoDeEtapaMetaHandler } = await import("@/lib/conversoes/etapa-meta.handler");
const { conversaoDeVendaHandler } = await import("@/lib/conversoes/envio.handler");

const ORG = "0a000000-0000-4000-8000-000000000001";
const QUALIFICACAO = "0d000000-0000-4000-8000-000000000001";
const AGENDADA = "0d000000-0000-4000-8000-000000000002";
const GANHO = "0d000000-0000-4000-8000-000000000009";
const LEAD = "0e000000-0000-4000-8000-000000000001";
const CONTATO = "0f000000-0000-4000-8000-000000000001";
const ID_DO_LEAD_DA_META = "12345678901234567";

const AGORA = new Date("2026-10-01T12:00:00Z");
const REGRA_LIGADA_EM = "2026-09-25T00:00:00Z";
const CHAVE_LIGADA_EM = "2026-09-26T00:00:00Z";
const ENTROU_EM = "2026-09-30T15:00:00Z";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const DE_FORMULARIO = { ad_platform: "meta_ads", meta_lead_id: ID_DO_LEAD_DA_META };
const DE_CLIQUE = { ad_platform: "meta_ads", ad_source_id: "clique-ficticio" };
const DA_PAGINA = { ad_platform: "site", utm_source: "facebook" };

let banco: ReturnType<typeof bancoEmMemoria>;
let enviados: Array<{ url: string; corpo: Record<string, unknown> }>;
let respostas: Array<{ status: number; corpo: unknown }>;

function regra(stage: string, over: Linha = {}): Linha {
  return {
    id: `regra-${stage.slice(-1)}`,
    organization_id: ORG,
    stage_id: stage,
    event_name: `MetaEtapa:${stage}`,
    meta_event: "QualifiedLead",
    enabled: true,
    configured_at: REGRA_LIGADA_EM,
    ...over,
  };
}

function montar(
  opcoes: {
    regras?: Linha[];
    contato?: Linha;
    lead?: Linha;
    chave?: Linha | null;
    livro?: Linha[];
  } = {},
) {
  banco = bancoEmMemoria({
    meta_ads_conversion_rules: opcoes.regras ?? [regra(QUALIFICACAO)],
    mia_conversoes_meta_config:
      opcoes.chave === null
        ? []
        : [
            {
              organization_id: ORG,
              leads_de_formulario: true,
              leads_de_formulario_desde: CHAVE_LIGADA_EM,
              ...opcoes.chave,
            },
          ],
    crm_stages: [
      { id: QUALIFICACAO, organization_id: ORG, is_won: false, is_lost: false },
      { id: AGENDADA, organization_id: ORG, is_won: false, is_lost: false },
      { id: GANHO, organization_id: ORG, is_won: true, is_lost: false },
    ],
    crm_leads: [
      {
        id: LEAD,
        organization_id: ORG,
        status: "open",
        value_cents: null,
        currency: "BRL",
        closed_at: null,
        contact_id: CONTATO,
        source_metadata: DE_FORMULARIO,
        ...opcoes.lead,
      },
    ],
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        phone_number: "+55 00 90000-0001",
        email: "pessoa@exemplo.invalid",
        is_anonymized: false,
        // O contato do formulário traz a plataforma e NÃO traz clique: é o que
        // `lib/leads-da-meta/mapear.ts` grava (migration 9003).
        source_metadata: { ad_platform: "meta_ads", meta_lead_id: ID_DO_LEAD_DA_META },
        ...opcoes.contato,
      },
    ],
    ad_conversion_dispatches: opcoes.livro ?? [],
  });
  estado.cliente = banco.cliente;
}

function entrou(stage: string, over: Partial<EventRow> = {}): EventRow {
  return {
    id: "evento",
    entity_id: LEAD,
    entity_kind: "crm_lead",
    organization_id: ORG,
    event_type: "lead.stage_changed",
    payload: { to_stage_id: stage },
    metadata: {},
    attempts: 0,
    consumed_by: [],
    created_at: ENTROU_EM,
    ...over,
  };
}

const livro = () => banco.tabela("ad_conversion_dispatches");
const linhaDoLivro = (evento: string) => livro().find((l) => l.event_name === evento);
const itemEnviado = (i = 0) => (enviados[i]!.corpo.data as Array<Record<string, unknown>>)[0]!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  enviados = [];
  respostas = [];
  estado.credencial = {
    ok: true,
    credencial: {
      datasetId: "900000000000001",
      accessToken: "token-ficticio",
      testEventCode: null,
      meta: { pageId: "100000000000001", whatsappBusinessAccountId: null },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      enviados.push({ url: String(url), corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      const r = respostas.shift() ?? { status: 200, corpo: { events_received: 1 } };
      return new Response(JSON.stringify(r.corpo), { status: r.status });
    }),
  );
  montar();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o consumidor", () => {
  it("escuta a mudança de etapa, o ganho e o reenvio do upstream, e pula na organização parada", () => {
    expect(conversaoDoLeadDeFormularioHandler.key).toBe(CHAVE_DO_CONSUMIDOR_DE_FORMULARIO);
    expect(CHAVE_DO_CONSUMIDOR_DE_FORMULARIO).toBe("conversoes.meta_formulario");
    expect(conversaoDoLeadDeFormularioHandler.events).toEqual([
      "lead.stage_changed",
      "lead.won",
      "ad_conversion.retry_requested",
    ]);
    expect(conversaoDoLeadDeFormularioHandler.naOrgParada).toBe("pula");
  });
});

describe("⭐ o lead de formulário entra numa etapa com regra (a régua do upstream)", () => {
  it("a Meta recebe o evento da regra pela porta do CRM, com a data em que ele ENTROU na etapa", async () => {
    const r = await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO));
    expect(r).toMatchObject({ consumer_key: "conversoes.meta_formulario", status: "ok" });
    expect(enviados).toHaveLength(1);
    expect(itemEnviado()).toEqual({
      event_name: "QualifiedLead",
      event_time: Math.floor(Date.parse(ENTROU_EM) / 1000),
      // O MESMO `event_id` que o upstream usaria: `<leadId>:<evento no livro>`.
      event_id: `${LEAD}:MetaEtapa:${QUALIFICACAO}`,
      action_source: "system_generated",
      user_data: { ph: [sha("5500900000001")], em: [sha("pessoa@exemplo.invalid")], lead_id: ID_DO_LEAD_DA_META },
      custom_data: { event_source: "crm", lead_event_source: expect.any(String) },
    });
    // O id do lead vai como TEXTO: 17 dígitos passam de 2^53.
    expect(JSON.stringify(enviados[0]!.corpo)).toContain(`"lead_id":"${ID_DO_LEAD_DA_META}"`);
    expect(linhaDoLivro(`MetaEtapa:${QUALIFICACAO}`)).toMatchObject({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "meta_ads",
      status: "sent",
      reason: null,
      event_occurred_at: ENTROU_EM,
      meta_event_name: "QualifiedLead",
      value_cents: null,
    });
  });

  it("uma vez por negócio e etapa: sair e voltar não envia de novo", async () => {
    await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO));
    const outraVez = await conversaoDoLeadDeFormularioHandler.handle(
      entrou(QUALIFICACAO, { id: "evento-2", created_at: "2026-10-01T09:00:00Z" }),
    );
    expect(outraVez).toMatchObject({ status: "skipped", detail: "ja_enviada" });
    expect(enviados).toHaveLength(1);
    expect(livro()).toHaveLength(1);
  });

  it("etapa sem regra, ou com regra desligada, não envia nem grava nada", async () => {
    montar({ regras: [regra(QUALIFICACAO, { enabled: false })] });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "etapa_sem_regra_meta",
    });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(AGENDADA))).toMatchObject({
      detail: "etapa_sem_regra_meta",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("com a chave dos formulários desligada (o padrão), nada sai e nada vira pendência", async () => {
    montar({ chave: null });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "formulario_desligado",
    });
    montar({ chave: { leads_de_formulario: false, leads_de_formulario_desde: null } });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "formulario_desligado",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("ligar a regra ou a chave não envia o passado", async () => {
    montar({ regras: [regra(QUALIFICACAO, { configured_at: "2026-09-30T16:00:00Z" })] });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "anterior_a_configuracao",
    });
    montar({ chave: { leads_de_formulario_desde: "2026-09-30T16:00:00Z" } });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "anterior_a_chave",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("contato anonimizado não volta para a Meta pelo id de um formulário antigo", async () => {
    montar({ contato: { is_anonymized: true } });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "contato_anonimizado",
    });
    expect(enviados).toHaveLength(0);
  });

  it("negócio sem id de formulário não é deste consumidor", async () => {
    montar({ lead: { source_metadata: {} } });
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "sem_formulario",
    });
    expect(enviados).toHaveLength(0);
  });

  it("negócio com atribuição de anúncio (clique ou página) é dos consumidores do upstream: este sai de cena", async () => {
    for (const origem of [DE_CLIQUE, DA_PAGINA]) {
      montar({ contato: { source_metadata: origem } });
      expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
        status: "skipped",
        detail: "atribuicao_do_upstream",
      });
    }
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("sem conexão: a linha fica com o retrato e o motivo, e nada sai", async () => {
    estado.credencial = { ok: false, motivo: "sem_conexao" };
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "sem_conexao",
    });
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro(`MetaEtapa:${QUALIFICACAO}`)).toMatchObject({
      status: "skipped",
      reason: "sem_conexao",
      event_occurred_at: ENTROU_EM,
      meta_event_name: "QualifiedLead",
    });
  });

  it("modo de teste: a Meta recebe e a linha fica como não enviada, para sair de verdade depois", async () => {
    (estado.credencial as { credencial: { testEventCode: string | null } }).credencial.testEventCode = "TESTE123";
    expect(await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "evento_de_teste",
    });
    expect(enviados[0]!.corpo.test_event_code).toBe("TESTE123");
    expect(linhaDoLivro(`MetaEtapa:${QUALIFICACAO}`)).toMatchObject({ status: "skipped", reason: "evento_de_teste" });
  });

  it("recusa da Meta vira erro com a frase dela", async () => {
    respostas.push({ status: 400, corpo: { error: { code: 100, message: "Invalid parameter", error_user_msg: "Lead não encontrado" } } });
    await conversaoDoLeadDeFormularioHandler.handle(entrou(QUALIFICACAO));
    expect(linhaDoLivro(`MetaEtapa:${QUALIFICACAO}`)).toMatchObject({
      status: "error",
      reason: "recusado_pela_plataforma",
      detail: "Lead não encontrado",
    });
  });
});

describe("a venda do lead de formulário", () => {
  it("negócio ganho com valor: a compra vai pela porta do CRM, com o valor", async () => {
    montar({ lead: { status: "won", value_cents: 240000, closed_at: "2026-09-30T18:00:00Z" } });
    const r = await conversaoDoLeadDeFormularioHandler.handle(entrou(GANHO, { event_type: "lead.won", payload: {} }));
    expect(r).toMatchObject({ status: "ok" });
    expect(itemEnviado()).toMatchObject({
      event_name: "Purchase",
      event_id: `${LEAD}:Purchase`,
      action_source: "system_generated",
      custom_data: { value: 2400, currency: "BRL", event_source: "crm" },
    });
    expect(linhaDoLivro("Purchase")).toMatchObject({ status: "sent", platform: "meta_ads", value_cents: 240000 });
  });

  it("ganho sem valor vira a pendência de sempre (`sem_valor`), e nada sai", async () => {
    montar({ lead: { status: "won", closed_at: "2026-09-30T18:00:00Z" } });
    await conversaoDoLeadDeFormularioHandler.handle(entrou(GANHO, { event_type: "lead.won", payload: {} }));
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro("Purchase")).toMatchObject({ status: "skipped", reason: "sem_valor" });
  });

  it("a linha da compra de OUTRA plataforma é do consumidor de venda", async () => {
    montar({
      lead: { status: "won", value_cents: 240000, closed_at: "2026-09-30T18:00:00Z" },
      livro: [{ organization_id: ORG, lead_id: LEAD, event_name: "Purchase", platform: "google_ads", status: "skipped" }],
    });
    expect(
      await conversaoDoLeadDeFormularioHandler.handle(entrou(GANHO, { event_type: "lead.won", payload: {} })),
    ).toMatchObject({ detail: "venda_do_consumidor_de_venda" });
    expect(enviados).toHaveLength(0);
  });
});

describe("o reenvio (a função do upstream, `MetaEtapa:<uuid>`)", () => {
  const PEDIDO = (evento: string): EventRow =>
    entrou(QUALIFICACAO, { event_type: "ad_conversion.retry_requested", payload: { event_name: evento } });

  it("reenvia com o RETRATO do primeiro envio, e não com a regra de agora", async () => {
    montar({
      // A etapa trocou de evento depois; o retrato diz que saiu LeadSubmitted.
      regras: [regra(QUALIFICACAO, { meta_event: "InitiateCheckout" })],
      livro: [
        {
          organization_id: ORG,
          lead_id: LEAD,
          event_name: `MetaEtapa:${QUALIFICACAO}`,
          platform: "meta_ads",
          status: "skipped",
          reason: "reprocessamento_solicitado",
          event_occurred_at: ENTROU_EM,
          meta_event_name: "LeadSubmitted",
        },
      ],
    });
    expect(await conversaoDoLeadDeFormularioHandler.handle(PEDIDO(`MetaEtapa:${QUALIFICACAO}`))).toMatchObject({
      status: "ok",
    });
    expect(itemEnviado()).toMatchObject({
      event_name: "LeadSubmitted",
      event_time: Math.floor(Date.parse(ENTROU_EM) / 1000),
    });
  });

  it("com a chave desligada desde então, a linha deixa de dizer 'reprocessamento agendado' e diz por quê", async () => {
    montar({
      chave: { leads_de_formulario: false, leads_de_formulario_desde: null },
      livro: [
        {
          organization_id: ORG,
          lead_id: LEAD,
          event_name: `MetaEtapa:${QUALIFICACAO}`,
          platform: "meta_ads",
          status: "skipped",
          reason: "reprocessamento_solicitado",
          event_occurred_at: ENTROU_EM,
          meta_event_name: "QualifiedLead",
        },
      ],
    });
    expect(await conversaoDoLeadDeFormularioHandler.handle(PEDIDO(`MetaEtapa:${QUALIFICACAO}`))).toMatchObject({
      detail: "formulario_desligado",
    });
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro(`MetaEtapa:${QUALIFICACAO}`)).toMatchObject({
      status: "skipped",
      reason: "sem_atribuicao",
      detail: "A volta dos leads de formulário da Meta está desligada nesta empresa.",
    });
  });

  it("evento do Google não é deste consumidor", async () => {
    expect(
      await conversaoDoLeadDeFormularioHandler.handle(PEDIDO("Etapa:0d000000-0000-4000-8000-000000000001")),
    ).toMatchObject({ detail: "outro_evento" });
  });
});

/**
 * ⭐ A REGRA DA CASA: um movimento de etapa, uma ida só à Meta.
 *
 * Os três consumidores que escutam `lead.stage_changed` e podem falar com a
 * Meta rodam juntos sobre o MESMO banco, como o dreno os rodaria: o de etapa e o
 * de venda do upstream, e o nosso dos formulários. Para cada origem do negócio,
 * conta-se quantas requisições saíram para a Meta.
 */
describe("⭐ um movimento de etapa gera no máximo UM envio daquele evento à Meta", () => {
  const consumidores = () => [conversaoDeEtapaMetaHandler, conversaoDeVendaHandler, conversaoDoLeadDeFormularioHandler];
  const idasAMeta = () => enviados.filter((e) => /\/events$/.test(e.url));

  async function moverPelosTres(row: EventRow) {
    for (const c of consumidores()) await c.handle(row);
  }

  it.each([
    ["clique em anúncio para o WhatsApp", { contato: { source_metadata: DE_CLIQUE } }, "business_messaging"],
    ["página com UTM da Meta (#2076)", { contato: { source_metadata: DA_PAGINA } }, "system_generated"],
    ["formulário da Meta (só a MIA informa)", {}, "system_generated"],
    [
      "formulário E clique: vence a atribuição do upstream",
      { contato: { source_metadata: DE_CLIQUE } },
      "business_messaging",
    ],
  ] as const)("%s", async (_nome, opcoes, porta) => {
    montar(opcoes);
    await moverPelosTres(entrou(QUALIFICACAO));
    expect(idasAMeta()).toHaveLength(1);
    expect(itemEnviado().event_name).toBe("QualifiedLead");
    expect(itemEnviado().event_id).toBe(`${LEAD}:MetaEtapa:${QUALIFICACAO}`);
    expect(itemEnviado().action_source).toBe(porta);
    expect(livro().filter((l) => l.event_name === `MetaEtapa:${QUALIFICACAO}`)).toHaveLength(1);

    // E o mesmo movimento entregue de novo (o dreno reentrega, alguém sai e volta):
    // nenhuma ida a mais.
    await moverPelosTres(entrou(QUALIFICACAO, { id: "evento-2", created_at: "2026-10-01T09:00:00Z" }));
    expect(idasAMeta()).toHaveLength(1);
  });

  it("negócio orgânico (sem anúncio nem formulário): ninguém fala com a Meta", async () => {
    montar({ contato: { source_metadata: {} }, lead: { source_metadata: {} } });
    await moverPelosTres(entrou(QUALIFICACAO));
    expect(idasAMeta()).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("a venda do formulário arrastada para o ganho também sai uma vez só", async () => {
    montar({ lead: { status: "won", value_cents: 240000, closed_at: "2026-09-30T18:00:00Z" } });
    await moverPelosTres(entrou(GANHO));
    await moverPelosTres(entrou(GANHO, { event_type: "lead.won", payload: {} }));
    expect(idasAMeta()).toHaveLength(1);
    expect(itemEnviado().event_name).toBe("Purchase");
  });
});

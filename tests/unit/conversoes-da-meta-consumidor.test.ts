/**
 * FORK MIA (9017) — O CONSUMIDOR das conversões da Meta por etapa do funil, e da
 * venda do lead de formulário (`lib/conversoes-meta/etapa.handler.ts`).
 *
 * As tabelas são de verdade, em memória (`tests/helpers/banco-em-memoria.ts`):
 * o teste mede O QUE FOI GRAVADO no livro-razão e O QUE SAIU no fio, e não o que
 * o resultado diz. A prova contra o Postgres de verdade (gatilhos, CHECK, a
 * função do reenvio, a trava da demonstração) mora em
 * `tests/invariants/conversoes-da-meta-por-etapa.test.ts`.
 *
 * ⚠️ NUNCA fala com a Meta: `fetch` é um dublê que guarda o corpo enviado.
 *
 * Sem dado de ninguém: negócios fictícios, telefone +5500 (DDD que não existe).
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { branding } from "@/lib/branding";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({
  cliente: null as unknown,
  credencial: { ok: true, credencial: { datasetId: "900000000000001", accessToken: "token-ficticio", testEventCode: null } } as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => estado.credencial }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { conversaoDeEtapaDaMetaHandler, EVENTO_DE_REENVIO_DA_META } = await import("@/lib/conversoes-meta/etapa.handler");

const ORG = "0a000000-0000-4000-8000-000000000001";
const OUTRA_ORG = "0a000000-0000-4000-8000-000000000002";
const QUALIFICACAO = "0d000000-0000-4000-8000-000000000001";
const AGENDADA = "0d000000-0000-4000-8000-000000000002";
const COMPARECEU = "0d000000-0000-4000-8000-000000000003";
const GANHO = "0d000000-0000-4000-8000-000000000009";
const LEAD = "0e000000-0000-4000-8000-000000000001";
const CONTATO = "0f000000-0000-4000-8000-000000000001";

const AGORA = new Date("2026-10-01T12:00:00Z");
const REGRA_LIGADA_EM = "2026-09-25T00:00:00Z";
const ENTROU_EM = "2026-09-30T15:00:00Z";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

let banco: ReturnType<typeof bancoEmMemoria>;
let enviados: Array<Record<string, unknown>>;
let respostas: Array<{ status: number; corpo: unknown }>;

function regra(stage: string, over: Linha = {}): Linha {
  return {
    id: `regra-${stage.slice(-1)}`,
    organization_id: ORG,
    stage_id: stage,
    evento: "lead_qualificado",
    canal: "todos",
    modo_do_valor: "sem_valor",
    valor_fixo_centavos: null,
    ligada: true,
    configurada_em: REGRA_LIGADA_EM,
    ...over,
  };
}

/** O negócio veio de clique em anúncio da Meta para o WhatsApp. */
const DE_CLIQUE = { ad_platform: "meta_ads", ad_source_id: "clique-ficticio" };

function montar(opcoes: { regras?: Linha[]; contato?: Linha; lead?: Linha; chave?: Linha | null; links?: Linha[] } = {}) {
  banco = bancoEmMemoria({
    mia_conversoes_meta_regras: opcoes.regras ?? [regra(QUALIFICACAO)],
    mia_conversoes_meta_config: opcoes.chave ? [{ organization_id: ORG, ...opcoes.chave }] : [],
    crm_stages: [
      { id: QUALIFICACAO, organization_id: ORG, is_won: false, is_lost: false },
      { id: AGENDADA, organization_id: ORG, is_won: false, is_lost: false },
      { id: COMPARECEU, organization_id: ORG, is_won: false, is_lost: false },
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
        source_metadata: {},
        ...opcoes.lead,
      },
    ],
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        phone_number: "+55 00 90000-0001",
        email: null,
        is_anonymized: false,
        source_metadata: DE_CLIQUE,
        ...opcoes.contato,
      },
    ],
    crm_lead_links: opcoes.links ?? [],
    ad_conversion_dispatches: [],
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
const itemEnviado = (i = 0) => (enviados[i]!.data as Array<Record<string, unknown>>)[0]!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  enviados = [];
  respostas = [];
  estado.credencial = {
    ok: true,
    credencial: { datasetId: "900000000000001", accessToken: "token-ficticio", testEventCode: null },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      enviados.push(JSON.parse(String(init.body)) as Record<string, unknown>);
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

describe("o consumidor escuta os mesmos eventos dos dois do upstream", () => {
  it("mudança de etapa, ganho, o reenvio do upstream e o reenvio dos eventos de etapa", () => {
    expect(conversaoDeEtapaDaMetaHandler.key).toBe("conversoes.meta_etapa");
    expect(conversaoDeEtapaDaMetaHandler.events).toEqual([
      "lead.stage_changed",
      "lead.won",
      "ad_conversion.retry_requested",
      "conversao_meta.retry_requested",
    ]);
    expect(EVENTO_DE_REENVIO_DA_META).toBe("conversao_meta.retry_requested");
  });
});

describe("⭐ o negócio de clique em anúncio entra numa etapa com regra", () => {
  it("a Meta recebe o evento, pela porta de mensagens de negócio, com a data em que ele ENTROU na etapa", async () => {
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(r).toMatchObject({ consumer_key: "conversoes.meta_etapa", status: "ok" });
    expect(enviados).toHaveLength(1);
    expect(itemEnviado()).toEqual({
      event_name: "QualifiedLead",
      event_time: Math.floor(Date.parse(ENTROU_EM) / 1000),
      event_id: `${LEAD}:Meta:lead_qualificado`,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { ctwa_clid: "clique-ficticio", ph: [sha("5500900000001")] },
    });
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "meta_ads",
      status: "sent",
      reason: null,
      event_occurred_at: ENTROU_EM,
      value_cents: null,
    });
  });

  it("⭐ uma vez por negócio e evento: sair e voltar à etapa não envia de novo", async () => {
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    const outraVez = await conversaoDeEtapaDaMetaHandler.handle(
      entrou(QUALIFICACAO, { id: "evento-2", created_at: "2026-10-01T09:00:00Z" }),
    );
    expect(outraVez).toMatchObject({ status: "skipped", detail: "ja_enviada" });
    expect(enviados).toHaveLength(1);
    expect(livro()).toHaveLength(1);
  });

  it("⭐ o mesmo evento em duas etapas só sai na primeira", async () => {
    montar({ regras: [regra(QUALIFICACAO), regra(COMPARECEU)] });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    const naSegunda = await conversaoDeEtapaDaMetaHandler.handle(
      entrou(COMPARECEU, { id: "evento-2", created_at: "2026-10-01T09:00:00Z" }),
    );
    expect(naSegunda).toMatchObject({ status: "skipped", detail: "ja_enviada" });
    expect(enviados).toHaveLength(1);
  });

  it("eventos diferentes em etapas diferentes: cada um sai uma vez", async () => {
    montar({ regras: [regra(QUALIFICACAO), regra(AGENDADA, { evento: "agendou" })] });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    await conversaoDeEtapaDaMetaHandler.handle(entrou(AGENDADA, { id: "evento-2", created_at: "2026-10-01T09:00:00Z" }));
    expect(enviados.map((_, i) => itemEnviado(i).event_name)).toEqual(["QualifiedLead", "Schedule"]);
    expect(livro().map((l) => [l.event_name, l.status])).toEqual([
      ["Meta:lead_qualificado", "sent"],
      ["Meta:agendou", "sent"],
    ]);
  });
});

describe("⭐ as travas", () => {
  it("regra desligada, ou etapa sem regra: nada sai e nada é gravado", async () => {
    montar({ regras: [regra(QUALIFICACAO, { ligada: false })] });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "etapa_sem_regra",
    });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(AGENDADA))).toMatchObject({ detail: "etapa_sem_regra" });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  it("ligar a regra não envia o passado: o movimento anterior fica registrado como decisão", async () => {
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO, { created_at: "2026-09-20T09:30:00Z" }));
    expect(r).toMatchObject({ status: "skipped", detail: "anterior_a_regra" });
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "skipped", reason: "anterior_a_regra" });
  });

  it("e a decisão não prende o negócio: um movimento novo, depois da regra, é evento novo", async () => {
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO, { created_at: "2026-09-20T09:30:00Z" }));
    const depois = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO, { id: "evento-2" }));
    expect(depois.status).toBe("ok");
    expect(itemEnviado().event_time).toBe(Math.floor(Date.parse(ENTROU_EM) / 1000));
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "sent", event_occurred_at: ENTROU_EM });
  });

  it("canal de entrada: \"só WhatsApp\" exige conversa vinculada; \"só fora\" exige não ter", async () => {
    montar({ regras: [regra(QUALIFICACAO, { canal: "whatsapp" })] });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "canal_fora_da_regra",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);

    montar({
      regras: [regra(QUALIFICACAO, { canal: "whatsapp" })],
      links: [{ id: "v", organization_id: ORG, lead_id: LEAD, target_kind: "conversation" }],
    });
    expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).status).toBe("ok");

    montar({
      regras: [regra(QUALIFICACAO, { canal: "outros" })],
      links: [{ id: "v", organization_id: ORG, lead_id: LEAD, target_kind: "conversation" }],
    });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "canal_fora_da_regra",
    });
  });

  it("etapa de ganho, de perda ou de outra organização não é etapa da régua", async () => {
    montar({ regras: [regra(GANHO)] });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(GANHO))).toMatchObject({ detail: "etapa_invalida" });
    expect(enviados).toHaveLength(0);

    montar();
    const deFora = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO, { organization_id: OUTRA_ORG }));
    expect(deFora).toMatchObject({ status: "skipped", detail: "etapa_sem_regra" });
    expect(enviados).toHaveLength(0);
  });

  it("negócio que não veio da Meta (orgânico, ou do Google): nada sai e o livro não ganha ruído", async () => {
    montar({ contato: { source_metadata: {} } });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "sem_origem_na_meta",
    });
    montar({ contato: { source_metadata: { ad_platform: "google_ads", ad_source_id: "gclid-ficticio" } } });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "sem_origem_na_meta",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });
});

describe("⭐ o valor do evento", () => {
  it("valor fixo: os reais da regra, com a moeda do negócio", async () => {
    montar({ regras: [regra(AGENDADA, { evento: "agendou", modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000 })] });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(AGENDADA));
    expect(itemEnviado().custom_data).toEqual({ value: 150, currency: "BRL" });
    expect(linhaDoLivro("Meta:agendou")).toMatchObject({ status: "sent", value_cents: 15000, currency: "BRL" });
  });

  it("valor do negócio: o valor que o negócio tem na hora", async () => {
    montar({
      regras: [regra(QUALIFICACAO, { modo_do_valor: "valor_do_negocio" })],
      lead: { value_cents: 240000 },
    });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(itemEnviado().custom_data).toEqual({ value: 2400, currency: "BRL" });
  });

  it("valor do negócio num negócio SEM valor: o evento de etapa sai, sem valor", async () => {
    montar({ regras: [regra(QUALIFICACAO, { modo_do_valor: "valor_do_negocio" })] });
    expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).status).toBe("ok");
    expect(itemEnviado()).not.toHaveProperty("custom_data");
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "sent", value_cents: null });
  });

  it("sem valor é o padrão: nada de valor, mesmo com o negócio valendo", async () => {
    montar({ lead: { value_cents: 240000 } });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(itemEnviado()).not.toHaveProperty("custom_data");
  });
});

describe("a conexão e o modo de teste", () => {
  it("⭐ empresa sem conexão ligada (a de demonstração, por exemplo): nada sai, e o livro diz por quê", async () => {
    for (const motivo of ["sem_conexao", "conexao_desabilitada", "credencial_incompleta", "cifra_indisponivel"]) {
      montar();
      estado.credencial = { ok: false, motivo };
      expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
        status: "skipped",
        detail: motivo,
      });
      expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({
        status: "skipped",
        reason: motivo,
        event_occurred_at: ENTROU_EM,
      });
    }
    expect(enviados).toHaveLength(0);
  });

  it("a chave de vendas desligada pausa as etapas também, como no Google; religada, o reenvio usa o retrato", async () => {
    montar({ regras: [regra(AGENDADA, { evento: "agendou", modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000 })] });
    estado.credencial = { ok: false, motivo: "conexao_desabilitada" };
    await conversaoDeEtapaDaMetaHandler.handle(entrou(AGENDADA));
    expect(enviados).toHaveLength(0);

    // A conexão volta, e a regra MUDOU de valor nesse meio-tempo.
    estado.credencial = { ok: true, credencial: { datasetId: "900000000000001", accessToken: "token-ficticio", testEventCode: null } };
    banco.tabela("mia_conversoes_meta_regras")[0]!.valor_fixo_centavos = 99900;
    const reenvio = await conversaoDeEtapaDaMetaHandler.handle(
      entrou(AGENDADA, {
        id: "reenvio",
        event_type: "conversao_meta.retry_requested",
        payload: { event_name: "Meta:agendou" },
        created_at: "2026-10-01T11:00:00Z",
      }),
    );
    expect(reenvio.status).toBe("ok");
    // ⭐ O retrato do primeiro envio: a data em que entrou e o valor daquele dia.
    expect(itemEnviado().event_time).toBe(Math.floor(Date.parse(ENTROU_EM) / 1000));
    expect(itemEnviado().custom_data).toEqual({ value: 150, currency: "BRL" });
    expect(linhaDoLivro("Meta:agendou")).toMatchObject({ status: "sent", value_cents: 15000, event_occurred_at: ENTROU_EM });
  });

  it("leitura da conexão indisponível: tenta de novo depois, sem gravar desfecho", async () => {
    estado.credencial = { ok: false, motivo: "leitura_indisponivel" };
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(r.status).toBe("retry");
    expect(r.retry_at).toBeTruthy();
    expect(enviados).toHaveLength(0);
  });

  it("o código de teste marca também os eventos de etapa, e o evento não conta como enviado", async () => {
    estado.credencial = {
      ok: true,
      credencial: { datasetId: "900000000000001", accessToken: "token-ficticio", testEventCode: "TESTE12345" },
    };
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "evento_de_teste",
    });
    expect(enviados[0]!.test_event_code).toBe("TESTE12345");
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "skipped", reason: "evento_de_teste" });
  });

  it("a Meta recusa: fica recusado, com o motivo dela; fora do ar: nova tentativa", async () => {
    respostas.push({ status: 400, corpo: { error: { code: 100, message: "Nome de evento não reconhecido" } } });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "recusado_pela_plataforma",
    });
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({
      status: "error",
      reason: "recusado_pela_plataforma",
      detail: "Nome de evento não reconhecido",
    });

    montar();
    respostas.push({ status: 503, corpo: "fora do ar" });
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(r.status).toBe("retry");
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "skipped", reason: "nova_tentativa_agendada" });
  });

  it("o reenvio só vale para o que tem retrato: decisão das travas e evento desconhecido não são reenviados", async () => {
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO, { created_at: "2026-09-20T09:30:00Z" }));
    const reenvio = (nome: unknown) =>
      conversaoDeEtapaDaMetaHandler.handle(
        entrou(QUALIFICACAO, { event_type: "conversao_meta.retry_requested", payload: { event_name: nome } }),
      );
    expect(await reenvio("Meta:lead_qualificado")).toMatchObject({ detail: "sem_retrato_registrado" });
    expect(await reenvio("Meta:agendou")).toMatchObject({ detail: "sem_retrato_registrado" });
    expect(await reenvio("Etapa:11111111-1111-4111-8111-111111111111")).toMatchObject({ detail: "outro_evento" });
    expect(await reenvio("Purchase")).toMatchObject({ detail: "outro_evento" });
    expect(enviados).toHaveLength(0);
  });

  it("falha de banco no meio vira nova tentativa, nunca um envio às cegas", async () => {
    estado.cliente = {
      from: () => {
        throw new Error("banco fora");
      },
    };
    const r = await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(r).toMatchObject({ consumer_key: "conversoes.meta_etapa", status: "retry" });
    expect(enviados).toHaveLength(0);
  });
});

describe("⭐ o lead de formulário da Meta", () => {
  const ID_DO_LEAD = "1234567890123456";
  /** O negócio nasceu de um formulário da Meta: o id do lead mora na origem do negócio, e não há clique. */
  const DE_FORMULARIO = {
    lead: { source_metadata: { ad_platform: "meta_ads", meta_lead_id: ID_DO_LEAD } },
    contato: { source_metadata: { ad_platform: "meta_ads" }, email: "pessoa@exemplo.invalid" },
  };

  it("com a chave desligada (o padrão): nada sai, e o livro diz que foi por isso", async () => {
    montar(DE_FORMULARIO);
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "formulario_desligado",
    });
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ status: "skipped", reason: "formulario_desligado" });
  });

  it("com a chave ligada: o evento vai pela porta do CRM, com o id do lead guardado", async () => {
    montar({ ...DE_FORMULARIO, chave: { leads_de_formulario: true, leads_de_formulario_desde: "2026-09-26T00:00:00Z" } });
    expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).status).toBe("ok");
    expect(itemEnviado()).toEqual({
      event_name: "QualifiedLead",
      event_time: Math.floor(Date.parse(ENTROU_EM) / 1000),
      event_id: `${LEAD}:Meta:lead_qualificado`,
      action_source: "system_generated",
      user_data: {
        lead_id: ID_DO_LEAD,
        ph: [sha("5500900000001")],
        em: [sha("pessoa@exemplo.invalid")],
      },
      custom_data: { event_source: "crm", lead_event_source: branding().name },
    });
    expect(itemEnviado()).not.toHaveProperty("messaging_channel");
  });

  it("ligar a chave não envia o passado", async () => {
    montar({ ...DE_FORMULARIO, chave: { leads_de_formulario: true, leads_de_formulario_desde: "2026-10-01T10:00:00Z" } });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      status: "skipped",
      detail: "anterior_a_chave",
    });
    expect(enviados).toHaveLength(0);
    expect(linhaDoLivro("Meta:lead_qualificado")).toMatchObject({ reason: "anterior_a_chave" });
  });

  it("o clique vence o formulário: quem tem os dois vai pela porta de mensagens", async () => {
    montar({
      lead: DE_FORMULARIO.lead,
      chave: { leads_de_formulario: true, leads_de_formulario_desde: "2026-09-26T00:00:00Z" },
    });
    await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO));
    expect(itemEnviado().action_source).toBe("business_messaging");
  });

  it("contato anonimizado não volta para a Meta pelo id de um formulário antigo", async () => {
    montar({
      lead: DE_FORMULARIO.lead,
      contato: { source_metadata: {}, is_anonymized: true },
      chave: { leads_de_formulario: true, leads_de_formulario_desde: "2026-09-26T00:00:00Z" },
    });
    expect(await conversaoDeEtapaDaMetaHandler.handle(entrou(QUALIFICACAO))).toMatchObject({
      detail: "sem_origem_na_meta",
    });
    expect(enviados).toHaveLength(0);
    expect(livro()).toHaveLength(0);
  });

  describe("a venda", () => {
    const ganhou = (over: Partial<EventRow> = {}) =>
      entrou(GANHO, { event_type: "lead.won", payload: {}, created_at: "2026-10-01T10:00:00Z", ...over });
    const VENDIDO = { status: "won", closed_at: "2026-10-01T10:00:00Z", value_cents: 240000 };
    const CHAVE = { leads_de_formulario: true, leads_de_formulario_desde: "2026-09-26T00:00:00Z" };

    it("⭐ com a chave ligada, a Meta fica sabendo da venda do lead de formulário, com valor e moeda", async () => {
      montar({ lead: { ...DE_FORMULARIO.lead, ...VENDIDO }, contato: DE_FORMULARIO.contato, chave: CHAVE });
      expect((await conversaoDeEtapaDaMetaHandler.handle(ganhou())).status).toBe("ok");
      expect(itemEnviado()).toMatchObject({
        event_name: "Purchase",
        event_time: Math.floor(Date.parse("2026-10-01T10:00:00Z") / 1000),
        event_id: `${LEAD}:Purchase`,
        action_source: "system_generated",
        custom_data: { value: 2400, currency: "BRL", event_source: "crm", lead_event_source: branding().name },
      });
      expect((itemEnviado().user_data as Record<string, unknown>).lead_id).toBe(ID_DO_LEAD);
      expect(linhaDoLivro("Purchase")).toMatchObject({ platform: "meta_ads", status: "sent", value_cents: 240000 });
    });

    it("a venda arrastada no quadro (mudança de etapa para o ganho) também conta, e só uma vez", async () => {
      montar({ lead: { ...DE_FORMULARIO.lead, ...VENDIDO }, contato: DE_FORMULARIO.contato, chave: CHAVE });
      expect((await conversaoDeEtapaDaMetaHandler.handle(entrou(GANHO, { created_at: "2026-10-01T10:00:00Z" }))).status).toBe("ok");
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou({ id: "de-novo" }))).toMatchObject({ detail: "ja_enviada" });
      expect(enviados).toHaveLength(1);
    });

    it("a compra continua exigindo valor", async () => {
      montar({ lead: { ...DE_FORMULARIO.lead, ...VENDIDO, value_cents: null }, contato: DE_FORMULARIO.contato, chave: CHAVE });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({ status: "skipped", detail: "sem_valor" });
      expect(enviados).toHaveLength(0);
      expect(linhaDoLivro("Purchase")).toMatchObject({ status: "skipped", reason: "sem_valor" });

      // Preenchido o valor, o reenvio do upstream manda a venda.
      banco.tabela("crm_leads")[0]!.value_cents = 240000;
      const reenvio = await conversaoDeEtapaDaMetaHandler.handle(
        ganhou({ event_type: "ad_conversion.retry_requested", payload: { event_name: "Purchase" } }),
      );
      expect(reenvio.status).toBe("ok");
      expect(linhaDoLivro("Purchase")).toMatchObject({ status: "sent", value_cents: 240000 });
    });

    it("com a chave desligada, ou venda anterior à chave: não sai", async () => {
      montar({ lead: { ...DE_FORMULARIO.lead, ...VENDIDO }, contato: DE_FORMULARIO.contato });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({ detail: "formulario_desligado" });
      montar({
        lead: { ...DE_FORMULARIO.lead, ...VENDIDO },
        contato: DE_FORMULARIO.contato,
        chave: { leads_de_formulario: true, leads_de_formulario_desde: "2026-10-01T11:00:00Z" },
      });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({ detail: "anterior_a_chave" });
      expect(enviados).toHaveLength(0);
    });

    it("⭐ a venda de quem veio de CLIQUE é do consumidor de venda do upstream: este não toca nela", async () => {
      montar({ lead: { ...VENDIDO }, chave: CHAVE });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({
        status: "skipped",
        detail: "venda_do_consumidor_de_venda",
      });
      expect(enviados).toHaveLength(0);
      expect(livro()).toHaveLength(0);
    });

    it("negócio que não é ganho, e venda orgânica: nada sai, nada é gravado", async () => {
      montar({ lead: DE_FORMULARIO.lead, contato: DE_FORMULARIO.contato, chave: CHAVE });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({ detail: "nao_e_ganho" });
      montar({ lead: VENDIDO, contato: { source_metadata: {} }, chave: CHAVE });
      expect(await conversaoDeEtapaDaMetaHandler.handle(ganhou())).toMatchObject({ detail: "sem_origem_na_meta" });
      expect(enviados).toHaveLength(0);
      expect(livro()).toHaveLength(0);
    });

    it("o reenvio de um evento de etapa do Google não é assunto deste consumidor", async () => {
      montar({ lead: { ...DE_FORMULARIO.lead, ...VENDIDO }, contato: DE_FORMULARIO.contato, chave: CHAVE });
      const r = await conversaoDeEtapaDaMetaHandler.handle(
        ganhou({ event_type: "ad_conversion.retry_requested", payload: { event_name: "QualifiedLead" } }),
      );
      expect(r).toMatchObject({ status: "skipped", detail: "outro_evento" });
      expect(enviados).toHaveLength(0);
    });
  });
});

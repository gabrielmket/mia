/**
 * FORK MIA (MIA-369) — OS TRÊS CRONS DE AUTOMAÇÃO POR TEMPO LEEM TUDO, NÃO AS
 * PRIMEIRAS 1000 LINHAS.
 *
 * `contact-birthdays`, `lead-date-field-due` e `lead-time-triggers` liam as
 * regras ativas da instalação, e os dois últimos a trava do `event_log`, sem
 * `range`. O PostgREST corta toda resposta em 1000 linhas sem avisar: a regra
 * fora da página nunca disparava, e o aviso anterior fora da página parecia
 * não dado, então o mesmo aviso saía DUAS vezes. Cada caso abaixo foi escrito
 * para REPROVAR com a leitura antiga (conferido no PR) e passar com a nova, que
 * lê página a página por `lerTodasAsPaginas`.
 *
 * O banco é o dublê que corta como o de verdade
 * (`tests/helpers/postgrest-com-teto.ts`): um dublê que devolvesse tudo deixaria
 * a forma antiga passar verde. O que dispara depois do evento (o motor de
 * regras) fica de fora: aqui só se mede a leitura e o `emit_event`.
 *
 * Dado fictício: a Academia Alfa e a Academia Beta.
 *
 *     npx vitest run tests/unit/crons-de-automacao-por-tempo-leem-tudo.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  postgrestComTeto,
  type Linha,
  type OpcoesDoDuble,
  type PostgrestComTeto,
} from "@/tests/helpers/postgrest-com-teto";

const h = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET as aniversarios } from "@/app/api/v1/cron/contact-birthdays/route";
import { GET as dataDoFunil } from "@/app/api/v1/cron/lead-date-field-due/route";
import { GET as gatilhosDeTempo } from "@/app/api/v1/cron/lead-time-triggers/route";

const ACADEMIA_ALFA = "aaaaaaaa-0000-4000-8000-000000000001";
const ACADEMIA_BETA = "bbbbbbbb-0000-4000-8000-000000000002";
const FUNIL_ALFA = "aaaaaaaa-0000-4000-8000-0000000000f1";

/** 12:00 UTC é 09:00 em São Paulo, a hora das varreduras de data; em Tóquio são 21:00. */
const AS_NOVE_EM_SP = new Date("2026-09-14T12:00:00.000Z");
const DIA = 86_400_000;

const pad = (n: number, w = 6) => String(n).padStart(w, "0");
const haDias = (dias: number) => new Date(AS_NOVE_EM_SP.getTime() - dias * DIA).toISOString();

const organizacoes: Linha[] = [
  { id: ACADEMIA_ALFA, timezone: "America/Sao_Paulo" },
  // A Beta não está na hora marcada: as regras dela são só volume na leitura.
  { id: ACADEMIA_BETA, timezone: "Asia/Tokyo" },
];

/** O `emit_event` do banco: grava no `event_log`, com a hora, para a rodada seguinte ver. */
const emitEvent: OpcoesDoDuble["rpc"] = (nome, args, tabelas) => {
  if (nome !== "emit_event") return { data: null, error: { message: `rpc ${nome} não dublada` } };
  (tabelas.event_log ??= []).push({
    id: `evento-emitido-${pad((tabelas.event_log ?? []).length)}`,
    organization_id: args.p_organization_id,
    event_type: args.p_event_type,
    entity_kind: args.p_entity_kind,
    entity_id: args.p_entity_id,
    payload: args.p_payload,
    created_at: new Date().toISOString(),
  });
  return { data: null, error: null };
};

function banco(tabelas: Record<string, Linha[]>, opcoes: OpcoesDoDuble = {}): PostgrestComTeto {
  const b = postgrestComTeto({ event_log: [], ...tabelas }, { rpc: emitEvent, ...opcoes });
  h.admin.mockReturnValue(b.cliente);
  return b;
}

/** `n` regras ativas da Academia Beta, gravadas ANTES (e com id antes) da regra da Alfa. */
function regrasDaBeta(n: number, trigger_event: string, trigger_config: unknown): Linha[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `regra-beta-${pad(i)}`,
    organization_id: ACADEMIA_BETA,
    trigger_event,
    trigger_config,
    is_active: true,
  }));
}

const emitidos = (b: PostgrestComTeto, tipo: string) =>
  (b.tabelas.event_log ?? []).filter((e) => e.event_type === tipo && String(e.id).startsWith("evento-emitido-"));

/** Toda leitura da tabela paginou, em ordem de `id`. */
function leuPaginado(b: PostgrestComTeto, tabela: string) {
  const pedidos = b.pedidos.filter((p) => p.tabela === tabela);
  expect(pedidos.length).toBeGreaterThan(0);
  for (const p of pedidos) {
    expect(p.range).not.toBeNull();
    expect(p.ordem).toEqual([{ coluna: "id", ascendente: true }]);
  }
}

beforeEach(() => {
  h.admin.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AS_NOVE_EM_SP);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// contact-birthdays
// ---------------------------------------------------------------------------

describe("contact-birthdays lê todas as regras (MIA-369)", () => {
  const regraDaAlfa: Linha = {
    id: "regra-zz-alfa",
    organization_id: ACADEMIA_ALFA,
    trigger_event: "contact.birthday",
    trigger_config: null,
    is_active: true,
  };
  const aniversariante: Linha = {
    id: "contato-alfa",
    organization_id: ACADEMIA_ALFA,
    birthday_md: 914,
    is_blocked: false,
    phone_number: "5500000000001",
  };

  it("a regra da Academia Alfa depois de 1.500 regras da Beta parabeniza o aniversariante, uma vez só", async () => {
    const b = banco({
      organizations: organizacoes,
      automation_rules: [...regrasDaBeta(1_500, "contact.birthday", null), regraDaAlfa],
      contacts: [aniversariante],
    });

    const res = await aniversarios({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { regras: 1_501, emitidos: 1 } });
    expect(emitidos(b, "contact.birthday").map((e) => e.entity_id)).toEqual(["contato-alfa"]);
    leuPaginado(b, "automation_rules");

    // A rodada seguinte, na mesma hora: a trava anual segura o segundo parabéns.
    const outra = await aniversarios({} as never);
    expect(await outra.json()).toMatchObject({ data: { emitidos: 0, pulados: { ja_emitido: 1 } } });
    expect(emitidos(b, "contact.birthday")).toHaveLength(1);
  });

  it("leitura das regras que falha: 500 e nenhum parabéns (falha fechada)", async () => {
    const b = banco(
      { organizations: organizacoes, automation_rules: [regraDaAlfa], contacts: [aniversariante] },
      { falhaEm: (_n, tabela) => (tabela === "automation_rules" ? "canceling statement due to statement timeout" : null) },
    );

    const res = await aniversarios({} as never);

    expect(res.status).toBe(500);
    expect(emitidos(b, "contact.birthday")).toEqual([]);
  });

  it("trava ilegível: a regra fica de fora da rodada em vez de parabenizar de novo", async () => {
    const b = banco(
      { organizations: organizacoes, automation_rules: [regraDaAlfa], contacts: [aniversariante] },
      { falhaEm: (_n, tabela) => (tabela === "event_log" ? "canceling statement due to statement timeout" : null) },
    );

    const res = await aniversarios({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emitidos: 0, pulados: { trava_ilegivel: 1 } } });
    expect(emitidos(b, "contact.birthday")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lead-date-field-due
// ---------------------------------------------------------------------------

describe("lead-date-field-due lê todas as regras e a trava inteira (MIA-369)", () => {
  const regraDaAlfa: Linha = {
    id: "regra-zz-alfa",
    organization_id: ACADEMIA_ALFA,
    trigger_event: "lead.date_field_due",
    // Faltando 10 dias: hoje é 14/09, a data que casa é 24/09/2026.
    trigger_config: { pipeline_id: FUNIL_ALFA, campo: "data_da_avaliacao", dias: 10 },
    is_active: true,
  };
  const negocio: Linha = {
    id: "negocio-alfa",
    organization_id: ACADEMIA_ALFA,
    pipeline_id: FUNIL_ALFA,
    status: "open",
    custom_fields: { data_da_avaliacao: "2026-09-24" },
    created_at: haDias(60),
  };

  it("a regra da Academia Alfa depois de 1.500 regras da Beta avisa o negócio", async () => {
    const b = banco({
      organizations: organizacoes,
      automation_rules: [
        ...regrasDaBeta(1_500, "lead.date_field_due", { pipeline_id: FUNIL_ALFA, campo: "x", dias: 1 }),
        regraDaAlfa,
      ],
      crm_leads: [negocio],
    });

    const res = await dataDoFunil({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { regras: 1_501, emitidos: 1 } });
    expect(emitidos(b, "lead.date_field_due").map((e) => e.entity_id)).toEqual(["negocio-alfa"]);
    leuPaginado(b, "automation_rules");
  });

  it("o aviso desta data depois de 1.200 avisos de datas remarcadas segura o segundo aviso", async () => {
    // A avaliação foi remarcada 1.200 vezes (um aviso por valor). O aviso da
    // data de HOJE foi gravado por último, no formato da planilha: na leitura
    // antiga ficava fora da página, e o negócio era avisado de novo.
    const remarcadas = Array.from({ length: 1_200 }, (_, i) => ({
      id: `evento-${pad(i)}`,
      organization_id: ACADEMIA_ALFA,
      event_type: "lead.date_field_due",
      entity_id: "negocio-alfa",
      payload: { rule_id: "regra-zz-alfa", valor: new Date(Date.UTC(2020, 0, 1) + i * DIA).toISOString().slice(0, 10) },
      created_at: haDias(400),
    }));
    const b = banco({
      organizations: organizacoes,
      automation_rules: [regraDaAlfa],
      crm_leads: [negocio],
      event_log: [
        ...remarcadas,
        {
          id: "evento-zz",
          organization_id: ACADEMIA_ALFA,
          event_type: "lead.date_field_due",
          entity_id: "negocio-alfa",
          payload: { rule_id: "regra-zz-alfa", valor: "24/09/2026" },
          created_at: haDias(1),
        },
      ],
    });

    const res = await dataDoFunil({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emitidos: 0, pulados: { ja_emitido: 1 } } });
    expect(emitidos(b, "lead.date_field_due")).toEqual([]);
    leuPaginado(b, "event_log");
  });

  it("trava ilegível: a regra fica de fora da rodada em vez de avisar de novo", async () => {
    const b = banco(
      { organizations: organizacoes, automation_rules: [regraDaAlfa], crm_leads: [negocio] },
      { falhaEm: (_n, tabela) => (tabela === "event_log" ? "canceling statement due to statement timeout" : null) },
    );

    const res = await dataDoFunil({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emitidos: 0, pulados: { trava_ilegivel: 1 } } });
    expect(emitidos(b, "lead.date_field_due")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lead-time-triggers
// ---------------------------------------------------------------------------

describe("lead-time-triggers lê todas as regras e a trava filtrada inteira (MIA-369)", () => {
  const regraDaAlfa: Linha = {
    id: "regra-zz-alfa",
    organization_id: ACADEMIA_ALFA,
    trigger_event: "lead.silent_for",
    trigger_config: { dias: 7, direcao: "qualquer", pipeline_id: null, proteger_pela_agenda: false },
    is_active: true,
  };
  /** Em silêncio desde que nasceu, há dois anos: é ele quem puxa o recorte para trás. */
  const calado: Linha = {
    id: "negocio-alfa-1",
    organization_id: ACADEMIA_ALFA,
    status: "open",
    contact_id: "contato-alfa-1",
    created_at: haDias(730),
  };
  /** Falou pela última vez há 10 dias: o episódio de agora tem essa âncora. */
  const falouHaDezDias: Linha = {
    id: "negocio-alfa-2",
    organization_id: ACADEMIA_ALFA,
    status: "open",
    contact_id: "contato-alfa-2",
    created_at: haDias(365),
  };
  const conversas: Linha[] = [
    { id: "conversa-alfa-2", organization_id: ACADEMIA_ALFA, contact_id: "contato-alfa-2", last_message_at: haDias(10) },
  ];

  it("a regra da Academia Alfa depois de 1.500 regras da Beta dispara", async () => {
    const b = banco({
      organizations: organizacoes,
      automation_rules: [
        ...regrasDaBeta(1_500, "lead.silent_for", { dias: 7, direcao: "qualquer" }),
        regraDaAlfa,
      ],
      crm_leads: [calado],
      conversations: [],
    });

    const res = await gatilhosDeTempo({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { regras: 1_501, emitidos: 1 } });
    expect(emitidos(b, "lead.silent_for").map((e) => e.entity_id)).toEqual(["negocio-alfa-1"]);
    leuPaginado(b, "automation_rules");
  });

  it("o aviso deste episódio depois de 1.200 episódios antigos segura o segundo aviso, e o recorte deixa o resto de fora", async () => {
    // 500 avisos de antes do recorte (criados há três anos): não podem travar
    // ninguém do lote, e não entram na leitura.
    const antiquissimos = Array.from({ length: 500 }, (_, i) => ({
      id: `evento-a-${pad(i)}`,
      organization_id: ACADEMIA_ALFA,
      event_type: "lead.silent_for",
      entity_id: "negocio-alfa-2",
      payload: { rule_id: "regra-zz-alfa", ancora: new Date(Date.parse(haDias(1_200)) + i * 60_000).toISOString() },
      created_at: haDias(1_100),
    }));
    // 1.200 episódios antigos do mesmo negócio, todos DEPOIS do recorte (o
    // negócio calado há dois anos o puxa para trás). Na leitura antiga o aviso
    // do episódio de agora, gravado por último, ficava fora da página.
    const episodios = Array.from({ length: 1_200 }, (_, i) => ({
      id: `evento-b-${pad(i)}`,
      organization_id: ACADEMIA_ALFA,
      event_type: "lead.silent_for",
      entity_id: "negocio-alfa-2",
      payload: { rule_id: "regra-zz-alfa", ancora: new Date(Date.parse(haDias(300)) + i * 60_000).toISOString() },
      created_at: haDias(200),
    }));
    const b = banco({
      organizations: organizacoes,
      automation_rules: [regraDaAlfa],
      crm_leads: [calado, falouHaDezDias],
      conversations: conversas,
      event_log: [
        ...antiquissimos,
        ...episodios,
        {
          id: "evento-zz",
          organization_id: ACADEMIA_ALFA,
          event_type: "lead.silent_for",
          entity_id: "negocio-alfa-2",
          payload: { rule_id: "regra-zz-alfa", ancora: haDias(10) },
          created_at: haDias(3),
        },
      ],
    });

    const res = await gatilhosDeTempo({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emitidos: 1, pulados: { ja_emitido: 1 } } });
    // Só o calado recebe: o negócio que falou há 10 dias já foi avisado neste episódio.
    expect(emitidos(b, "lead.silent_for").map((e) => e.entity_id)).toEqual(["negocio-alfa-1"]);
    leuPaginado(b, "event_log");
    // O recorte: as 1.201 que podem travar, e nenhuma das 500 de antes dele.
    const lidas = b.pedidos.filter((p) => p.tabela === "event_log").reduce((n, p) => n + p.devolvidas, 0);
    expect(lidas).toBe(1_201);
  });

  it("trava ilegível: a regra fica de fora da rodada em vez de repetir o episódio", async () => {
    const b = banco(
      { organizations: organizacoes, automation_rules: [regraDaAlfa], crm_leads: [calado], conversations: [] },
      { falhaEm: (_n, tabela) => (tabela === "event_log" ? "canceling statement due to statement timeout" : null) },
    );

    const res = await gatilhosDeTempo({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emitidos: 0, pulados: { trava_ilegivel: 1 } } });
    expect(emitidos(b, "lead.silent_for")).toEqual([]);
  });

  it("leitura das regras que falha: 500 e nenhum evento (falha fechada)", async () => {
    const b = banco(
      { organizations: organizacoes, automation_rules: [regraDaAlfa], crm_leads: [calado], conversations: [] },
      { falhaEm: (_n, tabela) => (tabela === "automation_rules" ? "permission denied for table automation_rules" : null) },
    );

    const res = await gatilhosDeTempo({} as never);

    expect(res.status).toBe(500);
    expect(emitidos(b, "lead.silent_for")).toEqual([]);
  });
});

/**
 * FORK MIA — O FIO: o que sai para a Meta num evento do LEAD DE FORMULÁRIO, e o
 * que volta de um diagnóstico.
 *
 * ⚠️ NUNCA fala com a Meta. `fetch` é um dublê em todo caso deste arquivo, e o
 * teste reprova se o endereço não for o da fronteira (`baseDaGraphDeAnuncio`).
 *
 * Desde a .72 este transporte só tem a porta que o upstream não tem: o lead de
 * formulário, pela API de conversões para CRM (`lead_id`, `event_source: crm`).
 * O clique em anúncio para o WhatsApp (mensagens de negócio, `ctwa_clid`) é do
 * transporte do upstream (`conversions.ts`, 0524).
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conferirConexaoNaMeta } from "@/lib/plataformas-de-anuncio/meta/diagnostico-de-conversoes";
import {
  corpoDoEvento,
  ehIdDeLeadDaMeta,
  enviarEventoDoFunil,
  type EventoDoFunilParaAMeta,
} from "@/lib/plataformas-de-anuncio/meta/eventos-do-funil";
import { baseDaGraphDeAnuncio } from "@/lib/plataformas-de-anuncio/meta/graph-base";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TOKEN = "token-ficticio-de-teste-que-nunca-sai";
const credencial = { datasetId: "900000000000001", accessToken: TOKEN, testEventCode: null as string | null };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const AGORA = new Date("2026-10-01T12:00:00Z");
const evento = (over: Partial<EventoDoFunilParaAMeta> = {}): EventoDoFunilParaAMeta => ({
  leadId: "lead-1",
  nomeTecnico: "QualifiedLead",
  eventoId: "lead-1:MetaEtapa:00000000-0000-4000-8000-000000000001",
  ocorridoEm: new Date("2026-09-30T15:00:00Z"),
  identidade: { tipo: "lead_de_formulario", idDoLead: "123456789012345" },
  telefone: "5500900000001",
  email: null,
  valorCentavos: null,
  moeda: "brl",
  nomeDoCrm: "CRM de Teste",
  ...over,
});

const chamadas: Array<{ url: string; init: RequestInit }> = [];
function responder(...respostas: Array<{ status: number; corpo: unknown } | Error>) {
  const fila = [...respostas];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), init });
      const r = fila.shift();
      if (!r) throw new Error("chamada a mais do que o teste previu");
      if (r instanceof Error) throw r;
      return new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), { status: r.status });
    }),
  );
}

beforeEach(() => {
  chamadas.length = 0;
  // Só o relógio: o tempo limite da chamada continua de verdade.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o corpo do evento", () => {
  it("evento de etapa: conversões para CRM, sem valor, com o lead e o telefone com hash", () => {
    const corpo = corpoDoEvento(evento(), null);
    expect(corpo).toEqual({
      data: [
        {
          event_name: "QualifiedLead",
          event_time: Math.floor(Date.parse("2026-09-30T15:00:00Z") / 1000),
          event_id: "lead-1:MetaEtapa:00000000-0000-4000-8000-000000000001",
          action_source: "system_generated",
          user_data: { ph: [sha("5500900000001")], lead_id: "123456789012345" },
          custom_data: { event_source: "crm", lead_event_source: "CRM de Teste" },
        },
      ],
    });
    // Sem valor não sai `value`: zero ensinaria que o evento não vale nada.
    expect(JSON.stringify(corpo)).not.toContain("\"value\"");
    // E o telefone nunca viaja em claro.
    expect(JSON.stringify(corpo)).not.toContain("5500900000001");
  });

  it("com valor: reais e a moeda em maiúsculas", () => {
    const item = (corpoDoEvento(evento({ valorCentavos: 15000 }), null).data as Array<Record<string, unknown>>)[0]!;
    expect(item.custom_data).toEqual({
      value: 150,
      currency: "BRL",
      event_source: "crm",
      lead_event_source: "CRM de Teste",
    });
  });

  it("lead de formulário: conversões para CRM, com o id do lead em TEXTO e sem hash", () => {
    // 17 dígitos passam de 2^53: como número, o JavaScript trocaria o final do id.
    const idDoLead = "12345678901234567";
    const corpo = corpoDoEvento(
      evento({
        identidade: { tipo: "lead_de_formulario", idDoLead },
        email: " Pessoa@Exemplo.Invalid ",
        nomeTecnico: "Purchase",
        valorCentavos: 240000,
      }),
      null,
    );
    const item = (corpo.data as Array<Record<string, unknown>>)[0]!;
    expect(item.action_source).toBe("system_generated");
    expect(item).not.toHaveProperty("messaging_channel");
    expect(item.user_data).toEqual({
      ph: [sha("5500900000001")],
      em: [sha("pessoa@exemplo.invalid")],
      lead_id: idDoLead,
    });
    expect(item.custom_data).toEqual({
      value: 2400,
      currency: "BRL",
      event_source: "crm",
      lead_event_source: "CRM de Teste",
    });
    expect(JSON.stringify(corpo)).toContain(`"lead_id":"${idDoLead}"`);
  });

  it("o código de teste marca o envio", () => {
    expect(corpoDoEvento(evento(), "TESTE12345").test_event_code).toBe("TESTE12345");
    expect(corpoDoEvento(evento(), null)).not.toHaveProperty("test_event_code");
  });

  it("o id de lead de formulário tem de 15 a 17 dígitos", () => {
    expect(ehIdDeLeadDaMeta("123456789012345")).toBe(true);
    expect(ehIdDeLeadDaMeta("12345678901234567")).toBe(true);
    for (const ruim of ["12345", "123456789012345678", "meta-lead:abc", "", null, 123456789012345]) {
      expect(ehIdDeLeadDaMeta(ruim), String(ruim)).toBe(false);
    }
  });
});

describe("o envio", () => {
  it("vai para o destino de conversões, pela fronteira, com o token no cabeçalho e nunca na URL", async () => {
    responder({ status: 200, corpo: { events_received: 1 } });
    expect(await enviarEventoDoFunil(credencial, evento())).toEqual({ tipo: "ok" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe(`${baseDaGraphDeAnuncio()}/900000000000001/events`);
    expect(chamadas[0]!.url).not.toContain(TOKEN);
    expect((chamadas[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(chamadas[0]!.init.method).toBe("POST");
  });

  it("evento com mais de 7 dias não sai: a Meta recusaria, e a recusa fica visível", async () => {
    responder();
    const r = await enviarEventoDoFunil(credencial, evento({ ocorridoEm: new Date("2026-09-20T00:00:00Z") }));
    expect(r.tipo).toBe("permanente");
    expect(r.tipo === "permanente" && r.detalhe).toContain("a plataforma recusa acima de 7");
    expect(chamadas).toHaveLength(0);
  });

  it("id de lead malformado não sai", async () => {
    responder();
    const r = await enviarEventoDoFunil(
      credencial,
      evento({ identidade: { tipo: "lead_de_formulario", idDoLead: "meta-lead:abc" } }),
    );
    expect(r.tipo).toBe("permanente");
    expect(chamadas).toHaveLength(0);
  });

  it("recusa da Meta (4xx) é permanente, com a frase dela; limite de chamadas e 5xx são transitórios", async () => {
    responder(
      { status: 400, corpo: { error: { code: 100, message: "Invalid parameter", error_user_msg: "Nome de evento não reconhecido" } } },
      { status: 400, corpo: { error: { code: 190, message: "Error validating access token" } } },
      { status: 400, corpo: { error: { code: 613, message: "Calls to this api have exceeded the rate limit" } } },
      { status: 503, corpo: "fora do ar" },
      new Error("tempo esgotado"),
      { status: 200, corpo: { events_received: 0 } },
    );
    expect(await enviarEventoDoFunil(credencial, evento())).toEqual({
      tipo: "permanente",
      detalhe: "Nome de evento não reconhecido",
    });
    expect(await enviarEventoDoFunil(credencial, evento())).toEqual({
      tipo: "permanente",
      detalhe: "Error validating access token",
    });
    expect((await enviarEventoDoFunil(credencial, evento())).tipo).toBe("transitorio");
    expect((await enviarEventoDoFunil(credencial, evento())).tipo).toBe("transitorio");
    expect((await enviarEventoDoFunil(credencial, evento())).tipo).toBe("transitorio");
    // 200 sem a confirmação do recebimento não é sucesso.
    expect((await enviarEventoDoFunil(credencial, evento())).tipo).toBe("transitorio");
  });

  it("o token não aparece no desfecho de nenhum caso", async () => {
    responder({ status: 400, corpo: { error: { code: 190, message: "token ruim" } } });
    expect(JSON.stringify(await enviarEventoDoFunil(credencial, evento()))).not.toContain(TOKEN);
  });
});

describe("o diagnóstico na Meta", () => {
  const ALVO = { datasetId: "900000000000001", accessToken: TOKEN };

  it("tudo certo: token aceito, destino encontrado com o nome, permissões lidas", async () => {
    responder(
      { status: 200, corpo: { id: "1" } },
      { status: 200, corpo: { id: "900000000000001", name: "Empresa Modelo · Conversões" } },
      { status: 200, corpo: { data: [{ permission: "ads_management", status: "granted" }, { permission: "ads_read", status: "declined" }] } },
    );
    const r = await conferirConexaoNaMeta(ALVO);
    expect(r).toEqual({
      token: { estado: "aceito" },
      destino: { estado: "encontrado", nome: "Empresa Modelo · Conversões" },
      permissoes: { estado: "lidas", concedidas: ["ads_management"] },
    });
    // Só leituras, todas pela fronteira, e nenhuma com o token na URL.
    expect(chamadas.every((c) => c.init.method === "GET")).toBe(true);
    expect(chamadas.every((c) => c.url.startsWith(baseDaGraphDeAnuncio()))).toBe(true);
    expect(chamadas.some((c) => c.url.includes(TOKEN))).toBe(false);
    expect(chamadas.some((c) => c.url.endsWith("/events"))).toBe(false);
  });

  it("token vencido: recusado, e as outras duas nem são perguntadas", async () => {
    responder({ status: 400, corpo: { error: { code: 190, message: "Error validating access token: Session has expired" } } });
    const r = await conferirConexaoNaMeta(ALVO);
    expect(r.token).toEqual({ estado: "recusado", detalhe: "Error validating access token: Session has expired" });
    expect(r.destino.estado).toBe("nao_conferido");
    expect(r.permissoes.estado).toBe("nao_conferido");
    expect(chamadas).toHaveLength(1);
  });

  it("destino que não existe (ou que o token não alcança) e destino sem acesso são coisas diferentes", async () => {
    responder(
      { status: 200, corpo: { id: "1" } },
      { status: 400, corpo: { error: { code: 100, message: "Unsupported get request. Object with ID does not exist" } } },
      { status: 200, corpo: { data: [] } },
    );
    expect((await conferirConexaoNaMeta(ALVO)).destino.estado).toBe("nao_encontrado");

    responder(
      { status: 200, corpo: { id: "1" } },
      { status: 403, corpo: { error: { code: 200, message: "Requires business_management permission" } } },
      { status: 200, corpo: { data: [] } },
    );
    expect((await conferirConexaoNaMeta(ALVO)).destino.estado).toBe("sem_acesso");
  });

  it("rede fora: nada é afirmado, e nada lança", async () => {
    responder(new Error("tempo esgotado"), new Error("tempo esgotado"), new Error("tempo esgotado"));
    const r = await conferirConexaoNaMeta(ALVO);
    expect(r.token.estado).toBe("indisponivel");
    expect(r.destino.estado).toBe("nao_conferido");
    expect(r.permissoes.estado).toBe("nao_conferido");
  });

  it("o destino respondeu com este token: o token vale, mesmo que a pergunta direta não tenha dito", async () => {
    responder(
      { status: 400, corpo: { error: { code: 100, message: "Tried accessing nonexisting field (id)" } } },
      { status: 200, corpo: { id: "900000000000001", name: null } },
      { status: 400, corpo: { error: { code: 100, message: "não suportado" } } },
    );
    const r = await conferirConexaoNaMeta(ALVO);
    expect(r.token).toEqual({ estado: "aceito" });
    expect(r.destino).toEqual({ estado: "encontrado", nome: null });
    expect(r.permissoes.estado).toBe("nao_conferido");
  });
});

/**
 * FORK MIA (.62) — o aviso em tempo real dos formulários da Meta, com a Graph
 * SIMULADA e o banco em memória (`app/api/v1/webhooks/leads-da-meta`,
 * `lib/leads-da-meta/tempo-real.ts`, `assinatura.ts` e as duas funções novas de
 * `lib/plataformas-de-anuncio/meta/leads.ts`).
 *
 * O que se prova, cada um com o seu caso:
 *
 *   1. a assinatura do corpo (HMAC SHA-256 com o App Secret da instalação) é
 *      conferida ANTES de qualquer leitura: inválida ou ausente é 401, e nem o
 *      banco nem a Meta são tocados;
 *   2. o aviso de uma Página SEM DONO (9004) é ignorado sem chamar a Meta, e o
 *      de formulário que a empresa dona não ligou também;
 *   3. o lead do aviso entra pela MESMA via da leitura: etiquetas `Meta_ads` e
 *      `Formulario_Meta`, a chave do lead em hash, e `via = tempo_real`;
 *   4. os dois caminhos não duplicam: o aviso depois da leitura não gasta nem
 *      a chamada do lead, e a leitura depois do aviso não grava de novo;
 *   5. ligar o formulário assina a Página no app; a rodada assina a do
 *      formulário antigo, e não reconfere a cada 5 minutos.
 */
import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown; tabela: (n: string) => Array<Record<string, unknown>> },
  captacoes: [] as Array<Record<string, unknown>>,
  kicks: 0,
}));

vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: vi.fn(
    async (_db: unknown, ctx: { organization_id: string }, input: Record<string, unknown>) => {
      const linha = {
        id: `lead-${h.banco!.tabela("crm_leads").length + 1}`,
        organization_id: ctx.organization_id,
        status: "open",
        ...input,
      };
      h.banco!.tabela("crm_leads").push(linha);
      return linha;
    },
  ),
}));
vi.mock("@/lib/webhooks/captacao", () => ({
  registrarCaptacao: vi.fn(
    async (_db: unknown, c: Record<string, unknown>) => void h.captacoes.push(c),
  ),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefoneComNome: vi.fn(async (_db: unknown, org: string, tel: string) => {
    const c = h
      .banco!.tabela("contacts")
      .find((l) => l.organization_id === org && l.phone_number === tel);
    return c ? { id: c.id as string, phone_number: tel, name: (c.name as string) ?? null } : null;
  }),
}));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({
  lerCredencialDeLeitura: vi.fn(async (_db: unknown, org: string) =>
    org === "org-1"
      ? { ok: true, credencial: { accessToken: "TOKEN-DA-EMPRESA", contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
  existeConexaoDeLeitura: vi.fn(async (_db: unknown, org: string) => ({
    conectada: org === "org-1",
    contaPadrao: null,
  })),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({
  kickLocalPipeline: vi.fn(async () => {
    h.kicks += 1;
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => h.banco!.cliente) }));
vi.mock("@/lib/channels/meta/app", () => ({
  appDaMeta: vi.fn(async () => ({
    appSecret: "SEGREDO-DO-APP",
    verifyToken: "TOKEN-DE-VERIFICACAO",
  })),
}));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushAoUsuario: vi.fn(async () => ({ sent: 0, gone: 0 })),
}));

import { GET, POST } from "@/app/api/v1/webhooks/leads-da-meta/route";
import { precisaConferirTempoReal } from "@/lib/leads-da-meta/assinatura";
import { chaveDoLead } from "@/lib/leads-da-meta/mapear";
import { rodarLeadsDaMeta } from "@/lib/leads-da-meta/rodada";
import { avisosDoCorpo, receberAvisoDeLead } from "@/lib/leads-da-meta/tempo-real";
import { assinarLeadsDaPagina, lerLead } from "@/lib/plataformas-de-anuncio/meta/leads";

const ORG = "org-1";
const AGORA = new Date("2026-09-30T15:00:00.000Z");
const URL_DA_ROTA = "http://crm.test/api/v1/webhooks/leads-da-meta";

type LeadNaMeta = Record<string, unknown>;

function leadNaMeta(id: string, campos: Record<string, string>, formId = "f1"): LeadNaMeta {
  return {
    id,
    created_time: "2026-09-30T14:59:00+0000",
    form_id: formId,
    ad_id: "ad-9",
    campaign_id: "camp-9",
    campaign_name: "Lançamento",
    field_data: Object.entries(campos).map(([name, v]) => ({ name, values: [v] })),
  };
}

let banco: ReturnType<typeof bancoEmMemoria>;
/** O que a Meta devolve para GET /{leadgen_id}. */
let leadsPorId: Record<string, LeadNaMeta> = {};
/** O que a Meta devolve para GET /f1/leads (a leitura periódica). */
let leadsDoFormulario: LeadNaMeta[] = [];
/** O que a Meta responde à escrita de `subscribed_apps`. */
let respostaDaAssinatura: { status: number; corpo: unknown } = {
  status: 200,
  corpo: { success: true },
};
let appsAssinados: Array<Record<string, unknown>> = [];
let chamadas: Array<{ metodo: string; url: URL; token: string; corpo: string | null }> = [];

function montar(extra: Record<string, Linha[]> = {}) {
  banco = bancoEmMemoria({
    mia_leads_da_meta_config: [{ organization_id: ORG, ativo: true, dias_de_recuperacao: 7 }],
    mia_paginas_da_meta: [{ page_id: "111", organization_id: ORG, page_name: "Construtora Delta" }],
    mia_leads_da_meta_formularios: [
      {
        id: "form-linha-1",
        organization_id: ORG,
        page_id: "111",
        page_name: "Construtora Delta",
        form_id: "f1",
        form_name: "Bosque Aurora",
        perguntas: { "celular:_(ddd_+_número)": "Celular (DDD + número)" },
        pipeline_id: "funil-1",
        stage_id: "etapa-1",
        ativo: true,
        lido_ate: null,
        importados_total: 0,
        // Já conferida há pouco: a rodada destes testes não reassina.
        tempo_real: "assinado",
        tempo_real_em: AGORA.toISOString(),
      },
    ],
    ...extra,
  });
  h.banco = banco as never;
}

beforeEach(() => {
  h.captacoes = [];
  h.kicks = 0;
  leadsPorId = {};
  leadsDoFormulario = [];
  respostaDaAssinatura = { status: 200, corpo: { success: true } };
  appsAssinados = [];
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL, init?: RequestInit) => {
      const url = new URL(String(entrada));
      const metodo = init?.method ?? "GET";
      const token = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
      ).replace("Bearer ", "");
      chamadas.push({
        metodo,
        url,
        token,
        corpo: typeof init?.body === "string" ? init.body : null,
      });
      const json = (corpo: unknown, status = 200) =>
        new Response(JSON.stringify(corpo), { status });
      if (url.pathname.endsWith("/me/accounts")) {
        return json({ data: [{ id: "111", name: "Construtora Delta", access_token: "TOKEN-DA-PAGINA" }] });
      }
      if (url.pathname.endsWith("/111/subscribed_apps")) {
        if (metodo === "POST") return json(respostaDaAssinatura.corpo, respostaDaAssinatura.status);
        return json({ data: appsAssinados });
      }
      if (url.pathname.endsWith("/f1/leads")) return json({ data: leadsDoFormulario });
      const id = /\/(\d+)$/.exec(url.pathname)?.[1];
      if (id && leadsPorId[id]) return json(leadsPorId[id]);
      return json({ error: { code: 100, error_subcode: 33, message: "não existe" } }, 400);
    }),
  );
  montar();
});

afterEach(() => vi.unstubAllGlobals());

function corpoDoAviso(leadgenId: string, pageId = "111", formId: string | null = "f1") {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: pageId,
        time: 1759244340,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              page_id: pageId,
              ...(formId ? { form_id: formId } : {}),
              ad_id: "ad-9",
              created_time: 1759244340,
            },
          },
        ],
      },
    ],
  });
}

function assinar(corpo: string, segredo = "SEGREDO-DO-APP"): string {
  return `sha256=${createHmac("sha256", segredo).update(corpo, "utf8").digest("hex")}`;
}

function entrega(corpo: string, assinatura: string | null = assinar(corpo)): NextRequest {
  return new NextRequest(URL_DA_ROTA, {
    method: "POST",
    body: corpo,
    headers: {
      "content-type": "application/json",
      ...(assinatura ? { "x-hub-signature-256": assinatura } : {}),
    },
  });
}

const receber = (leadgenId: string, pageId = "111", formId: string | null = "f1") =>
  receberAvisoDeLead(
    banco.cliente as never,
    { leadgenId, pageId, formId },
    { requestId: "req", agora: AGORA },
  );

const chamadasDoLead = (id: string) => chamadas.filter((c) => c.url.pathname.endsWith(`/${id}`));

describe("a assinatura do corpo", () => {
  it("válida: o aviso é processado e o lead entra", async () => {
    leadsPorId["7001"] = leadNaMeta("7001", {
      full_name: "Ana Souza",
      "celular:_(ddd_+_número)": "(11) 98765-4321",
    });
    const corpo = corpoDoAviso("7001");
    const r = await POST(entrega(corpo));

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: 1, outcomes: ["criado"] });
    expect(banco.tabela("crm_leads")).toHaveLength(1);
  });

  it("inválida (outro segredo): 401, e nem o banco nem a Meta são tocados", async () => {
    leadsPorId["7002"] = leadNaMeta("7002", { full_name: "Bia", phone_number: "+5531999990001" });
    const corpo = corpoDoAviso("7002");
    const r = await POST(entrega(corpo, assinar(corpo, "SEGREDO-DE-OUTRO-APP")));

    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(0);
    expect(banco.tabela("crm_leads")).toHaveLength(0);
    expect(banco.escritas).toHaveLength(0);
  });

  it("corpo adulterado depois de assinado: 401", async () => {
    const corpo = corpoDoAviso("7003");
    const r = await POST(entrega(corpo.replace("7003", "7004"), assinar(corpo)));
    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(0);
  });

  it("sem cabeçalho de assinatura: 401", async () => {
    const r = await POST(entrega(corpoDoAviso("7005"), null));
    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(0);
  });

  it("o handshake devolve o desafio em texto puro só com o token de verificação certo", async () => {
    const pedir = (token: string) =>
      GET(
        new NextRequest(
          `${URL_DA_ROTA}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=DESAFIO-123`,
        ),
      );
    const certo = await pedir("TOKEN-DE-VERIFICACAO");
    expect(certo.status).toBe(200);
    expect(await certo.text()).toBe("DESAFIO-123");
    expect((await pedir("OUTRO")).status).toBe(403);
  });
});

describe("de quem é o aviso", () => {
  it("Página sem dono: ignorada, e a Meta nem é chamada", async () => {
    leadsPorId["7101"] = leadNaMeta("7101", { full_name: "Ana", phone_number: "+5531999990001" });
    expect(await receber("7101", "999")).toBe("pagina_sem_dono");
    expect(chamadas).toHaveLength(0);
    expect(banco.tabela("crm_leads")).toHaveLength(0);
  });

  it("formulário que a empresa dona não ligou: ignorado, sem chamar a Meta", async () => {
    expect(await receber("7102", "111", "f2")).toBe("formulario_nao_ligado");
    expect(chamadas).toHaveLength(0);
  });

  it("formulário desligado: o mesmo", async () => {
    banco.tabela("mia_leads_da_meta_formularios")[0]!.ativo = false;
    expect(await receber("7103")).toBe("formulario_nao_ligado");
    expect(chamadas).toHaveLength(0);
  });

  it("importação da empresa desligada: ignorado", async () => {
    banco.tabela("mia_leads_da_meta_config")[0]!.ativo = false;
    expect(await receber("7104")).toBe("importacao_desligada");
    expect(chamadas).toHaveLength(0);
  });

  it("o lead que não é do formulário que o aviso disse não entra", async () => {
    leadsPorId["7105"] = leadNaMeta(
      "7105",
      { full_name: "Ana", phone_number: "+5531999990001" },
      "f9",
    );
    expect(await receber("7105")).toBe("lead_de_outro_formulario");
    expect(banco.tabela("crm_leads")).toHaveLength(0);
  });

  it("aviso sem form_id: vale o do lead, que tem de estar ligado", async () => {
    leadsPorId["7106"] = leadNaMeta("7106", { full_name: "Ana", phone_number: "+5531999990001" });
    expect(await receber("7106", "111", null)).toBe("criado");
  });
});

describe("o lead entra pela mesma via da leitura", () => {
  it("contato com o celular da pergunta própria, card com as duas etiquetas, via tempo_real", async () => {
    leadsPorId["7201"] = leadNaMeta("7201", {
      full_name: "Ana Souza",
      "celular:_(ddd_+_número)": "(11) 98765-4321",
    });

    expect(await receber("7201")).toBe("criado");

    const [contato] = banco.tabela("contacts");
    expect(contato).toMatchObject({ name: "Ana Souza", phone_number: "+5511987654321" });
    const [negocio] = banco.tabela("crm_leads");
    expect(negocio).toMatchObject({
      pipeline_id: "funil-1",
      stage_id: "etapa-1",
      tags: ["Meta_ads", "Formulario_Meta"],
      source: "meta_ads",
      contact_id: contato!.id,
    });
    expect(banco.tabela("mia_leads_da_meta_recebidos")[0]).toMatchObject({
      chave_do_lead: chaveDoLead("7201"),
      via: "tempo_real",
      desfecho: "criado",
    });
    // O token é o da Página desta empresa, no cabeçalho, nunca na URL.
    const [pedido] = chamadasDoLead("7201");
    expect(pedido!.token).toBe("TOKEN-DA-PAGINA");
    expect(pedido!.url.toString()).not.toContain("TOKEN");
    // A tela mostra que o tempo real funciona; a automação de lead criado dispara.
    expect(banco.tabela("mia_leads_da_meta_formularios")[0]).toMatchObject({
      ultimo_aviso_da_meta_em: AGORA.toISOString(),
      importados_total: 1,
    });
    expect(h.kicks).toBe(1);
  });
});

describe("os dois caminhos não duplicam", () => {
  const rodar = () => rodarLeadsDaMeta(banco.cliente as never, { requestId: "req", agora: AGORA });

  it("aviso primeiro, leitura depois: a leitura acha o lead e não grava de novo", async () => {
    const lead = leadNaMeta("7301", { full_name: "Ana", phone_number: "+5531999990001" });
    leadsPorId["7301"] = lead;
    leadsDoFormulario = [lead];

    expect(await receber("7301")).toBe("criado");
    const resumo = await rodar();

    expect(resumo).toMatchObject({ novos: 0, erros: 0 });
    expect(banco.tabela("crm_leads")).toHaveLength(1);
    expect(banco.tabela("contacts")).toHaveLength(1);
    expect(h.captacoes).toHaveLength(1);
    expect(banco.tabela("mia_leads_da_meta_recebidos")).toHaveLength(1);
  });

  it("leitura primeiro, aviso depois: nem a chamada do lead é gasta", async () => {
    const lead = leadNaMeta("7302", { full_name: "Bia", phone_number: "+5531999990002" });
    leadsPorId["7302"] = lead;
    leadsDoFormulario = [lead];

    await rodar();
    expect(banco.tabela("crm_leads")).toHaveLength(1);
    expect(banco.tabela("mia_leads_da_meta_recebidos")[0]).toMatchObject({ via: "consulta" });

    expect(await receber("7302")).toBe("ja_importado");
    expect(chamadasDoLead("7302")).toHaveLength(0);
    expect(banco.tabela("crm_leads")).toHaveLength(1);
    expect(h.captacoes).toHaveLength(1);
  });

  it("o mesmo aviso entregue duas vezes (a Meta reentrega): um lead só", async () => {
    leadsPorId["7303"] = leadNaMeta("7303", { full_name: "Caio", phone_number: "+5531999990003" });
    const corpo = corpoDoAviso("7303");
    await POST(entrega(corpo));
    const segunda = await POST(entrega(corpo));
    expect(await segunda.json()).toEqual({ received: 1, outcomes: ["ja_importado"] });
    expect(banco.tabela("crm_leads")).toHaveLength(1);
  });
});

describe("o corpo do webhook", () => {
  it("só os avisos `leadgen` de Página, com ids de verdade", () => {
    const avisos = avisosDoCorpo({
      object: "page",
      entry: [
        {
          id: "111",
          changes: [
            { field: "leadgen", value: { leadgen_id: 8001, form_id: "f-não-numérico" } },
            { field: "feed", value: { post_id: "1" } },
            { field: "leadgen", value: { leadgen_id: "8002", page_id: "222", form_id: "333" } },
            { field: "leadgen", value: { leadgen_id: "abc" } },
          ],
        },
      ],
    });
    expect(avisos).toEqual([
      // O `page_id` que falta vem da entrada; o `form_id` que não é id vira nulo.
      { leadgenId: "8001", pageId: "111", formId: null },
      { leadgenId: "8002", pageId: "222", formId: "333" },
    ]);
  });

  it("objeto que não é Página, ou lixo, não vira aviso", () => {
    expect(avisosDoCorpo({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(avisosDoCorpo(null)).toEqual([]);
    expect(avisosDoCorpo("texto")).toEqual([]);
  });
});

describe("a Página assinada no app", () => {
  it("já assinada para leadgen: nada é escrito na Meta", async () => {
    appsAssinados = [{ id: "app-1", subscribed_fields: ["leadgen"] }];
    const r = await assinarLeadsDaPagina("TOKEN-DA-PAGINA", "111");
    expect(r).toEqual({ ok: true, dados: { jaEstava: true } });
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
  });

  it("o campo que o app já tinha na Página não se perde", async () => {
    appsAssinados = [{ id: "app-1", subscribed_fields: ["feed"] }];
    const r = await assinarLeadsDaPagina("TOKEN-DA-PAGINA", "111");
    expect(r.ok).toBe(true);
    const escrita = chamadas.find((c) => c.metodo === "POST")!;
    expect(new URLSearchParams(escrita.corpo!).get("subscribed_fields")).toBe("feed,leadgen");
    expect(escrita.token).toBe("TOKEN-DA-PAGINA");
    expect(escrita.url.toString()).not.toContain("TOKEN");
  });

  it("sem pages_manage_metadata: a recusa sai como permissão, com a frase da Meta", async () => {
    respostaDaAssinatura = {
      status: 403,
      corpo: { error: { code: 200, message: "(#200) Requires pages_manage_metadata permission" } },
    };
    const r = await assinarLeadsDaPagina("TOKEN-DA-PAGINA", "111");
    expect(r).toMatchObject({ ok: false, falha: "permissao_insuficiente" });
    expect(!r.ok && r.detalhe).toContain("pages_manage_metadata");
  });

  it("a rodada assina a Página do formulário que nunca tentou, e não reconfere a cada 5 minutos", async () => {
    const f = banco.tabela("mia_leads_da_meta_formularios")[0]!;
    f.tempo_real = null;
    f.tempo_real_em = null;

    await rodarLeadsDaMeta(banco.cliente as never, { requestId: "r", agora: AGORA });
    expect(f).toMatchObject({ tempo_real: "assinado", tempo_real_motivo: null });
    const escritas = () => chamadas.filter((c) => c.metodo === "POST").length;
    expect(escritas()).toBe(1);

    await rodarLeadsDaMeta(banco.cliente as never, {
      requestId: "r",
      agora: new Date(AGORA.getTime() + 5 * 60_000),
    });
    expect(escritas()).toBe(1);
  });

  it("a recusa é revista depois de algumas horas; a assinatura, uma vez por dia", () => {
    const hora = 60 * 60 * 1000;
    const em = (h: number) => new Date(AGORA.getTime() - h * hora).toISOString();
    expect(precisaConferirTempoReal({ tempo_real: null }, AGORA)).toBe(true);
    expect(precisaConferirTempoReal({ tempo_real: "recusado", tempo_real_em: em(1) }, AGORA)).toBe(
      false,
    );
    expect(precisaConferirTempoReal({ tempo_real: "recusado", tempo_real_em: em(7) }, AGORA)).toBe(
      true,
    );
    expect(precisaConferirTempoReal({ tempo_real: "assinado", tempo_real_em: em(7) }, AGORA)).toBe(
      false,
    );
    expect(precisaConferirTempoReal({ tempo_real: "assinado", tempo_real_em: em(25) }, AGORA)).toBe(
      true,
    );
  });
});

describe("um lead pelo id, na Meta", () => {
  it("sem permissão para a origem do anúncio: o lead vem sem ela, com a ressalva", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: string | URL) => {
        const url = new URL(String(entrada));
        const campos = url.searchParams.get("fields") ?? "";
        if (campos.includes("campaign_id")) {
          return new Response(
            JSON.stringify({
              error: { code: 200, message: "(#200) Requires ads_management permission" },
            }),
            { status: 403 },
          );
        }
        return new Response(JSON.stringify({ id: "9001", form_id: "f1", field_data: [] }), {
          status: 200,
        });
      }),
    );
    const r = await lerLead("TOKEN-DA-PAGINA", "9001");
    expect(r.ok).toBe(true);
    expect(r.ok && r.dados.id).toBe("9001");
    expect(r.ok && r.aviso).toBeTruthy();
  });
});

/**
 * FORK MIA — a rodada inteira dos leads da Meta, com a Graph SIMULADA e o banco
 * em memória (`lib/leads-da-meta/rodada.ts` + `gravar.ts`).
 *
 * O que se prova, cada um com o seu caso:
 *
 *   1. lead novo vira contato + negócio + captação, com a origem do anúncio, a
 *      etiqueta Meta_ads e as perguntas originais — e a marca de leitura anda;
 *   2. a leitura sobreposta não duplica nada (id do lead, em hash);
 *   3. a mesma pessoa com negócio aberto não ganha outro card;
 *   4. formulário sem nome, telefone nem e-mail é recusado UMA vez, com motivo;
 *   5. erro da Meta vira linha de histórico com motivo, a marca NÃO anda, e erros
 *      iguais seguidos viram uma linha só com o contador;
 *   6. Página fora do token, gravação que cai no meio, chave desligada, módulo.
 *
 * Nenhuma chamada sai da máquina. As peças do upstream que gravam (negócio,
 * captação, auditoria, atividade) são dublês que registram o que receberam: o que
 * se mede aqui é o que a rotina manda para elas, e o que ela guarda no estado dela.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { tabela: (n: string) => Array<Record<string, unknown>> },
  captacoes: [] as Array<Record<string, unknown>>,
  auditorias: [] as Array<Record<string, unknown>>,
  atividades: [] as Array<Record<string, unknown>>,
  kicks: 0,
  criarNegocio: null as
    null | ((input: Record<string, unknown>) => Promise<Record<string, unknown>>),
  credencialOk: true,
}));

vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: vi.fn(
    async (_db: unknown, ctx: { organization_id: string }, input: Record<string, unknown>) => {
      if (h.criarNegocio) return h.criarNegocio(input);
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
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (a: Record<string, unknown>) => void h.auditorias.push(a)),
}));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async (_db: unknown, a: Record<string, unknown>) => {
    h.atividades.push(a);
    return { ok: true };
  }),
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
  lerCredencialDeLeitura: vi.fn(async () =>
    h.credencialOk
      ? { ok: true, credencial: { accessToken: "TOKEN-DA-EMPRESA", contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({
  kickLocalPipeline: vi.fn(async () => {
    h.kicks += 1;
  }),
}));

import { ApiError } from "@/lib/api/types";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { chaveDoLead } from "@/lib/leads-da-meta/mapear";
import { rodarLeadsDaMeta } from "@/lib/leads-da-meta/rodada";

const ORG = "org-1";
const AGORA = new Date("2026-09-29T15:00:00.000Z");
const MINUTO = 60_000;

type LeadNaMeta = Record<string, unknown>;

function leadNaMeta(id: string, campos: Record<string, string>, minutosAtras = 30): LeadNaMeta {
  return {
    id,
    created_time: new Date(AGORA.getTime() - minutosAtras * MINUTO)
      .toISOString()
      .replace(".000Z", "+0000"),
    form_id: "f1",
    ad_id: "ad-9",
    ad_name: "Anúncio Implante",
    adset_id: "set-9",
    adset_name: "Público BH",
    campaign_id: "camp-9",
    campaign_name: "Implante Setembro",
    is_organic: false,
    platform: "fb",
    field_data: Object.entries(campos).map(([name, v]) => ({ name, values: [v] })),
  };
}

let leadsDaMeta: LeadNaMeta[] = [];
let respostaDosLeads: null | { status: number; corpo: unknown } = null;
let paginas: Array<Record<string, unknown>> = [];
let urlsLidas: URL[] = [];
let banco: ReturnType<typeof bancoEmMemoria>;

function montar(extra: Record<string, Linha[]> = {}) {
  banco = bancoEmMemoria({
    mia_leads_da_meta_config: [{ organization_id: ORG, ativo: true, dias_de_recuperacao: 7 }],
    mia_leads_da_meta_formularios: [
      {
        id: "form-linha-1",
        organization_id: ORG,
        page_id: "p1",
        page_name: "Clínica Sorriso",
        form_id: "f1",
        form_name: "Avaliação grátis",
        perguntas: { "qual_seu_interesse?": "Qual seu interesse?" },
        pipeline_id: "funil-1",
        stage_id: "etapa-1",
        ativo: true,
        lido_ate: null,
        importados_total: 0,
      },
    ],
    ...extra,
  });
  h.banco = banco;
}

beforeEach(() => {
  h.captacoes = [];
  h.auditorias = [];
  h.atividades = [];
  h.kicks = 0;
  h.criarNegocio = null;
  h.credencialOk = true;
  leadsDaMeta = [];
  respostaDosLeads = null;
  urlsLidas = [];
  paginas = [{ id: "p1", name: "Clínica Sorriso", access_token: "TOKEN-DA-PAGINA" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL) => {
      const url = new URL(String(entrada));
      urlsLidas.push(url);
      if (url.pathname.endsWith("/me/accounts")) {
        return new Response(JSON.stringify({ data: paginas }), { status: 200 });
      }
      if (url.pathname.endsWith("/f1/leads")) {
        if (respostaDosLeads) {
          return new Response(JSON.stringify(respostaDosLeads.corpo), {
            status: respostaDosLeads.status,
          });
        }
        return new Response(JSON.stringify({ data: leadsDaMeta }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 100, message: "rota inesperada" } }), {
        status: 400,
      });
    }),
  );
  montar();
});

afterEach(() => vi.unstubAllGlobals());

const rodar = () => rodarLeadsDaMeta(banco.cliente as never, { requestId: "req-1", agora: AGORA });
const formulario = () => banco.tabela("mia_leads_da_meta_formularios")[0]!;
const leituras = () => banco.tabela("mia_leads_da_meta_leituras");

describe("lead novo", () => {
  it("vira contato, negócio e captação, com a origem do anúncio e as perguntas originais", async () => {
    leadsDaMeta = [
      leadNaMeta("1001", {
        full_name: "Ana Souza",
        phone_number: "+5531999990001",
        email: "ana@exemplo.com",
        "qual_seu_interesse?": "Implante",
      }),
    ];

    const resumo = await rodar();

    expect(resumo).toMatchObject({
      empresas: 1,
      formularios: 1,
      novos: 1,
      repetidos: 0,
      recusados: 0,
      erros: 0,
    });

    const [contato] = banco.tabela("contacts");
    expect(contato).toMatchObject({
      organization_id: ORG,
      name: "Ana Souza",
      phone_number: "+5531999990001",
      email: "ana@exemplo.com",
      source: "meta_ads",
    });
    expect(contato!.source_metadata).toMatchObject({
      ad_platform: "meta_ads",
      ad_id: "ad-9",
      campaign_name: "Implante Setembro",
      adset_name: "Público BH",
      meta_form_id: "f1",
      meta_page_id: "p1",
    });

    const [negocio] = banco.tabela("crm_leads");
    expect(negocio).toMatchObject({
      pipeline_id: "funil-1",
      stage_id: "etapa-1",
      contact_id: contato!.id,
      title: "Ana Souza",
      tags: ["Meta_ads"],
      source: "meta_ads",
      custom_fields: { "Qual seu interesse?": "Implante" },
    });
    expect(negocio!.source_metadata).not.toHaveProperty("ad_source_id");
    expect(String(negocio!.external_id)).not.toContain("1001");

    expect(h.captacoes).toHaveLength(1);
    expect(h.captacoes[0]).toMatchObject({
      organizationId: ORG,
      webhookSourceId: null,
      sourceName: "Formulário da Meta: Avaliação grátis",
      outcome: "criado",
      leadId: negocio!.id,
      contactId: contato!.id,
      capturedName: "Ana Souza",
      fields: { "Qual seu interesse?": "Implante" },
    });
    expect(h.auditorias.filter((a) => a.action === "webhook.lead_received")).toHaveLength(1);

    // A deduplicação guarda o HASH do id, nunca o id cru.
    const [recebido] = banco.tabela("mia_leads_da_meta_recebidos");
    expect(recebido).toMatchObject({ chave_do_lead: chaveDoLead("1001"), desfecho: "criado" });
    expect(JSON.stringify(banco.tabela("mia_leads_da_meta_recebidos"))).not.toContain("1001");

    // A marca andou até agora, a leitura ficou no histórico, e a fila drenou.
    expect(formulario().lido_ate).toBe(AGORA.toISOString());
    expect(formulario().importados_total).toBe(1);
    expect(leituras()).toHaveLength(1);
    expect(leituras()[0]).toMatchObject({ status: "sucesso", novos: 1, motivo: null });
    expect(h.kicks).toBe(1);
  });

  it("a primeira leitura volta os dias de recuperação da empresa", async () => {
    await rodar();
    const pedido = urlsLidas.find((u) => u.pathname.endsWith("/f1/leads"))!;
    const [desde] = JSON.parse(pedido.searchParams.get("filtering")!) as Array<{ value: number }>;
    const esperado = (AGORA.getTime() - 7 * 24 * 60 * MINUTO - 15 * MINUTO) / 1000 - 1;
    expect(desde!.value).toBe(esperado);
    // O token da Página, no cabeçalho; o da empresa só listou as Páginas.
    expect(pedido.toString()).not.toContain("TOKEN");
  });

  it("só e-mail também vira contato (a rota do webhook deixaria o negócio sem contato)", async () => {
    leadsDaMeta = [leadNaMeta("1002", { full_name: "Bia", email: "bia@exemplo.com" })];
    await rodar();
    expect(banco.tabela("contacts")[0]).toMatchObject({
      email: "bia@exemplo.com",
      phone_number: null,
    });
    expect(banco.tabela("crm_leads")[0]!.contact_id).toBe(banco.tabela("contacts")[0]!.id);
  });
});

describe("deduplicação", () => {
  it("a leitura sobreposta não duplica nada, e 'sem novos' seguidos viram uma linha só", async () => {
    leadsDaMeta = [leadNaMeta("1001", { full_name: "Ana", phone_number: "+5531999990001" })];
    // Como na produção: uma rodada a cada 5 minutos, cada uma com o seu relógio.
    const rodarEm = (minutos: number) =>
      rodarLeadsDaMeta(banco.cliente as never, {
        requestId: "req-1",
        agora: new Date(AGORA.getTime() + minutos * MINUTO),
      });
    await rodarEm(0);
    await rodarEm(5);
    await rodarEm(10);

    expect(banco.tabela("crm_leads")).toHaveLength(1);
    expect(banco.tabela("contacts")).toHaveLength(1);
    expect(h.captacoes).toHaveLength(1);
    expect(leituras().map((l) => [l.status, l.repeticoes ?? 1])).toEqual([
      ["sucesso", 1],
      ["sem_novos", 2],
    ]);
    expect(formulario().importados_total).toBe(1);
  });

  it("a mesma pessoa com negócio aberto: nada de card novo, anotação no aberto", async () => {
    montar({
      contacts: [
        { id: "c-antigo", organization_id: ORG, phone_number: "+5531999990001", name: "Ana" },
      ],
      crm_leads: [
        { id: "lead-aberto", organization_id: ORG, contact_id: "c-antigo", status: "open" },
      ],
    });
    leadsDaMeta = [leadNaMeta("2001", { full_name: "Ana", phone_number: "+5531999990001" })];

    const resumo = await rodar();

    expect(resumo).toMatchObject({ novos: 0, repetidos: 1 });
    expect(banco.tabela("crm_leads")).toHaveLength(1);
    expect(h.captacoes[0]).toMatchObject({
      outcome: "duplicado",
      leadId: "lead-aberto",
      contactId: "c-antigo",
    });
    expect(h.atividades[0]).toMatchObject({ leadId: "lead-aberto", type: "note" });
    expect(String(h.atividades[0]!.reason)).not.toContain("Ana");
    // Primeiro toque: a origem vai para o contato que ainda não tinha nenhuma.
    expect(banco.chamadasRpc.map((c) => c.nome)).toContain("fn_estampar_atribuicao_de_anuncio");
    expect(banco.tabela("mia_leads_da_meta_recebidos")[0]).toMatchObject({ desfecho: "repetido" });
  });

  it("formulário sem nome, telefone nem e-mail é recusado UMA vez, com motivo", async () => {
    leadsDaMeta = [leadNaMeta("3001", { "qual_seu_interesse?": "Implante" })];
    await rodar();
    await rodar();
    expect(h.captacoes).toHaveLength(1);
    expect(h.captacoes[0]).toMatchObject({
      outcome: "recusado",
      rejectReason: "sem_campo_mapeavel",
    });
    expect(banco.tabela("crm_leads")).toHaveLength(0);
  });
});

describe("quando algo dá errado", () => {
  it("token recusado: histórico com motivo, marca parada, erros iguais numa linha só", async () => {
    respostaDosLeads = {
      status: 400,
      corpo: { error: { code: 190, message: "Error validating access token" } },
    };
    const r1 = await rodar();
    await rodar();

    expect(r1.erros).toBe(1);
    expect(formulario().lido_ate).toBeNull();
    expect(formulario()).toMatchObject({ ultimo_status: "erro", ultimo_motivo: "token_invalido" });
    expect(leituras()).toHaveLength(1);
    expect(leituras()[0]).toMatchObject({
      status: "erro",
      motivo: "token_invalido",
      repeticoes: 2,
    });
  });

  it("Página que o token não alcança: erro com o motivo certo, sem ler leads", async () => {
    paginas = [];
    await rodar();
    expect(leituras()[0]).toMatchObject({ status: "erro", motivo: "pagina_nao_atribuida" });
    expect(urlsLidas.some((u) => u.pathname.endsWith("/leads"))).toBe(false);
  });

  it("sem conexão de anúncios: erro sem_conexao, e a Meta nem é chamada", async () => {
    h.credencialOk = false;
    await rodar();
    expect(leituras()[0]).toMatchObject({ status: "erro", motivo: "sem_conexao" });
    expect(urlsLidas).toHaveLength(0);
  });

  it("a gravação cai no meio: a marca não anda, e a próxima rodada completa sem duplicar", async () => {
    leadsDaMeta = [
      leadNaMeta("4001", { full_name: "Primeiro", phone_number: "+5531999990001" }, 50),
      leadNaMeta("4002", { full_name: "Segundo", phone_number: "+5531999990002" }, 40),
    ];
    let chamadas = 0;
    h.criarNegocio = async (input) => {
      chamadas += 1;
      if (chamadas === 2) throw new Error("conexão com o banco caiu");
      const linha = { id: `lead-${chamadas}`, organization_id: ORG, status: "open", ...input };
      banco.tabela("crm_leads").push(linha);
      return linha;
    };

    const r1 = await rodar();
    // O primeiro entrou antes da queda, e conta; a leitura inteira é erro.
    expect(r1).toMatchObject({ novos: 1, erros: 1 });
    expect(formulario().lido_ate).toBeNull();
    expect(leituras()[0]).toMatchObject({ status: "erro", motivo: "erro_ao_gravar" });

    h.criarNegocio = null;
    const r2 = await rodar();
    expect(r2.erros).toBe(0);
    // O primeiro já tinha entrado; o segundo entra agora. Nenhum duplicado.
    expect(
      banco
        .tabela("crm_leads")
        .map((l) => l.title)
        .sort(),
    ).toEqual(["Primeiro", "Segundo"]);
    expect(formulario().lido_ate).toBe(AGORA.toISOString());
  });

  it("o CRM recusa o negócio (etapa apagada): recusado com motivo, e não volta", async () => {
    leadsDaMeta = [leadNaMeta("5001", { full_name: "Ana", phone_number: "+5531999990001" })];
    h.criarNegocio = async () => {
      throw new ApiError(404, "not_found", undefined, "req", "Etapa não encontrada");
    };
    const r = await rodar();
    expect(r).toMatchObject({ recusados: 1, erros: 0 });
    expect(h.captacoes[0]).toMatchObject({
      outcome: "recusado",
      rejectReason: "erro_ao_criar_lead",
    });
    expect(formulario().lido_ate).toBe(AGORA.toISOString());
  });

  it("o funil de destino sumiu: erro sem_funil, sem ler a Meta", async () => {
    formulario().pipeline_id = null;
    await rodar();
    expect(leituras()[0]).toMatchObject({ status: "erro", motivo: "sem_funil" });
    expect(urlsLidas.some((u) => u.pathname.endsWith("/leads"))).toBe(false);
  });
});

describe("a chave e o módulo", () => {
  it("chave desligada: nenhuma chamada à Meta, nada no histórico", async () => {
    banco.tabela("mia_leads_da_meta_config")[0]!.ativo = false;
    const r = await rodar();
    expect(r.empresas).toBe(0);
    expect(urlsLidas).toHaveLength(0);
    expect(leituras()).toHaveLength(0);
  });

  it("'Ler agora' de uma empresa não lê as outras", async () => {
    banco
      .tabela("mia_leads_da_meta_config")
      .push({ organization_id: "org-2", ativo: true, dias_de_recuperacao: 7 });
    const r = await rodarLeadsDaMeta(banco.cliente as never, {
      requestId: "r",
      agora: AGORA,
      organizationId: "org-2",
    });
    expect(r.empresas).toBe(0);
    expect(urlsLidas).toHaveLength(0);
  });

  it("virando módulo vendável, só a empresa com liberação viva passa", async () => {
    montar({
      organization_modules: [
        { organization_id: "org-com", modulo: "leads_da_meta", revoked_at: null },
        { organization_id: "org-revogada", modulo: "leads_da_meta", revoked_at: "2026-09-01" },
      ],
    });
    const db = banco.cliente as never;
    expect(await leadsDaMetaLiberados(db, "org-sem", false)).toBe(true);
    expect(await leadsDaMetaLiberados(db, "org-com", true)).toBe(true);
    expect(await leadsDaMetaLiberados(db, "org-revogada", true)).toBe(false);
    expect(await leadsDaMetaLiberados(db, "org-sem", true)).toBe(false);
  });
});

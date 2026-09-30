/**
 * FORK MIA (.62) — quando a leitura dos leads da Meta para, os administradores
 * ficam sabendo, UMA vez por problema (`lib/leads-da-meta/aviso-de-falha.ts`,
 * integrado em `rodada.ts`). A Graph é simulada e o banco é em memória.
 *
 * O que se prova, cada um com o seu caso:
 *
 *   1. três leituras com erro seguidas abrem UM aviso na Central, com o motivo
 *      e o que fazer, e um push no celular de cada ADMINISTRADOR (e só deles);
 *   2. a quarta, a quinta e a décima não repetem nada;
 *   3. a primeira leitura boa fecha o aviso e zera o contador, e o problema que
 *      volta depois é um problema novo, avisado de novo;
 *   4. o motivo que passa sozinho (a Meta fora do ar) espera uma hora;
 *   5. motivo diferente é outro problema: o aviso antigo fecha, o novo abre;
 *   6. a empresa que lê pela conexão da plataforma é mandada ao suporte;
 *   7. dois formulários parando juntos: dois avisos, UM push;
 *   8. formulário desligado não deixa aviso aberto para trás;
 *   9. o botão do aviso leva à aba dos formulários, só para quem administra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  pushes: [] as Array<{ org: string; usuario: string; payload: Record<string, unknown> }>,
  /** O token de conexão de cada empresa (ausente = sem conexão). */
  tokens: {} as Record<string, string>,
}));

vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: vi.fn() }));
vi.mock("@/lib/webhooks/captacao", () => ({ registrarCaptacao: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefoneComNome: vi.fn(async () => null),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({
  kickLocalPipeline: vi.fn(async () => undefined),
}));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({
  lerCredencialDeLeitura: vi.fn(async (_db: unknown, org: string) =>
    h.tokens[org]
      ? { ok: true, credencial: { accessToken: h.tokens[org], contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
  existeConexaoDeLeitura: vi.fn(async (_db: unknown, org: string) => ({
    conectada: Boolean(h.tokens[org]),
    contaPadrao: null,
  })),
}));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushAoUsuario: vi.fn(
    async (org: string, usuario: string, payload: Record<string, unknown>) => {
      h.pushes.push({ org, usuario, payload });
      return { sent: 1, gone: 0 };
    },
  ),
}));

import { resolverDestinosDosAvisos } from "@/lib/ai/inbox-destino";
import {
  DESTINO_DO_AVISO,
  FALHAS_PARA_AVISAR_SE_PASSA_SOZINHO,
  REF_KIND_DO_AVISO,
  decidirAviso,
} from "@/lib/leads-da-meta/aviso-de-falha";
import { MENSAGEM_DO_MOTIVO } from "@/lib/leads-da-meta/mensagens";
import { rodarLeadsDaMeta } from "@/lib/leads-da-meta/rodada";

const ORG = "org-1";
const INICIO = new Date("2026-09-30T12:00:00.000Z");
const CINCO_MINUTOS = 5 * 60_000;

let banco: ReturnType<typeof bancoEmMemoria>;
/** A resposta da Meta para a leitura dos leads de cada formulário. */
let respostaDosLeads: Record<string, { status: number; corpo: unknown }> = {};
let rodadas = 0;

const ERRO_DE_TOKEN = {
  status: 400,
  corpo: { error: { code: 190, message: "Error validating access token" } },
};
const ERRO_DE_PERMISSAO = {
  status: 403,
  corpo: { error: { code: 10, message: "Permission denied" } },
};
const META_FORA = { status: 503, corpo: { error: { message: "Service unavailable" } } };
const SEM_LEADS = { status: 200, corpo: { data: [] } };

function formulario(id: string, formId: string, nome: string): Linha {
  return {
    id,
    organization_id: ORG,
    page_id: "111",
    page_name: "Clínica",
    form_id: formId,
    form_name: nome,
    perguntas: {},
    pipeline_id: "funil-1",
    stage_id: "etapa-1",
    ativo: true,
    lido_ate: null,
    importados_total: 0,
    falhas_seguidas: 0,
    aviso_de_falha_motivo: null,
    // Já conferida: a assinatura do tempo real não entra nestas contas.
    tempo_real: "assinado",
    tempo_real_em: INICIO.toISOString(),
  };
}

function montar(extra: Record<string, Linha[]> = {}) {
  banco = bancoEmMemoria({
    mia_leads_da_meta_config: [{ organization_id: ORG, ativo: true, dias_de_recuperacao: 7 }],
    mia_paginas_da_meta: [{ page_id: "111", organization_id: ORG, page_name: "Clínica" }],
    mia_leads_da_meta_formularios: [formulario("form-a", "f1", "Avaliação grátis")],
    organizations: [{ id: ORG, locale: "pt-BR" }],
    user_organizations: [
      { organization_id: ORG, user_id: "admin-1", role: "admin", revoked_at: null },
      { organization_id: ORG, user_id: "admin-2", role: "admin", revoked_at: null },
      { organization_id: ORG, user_id: "admin-que-saiu", role: "admin", revoked_at: "2026-09-01" },
      { organization_id: ORG, user_id: "atendente", role: "agent", revoked_at: null },
      { organization_id: "org-2", user_id: "admin-do-vizinho", role: "admin", revoked_at: null },
    ],
    ...extra,
  });
}

beforeEach(() => {
  h.pushes = [];
  h.tokens = { [ORG]: "TOKEN-DA-EMPRESA" };
  respostaDosLeads = { f1: ERRO_DE_TOKEN, f2: ERRO_DE_TOKEN };
  rodadas = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL) => {
      const url = new URL(String(entrada));
      if (url.pathname.endsWith("/me/accounts")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "111", name: "Clínica", access_token: "TOKEN-DA-PAGINA" }],
          }),
          { status: 200 },
        );
      }
      const form = /\/(f\d)\/leads$/.exec(url.pathname)?.[1];
      const r = form ? respostaDosLeads[form] : undefined;
      if (r) return new Response(JSON.stringify(r.corpo), { status: r.status });
      return new Response(JSON.stringify({ error: { code: 100, message: "rota inesperada" } }), {
        status: 400,
      });
    }),
  );
  montar();
});

afterEach(() => vi.unstubAllGlobals());

/** Uma rodada, cinco minutos depois da anterior, como o relógio da produção. */
async function rodar(vezes = 1) {
  for (let i = 0; i < vezes; i += 1) {
    await rodarLeadsDaMeta(banco.cliente as never, {
      requestId: `r${rodadas}`,
      agora: new Date(INICIO.getTime() + rodadas * CINCO_MINUTOS),
    });
    rodadas += 1;
  }
}

const avisos = () => banco.tabela("agent_inbox_items");
const abertos = () => avisos().filter((a) => a.status !== "resolved");
const linha = (id = "form-a") =>
  banco.tabela("mia_leads_da_meta_formularios").find((f) => f.id === id)!;

describe("três falhas seguidas, um aviso", () => {
  it("as duas primeiras só contam; a terceira avisa na Central e no celular dos administradores", async () => {
    await rodar(2);
    expect(avisos()).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
    expect(linha().falhas_seguidas).toBe(2);

    await rodar();

    expect(avisos()).toHaveLength(1);
    const [aviso] = avisos();
    expect(aviso).toMatchObject({
      organization_id: ORG,
      kind: "other",
      severity: "critical",
      ref_kind: REF_KIND_DO_AVISO,
      ref_id: "form-a",
      title: 'Os leads do formulário "Avaliação grátis" pararam de chegar',
    });
    // O motivo em linguagem simples, o que fazer, e que nada se perde.
    expect(aviso!.body).toContain(MENSAGEM_DO_MOTIVO.token_invalido);
    expect(aviso!.body).toContain("90 dias");
    expect(linha()).toMatchObject({ falhas_seguidas: 3, aviso_de_falha_motivo: "token_invalido" });

    // Push só para os administradores ATIVOS desta empresa.
    expect(h.pushes.map((p) => p.usuario).sort()).toEqual(["admin-1", "admin-2"]);
    expect(h.pushes[0]!.payload).toMatchObject({
      title: "Os leads da Meta pararam de chegar",
      href: DESTINO_DO_AVISO,
    });
    expect(String(h.pushes[0]!.payload.body)).toContain("Avaliação grátis");
  });

  it("a quarta, a quinta e a décima não repetem nada", async () => {
    await rodar(10);
    expect(avisos()).toHaveLength(1);
    expect(h.pushes).toHaveLength(2);
    expect(linha().falhas_seguidas).toBe(10);
  });

  it("duas rodadas ao mesmo tempo não abrem dois avisos (o banco segura a segunda)", async () => {
    await rodar(3);
    // A segunda rodada que chegou junto: o índice único da 9005 recusa (23505).
    const inserir = banco.cliente.from;
    let recusou = false;
    (banco.cliente as { from: (t: string) => unknown }).from = (t: string) => {
      const q = inserir(t) as Record<string, unknown>;
      if (t !== "agent_inbox_items") return q;
      return {
        ...q,
        insert: () => {
          recusou = true;
          return Promise.resolve({
            data: null,
            error: { code: "23505", message: "duplicate key" },
          });
        },
      };
    };
    linha().aviso_de_falha_motivo = null; // como se esta rodada tivesse lido antes da outra gravar
    await rodar();
    expect(recusou).toBe(true);
    expect(avisos()).toHaveLength(1);
    expect(h.pushes).toHaveLength(2);
    expect(linha().aviso_de_falha_motivo).toBe("token_invalido");
  });
});

describe("quando volta a funcionar", () => {
  it("a primeira leitura boa fecha o aviso e zera o contador", async () => {
    await rodar(4);
    respostaDosLeads.f1 = SEM_LEADS;
    await rodar();

    expect(abertos()).toHaveLength(0);
    expect(avisos()[0]).toMatchObject({ status: "resolved" });
    expect(avisos()[0]!.resolved_at).toBeTruthy();
    expect(linha()).toMatchObject({ falhas_seguidas: 0, aviso_de_falha_motivo: null });
  });

  it("o problema que volta depois é um problema novo, avisado de novo", async () => {
    await rodar(3);
    respostaDosLeads.f1 = SEM_LEADS;
    await rodar();
    respostaDosLeads.f1 = ERRO_DE_TOKEN;
    await rodar(2);
    expect(abertos()).toHaveLength(0);
    await rodar();
    expect(avisos()).toHaveLength(2);
    expect(abertos()).toHaveLength(1);
    expect(h.pushes).toHaveLength(4);
  });

  it("uma falha no meio de leituras boas não acumula", async () => {
    await rodar(2);
    respostaDosLeads.f1 = SEM_LEADS;
    await rodar();
    respostaDosLeads.f1 = ERRO_DE_TOKEN;
    await rodar(2);
    expect(avisos()).toHaveLength(0);
    expect(linha().falhas_seguidas).toBe(2);
  });
});

describe("cada motivo no seu tempo", () => {
  it("a Meta fora do ar espera uma hora antes de avisar", async () => {
    respostaDosLeads.f1 = META_FORA;
    await rodar(FALHAS_PARA_AVISAR_SE_PASSA_SOZINHO - 1);
    expect(avisos()).toHaveLength(0);
    await rodar();
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]!.body).toContain(MENSAGEM_DO_MOTIVO.transitorio);
  });

  it("motivo diferente é outro problema: o aviso antigo fecha, o novo abre", async () => {
    await rodar(3);
    respostaDosLeads.f1 = ERRO_DE_PERMISSAO;
    await rodar();

    expect(avisos()).toHaveLength(2);
    expect(avisos()[0]).toMatchObject({ status: "resolved" });
    expect(abertos()).toHaveLength(1);
    expect(abertos()[0]!.body).toContain(MENSAGEM_DO_MOTIVO.permissao_insuficiente);
    expect(linha().aviso_de_falha_motivo).toBe("permissao_insuficiente");
  });

  it("um piscar da Meta no meio de um token vencido não troca o aviso", async () => {
    await rodar(3);
    respostaDosLeads.f1 = META_FORA;
    await rodar();
    expect(avisos()).toHaveLength(1);
    expect(abertos()[0]!.body).toContain(MENSAGEM_DO_MOTIVO.token_invalido);
  });
});

describe("quem conserta", () => {
  it("a empresa que lê pela conexão da plataforma é mandada ao suporte", async () => {
    h.tokens = { "org-plataforma": "TOKEN-DA-PLATAFORMA" };
    montar({
      mia_meta_conexao_da_plataforma: [{ id: 1, organizacao_da_conexao: "org-plataforma" }],
    });
    await rodar(3);
    expect(abertos()[0]!.body).toContain("avise o suporte");
  });

  it("com token próprio, não", async () => {
    await rodar(3);
    expect(abertos()[0]!.body).not.toContain("suporte");
  });
});

describe("mais de um formulário", () => {
  it("dois parando juntos: dois avisos, UM push por administrador", async () => {
    montar({
      mia_leads_da_meta_formularios: [
        formulario("form-a", "f1", "Avaliação grátis"),
        formulario("form-b", "f2", "Clareamento"),
      ],
    });
    await rodar(3);
    expect(
      abertos()
        .map((a) => a.ref_id)
        .sort(),
    ).toEqual(["form-a", "form-b"]);
    expect(h.pushes.map((p) => p.usuario).sort()).toEqual(["admin-1", "admin-2"]);
    expect(String(h.pushes[0]!.payload.body)).toContain("Avaliação grátis");
    expect(String(h.pushes[0]!.payload.body)).toContain("Clareamento");
  });

  it("formulário desligado não deixa aviso aberto para trás", async () => {
    await rodar(3);
    expect(abertos()).toHaveLength(1);
    // Desligado pelo banco (a Página mudou de dono) ou por alguém: não há mais
    // leitura que volte a funcionar, e a rodada fecha o aviso.
    linha().ativo = false;
    await rodar();
    expect(abertos()).toHaveLength(0);
  });
});

describe("a regra, sem banco", () => {
  it.each([
    [
      "erro, 2 falhas",
      { status: "erro", motivo: "token_invalido", falhasSeguidas: 2, motivoJaAvisado: null },
      "nada",
    ],
    [
      "erro, 3 falhas",
      { status: "erro", motivo: "token_invalido", falhasSeguidas: 3, motivoJaAvisado: null },
      "avisar",
    ],
    [
      "já avisado",
      {
        status: "erro",
        motivo: "token_invalido",
        falhasSeguidas: 9,
        motivoJaAvisado: "token_invalido",
      },
      "nada",
    ],
    [
      "outro motivo",
      {
        status: "erro",
        motivo: "permissao_insuficiente",
        falhasSeguidas: 4,
        motivoJaAvisado: "token_invalido",
      },
      "trocar",
    ],
    [
      "passa sozinho, 3",
      { status: "erro", motivo: "transitorio", falhasSeguidas: 3, motivoJaAvisado: null },
      "nada",
    ],
    [
      "voltou",
      { status: "sem_novos", motivo: null, falhasSeguidas: 0, motivoJaAvisado: "token_invalido" },
      "limpar",
    ],
    [
      "sucesso sem aviso",
      { status: "sucesso", motivo: null, falhasSeguidas: 0, motivoJaAvisado: null },
      "nada",
    ],
  ] as const)("%s", (_nome, entrada, esperado) => {
    expect(decidirAviso(entrada)).toBe(esperado);
  });
});

describe("o botão do aviso na Central", () => {
  const ID = "00000000-0000-4000-8000-000000000002";
  const leitor = {
    from: () => {
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: () => cadeia,
        in: () => cadeia,
        is: () => cadeia,
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: ID }], error: null }).then(ok),
      };
      return cadeia;
    },
  } as unknown as SupabaseClient;

  it("leva à aba dos formulários, para quem administra", async () => {
    const [item] = await resolverDestinosDosAvisos(leitor, ORG, "admin", [
      { kind: "other", ref_kind: REF_KIND_DO_AVISO, ref_id: ID },
    ]);
    expect(item!.destination).toMatchObject({ estado: "disponivel", href: DESTINO_DO_AVISO });
  });

  it("o atendente vê o aviso, sem o botão para uma tela que o recusaria", async () => {
    const [item] = await resolverDestinosDosAvisos(leitor, ORG, "agent", [
      { kind: "other", ref_kind: REF_KIND_DO_AVISO, ref_id: ID },
    ]);
    expect(item!.destination.estado).toBe("sem_permissao");
  });
});

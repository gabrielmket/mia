// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FORK MIA (.87) · AS PESSOAS DO NEGÓCIO DOS DOIS MODELOS, lidas juntas.
 *
 * O fork grava `envolvido` (papel da lista fechada, cartão aberto); o dossiê do
 * upstream (v1.88, #1506 e #3083) grava `related` (papel em texto livre). A
 * decisão de 24/10/2026: nenhum dado é convertido, e as duas telas enxergam as
 * mesmas pessoas (lib/leads/pessoas-do-negocio.ts). Cada caso abaixo prende uma
 * ponta dessa ponte:
 *
 *   1. o vocabulário: o texto do dossiê que é um dos cinco é lido como o papel;
 *   2. a leitura do fork une os dois, pelo vencedor da fusão, sem o principal,
 *      sem contato de outra organização e sem repetir a pessoa;
 *   3. a rota do fork: gravar tira o vínculo gêmeo do upstream, tirar alcança
 *      os dois tipos e a lápide;
 *   4. a rota do upstream: o dossiê lista o `envolvido` com o rótulo do papel,
 *      tirar alcança os dois tipos, gravar tira o gêmeo do fork.
 */
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => false }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(async () => ({ idioma: estado.idioma })) }));
const estado = vi.hoisted(() => ({ idioma: "pt-BR" as "pt-BR" | "es" }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "U1", idioma: "pt-BR" },
    org: { orgId: ORG, id: ORG, name: "Org", role: "agent" },
  })),
}));

import { createClient } from "@/lib/supabase/server";
import { papelDoTexto } from "@/lib/cartoes/papel";
import {
  alvosDoContato,
  lerPessoasDoNegocio,
  papelDoVinculo,
  papelParaODossie,
  VINCULO_DO_FORK,
  VINCULO_DO_UPSTREAM,
} from "@/lib/leads/pessoas-do-negocio";
import {
  ALVO_DE_CONTATO,
  DELETE as tirarPeloDossie,
  GET as lerPeloDossie,
  POST as gravarPeloDossie,
  VINCULO_DE_CONTATO,
} from "@/app/api/v1/leads/[id]/contatos-relacionados/route";
import { DELETE as tirarPeloCartao, POST as gravarPeloCartao } from "@/app/api/v1/leads/[id]/envolvidos/route";
import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL = "cccccccc-cccc-4ccc-8ccc-cccccccccc00";
const LUANA = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const ROGERIO = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const LAPIDE = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const VENCEDORA = "cccccccc-cccc-4ccc-8ccc-cccccccccc04";
const DE_FORA = "cccccccc-cccc-4ccc-8ccc-cccccccccc05";

function contato(id: string, nome: string, extra: Partial<Linha> = {}): Linha {
  return {
    id,
    organization_id: ORG,
    name: nome,
    display_name: null,
    phone_number: null,
    cargo: null,
    is_merged_into: null,
    is_anonymized: false,
    ...extra,
  };
}

function vinculo(target_id: string, link_kind: string, papel: string | null, created_at: string, extra: Partial<Linha> = {}): Linha {
  return {
    organization_id: ORG,
    lead_id: LEAD,
    target_kind: "contact",
    target_id,
    link_kind,
    metadata: papel === null ? {} : { papel },
    created_at,
    ...extra,
  };
}

let banco: ReturnType<typeof bancoEmMemoria>;

function montar(links: Linha[], contatosExtra: Linha[] = []) {
  banco = bancoEmMemoria({
    crm_leads: [{ id: LEAD, organization_id: ORG, contact_id: PRINCIPAL }],
    contacts: [
      contato(PRINCIPAL, "Márcia Principal"),
      contato(LUANA, "Luana Siqueira"),
      contato(ROGERIO, "Rogério Paes"),
      contato(LAPIDE, "Nome antigo", { is_merged_into: VENCEDORA }),
      contato(VENCEDORA, "Vera Vencedora"),
      contato(DE_FORA, "De Outra Empresa", { organization_id: OUTRA }),
      ...contatosExtra,
    ],
    crm_lead_links: links,
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } }, error: null }) },
    ...banco.cliente,
  } as never);
}

function req(url: string, metodo: string, corpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo), headers: { "content-type": "application/json" } } : {}),
  });
}
const ctx = { params: Promise.resolve({ id: LEAD }) };
const tipos = () => (banco.db.crm_lead_links ?? []).map((l) => `${l.target_id}:${l.link_kind}`).sort();

beforeEach(() => {
  vi.clearAllMocks();
  estado.idioma = "pt-BR";
});

describe("1 · o vocabulário dos dois modelos", () => {
  it("o texto do dossiê que é um dos cinco é lido como o papel, com ou sem acento, em português ou espanhol", () => {
    expect(papelDoTexto("Financeiro")).toBe("financeiro");
    expect(papelDoTexto(" usuário ")).toBe("usuario");
    expect(papelDoTexto("Usuario")).toBe("usuario");
    expect(papelDoTexto("FINANCIERO")).toBe("financeiro");
    expect(papelDoTexto("Otro")).toBe("outro");
    expect(papelDoTexto("decisor")).toBe("decisor");
    expect(papelDoTexto("Pagante")).toBeNull();
    expect(papelDoTexto(null)).toBeNull();
  });

  it("o papel de cada vínculo: o código do fork, o texto do upstream que é da lista, e o que não é", () => {
    expect(papelDoVinculo(VINCULO_DO_FORK, { papel: "financeiro" })).toEqual({ papel: "financeiro", papelLivre: null });
    expect(papelDoVinculo(VINCULO_DO_UPSTREAM, { papel: "Influenciador" })).toEqual({ papel: "influenciador", papelLivre: null });
    expect(papelDoVinculo(VINCULO_DO_UPSTREAM, { papel: "Pagante" })).toEqual({ papel: null, papelLivre: "Pagante" });
    expect(papelDoVinculo(VINCULO_DO_UPSTREAM, {})).toEqual({ papel: null, papelLivre: null });
  });

  it("o dossiê mostra o RÓTULO do papel do fork, traduzido; o texto do upstream sai como foi escrito", () => {
    const t = (s: string) => (s === "Usuário" ? "Usuario" : s);
    expect(papelParaODossie(VINCULO_DO_FORK, { papel: "usuario" }, t)).toBe("Usuario");
    expect(papelParaODossie(VINCULO_DO_FORK, { papel: "decisor" }, (s) => s)).toBe("Decisor");
    expect(papelParaODossie(VINCULO_DO_UPSTREAM, { papel: "Pagante" }, t)).toBe("Pagante");
    expect(papelParaODossie(VINCULO_DO_UPSTREAM, {}, t)).toBeNull();
  });

  it("o vínculo do upstream é o mesmo valor da rota dele (as duas pontas não divergem)", () => {
    expect(VINCULO_DO_UPSTREAM).toBe(VINCULO_DE_CONTATO);
    expect(ALVO_DE_CONTATO).toBe("contact");
  });
});

describe("2 · a leitura do fork une os dois modelos", () => {
  it("os dois tipos, pelo vencedor da fusão, sem o principal, sem contato de fora e sem repetir a pessoa", async () => {
    montar([
      vinculo(LUANA, "envolvido", "financeiro", "2026-10-01T10:00:00Z"),
      vinculo(ROGERIO, "related", "Pagante", "2026-10-02T10:00:00Z"),
      vinculo(LAPIDE, "related", "Decisor", "2026-10-03T10:00:00Z"),
      // O mais novo do mesmo contato não repete a pessoa nem troca o papel.
      vinculo(LUANA, "related", "Outro", "2026-10-04T10:00:00Z"),
      vinculo(PRINCIPAL, "related", null, "2026-10-05T10:00:00Z"),
      vinculo(DE_FORA, "envolvido", "decisor", "2026-10-06T10:00:00Z"),
      // Outros vínculos de contato não são pessoa do negócio.
      vinculo(ROGERIO, "mentioned", null, "2026-10-07T10:00:00Z"),
      vinculo(LUANA, "envolvido", "usuario", "2026-10-08T10:00:00Z", { lead_id: "outro-negocio" }),
    ]);
    const pessoas = await lerPessoasDoNegocio(banco.cliente as never, ORG, LEAD, PRINCIPAL);
    expect(pessoas.map((p) => [p.contato.name, p.vinculo, p.papel, p.papelLivre])).toEqual([
      ["Luana Siqueira", "envolvido", "financeiro", null],
      ["Rogério Paes", "related", null, "Pagante"],
      ["Vera Vencedora", "related", "decisor", null],
    ]);
    expect(pessoas[2]!.contatoId).toBe(VENCEDORA);
  });

  it("falha de leitura volta a lista vazia, nunca derruba o cartão", async () => {
    const quebrado = { from: () => { throw new Error("banco fora"); } };
    expect(await lerPessoasDoNegocio(quebrado as never, ORG, LEAD, PRINCIPAL)).toEqual([]);
    // A ficha do contato também não cai: sem ler as lápides, o contato sozinho.
    expect(await alvosDoContato(quebrado as never, ORG, VENCEDORA)).toEqual([VENCEDORA]);
  });

  it("os alvos de um contato: ele e as lápides das fusões que apontam para ele", async () => {
    montar([]);
    expect(await alvosDoContato(banco.cliente as never, ORG, VENCEDORA)).toEqual([VENCEDORA, LAPIDE]);
    expect(await alvosDoContato(banco.cliente as never, ORG, LUANA)).toEqual([LUANA]);
  });
});

describe("3 · a rota do cartão do fork (/envolvidos)", () => {
  it("gravar pelo cartão tira o vínculo do dossiê do mesmo contato: a pessoa fica com um só, e vale o papel daqui", async () => {
    montar([vinculo(ROGERIO, "related", "Pagante", "2026-10-02T10:00:00Z"), vinculo(LUANA, "related", "Mãe", "2026-10-02T10:00:00Z")]);
    const r = await gravarPeloCartao(req(`/api/v1/leads/${LEAD}/envolvidos`, "POST", { contact_id: ROGERIO, papel: "financeiro" }), ctx);
    expect(r.status).toBe(201);
    expect(tipos()).toEqual([`${LUANA}:related`, `${ROGERIO}:envolvido`]);
  });

  it("tirar pelo cartão tira os dois tipos, e também o vínculo que ficou na lápide da fusão", async () => {
    montar([
      vinculo(ROGERIO, "related", "Pagante", "2026-10-02T10:00:00Z"),
      vinculo(LAPIDE, "envolvido", "decisor", "2026-10-03T10:00:00Z"),
      vinculo(LUANA, "envolvido", "financeiro", "2026-10-04T10:00:00Z"),
    ]);
    expect((await tirarPeloCartao(req(`/api/v1/leads/${LEAD}/envolvidos?contact_id=${ROGERIO}`, "DELETE"), ctx)).status).toBe(200);
    // A tela manda o id do vencedor (é ele que a leitura mostra).
    expect((await tirarPeloCartao(req(`/api/v1/leads/${LEAD}/envolvidos?contact_id=${VENCEDORA}`, "DELETE"), ctx)).status).toBe(200);
    expect(tipos()).toEqual([`${LUANA}:envolvido`]);
    // Quem não está no negócio continua sendo 404.
    expect((await tirarPeloCartao(req(`/api/v1/leads/${LEAD}/envolvidos?contact_id=${ROGERIO}`, "DELETE"), ctx)).status).toBe(404);
  });
});

describe("4 · a rota do dossiê do upstream (/contatos-relacionados)", () => {
  it("lista as pessoas que entraram pelo cartão do fork, com o rótulo do papel no idioma de quem lê", async () => {
    montar([
      vinculo(LUANA, "envolvido", "financeiro", "2026-10-01T10:00:00Z"),
      vinculo(ROGERIO, "related", "Pagante", "2026-10-02T10:00:00Z"),
    ]);
    const corpo = (await (await lerPeloDossie(req(`/api/v1/leads/${LEAD}/contatos-relacionados`, "GET"), ctx)).json()) as {
      data: Array<{ contact_id: string; papel: string | null }>;
    };
    expect(corpo.data.map((p) => [p.contact_id, p.papel])).toEqual([
      [LUANA, "Financeiro"],
      [ROGERIO, "Pagante"],
    ]);
    estado.idioma = "es";
    const emEspanhol = (await (await lerPeloDossie(req(`/api/v1/leads/${LEAD}/contatos-relacionados`, "GET"), ctx)).json()) as {
      data: Array<{ papel: string | null }>;
    };
    // O mesmo rótulo que o cartão do fork mostra em espanhol (o dicionário da tela).
    expect(emEspanhol.data[0]!.papel).toBe("Finanzas");
  });

  it("tirar pelo dossiê tira também o vínculo do cartão do fork", async () => {
    montar([vinculo(LUANA, "envolvido", "financeiro", "2026-10-01T10:00:00Z"), vinculo(ROGERIO, "envolvido", "usuario", "2026-10-01T10:00:00Z")]);
    const r = await tirarPeloDossie(req(`/api/v1/leads/${LEAD}/contatos-relacionados?contact_id=${LUANA}`, "DELETE"), ctx);
    expect(((await r.json()) as { data: { removido: boolean } }).data.removido).toBe(true);
    expect(tipos()).toEqual([`${ROGERIO}:envolvido`]);
  });

  it("gravar pelo dossiê tira o vínculo do cartão do mesmo contato: a pessoa fica com um só", async () => {
    montar([vinculo(LUANA, "envolvido", "financeiro", "2026-10-01T10:00:00Z")]);
    const r = await gravarPeloDossie(req(`/api/v1/leads/${LEAD}/contatos-relacionados`, "POST", { contact_id: LUANA, papel: "Pagante" }), ctx);
    expect(r.status).toBe(201);
    expect(tipos()).toEqual([`${LUANA}:related`]);
    // E as recusas dele continuam: o principal não participa de si mesmo.
    expect((await gravarPeloDossie(req(`/api/v1/leads/${LEAD}/contatos-relacionados`, "POST", { contact_id: PRINCIPAL }), ctx)).status).toBe(409);
  });
});

/**
 * FORK MIA (MIA-367) — OS TRÊS CRONS DE PROPOSTA LEEM TUDO, NÃO AS PRIMEIRAS
 * 1000 LINHAS.
 *
 * `proposal-promised-not-created`, `proposal-expiry` e `proposal-acceptance-rate`
 * liam sem `range`, e o PostgREST corta toda resposta em 1000 linhas sem avisar.
 * Cada caso abaixo foi escrito para REPROVAR com a leitura antiga (conferido no
 * PR) e passar com a nova, que lê página a página por `lerTodasAsPaginas`.
 *
 * O banco é o dublê que corta como o de verdade
 * (`tests/helpers/postgrest-com-teto.ts`): um dublê que devolvesse tudo deixaria
 * a forma antiga passar verde. Módulos, idioma e auditoria ficam de fora: aqui
 * só se mede a leitura.
 *
 * Dado fictício: a Academia Alfa, a Academia Beta e empresas de enchimento.
 *
 *     npx vitest run tests/unit/crons-de-proposta-leem-tudo.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postgrestComTeto, type Linha, type PostgrestComTeto } from "@/tests/helpers/postgrest-com-teto";

const h = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/i18n/idioma-do-aviso", () => ({
  idiomaDoAviso: async () => "pt-BR",
  preencher: (texto: string, valores: Record<string, unknown>) =>
    texto.replace(/\{(\w+)\}/g, (_, chave: string) => String(valores[chave] ?? "")),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: async () => ({ ok: true }) }));
// O módulo Propostas ligado na instalação e em toda empresa: a régua por
// empresa tem os testes dela em cada `route.test.ts`.
vi.mock("@/lib/instalacao/modulos", () => ({
  moduloLigado: async () => true,
  modulosLigados: async () => ["propostas"],
  empresasComModuloDesligado: async () => new Set<string>(),
}));

import { GET as promessaSemProposta } from "@/app/api/v1/cron/proposal-promised-not-created/route";
import { GET as vencimento } from "@/app/api/v1/cron/proposal-expiry/route";
import { GET as taxaDeAceite } from "@/app/api/v1/cron/proposal-acceptance-rate/route";

const ACADEMIA_ALFA = "aaaaaaaa-0000-4000-8000-000000000001";
const ACADEMIA_BETA = "bbbbbbbb-0000-4000-8000-000000000002";
const PROPOSTAS_LIGADAS = { proposals: { enabled: true } };

const pad = (n: number, w = 6) => String(n).padStart(w, "0");
const DIA = 86_400_000;

/** `n` empresas de enchimento, sem Propostas, com id ANTES das academias. */
function enchimento(n: number): Linha[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${pad(i, 12)}`,
    settings: {},
    timezone: "America/Sao_Paulo",
  }));
}

const academia = (id: string): Linha => ({ id, settings: PROPOSTAS_LIGADAS, timezone: "America/Sao_Paulo" });

function rodarCom(banco: PostgrestComTeto) {
  h.admin.mockReturnValue(banco.cliente);
}

const avisos = (banco: PostgrestComTeto, kind: string) =>
  (banco.tabelas.agent_inbox_items ?? []).filter((a) => a.kind === kind);

beforeEach(() => {
  h.admin.mockReset();
});

// ---------------------------------------------------------------------------
// proposal-promised-not-created
// ---------------------------------------------------------------------------

/** Promessa de proposta pendente, vencida há uma semana, criada há um mês. */
function promessa(id: string, org: string, lead: string, venceEm = Date.now() - 7 * DIA): Linha {
  return {
    id,
    organization_id: org,
    lead_id: lead,
    source_kind: "promised_proposal",
    status: "pending",
    due_date: new Date(venceEm).toISOString(),
    created_at: new Date(Date.now() - 30 * DIA).toISOString(),
  };
}

describe("proposal-promised-not-created lê tudo (MIA-367)", () => {
  it("a proposta da Academia Alfa que mora depois da linha 1000 NÃO vira aviso de 'não foi criada'", async () => {
    // 1.500 propostas da Academia Beta gravadas antes: na leitura antiga (todas
    // as propostas da instalação, sem filtro) a da Alfa ficava fora da página.
    const daBeta = Array.from({ length: 1_500 }, (_, i) => ({
      id: `prop-beta-${pad(i)}`,
      organization_id: ACADEMIA_BETA,
      lead_id: `negocio-beta-${pad(i)}`,
      created_at: new Date(Date.now() - 20 * DIA).toISOString(),
    }));
    const banco = postgrestComTeto({
      crm_tasks: [promessa("tarefa-alfa", ACADEMIA_ALFA, "negocio-alfa")],
      crm_proposals: [
        ...daBeta,
        {
          id: "prop-alfa",
          organization_id: ACADEMIA_ALFA,
          lead_id: "negocio-alfa",
          created_at: new Date(Date.now() - 10 * DIA).toISOString(), // depois da promessa
        },
      ],
      organizations: [academia(ACADEMIA_ALFA), academia(ACADEMIA_BETA)],
    });
    rodarCom(banco);

    const res = await promessaSemProposta({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { sinalizadas: 0 } });
    expect(avisos(banco, "proposal_promised_not_created")).toEqual([]);
  });

  it("1.500 promessas vencidas da Beta e a da Alfa depois de 1.000 empresas: todas viram aviso", async () => {
    const daBeta = Array.from({ length: 1_500 }, (_, i) =>
      promessa(`tarefa-beta-${pad(i)}`, ACADEMIA_BETA, `negocio-beta-${pad(i)}`),
    );
    const banco = postgrestComTeto({
      crm_tasks: [
        // Promessas que ainda não venceram vêm antes, e não contam.
        ...Array.from({ length: 300 }, (_, i) =>
          promessa(`tarefa-futura-${pad(i)}`, ACADEMIA_BETA, `negocio-futuro-${pad(i)}`, Date.now() + 7 * DIA),
        ),
        ...daBeta,
        promessa("tarefa-zz-alfa", ACADEMIA_ALFA, "negocio-alfa"),
      ],
      crm_proposals: [],
      // A Alfa e a Beta moram depois da linha 1000 da tabela de empresas.
      organizations: [...enchimento(1_000), academia(ACADEMIA_ALFA), academia(ACADEMIA_BETA)],
    });
    rodarCom(banco);

    const res = await promessaSemProposta({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { sinalizadas: 1_501 } });
    const gravados = avisos(banco, "proposal_promised_not_created");
    expect(gravados).toHaveLength(1_501);
    expect(gravados.filter((a) => a.organization_id === ACADEMIA_ALFA).map((a) => a.ref_id)).toEqual([
      "negocio-alfa",
    ]);
    // Toda leitura de lista paginou, em ordem de `id`.
    for (const p of banco.pedidos.filter((p) => p.tabela !== "agent_inbox_items")) {
      expect(p.range).not.toBeNull();
      expect(p.ordem).toEqual([{ coluna: "id", ascendente: true }]);
    }
  });

  it("leitura das propostas que falha: 500 e nenhum aviso (falha fechada)", async () => {
    const banco = postgrestComTeto(
      {
        crm_tasks: [promessa("tarefa-alfa", ACADEMIA_ALFA, "negocio-alfa")],
        crm_proposals: [],
        organizations: [academia(ACADEMIA_ALFA)],
      },
      { falhaEm: (_n, tabela) => (tabela === "crm_proposals" ? "canceling statement due to statement timeout" : null) },
    );
    rodarCom(banco);

    const res = await promessaSemProposta({} as never);

    expect(res.status).toBe(500);
    expect(avisos(banco, "proposal_promised_not_created")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// proposal-expiry
// ---------------------------------------------------------------------------

function enviada(id: string, org: string, validaAte: string): Linha {
  return {
    id,
    organization_id: org,
    lead_id: `negocio-${id}`,
    contact_id: `contato-${id}`,
    status: "enviada",
    valid_until: validaAte,
  };
}

describe("proposal-expiry lê tudo (MIA-367)", () => {
  it("1.500 propostas vencidas da Beta e a da Alfa no fim: todas vencem, nenhuma fica para trás", async () => {
    const banco = postgrestComTeto({
      crm_proposals: [
        ...Array.from({ length: 1_500 }, (_, i) => enviada(`prop-beta-${pad(i)}`, ACADEMIA_BETA, "2026-01-31")),
        enviada("prop-zz-alfa", ACADEMIA_ALFA, "2026-01-31"),
      ],
      organizations: [academia(ACADEMIA_ALFA), academia(ACADEMIA_BETA)],
    });
    rodarCom(banco);

    const res = await vencimento({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { vencidas: 1_501 } });
    const restantes = banco.tabelas.crm_proposals!.filter((p) => p.status === "enviada");
    expect(restantes).toEqual([]);
    expect(banco.tabelas.crm_proposals!.find((p) => p.id === "prop-zz-alfa")?.status).toBe("vencida");
    expect(avisos(banco, "proposal_expired_notice")).toHaveLength(1_501);
  });

  it("o fuso das empresas ilegível: 500 e nada vence (antes vencia pelo fuso padrão)", async () => {
    const banco = postgrestComTeto(
      {
        crm_proposals: [enviada("prop-alfa", ACADEMIA_ALFA, "2026-01-31")],
        organizations: [academia(ACADEMIA_ALFA)],
      },
      { falhaEm: (_n, tabela) => (tabela === "organizations" ? "permission denied for table organizations" : null) },
    );
    rodarCom(banco);

    const res = await vencimento({} as never);

    expect(res.status).toBe(500);
    expect(banco.tabelas.crm_proposals![0]!.status).toBe("enviada");
    expect(avisos(banco, "proposal_expired_notice")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// proposal-acceptance-rate
// ---------------------------------------------------------------------------

/** `n` propostas com o mesmo status, enviadas ontem, da `org`. */
function decididas(org: string, prefixo: string, n: number, status: "aceita" | "recusada"): Linha[] {
  const ontem = new Date(Date.now() - DIA).toISOString();
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefixo}-${pad(i)}`,
    organization_id: org,
    status,
    sent_at: ontem,
  }));
}

describe("proposal-acceptance-rate lê tudo (MIA-367)", () => {
  it("a taxa é a das propostas TODAS: a Alfa (25%) recebe o aviso, a Beta (80%) não", async () => {
    // Na ordem física, as primeiras 1000 de cada uma contam a história oposta:
    // a Alfa pareceria 100% e a Beta 0%.
    const banco = postgrestComTeto({
      organizations: [academia(ACADEMIA_ALFA), academia(ACADEMIA_BETA)],
      crm_proposals: [
        ...decididas(ACADEMIA_ALFA, "alfa-1", 1_000, "aceita"),
        ...decididas(ACADEMIA_ALFA, "alfa-2", 3_000, "recusada"),
        ...decididas(ACADEMIA_BETA, "beta-1", 1_000, "recusada"),
        ...decididas(ACADEMIA_BETA, "beta-2", 4_000, "aceita"),
      ],
    });
    rodarCom(banco);

    const res = await taxaDeAceite({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { organizacoes_avisadas: 1 } });
    const gravados = avisos(banco, "proposal_acceptance_rate_drop");
    expect(gravados.map((a) => a.organization_id)).toEqual([ACADEMIA_ALFA]);
    expect(String(gravados[0]!.body)).toContain("25%");
  });

  it("a Academia Alfa depois de 1.000 empresas tem a taxa conferida", async () => {
    const banco = postgrestComTeto({
      organizations: [...enchimento(1_000), academia(ACADEMIA_ALFA)],
      crm_proposals: decididas(ACADEMIA_ALFA, "alfa", 10, "recusada"),
    });
    rodarCom(banco);

    const res = await taxaDeAceite({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { organizacoes_avisadas: 1 } });
    expect(avisos(banco, "proposal_acceptance_rate_drop").map((a) => a.organization_id)).toEqual([ACADEMIA_ALFA]);
  });
});

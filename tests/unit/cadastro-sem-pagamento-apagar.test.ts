/**
 * FORK MIA (.96, segunda frente) · "APAGAR O CADASTRO" EM EMPRESAS DO CADASTRO
 * (protótipo "Pagamento no início", tela 4 e decisão 5), com o banco, o Asaas e
 * a exclusão do upstream dublados.
 *
 *   - só depois de 30 dias sem NENHUM pagamento, e com o nome curto digitado;
 *   - a ordem que não deixa nada cobrando: relê a cobrança no Asaas (paga
 *     agora? para tudo), cancela a assinatura lá, prepara no banco (9126) e só
 *     então chama a exclusão do upstream;
 *   - Asaas fora, ou o banco dizendo que pagou: nada é apagado;
 *   - a rota exige a verificação em duas etapas (`requirePlatformAdminEscrita`).
 */
import { describe, expect, it, vi } from "vitest";

const auditoria = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: unknown) => void auditoria.chamadas.push(e)) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/requirePlatformAdmin", async () => {
  const real = await vi.importActual<typeof import("@/lib/auth/requirePlatformAdmin")>("@/lib/auth/requirePlatformAdmin");
  const { EscritaDePlatformAdminNegada } = await import("@/lib/auth/recusa-de-escrita-de-admin");
  return {
    ...real,
    requirePlatformAdminEscrita: async () => {
      throw new EscritaDePlatformAdminNegada("mfa_required");
    },
  };
});

import { POST } from "@/app/api/v1/admin/empresas-do-cadastro/[id]/apagar/route";
import { apagarCadastroSemPagamento } from "@/lib/pagamento-inicial/cadastro-sem-pagamento";
import type { ResultadoDaExclusao } from "@/lib/tenants/exclusao";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-00000000c963";
const ATOR = "00000000-0000-4000-8000-00000000f963";
const AGORA = new Date("2026-11-30T12:00:00Z");

const RESULTADO: ResultadoDaExclusao = {
  organizacao: ORG,
  slug: "studio-sem-pagamento",
  contagens: {},
  canais: [],
  voz: "nao_se_aplica",
  nuvemshop: "nao_se_aplica",
  arquivos: { encontrados: 0, removidos: 0, falhas: 0 },
  usuarios: { removidos: ["u1"], mantidos: [] },
};

function cenario(o: { criada?: string; passo?: Record<string, unknown> | null; assinatura?: Record<string, unknown>; preparo?: Record<string, unknown> } = {}) {
  const ordem: string[] = [];
  const banco = bancoLivre(
    (c: CadeiaLivre) => {
      if (c.tabela === "organizations") {
        return { data: { id: ORG, slug: "studio-sem-pagamento", created_at: o.criada ?? "2026-10-01T12:00:00Z", demonstracao: false } };
      }
      if (c.tabela === "cobranca_assinaturas") {
        return {
          data: {
            organization_id: ORG,
            pagamento_inicial_pendente: true,
            proximo_vencimento: null,
            periodo_pago_desde: null,
            provedor: "asaas",
            provedor_assinatura_id: "sub_1",
            checkout_sessao_id: "pay_1",
            plano_id: "plano-1",
            ...o.assinatura,
          },
        };
      }
      if (c.tabela === "mia_pagamento_inicial") {
        return {
          data:
            o.passo === null
              ? null
              : {
                  organization_id: ORG,
                  modo: "entrada_paga",
                  situacao: "aguardando",
                  forma: "pix",
                  vence_em: "2026-10-02",
                  gerada_em: "2026-10-01T12:05:00Z",
                  cartao_recusas: 0,
                  pago_em: null,
                  forma_paga: null,
                  pagamento_ref: "pay_1",
                  assinatura_ref: "sub_1",
                  ...o.passo,
                },
        };
      }
      return { data: null };
    },
    (nome) => {
      ordem.push(`rpc:${nome}`);
      return { data: o.preparo ?? { pode: true, motivo: "preparada" } };
    },
  );
  const excluir = vi.fn(async () => {
    ordem.push("excluir");
    return RESULTADO;
  });
  return { banco, ordem, excluir };
}

function asaas(rotas: Parameters<typeof asaasFalso>[0], ordem: string[]) {
  const a = asaasFalso(rotas);
  const fetchComOrdem = (async (u: string | URL | Request, init?: RequestInit) => {
    const r = await a.fetch(u, init);
    ordem.push(`asaas:${init?.method ?? "GET"} ${new URL(String(u)).pathname.replace(/^\/v3/, "")}`);
    return r;
  }) as typeof fetch;
  return { a, deps: { fetch: fetchComOrdem, lerChave: async () => CHAVE_DE_TESTE, esperar: async () => undefined, baseDeTeste: null } };
}

const PENDENTE = { "GET /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 297, dueDate: "2026-10-02", subscription: "sub_1" } }, "DELETE /subscriptions/sub_1": { corpo: { deleted: true, id: "sub_1" } } };

describe("apagar o cadastro sem pagamento", () => {
  it("⭐ 31+ dias sem pagamento: relê no Asaas, cancela a assinatura lá, prepara no banco e só então chama a exclusão do upstream", async () => {
    const { banco, ordem, excluir } = cenario();
    const { deps } = asaas(PENDENTE, ordem);
    auditoria.chamadas = [];
    const r = await apagarCadastroSemPagamento(
      banco.cliente as never,
      { orgId: ORG, atorId: ATOR, confirmacao: " studio-sem-pagamento ", requestId: "r" },
      { asaas: deps, agora: () => AGORA, excluir },
    );
    expect(r).toMatchObject({ ok: true, dias: 60 });
    expect(ordem).toEqual(["asaas:GET /payments/pay_1", "asaas:DELETE /subscriptions/sub_1", "rpc:fn_mia_cadastro_sem_pagamento_para_apagar", "excluir"]);
    expect(banco.rpcs[0]?.args).toEqual({ p_org: ORG, p_ator: ATOR, p_dias: 30 });
    expect(excluir).toHaveBeenCalledWith(banco.cliente, expect.objectContaining({ orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento" }));
    expect(auditoria.chamadas).toEqual([expect.objectContaining({ action: "pagamento_inicial.cadastro_apagado", organizationId: null, resourceId: ORG })]);
  });

  it("antes de 30 dias: recusa, e nada vai ao Asaas nem ao banco", async () => {
    const { banco, ordem, excluir } = cenario({ criada: "2026-11-05T12:00:00Z" });
    const { deps } = asaas(PENDENTE, ordem);
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, status: 409, code: "ainda_nao_pode" });
    expect(ordem).toEqual([]);
  });

  it("quem pagou alguma vez nunca é apagado por aqui", async () => {
    const { banco, ordem, excluir } = cenario({ assinatura: { periodo_pago_desde: "2026-10-02T00:00:00Z" } });
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: asaas(PENDENTE, ordem).deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, code: "ainda_nao_pode" });
    expect(ordem).toEqual([]);
  });

  it("o nome curto digitado errado: recusa antes de tocar no Asaas", async () => {
    const { banco, ordem, excluir } = cenario();
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "outra-empresa", requestId: "r" }, { asaas: asaas(PENDENTE, ordem).deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, status: 400, code: "confirmacao_divergente" });
    expect(ordem).toEqual([]);
  });

  it("⭐ o Asaas diz que pagou agora: nada é cancelado nem apagado", async () => {
    const { banco, ordem, excluir } = cenario();
    const { deps } = asaas({ "GET /payments/pay_1": { corpo: { id: "pay_1", status: "RECEIVED", value: 297, dueDate: "2026-10-02", paymentDate: "2026-11-30" } } }, ordem);
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, status: 409, code: "ja_pagou" });
    expect(ordem).toEqual(["asaas:GET /payments/pay_1"]);
    expect(excluir).not.toHaveBeenCalled();
  });

  it("o Asaas não cancela: nada é apagado", async () => {
    const { banco, ordem, excluir } = cenario();
    const { deps } = asaas({ "GET /payments/pay_1": PENDENTE["GET /payments/pay_1"], "DELETE /subscriptions/sub_1": { status: 400, corpo: { errors: [{ code: "x" }] } } }, ordem);
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, status: 503, code: "provedor_indisponivel" });
    expect(banco.rpcs).toEqual([]);
    expect(excluir).not.toHaveBeenCalled();
  });

  it("o banco, sob trava, diz que pagou: a exclusão não é chamada", async () => {
    const { banco, ordem, excluir } = cenario({ preparo: { pode: false, motivo: "ja_pagou" } });
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: asaas(PENDENTE, ordem).deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: false, status: 409, code: "ja_pagou" });
    expect(excluir).not.toHaveBeenCalled();
  });

  it("nunca gerou cobrança: nada a cancelar no Asaas, e segue para o banco e a exclusão", async () => {
    const { banco, ordem, excluir } = cenario({ passo: null, assinatura: { provedor: null, provedor_assinatura_id: null, checkout_sessao_id: null } });
    const r = await apagarCadastroSemPagamento(banco.cliente as never, { orgId: ORG, atorId: ATOR, confirmacao: "studio-sem-pagamento", requestId: "r" }, { asaas: asaas({}, ordem).deps, agora: () => AGORA, excluir });
    expect(r).toMatchObject({ ok: true });
    expect(ordem).toEqual(["rpc:fn_mia_cadastro_sem_pagamento_para_apagar", "excluir"]);
  });
});

describe("a rota", () => {
  it("⭐ sem a verificação em duas etapas da sessão: 403 mfa_required, e nada acontece", async () => {
    const r = await POST(
      new Request(`http://localhost/api/v1/admin/empresas-do-cadastro/${ORG}/apagar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacao: "studio-sem-pagamento" }),
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("mfa_required");
  });
});

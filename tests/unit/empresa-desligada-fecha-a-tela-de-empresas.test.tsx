/**
 * `/app/companies` com a camada POR EMPRESA (#4871, F2 do #3868).
 *
 * Mesmas combinações de `empresa-desligada-fecha-configuracoes-de-propostas`,
 * para o outro módulo da fatia (`crm_b2b`): o layout só consultava a instalação
 * e agora passa a organização do request. O dublê de banco aplica os filtros de
 * verdade, então o `.eq("organization_id", …)` ausente é o que fica vermelho.
 *
 * FORK MIA (fusão da v1.122): no fork `/app/companies` é o cadastro ÚNICO de
 * empresa e existe sem o módulo `crm_b2b` (docs/fork/empresa-unica.md, seção 4).
 * O modo de venda esconde a PORTA no menu; o layout não tranca a tela, nem pela
 * instalação nem pela empresa. As mesmas quatro combinações do upstream ficam,
 * com a resposta do fork: a tela existe em todas e o layout nem lê o módulo.
 * As ROTAS do módulo (`lib/crm-b2b/route-helpers.ts`) fecham pela INSTALAÇÃO:
 * todas chamam `seModuloB2bDesligado(requestId)` sem a empresa, como no
 * upstream. O único consumidor da camada por empresa em `crm_b2b` era este
 * layout, e o fork o tira de propósito (revisão do PR #127, ponto 1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAVE_DO_MODULO } from "@/lib/instalacao/modulos";
import { bancoDeDuasEmpresas } from "@/tests/helpers/postgrest-de-duas-empresas";

const ORG_A = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  banco: { cliente: {} as unknown },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  activeOrg: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(async () => ({ id: "u-1" })),
  resolveActiveOrg: mocks.activeOrg,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.banco.cliente }));

import Layout from "@/app/app/companies/layout";

function mundo(opcoes: { instalacaoLigada: boolean; linhaDaEmpresa?: "ligado" | "desligado" }) {
  const banco = bancoDeDuasEmpresas({
    platform_config: opcoes.instalacaoLigada
      ? [{ chave: CHAVE_DO_MODULO.crm_b2b, valor: "ligado" }]
      : [{ chave: CHAVE_DO_MODULO.crm_b2b, valor: "desligado" }],
    organization_modules:
      opcoes.linhaDaEmpresa === undefined
        ? []
        : [{ organization_id: ORG_A, modulo: "crm_b2b", estado: opcoes.linhaDaEmpresa }],
  });
  mocks.banco.cliente = banco.cliente;
  return banco;
}

describe("FORK MIA: a tela de Empresas existe com o módulo ligado ou desligado", () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.activeOrg.mockReset();
    mocks.activeOrg.mockResolvedValue({ orgId: ORG_A, role: "admin" });
  });

  it("instalação ligada + empresa desligada: a tela existe, e o layout não leu o módulo", async () => {
    const banco = mundo({ instalacaoLigada: true, linhaDaEmpresa: "desligado" });

    const r = await Layout({ children: "tela" });

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(r).toBe("tela");
    expect(banco.chamadas.some((c) => c.tabela === "organization_modules")).toBe(false);
  });

  it("instalação ligada + empresa ligada: a tela existe", async () => {
    mundo({ instalacaoLigada: true, linhaDaEmpresa: "ligado" });
    const r = await Layout({ children: "tela" });
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(r).toBe("tela");
  });

  it("instalação ligada + empresa sem linha: a tela existe (controle)", async () => {
    mundo({ instalacaoLigada: true });
    const r = await Layout({ children: "tela" });
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(r).toBe("tela");
  });

  it("instalação DESLIGADA + empresa ligada: a tela existe, porque o módulo não é condição dela no fork", async () => {
    mundo({ instalacaoLigada: false, linhaDaEmpresa: "ligado" });
    const r = await Layout({ children: "tela" });
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(r).toBe("tela");
  });
});

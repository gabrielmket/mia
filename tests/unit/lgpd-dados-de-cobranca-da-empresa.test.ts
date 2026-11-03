/**
 * FORK MIA (.99) · A CÓPIA DOS DADOS DE COBRANÇA DA EMPRESA (LGPD, o acesso do titular).
 *
 * Quem assina a MIA não é um contato: os dados fiscais dele (na pessoa física, o CPF, o
 * nome completo, o endereço e o WhatsApp), o passo do pagamento e o final do cartão
 * saíam na anonimização da empresa inteira (9120, 9121, 9125) e não saíam em cópia
 * nenhuma. Aqui:
 *
 *   - a cópia leva o documento INTEIRO, o endereço, o telefone, o final e a bandeira do
 *     cartão e quando os dados foram ao Asaas; e nada do Pix, do boleto, da fatura nem
 *     dos ids do Asaas (instrumento de pagamento, não dado da pessoa);
 *   - é de UMA empresa só (controle negativo: a vizinha não entra);
 *   - empresa sem os dados devolve as seções vazias, e empresa que não existe, `null`;
 *   - leitura que falha lança (cópia incompleta não sai como completa);
 *   - a rota pede a verificação em duas etapas, responde 404 com a cobrança desligada,
 *     entrega o arquivo para baixar e audita sem o conteúdo.
 *
 * Que a cópia leia TODA tabela que a empresa redigida perde é a cerca
 * `tests/unit/lgpd-empresa-redigida-exporta.test.ts`. Só dado fictício.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as RequirePlatformAdmin from "@/lib/auth/requirePlatformAdmin";
import { EscritaDePlatformAdminNegada } from "@/lib/auth/recusa-de-escrita-de-admin";
import { exportarDadosDeCobrancaDaEmpresa } from "@/lib/lgpd/export-collector";

import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  escrita: vi.fn(),
  ligada: true,
  audit: vi.fn(async () => undefined),
  banco: null as null | { cliente: unknown },
}));
vi.mock("@/lib/auth/requirePlatformAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof RequirePlatformAdmin>()),
  requirePlatformAdminEscrita: h.escrita,
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => h.ligada }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco?.cliente }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const ORG = "91999199-0000-4000-8000-00000000000a";
const VIZINHA = "91999199-0000-4000-8000-00000000000b";
const SEM_DADOS = "91999199-0000-4000-8000-00000000000c";
const PLATAFORMA = "91999199-1111-4000-8000-0000000000f1";
const CPF_DE_TESTE = "52998224725";

const fiscais = (org: string, m: Partial<Linha> = {}): Linha => ({
  organization_id: org,
  tipo: "pf",
  documento: CPF_DE_TESTE,
  razao_social: "Fulana de Teste",
  cep: "30130010",
  logradouro: "Rua das Flores",
  numero: "100",
  complemento: "sala 2",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  inscricao_municipal: null,
  inscricao_estadual: null,
  telefone: "5531988880000",
  asaas_sincronizado_em: "2026-10-29T12:05:00Z",
  created_at: "2026-10-29T12:00:00Z",
  updated_at: "2026-10-29T12:00:00Z",
  ...m,
});

function montar() {
  const b = bancoEmMemoria({
    organizations: [
      { id: ORG, display_name: "Estúdio de Teste", legal_name: "Fulana de Teste", cnpj: null, created_at: "2026-10-29T12:00:00Z" },
      { id: VIZINHA, display_name: "Vizinha de Teste", legal_name: "Vizinha Ltda", cnpj: "11222333000181", created_at: "2026-10-20T12:00:00Z" },
      { id: SEM_DADOS, display_name: "Isenta de Teste", legal_name: null, cnpj: null, created_at: "2026-10-01T12:00:00Z" },
    ],
    mia_dados_fiscais: [fiscais(ORG), fiscais(VIZINHA, { tipo: "pj", documento: "11222333000181", razao_social: "Vizinha Ltda" })],
    mia_pagamento_inicial: [
      {
        organization_id: ORG,
        modo: "entrada_paga",
        situacao: "pago",
        forma: "cartao",
        pagamento_ref: "pay_teste_1",
        assinatura_ref: "sub_teste_1",
        valor_cents: 29_700,
        primeira_cobranca_em: "2026-10-29",
        vence_em: "2026-10-29",
        fatura_url: "https://pagamento.exemplo.test/i/1",
        pix_copia_e_cola: "00020126-pix-de-teste",
        boleto_linha: "34191.79001 01043.510047",
        boleto_url: "https://pagamento.exemplo.test/b/1",
        cartao_final: "1111",
        cartao_bandeira: "VISA",
        cartao_recusas: 0,
        cartao_recusado_em: null,
        cartao_recorrente: "ok",
        gerada_em: "2026-10-29T12:01:00Z",
        pago_em: "2026-10-29T12:02:00Z",
        forma_paga: "cartao",
        lembrete_enviado_em: null,
        created_at: "2026-10-29T12:01:00Z",
      },
    ],
    mia_cartao_das_mensalidades: [
      { organization_id: ORG, cartao_final: "4242", cartao_bandeira: "MASTERCARD", assinatura_ref: "sub_teste_1", trocado_em: "2026-11-01T10:00:00Z", trocado_por: PLATAFORMA },
    ],
    mia_nota_da_assinatura: [{ organization_id: ORG, assinatura_ref: "sub_teste_1", configurada_em: "2026-10-29T12:03:00Z", tentativas: 1, ultimo_erro: null }],
  });
  h.banco = b;
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ligada = true;
  h.escrita.mockResolvedValue({ user: { id: PLATAFORMA }, platformAdmin: { scope: "full" } });
  montar();
});

describe("a cópia dos dados de cobrança", () => {
  it("⭐ leva o documento inteiro, o endereço, o telefone, o cartão e o Asaas, e nada do instrumento de pagamento", async () => {
    const copia = (await exportarDadosDeCobrancaDaEmpresa(h.banco?.cliente as never, ORG)) as Record<string, Record<string, unknown>>;
    expect(copia.empresa).toMatchObject({ nome: "Estúdio de Teste", razao_social: "Fulana de Teste" });
    expect(copia.dados_fiscais).toMatchObject({
      tipo: "pf",
      documento: CPF_DE_TESTE,
      razao_social: "Fulana de Teste",
      cep: "30130010",
      logradouro: "Rua das Flores",
      numero: "100",
      complemento: "sala 2",
      cidade: "Belo Horizonte",
      uf: "MG",
      telefone: "5531988880000",
      gravados_em: "2026-10-29T12:00:00Z",
    });
    expect(copia.pagamento_do_inicio).toMatchObject({ modo: "entrada_paga", situacao: "pago", forma_paga: "cartao", cartao_final: "1111", cartao_bandeira: "VISA", valor_cents: 29_700 });
    expect(copia.cartao_das_mensalidades).toEqual({ cartao_final: "4242", cartao_bandeira: "MASTERCARD", trocado_em: "2026-11-01T10:00:00Z" });
    expect(copia.compartilhado_com_o_asaas).toEqual({
      dados_fiscais_enviados_em: "2026-10-29T12:05:00Z",
      nota_fiscal_pedida_em: "2026-10-29T12:03:00Z",
    });
    const texto = JSON.stringify(copia);
    for (const fora of ["00020126-pix-de-teste", "34191.79001", "pagamento.exemplo.test", "pay_teste_1", "sub_teste_1", PLATAFORMA]) {
      expect(texto, fora).not.toContain(fora);
    }
  });

  it("controle negativo: é de uma empresa só, e a vizinha não entra", async () => {
    const texto = JSON.stringify(await exportarDadosDeCobrancaDaEmpresa(h.banco?.cliente as never, ORG));
    expect(texto).not.toContain("11222333000181");
    expect(texto).not.toContain("Vizinha");
  });

  it("empresa sem os dados devolve as seções vazias; empresa que não existe, null", async () => {
    expect(await exportarDadosDeCobrancaDaEmpresa(h.banco?.cliente as never, SEM_DADOS)).toMatchObject({
      dados_fiscais: null,
      pagamento_do_inicio: null,
      cartao_das_mensalidades: null,
      compartilhado_com_o_asaas: { dados_fiscais_enviados_em: null, nota_fiscal_pedida_em: null },
    });
    expect(await exportarDadosDeCobrancaDaEmpresa(h.banco?.cliente as never, "91999199-0000-4000-8000-0000000000ff")).toBeNull();
  });

  it("leitura que falha lança, em vez de entregar a cópia pela metade", async () => {
    const b = h.banco?.cliente as { from: (t: string) => unknown };
    const comFalha = {
      from: (t: string) => {
        if (t !== "mia_dados_fiscais") return b.from(t);
        const falha = { data: null, error: { code: "57014", message: "tempo esgotado" } };
        const cadeia = { select: () => cadeia, eq: () => cadeia, maybeSingle: async () => falha };
        return cadeia;
      },
    };
    await expect(exportarDadosDeCobrancaDaEmpresa(comFalha as never, ORG)).rejects.toThrow(/57014/);
  });
});

describe("GET /api/v1/admin/tenants/[id]/dados-de-cobranca", () => {
  const chamar = async (id: string) => {
    const { GET } = await import("@/app/api/v1/admin/tenants/[id]/dados-de-cobranca/route");
    return GET(new NextRequest(`http://localhost:3000/api/v1/admin/tenants/${id}/dados-de-cobranca`), { params: Promise.resolve({ id }) });
  };

  it("⭐ entrega o arquivo para baixar e audita só a empresa, sem o conteúdo", async () => {
    const res = await chamar(ORG);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="dados-de-cobranca-${ORG}.json"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { dados_fiscais: { documento: string } }).dados_fiscais.documento).toBe(CPF_DE_TESTE);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "area_de_cobranca.dados_exportados", actorUserId: PLATAFORMA, actingAsPlatformAdmin: true, organizationId: ORG }),
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(CPF_DE_TESTE);
  });

  it("sem a verificação em duas etapas: 403 mfa_required, nada lido e nada auditado", async () => {
    h.escrita.mockRejectedValue(new EscritaDePlatformAdminNegada("mfa_required"));
    const res = await chamar(ORG);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("mfa_required");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("cobrança desligada, id que não é uuid ou empresa que não existe: 404", async () => {
    h.ligada = false;
    expect((await chamar(ORG)).status).toBe(404);
    h.ligada = true;
    expect((await chamar("nao-e-uuid")).status).toBe(404);
    expect((await chamar("91999199-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect(h.audit).not.toHaveBeenCalled();
  });
});

/**
 * FORK MIA (.98) · CUPONS, PARCEIROS E REPASSES NO MCP DE PLATAFORMA
 * (docs/fork/mcp-de-implantacao.md, "Cupons, parceiros e comissão (.98)").
 * O que se prova:
 *   - as seis ferramentas, cada uma com a operação do estrago (leitura é livre);
 *   - os exemplos passam no esquema, e a auditoria nunca leva documento nem Pix;
 *   - a leitura mascara o documento e a chave Pix;
 *   - garantir é idempotente, pelo CPF ou CNPJ e pelo código;
 *   - marcar como pago sem o anexo recusa ensinando; o MCP não anexa nem manda dinheiro;
 *   - com a cobrança desligada, recusa;
 *   - `plataforma_ver_cliente` mostra o cupom e o parceiro.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const cobrancaLigada = vi.hoisted(() => ({ valor: true }));
vi.mock("@/lib/instalacao/modulos", async (original) => ({
  ...(await original<typeof import("@/lib/instalacao/modulos")>()),
  moduloLigado: async () => cobrancaLigada.valor,
}));
vi.mock("@/lib/planos-mia/leitura", async (original) => ({
  ...(await original<typeof import("@/lib/planos-mia/leitura")>()),
  lerPlanosComModulos: async () => [
    { id: "22222222-2222-4222-8222-222222222222", nome: "Profissional", arquivado_em: null },
    { id: "33333333-3333-4333-8333-333333333333", nome: "Velho", arquivado_em: "2026-01-01T00:00:00Z" },
  ],
}));

import { lerCupomEParceiroDaEmpresa } from "@/lib/cupons/na-ficha";
import { FERRAMENTA_POR_NOME, FERRAMENTAS } from "@/lib/mcp-plataforma/ferramentas";
import type { ContextoDaFerramenta } from "@/lib/mcp-plataforma/tipos";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const PLANO = "22222222-2222-4222-8222-222222222222";
const AUTOR = "99999999-9999-4999-8999-999999999999";
const ferramenta = (nome: string) => {
  const f = FERRAMENTA_POR_NOME.get(nome);
  if (!f) throw new Error(`sem a ferramenta ${nome}`);
  return f;
};

function contexto(tabelas: Record<string, Array<Record<string, unknown>>> = {}): { ctx: ContextoDaFerramenta; b: ReturnType<typeof bancoEmMemoria> } {
  const b = bancoEmMemoria({
    mia_parceiros: [],
    mia_cupons: [],
    mia_cupom_da_empresa: [],
    mia_comissoes: [],
    mia_repasses: [],
    mia_setup_da_empresa: [],
    platform_config: [],
    cobranca_planos: [{ id: PLANO, nome: "Profissional" }],
    ...tabelas,
  });
  return { ctx: { admin: b.cliente as never, autorUserId: AUTOR, tokenId: "t1", requestId: "r1" }, b };
}

const PARCEIRO = {
  nome: "Parceira Exemplo",
  documento: "529.982.247-25",
  email: "parceira@exemplo.com.br",
  chave_pix: "parceira@exemplo.com.br",
  comissao_pct: 20,
  comissao_meses: 12,
  comissao_setup_pct: 30,
};

describe("a lista", () => {
  it("as seis, cada uma com a operação do estrago", () => {
    expect(FERRAMENTAS.filter((f) => /parceiro|cupom|cupons|repasse/.test(f.name)).map((f) => [f.name, f.operacao])).toEqual([
      ["plataforma_garantir_parceiro", "gerir_cobranca"],
      ["plataforma_ver_parceiros", null],
      ["plataforma_garantir_cupom", "gerir_planos"],
      ["plataforma_ver_cupons", null],
      ["plataforma_ver_repasses", null],
      ["plataforma_marcar_repasse_pago", "gerir_cobranca"],
    ]);
  });
  it("os exemplos passam no esquema", () => {
    for (const nome of ["plataforma_garantir_parceiro", "plataforma_garantir_cupom", "plataforma_marcar_repasse_pago"]) {
      const f = ferramenta(nome);
      expect(z.object(f.inputSchema).safeParse(f.exemplo).success, nome).toBe(true);
    }
  });
  it("a auditoria das chamadas não leva documento, Pix nem e-mail do parceiro", () => {
    const redigido = ferramenta("plataforma_garantir_parceiro").redigirParaAuditoria?.(PARCEIRO);
    expect(JSON.stringify(redigido)).not.toContain("529.982");
    expect(JSON.stringify(redigido)).not.toContain("parceira@");
  });
  it("a descrição diz o que não faz: dinheiro e anexo", () => {
    expect(ferramenta("plataforma_marcar_repasse_pago").description).toMatch(/nunca manda dinheiro/);
    expect(ferramenta("plataforma_marcar_repasse_pago").description).toMatch(/anexo entra só pela tela/);
  });
});

describe("plataforma_garantir_parceiro e plataforma_ver_parceiros", () => {
  it("cria, repetir não regrava, e a leitura mascara o documento e o Pix", async () => {
    const { ctx, b } = contexto();
    const criado = (await ferramenta("plataforma_garantir_parceiro").handler(ctx, PARCEIRO)) as { parceiro: Record<string, unknown>; criado: boolean; mudou: boolean };
    expect(criado).toMatchObject({ criado: true, mudou: true });
    expect(criado.parceiro.documento).toBe("***.982.***-25");
    expect(JSON.stringify(criado)).not.toContain("52998224725");
    expect(b.db.mia_parceiros?.[0]).toMatchObject({ documento: "52998224725", tipo_documento: "cpf", created_by: AUTOR });
    const denovo = (await ferramenta("plataforma_garantir_parceiro").handler(ctx, PARCEIRO)) as { mudou: boolean };
    expect(denovo.mudou).toBe(false);
    expect(b.db.mia_parceiros).toHaveLength(1);

    const lidos = (await ferramenta("plataforma_ver_parceiros").handler(ctx, {})) as { parceiros: Array<Record<string, unknown>> };
    expect(lidos.parceiros[0]).toMatchObject({ nome: "Parceira Exemplo", comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, clientes: 0, chave_pix: "par***.br" });
    expect(JSON.stringify(lidos)).not.toContain("52998224725");
    expect(JSON.stringify(lidos)).not.toContain("parceira@exemplo.com.br\",\"comissao"); // a chave nunca inteira
  });
  it("o CPF com o dígito errado recusa ensinando", async () => {
    const { ctx } = contexto();
    await expect(ferramenta("plataforma_garantir_parceiro").handler(ctx, { ...PARCEIRO, documento: "111.111.111-11" })).rejects.toThrow(/não confere/);
  });
  it("com a cobrança desligada, recusa", async () => {
    cobrancaLigada.valor = false;
    const { ctx } = contexto();
    await expect(ferramenta("plataforma_garantir_parceiro").handler(ctx, PARCEIRO)).rejects.toThrow(/cobrança está desligada/);
    await expect(ferramenta("plataforma_ver_cupons").handler(ctx, {})).rejects.toThrow(/cobrança está desligada/);
    cobrancaLigada.valor = true;
  });
});

describe("plataforma_garantir_cupom e plataforma_ver_cupons", () => {
  it("cria pelo nome do plano e devolve o link; repetir não regrava; ativo:false pausa sem apagar", async () => {
    const { ctx, b } = contexto();
    const entrada = { codigo: "joao10", beneficio: "pct", valor: 10, meses: 3, setup_tipo: "pct", setup_valor: 20, planos: ["profissional"] };
    const r = (await ferramenta("plataforma_garantir_cupom").handler(ctx, entrada)) as { cupom: Record<string, unknown>; criado: boolean };
    expect(r.criado).toBe(true);
    expect(r.cupom).toMatchObject({ codigo: "JOAO10", o_que_da: "10% de desconto nas 3 primeiras mensalidades", setup: "20% de desconto no setup", situacao: "ativo", planos: ["Profissional"] });
    expect(String(r.cupom.link)).toContain("/precos?cupom=JOAO10");
    expect(b.db.mia_cupons?.[0]?.planos).toEqual([PLANO]);
    expect(((await ferramenta("plataforma_garantir_cupom").handler(ctx, entrada)) as { mudou: boolean }).mudou).toBe(false);
    const pausado = (await ferramenta("plataforma_garantir_cupom").handler(ctx, { ...entrada, ativo: false })) as { cupom: Record<string, unknown>; mudou: boolean };
    expect(pausado).toMatchObject({ mudou: true, cupom: { situacao: "pausado" } });
    expect(b.db.mia_cupons).toHaveLength(1);
    const lidos = (await ferramenta("plataforma_ver_cupons").handler(ctx, { codigo: "JOAO10" })) as { cupom: Record<string, unknown> };
    expect(lidos.cupom).toMatchObject({ usos: 0, situacao: "pausado" });
  });
  it("plano que não existe ou arquivado recusa dizendo os ativos", async () => {
    const { ctx } = contexto();
    await expect(ferramenta("plataforma_garantir_cupom").handler(ctx, { codigo: "ABC", beneficio: "dias", valor: 30, planos: ["Velho"] })).rejects.toThrow(/Os planos ativos são: Profissional/);
  });
  it("dias grátis ignora os meses", async () => {
    const { ctx, b } = contexto();
    await ferramenta("plataforma_garantir_cupom").handler(ctx, { codigo: "DIAS30", beneficio: "dias", valor: 30, meses: 3, planos: [PLANO] });
    expect(b.db.mia_cupons?.[0]).toMatchObject({ beneficio: "dias", valor: 30, meses: null });
  });
});

describe("plataforma_ver_repasses e plataforma_marcar_repasse_pago", () => {
  const PARCEIRO_ID = "44444444-4444-4444-8444-444444444444";
  const REPASSE = "55555555-5555-4555-8555-555555555555";
  const tabelas = (anexo: string | null) => ({
    mia_parceiros: [{ id: PARCEIRO_ID, nome: "Parceira", tipo_documento: "cpf", documento: "52998224725", email: "p@exemplo.com.br", chave_pix: "parceira@exemplo.com.br", comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, ativo: true, anonimizado_em: null }],
    mia_repasses: [{ id: REPASSE, parceiro_id: PARCEIRO_ID, competencia: "2026-10-01", total_cents: 9_632, fechado_em: "2026-11-01T12:00:00Z", extrato_enviado_em: null, extrato_erro: null, anexo_path: anexo, anexo_nome: anexo, anexo_em: anexo ? "2026-11-02T12:00:00Z" : null, anexo_removido_em: null, pago_em: null, pago_por: null }],
    mia_comissoes: [{ id: "c1", parceiro_id: PARCEIRO_ID, repasse_id: REPASSE, organization_id: null, tipo: "mensalidade", pago_em: "2026-10-10", competencia: "2026-10-01", valor_pago_cents: 53_730, aliquota_pct: 10, imposto_cents: 5_373, taxa_cents: 199, liquido_cents: 48_158, comissao_pct: 20, comissao_cents: 9_632 }],
  });

  it("o mês por parceiro, com a chave mascarada e a situação", async () => {
    const { ctx } = contexto(tabelas(null));
    const r = (await ferramenta("plataforma_ver_repasses").handler(ctx, { competencia: "2026-10" })) as { repasses: Array<Record<string, unknown>>; total: number };
    expect(r.total).toBe(96.32);
    expect(r.repasses[0]).toMatchObject({ repasse_id: REPASSE, situacao: "aguardando_nota", total: 96.32, chave_pix: "par***.br", tem_anexo: false, mensalidades: { quantas: 1, pago: 537.3, imposto: 53.73, taxa: 1.99, liquido: 481.58, comissao: 96.32 } });
    expect(JSON.stringify(r)).not.toContain("parceira@exemplo.com.br");
  });
  it("sem o anexo, recusa; com ele, marca com a data e o autor do token, e repetir não muda", async () => {
    const sem = contexto(tabelas(null));
    await expect(ferramenta("plataforma_marcar_repasse_pago").handler(sem.ctx, { repasse_id: REPASSE })).rejects.toThrow(/nota ou o recibo anexado/);
    expect(sem.b.db.mia_repasses?.[0]?.pago_em).toBeNull();
    const com = contexto(tabelas("a/b.pdf"));
    const r = (await ferramenta("plataforma_marcar_repasse_pago").handler(com.ctx, { repasse_id: REPASSE })) as { ja_estava: boolean; pago_em: string };
    expect(r.ja_estava).toBe(false);
    expect(com.b.db.mia_repasses?.[0]).toMatchObject({ pago_por: AUTOR });
    expect(((await ferramenta("plataforma_marcar_repasse_pago").handler(com.ctx, { repasse_id: REPASSE })) as { ja_estava: boolean }).ja_estava).toBe(true);
  });
});

describe("plataforma_ver_cliente", () => {
  it("a descrição cita o cupom e o parceiro", () => {
    expect(ferramenta("plataforma_ver_cliente").description).toContain("cupom_e_parceiro");
  });
  it("o retrato: o cupom, o parceiro com a comissão fixada, o setup e as comissões, sem documento nem Pix", async () => {
    const ORG = "66666666-6666-4666-8666-666666666666";
    const PARCEIRO_ID = "44444444-4444-4444-8444-444444444444";
    const { ctx } = contexto({
      mia_parceiros: [{ id: PARCEIRO_ID, nome: "Parceira", tipo_documento: "cpf", documento: "52998224725", email: "p@exemplo.com.br", chave_pix: "chave-pix-inteira", comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, ativo: true, anonimizado_em: null }],
      mia_cupom_da_empresa: [{ organization_id: ORG, cupom_id: "c", parceiro_id: PARCEIRO_ID, parceiro_desde: "2026-10-01T12:00:00Z", codigo: "JOAO10", beneficio: "pct", valor: 10, meses: 3, setup_tipo: "pct", setup_valor: 20, planos: [PLANO], comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, termos_fixados_em: "2026-10-02T12:00:00Z", origem: "cadastro", aplicado_em: "2026-10-01T12:00:00Z" }],
      mia_setup_da_empresa: [{ organization_id: ORG, situacao: "aguardando", valor_cents: 120_000, preco_cents: 150_000, fatura_url: "https://asaas/i/1", nota_ref: null, nota_erro: null, pago_em: null }],
      mia_comissoes: [{ organization_id: ORG, comissao_cents: 9_632 }],
    });
    const r = await lerCupomEParceiroDaEmpresa(ctx.admin, ORG);
    expect(r.cupom).toMatchObject({ codigo: "JOAO10", o_que_da: "10% de desconto nas 3 primeiras mensalidades", setup: "20% de desconto no setup" });
    expect(r.parceiro).toMatchObject({ nome: "Parceira", comissao_pct: 20, comissao_meses: 12 });
    expect(r.setup).toMatchObject({ situacao: "aguardando", link: "https://asaas/i/1" });
    expect(r.comissoes).toEqual({ lancadas: 1, total_cents: 9_632 });
    expect(JSON.stringify(r)).not.toContain("52998224725");
    expect(JSON.stringify(r)).not.toContain("chave-pix-inteira");
  });
});

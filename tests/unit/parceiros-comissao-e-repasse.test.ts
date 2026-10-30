/**
 * FORK MIA (.98) · A comissão de cada cobrança paga e o repasse do mês
 * (lib/parceiros/; docs/fork/cupons-e-parceiros.md, seções 5 e 6). Banco em
 * memória; o Asaas real nunca é chamado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PagamentoDoCliente } from "@/lib/asaas-mia/pagamentos";
import { exportarDadosDoParceiro } from "@/lib/lgpd/export-collector";
import { lancarComissoesDoCliente, ehMensalidade } from "@/lib/parceiros/comissoes";
import { montarExtrato, mandarExtratos } from "@/lib/parceiros/extrato";
import { anexarAoRepasse, competenciaParaFechar, fecharMes, marcarRepassePago, planilhaDoMes, prazosDoRepasse, situacaoDoRepasse, totaisDosLancamentos, type LancamentoDoRepasse } from "@/lib/parceiros/repasses";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/branding/saida", () => ({
  emailDeSuporte: async () => "suporte@exemplo.com.br",
  marcaDaSaida: async () => ({ nome: "Sistema", accent: "#000", accentFg: "#fff", logoUrl: null }),
  NEUTROS_DE_SAIDA: { fundo: "#fff", texto: "#000", suave: "#666", linha: "#ccc" },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const PARCEIRO = "22222222-2222-4222-8222-222222222222";
const CUPOM = "33333333-3333-4333-8333-333333333333";
const AGORA = new Date("2026-11-01T15:00:00Z");

const paga = (m: Partial<PagamentoDoCliente> & { ref: string }): PagamentoDoCliente => ({
  status: "RECEIVED",
  valorCents: 53_730,
  liquidoCents: 53_730 - 199,
  vencimento: "2026-10-10",
  pagoEm: "2026-10-10",
  assinaturaRef: "sub_1",
  referenciaExterna: null,
  forma: "PIX",
  faturaUrl: null,
  pago: true,
  estornado: false,
  aberto: false,
  ...m,
});

const uso = (m: Record<string, unknown> = {}) => ({
  organization_id: ORG,
  cupom_id: CUPOM,
  parceiro_id: PARCEIRO,
  parceiro_desde: "2026-10-01T12:00:00Z",
  codigo: "JOAO10",
  beneficio: "pct",
  valor: 10,
  meses: 3,
  setup_tipo: "nenhum",
  setup_valor: 0,
  planos: [],
  comissao_pct: null,
  comissao_meses: null,
  comissao_setup_pct: null,
  termos_fixados_em: null,
  primeira_mensalidade_em: null,
  origem: "cadastro",
  aplicado_em: "2026-10-01T12:00:00Z",
  ...m,
});

function banco(o: { aliquota?: number | null; uso?: Record<string, unknown> | null; setup?: Record<string, unknown>; parceiro?: Record<string, unknown>; cupomProprio?: number | null; comissoes?: Array<Record<string, unknown>> } = {}) {
  const aliquota = o.aliquota === undefined ? 10 : o.aliquota;
  return bancoEmMemoria({
    mia_cupom_da_empresa: o.uso === null ? [] : [o.uso ?? uso()],
    mia_parceiros: [{ id: PARCEIRO, nome: "João Mendes", tipo_documento: "cpf", documento: "52998224725", email: "joao@exemplo.com.br", chave_pix: "joao@exemplo.com.br", comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, ativo: true, anonimizado_em: null, ...o.parceiro }],
    mia_cupons: [{ id: CUPOM, codigo: "JOAO10", comissao_pct: o.cupomProprio ?? null, parceiro_id: PARCEIRO }],
    platform_config: aliquota === null ? [] : [{ chave: "MIA_COMISSAO_DOS_PARCEIROS", valor: JSON.stringify({ aliquota_pct: aliquota, dia_fechamento: 1, dia_nota: 5, dia_pagamento: 10 }) }],
    cobranca_assinaturas: [{ organization_id: ORG, provedor: "asaas", provedor_cliente_id: "cus_1" }],
    mia_setup_da_empresa: o.setup ? [o.setup] : [],
    mia_comissoes: o.comissoes ?? [],
    mia_repasses: [],
    organizations: [{ id: ORG, display_name: "Clínica Bem Viver" }],
  });
}

const lancar = (b: ReturnType<typeof banco>, pagamentos: PagamentoDoCliente[], agora = AGORA) =>
  lancarComissoesDoCliente(b.cliente as never, ORG, { pagamentos, agora });
const comissoesDe = (b: ReturnType<typeof banco>) => b.db.mia_comissoes ?? [];

describe("a comissão nasce quando a cobrança é paga", () => {
  it("sobre o líquido: valor pago, menos o imposto, menos a taxa real; fixa os termos no primeiro pagamento", async () => {
    const b = banco();
    const r = await lancar(b, [paga({ ref: "pay_1" })]);
    expect(r).toMatchObject({ lancadas: 1, estornos: 0 });
    expect(comissoesDe(b)[0]).toMatchObject({
      tipo: "mensalidade",
      pagamento_ref: "pay_1",
      parceiro_id: PARCEIRO,
      organization_id: ORG,
      valor_pago_cents: 53_730,
      aliquota_pct: 10,
      imposto_cents: 5_373,
      taxa_cents: 199,
      liquido_cents: 48_158,
      comissao_pct: 20,
      comissao_cents: 9_632,
      competencia: "2026-10-01",
      pago_em: "2026-10-10",
    });
    expect(b.db.mia_cupom_da_empresa?.[0]).toMatchObject({ comissao_pct: 20, comissao_meses: 12, comissao_setup_pct: 30, primeira_mensalidade_em: "2026-10-10" });
  });

  it("idempotente: ler de novo não lança outra", async () => {
    const b = banco();
    await lancar(b, [paga({ ref: "pay_1" })]);
    const r = await lancar(b, [paga({ ref: "pay_1" })]);
    expect(r.lancadas).toBe(0);
    expect(comissoesDe(b)).toHaveLength(1);
  });

  it("cobrança em aberto, crédito, Broadcast e e-mail avulso não geram comissão; o ajuste proporcional é mensalidade", async () => {
    const b = banco();
    const r = await lancar(b, [
      paga({ ref: "pay_aberta", pago: false, aberto: true, status: "PENDING" }),
      paga({ ref: "pay_credito", assinaturaRef: null, referenciaExterna: "credito:abc" }),
      paga({ ref: "pay_ajuste", assinaturaRef: null, referenciaExterna: `upgrade:${ORG}:chave`, valorCents: 10_000, liquidoCents: 9_800 }),
    ]);
    expect(r.lancadas).toBe(1);
    expect(comissoesDe(b).map((c) => c.pagamento_ref)).toEqual(["pay_ajuste"]);
    expect(ehMensalidade(paga({ ref: "x", assinaturaRef: null }), ORG)).toBe(false);
  });

  it("sem o líquido do Asaas, espera: não lança com taxa errada", async () => {
    const b = banco();
    expect((await lancar(b, [paga({ ref: "pay_1", liquidoCents: null })])).lancadas).toBe(0);
  });

  it("sem a alíquota configurada, nada é lançado: imposto zero pagaria a mais", async () => {
    const b = banco({ aliquota: null });
    expect(await lancar(b, [paga({ ref: "pay_1" })])).toMatchObject({ lancadas: 0, motivo: "sem_aliquota" });
    expect(comissoesDe(b)).toEqual([]);
  });

  it("sem parceiro, sem comissão (nem no setup)", async () => {
    const b = banco({ uso: uso({ parceiro_id: null }), setup: { organization_id: ORG, situacao: "pago", pagamento_ref: "pay_setup", cliente_ref: "cus_1" } });
    expect(await lancar(b, [paga({ ref: "pay_setup", assinaturaRef: null, referenciaExterna: `setup:${ORG}` })])).toMatchObject({ lancadas: 0, motivo: "sem_parceiro" });
  });

  it("a comissão própria do cupom vale sobre a do parceiro; mudar o parceiro depois não mexe em quem já pagou", async () => {
    const b = banco({ cupomProprio: 25 });
    await lancar(b, [paga({ ref: "pay_1" })]);
    expect(comissoesDe(b)[0]?.comissao_pct).toBe(25);
    (b.db.mia_parceiros as Array<Record<string, unknown>>)[0]!.comissao_pct = 5;
    (b.db.mia_cupons as Array<Record<string, unknown>>)[0]!.comissao_pct = 5;
    await lancar(b, [paga({ ref: "pay_1" }), paga({ ref: "pay_2", vencimento: "2026-11-10", pagoEm: "2026-11-10" })]);
    expect(comissoesDe(b).find((c) => c.pagamento_ref === "pay_2")?.comissao_pct).toBe(25);
  });

  it("o prazo: depois de N meses da primeira mensalidade, para de gerar", async () => {
    const b = banco({ parceiro: { comissao_meses: 6 } });
    await lancar(b, [
      paga({ ref: "pay_1", vencimento: "2026-10-10", pagoEm: "2026-10-10" }),
      paga({ ref: "pay_6", vencimento: "2027-03-10", pagoEm: "2027-03-10" }),
      paga({ ref: "pay_7", vencimento: "2027-04-10", pagoEm: "2027-04-10" }),
    ]);
    expect(comissoesDe(b).map((c) => c.pagamento_ref).sort()).toEqual(["pay_1", "pay_6"]);
  });

  it("o pagamento anterior ao parceiro não gera comissão para ele (a troca pela Time não paga o passado)", async () => {
    const b = banco({ uso: uso({ parceiro_desde: "2026-11-01T12:00:00Z" }) });
    await lancar(b, [paga({ ref: "pay_velha", vencimento: "2026-10-10", pagoEm: "2026-10-10" }), paga({ ref: "pay_nova", vencimento: "2026-11-10", pagoEm: "2026-11-10" })]);
    expect(comissoesDe(b).map((c) => c.pagamento_ref)).toEqual(["pay_nova"]);
  });

  it("o setup: uma vez, com a comissão dele, sobre o valor pago com desconto", async () => {
    const b = banco({ setup: { organization_id: ORG, situacao: "pago", pagamento_ref: "pay_setup", cliente_ref: "cus_1" } });
    const setup = paga({ ref: "pay_setup", assinaturaRef: null, referenciaExterna: `setup:${ORG}`, valorCents: 120_000, liquidoCents: 120_000 - 4_248 });
    await lancar(b, [setup]);
    await lancar(b, [setup]);
    const linhas = comissoesDe(b);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ tipo: "setup", comissao_pct: 30, liquido_cents: 103_752, comissao_cents: 31_126 });
  });
});

describe("estorno e chargeback", () => {
  it("cobrança já comissionada e estornada: lançamento negativo, uma vez, no mês em que foi visto", async () => {
    const b = banco();
    await lancar(b, [paga({ ref: "pay_1" })]);
    const original = comissoesDe(b)[0]!;
    const estornada = paga({ ref: "pay_1", status: "CHARGEBACK_REQUESTED", pago: false, estornado: true });
    const r = await lancar(b, [estornada], new Date("2026-11-20T15:00:00Z"));
    expect(r).toMatchObject({ lancadas: 0, estornos: 1 });
    const estorno = comissoesDe(b).find((c) => c.tipo === "estorno")!;
    expect(estorno).toMatchObject({ pagamento_ref: "pay_1", estorno_de: original.id, comissao_cents: -9_632, competencia: "2026-11-01", pago_em: "2026-11-20" });
    await lancar(b, [estornada], new Date("2026-11-21T15:00:00Z"));
    expect(comissoesDe(b).filter((c) => c.tipo === "estorno")).toHaveLength(1);
  });

  it("estornada sem nunca ter gerado comissão: nada a descontar", async () => {
    const b = banco();
    const r = await lancar(b, [paga({ ref: "pay_1", status: "REFUNDED", pago: false, estornado: true })]);
    expect(r).toMatchObject({ lancadas: 0, estornos: 0 });
  });
});

const lancamento = (m: Partial<LancamentoDoRepasse>): LancamentoDoRepasse => ({
  id: "l1",
  organization_id: ORG,
  empresa: "Clínica Bem Viver",
  tipo: "mensalidade",
  pago_em: "2026-10-10",
  competencia: "2026-10-01",
  valor_pago_cents: 53_730,
  aliquota_pct: 10,
  imposto_cents: 5_373,
  taxa_cents: 199,
  liquido_cents: 48_158,
  comissao_pct: 20,
  comissao_cents: 9_632,
  ...m,
});

describe("o calendário", () => {
  it("fecha o mês anterior a partir do dia configurado (em São Paulo)", () => {
    expect(competenciaParaFechar(new Date("2026-11-01T15:00:00Z"), { dia_fechamento: 1 })).toBe("2026-10-01");
    expect(competenciaParaFechar(new Date("2026-11-01T02:00:00Z"), { dia_fechamento: 1 })).toBe("2026-09-01");
    expect(competenciaParaFechar(new Date("2026-11-02T15:00:00Z"), { dia_fechamento: 3 })).toBeNull();
  });
  it("os prazos caem no mês seguinte ao da competência", () => {
    expect(prazosDoRepasse("2026-12-01", { dia_nota: 5, dia_pagamento: 10 })).toEqual({ nota_ate: "2027-01-05", pix_ate: "2027-01-10" });
  });
});

describe("fechar o mês", () => {
  const abertas = () => [
    { id: "c1", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "mensalidade", pagamento_ref: "pay_1", competencia: "2026-10-01", pago_em: "2026-10-10", comissao_cents: 9_632, repasse_id: null },
    { id: "c2", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "setup", pagamento_ref: "pay_2", competencia: "2026-10-01", pago_em: "2026-10-12", comissao_cents: 31_126, repasse_id: null },
    { id: "c3", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "estorno", pagamento_ref: "pay_0", competencia: "2026-09-01", pago_em: "2026-09-20", comissao_cents: -1_000, repasse_id: null },
    { id: "c4", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "mensalidade", pagamento_ref: "pay_3", competencia: "2026-11-01", pago_em: "2026-11-02", comissao_cents: 500, repasse_id: null },
  ];

  it("junta o que está aberto até o mês, desconta os estornos e não pega o mês em curso; repetir não faz nada", async () => {
    const b = banco({ comissoes: abertas() });
    const fechados = await fecharMes(b.cliente as never, "2026-10-01");
    expect(fechados).toHaveLength(1);
    expect(fechados[0]).toMatchObject({ parceiro_id: PARCEIRO, competencia: "2026-10-01", total_cents: 39_758 });
    const ligadas = comissoesDe(b).filter((c) => c.repasse_id === fechados[0]!.id).map((c) => c.id);
    expect(ligadas.sort()).toEqual(["c1", "c2", "c3"]);
    expect(await fecharMes(b.cliente as never, "2026-10-01")).toEqual([]);
  });

  it("saldo negativo não vira repasse: fica para descontar no mês seguinte", async () => {
    const b = banco({ comissoes: [{ id: "c9", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "estorno", pagamento_ref: "pay_9", competencia: "2026-10-01", pago_em: "2026-10-20", comissao_cents: -2_000, repasse_id: null }] });
    expect(await fecharMes(b.cliente as never, "2026-10-01")).toEqual([]);
    expect(comissoesDe(b)[0]?.repasse_id).toBeNull();
  });
});

describe("o anexo e o pago", () => {
  const repasse = (m: Record<string, unknown> = {}) => ({
    id: "r1",
    parceiro_id: PARCEIRO,
    competencia: "2026-10-01",
    total_cents: 39_758,
    fechado_em: "2026-11-01T12:00:00Z",
    extrato_enviado_em: null,
    extrato_erro: null,
    anexo_path: null,
    anexo_nome: null,
    anexo_em: null,
    anexo_removido_em: null,
    pago_em: null,
    pago_por: null,
    ...m,
  });
  const comStorage = (repasses: Array<Record<string, unknown>>) => {
    const b = banco();
    b.db.mia_repasses = repasses;
    const subidos: string[] = [];
    const removidos: string[] = [];
    const cliente = {
      ...b.cliente,
      from: b.cliente.from,
      storage: {
        from: () => ({
          upload: async (caminho: string) => {
            subidos.push(caminho);
            return { error: null };
          },
          remove: async (c: string[]) => {
            removidos.push(...c);
            return { error: null };
          },
        }),
      },
    };
    return { b, cliente, subidos, removidos };
  };

  it("sem anexo, não marca como pago; com anexo, grava a data e quem", async () => {
    const { cliente, b } = comStorage([repasse()]);
    expect(await marcarRepassePago(cliente as never, { repasseId: "r1", ator: "u1" })).toEqual({ ok: false, motivo: "sem_anexo" });
    expect(b.db.mia_repasses?.[0]?.pago_em).toBeNull();
    const arquivo = new Blob(["%PDF"], { type: "application/pdf" });
    const r = await anexarAoRepasse(cliente as never, { repasseId: "r1", arquivo, nome: "recibo.pdf", tipo: "application/pdf", ator: "u1" });
    expect(r.ok).toBe(true);
    const pago = await marcarRepassePago(cliente as never, { repasseId: "r1", ator: "u1", pagoEm: new Date("2026-11-08T12:00:00Z") });
    expect(pago).toMatchObject({ ok: true, jaEstava: false });
    expect(b.db.mia_repasses?.[0]).toMatchObject({ pago_em: "2026-11-08T12:00:00.000Z", pago_por: "u1" });
    expect(await marcarRepassePago(cliente as never, { repasseId: "r1", ator: "u2" })).toMatchObject({ ok: true, jaEstava: true });
    expect(b.db.mia_repasses?.[0]?.pago_por).toBe("u1");
  });

  it("o arquivo: só PDF, XML, PNG ou JPG, até 10 MB; trocar tira o antigo; depois de pago não muda", async () => {
    const { cliente, subidos, removidos } = comStorage([repasse({ anexo_path: "velho/a.pdf", anexo_em: "2026-11-02T00:00:00Z" })]);
    expect(await anexarAoRepasse(cliente as never, { repasseId: "r1", arquivo: new Blob(["x"], { type: "text/html" }), nome: "x.html", tipo: "text/html", ator: "u1" })).toEqual({ ok: false, motivo: "tipo_invalido" });
    const grande = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/pdf" });
    expect(await anexarAoRepasse(cliente as never, { repasseId: "r1", arquivo: grande, nome: "g.pdf", tipo: "application/pdf", ator: "u1" })).toEqual({ ok: false, motivo: "grande_demais" });
    const r = await anexarAoRepasse(cliente as never, { repasseId: "r1", arquivo: new Blob(["%PDF"], { type: "application/pdf" }), nome: "nova\\nota.pdf", tipo: "application/pdf", ator: "u1" });
    expect(r.ok).toBe(true);
    expect(subidos[0]).toMatch(new RegExp(`^${PARCEIRO}/2026-10/.+\\.pdf$`));
    expect(removidos).toEqual(["velho/a.pdf"]);
    const pago = comStorage([repasse({ pago_em: "2026-11-08T00:00:00Z", anexo_em: "2026-11-02T00:00:00Z" })]);
    expect(await anexarAoRepasse(pago.cliente as never, { repasseId: "r1", arquivo: new Blob(["%PDF"], { type: "application/pdf" }), nome: "a.pdf", tipo: "application/pdf", ator: "u1" })).toEqual({ ok: false, motivo: "ja_pago" });
  });

  it("a situação", () => {
    expect(situacaoDoRepasse({ anexo_em: null, pago_em: null })).toBe("aguardando_nota");
    expect(situacaoDoRepasse({ anexo_em: "x", pago_em: null })).toBe("pronto_para_pagar");
    expect(situacaoDoRepasse({ anexo_em: "x", pago_em: "y" })).toBe("pago");
  });

  it("LGPD: a cópia do parceiro leva o cadastro, as comissões e um link de cada anexo, sem o caminho do arquivo", async () => {
    const b = banco({ comissoes: [{ id: "c1", parceiro_id: PARCEIRO, organization_id: ORG, tipo: "mensalidade", pago_em: "2026-10-05T12:00:00Z", comissao_cents: 1_000 }] });
    b.db.mia_repasses = [
      repasse({ anexo_path: `${PARCEIRO}/2026-10/a.pdf`, anexo_nome: "recibo.pdf", anexo_em: "2026-11-02T00:00:00Z" }),
      repasse({ id: "r2", competencia: "2026-11-01" }),
    ];
    const assinados: Array<[string, number]> = [];
    const cliente = {
      ...b.cliente,
      from: b.cliente.from,
      storage: {
        from: () => ({
          createSignedUrl: async (caminho: string, validade: number) => {
            assinados.push([caminho, validade]);
            return { data: { signedUrl: "https://arquivos.exemplo.com.br/assinado" } };
          },
        }),
      },
    };
    const copia = (await exportarDadosDoParceiro(cliente as never, PARCEIRO)) as Record<string, unknown> & {
      parceiro: Record<string, unknown>;
      comissoes: Array<Record<string, unknown>>;
      repasses: Array<Record<string, unknown>>;
    };
    expect(copia.parceiro).toMatchObject({ nome: "João Mendes", documento: "52998224725", chave_pix: "joao@exemplo.com.br" });
    expect(copia.comissoes[0]).toMatchObject({ empresa: "Clínica Bem Viver", comissao_cents: 1_000 });
    expect(copia.repasses[0]).toMatchObject({ anexo_nome: "recibo.pdf", anexo_link: "https://arquivos.exemplo.com.br/assinado" });
    expect(copia.repasses[1]).toMatchObject({ anexo_link: null });
    // O link vale um dia, só o anexo que existe é assinado, e o caminho interno não sai.
    expect(assinados).toEqual([[`${PARCEIRO}/2026-10/a.pdf`, 86_400]]);
    expect(JSON.stringify(copia)).not.toContain("anexo_path");
    expect(await exportarDadosDoParceiro(cliente as never, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });
});

describe("o extrato e a planilha", () => {
  const ls = [
    lancamento({}),
    lancamento({ id: "l2", tipo: "setup", valor_pago_cents: 120_000, imposto_cents: 12_000, taxa_cents: 4_248, liquido_cents: 103_752, comissao_pct: 30, comissao_cents: 31_126 }),
    lancamento({ id: "l3", tipo: "estorno", comissao_cents: -1_000, valor_pago_cents: -5_000, imposto_cents: -500, taxa_cents: -100, liquido_cents: -4_400 }),
  ];
  it("os totais separam mensalidade, setup e estorno", () => {
    const t = totaisDosLancamentos(ls);
    expect(t).toMatchObject({ mensalidades: 1, setups: 1, estornos_cents: -1_000, mensalidades_comissao_cents: 9_632, setups_comissao_cents: 31_126, total_cents: 39_758 });
  });
  it("o e-mail traz a conta inteira, os prazos e pede nota ou recibo pelo tipo do documento", () => {
    const base = { competencia: "2026-10-01", codigos: ["JOAO10"], lancamentos: ls, total_cents: 39_758, config: { dia_nota: 5, dia_pagamento: 10 }, marca: { nome: "Sistema", accent: "#000" } };
    const cpf = montarExtrato({ ...base, parceiro: { nome: "João Mendes", tipo_documento: "cpf" } });
    expect(cpf.subject).toContain("outubro de 2026");
    expect(cpf.text).toContain("Olá, João.");
    expect(cpf.text).toContain("R$ 537,30");
    expect(cpf.text).toContain("o líquido foi R$ 481,58");
    expect(cpf.text).toContain("R$ 311,26");
    expect(cpf.text).toContain("05/11/2026");
    expect(cpf.text).toContain("10/11/2026");
    expect(cpf.text).toContain("o recibo desse valor");
    expect(cpf.text).toContain("estorno");
    expect(cpf.html).toContain("Clínica Bem Viver");
    expect(cpf.text).not.toMatch(/—/);
    expect(montarExtrato({ ...base, parceiro: { nome: "Agência", tipo_documento: "cnpj" } }).text).toContain("a nota fiscal desse valor");
  });
  it("o HTML escapa o nome da empresa", () => {
    const e = montarExtrato({ parceiro: { nome: "X", tipo_documento: "cpf" }, competencia: "2026-10-01", codigos: [], lancamentos: [lancamento({ empresa: "<b>Clínica</b>" })], total_cents: 9_632, config: { dia_nota: 5, dia_pagamento: 10 }, marca: { nome: "S", accent: "#000" } });
    expect(e.html).toContain("&lt;b&gt;Clínica&lt;/b&gt;");
    expect(e.html).not.toContain("<b>Clínica</b>");
  });
  it("mandarExtratos: uma vez por repasse, a resposta vai ao suporte; o que falha fica anotado e tenta de novo", async () => {
    const b = banco({ comissoes: [{ id: "c1", parceiro_id: PARCEIRO, organization_id: ORG, repasse_id: "r1", tipo: "mensalidade", pagamento_ref: "pay_1", competencia: "2026-10-01", pago_em: "2026-10-10", valor_pago_cents: 53_730, aliquota_pct: 10, imposto_cents: 5_373, taxa_cents: 199, liquido_cents: 48_158, comissao_pct: 20, comissao_cents: 9_632 }] });
    b.db.mia_repasses = [{ id: "r1", parceiro_id: PARCEIRO, competencia: "2026-10-01", total_cents: 9_632, extrato_enviado_em: null, extrato_erro: null, anexo_path: null, pago_em: null }];
    const falha = vi.fn(async () => ({ ok: false, error: "smtp" as never }));
    expect(await mandarExtratos(b.cliente as never, "2026-10-01", { enviar: falha as never })).toEqual({ enviados: 0, falhas: 1 });
    expect(b.db.mia_repasses[0]?.extrato_erro).toBe("smtp");
    const certo = vi.fn(async (_: { to: string; replyTo?: string }) => ({ ok: true }));
    expect(await mandarExtratos(b.cliente as never, "2026-10-01", { enviar: certo as never })).toEqual({ enviados: 1, falhas: 0 });
    expect(certo.mock.calls[0]?.[0]).toMatchObject({ to: "joao@exemplo.com.br", replyTo: "suporte@exemplo.com.br" });
    expect(b.db.mia_repasses[0]?.extrato_erro).toBeNull();
    expect(await mandarExtratos(b.cliente as never, "2026-10-01", { enviar: certo as never })).toEqual({ enviados: 0, falhas: 0 });
  });
  it("a planilha: uma linha por cobrança e o total; fórmula não passa", () => {
    const csv = planilhaDoMes([{ id: "r1", parceiro_id: PARCEIRO, competencia: "2026-10-01", total_cents: 39_758, fechado_em: "", extrato_enviado_em: null, extrato_erro: null, anexo_nome: null, anexo_em: null, anexo_removido_em: null, tem_anexo: false, pago_em: null, pago_por: null, lancamentos: [lancamento({ empresa: "=HYPERLINK()" }), ...ls.slice(1)], parceiro: "João; Mendes", chave_pix: "joao@exemplo.com.br" }]);
    const linhas = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(linhas).toHaveLength(5);
    expect(linhas[0]).toContain("Taxa do Asaas");
    expect(linhas[1]).toContain('"João; Mendes"');
    expect(linhas[1]).toContain(`"'=HYPERLINK()"`);
    expect(linhas[4]).toContain("TOTAL");
    expect(linhas[4]).toContain("397,58");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

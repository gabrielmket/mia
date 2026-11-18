/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.100 A 1.107 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: configuração nova de implantação
 * ganha campo ou ferramenta no MCP na mesma fusão).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-188.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Esta faixa
 * pediu dois campos: o bloco do negócio no evento do Google do tipo de
 * agendamento (9209, #4006) e a janela do perdido recente do funil (#4076).
 * Depois veio a leitura do link de pagamento na conversa (9312, MIA-19), uma
 * seção nova de `plataforma_ver_cliente`, sem ferramenta nova.
 * O que ainda falta no MCP está em `docs/fork/mcp-de-implantacao.md`.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

async function preparar() {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

async function ok(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

async function recusa(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome} deveria recusar: ${r.texto}`).toBe(true);
  return r.texto;
}

beforeEach(() => vi.clearAllMocks());

describe("plataforma_garantir_tipos_de_agendamento · CAMPO NOVO `levar_dados_do_negocio` (upstream 1.104, 9209)", () => {
  const TIPO = { nome: "Visita técnica", categoria: "visita", duracao_minutos: 60, local: "in_person" };

  it("nasce desligado; ligar grava a coluna e a leitura mostra; repetir não escreve", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [TIPO] });
    const criado = c.tabela("calendar_event_types").find((t) => t.name === TIPO.nome)!;
    expect(criado.levar_dados_do_negocio ?? false).toBe(false);

    const r = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, levar_dados_do_negocio: true }] });
    expect(c.tabela("calendar_event_types").find((t) => t.name === TIPO.nome)!.levar_dados_do_negocio).toBe(true);
    expect(JSON.stringify(r.dados)).toContain("dados do negócio no evento do Google");

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["agenda"] });
    const tipo = ((lido.dados.agenda as Linha).tipos as Linha[]).find((t) => t.nome === TIPO.nome)!;
    expect(tipo.levar_dados_do_negocio).toBe(true);

    const de_novo = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, levar_dados_do_negocio: true }] });
    expect(JSON.stringify(de_novo.dados)).toContain("ja_estava");
  });
});

describe("plataforma_garantir_funil · CAMPO NOVO `reabrir_perdido_dias` (upstream 1.103, #4076)", () => {
  const ETAPAS = [
    { nome: "Novo contato", passo: "new" },
    { nome: "Fechado", passo: "won" },
    { nome: "Perdido", passo: "lost" },
  ];
  const base = { nome: "Vendas", adotar_funil_padrao: true, etapas: ETAPAS };
  const settingsDoFunil = (c: Cenario) => c.tabela("crm_pipelines").find((f) => f.name === "Vendas")!.settings as Linha;

  it("grava a janela pela porta da tela; 0 desliga; a leitura mostra; acima do teto do domínio é recusado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { ...base, reabrir_perdido_dias: 30 });
    expect(settingsDoFunil(c).reabrir_perdido_dias).toBe(30);

    const lido = await ok(c, "plataforma_ver_funis", { funil: "Vendas" });
    expect(JSON.stringify(lido.dados)).toContain('"reabrir_perdido_dias":30');

    await ok(c, "plataforma_garantir_funil", { ...base, reabrir_perdido_dias: 0 });
    expect(settingsDoFunil(c).reabrir_perdido_dias).toBe(0);

    expect(await recusa(c, "plataforma_garantir_funil", { ...base, reabrir_perdido_dias: 99_999 })).toBeTruthy();
  });
});

describe("plataforma_ver_cliente · SEÇÃO NOVA `link_de_pagamento` (upstream 9312, MIA-19)", () => {
  // Tudo fictício: o hash é um padrão repetido, o id externo e o valor são inventados.
  const HASH = "ab".repeat(32);
  const ID_NO_PROVEDOR = "pagamento-ficticio-001";
  const VALOR = 12_345;
  const OUTRA_ORG = "00000000-0000-4000-8000-0000000000ff";

  function recebimento(status: string, extra: Linha = {}): Linha {
    return {
      id: crypto.randomUUID(),
      organization_id: ORG,
      conversation_id: null,
      lead_id: null,
      provedor: "infinitepay",
      external_id: status === "paga" ? ID_NO_PROVEDOR : null,
      aviso_token_hash: HASH,
      valor_cents: VALOR,
      moeda: "BRL",
      status,
      pago_em: null,
      created_at: "2026-11-01T12:00:00Z",
      updated_at: "2026-11-01T12:00:00Z",
      ...extra,
    };
  }

  function semear(c: Cenario) {
    c.tabela("pagamento_recebimentos").push(
      recebimento("pendente"),
      recebimento("pendente"),
      recebimento("paga", { pago_em: "2026-11-03T15:00:00Z" }),
      recebimento("paga", { pago_em: "2026-11-10T09:30:00Z" }),
      recebimento("expirada"),
      // De outra empresa: não entra na conta desta.
      recebimento("paga", { organization_id: OUTRA_ORG, pago_em: "2026-11-15T10:00:00Z" }),
    );
  }

  async function lerSecao(c: Cenario) {
    const r = await ok(c, "plataforma_ver_cliente", {});
    return { secao: r.dados.link_de_pagamento as Linha, texto: JSON.stringify(r.dados) };
  }

  it("módulo da instalação ligado: conta por situação só desta empresa e devolve o último pago", async () => {
    const c = await preparar();
    c.tabela("platform_config").push({ chave: "MODULO_LINK_DE_PAGAMENTO", valor: "ligado" });
    semear(c);

    const { secao } = await lerSecao(c);
    expect(secao.modulo_da_instalacao_ligado).toBe(true);
    expect(secao.quem_liga).toBe("instalacao");
    expect(secao.provedores).toEqual([{ chave: "infinitepay", nome: "InfinitePay" }]);
    expect(secao.recebimentos_por_situacao).toEqual({ pendente: 2, paga: 2, expirada: 1, cancelada: 0, estornada: 0 });
    expect(secao.ultimo_pago_em).toBe("2026-11-10T09:30:00Z");

    // Um pago sem data (linha antiga ou aviso incompleto) não esconde o último pago de verdade.
    c.tabela("pagamento_recebimentos").push(recebimento("paga"));
    const { secao: comPagoSemData } = await lerSecao(c);
    expect(comPagoSemData.ultimo_pago_em).toBe("2026-11-10T09:30:00Z");
  });

  it("módulo desligado (o padrão): diz que está desligado e o histórico continua legível", async () => {
    const c = await preparar();
    semear(c);

    const { secao } = await lerSecao(c);
    expect(secao.modulo_da_instalacao_ligado).toBe(false);
    expect((secao.recebimentos_por_situacao as Linha).paga).toBe(2);

    // Empresa sem recebimento nenhum: zeros e nenhum pago.
    const vazio = await preparar();
    const { secao: semNada } = await lerSecao(vazio);
    expect(semNada.recebimentos_por_situacao).toEqual({ pendente: 0, paga: 0, expirada: 0, cancelada: 0, estornada: 0 });
    expect(semNada.ultimo_pago_em).toBeNull();
  });

  it("não devolve endereço de aviso, hash, id no provedor nem valor", async () => {
    const c = await preparar();
    c.tabela("platform_config").push({ chave: "MODULO_LINK_DE_PAGAMENTO", valor: "ligado" });
    semear(c);

    const { secao, texto } = await lerSecao(c);
    expect(texto).not.toContain(HASH);
    expect(texto).not.toContain(ID_NO_PROVEDOR);
    expect(texto).not.toContain("webhooks/pagamento");
    expect(JSON.stringify(secao)).not.toContain(String(VALOR));
    expect(Object.keys(secao).sort()).toEqual(
      ["modulo_da_instalacao_ligado", "provedores", "quem_liga", "recebimentos_por_situacao", "ultimo_pago_em"],
    );
  });

  it("é só leitura: o retrato não escreve nada", async () => {
    const c = await preparar();
    semear(c);
    await lerSecao(c);
    expect(c.banco.escritas).toEqual([]);
  });
});

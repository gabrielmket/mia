/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.119 AO ALCANCE DO MCP DE PLATAFORMA
 * (MIA-96: a lista "Falta no MCP" da fusão de 19/11, MIA-91, PR #119).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1118.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *   - o funil de entrada por número (9430): `funil_de_entrada` em
 *     plataforma_configurar_canal, e a leitura na seção `canais`;
 *   - o primeiro nome do cliente no aviso de transferência à equipe
 *     (`settings.crm.aviso_transferencia_com_nome`): campo de
 *     plataforma_configurar_atendimento, e a leitura na seção `atendimento`;
 *   - a Operação do dia (`settings.operacao_do_dia`): campo de
 *     plataforma_configurar_atendimento, e a leitura na seção `atendimento`.
 *
 * E a régua da tarefa: NENHUM PADRÃO MUDA. Empresa que ninguém mexeu lê o
 * padrão do upstream, e pedido que não traz o campo não grava a chave.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  NUMERO,
  ORG,
  OUTRA_ORG,
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
const { lerConfiguracao, ETAPAS_DE_PROPOSTA_PADRAO, RELATORIO_PADRAO, TAGS_PADRAO } = await import("@/lib/operacao/regras");
const { avisoDeTransferenciaComNomeLigado } = await import("@/lib/schemas/settings");
const { audit } = await import("@/lib/audit");

async function preparar(opcoes: { comNumero?: boolean } = {}) {
  const cenario = cenarioDaImplantacao({ comNumero: opcoes.comNumero ?? true });
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

const auditadas = (acao: string) =>
  vi.mocked(audit).mock.calls.map(([e]) => e as { action: string; metadata?: Record<string, unknown> }).filter((e) => e.action === acao);

const settingsDa = (c: Cenario) => (c.tabela("organizations").find((o) => o.id === ORG)!.settings ?? {}) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

// ---------------------------------------------------------------------------

describe("o funil de entrada por número (9430) · plataforma_configurar_canal, `funil_de_entrada`", () => {
  const ATACADO = "0d000000-0000-4000-8000-0000000000a1";
  const ARQUIVADO = "0d000000-0000-4000-8000-0000000000a2";
  const DA_OUTRA = "0d000000-0000-4000-8000-0000000000a3";
  const NOVO_CONTATO = "0d000000-0000-4000-8000-0000000000b1";
  const FECHADO = "0d000000-0000-4000-8000-0000000000b2";

  /** Um segundo funil vivo (com uma etapa aberta e uma de ganho), um arquivado e um de outra empresa. */
  function funis(c: Cenario) {
    const funil = (id: string, org: string, name: string, arquivado = false) => ({
      id,
      organization_id: org,
      name,
      slug: name.toLowerCase(),
      position: 2000,
      is_default: false,
      is_archived: arquivado,
      settings: { fields: [], lost_reasons: [] },
    });
    c.tabela("crm_pipelines").push(funil(ATACADO, ORG, "Atacado"), funil(ARQUIVADO, ORG, "Antigo", true), funil(DA_OUTRA, OUTRA_ORG, "Vizinho"));
    const etapa = (id: string, pipeline: string, name: string, position: number, ganho = false) => ({
      id,
      organization_id: ORG,
      pipeline_id: pipeline,
      name,
      slug: name.toLowerCase(),
      position,
      is_won: ganho,
      is_lost: false,
      is_archived: false,
    });
    c.tabela("crm_stages").push(
      etapa(NOVO_CONTATO, ATACADO, "Novo contato", 1000),
      etapa(FECHADO, ATACADO, "Fechado", 2000, true),
      etapa(randomUUID(), ARQUIVADO, "Entrada", 1000),
    );
  }
  const numero = (c: Cenario) => c.tabela("channel_sessions").find((s) => s.id === NUMERO)!;

  it("⭐ funil e etapa pelo NOME: grava as duas colunas do número, com a trilha da tela, e a leitura mostra", async () => {
    const c = await preparar();
    funis(c);
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "atacado", etapa: "novo contato" } });
    expect(r.dados).toMatchObject({
      desfecho: "atualizou",
      funil_de_entrada: { padrao: false, funil: { id: ATACADO, nome: "Atacado" }, etapa: { id: NOVO_CONTATO, nome: "Novo contato" }, desfecho: "atualizou" },
    });
    expect((r.dados.avisos as string[]).join(" ")).toMatch(/conversa NOVA deste número passa a virar negócio no funil «Atacado», na etapa «Novo contato»/);
    expect(numero(c)).toMatchObject({ entry_pipeline_id: ATACADO, entry_stage_id: NOVO_CONTATO });
    expect(auditadas("channel.entry_pipeline_changed")).toEqual([
      expect.objectContaining({
        resourceType: "channel_session",
        resourceId: NUMERO,
        metadata: {
          previous_entry_pipeline_id: null,
          previous_entry_stage_id: null,
          entry_pipeline_id: ATACADO,
          entry_stage_id: NOVO_CONTATO,
          via: "mcp_plataforma",
        },
      }),
    ]);

    const v = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect((v.dados.canais as Array<Record<string, unknown>>)[0]!.funil_de_entrada).toEqual({
      padrao: false,
      funil: { id: ATACADO, nome: "Atacado" },
      etapa: { id: NOVO_CONTATO, nome: "Novo contato" },
    });
  });

  it("sem etapa, grava a etapa nula (o card nasce na etapa de entrada do funil)", async () => {
    const c = await preparar();
    funis(c);
    await ok(c, "plataforma_configurar_canal", { canal: NUMERO, funil_de_entrada: { funil: ATACADO } });
    expect(numero(c)).toMatchObject({ entry_pipeline_id: ATACADO, entry_stage_id: null });
  });

  it("REEXECUÇÃO: o mesmo pedido responde ja_estava, e nada é escrito nem auditado", async () => {
    const c = await preparar();
    funis(c);
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Atacado", etapa: "Novo contato" } });
    vi.mocked(audit).mockClear();
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Atacado", etapa: "Novo contato" } });
    expect(r.dados).toMatchObject({ desfecho: "ja_estava", funil_de_entrada: { desfecho: "ja_estava" } });
    expect(c.banco.escritas.length).toBe(antes);
    expect(auditadas("channel.entry_pipeline_changed")).toEqual([]);
  });

  it("`funil: null` volta ao funil padrão da organização (as duas colunas nulas)", async () => {
    const c = await preparar();
    funis(c);
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Atacado", etapa: "Novo contato" } });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: null } });
    expect(r.dados.funil_de_entrada).toMatchObject({ padrao: true, funil: null, etapa: null, desfecho: "atualizou" });
    expect(numero(c)).toMatchObject({ entry_pipeline_id: null, entry_stage_id: null });
  });

  it("RECUSA QUE ENSINA: etapa de GANHO, funil arquivado, funil de outra empresa e etapa sem funil, e nada é gravado", async () => {
    const c = await preparar();
    funis(c);
    expect(await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Atacado", etapa: "Fechado" } })).toMatch(
      /etapa ABERTA do funil «Atacado».*«Novo contato»/,
    );
    expect(await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Antigo" } })).toMatch(/Não achei o funil «Antigo»/);
    expect(await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: DA_OUTRA } })).toMatch(/Não achei o funil/);
    expect(await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: null, etapa: "Novo contato" } })).toMatch(
      /só vale com um funil/,
    );
    expect(numero(c).entry_pipeline_id ?? null).toBeNull();
    expect(numero(c).entry_stage_id ?? null).toBeNull();
    expect(auditadas("channel.entry_pipeline_changed")).toEqual([]);
  });

  it("o funil semeado também serve (é o padrão, mas escolher por número é outra coisa: grava)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", funil_de_entrada: { funil: "Pedidos" } });
    expect(numero(c)).toMatchObject({ entry_pipeline_id: FUNIL_SEMEADO, entry_stage_id: null });
  });
});

// ---------------------------------------------------------------------------

describe("o primeiro nome do cliente no aviso de transferência · plataforma_configurar_atendimento", () => {
  it("⭐ liga pela mescla da ação da tela: o resto de `settings.crm` fica, a trilha é a da tela, e o envio passa a ler ligado", async () => {
    const c = await preparar();
    c.tabela("organizations").find((o) => o.id === ORG)!.settings = { crm: { telefone_de_ficha_vazia: true }, outra_chave: 1 };
    const r = await ok(c, "plataforma_configurar_atendimento", { aviso_de_transferencia_com_nome: true });
    expect(r.dados).toMatchObject({
      desfecho: "atualizou",
      mudancas: ["primeiro nome do cliente no aviso de transferência"],
      atendimento: { aviso_de_transferencia: { avisar_nas_transferencias: true, com_o_primeiro_nome_do_cliente: true } },
    });
    const s = settingsDa(c);
    expect(s).toMatchObject({ crm: { telefone_de_ficha_vazia: true, aviso_transferencia_com_nome: true }, outra_chave: 1 });
    expect(avisoDeTransferenciaComNomeLigado(s)).toBe(true);
    expect(auditadas("crm.aviso_nome_na_transferencia_alterado")).toEqual([
      expect.objectContaining({ resourceType: "organization", resourceId: ORG, metadata: { ligado: true, via: "mcp_plataforma" } }),
    ]);

    const v = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect((v.dados.atendimento as Record<string, unknown>).aviso_de_transferencia).toEqual({
      avisar_nas_transferencias: true,
      com_o_primeiro_nome_do_cliente: true,
    });
  });

  it("REEXECUÇÃO: o mesmo pedido responde ja_estava, e nada é escrito nem auditado; `false` desliga", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", { aviso_de_transferencia_com_nome: true });
    vi.mocked(audit).mockClear();
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_configurar_atendimento", { aviso_de_transferencia_com_nome: true });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
    expect(auditadas("crm.aviso_nome_na_transferencia_alterado")).toEqual([]);

    await ok(c, "plataforma_configurar_atendimento", { aviso_de_transferencia_com_nome: false });
    expect(avisoDeTransferenciaComNomeLigado(settingsDa(c))).toBe(false);
  });

  it("pedir `false` numa empresa que nunca mexeu não grava a chave (o ausente já é desligado)", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { aviso_de_transferencia_com_nome: false });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(settingsDa(c).crm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("a Operação do dia · plataforma_configurar_atendimento, `operacao_do_dia`", () => {
  it("⭐ grava pela mescla da rota: etiquetas e relatório chave a chave, a lista de etapas substituída, a trilha com o antes e o depois", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", {
      operacao_do_dia: { etiquetas: { reclamacao: "  Queixa " }, etapas_de_proposta: ["orçamento enviado"], relatorio: { hora: 19 } },
    });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["Operação do dia"] });

    const gravada = lerConfiguracao(settingsDa(c));
    expect(gravada).toEqual({
      tags: { ...TAGS_PADRAO, reclamacao: "queixa" },
      etapas_de_proposta: ["orçamento enviado"],
      relatorio: { ligado: true, hora: 19 },
    });
    // A rota grava o bloco inteiro já resolvido; o espelho também.
    expect(settingsDa(c).operacao_do_dia).toEqual(gravada);
    expect(auditadas("settings.operacao_do_dia_updated")).toEqual([
      expect.objectContaining({
        resourceType: "organization",
        resourceId: ORG,
        metadata: expect.objectContaining({ depois: gravada, via: "mcp_plataforma" }),
      }),
    ]);

    // Um segundo pedido só com o relatório não mexe nas etiquetas.
    await ok(c, "plataforma_configurar_atendimento", { operacao_do_dia: { relatorio: { ligado: false } } });
    expect(lerConfiguracao(settingsDa(c))).toMatchObject({ tags: { reclamacao: "queixa" }, relatorio: { ligado: false, hora: 19 } });

    const v = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect((v.dados.atendimento as Record<string, unknown>).operacao_do_dia).toEqual({
      etiquetas: { ...TAGS_PADRAO, reclamacao: "queixa" },
      etapas_de_proposta: ["orçamento enviado"],
      relatorio: { ligado: false, hora: 19 },
    });
  });

  it("REEXECUÇÃO: pedido igual ao lido (inclusive o padrão) responde ja_estava, e nada é escrito nem auditado", async () => {
    const c = await preparar();
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_configurar_atendimento", {
      operacao_do_dia: { relatorio: { ligado: true, hora: RELATORIO_PADRAO.hora }, etiquetas: { urgente: "URGENTE" } },
    });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
    expect(settingsDa(c).operacao_do_dia).toBeUndefined();
    expect(auditadas("settings.operacao_do_dia_updated")).toEqual([]);
  });

  it("RECUSA QUE ENSINA: etiqueta acima de 40 caracteres e etapa vazia, e nada é gravado; hora fora de 0 a 23 nem passa pelo schema", async () => {
    const c = await preparar();
    expect(await recusa(c, "plataforma_configurar_atendimento", { operacao_do_dia: { etiquetas: { projeto: "x".repeat(41) } } })).toMatch(
      /1 a 40 caracteres/,
    );
    expect(await recusa(c, "plataforma_configurar_atendimento", { operacao_do_dia: { etapas_de_proposta: ["   "] } })).toMatch(/etapas_de_proposta/);
    await recusa(c, "plataforma_configurar_atendimento", { operacao_do_dia: { relatorio: { hora: 24 } } });
    expect(settingsDa(c).operacao_do_dia).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("a régua da faixa: nenhum padrão muda e nada liga sozinho", () => {
  it("empresa que ninguém mexeu lê o padrão do upstream nas três", async () => {
    const c = await preparar();
    const v = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento", "canais"] });
    const atendimento = v.dados.atendimento as Record<string, unknown>;
    expect(atendimento.aviso_de_transferencia).toEqual({ avisar_nas_transferencias: true, com_o_primeiro_nome_do_cliente: false });
    expect(atendimento.operacao_do_dia).toEqual({
      etiquetas: { ...TAGS_PADRAO },
      etapas_de_proposta: [...ETAPAS_DE_PROPOSTA_PADRAO],
      relatorio: { ...RELATORIO_PADRAO },
    });
    expect((v.dados.canais as Array<Record<string, unknown>>)[0]!.funil_de_entrada).toEqual({ padrao: true, funil: null, etapa: null });
  });

  it("os pedidos que não trazem os campos novos não gravam as chaves novas", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", { modo: "round_robin", telefone_de_ficha_vazia: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", nome_interno: "WA | Recepção" });
    const s = settingsDa(c);
    expect(s.operacao_do_dia).toBeUndefined();
    expect((s.crm as Record<string, unknown>).aviso_transferencia_com_nome).toBeUndefined();
    const linha = c.tabela("channel_sessions").find((x) => x.id === NUMERO)!;
    expect(linha.entry_pipeline_id ?? null).toBeNull();
    expect(c.banco.escritas.filter((e) => e.tabela === "channel_sessions" && JSON.stringify(e.payload).includes("entry_"))).toEqual([]);
  });
});

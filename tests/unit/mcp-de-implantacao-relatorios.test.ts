/**
 * FORK MIA (.80, item 9) — as duas ferramentas do MONTADOR DE RELATÓRIOS no MCP
 * de plataforma, pelo servidor inteiro (tools/list, a guarda da operação, a
 * conferência dos argumentos, o handler e a resposta):
 *
 *   plataforma_garantir_relatorios  liga os prontos ao funil, cria os
 *                                   relatórios do segmento e monta o painel;
 *                                   rodar de novo não duplica e só completa
 *   plataforma_ver_relatorios       o que ficou pronto, sem o "só para mim"
 *                                   de ninguém, e os números do primeiro dia
 *
 * O banco é o de memória (`tests/helpers/implantacao-em-memoria.ts`); o motor
 * de conta responde com números fixos (a conta de verdade é do Postgres,
 * provada em `tests/invariants/montador-de-relatorios.test.ts`). As regras de
 * quem vê o quê são da RLS e também moram lá.
 *
 * Nenhum dado de cliente real: empresa fictícia do cenário.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, cenarioDaImplantacao, clienteMcp, FUNIL_SEMEADO, ORG, OUTRA_ORG } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { audit } = await import("@/lib/audit");
const { RECEITAS } = await import("@/lib/relatorios/segmentos");

let cenario: ReturnType<typeof cenarioDaImplantacao>;
const pedidosAoMotor: Array<Record<string, unknown>> = [];

beforeEach(() => {
  cenario = cenarioDaImplantacao();
  pedidosAoMotor.length = 0;
  const rpcDoCenario = cenario.cliente.rpc;
  cenario.cliente.rpc = async (nome: string, args: unknown) => {
    if (nome === "fn_mia_relatorio") {
      const a = args as Record<string, unknown>;
      pedidosAoMotor.push(a);
      return {
        data: {
          fonte: a.p_fonte,
          medidas: a.p_medidas,
          dim1: a.p_dim1,
          dim2: a.p_dim2,
          filtros: a.p_filtros,
          janela: { periodo: a.p_periodo, de: "2026-09-16", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 30 },
          moeda: "BRL",
          valores: true,
          total: { n: 7, n_ok: 3, valores: { qtd: 7 } },
          fora_da_moeda: 0,
          grupos: [{ chave: "meta_ads", rotulo: null, ordem: null, sem: false, outros: false, n: 7, n_ok: 3, valores: { qtd: 7 } }],
          series: null,
          dobrados: [],
          series_dobradas: [],
          funil: null,
          meta: null,
          anterior: null,
        },
        error: null,
      };
    }
    return rpcDoCenario(nome, args);
  };
  estado.cliente = cenario.cliente;
  vi.mocked(audit).mockClear();
});

const tabela = (nome: string) => cenario.banco.tabela(nome) as Array<Record<string, unknown>>;

describe("a lista: 67 ferramentas, as duas do item 9", () => {
  it("garantir pede `implantar_configuracao`; ver é leitura livre", () => {
    // 64 da .78, `plataforma_vincular_pessoas_a_empresas` da empresa única (.79) e as duas do montador (.80).
    expect(FERRAMENTAS).toHaveLength(67);
    const operacao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.operacao;
    expect(operacao("plataforma_garantir_relatorios")).toBe("implantar_configuracao");
    expect(operacao("plataforma_ver_relatorios")).toBeNull();
  });

  it("token sem a caixinha: recusado antes do handler, e nada é gravado", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["compartilhar_paineis"]);
    const r = await mcp.chamar("plataforma_garantir_relatorios", { organization_id: ORG, segmento: "clinica" });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("implantar_configuracao");
    expect(tabela("mia_relatorios")).toHaveLength(0);
    expect(tabela("mia_paineis_usuario")).toHaveLength(0);
  });
});

describe("plataforma_garantir_relatorios", () => {
  async function garantir(args: Record<string, unknown>) {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_garantir_relatorios", { organization_id: ORG, ...args });
    await mcp.fechar();
    return r;
  }

  it("⭐ liga os prontos ao funil, cria os relatórios do segmento e monta o painel, compartilhados", async () => {
    const r = await garantir({ segmento: "clinica" });
    expect(r.erro).toBe(false);
    const receita = RECEITAS.clinica;
    expect(tabela("mia_relatorios_da_empresa")).toEqual([expect.objectContaining({ organization_id: ORG, pipeline_id: FUNIL_SEMEADO })]);
    const relatorios = tabela("mia_relatorios");
    expect(relatorios).toHaveLength(receita.relatorios.length);
    for (const l of relatorios) {
      expect(l).toEqual(expect.objectContaining({ organization_id: ORG, compartilhado: true, criado_via: "mcp_plataforma", created_by: AUTOR }));
    }
    expect(relatorios.map((l) => l.chave).sort()).toEqual(receita.relatorios.map((x) => x.chave).sort());
    const paineis = tabela("mia_paineis_usuario");
    expect(paineis).toEqual([expect.objectContaining({ nome: "Painel comercial", compartilhado: true, chave: receita.painel.chave })]);
    const itens = tabela("mia_paineis_usuario_itens");
    expect(itens).toHaveLength(8);
    expect(itens.filter((i) => i.tamanho === "G")).toHaveLength(1);
    const json = r.dados as { painel: { desfecho: string; relatorios: number }; link_para_o_dono_sugerido: { para_quem: string } };
    expect(json.painel).toEqual(expect.objectContaining({ desfecho: "criou", relatorios: 8 }));
    expect(json.link_para_o_dono_sugerido.para_quem).toBe("Dono da clínica");
    expect(vi.mocked(audit).mock.calls.map((c) => (c[0] as { action: string }).action)).toContain("relatorios.garantidos");
  });

  it("⭐ rodar de novo não duplica: tudo `ja_estava`", async () => {
    await garantir({ segmento: "clinica" });
    const r = await garantir({ segmento: "clinica" });
    const json = r.dados as { relatorios: Array<{ desfecho: string }>; painel: { desfecho: string; novos: number } };
    expect(json.relatorios.every((x) => x.desfecho === "ja_estava")).toBe(true);
    expect(json.painel).toEqual(expect.objectContaining({ desfecho: "ja_estava", novos: 0 }));
    expect(tabela("mia_relatorios")).toHaveLength(RECEITAS.clinica.relatorios.length);
    expect(tabela("mia_paineis_usuario")).toHaveLength(1);
    expect(tabela("mia_paineis_usuario_itens")).toHaveLength(8);
  });

  it("no painel só COMPLETA: o que o cliente tirou volta, o que ele pôs e o tamanho que mudou ficam", async () => {
    await garantir({ segmento: "clinica" });
    const itens = tabela("mia_paineis_usuario_itens");
    const funil = itens.find((i) => i.pronto === "funil")!;
    const resultado = itens.find((i) => i.pronto === "resultado")!;
    resultado.tamanho = "G";
    cenario.banco.tabela("mia_paineis_usuario_itens").splice(itens.indexOf(funil), 1);
    cenario.banco.tabela("mia_paineis_usuario_itens").push({ id: "extra", organization_id: ORG, painel_id: funil.painel_id, relatorio_id: null, pronto: "assuntos", tamanho: "M", posicao: 99 });
    const r = await garantir({ segmento: "clinica" });
    expect((r.dados as { painel: { novos: number } }).painel.novos).toBe(1);
    const depois = tabela("mia_paineis_usuario_itens");
    expect(depois.some((i) => i.pronto === "funil")).toBe(true);
    expect(depois.some((i) => i.pronto === "assuntos")).toBe(true);
    expect(depois.find((i) => i.pronto === "resultado")!.tamanho).toBe("G");
  });

  it("a receita muda por segmento, e a meta do mês entra junto", async () => {
    const r = await garantir({ segmento: "academia", meta_do_mes: { valor_cents: 6500000, mes: "2026-10" } });
    expect(r.erro).toBe(false);
    expect(tabela("mia_paineis_usuario")[0]!.nome).toBe("Painel de matrículas");
    expect(tabela("sales_targets")).toEqual([expect.objectContaining({ organization_id: ORG, alvo_cents: 6500000 })]);
  });

  it("funil de outra empresa é recusado com a frase, e nada é gravado nos relatórios", async () => {
    cenario.banco.tabela("crm_pipelines").push({ id: "0d000000-0000-4000-8000-0000000000ff", organization_id: OUTRA_ORG, name: "Alheio", is_default: true, is_archived: false, position: 1 });
    const r = await garantir({ segmento: "geral", funil_id: "0d000000-0000-4000-8000-0000000000ff" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("funil_id");
    expect(tabela("mia_relatorios")).toHaveLength(0);
  });
});

describe("plataforma_ver_relatorios", () => {
  it("⭐ lista o que é da equipe, conta o 'só para mim' sem mostrar, e calcula os números do painel", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    await mcp.chamar("plataforma_garantir_relatorios", { organization_id: ORG, segmento: "industria" });
    cenario.banco.tabela("mia_relatorios").push({
      id: "0f000000-0000-4000-8000-000000000001",
      organization_id: ORG,
      nome: "Rascunho de alguém",
      fonte: "negocios",
      medida: "qtd",
      dim1: "origem",
      dim2: null,
      filtros: {},
      periodo: "30",
      de: null,
      ate: null,
      comparar: false,
      visualizacao: "barras",
      compartilhado: false,
      criado_via: "tela",
      created_by: AUTOR,
    });
    const r = await mcp.chamar("plataforma_ver_relatorios", { organization_id: ORG, numeros: true, periodo: "30" });
    await mcp.fechar();
    expect(r.erro).toBe(false);
    const json = r.dados as {
      prontos: { relatorios: unknown[] };
      relatorios: Array<{ nome: string }>;
      relatorios_so_de_quem_criou: number;
      paineis: Array<{ relatorios: Array<{ registros?: number; fica_fora_do_link_do_dono?: boolean; titulo?: string }> }>;
    };
    expect(json.prontos.relatorios).toHaveLength(12);
    expect(json.relatorios.map((x) => x.nome)).not.toContain("Rascunho de alguém");
    expect(json.relatorios_so_de_quem_criou).toBe(1);
    expect(json.paineis).toHaveLength(1);
    expect(json.paineis[0]!.relatorios.every((x) => x.registros === 7)).toBe(true);
    // "Pedidos por representante" agrupa por pessoa: fica fora do link do dono.
    expect(json.paineis[0]!.relatorios.find((x) => x.titulo === "Pedidos por representante")?.fica_fora_do_link_do_dono).toBe(true);
    expect(pedidosAoMotor.length).toBeGreaterThan(0);
    expect(pedidosAoMotor.every((p) => p.p_org === ORG)).toBe(true);
  });
});

/**
 * FORK MIA (.90) — A COBRANÇA DA JORNADA DE ASSINATURA AO ALCANCE DO MCP DE
 * PLATAFORMA (regra do dono do produto: toda função nova entra no MCP na mesma
 * versão; protótipo de 25/10/2026, tela 8). docs/fork/jornada-de-assinatura.md.
 *
 * A CONTAGEM da lista mora aqui desde a .90: 92 (as 83 da .89 e as nove da
 * cobrança), 94 com as duas das propostas do assistente (.91), 98 com as
 * quatro das trilhas (.93) e 99 com o
 * desfazer da proposta (.94). E as regras que não podem virar: o MCP não conecta a chave do
 * provedor, não marca como pago, não cancela a assinatura do cliente, não muda
 * o modo do cadastro; plano assinado não muda de preço nem perde módulo; com a
 * cobrança desligada, nada de plano.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/configuracao", () => ({ toleranciaDias: async () => 7, provedorDaInstalacao: async () => "asaas", chaveDoProvedor: async () => null }));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: async () => "com_aprovacao" }));

import { FERRAMENTAS, FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import { FERRAMENTAS_DE_COBRANCA } from "@/lib/mcp-plataforma/ferramentas/cobranca";
import { OPERACOES } from "@/lib/mcp-plataforma/operacoes";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { bancoLivre, filtroLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000d1";
const AUTOR = "00000000-0000-4000-8000-0000000000d2";

interface Estado {
  cobrancaLigada: boolean;
  b2bLigado: boolean;
  modulosDoPlano: string[];
}
let e: Estado;

function responder(c: CadeiaLivre) {
  if (c.tabela === "platform_config") {
    const linhas = [
      ...(e.cobrancaLigada ? [{ chave: "MODULO_COBRANCA", valor: "ligado" }] : []),
      ...(e.b2bLigado ? [{ chave: "MODULO_CRM_B2B", valor: "ligado" }] : []),
    ];
    return { data: linhas };
  }
  if (c.tabela === "organization_modules" && operacaoLivre(c) === "insert") return { data: null, error: null };
  if (c.tabela === "organizations" && filtroLivre(c, "eq", "id")) return { data: { id: ORG, display_name: "Empresa Alfa", status: "active" } };
  if (c.tabela === "modulos_instalados") return { data: [] };
  return { data: [] };
}

const ctx = (banco: ReturnType<typeof bancoLivre>) => ({
  admin: banco.cliente as never,
  autorUserId: AUTOR,
  tokenId: "tok",
  requestId: "req",
});

const chamar = (nome: string, banco: ReturnType<typeof bancoLivre>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(banco), args);

beforeEach(() => {
  e = { cobrancaLigada: false, b2bLigado: false, modulosDoPlano: [] };
});

const banco = () =>
  bancoLivre(responder, (nome) => {
    if (nome === "fn_mia_modulos_do_plano") return { data: e.modulosDoPlano };
    if (nome === "fn_create_tenant_with_owner") return { data: { id: "00000000-0000-4000-8000-0000000000e1", created: true } };
    return {};
  });

describe("a lista: 99 ferramentas, nove delas da cobrança", () => {
  it("99 = as 83 da .89 + as nove da cobrança (.90) + as duas das propostas do assistente (.91) + as quatro das trilhas e de onde os clientes travam (.93) + o desfazer da proposta (.94)", () => {
    expect(FERRAMENTAS).toHaveLength(99);
    expect(FERRAMENTAS_DE_COBRANCA).toHaveLength(9);
    expect(new Set(FERRAMENTAS.map((f) => f.name)).size).toBe(FERRAMENTAS.length);
  });

  it("leitura livre, escrita nomeada: três chaves novas, pelo estrago", () => {
    expect(Object.fromEntries(FERRAMENTAS_DE_COBRANCA.map((f) => [f.name, f.operacao]))).toEqual({
      plataforma_ver_cobranca: null,
      plataforma_garantir_planos: "gerir_planos",
      plataforma_listar_assinaturas: null,
      plataforma_ver_assinatura: null,
      plataforma_atribuir_plano: "gerir_cobranca",
      plataforma_gerar_link_de_pagamento: "gerir_cobranca",
      plataforma_ajustar_cobranca: "gerir_cobranca",
      plataforma_listar_pedidos_de_cadastro: null,
      plataforma_decidir_pedido_de_cadastro: "decidir_cadastro",
    });
    for (const chave of ["gerir_planos", "gerir_cobranca", "decidir_cadastro"]) {
      const op = OPERACOES.find((o) => o.chave === chave);
      expect(op?.raio.length, chave).toBeGreaterThan(80);
    }
  });

  it("todo exemplo passa no schema da própria ferramenta", () => {
    for (const f of FERRAMENTAS_DE_COBRANCA) {
      if (!f.exemplo) continue;
      expect(z.object(f.inputSchema).safeParse(f.exemplo).success, f.name).toBe(true);
    }
  });

  it("⭐ o que o MCP não faz, pelo código-fonte: chave do provedor, marcar pago, cancelar, modo do cadastro", () => {
    const fonte = readFileSync(path.join(process.cwd(), "lib/mcp-plataforma/ferramentas/cobranca.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/**"))
      .join("\n");
    for (const proibido of ["ASAAS_API_KEY", "STRIPE_SECRET_KEY", "salvarChave", "cancelarNoFim", "updateSignupMode", "signup_mode", "estado: \"ativa\"", "aplicarRegua", "sincronizar("]) {
      expect(fonte, proibido).not.toContain(proibido);
    }
  });

  it("a ferramenta da .91 (plataforma_ver_implantacao) segue sem campo da cobrança", () => {
    const f = FERRAMENTA_POR_NOME.get("plataforma_ver_implantacao")!;
    expect(f.description).not.toMatch(/Plano e cobrança/);
  });
});

describe("com a cobrança desligada, nada de plano", () => {
  it("ver_cobranca diz desligada e não traz provedor, modo nem chave", async () => {
    const r = (await chamar("plataforma_ver_cobranca", banco(), {})) as Record<string, unknown>;
    expect(r.ligada).toBe(false);
    expect(r).not.toHaveProperty("provedor");
    expect(JSON.stringify(r)).not.toMatch(/aact_|sk_live|sk_test/);
  });
  it("garantir_planos recusa por inteiro, com o caminho para ligar", async () => {
    const r = (await chamar("plataforma_garantir_planos", banco(), { planos: [{ nome: "Essencial", preco: 297 }] })) as {
      ok: boolean;
      recusas: Array<{ motivo: string }>;
      criados: string[];
    };
    expect(r.ok).toBe(false);
    expect(r.criados).toEqual([]);
    expect(r.recusas[0]!.motivo).toMatch(/Recursos opcionais/);
  });
  it("atribuir_plano e ajustar_cobranca recusam com a frase que ensina", async () => {
    await expect(chamar("plataforma_atribuir_plano", banco(), { organization_id: ORG, plano: "Essencial" })).rejects.toBeInstanceOf(Recusa);
    await expect(chamar("plataforma_ajustar_cobranca", banco(), { organization_id: ORG, acao: "isentar" })).rejects.toThrow(/desligada/);
  });
  it("criar_cliente sem plano nasce isenta como sempre, com a origem implantação; com plano, recusa", async () => {
    const b = banco();
    await chamar("plataforma_criar_cliente", b, {
      display_name: "Empresa Alfa",
      slug: "empresa-alfa",
      owner_email: "dona@exemplo.invalid",
      chave: "00000000-0000-4000-8000-0000000000f1",
    });
    const pedido = b.rpcs.find((x) => x.nome === "fn_create_tenant_with_owner")!.args.p_request as Record<string, unknown>;
    expect(pedido).not.toHaveProperty("plano_id");
    const origem = b.cadeias.find((c) => c.tabela === "mia_origem_da_empresa");
    expect(origem && operacaoLivre(origem)).toBe("upsert");
    await expect(
      chamar("plataforma_criar_cliente", banco(), {
        display_name: "Empresa Beta",
        slug: "empresa-beta",
        owner_email: "dono@exemplo.invalid",
        chave: "00000000-0000-4000-8000-0000000000f2",
        plano: "MIA com implantação",
      }),
    ).rejects.toThrow(/desligada/);
    await expect(
      chamar("plataforma_criar_cliente", banco(), {
        display_name: "Empresa Gama",
        slug: "empresa-gama",
        owner_email: "dono@exemplo.invalid",
        chave: "00000000-0000-4000-8000-0000000000f3",
        plano: "X",
        isenta: true,
      }),
    ).rejects.toThrow(/contradizem/);
  });
});

describe("liberar_modulo cresce: a origem pela Time e o aviso do plano", () => {
  it("Vendas B2B se libera à mão; a resposta diz a origem e o que o plano já liga", async () => {
    e.cobrancaLigada = true;
    e.modulosDoPlano = ["disparador"];
    const b2b = (await chamar("plataforma_liberar_modulo", banco(), { organization_id: ORG, modulo: "crm_b2b", liberar: true })) as Record<string, unknown>;
    expect(b2b).toMatchObject({ modulo: "crm_b2b", liberado: true, origem: "pela Time" });
    const disp = (await chamar("plataforma_liberar_modulo", banco(), { organization_id: ORG, modulo: "disparador", liberar: true })) as {
      avisos?: string[];
    };
    expect(disp.avisos?.[0]).toMatch(/plano da empresa já liga/);
    const tirou = (await chamar("plataforma_liberar_modulo", banco(), { organization_id: ORG, modulo: "disparador", liberar: false })) as {
      aviso?: string;
    };
    expect(tirou.aviso).toMatch(/continua ligado pelo plano/);
  });
  it("chave desconhecida continua recusada", async () => {
    await expect(chamar("plataforma_liberar_modulo", banco(), { organization_id: ORG, modulo: "prospeccao", liberar: true })).rejects.toThrow(
      /módulo desconhecido/,
    );
  });
});

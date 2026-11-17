/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.100 A 1.107 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: configuração nova de implantação
 * ganha campo ou ferramenta no MCP na mesma fusão).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-188.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Esta faixa
 * pediu dois campos: o bloco do negócio no evento do Google do tipo de
 * agendamento (9209, #4006) e a janela do perdido recente do funil (#4076).
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

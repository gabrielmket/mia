/**
 * FORK MIA (MIA-48) — O AVISO DA QUEDA DO NÚMERO AO ALCANCE DO MCP DE PLATAFORMA.
 *
 * A regra do fork: toda função nova entra no MCP na mesma versão. A chave mora
 * em `plataforma_configurar_atendimento` (`aviso_da_queda_do_numero`) e o estado
 * (ligada, grupo, últimos avisos) em `plataforma_ver_cliente` (`aviso_da_queda`).
 * O que se mede é o BANCO, não a resposta. Dados fictícios.
 *
 *     npx vitest run tests/unit/mcp-de-implantacao-aviso-da-queda.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
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
const { audit } = await import("@/lib/audit");
const { chaveDaQueda, chaveDaVolta } = await import("@/lib/avisos/aviso-da-queda");

const GRUPO = "120363000000000011@g.us";

async function preparar(opcoes: { comGrupo?: boolean } = {}) {
  const cenario = cenarioDaImplantacao({ comNumero: true });
  if (opcoes.comGrupo !== false) {
    const org = cenario.banco.tabela("organizations").find((o) => o.id === ORG)!;
    org.settings = { ...((org.settings as Linha | null) ?? {}), grupo_de_avisos: { id: GRUPO, nome: "Avisos da Academia Alfa" } };
  }
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

const settingsDa = (c: Cenario) => c.tabela("organizations").find((o) => o.id === ORG)!.settings as Linha;
const linhaAuditada = (acao: string) => vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === acao);

async function ok(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

describe("plataforma_configurar_atendimento · aviso_da_queda_do_numero", () => {
  it("⭐ nasce ligado: pedir ligado não escreve nada", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { aviso_da_queda_do_numero: true });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
    expect(r.dados.atendimento).toMatchObject({ aviso_da_queda_do_numero: true });
  });

  it("⭐ desligar grava a chave de topo, sem pisar no grupo, e audita; repetir responde ja_estava", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { aviso_da_queda_do_numero: false });
    expect(r.dados.desfecho).toBe("atualizou");
    expect(settingsDa(c).aviso_da_queda_do_numero).toBe(false);
    expect(settingsDa(c).grupo_de_avisos).toEqual({ id: GRUPO, nome: "Avisos da Academia Alfa" });
    expect(linhaAuditada("platform.aviso_da_queda_alterado")?.metadata).toMatchObject({ ligado: false, via: "mcp_plataforma" });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_configurar_atendimento", { aviso_da_queda_do_numero: false });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_configurar_atendimento", { aviso_da_queda_do_numero: true });
    expect(settingsDa(c).aviso_da_queda_do_numero).toBe(true);
  });

  it("valor que não é booleano é recusado com a frase que ensina", async () => {
    const c = await preparar();
    const r = await c.mcp.chamar("plataforma_configurar_atendimento", { organization_id: ORG, aviso_da_queda_do_numero: "sim" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("aviso_da_queda_do_numero");
  });
});

describe("as leituras mostram a chave e o estado", () => {
  it("⭐ plataforma_ver_cliente: ligada, com grupo, e os últimos avisos de queda e de volta do número", async () => {
    const c = await preparar();
    c.tabela("platform_avisos_enviados").push(
      { chave: chaveDaQueda(NUMERO), enviado_em: "2026-11-17T14:11:00.000Z", detalhe: { organization_id: ORG } },
      { chave: chaveDaVolta(NUMERO), enviado_em: "2026-11-17T15:00:00.000Z", detalhe: { organization_id: ORG, enviada: true } },
    );

    const lido = await ok(c, "plataforma_ver_cliente", {});
    const aviso = lido.dados.aviso_da_queda as Linha;
    expect(aviso).toMatchObject({ ligada: true, grupo_configurado: true, vai_avisar: true });
    expect((aviso.ultimo_aviso_de_queda as Linha).em).toBe("2026-11-17T14:11:00.000Z");
    expect((aviso.ultimo_aviso_de_volta as Linha).em).toBe("2026-11-17T15:00:00.000Z");
  });

  it("sem grupo de avisos: ligada, mas não vai avisar", async () => {
    const c = await preparar({ comGrupo: false });
    const lido = await ok(c, "plataforma_ver_cliente", {});
    expect(lido.dados.aviso_da_queda).toMatchObject({ ligada: true, grupo_configurado: false, vai_avisar: false });
  });

  it("plataforma_ver_configuracao (atendimento) devolve a chave como gravada", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", { aviso_da_queda_do_numero: false });
    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect((lido.dados.atendimento as Linha).aviso_da_queda_do_numero).toBe(false);
  });
});

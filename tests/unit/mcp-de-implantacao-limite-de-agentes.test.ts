/**
 * FORK MIA (MIA-250 D) — O LIMITE DE AGENTES DO PLANO PELO MCP DE PLATAFORMA,
 * o caminho inteiro (tools/list, guarda, argumentos, handler, resposta em texto).
 *
 * O banco em memória não tem gatilho: aqui o `insert` em `ai_agents` recusa
 * como o `trg_mia_trava_agentes_do_plano` da 9174 recusaria (PT402 com
 * `limite_do_plano:agentes:<teto>`, contando os não arquivados). O gatilho de
 * verdade é provado em tests/invariants/limite-de-agentes-do-plano.test.ts.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";
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

const AGENTE = {
  nome: "Recepção",
  prompt: "Você é a recepção da Academia Alfa. Entenda o que a pessoa procura antes de oferecer um horário de aula experimental.",
  pacotes: ["vender"],
};

type Cliente = { from: (t: string) => Record<string, unknown>; rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> };

/** O cenário com o teto do plano: `null` = sem limite (o gatilho sai na hora). */
async function preparar(teto: number | null) {
  const cenario = cenarioDaImplantacao();
  const cliente = cenario.cliente as unknown as Cliente;
  const tabela = (nome: string) => cenario.banco.tabela(nome) as Linha[];
  const from = cliente.from.bind(cliente);
  const rpc = cliente.rpc.bind(cliente);
  const recusado = () => {
    const erro = { data: null, error: { code: "PT402", message: `limite_do_plano:agentes:${teto}` } };
    const q: Record<string, unknown> = {
      select: () => q,
      single: async () => erro,
      maybeSingle: async () => erro,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(erro).then(ok),
    };
    return q;
  };
  cliente.from = (t: string) => {
    const q = from(t);
    if (t !== "ai_agents" || teto === null) return q;
    return new Proxy(q, {
      get(alvo, prop) {
        if (prop !== "insert") return Reflect.get(alvo, prop);
        return (linha: Linha) => {
          const emUso = tabela("ai_agents").filter((a) => a.organization_id === ORG && !a.archived_at).length;
          return emUso >= teto ? recusado() : (alvo.insert as (l: Linha) => unknown)(linha);
        };
      },
    });
  };
  cliente.rpc = (nome, args) => (nome === "fn_mia_limite_de_agentes" ? Promise.resolve({ data: teto, error: null }) : rpc(nome, args));
  estado.cliente = cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { mcp, tabela };
}

describe("plataforma_garantir_agente com o teto do plano cheio", () => {
  it("⭐ recusa que ENSINA: diz o teto, que nada foi criado e os três caminhos", async () => {
    const c = await preparar(1);
    const primeiro = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE });
    expect(primeiro.erro, primeiro.texto).toBe(false);

    const segundo = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE, nome: "Vendas" });
    expect(segundo.erro).toBe(true);
    expect(segundo.texto).toContain("O plano da empresa permite 1 agente de IA e ele já foi criado. Nada foi criado.");
    expect(segundo.texto).toContain("plataforma_garantir_planos (campo agentes)");
    expect(c.tabela("ai_agents")).toHaveLength(1);
    expect(c.tabela("ai_agent_versions")).toHaveLength(1);
  });

  it("⭐ reexecução segura: o agente que já existe pelo nome é atualizado e não conta de novo", async () => {
    const c = await preparar(1);
    expect((await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE })).erro).toBe(false);
    const deNovo = await c.mcp.chamar("plataforma_garantir_agente", {
      organization_id: ORG,
      ...AGENTE,
      prompt: `${AGENTE.prompt} Fale de um jeito leve.`,
    });
    expect(deNovo.erro, deNovo.texto).toBe(false);
    expect(c.tabela("ai_agents")).toHaveLength(1);
  });

  it("sem teto, cria quantos pedir (nada muda para ninguém)", async () => {
    const c = await preparar(null);
    for (const nome of ["Recepção", "Vendas", "Pós-venda"]) {
      const r = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE, nome });
      expect(r.erro, r.texto).toBe(false);
    }
    expect(c.tabela("ai_agents")).toHaveLength(3);
  });
});

describe("plataforma_ver_agentes mostra a vaga", () => {
  it("⭐ em_uso e limite_do_plano da empresa; sem teto, limite null", async () => {
    const c = await preparar(2);
    await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE });
    const lido = await c.mcp.chamar("plataforma_ver_agentes", { organization_id: ORG });
    expect(lido.erro, lido.texto).toBe(false);
    expect(lido.dados.limite_de_agentes).toEqual({ em_uso: 1, limite_do_plano: 2 });

    const sem = await preparar(null);
    const lidoSem = await sem.mcp.chamar("plataforma_ver_agentes", { organization_id: ORG });
    expect(lidoSem.dados.limite_de_agentes).toEqual({ em_uso: 0, limite_do_plano: null });
  });

  it("o arquivado não ocupa vaga", async () => {
    const c = await preparar(5);
    await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE });
    await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...AGENTE, nome: "Vendas" });
    c.tabela("ai_agents")[0]!.archived_at = "2026-11-27T12:00:00Z";
    const lido = await c.mcp.chamar("plataforma_ver_agentes", { organization_id: ORG });
    expect(lido.dados.limite_de_agentes).toEqual({ em_uso: 1, limite_do_plano: 5 });
  });
});

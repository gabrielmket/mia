/**
 * FORK MIA — as ferramentas das EMPRESAS DE DEMONSTRAÇÃO, sem banco.
 *
 * O caminho de verdade (a semente gravando pelo Postgres) é o invariante
 * tests/invariants/mcp-de-demonstracao.test.ts. Aqui fica o que dá para provar
 * em memória: a recusa que ensina quando o app não alcança o Postgres, e que a
 * conferência acontece antes de qualquer escrita.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
// O app sem SUPABASE_DB_URL: o pool do motor recusa, como faz em produção.
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => {
    throw new Error("SUPABASE_DB_URL ausente — rascunho da IA indisponível");
  },
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");

let cenario: ReturnType<typeof cenarioDaImplantacao>;

beforeEach(() => {
  cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
});

describe("as ferramentas das demonstrações", () => {
  it("as três estão na lista, com a operação de cada uma", () => {
    const porNome = new Map(FERRAMENTAS.map((f) => [f.name, f.operacao]));
    expect(porNome.get("plataforma_listar_demonstracoes")).toBeNull();
    expect(porNome.get("plataforma_criar_demonstracao")).toBe("criar_cliente");
    expect(porNome.get("plataforma_reaplicar_demonstracao")).toBe("implantar_configuracao");
  });

  it("⭐ sem SUPABASE_DB_URL no app: a recusa ensina o caminho do terminal, e nada é gravado", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["criar_cliente"]);
    const r = await mcp.chamar("plataforma_criar_demonstracao", { segmento: "construtora" });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("SUPABASE_DB_URL");
    expect(r.texto).toContain("scripts/cliente-modelo.ts --segmento construtora --sql");
    expect(r.texto).toContain("Nada foi gravado");
    expect(cenario.banco.escritas).toEqual([]);
  });

  it("segmento que não existe é recusado na conferência dos argumentos, com a lista", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["criar_cliente"]);
    const r = await mcp.chamar("plataforma_criar_demonstracao", { segmento: "padaria" });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não passou na conferência dos argumentos");
    expect(r.texto).toContain('"construtora"');
    expect(cenario.banco.escritas).toEqual([]);
  });

  it("a listagem responde sem o Postgres do app: só lê pelo cliente de sempre", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_listar_demonstracoes", {});
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.demonstracoes as unknown[]).length).toBe(5);
    // O aviso diz o que a trava segura (9010 e 9016) e a única coisa que ela
    // deixa sair desde a 9020: o convite de equipe.
    expect(r.dados.trava).toContain("migrations 9010 e 9016");
    expect(r.dados.trava).toContain("A única exceção é o convite de equipe");
    expect(r.dados.trava).toContain("plataforma_convidar_pessoas");
  });
});

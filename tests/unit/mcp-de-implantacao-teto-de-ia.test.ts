/**
 * FORK MIA (MIA-309) · `plataforma_definir_teto_de_ia` e o teto dentro de
 * `plataforma_ver_consumo_de_ia`, pelo servidor inteiro (tools/list, a guarda
 * da operação, a conferência dos argumentos, o handler e a resposta), sobre o
 * banco em memória dos testes do MCP de implantação.
 *
 * A regra é a do PATCH de `/api/v1/ai/budget` (`decidirMudancaDoTeto`): a
 * escada off → avisar → bloquear, o piso de US$ 1,00, a carência de 72 horas e
 * o desarme que zera a data. Aqui, o que o MCP acrescenta: reexecução segura,
 * recusa que ensina, a operação própria e a empresa de demonstração.
 *
 * Empresa fictícia (a Clínica Exemplo do cenário), valores fictícios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({
  cliente: null as unknown,
  auditados: [] as Array<{ action: string; organizationId?: string; metadata?: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: { action: string; organizationId?: string; metadata?: Record<string, unknown> }) => {
    estado.auditados.push(e);
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTA_POR_NOME } = await import("@/lib/mcp-plataforma/ferramentas");
const { operacaoPorChave } = await import("@/lib/mcp-plataforma/operacoes");
const { lerTetoDeIa, decidirMudancaDoTeto } = await import("@/lib/ai/budget/mudanca-do-teto");

const AGORA = new Date("2026-11-27T12:00:00.000Z");
const SETENTA_E_DUAS_HORAS = 72 * 60 * 60 * 1000;

let cenario: ReturnType<typeof cenarioDaImplantacao>;

function montar(opcoes: Parameters<typeof cenarioDaImplantacao>[0] = {}) {
  cenario = cenarioDaImplantacao(opcoes);
  cenario.banco.db.ai_budgets = [];
  cenario.banco.db.agent_inbox_items = [];
  estado.cliente = cenario.cliente;
}

async function chamar(args: Record<string, unknown>, operacoes: string[] = TODAS_AS_OPERACOES) {
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
  const r = await mcp.chamar("plataforma_definir_teto_de_ia", { organization_id: ORG, ...args });
  await mcp.fechar();
  return r;
}

const linhaDoTeto = () => cenario.banco.db.ai_budgets!.find((l) => l.organization_id === ORG);
const escritasDoTeto = () => cenario.banco.escritas.filter((e) => e.tabela === "ai_budgets");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  estado.auditados = [];
  montar();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a ferramenta e a operação", () => {
  it("está na lista, pede `definir_teto_de_ia`, e o raio fala de dinheiro e da IA que para", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_definir_teto_de_ia")?.operacao).toBe("definir_teto_de_ia");
    const op = operacaoPorChave("definir_teto_de_ia")!;
    expect(op.raio).toMatch(/dinheiro/i);
    expect(op.raio).toMatch(/PARAR a IA/);
    expect(op.raio).toMatch(/token do Gabriel/);
  });

  it("token sem a operação: recusa antes de olhar o pedido, dizendo qual operação pedir, e nada é gravado", async () => {
    const r = await chamar({ teto_usd_cents: 5000, modo: "avisar" }, ["implantar_configuracao"]);
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("definir_teto_de_ia");
    expect(escritasDoTeto()).toEqual([]);
  });
});

describe("plataforma_definir_teto_de_ia", () => {
  it("⭐ empresa sem teto: grava teto e aviso, com o teto explícito, e audita o antes e o depois", async () => {
    const r = await chamar({ teto_usd_cents: 5000, modo: "avisar", limiar_pct: 85 });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({
      ja_estava: false,
      antes: { teto_usd_cents: 0, modo: "off", limiar_pct: 80 },
      teto_de_ia: { gravado: true, teto_usd_cents: 5000, modo: "avisar", limiar_pct: 85, parada_vale_desde: null },
      gasto_do_mes_usd_cents: 0,
      ia_parada_agora: false,
    });
    expect(linhaDoTeto()).toMatchObject({ monthly_limit_cents: 5000, enforcement_mode: "avisar", alarm_threshold_pct: 85 });
    expect(estado.auditados).toEqual([
      expect.objectContaining({
        action: "ai.budget_limit_changed",
        organizationId: ORG,
        metadata: expect.objectContaining({
          via: "mcp_plataforma",
          enforcement_mode: { antes: "off", depois: "avisar" },
          monthly_limit_cents: { antes: 0, depois: 5000 },
          alarm_threshold_pct: { antes: 80, depois: 85 },
        }),
      }),
    ]);
  });

  it("⭐ REEXECUÇÃO: o mesmo pedido de novo responde `ja_estava`, sem gravar nem auditar", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    const escritasAntes = escritasDoTeto().length;
    const auditoriasAntes = estado.auditados.length;

    const r = await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ ja_estava: true, teto_de_ia: { teto_usd_cents: 5000, modo: "avisar" } });
    expect(escritasDoTeto()).toHaveLength(escritasAntes);
    expect(estado.auditados).toHaveLength(auditoriasAntes);
  });

  it("pedir o estado de quem nunca teve teto (off, sem teto) também é `ja_estava`: nenhuma linha nasce", async () => {
    const r = await chamar({ modo: "off" });
    expect(r.dados).toMatchObject({ ja_estava: true, teto_de_ia: { gravado: false, modo: "off", teto_usd_cents: 0 } });
    expect(escritasDoTeto()).toEqual([]);
  });

  it("⭐ recusa que ensina: de `off` direto para `bloquear`, com o caminho pelo MCP, e nada é gravado", async () => {
    const r = await chamar({ teto_usd_cents: 5000, modo: "bloquear" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('salve "Me avisar"');
    expect(r.texto).toContain('chame primeiro com { "modo": "avisar" }');
    expect(escritasDoTeto()).toEqual([]);
    expect(estado.auditados).toEqual([]);
  });

  it("recusa que ensina: avisar com teto abaixo do piso de US$ 1,00", async () => {
    const r = await chamar({ teto_usd_cents: 50, modo: "avisar" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("US$ 1,00");
    expect(r.texto).toContain('"teto_usd_cents" de pelo menos 100');
    expect(escritasDoTeto()).toEqual([]);
  });

  it("sem campo nenhum: a recusa diz o que mandar, com exemplo", async () => {
    const r = await chamar({});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"teto_usd_cents", "modo" ou "limiar_pct"');
    expect(r.texto).toContain("Exemplo");
  });

  it.each([[30], [100]])("limiar %i (fora de 50 a 99) é recusado pelo schema, com o exemplo que passa", async (limiar) => {
    const r = await chamar({ limiar_pct: limiar });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("limiar_pct");
    expect(r.texto).toContain("Exemplo de chamada válida");
    expect(escritasDoTeto()).toEqual([]);
  });

  it("⭐ armar a parada: vale 72 horas depois, audita `armed`, e a resposta diz quando", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    const r = await chamar({ modo: "bloquear" });
    expect(r.erro, r.texto).toBe(false);
    const quando = new Date(AGORA.getTime() + SETENTA_E_DUAS_HORAS).toISOString();
    expect(r.dados).toMatchObject({ teto_de_ia: { modo: "bloquear", parada_vale_desde: quando } });
    expect(String(r.dados.aviso_da_parada)).toContain("72 horas");
    expect(linhaDoTeto()).toMatchObject({ enforcement_mode: "bloquear", enforcement_effective_at: quando });
    expect(estado.auditados.at(-1)).toMatchObject({
      action: "ai.budget_enforcement_armed",
      metadata: { enforcement_effective_at: quando, confirmar_imediato: false },
    });
  });

  it("armar com `comecar_agora`: a parada vale já", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    const r = await chamar({ modo: "bloquear", comecar_agora: true });
    expect(r.dados).toMatchObject({ teto_de_ia: { parada_vale_desde: AGORA.toISOString() } });
    expect(String(r.dados.aviso_da_parada)).toContain("a partir de agora");
  });

  it("⭐ desarmar: zera a data, audita `disarmed` e fecha os avisos de orçamento abertos (não o do plano)", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    await chamar({ modo: "bloquear", comecar_agora: true });
    cenario.banco.db.agent_inbox_items = [
      { id: "aviso-1", organization_id: ORG, kind: "budget_exceeded", ref_kind: "ai_budget", status: "open" },
      { id: "aviso-2", organization_id: ORG, kind: "budget_warning", ref_kind: null, status: "open" },
      { id: "aviso-do-plano", organization_id: ORG, kind: "budget_exceeded", ref_kind: "plano", status: "open" },
    ];

    const r = await chamar({ modo: "avisar" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ teto_de_ia: { modo: "avisar", parada_vale_desde: null }, ia_parada_agora: false });
    expect(linhaDoTeto()).toMatchObject({ enforcement_mode: "avisar", enforcement_effective_at: null });
    expect(estado.auditados.at(-1)).toMatchObject({ action: "ai.budget_enforcement_disarmed" });
    const situacao = Object.fromEntries(cenario.banco.db.agent_inbox_items!.map((i) => [i.id, i.status]));
    expect(situacao).toEqual({ "aviso-1": "resolved", "aviso-2": "resolved", "aviso-do-plano": "open" });
  });

  it("mexer no teto de quem já está armado não devolve a carência", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    await chamar({ modo: "bloquear" });
    const quando = linhaDoTeto()!.enforcement_effective_at;
    vi.setSystemTime(new Date(AGORA.getTime() + 60 * 60 * 1000));
    const r = await chamar({ teto_usd_cents: 9000 });
    expect(r.dados).toMatchObject({ teto_de_ia: { teto_usd_cents: 9000, modo: "bloquear", parada_vale_desde: quando } });
    expect(linhaDoTeto()!.enforcement_effective_at).toBe(quando);
  });

  it("empresa que não existe: a recusa diz onde achar o id", async () => {
    const r = await chamar({ organization_id: "0a000000-0000-4000-8000-0000000000ff", modo: "off" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("plataforma_listar_clientes");
  });
});

describe("a empresa de demonstração", () => {
  it("⭐ grava como em qualquer empresa (nada sai para fora), e o aviso diz o efeito na demonstração", async () => {
    montar({ demonstracao: true });
    const r = await chamar({ teto_usd_cents: 2000, modo: "avisar" });
    expect(r.erro, r.texto).toBe(false);
    expect(String(r.dados.aviso)).toContain("Empresa de demonstração");
    expect(linhaDoTeto()).toMatchObject({ monthly_limit_cents: 2000, enforcement_mode: "avisar" });
    // Nada vai para fila de saída, e-mail ou contato: só o teto e a auditoria.
    expect(new Set(cenario.banco.escritas.map((e) => e.tabela))).toEqual(new Set(["ai_budgets"]));
  });

  it("a reexecução na demonstração também é `ja_estava`", async () => {
    montar({ demonstracao: true });
    await chamar({ teto_usd_cents: 2000, modo: "avisar" });
    const r = await chamar({ teto_usd_cents: 2000, modo: "avisar" });
    expect(r.dados).toMatchObject({ ja_estava: true });
  });
});

describe("o teto na leitura do consumo (`plataforma_ver_consumo_de_ia`)", () => {
  it("⭐ a ferramenta devolve `teto_de_ia`, e a descrição diz como mudar", async () => {
    await chamar({ teto_usd_cents: 5000, modo: "avisar" });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_consumo_de_ia", { organization_id: ORG, mes: "2026-11" });
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.teto_de_ia).toEqual({
      gravado: true,
      teto_usd_cents: 5000,
      limiar_pct: 80,
      modo: "avisar",
      parada_vale_desde: null,
    });
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia")!.description).toContain("plataforma_definir_teto_de_ia");
  });

  it("empresa sem teto: `gravado: false`, sem teto e modo off", async () => {
    expect(await lerTetoDeIa(cenario.cliente as never, ORG)).toEqual({
      gravado: false,
      teto_usd_cents: 0,
      limiar_pct: 80,
      modo: "off",
      parada_vale_desde: null,
    });
  });

  it("leitura que falhou é `null` (não sei), nunca \"sem teto\"", async () => {
    const quebrado = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "fora do ar" } }) }) }) }) };
    expect(await lerTetoDeIa(quebrado as never, ORG)).toBeNull();
  });
});

describe("a regra comum é a mesma da rota", () => {
  it("o pedido só com `confirmar_imediato` sobre uma parada já armada não muda nada", () => {
    const d = decidirMudancaDoTeto(
      { monthly_limit_cents: 5000, alarm_threshold_pct: 80, enforcement_mode: "bloquear", enforcement_effective_at: "2026-11-30T00:00:00.000Z" },
      { enforcement_mode: "bloquear", confirmar_imediato: true },
      AGORA.getTime(),
    );
    expect(d).toMatchObject({ ok: true, jaEstava: true, armando: false });
  });
});

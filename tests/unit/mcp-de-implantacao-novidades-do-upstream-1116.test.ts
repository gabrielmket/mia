/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.108 A 1.116 AO ALCANCE DO MCP DE
 * PLATAFORMA (MIA-59: o que ficou na lista "Falta no MCP" da fusão).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *   - as categorias de perda próprias do funil (#4437, 1.111);
 *   - o filtro de funil e etiqueta do gatilho "negócio criado" do follow-up (#4587);
 *   - os gatilhos "negócio alterado" (9383) e "ligação recebida não atendida" (#4365)
 *     em `plataforma_garantir_automacao`.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, telefonia: false }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
// A telefonia em uso lê tronco, número e ligações; aqui o que importa é a resposta.
vi.mock("@/lib/telefonia/em-uso", () => ({ telefoniaEmUso: vi.fn(async () => estado.telefonia) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

async function preparar() {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  estado.telefonia = false;
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

describe("plataforma_garantir_funil · CAMPO NOVO `categorias_de_perda` (upstream 1.111, #4437)", () => {
  const ETAPAS = [
    { nome: "Novo contato", passo: "new" },
    { nome: "Fechado", passo: "won" },
    { nome: "Perdido", passo: "lost" },
  ];
  const base = { nome: "Vendas", adotar_funil_padrao: true, etapas: ETAPAS };
  const settingsDoFunil = (c: Cenario) => c.tabela("crm_pipelines").find((f) => f.name === "Vendas")!.settings as Linha;
  const lerFunil = async (c: Cenario) =>
    ((await ok(c, "plataforma_ver_funis", { funil: "Vendas" })).dados.funis as Linha[]).find((f) => f.nome === "Vendas")!;

  it("⭐ sem declarar, a leitura mostra as de fábrica; declarar grava a chave pela porta da tela; repetir não escreve", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", base);
    expect(settingsDoFunil(c)).not.toHaveProperty("lost_reason_categories");
    expect(await lerFunil(c)).toMatchObject({
      categorias_de_perda: ["Cliente", "Concorrência", "Mérito", "Nós", "Ausência"],
      categorias_de_perda_declaradas: false,
    });

    const r = await ok(c, "plataforma_garantir_funil", {
      ...base,
      categorias_de_perda: [" Preço ", "Risco", "Preço"],
      motivos_de_perda: [{ label: "Possível fraude", categoria: "Risco" }],
    });
    expect(settingsDoFunil(c).lost_reason_categories).toEqual(["Preço", "Risco"]);
    expect(JSON.stringify(r.dados)).toContain("categorias de perda");
    expect(await lerFunil(c)).toMatchObject({ categorias_de_perda: ["Preço", "Risco"], categorias_de_perda_declaradas: true });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_funil", { ...base, categorias_de_perda: ["Preço", "Risco"] });
    expect(JSON.stringify(de_novo.dados)).not.toContain("categorias de perda");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("[] esconde todas (a de fábrica não volta); o motivo que já usava continua agrupado na categoria dele", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", {
      ...base,
      categorias_de_perda: ["Risco"],
      motivos_de_perda: [{ label: "Possível fraude", categoria: "Risco" }],
    });
    await ok(c, "plataforma_garantir_funil", { ...base, categorias_de_perda: [] });
    expect(settingsDoFunil(c).lost_reason_categories).toEqual([]);
    expect(settingsDoFunil(c).lost_reasons).toEqual([{ label: "Possível fraude", categoria: "Risco" }]);
    // O catálogo efetivo segue mostrando a categoria em uso, e não ressuscita a de fábrica.
    expect(await lerFunil(c)).toMatchObject({ categorias_de_perda: ["Risco"], categorias_de_perda_declaradas: true });
  });

  it("acima do teto do domínio (30 categorias, 40 letras) é recusado sem gravar", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", base);
    expect(await recusa(c, "plataforma_garantir_funil", { ...base, categorias_de_perda: ["x".repeat(41)] })).toBeTruthy();
    const muitas = Array.from({ length: 31 }, (_, i) => `Categoria ${i + 1}`);
    expect(await recusa(c, "plataforma_garantir_funil", { ...base, categorias_de_perda: muitas })).toBeTruthy();
    expect(settingsDoFunil(c)).not.toHaveProperty("lost_reason_categories");
  });
});

describe("plataforma_garantir_followup · CAMPOS NOVOS `funil_do_negocio` e `etiqueta_do_negocio` (upstream 1.115, #4587)", () => {
  const FLUXO = "Retomada · voltar a quem parou de responder";
  const fluxoNoBanco = (c: Cenario) => c.tabela("followup_flow_pointers").find((f) => f.organization_id === ORG && f.name === FLUXO)!;

  /** Não há modelo de "negócio criado": o fluxo ganha o gatilho como se fosse pela tela. */
  async function fluxoDeNegocioCriado(c: Cenario) {
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    fluxoNoBanco(c).trigger_config = { kind: "lead_created" };
  }

  it("⭐ grava o funil pelo id resolvido do NOME e a etiqueta normalizada; a leitura mostra; repetir é ja_estava sem escrever", async () => {
    const c = await preparar();
    await fluxoDeNegocioCriado(c);

    const r = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: "pedidos", etiqueta_do_negocio: " VIP " });
    expect(r.dados.fluxo).toMatchObject({ desfecho: "atualizou" });
    expect(fluxoNoBanco(c).trigger_config).toEqual({ kind: "lead_created", params: { pipeline_id: FUNIL_SEMEADO, tag: "vip" } });

    const lido = await ok(c, "plataforma_ver_followup", { fluxo: FLUXO });
    expect(lido.dados.gatilho).toMatchObject({ params: { pipeline_id: FUNIL_SEMEADO, tag: "vip" } });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: FUNIL_SEMEADO, etiqueta_do_negocio: "vip" });
    expect((de_novo.dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("null tira cada filtro sem mexer no outro; sem nenhum, o gatilho volta a valer para qualquer card", async () => {
    const c = await preparar();
    await fluxoDeNegocioCriado(c);
    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: "Pedidos", etiqueta_do_negocio: "vip" });

    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, etiqueta_do_negocio: null });
    expect(fluxoNoBanco(c).trigger_config).toEqual({ kind: "lead_created", params: { pipeline_id: FUNIL_SEMEADO } });

    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: null });
    expect(fluxoNoBanco(c).trigger_config).toEqual({ kind: "lead_created" });
  });

  it("recusa que ensina: funil que não existe nesta empresa, e o filtro em fluxo de outro gatilho", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const outroGatilho = await recusa(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: "Pedidos" });
    expect(outroGatilho).toContain("só vale para fluxo que dispara por negócio criado");

    fluxoNoBanco(c).trigger_config = { kind: "lead_created" };
    const semFunil = await recusa(c, "plataforma_garantir_followup", { nome: FLUXO, funil_do_negocio: "Funil que não existe" });
    expect(semFunil).toContain("Pedidos");
    expect(fluxoNoBanco(c).trigger_config).toEqual({ kind: "lead_created" });
  });
});

describe("plataforma_garantir_automacao · GATILHOS NOVOS `lead.updated` (9383) e `voice_call.missed` (#4365)", () => {
  const regra = (c: Cenario, nome: string) => c.tabela("automation_rules").find((r) => r.name === nome);

  it("⭐ `lead.updated` com a condição `campo_alterado` grava pela régua da tela; o catálogo ensina o gatilho e os campos", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_automacao", {
      nome: "Avisar quando a data prevista mudar",
      gatilho: "lead.updated",
      condicoes: [{ field: "event.fields", op: "campo_alterado", value: "expected_close_date" }],
      acoes: [{ type: "add_tag", config: { tags: ["data-mudou"] } }],
    });
    const gravada = regra(c, "Avisar quando a data prevista mudar")!;
    expect(gravada.trigger_event).toBe("lead.updated");
    expect(gravada.conditions).toEqual([{ field: "event.fields", op: "campo_alterado", value: "expected_close_date" }]);
    expect(gravada.is_active ?? false).toBe(false);

    // O catálogo é da instalação: não leva `organization_id`.
    const catalogo = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes"] });
    expect(catalogo.erro, catalogo.texto).toBe(false);
    const texto = JSON.stringify(catalogo.dados);
    expect(texto).toContain("lead.updated");
    expect(texto).toContain("expected_close_date");
    expect(texto).toContain("voice_call.missed");
  });

  it("a condição `campo_alterado` fora do `lead.updated` é recusada (ela nunca casaria)", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_automacao", {
      nome: "Condição no gatilho errado",
      gatilho: "lead.won",
      condicoes: [{ field: "event.fields", op: "campo_alterado", value: "expected_close_date" }],
      acoes: [{ type: "add_tag", config: { tags: ["x"] } }],
    });
    expect(texto).toBeTruthy();
    expect(regra(c, "Condição no gatilho errado")).toBeUndefined();
  });

  it("`voice_call.missed` sem telefonia em uso é recusado sem gravar; com ela, grava", async () => {
    const c = await preparar();
    const pedido = {
      nome: "Etiquetar quem ligou sem resposta",
      gatilho: "voice_call.missed",
      acoes: [{ type: "add_tag", config: { tags: ["ligou-sem-resposta"] } }],
    };
    const texto = await recusa(c, "plataforma_garantir_automacao", pedido);
    expect(texto).toContain("telefonia");
    expect(regra(c, pedido.nome)).toBeUndefined();

    estado.telefonia = true;
    await ok(c, "plataforma_garantir_automacao", pedido);
    expect(regra(c, pedido.nome)!.trigger_event).toBe("voice_call.missed");
  });
});

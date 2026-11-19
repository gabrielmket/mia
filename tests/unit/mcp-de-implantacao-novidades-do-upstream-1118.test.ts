/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.118 AO ALCANCE DO MCP DE PLATAFORMA
 * (MIA-79: a lista "Falta no MCP" da fusão de 18/11, MIA-73, PR #113).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1117.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *   - o módulo opcional POR EMPRESA (9416, #3868):
 *     `plataforma_definir_modulo_da_empresa` (operação própria) e
 *     `modulos_opcionais` em plataforma_ver_cliente;
 *   - a marca "A IA pode ler este campo" (`ia_pode_ler`, #4684) nos campos do
 *     funil, em plataforma_garantir_funil e plataforma_ver_funis;
 *   - a cor e o critério da etapa (#4802, #4836), pela porta da tela de etapas;
 *   - a tela inicial da empresa e da pessoa (#4864):
 *     `plataforma_definir_tela_inicial` e a seção `equipe` de
 *     plataforma_ver_configuracao;
 *   - as ferramentas do MCP da empresa que mudaram (`crm_update_lead` com
 *     etiquetas, a idempotência do envio, `crm_update_stage` com o critério):
 *     o MCP de plataforma acompanha pelo catálogo, sem cópia.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
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
const { FERRAMENTA_POR_NOME } = await import("@/lib/mcp-plataforma/ferramentas");
const { operacaoPorChave } = await import("@/lib/mcp-plataforma/operacoes");
const { catalogoServido } = await import("@/lib/implantacao/capacidades");
const { filtrarCamposLegiveisPelaIa } = await import("@/lib/leads/campos-do-funil");
const { combinarInterfaces, homeDaInterface } = await import("@/lib/navigation/interface");
const { allTools } = await import("@/lib/mcp/tools");
const { audit } = await import("@/lib/audit");

async function preparar(operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

// ---------------------------------------------------------------------------

describe("o módulo opcional por empresa (9416) · plataforma_definir_modulo_da_empresa", () => {
  /** A instalação com o cold call ligado e os fluxos de atendimento desligados. */
  function instalacao(c: Cenario) {
    c.tabela("platform_config").push({ chave: "MODULO_COLD_CALL", valor: "ligado" });
    c.tabela("organization_modules").push({ organization_id: OUTRA_ORG, modulo: "cold_call", estado: "desligado" });
  }

  it("existe, com a operação própria (não a `liberar_modulo` do módulo vendido)", () => {
    const f = FERRAMENTA_POR_NOME.get("plataforma_definir_modulo_da_empresa");
    expect(f?.operacao).toBe("gerir_modulo_opcional");
    expect(operacaoPorChave("gerir_modulo_opcional")?.raio).toMatch(/QUALQUER cliente/);
  });

  it("⭐ desligar grava SÓ a exceção da empresa, com a trilha da tela, e ver_cliente mostra", async () => {
    const c = await preparar();
    instalacao(c);
    const r = await ok(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "desligado" });
    expect(r.dados).toMatchObject({ desfecho: "desligou", modulo: { modulo: "cold_call", estado: "desligado", efetivo: false } });

    const linhas = c.tabela("organization_modules");
    expect(linhas.filter((l) => l.organization_id === ORG)).toEqual([
      expect.objectContaining({ organization_id: ORG, modulo: "cold_call", estado: "desligado", updated_by: AUTOR }),
    ]);
    // O módulo vendável do fork não é tocado.
    expect(c.tabela("mia_modulos_contratados")).toEqual([]);
    expect(auditadas("organization.modulo_updated")).toEqual([
      expect.objectContaining({ metadata: { modulo: "cold_call", de: "herda", para: "desligado", via: "mcp_plataforma" } }),
    ]);

    const v = await ok(c, "plataforma_ver_cliente", {});
    const opcionais = v.dados.modulos_opcionais as Array<Record<string, unknown>>;
    expect(opcionais.find((m) => m.modulo === "cold_call")).toEqual({
      modulo: "cold_call",
      estado: "desligado",
      efetivo: false,
      bloqueado_pela_instalacao: false,
    });
    expect(opcionais.find((m) => m.modulo === "fluxos_atendimento")).toMatchObject({ estado: "herda", bloqueado_pela_instalacao: true });
  });

  it("REEXECUÇÃO: o mesmo pedido responde ja_estava, e nada é escrito nem auditado", async () => {
    const c = await preparar();
    instalacao(c);
    await ok(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "desligado" });
    vi.mocked(audit).mockClear();
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "desligado" });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
    expect(auditadas("organization.modulo_updated")).toEqual([]);
  });

  it("`herda` apaga só a linha desta empresa: a da outra fica", async () => {
    const c = await preparar();
    instalacao(c);
    await ok(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "desligado" });
    const r = await ok(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "herda" });
    expect(r.dados).toMatchObject({ desfecho: "voltou_ao_padrao", modulo: { estado: "herda", efetivo: true } });
    expect(c.tabela("organization_modules")).toEqual([
      expect.objectContaining({ organization_id: OUTRA_ORG, modulo: "cold_call", estado: "desligado" }),
    ]);
  });

  it("RECUSA QUE ENSINA: ligar o que a instalação tem desligado (a instalação é o teto), e nada é gravado", async () => {
    const c = await preparar();
    instalacao(c);
    const texto = await recusa(c, "plataforma_definir_modulo_da_empresa", { modulo: "fluxos_atendimento", estado: "ligado" });
    expect(texto).toMatch(/DESLIGADO na instalação/);
    expect(texto).toMatch(/\/admin\/sistema/);
    expect(c.tabela("organization_modules").filter((l) => l.organization_id === ORG)).toEqual([]);
  });

  it("módulo que é só da instalação (cobrança) nem passa pelo schema", async () => {
    const c = await preparar();
    await recusa(c, "plataforma_definir_modulo_da_empresa", { modulo: "cobranca", estado: "desligado" });
    expect(c.tabela("organization_modules")).toEqual([]);
  });

  it("sem a operação no token, recusa (a `liberar_modulo` do módulo vendido não basta)", async () => {
    const c = await preparar(["liberar_modulo", "implantar_configuracao"]);
    instalacao(c);
    const texto = await recusa(c, "plataforma_definir_modulo_da_empresa", { modulo: "cold_call", estado: "desligado" });
    expect(texto).toMatch(/gerir_modulo_opcional/);
    expect(c.tabela("organization_modules").filter((l) => l.organization_id === ORG)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("a marca \"A IA pode ler este campo\" (#4684) · plataforma_garantir_funil e plataforma_ver_funis", () => {
  const ETAPAS = [
    { nome: "Novo contato", passo: "new" },
    { nome: "Fechou", passo: "won" },
    { nome: "Não fechou", passo: "lost" },
  ];
  const lerCampos = (c: Cenario) =>
    ((c.tabela("crm_pipelines").find((f) => f.id === FUNIL_SEMEADO)!.settings as Linha).fields ?? []) as Array<Record<string, unknown>>;

  it("⭐ marca só o que o pedido marca: o campo sem `ia_pode_ler` nasce desmarcado, e só o marcado chega à IA", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", {
      nome: "Vendas",
      adotar_funil_padrao: true,
      etapas: ETAPAS,
      campos: [
        { key: "procedimento", label: "Procedimento", type: "text", ia_pode_ler: true },
        { key: "cpf_do_paciente", label: "CPF", type: "text" },
      ],
    });
    const gravados = lerCampos(c);
    expect(gravados.find((f) => f.key === "procedimento")).toMatchObject({ ia_pode_ler: true });
    expect(gravados.find((f) => f.key === "cpf_do_paciente")).not.toHaveProperty("ia_pode_ler");

    // O recorte que o turno do agente aplica (`lib/mcp/tools/leads.ts`) com o que foi gravado.
    const settings = c.tabela("crm_pipelines").find((f) => f.id === FUNIL_SEMEADO)!.settings as Record<string, unknown>;
    expect(filtrarCamposLegiveisPelaIa(settings, { procedimento: "Clareamento", cpf_do_paciente: "000.000.000-00" })).toEqual({
      procedimento: "Clareamento",
    });

    const v = await ok(c, "plataforma_ver_funis", {});
    const lidos = ((v.dados.funis as Array<Record<string, unknown>>)[0]!.campos as Array<Record<string, unknown>>);
    expect(lidos.map((f) => [f.key, f.ia_pode_ler])).toEqual([
      ["procedimento", true],
      ["cpf_do_paciente", false],
    ]);
  });

  it("sem `ia_pode_ler` no pedido, a marca de um campo que já existe não muda; `false` a apaga, como a tela", async () => {
    const c = await preparar();
    const pedido = (campo: Record<string, unknown>) => ({ nome: "Vendas", adotar_funil_padrao: true, etapas: ETAPAS, campos: [campo] });
    await ok(c, "plataforma_garantir_funil", pedido({ key: "procedimento", label: "Procedimento", type: "text", ia_pode_ler: true }));

    const r = await ok(c, "plataforma_garantir_funil", pedido({ key: "procedimento", label: "Procedimento", type: "text" }));
    expect((r.dados.configuracao as Linha).desfecho).toBe("ja_estava");
    expect(lerCampos(c)[0]).toMatchObject({ ia_pode_ler: true });

    await ok(c, "plataforma_garantir_funil", pedido({ key: "procedimento", label: "Procedimento", type: "text", ia_pode_ler: false }));
    expect(lerCampos(c)[0]).not.toHaveProperty("ia_pode_ler");
  });

  it("RECUSA QUE ENSINA: a marca num campo do CONTATO, e nada é gravado", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_funil", {
      nome: "Vendas",
      adotar_funil_padrao: true,
      etapas: ETAPAS,
      campos: [{ key: "nascimento", label: "Nascimento", type: "date", escopo: "contato", ia_pode_ler: true }],
    });
    expect(texto).toMatch(/só vale para campo do NEGÓCIO/);
    expect(lerCampos(c).some((f) => f.key === "nascimento")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("a cor e o critério da etapa (#4802, #4836) · pela porta da tela de etapas", () => {
  const ETAPAS = (extra: Record<string, unknown> = {}) => [
    { nome: "Novo contato", passo: "new" },
    { nome: "Quer orçamento", passo: "qualified", cor: "#0091FF", criterio: "  Pediu o orçamento e disse a data do evento.  ", ...extra },
    { nome: "Fechou", passo: "won" },
    { nome: "Não fechou", passo: "lost" },
  ];
  const etapa = (c: Cenario) => c.tabela("crm_stages").find((e) => e.name === "Quer orçamento")!;

  it("⭐ grava a cor normalizada e o critério aparado, e plataforma_ver_funis devolve os dois", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { nome: "Eventos", adotar_funil_padrao: true, etapas: ETAPAS() });
    expect(etapa(c)).toMatchObject({ color: "#0091ff", description: "Pediu o orçamento e disse a data do evento." });

    const v = await ok(c, "plataforma_ver_funis", {});
    const lida = ((v.dados.funis as Array<Record<string, unknown>>)[0]!.etapas as Array<Record<string, unknown>>).find((e) => e.nome === "Quer orçamento");
    expect(lida).toMatchObject({ cor: "#0091ff", criterio: "Pediu o orçamento e disse a data do evento." });
  });

  it("REEXECUÇÃO: o mesmo pedido não escreve; critério vazio limpa (null), como a tela", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { nome: "Eventos", adotar_funil_padrao: true, etapas: ETAPAS() });
    const antes = c.banco.escritas.filter((e) => e.tabela === "crm_stages").length;
    const r = await ok(c, "plataforma_garantir_funil", { nome: "Eventos", etapas: ETAPAS() });
    expect((r.dados.etapas as Array<Record<string, unknown>>).find((e) => e.nome === "Quer orçamento")).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.filter((e) => e.tabela === "crm_stages").length).toBe(antes);

    const limpo = await ok(c, "plataforma_garantir_funil", { nome: "Eventos", etapas: ETAPAS({ criterio: "" }) });
    expect((limpo.dados.etapas as Array<Record<string, unknown>>).find((e) => e.nome === "Quer orçamento")).toMatchObject({
      desfecho: "atualizou",
      mudancas: ["critério"],
    });
    expect(etapa(c).description).toBeNull();
  });

  it("critério acima do teto da tela (500) nem passa pelo schema", async () => {
    const c = await preparar();
    await recusa(c, "plataforma_garantir_funil", { nome: "Eventos", adotar_funil_padrao: true, etapas: ETAPAS({ criterio: "x".repeat(501) }) });
  });

  it("a cor e o critério saem de `atualizarEtapa` (a operação da tela), não de uma escrita direta", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/implantacao/funil.ts"), "utf8");
    expect(fonte).toMatch(/pedidoDaTela\.color = pedida\.cor/);
    expect(fonte).toMatch(/pedidoDaTela\.description = pedida\.criterio/);
    expect(fonte).not.toMatch(/\.from\("crm_stages"\)\s*\.update\(/);
  });
});

// ---------------------------------------------------------------------------

describe("a tela inicial (#4864) · plataforma_definir_tela_inicial", () => {
  const OUTRA_PESSOA = "0b000000-0000-4000-8000-000000000002";

  function comEquipe(c: Cenario) {
    c.tabela("user_organizations").push({
      id: "0f000000-0000-4000-8000-000000000002",
      organization_id: ORG,
      user_id: OUTRA_PESSOA,
      role: "agent",
      accepted_at: "2026-01-02T00:00:00Z",
      revoked_at: null,
      created_at: "2026-01-02T00:00:00Z",
      interface_settings: null,
    });
    c.usuarios.set(OUTRA_PESSOA, { email: "vendedora@exemplo.invalid", nome: "Pessoa Vendedora" });
  }

  it("⭐ a da EMPRESA: grava só a `inicio`, preserva o menu e a trava do Inbox, e a entrada abre nela", async () => {
    const c = await preparar();
    const org = c.tabela("organizations")[0]!;
    org.interface_settings = { preset: "completa", bloquearAteAssumir: true };
    const r = await ok(c, "plataforma_definir_tela_inicial", { tela: "/app/kanban" });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", de: "empresa", tela_inicial: "/app/kanban" });
    expect(org.interface_settings).toEqual({ preset: "completa", bloquearAteAssumir: true, inicio: "/app/kanban" });
    expect(homeDaInterface(org.interface_settings, false, "agent")).toBe("/app/kanban");
    expect(auditadas("org.interface_changed")).toHaveLength(1);
    expect(c.banco.chamadasRpc.some((r) => r.nome === "emit_event")).toBe(true);

    const de_novo = await ok(c, "plataforma_definir_tela_inicial", { tela: "/app/kanban" });
    expect(de_novo.dados.desfecho).toBe("ja_estava");

    await ok(c, "plataforma_definir_tela_inicial", { tela: null });
    expect(org.interface_settings).toEqual({ preset: "completa", bloquearAteAssumir: true });
  });

  it("RECUSA QUE ENSINA: tela fora do menu da empresa lista as opções, e nada é gravado", async () => {
    const c = await preparar();
    const org = c.tabela("organizations")[0]!;
    org.interface_settings = { preset: "completa", destinos: ["/app/inbox", "/app/agenda"] };
    const texto = await recusa(c, "plataforma_definir_tela_inicial", { tela: "/app/kanban" });
    expect(texto).toMatch(/não está no menu da empresa/);
    expect(texto).toMatch(/\/app\/agenda/);
    expect(org.interface_settings).toEqual({ preset: "completa", destinos: ["/app/inbox", "/app/agenda"] });
  });

  it("⭐ a da PESSOA: grava no vínculo, vence a da empresa, e a leitura da equipe mostra as duas", async () => {
    const c = await preparar();
    comEquipe(c);
    await ok(c, "plataforma_definir_tela_inicial", { tela: "/app/agenda" });
    const r = await ok(c, "plataforma_definir_tela_inicial", { tela: "/app/kanban", pessoa: "vendedora@exemplo.invalid" });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", de: "pessoa", pessoa: { user_id: OUTRA_PESSOA }, tela_inicial: "/app/kanban" });

    const vinculo = c.tabela("user_organizations").find((v) => v.user_id === OUTRA_PESSOA)!;
    expect(vinculo.interface_settings).toEqual({ preset: "completa", inicio: "/app/kanban" });
    const org = c.tabela("organizations")[0]!;
    expect(homeDaInterface(combinarInterfaces(org.interface_settings, vinculo.interface_settings), false, "agent")).toBe("/app/kanban");
    expect(auditadas("team.interface_changed")).toHaveLength(1);

    const v = await ok(c, "plataforma_ver_configuracao", { secoes: ["equipe"] });
    const equipe = v.dados.equipe as { membros: Array<Record<string, unknown>>; tela_inicial: Record<string, unknown> };
    expect(equipe.tela_inicial.da_empresa).toBe("/app/agenda");
    expect(equipe.membros.find((m) => m.user_id === OUTRA_PESSOA)?.tela_inicial).toBe("/app/kanban");
    expect(equipe.membros.find((m) => m.user_id === AUTOR)?.tela_inicial).toBeNull();
  });

  it("RECUSA QUE ENSINA: quem não é da equipe, e o vínculo não é tocado", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_definir_tela_inicial", { tela: "/app/kanban", pessoa: "ninguem@exemplo.invalid" });
    expect(texto).toMatch(/não faz parte da equipe/);
    expect(c.tabela("user_organizations").every((v) => v.interface_settings === undefined)).toBe(true);
  });

  it("tela que não é do catálogo nem passa pelo schema", async () => {
    const c = await preparar();
    await recusa(c, "plataforma_definir_tela_inicial", { tela: "/app/tela-inventada" });
  });
});

// ---------------------------------------------------------------------------

describe("as ferramentas do MCP da empresa que mudaram na 1.118 · o MCP de plataforma acompanha", () => {
  const ferramenta = (nome: string) => allTools.find((t) => t.name === nome)!;

  it("crm_update_lead ganhou tags_adicionar e tags_remover (#4666), e continua no pacote \"vender\"", () => {
    expect(Object.keys(ferramenta("crm_update_lead").inputSchema)).toEqual(expect.arrayContaining(["tags", "tags_adicionar", "tags_remover"]));
    expect(catalogoServido().find((c) => c.id === "crm_update_lead")?.pacotes).toContain("vender");
  });

  it("crm_update_stage grava o critério (#4843), e continua no pacote \"organizar\"", () => {
    expect(Object.keys(ferramenta("crm_update_stage").inputSchema)).toContain("description");
    expect(catalogoServido().find((c) => c.id === "crm_update_stage")?.pacotes).toContain("organizar");
  });

  it("as três que enviam aceitam idempotency_key (#4850) e seguem no catálogo servido", () => {
    for (const nome of ["crm_send_whatsapp_message", "crm_send_material", "crm_start_conversation_and_send"]) {
      expect(Object.keys(ferramenta(nome).inputSchema), nome).toContain("idempotency_key");
      expect(catalogoServido().some((c) => c.id === nome), nome).toBe(true);
    }
  });

  it("o MCP de plataforma não envia mensagem nem copia as ferramentas de dentro: nenhum arquivo importa lib/mcp/tools/messages, start-conversation ou leads", () => {
    const raiz = join(process.cwd(), "lib/mcp-plataforma");
    const arquivos = readFileSync(join(raiz, "ferramentas.ts"), "utf8");
    expect(arquivos).not.toMatch(/lib\/mcp\/tools\/(messages|start-conversation|leads)/);
    for (const nome of ["novidades-1118.ts", "funil.ts", "leituras.ts", "plataforma.ts"]) {
      expect(readFileSync(join(raiz, "ferramentas", nome), "utf8"), nome).not.toMatch(/lib\/mcp\/tools\/(messages|start-conversation|leads)"/);
    }
  });
});

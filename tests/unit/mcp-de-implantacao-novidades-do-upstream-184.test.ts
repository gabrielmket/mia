/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.84 AO ALCANCE DO MCP DE PLATAFORMA (a
 * regra do dono do produto: toda peça nova ou alterada do sistema que seja
 * configuração de implantação ganha ferramenta ou campo no MCP na MESMA versão,
 * a .82).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-183.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Cada bloco
 * prova o que foi GRAVADO, que a REEXECUÇÃO não escreve, a recusa que ensina e
 * a leitura que devolve.
 *
 * A CONTAGEM da lista mora aqui (a versão mais nova): 68. A v1.84 não pediu
 * ferramenta nova; pediu um campo novo e duas regras novas em campos que já
 * existiam.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados,
 * endereços `exemplo.invalid`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionSchema } from "@/lib/schemas/webhooks";
import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
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
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { TIPOS_DE_ACAO } = await import("@/lib/mcp-plataforma/ferramentas/automacoes-e-agenda");
const { audit } = await import("@/lib/audit");

async function preparar(opcoes: OpcoesDoCenario = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
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

const linhaAuditada = (acao: string) => vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === acao);

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Entendendo o caso", passo: "qualifying" },
  { nome: "Quer agendar", passo: "qualified" },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];

async function comFunil(opcoes: OpcoesDoCenario = {}) {
  const c = await preparar(opcoes);
  await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
  return c;
}

const FONTE = {
  nome: "Integração do site",
  destino: { funil: "Agendamentos", etapa: "Novo contato" },
  endereco_de_retorno: "https://exemplo.invalid/obrigado",
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("a lista: 68 ferramentas, e os tipos de ação seguem os do upstream", () => {
  it("a v1.84 não acrescentou ferramenta (68), e a da fonte de formulário segue montando", () => {
    expect(FERRAMENTAS).toHaveLength(68);
    expect(FERRAMENTAS.find((f) => f.name === "plataforma_garantir_fonte_de_formulario")?.operacao).toBe("implantar_configuracao");
  });

  it("⭐ os tipos de ação que a ferramenta aceita são EXATAMENTE os do upstream (a v1.84 não trouxe ação nova)", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
  });
});

// ---------------------------------------------------------------------------
// 1.84 · atualizar o card quando a integração reenvia o mesmo cadastro (0683, #2316)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_fonte_de_formulario · CAMPO NOVO `atualizar_card_no_reenvio` (upstream 1.84, 0683)", () => {
  it("fonte nova não nasce com a opção: a recusa ensina o caminho, e nada é gravado", async () => {
    const c = await comFunil();
    const texto = await recusa(c, "plataforma_garantir_fonte_de_formulario", { ...FONTE, atualizar_card_no_reenvio: true });
    expect(texto).toContain("não nasce com a atualização do card no reenvio");
    expect(texto).toContain("ASSINATURA");
    expect(c.tabela("webhook_sources")).toEqual([]);
  });

  it("⭐ sem ASSINATURA, ligar é recusado com a frase DESTA opção (e não a da IA), e a coluna fica como estava", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    c.tabela("webhook_sources")[0]!.update_existing_lead_on_capture = false;
    const texto = await recusa(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, atualizar_card_no_reenvio: true });
    expect(texto).toContain("atualizar o card no reenvio exige uma");
    expect(texto).not.toContain("autorizar o atendimento por IA");
    expect(c.tabela("webhook_sources")[0]!.update_existing_lead_on_capture).toBe(false);
  });

  it("com a assinatura posta pela tela, liga: grava a coluna da 0683, audita sem o segredo e avisa o que muda", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    const fonte = c.tabela("webhook_sources")[0]!;
    fonte.secret_encrypted = "cifra-ficticia";
    fonte.update_existing_lead_on_capture = false;

    const liga = await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, atualizar_card_no_reenvio: true });
    expect(liga.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["atualizar o card no reenvio"] });
    expect(c.tabela("webhook_sources")[0]).toMatchObject({ update_existing_lead_on_capture: true, last_change_actor_kind: "user" });
    const avisos = (liga.dados.avisos as string[]).join(" ");
    expect(avisos).toContain("mesmo `external_id`");
    expect(avisos).toContain("sobrescrito");
    expect((liga.dados.fonte as Linha).atualizar_card_no_reenvio).toBe(true);
    const linha = linhaAuditada("webhook.source_updated")!;
    expect(linha.metadata).toMatchObject({ update_existing_lead_on_capture: true, via: "mcp_plataforma" });
    expect(JSON.stringify(linha)).not.toContain("cifra-ficticia");
    expect(JSON.stringify(liga.dados)).not.toContain("cifra-ficticia");

    // Reexecutar não escreve.
    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, atualizar_card_no_reenvio: true })).dados.desfecho).toBe(
      "ja_estava",
    );
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    // Desligar não pede assinatura e avisa que volta a ser reenvio.
    const desliga = await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, atualizar_card_no_reenvio: false });
    expect(c.tabela("webhook_sources")[0]!.update_existing_lead_on_capture).toBe(false);
    expect((desliga.dados.avisos as string[]).join(" ")).toContain("volta a ser só reenvio");
  });

  it("CONTROLE: com a opção da IA ligada e sem assinatura, a recusa é a da IA (a régua é a da rota, `opcaoSemAssinatura`)", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    const texto = await recusa(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, autorizar_ia_na_captura: true });
    expect(texto).toContain("autorizar o atendimento por IA na captação exige uma");
  });

  it("a leitura (plataforma_ver_configuracao) devolve a opção de cada fonte", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    c.tabela("webhook_sources")[0]!.update_existing_lead_on_capture = true;
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["fontes_de_formulario"] });
    expect(JSON.stringify(r.dados)).toContain('"atualizar_card_no_reenvio":true');
  });
});

// ---------------------------------------------------------------------------
// 1.84 · trocar o país sugere o fuso dele (#2347, item 4)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_empresa · trocar o `pais` leva o fuso do país (upstream 1.84, #2347)", () => {
  const empresa = (c: Cenario) => c.tabela("organizations").find((o) => o.id === ORG)!;

  it("país novo sem `fuso`: o fuso sugerido do país é gravado junto, e a resposta avisa", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_empresa", { pais: "PT" });
    expect(empresa(c)).toMatchObject({ country: "PT", timezone: "Europe/Lisbon" });
    expect((r.dados.avisos as string[]).join(" ")).toContain("Europe/Lisbon");
  });

  it("país novo COM `fuso`: vale o fuso pedido", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_empresa", { pais: "PT", fuso: "Atlantic/Azores" });
    expect(empresa(c)).toMatchObject({ country: "PT", timezone: "Atlantic/Azores" });
  });

  it("o mesmo país de antes não mexe no fuso gravado (a empresa que já estava no país fica com o dela)", async () => {
    const c = await preparar();
    empresa(c).country = "BR";
    empresa(c).timezone = "America/Manaus";
    const r = await ok(c, "plataforma_configurar_empresa", { pais: "BR" });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(empresa(c).timezone).toBe("America/Manaus");
  });
});

// ---------------------------------------------------------------------------
// 1.84 · o que mudou de efeito em campos que já existiam
// ---------------------------------------------------------------------------

describe("as descrições ensinam o efeito novo de campos que já existiam (upstream 1.84)", () => {
  const descricao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.description ?? "";

  it("pausar um agente: outro agente no ar no mesmo número passa a responder (a ordem nova do upstream)", () => {
    expect(descricao("plataforma_pausar_agente")).toContain("OUTRO agente publicado e no ar no mesmo número");
  });

  it("a visibilidade do atendente também decide o que ele assume e transfere (0667)", () => {
    expect(descricao("plataforma_configurar_atendimento")).toContain("ASSUMIR e TRANSFERIR");
  });
});

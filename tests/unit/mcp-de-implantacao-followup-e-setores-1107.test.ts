/**
 * FORK MIA — DUAS FALTAS DO MCP DE PLATAFORMA NA FUSÃO 1.100 A 1.107 (MIA-21).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *   • `send_when_assigned` (#3974, "enviar mesmo com a conversa atribuída"):
 *     `plataforma_garantir_followup` liga e desliga a chave com
 *     `enviar_com_conversa_atribuida`; sem o campo, o fluxo nasce com o padrão
 *     do banco (desligado), como na tela; a leitura devolve o valor; a cópia
 *     leva a chave, como a importação da tela.
 *   • os SETORES (`attendant_sectors`, #3881): a seção `equipe` de
 *     `plataforma_ver_configuracao` devolve id e nome, só da organização
 *     pedida, para a ação `define_sector` das automações.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
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

async function preparar() {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

async function ok(c: Cenario, nome: string, args: Record<string, unknown>, org = ORG) {
  const r = await c.mcp.chamar(nome, { organization_id: org, ...args });
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

async function recusa(c: Cenario, nome: string, args: Record<string, unknown>, org = ORG) {
  const r = await c.mcp.chamar(nome, { organization_id: org, ...args });
  expect(r.erro, `${nome} deveria recusar: ${r.texto}`).toBe(true);
  return r.texto;
}

beforeEach(() => vi.clearAllMocks());

describe("plataforma_garantir_followup · CAMPO NOVO `enviar_com_conversa_atribuida` (upstream 1.107, #3974)", () => {
  const FLUXO = "Retomada · voltar a quem parou de responder";
  const fluxoNoBanco = (c: Cenario, org = ORG) =>
    c.tabela("followup_flow_pointers").find((f) => f.organization_id === org && f.name === FLUXO)!;
  const lerChave = async (c: Cenario) => (await ok(c, "plataforma_ver_followup", { fluxo: FLUXO })).dados.enviar_com_conversa_atribuida;

  it("⭐ sem o campo nasce com o padrão do banco (a coluna não é escrita); ligar grava; repetir é ja_estava sem escrever; false desliga", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    expect(fluxoNoBanco(c)).not.toHaveProperty("send_when_assigned");
    expect(await lerChave(c)).toBe(false);

    const ligou = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: true });
    expect(ligou.dados.fluxo).toMatchObject({ desfecho: "atualizou", mudancas: ["enviar com a conversa atribuída"] });
    expect(fluxoNoBanco(c).send_when_assigned).toBe(true);
    expect(await lerChave(c)).toBe(true);
    const config = await ok(c, "plataforma_ver_configuracao", { secoes: ["followups"] });
    expect((config.dados.followups as Linha[]).find((f) => f.nome === FLUXO)).toMatchObject({ enviar_com_conversa_atribuida: true });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: true });
    expect((de_novo.dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: false });
    expect(fluxoNoBanco(c).send_when_assigned).toBe(false);
    expect(await lerChave(c)).toBe(false);
  });

  it("instalar com o campo grava a chave já no fluxo novo", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada", enviar_com_conversa_atribuida: true });
    expect(fluxoNoBanco(c).send_when_assigned).toBe(true);
  });

  it("num fluxo PUBLICADO a chave vale na hora: mudar é recusado até desligar; pedir o valor que já está segue ja_estava", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    await ok(c, "plataforma_publicar_followup", { fluxo: FLUXO });

    const texto = await recusa(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: true });
    expect(texto).toContain("Desligue o fluxo");
    expect(fluxoNoBanco(c)).not.toHaveProperty("send_when_assigned");

    const igual = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: false });
    expect((igual.dados.fluxo as Linha).desfecho).toBe("ja_estava");

    await ok(c, "plataforma_publicar_followup", { fluxo: FLUXO, ativo: false });
    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, enviar_com_conversa_atribuida: true });
    expect(fluxoNoBanco(c).send_when_assigned).toBe(true);
  });

  it("plataforma_copiar_followup leva a chave da empresa de origem, como a importação da tela", async () => {
    const c = await preparar();
    const origem = { ...c.tabela("organizations").find((o) => o.id === ORG)!, id: OUTRA_ORG, display_name: "Academia Exemplo", slug: "academia-exemplo" };
    c.tabela("organizations").push(origem);
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada", enviar_com_conversa_atribuida: true }, OUTRA_ORG);

    await ok(c, "plataforma_copiar_followup", { de_outra_empresa: { organization_id: OUTRA_ORG, fluxo: FLUXO } });
    expect(fluxoNoBanco(c).send_when_assigned).toBe(true);
  });
});

describe("plataforma_ver_configuracao · seção `equipe` devolve os SETORES (upstream 1.103, #3881)", () => {
  const SUPORTE = "0f000000-0000-4000-8000-0000000000a1";
  const VENDAS = "0f000000-0000-4000-8000-0000000000b1";
  const ALHEIO = "0f000000-0000-4000-8000-0000000000c1";

  function comSetores(c: Cenario) {
    c.tabela("attendant_sectors").push(
      { id: VENDAS, organization_id: ORG, name: "Vendas", description: "Quem fecha negócio", color: "#336699", schedule: null },
      { id: SUPORTE, organization_id: ORG, name: "Suporte", description: null, color: null, schedule: null },
      { id: ALHEIO, organization_id: OUTRA_ORG, name: "Financeiro", description: null, color: null, schedule: null },
    );
  }

  it("⭐ só os setores da organização pedida, por nome, com id e nome e nada mais", async () => {
    const c = await preparar();
    comSetores(c);
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["equipe"] });
    const setores = (r.dados.equipe as Linha).setores as Linha[];
    expect(setores).toEqual([
      { id: SUPORTE, nome: "Suporte" },
      { id: VENDAS, nome: "Vendas" },
    ]);
    expect(JSON.stringify(setores)).not.toContain("@");
  });

  it("organização sem setor devolve a lista vazia", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["equipe"] });
    expect((r.dados.equipe as Linha).setores).toEqual([]);
  });

  it("o id lido serve na ação `define_sector`; o setor de outra organização é recusado e a recusa aponta a leitura", async () => {
    const c = await preparar();
    comSetores(c);
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["equipe"] });
    const vendas = ((r.dados.equipe as Linha).setores as Linha[]).find((s) => s.nome === "Vendas")!;
    const regra = { nome: "Lead de anúncio vai para Vendas", gatilho: "lead.created", condicoes: [] };

    await ok(c, "plataforma_garantir_automacao", { ...regra, acoes: [{ type: "define_sector", config: { sector_id: vendas.id } }] });
    const gravada = c.tabela("automation_rules").find((x) => x.name === regra.nome)!;
    expect(gravada.actions).toEqual([{ type: "define_sector", config: { sector_id: VENDAS } }]);

    const texto = await recusa(c, "plataforma_garantir_automacao", {
      ...regra,
      nome: "Outra regra",
      acoes: [{ type: "define_sector", config: { sector_id: ALHEIO } }],
    });
    expect(texto).toContain("plataforma_ver_configuracao (seção equipe, em setores)");
  });
});

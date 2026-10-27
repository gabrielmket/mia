/**
 * FORK MIA (.93) — o "Me mostra como" e onde os clientes travam no MCP de
 * plataforma: as quatro ferramentas novas e as três que crescem, pelo
 * protocolo, contra o banco em memória.
 *
 * A CONTAGEM total (98) mora no teste da cobrança
 * (`mcp-de-implantacao-cobranca.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const OPERACOES = [...TODAS_AS_OPERACOES];
const GESTORA = "0b000000-0000-4000-8000-0000000000b2";

function cenario(opcoes: { comNumero?: boolean; demonstracao?: boolean } = {}) {
  const c = cenarioDaImplantacao(opcoes);
  c.usuarios.set(GESTORA, { email: "gestora@exemplo.invalid", nome: "Gestora Exemplo" });
  c.banco.tabela("user_organizations").push({ organization_id: ORG, user_id: GESTORA, role: "manager", revoked_at: null, accepted_at: "2026-01-01T00:00:00Z" });
  estado.cliente = c.cliente;
  return c;
}

beforeEach(() => {
  estado.cliente = null;
});

describe("a lista", () => {
  it("as quatro novas: leitura livre, escrita nomeada pelo estrago", () => {
    const novas = Object.fromEntries(
      FERRAMENTAS.filter((f) => /trilhas|travam|melhoria_do_produto/.test(f.name)).map((f) => [f.name, f.operacao]),
    );
    expect(novas).toEqual({
      plataforma_ver_trilhas: null,
      plataforma_configurar_trilhas: "implantar_configuracao",
      plataforma_ver_onde_os_clientes_travam: null,
      plataforma_anotar_melhoria_do_produto: "responder_chamados",
    });
  });
});

describe("plataforma_ver_trilhas", () => {
  it("o catálogo, a configuração e o progresso por pessoa (nome, passo, desde), sem conversa", async () => {
    const c = cenario({ comNumero: true });
    c.banco.tabela("mia_assistente_trilhas").push({
      organization_id: ORG,
      user_id: GESTORA,
      trilha: "funil",
      situacao: "pausada",
      passo: 3,
      comecou_em: "2026-10-25T10:00:00Z",
      pausou_em: "2026-10-25T18:10:00Z",
      feita_em: null,
    });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_trilhas", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    const trilhas = r.dados.trilhas as Array<Record<string, unknown>>;
    const funil = trilhas.find((t) => t.id === "funil")!;
    expect(funil.pessoas).toEqual([{ nome: "Gestora Exemplo", situacao: "pausada", passo: 4, de: 6, desde: "2026-10-25T18:10:00Z" }]);
    // O número conectado do cenário não tem a trilha feita: falta o nome? Tem nome ("Recepção"): feita na empresa.
    expect(trilhas.find((t) => t.id === "numero")).toMatchObject({ da_empresa: true, feita_na_empresa: true });
    expect(r.dados.configuracao).toMatchObject({ me_mostra_como: true, desligadas: [], gravada: false });
    expect(typeof r.dados.recomendada_no_inicio).toBe("string");
    await mcp.fechar();
  });
});

describe("plataforma_configurar_trilhas", () => {
  it("desliga, escolhe a recomendada e recomeça o progresso de uma pessoa pelo e-mail", async () => {
    const c = cenario();
    c.banco.tabela("mia_assistente_trilhas").push(
      { organization_id: ORG, user_id: GESTORA, trilha: "funil", situacao: "pausada", passo: 3 },
      { organization_id: ORG, user_id: AUTOR, trilha: "numero", situacao: "pausada", passo: 1 },
    );
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_configurar_trilhas", {
      organization_id: ORG,
      desligar: ["email"],
      recomendada: "numero",
      recomecar_progresso: "gestora@exemplo.invalid",
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ configuracao: { desligadas: ["email"], recomendada: "numero" }, progresso_recomecado: 1 });
    expect(c.banco.tabela("mia_assistente_trilhas_config")[0]).toMatchObject({ organization_id: ORG, desligadas: ["email"], recomendada: "numero" });
    expect(c.banco.tabela("mia_assistente_trilhas").map((l) => l.user_id)).toEqual([AUTOR]);
    await mcp.fechar();
  });

  it("recusa recomendar a desligada e não marca trilha como feita (não há campo para isso)", async () => {
    cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_configurar_trilhas", { organization_id: ORG, desligar: ["numero"], recomendada: "numero" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("desligada");
    const feita = await mcp.chamar("plataforma_configurar_trilhas", { organization_id: ORG, marcar_feita: ["numero"] });
    expect(feita.erro).toBe(true);
    await mcp.fechar();
  });

  it("sem a operação no token, nada é gravado", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_configurar_trilhas", { organization_id: ORG, recomecar_progresso: "todas" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"implantar_configuracao"');
    expect(c.banco.escritas).toEqual([]);
    await mcp.fechar();
  });
});

describe("plataforma_ver_onde_os_clientes_travam e plataforma_anotar_melhoria_do_produto", () => {
  it("o painel de todas as empresas e a lista; anotar de novo pelo título atualiza, não duplica", async () => {
    const c = cenario();
    c.banco.tabela("mia_assistente_mensagens").push({
      organization_id: ORG,
      user_id: GESTORA,
      tipo: "pergunta",
      texto: "Dá para emitir nota fiscal pelo sistema?",
      tela: null,
      sem_resposta: true,
      created_at: new Date().toISOString(),
    });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const painel = await mcp.chamar("plataforma_ver_onde_os_clientes_travam", { periodo_dias: 30 });
    expect(painel.erro, painel.texto).toBe(false);
    expect(painel.dados.sem_resposta).toEqual([{ pergunta: "Dá para emitir nota fiscal pelo sistema?", vezes: 1, empresas: 1 }]);
    expect(painel.texto).not.toContain(GESTORA);

    const primeira = await mcp.chamar("plataforma_anotar_melhoria_do_produto", {
      titulo: "Manual: a nota fiscal sai pelo provedor de cobrança",
      evidencia: "1 pergunta sem resposta em 1 empresa, 30 dias",
    });
    expect(primeira.dados).toMatchObject({ ok: true, desfecho: "criada", situacao: "anotada" });
    const segunda = await mcp.chamar("plataforma_anotar_melhoria_do_produto", {
      titulo: "manual: a nota fiscal sai pelo provedor de cobrança",
      situacao: "em_desenvolvimento",
    });
    expect(segunda.dados).toMatchObject({ desfecho: "atualizada", situacao: "em_desenvolvimento" });
    expect(c.banco.tabela("mia_melhorias_do_produto")).toHaveLength(1);

    const depois = await mcp.chamar("plataforma_ver_onde_os_clientes_travam", {});
    expect((depois.dados.melhorias as unknown[]).length).toBe(1);
    await mcp.fechar();
  });

  it("anotar pede a caixinha responder_chamados", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_anotar_melhoria_do_produto", { titulo: "Uma melhoria qualquer" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"responder_chamados"');
    expect(c.banco.tabela("mia_melhorias_do_produto")).toHaveLength(0);
    await mcp.fechar();
  });
});

describe("as três que crescem", () => {
  it("plataforma_configurar_assistente liga e desliga o \"Me mostra como\" sem mexer nas trilhas desligadas", async () => {
    const c = cenario();
    c.banco.tabela("mia_assistente_trilhas_config").push({ organization_id: ORG, me_mostra_como: true, desligadas: ["email"], recomendada: null });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, me_mostra_como: false });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.me_mostra_como).toEqual({ antes: true, depois: false });
    expect(c.banco.tabela("mia_assistente_trilhas_config")[0]).toMatchObject({ me_mostra_como: false, desligadas: ["email"] });
    await mcp.fechar();
  });

  it("plataforma_ver_assistente traz as trilhas começadas, feitas e abandonadas", async () => {
    const c = cenario();
    c.banco.tabela("mia_assistente_trilhas").push(
      { organization_id: ORG, user_id: GESTORA, trilha: "funil", situacao: "feita", pausou_em: null },
      { organization_id: ORG, user_id: AUTOR, trilha: "numero", situacao: "pausada", pausou_em: "2026-01-01T00:00:00Z" },
    );
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_assistente", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.trilhas).toMatchObject({ comecadas: 2, feitas: 1, pausadas: 1, abandonadas: 1 });
    await mcp.fechar();
  });

  it("plataforma_ver_implantacao diz a trilha que ensina cada item \"preciso confirmar\"", async () => {
    cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    const ensinam = (r.dados.rotulo_do_cliente as { trilhas_que_ensinam: Array<{ item: string; trilha: string }> }).trilhas_que_ensinam;
    expect(ensinam).toContainEqual(expect.objectContaining({ item: "whatsapp", trilha: "numero" }));
    await mcp.fechar();
  });
});

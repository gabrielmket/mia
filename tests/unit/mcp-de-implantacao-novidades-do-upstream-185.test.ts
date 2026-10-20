/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.85 AO ALCANCE DO MCP DE PLATAFORMA (a
 * regra do dono do produto: toda peça nova ou alterada do sistema que seja
 * configuração de implantação ganha ferramenta ou campo no MCP na MESMA versão,
 * a .83).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-184.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Cada bloco
 * prova o que foi GRAVADO, que a REEXECUÇÃO não escreve, a recusa que ensina e
 * a leitura que devolve.
 *
 * A CONTAGEM da lista mudou para o teste da versão mais nova (186). A v1.85 não pediu
 * ferramenta nova; pediu um campo novo em `plataforma_configurar_canal` (a
 * distribuição do número, 0663), a mídia na ação de WhatsApp das automações e
 * no passo de texto fixo do follow-up (#2734), e o efeito novo do "contém".
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados,
 * e-mails `@exemplo.invalid`.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionSchema } from "@/lib/schemas/webhooks";
import {
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
  ORG,
  TODAS_AS_OPERACOES,
  TOKEN,
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

/** Pessoas fictícias da equipe: duas que atendem e uma que só lê. */
const ANA = { id: "0b000000-0000-4000-8000-0000000000a1", email: "ana@exemplo.invalid", papel: "agent" };
const BRUNO = { id: "0b000000-0000-4000-8000-0000000000b2", email: "bruno@exemplo.invalid", papel: "manager" };
const LEITORA = { id: "0b000000-0000-4000-8000-0000000000c3", email: "leitora@exemplo.invalid", papel: "viewer" };

async function preparar(opcoes: OpcoesDoCenario = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
  for (const p of [ANA, BRUNO, LEITORA]) {
    cenario.usuarios.set(p.id, { email: p.email, nome: p.email.split("@")[0]! });
    cenario.banco.tabela("user_organizations").push({
      id: randomUUID(),
      organization_id: ORG,
      user_id: p.id,
      role: p.papel,
      accepted_at: "2026-01-02T00:00:00Z",
      revoked_at: null,
      created_at: "2026-01-02T00:00:00Z",
    });
  }
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
const chamadasDaDistribuicao = (c: Cenario) =>
  c.banco.chamadasRpc.filter((x) => x.nome === "fn_mia_distribuicao_do_numero_pela_plataforma");

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("a lista: a distribuição do número monta, e os tipos de ação seguem os do upstream", () => {
  it("a v1.85 não acrescentou ferramenta; a distribuição do número entrou como campo de plataforma_configurar_canal", () => {
    // A contagem mora no teste da versão mais nova (186).
    const canal = FERRAMENTAS.find((f) => f.name === "plataforma_configurar_canal");
    expect(canal?.operacao).toBe("implantar_configuracao");
    expect(Object.keys(canal!.inputSchema)).toContain("distribuicao");
  });

  it("⭐ os tipos de ação que a ferramenta aceita são EXATAMENTE os do upstream (a v1.85 não trouxe ação nova)", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
  });
});

// ---------------------------------------------------------------------------
// 1.85 · regras de atendimento por número (0663, #2331)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_canal · CAMPO NOVO `distribuicao` (upstream 1.85, 0663)", () => {
  const politicas = (c: Cenario) => c.tabela("channel_routing_policies");
  const responsaveis = (c: Cenario) => c.tabela("channel_routing_responsibles");

  it("número SEM regra própria: criar só com `modo` é recusado (criar RESTRINGE quem recebe), e nada é gravado", async () => {
    const c = await preparar({ comNumero: true });
    const texto = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { modo: "round_robin" } });
    expect(texto).toContain("ainda não tem regra própria");
    expect(texto).toContain("`responsaveis`");
    expect(chamadasDaDistribuicao(c)).toEqual([]);
    expect(politicas(c)).toEqual([]);
  });

  it("⭐ cria a regra pela função do fork (9045) com o TOKEN como ator: modo, destino e responsáveis gravados, auditoria da rota", async () => {
    const c = await preparar({ comNumero: true });
    const r = await ok(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { responsaveis: [ANA.email, "Bruno@Exemplo.invalid"], modo: "round_robin", atendente_padrao: ANA.email },
    });

    // A função do fork recebeu o token (o ator) e os ids, nunca os e-mails.
    expect(chamadasDaDistribuicao(c)).toHaveLength(1);
    expect(chamadasDaDistribuicao(c)[0]!.args).toMatchObject({
      p_org: ORG,
      p_token: TOKEN,
      p_channel: NUMERO,
      p_reset: false,
      p_mode: "round_robin",
      p_default_assignee: ANA.id,
    });
    expect([...((chamadasDaDistribuicao(c)[0]!.args as { p_users: string[] }).p_users)].sort()).toEqual([ANA.id, BRUNO.id].sort());

    // O BANCO: a linha da 0663 e os responsáveis da 0228.
    expect(politicas(c)).toHaveLength(1);
    expect(politicas(c)[0]).toMatchObject({ organization_id: ORG, channel_session_id: NUMERO, distribution_mode: "round_robin", default_assignee_user_id: ANA.id });
    expect(responsaveis(c).map((x) => x.user_id).sort()).toEqual([ANA.id, BRUNO.id].sort());

    expect(r.dados).toMatchObject({ desfecho: "atualizou" });
    expect(r.dados.distribuicao).toMatchObject({
      regra_propria: true,
      modo: "round_robin",
      atendente_padrao: ANA.email,
      desfecho: "atualizou",
    });
    const avisos = (r.dados.avisos as string[]).join(" ");
    expect(avisos).toContain(`vai direto para ${ANA.email}`);
    expect(avisos).toContain("não cala a IA");
    expect(avisos).toContain("os outros números seguem o modo da organização");

    // A mesma linha da rota da tela, com o caminho.
    const linha = linhaAuditada("routing.config_changed")!;
    expect(linha).toMatchObject({ resourceType: "channel_session", resourceId: NUMERO, organizationId: ORG });
    expect(linha.metadata).toMatchObject({ reset: false, distribution_mode: "round_robin", default_assignee_user_id: ANA.id, via: "mcp_plataforma" });
  });

  it("reexecutar o mesmo pedido não chama a função de novo (`ja_estava`)", async () => {
    const c = await preparar({ comNumero: true });
    const pedido = { canal: "Recepção", distribuicao: { responsaveis: [ANA.email, BRUNO.email], modo: "load" } };
    await ok(c, "plataforma_configurar_canal", pedido);
    const r = await ok(c, "plataforma_configurar_canal", pedido);
    expect(r.dados.desfecho).toBe("ja_estava");
    expect((r.dados.distribuicao as Linha).desfecho).toBe("ja_estava");
    expect(chamadasDaDistribuicao(c)).toHaveLength(1);
  });

  it("só o que VEIO muda: trocar o modo mantém os responsáveis e o destino gravados", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { responsaveis: [ANA.email], modo: "round_robin", atendente_padrao: BRUNO.email },
    });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { modo: "load" } });
    expect(r.dados.mudancas).toEqual(["modo do número"]);
    expect(politicas(c)[0]).toMatchObject({ distribution_mode: "load", default_assignee_user_id: BRUNO.id });
    expect(responsaveis(c).map((x) => x.user_id)).toEqual([ANA.id]);
  });

  it("`modo: null` volta o número ao modo da organização e tira o destino junto (como a tela), com aviso", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { responsaveis: [ANA.email], modo: "manual", atendente_padrao: ANA.email },
    });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { modo: null } });
    expect(politicas(c)[0]).toMatchObject({ distribution_mode: null, default_assignee_user_id: null });
    expect((r.dados.avisos as string[]).join(" ")).toContain("o atendente de destino padrão também saiu");
  });

  it("o destino padrão sem modo próprio é recusado (a tela desliga o campo)", async () => {
    const c = await preparar({ comNumero: true });
    const texto = await recusa(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { responsaveis: [ANA.email], atendente_padrao: ANA.email },
    });
    expect(texto).toContain("só vale com um modo próprio");
    expect(chamadasDaDistribuicao(c)).toEqual([]);
  });

  it("quem só lê não recebe conversa, e quem não é da equipe é recusado dizendo quem é", async () => {
    const c = await preparar({ comNumero: true });
    const leitora = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: [LEITORA.email] } });
    expect(leitora).toContain("papel viewer");
    expect(leitora).toContain("agent, manager e admin");
    const estranho = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: ["quem@exemplo.invalid"] } });
    expect(estranho).toContain("não faz parte da equipe");
    expect(estranho).toContain(ANA.email);
    expect(chamadasDaDistribuicao(c)).toEqual([]);
  });

  it("`responsaveis: []` cria a regra \"ninguém\": a resposta avisa que as conversas ficam na fila", async () => {
    const c = await preparar({ comNumero: true });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: [] } });
    expect(politicas(c)).toHaveLength(1);
    expect(responsaveis(c)).toEqual([]);
    expect((r.dados.distribuicao as Linha).situacao).toContain("ficam na fila");
    expect((r.dados.avisos as string[]).join(" ")).toContain("ficam na fila");
  });

  it("`voltar_ao_padrao_da_organizacao` apaga a regra (reset da função); de novo é `ja_estava`; junto de outro campo é recusado", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: [ANA.email], modo: "load" } });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { voltar_ao_padrao_da_organizacao: true } });
    expect(chamadasDaDistribuicao(c).at(-1)!.args).toMatchObject({ p_reset: true, p_users: [] });
    expect(politicas(c)).toEqual([]);
    expect(responsaveis(c)).toEqual([]);
    expect(r.dados.distribuicao).toMatchObject({ regra_propria: false, desfecho: "atualizou" });

    const deNovo = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { voltar_ao_padrao_da_organizacao: true } });
    expect(deNovo.dados.desfecho).toBe("ja_estava");
    expect(chamadasDaDistribuicao(c)).toHaveLength(2);

    const misturado = await recusa(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { voltar_ao_padrao_da_organizacao: true, modo: "load" },
    });
    expect(misturado).toContain("mande só ele");
  });

  it("a leitura (plataforma_ver_configuracao, canais) devolve a distribuição de cada número, com e-mails", async () => {
    const c = await preparar({ comNumero: true });
    const antes = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect(((antes.dados.canais as Linha[])[0]!.distribuicao as Linha).regra_propria).toBe(false);

    await ok(c, "plataforma_configurar_canal", {
      canal: "Recepção",
      distribuicao: { responsaveis: [BRUNO.email], modo: "round_robin", atendente_padrao: BRUNO.email },
    });
    const depois = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect((depois.dados.canais as Linha[])[0]!.distribuicao).toMatchObject({
      regra_propria: true,
      modo: "round_robin",
      atendente_padrao: BRUNO.email,
      responsaveis: [BRUNO.email],
    });
  });

  it("o checklist (plataforma_ver_implantacao) conta o número com regra própria, e o item deixou de ser só pela tela", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: [ANA.email], modo: "load" } });
    const r = await ok(c, "plataforma_ver_implantacao", {});
    const texto = JSON.stringify(r.dados);
    expect(texto).toContain("1 número tem regra própria de distribuição");
    expect(texto).not.toContain("Definir quais atendentes recebem as conversas de cada número");
  });

  it("na empresa de demonstração a regra também grava: decidir de quem é a conversa não manda nada para fora", async () => {
    const c = await preparar({ comNumero: true, demonstracao: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: { responsaveis: [ANA.email], modo: "round_robin" } });
    expect(politicas(c)).toHaveLength(1);
  });

  it("CONTROLE: o pedido sem nada dentro de `distribuicao` é recusado com o exemplo", async () => {
    const c = await preparar({ comNumero: true });
    const texto = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", distribuicao: {} });
    expect(texto).toContain("Informe ao menos um ajuste em `distribuicao`");
  });
});

// ---------------------------------------------------------------------------
// 1.85 · imagem ou PDF com legenda nas automações e no follow-up (#2734)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao · `media_url` na mensagem de WhatsApp (upstream 1.85, #2734)", () => {
  const regra = (media_url: string) => ({
    nome: "Mandar a tabela",
    gatilho: "lead.created",
    acoes: [{ type: "send_whatsapp_message", config: { channel_session_id: NUMERO, template: "Oi, {{primeiro_nome}}! Segue a tabela.", media_url } }],
  });

  it("⭐ grava a mídia (o texto vira a legenda), e reexecutar não escreve", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_garantir_automacao", regra("https://exemplo.invalid/arquivos/tabela.pdf"));
    const acao = (c.tabela("automation_rules")[0]!.actions as Array<{ config: Linha }>)[0]!;
    expect(acao.config.media_url).toBe("https://exemplo.invalid/arquivos/tabela.pdf");
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_garantir_automacao", regra("https://exemplo.invalid/arquivos/tabela.pdf"));
    expect((r.dados.regra as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("o que não é imagem nem PDF, e o link sem extensão, são recusados ANTES de gravar (a tela só recusaria a cada envio)", async () => {
    const c = await preparar({ comNumero: true });
    const docx = await recusa(c, "plataforma_garantir_automacao", regra("https://exemplo.invalid/arquivos/proposta.docx"));
    expect(docx).toContain("acoes[0].config.media_url");
    expect(docx).toContain("imagem (jpg, png, webp, gif) ou um PDF");
    const drive = await recusa(c, "plataforma_garantir_automacao", regra("https://exemplo.invalid/file/d/abc123/view"));
    expect(drive).toContain("Google Drive");
    expect(c.tabela("automation_rules")).toEqual([]);
  });

  it("o catálogo (plataforma_listar_modelos) ensina o campo novo", async () => {
    const c = await preparar();
    // O catálogo não depende de cliente: a chamada vai sem `organization_id`.
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes"] });
    expect(r.erro, r.texto).toBe(false);
    expect(JSON.stringify(r.dados)).toContain("media_url");
  });
});

describe("plataforma_garantir_followup · `midia` no passo de TEXTO FIXO (upstream 1.85, #2734)", () => {
  const FLUXO = "Retomada · voltar a quem parou de responder";
  const noDoRascunho = (c: Cenario, id: string) =>
    (c.tabela("followup_flow_pointers")[0]!.draft_graph as { nodes: Array<{ id: string; config: Linha }> }).nodes.find((n) => n.id === id)!;

  it("⭐ põe a mídia no nó (sem mexer no texto), reexecutar não escreve, e `null` tira", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const textoAntes = noDoRascunho(c, "msg-1").config.body;

    const r = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1", midia: "https://exemplo.invalid/folder.png" }] });
    expect(r.dados.fluxo).toMatchObject({ desfecho: "atualizou", mudancas: ["mídia de msg-1"] });
    expect(noDoRascunho(c, "msg-1").config).toMatchObject({ mode: "text", body: textoAntes, media_url: "https://exemplo.invalid/folder.png" });

    const antes = c.banco.escritas.length;
    const deNovo = await ok(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1", midia: "https://exemplo.invalid/folder.png" }] });
    expect((deNovo.dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1", midia: null }] });
    expect(noDoRascunho(c, "msg-1").config.media_url).toBeUndefined();
  });

  it("a mídia que não é imagem nem PDF é recusada pela régua do envio, e o rascunho fica como estava", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const texto = await recusa(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1", midia: "https://exemplo.invalid/planilha.xlsx" }] });
    expect(texto).toContain("A mídia do nó «msg-1»");
    expect(noDoRascunho(c, "msg-1").config.media_url).toBeUndefined();
  });

  it("o item de `textos` sem texto e sem mídia é recusado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const texto = await recusa(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1" }] });
    expect(texto).toContain("sem `texto` e sem `midia`");
  });

  it("a leitura (plataforma_ver_followup) devolve a mídia do nó", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, textos: [{ no: "msg-1", midia: "https://exemplo.invalid/folder.png" }] });
    const r = await ok(c, "plataforma_ver_followup", { fluxo: FLUXO });
    expect(JSON.stringify(r.dados)).toContain('"midia":"https://exemplo.invalid/folder.png"');
  });
});

// ---------------------------------------------------------------------------
// 1.85 · o que mudou de efeito em campos que já existiam
// ---------------------------------------------------------------------------

describe("as descrições ensinam o efeito novo de campos que já existiam (upstream 1.85)", () => {
  const ferramenta = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)!;

  it("o \"contém\" das condições ignora acento e pontuação (o que o cliente MCP lê em tools/list)", async () => {
    const c = await preparar();
    const automacao = (await c.mcp.listar()).find((f) => f.name === "plataforma_garantir_automacao")!;
    expect(JSON.stringify(automacao.inputSchema)).toContain("ACENTO e pontuação");
  });

  it("o modo da organização vale para os números SEM regra própria", () => {
    expect(ferramenta("plataforma_configurar_atendimento").description).toContain("números SEM regra própria");
    expect(ferramenta("plataforma_configurar_atendimento").description).toContain("plataforma_configurar_canal, `distribuicao`");
    // CONTROLE: a frase antiga ("não define quais atendentes recebem cada NÚMERO") saiu.
    expect(ferramenta("plataforma_configurar_atendimento").description).not.toContain("não define quais atendentes recebem cada NÚMERO");
  });
});

/**
 * FORK MIA (.94) — O ASSISTENTE FAZ COM APROVAÇÃO no MCP de plataforma, pelo
 * protocolo, contra o banco em memória (Empresa Modelo fictícia):
 *
 *   - o caminho inteiro de uma peça do dia a dia: preparar (o que o assistente
 *     faz, sem gravar a peça), decidir pelo MCP e ver a peça nascer pela
 *     função da tela;
 *   - `plataforma_desfazer_proposta_do_assistente` segue o mesmo caminho do
 *     botão: a trava de uso devolve `travada` sem mexer em nada, o desfazer
 *     tira só o que a proposta fez, e repetir devolve `ja_estava`;
 *   - `plataforma_ver_propostas_do_assistente` diz quem aprova, se dá para
 *     desfazer e o que trava;
 *   - `plataforma_configurar_assistente` grava os tipos ligados e o "pode pedir".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const preparar = await import("@/lib/assistente/propostas/preparar-do-dia-a-dia");

type Linha = Record<string, unknown>;
const CARLA = "0b000000-0000-4000-8000-0000000000c3";

function cenario() {
  const c = cenarioDaImplantacao();
  estado.cliente = c.cliente;
  return c;
}

function contexto(c: ReturnType<typeof cenario>) {
  return {
    db: c.cliente as never,
    organizationId: ORG,
    userId: CARLA,
    papel: "manager" as const,
    equipe: [{ user_id: CARLA, nome: "Carla Mendes", papel: "manager" as const }],
    fuso: "America/Sao_Paulo",
    agora: new Date(),
    idioma: "pt-BR",
  };
}

/** Grava a proposta pendente como a rota do chat grava. */
function gravarPendente(c: ReturnType<typeof cenario>, proposta: { tipo: string; titulo: string; mudancas: unknown; pedido: unknown; chave?: string }): string {
  const id = crypto.randomUUID();
  (c.banco.tabela("mia_assistente_propostas") as Linha[]).push({
    id,
    organization_id: ORG,
    conversa_id: null,
    criada_por: CARLA,
    tipo: proposta.tipo,
    risco: "seguro",
    chave: proposta.chave ?? "",
    titulo: proposta.titulo,
    mudancas: proposta.mudancas,
    pedido: proposta.pedido,
    situacao: "pendente",
    aprovada_por: null,
    aprovada_em: null,
    aplicada_por: null,
    aplicada_em: null,
    rejeitada_por: null,
    rejeitada_em: null,
    pedida_a: null,
    pedida_em: null,
    ajustada_em: null,
    desfeita_por: null,
    desfeita_em: null,
    resultado: null,
    erro: null,
    saiu_com_o_agente_em: null,
    expira_em: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("etapa nova: preparar, aplicar pelo MCP e desfazer com a trava de uso", () => {
  it("a etapa nasce antes da escolhida; com negócio, o desfazer trava; vazia, sai; de novo, já estava", async () => {
    const c = cenario();
    const etapas = (c.banco.tabela("crm_stages") as Linha[]).filter((e) => !e.is_archived).sort((a, b) => Number(a.position) - Number(b.position));
    const alvo = etapas[1]!;
    const preparo = await preparar.prepararEtapaNova(contexto(c), { nome: "Pediu orçamento", antes_de: String(alvo.name) });
    expect(preparo.ok).toBe(true);
    if (!preparo.ok) return;
    expect(c.banco.escritas).toEqual([]);
    const id = gravarPendente(c, preparo.proposta);

    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.desfecho).toBe("aplicada");
    const nova = (c.banco.tabela("crm_stages") as Linha[]).find((e) => e.name === "Pediu orçamento")!;
    expect(nova).toBeTruthy();
    const anterior = etapas[0]!;
    expect(Number(nova.position)).toBeGreaterThan(Number(anterior.position));
    expect(Number(nova.position)).toBeLessThan(Number(alvo.position));

    // um negócio entra na etapa: o desfazer trava e diz por quê, sem mexer em nada
    (c.banco.tabela("crm_leads") as Linha[]).push({ id: "lead-1", organization_id: ORG, stage_id: nova.id, pipeline_id: nova.pipeline_id });
    const ver = await mcp.chamar("plataforma_ver_propostas_do_assistente", { organization_id: ORG });
    const lida = (ver.dados.propostas as Linha[]).find((p) => p.id === id)!;
    expect(lida).toMatchObject({ situacao: "aplicada", quem_aprova: "gestor ou administrador", da_para_desfazer: false });
    expect(String(lida.trava_do_desfazer)).toMatch(/negócio já está nesta etapa/);

    const travada = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(travada.erro, travada.texto).toBe(false);
    expect(travada.dados).toMatchObject({ ok: false, desfecho: "travada" });
    expect(nova.is_archived).toBeFalsy();

    // o negócio sai: o desfazer arquiva a etapa (como a tela) e marca a proposta
    c.banco.db.crm_leads = [];
    const desfeita = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(desfeita.erro, desfeita.texto).toBe(false);
    expect(desfeita.dados).toMatchObject({ ok: true, desfecho: "desfeita" });
    expect((c.banco.tabela("crm_stages") as Linha[]).find((e) => e.id === nova.id)?.is_archived).toBe(true);
    const proposta = (c.banco.tabela("mia_assistente_propostas") as Linha[]).find((p) => p.id === id)!;
    expect(proposta).toMatchObject({ situacao: "desfeita" });
    expect(proposta.desfeita_em).toBeTruthy();

    const de_novo = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(de_novo.dados).toMatchObject({ ok: true, desfecho: "ja_estava" });
    await mcp.fechar();
  });

  it("desfazer uma proposta que não foi aplicada não mexe em nada", async () => {
    const c = cenario();
    const preparo = await preparar.prepararEtapaNova(contexto(c), { nome: "Visita marcada" });
    if (!preparo.ok) throw new Error(preparo.mensagem);
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(r.dados).toMatchObject({ ok: false, desfecho: "nao_aplicada" });
    expect((c.banco.tabela("crm_stages") as Linha[]).some((e) => e.name === "Visita marcada")).toBe(false);
    await mcp.fechar();
  });

  it("sem a operação no token, nem decide nem desfaz", async () => {
    cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: crypto.randomUUID() });
    expect(r.erro).toBe(true);
    await mcp.fechar();
  });
});

describe("resposta rápida, tarefa e meta pelo MCP", () => {
  it("a resposta da equipe nasce compartilhada e o desfazer a tira", async () => {
    const c = cenario();
    const preparo = await preparar.prepararResposta(contexto(c), { atalho: "/endereco", texto: "Estamos na Rua das Acácias, 120.", para: "equipe" });
    if (!preparo.ok) throw new Error(preparo.mensagem);
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    expect((await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" })).dados.desfecho).toBe(
      "aplicada",
    );
    const resposta = (c.banco.tabela("message_templates") as Linha[]).find((t) => t.shortcut === "endereco")!;
    expect(resposta).toMatchObject({ owner_user_id: null, body: "Estamos na Rua das Acácias, 120." });
    const desfeita = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(desfeita.dados).toMatchObject({ ok: true, desfecho: "desfeita" });
    expect((c.banco.tabela("message_templates") as Linha[]).some((t) => t.shortcut === "endereco")).toBe(false);
    await mcp.fechar();
  });

  it("a tarefa concluída trava o desfazer", async () => {
    const c = cenario();
    const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const preparo = await preparar.prepararTarefa(contexto(c), { titulo: "Ligar para o Rogério sobre a limpeza", quando: `${amanha}T10:00` });
    if (!preparo.ok) throw new Error(preparo.mensagem);
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    const tarefa = (c.banco.tabela("crm_tasks") as Linha[])[0]!;
    expect(tarefa).toMatchObject({ title: "Ligar para o Rogério sobre a limpeza", assigned_to: CARLA, status: "pending" });
    tarefa.status = "done";
    const r = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(r.dados).toMatchObject({ ok: false, desfecho: "travada" });
    expect(String(r.dados.mensagem)).toMatch(/concluída/);
    expect(c.banco.tabela("crm_tasks")).toHaveLength(1);
    await mcp.fechar();
  });

  it("a meta nasce para o mês e o desfazer volta a como era (sem meta)", async () => {
    const c = cenario();
    const preparo = await preparar.prepararMeta(contexto(c), { valor_cents: 18_000_000 });
    if (!preparo.ok) throw new Error(preparo.mensagem);
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    expect((c.banco.tabela("sales_targets") as Linha[])[0]).toMatchObject({ metrica: "receita_total", alvo_cents: 18_000_000 });
    const r = await mcp.chamar("plataforma_desfazer_proposta_do_assistente", { organization_id: ORG, proposta_id: id });
    expect(r.dados).toMatchObject({ ok: true, desfecho: "desfeita" });
    expect(c.banco.tabela("sales_targets")).toHaveLength(0);
    await mcp.fechar();
  });
});

describe("plataforma_configurar_assistente: os tipos ligados e o pode pedir", () => {
  it("grava a lista e o interruptor; null volta a todos", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, tipos_de_proposta: ["etapa_criar", "resposta"], pode_pedir: false });
    expect(r.erro, r.texto).toBe(false);
    expect(c.banco.tabela("mia_assistente_config")[0]).toMatchObject({ tipos_de_proposta: ["etapa_criar", "resposta"], pode_pedir: false });
    await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, tipos_de_proposta: null });
    expect(c.banco.tabela("mia_assistente_config")[0]).toMatchObject({ tipos_de_proposta: null, pode_pedir: false });
    const errado = await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, tipos_de_proposta: ["conectar_numero"] });
    expect(errado.erro).toBe(true);
    await mcp.fechar();
  });

  it("plataforma_ver_assistente conta as propostas por tipo, aplicadas e desfeitas", async () => {
    const c = cenario();
    const agora = new Date().toISOString();
    (c.banco.tabela("mia_assistente_propostas") as Linha[]).push(
      { id: "p1", organization_id: ORG, tipo: "etiqueta", situacao: "desfeita", pedida_em: null, created_at: agora },
      { id: "p2", organization_id: ORG, tipo: "etiqueta", situacao: "aplicada", pedida_em: agora, created_at: agora },
    );
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_ver_assistente", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.propostas_30_dias as Record<string, unknown>).etiqueta).toMatchObject({ preparadas: 2, aplicadas: 2, desfeitas: 1, pedidas: 1 });
    await mcp.fechar();
  });
});

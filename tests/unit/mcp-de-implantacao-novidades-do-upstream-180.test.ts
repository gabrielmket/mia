/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.74 A 1.80 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: toda peça nova ou alterada do sistema
 * ganha ferramenta ou campo no MCP na MESMA versão, a .76).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream.test.ts` (1.70 a
 * 1.73): um bloco por novidade, e o que se mede é o BANCO, não a resposta. Cada
 * bloco prova o que foi GRAVADO e em qual linha, que a REEXECUÇÃO não escreve,
 * a recusa que ensina e a leitura que devolve o que foi gravado. A empresa de
 * demonstração aparece onde há envio para fora.
 *
 * As exigências comuns a toda ferramenta (descrição, exemplo válido, operação
 * no token, organização inexistente) são medidas em
 * `mcp-de-implantacao-ferramentas.test.ts`, que percorre a lista inteira, as
 * quatro ferramentas novas incluídas.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados,
 * e-mails `@exemplo.invalid`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionSchema } from "@/lib/schemas/webhooks";
import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
  ORG,
  OUTRA_ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, convergiu: [] as Array<{ sessao: string; guardar: boolean }> }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
// O transporte do QR: nenhuma conexão de verdade. Registra o que a função da tela pediu.
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({
    convergirConfigDaSessao: async (sessao: string, opcoes: { guardarHistorico: boolean }) => {
      estado.convergiu.push({ sessao, guardar: opcoes.guardarHistorico });
      return true;
    },
  }),
}));
// A saúde lê o crédito de IA da plataforma; aqui só interessa a chave do CPF.
vi.mock("@/lib/ai/custo/saldo-da-plataforma", () => ({
  saldoDaPlataforma: async () => ({ saldoUsd: 10, diasRestantes: 30, consumoParcial: false, ritmoParcial: false }),
}));

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

const acoesAuditadas = () => vi.mocked(audit).mock.calls.map(([e]) => e.action as string);
const linhaAuditada = (acao: string) => vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === acao);

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Entendendo o caso", passo: "qualifying" },
  { nome: "Quer agendar", passo: "qualified" },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];
const PROMPT = "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.";
const BIA = { nome: "Bia", prompt: PROMPT, pacotes: ["vender"], funis: ["Agendamentos"] };

async function comFunil(opcoes: OpcoesDoCenario = {}, operacoes?: string[]) {
  const c = await preparar(opcoes, operacoes);
  await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
  return c;
}

const idDaEtapa = (c: Cenario, nome: string) => c.tabela("crm_stages").find((e) => e.name === nome)!.id as string;
const idDoFunil = (c: Cenario) => c.tabela("crm_pipelines").find((f) => f.name === "Agendamentos")!.id as string;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
  estado.convergiu = [];
});

// ---------------------------------------------------------------------------

describe("a lista: 60 ferramentas, as quatro novas montam (implantar_configuracao)", () => {
  it("as quatro da .76 entraram com a operação de montagem", () => {
    expect(FERRAMENTAS).toHaveLength(60);
    const operacao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.operacao;
    for (const nome of [
      "plataforma_garantir_planos_de_tarefa",
      "plataforma_configurar_canal",
      "plataforma_garantir_fonte_de_formulario",
      "plataforma_configurar_banco_externo",
    ]) {
      expect(operacao(nome), nome).toBe("implantar_configuracao");
    }
  });

  it("⭐ os tipos de ação que a ferramenta aceita são EXATAMENTE os do upstream: ação nova do upstream reprova aqui", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
    expect(doUpstream).toEqual(expect.arrayContaining(["ai_decide", "apply_task_plan"]));
  });
});

// ---------------------------------------------------------------------------
// 1.74 · limpeza automática de mídia antiga (0557, #1534)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_empresa · PASSOU A ALCANÇAR a limpeza automática de mídia (upstream 1.74)", () => {
  it("desligar grava a coluna `media_retention_enforced`, sem tocar em `settings`; repetir não escreve; religar avisa que apaga", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_empresa", { limpeza_automatica_de_midia: false });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["limpeza automática de mídia"] });
    const escrita = c.banco.escritas.find((e) => e.tabela === "organizations")!;
    expect(escrita.payload).toEqual({ media_retention_enforced: false });
    expect(c.tabela("organizations")[0]!.media_retention_enforced).toBe(false);
    expect(acoesAuditadas()).toContain("org.updated");

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_empresa", { limpeza_automatica_de_midia: false })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const religa = await ok(c, "plataforma_configurar_empresa", { limpeza_automatica_de_midia: true, dias_de_retencao_de_midia: 90 });
    expect((religa.dados.avisos as string[]).join(" ")).toContain("com mais de 90 dias são apagados, sem volta");
    expect(c.tabela("organizations")[0]).toMatchObject({ media_retention_enforced: true, media_retention_days: 90 });
  });

  it("empresa que nunca mexeu (o padrão do banco é ligada) não ganha escrita por um pedido que repete o padrão", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_empresa", { limpeza_automatica_de_midia: true });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
  });

  it("a leitura do cliente devolve o interruptor e os dias", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_empresa", { limpeza_automatica_de_midia: false, dias_de_retencao_de_midia: 120 });
    const lido = await c.mcp.chamar("plataforma_ver_cliente", { organization_id: ORG });
    expect(lido.erro, lido.texto).toBe(false);
    expect((lido.dados.configuracao as Linha).limpeza_automatica_de_midia).toEqual({ ligada: false, dias: 120 });
  });

  it("CNPJ que já é de outra organização: a frase da tela, e não o erro do banco", async () => {
    const c = await preparar();
    const deVerdade = c.cliente.from.bind(c.cliente);
    c.cliente.from = ((nome: string) => {
      const consulta = deVerdade(nome) as Record<string, unknown>;
      if (nome !== "organizations") return consulta;
      const atualizar = consulta.update as (p: Linha) => unknown;
      consulta.update = (p: Linha) =>
        "cnpj" in p
          ? { eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: "23505", message: "duplicate key value" } }) }) }) }
          : atualizar(p);
      return consulta;
    }) as typeof c.cliente.from;
    const texto = await recusa(c, "plataforma_configurar_empresa", { cnpj: "00.000.000/0001-00" });
    expect(texto).toBe("Este CNPJ já pertence a outra organização. Confira o número e chame de novo.");
  });
});

// ---------------------------------------------------------------------------
// 1.76 · o freio da empresa para o passo "a IA decide" (#2367)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_atendimento · PASSOU A ALCANÇAR o freio do passo \"a IA decide\" (upstream 1.76)", () => {
  it("desligar grava `settings.automacoes.ai_decide` mesclando nos dois níveis, com a auditoria da tela; repetir não escreve", async () => {
    const c = await preparar();
    c.tabela("organizations")[0]!.settings = { automacoes: { outra_chave: 1 }, tags: ["vip"] };
    const r = await ok(c, "plataforma_configurar_atendimento", { ia_decide_nas_automacoes: false });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["a IA decide nas automações"] });
    expect((r.dados.atendimento as Linha).ia_decide_nas_automacoes).toBe(false);
    const settings = c.tabela("organizations")[0]!.settings as Linha;
    expect(settings.automacoes).toEqual({ outra_chave: 1, ai_decide: false });
    expect(settings.tags).toEqual(["vip"]);
    expect(linhaAuditada("settings.automation_ai_decide_updated")?.metadata).toMatchObject({ ligado: false });
    // A distribuição não mudou: a linha dela não sai.
    expect(acoesAuditadas()).not.toContain("routing.config_changed");

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_atendimento", { ia_decide_nas_automacoes: false })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect((lido.dados.atendimento as Linha).ia_decide_nas_automacoes).toBe(false);
    const cliente = await c.mcp.chamar("plataforma_ver_cliente", { organization_id: ORG });
    expect((cliente.dados.configuracao as Linha).ia_decide_nas_automacoes).toBe(false);
  });

  it("empresa que nunca mexeu: ligado é o padrão, e pedir ligado não escreve", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { ia_decide_nas_automacoes: true });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.74 a 1.80 · ações e gatilhos novos de automação
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao · PASSOU A ALCANÇAR as ações e os gatilhos novos (upstream 1.74 a 1.80)", () => {
  const AI_DECIDE = (opcoes: unknown[]) => ({
    type: "ai_decide",
    config: { custo_de_token: true, instrucao: "Se a pessoa pediu orçamento, etiquete; se reclamou, crie tarefa.", opcoes },
  });
  const ETIQUETAR = { id: "orcamento", rotulo: "Pediu orçamento", acao: { type: "add_tag", config: { tags: ["Orçamento"] } } };
  const TAREFA = {
    id: "reclamacao",
    rotulo: "Reclamou",
    acao: { type: "create_task", config: { titulo: "Ligar para {{contact.name}}", vence_em_dias: 0, atribuir_a: "dono_do_lead", prioridade: "urgent" } },
  };

  it("ai_decide: grava as opções como vieram, avisa do custo de IA, e repetir não escreve", async () => {
    const c = await preparar();
    const pedido = { nome: "Triagem da mensagem", gatilho: "message.received", acoes: [AI_DECIDE([ETIQUETAR, TAREFA])] };
    const r = await ok(c, "plataforma_garantir_automacao", pedido);
    expect((r.dados.regra as Linha).desfecho).toBe("criou");
    expect((r.dados.avisos as string[]).join(" ")).toContain("cada execução chama a IA");
    const regra = c.tabela("automation_rules")[0]!;
    expect(regra.actions).toEqual([AI_DECIDE([ETIQUETAR, TAREFA])]);
    expect(regra, "a regra nasceu ligada").not.toHaveProperty("is_active");

    const antes = c.banco.escritas.length;
    expect(((await ok(c, "plataforma_garantir_automacao", pedido)).dados.regra as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("ai_decide sem `custo_de_token: true` é recusado pela régua do upstream", async () => {
    const c = await preparar();
    const semCusto = { type: "ai_decide", config: { instrucao: "Escolha.", opcoes: [ETIQUETAR, TAREFA] } };
    const texto = await recusa(c, "plataforma_garantir_automacao", { nome: "Sem custo", gatilho: "message.received", acoes: [semCusto] });
    expect(texto).toContain("A regra não passou na conferência");
    expect(c.tabela("automation_rules")).toHaveLength(0);
  });

  it("⭐ a ação DENTRO de uma opção passa pela mesma régua: funil de outra empresa e pessoa de fora são recusados, com o caminho da opção", async () => {
    const c = await comFunil();
    const alheio = "0f000000-0000-4000-8000-0000000000a1";
    c.tabela("crm_pipelines").push({ id: alheio, organization_id: OUTRA_ORG, name: "Alheio", slug: "alheio", is_archived: false, position: 9 });
    const mover = { id: "mover", rotulo: "Mover", acao: { type: "create_or_move_lead", config: { pipeline_id: alheio, stage_id: idDaEtapa(c, "Quer agendar") } } };
    const funil = await recusa(c, "plataforma_garantir_automacao", { nome: "Laço alheio", gatilho: "message.received", acoes: [AI_DECIDE([ETIQUETAR, mover])] });
    expect(funil).toContain("acoes[0].config.opcoes[1].acao.config.pipeline_id: não existe funil");

    const deFora = { id: "dono", rotulo: "Dono", acao: { type: "assign_owner", config: { user_id: "0b000000-0000-4000-8000-0000000000ff" } } };
    const pessoa = await recusa(c, "plataforma_garantir_automacao", { nome: "Pessoa alheia", gatilho: "message.received", acoes: [AI_DECIDE([ETIQUETAR, deFora])] });
    expect(pessoa).toContain("acoes[0].config.opcoes[1].acao: a pessoa");
    expect(pessoa).toContain("não faz parte da equipe");
    expect(c.tabela("automation_rules")).toHaveLength(0);
  });

  it("o veto do laço de lead alcança a opção do ai_decide (a frase do upstream)", async () => {
    const c = await preparar();
    const atribuir = { id: "dono", rotulo: "Dono", acao: { type: "assign_owner", config: { user_id: AUTOR } } };
    const texto = await recusa(c, "plataforma_garantir_automacao", { nome: "Laço", gatilho: "lead.assigned", acoes: [AI_DECIDE([ETIQUETAR, atribuir])] });
    expect(texto).toContain("a própria mudança dispararia a automação de novo");
  });

  it("apply_task_plan: plano que não existe é recusado com o caminho; depois de garantir o plano, a regra nasce", async () => {
    const c = await preparar();
    const pedido = { nome: "Proposta: sequência", gatilho: "lead.stage_changed", acoes: [{ type: "apply_task_plan", config: { plano_id: "plano-proposta-enviada" } }] };
    const texto = await recusa(c, "plataforma_garantir_automacao", pedido);
    expect(texto).toContain("acoes[0].config.plano_id: não existe plano de tarefas com o id «plano-proposta-enviada»");
    expect(texto).toContain("plataforma_garantir_planos_de_tarefa");

    await ok(c, "plataforma_garantir_planos_de_tarefa", {
      planos: [{ nome: "Proposta enviada", passos: [{ titulo: "Ligar", vence_em_dias: 2 }] }],
    });
    const r = await ok(c, "plataforma_garantir_automacao", pedido);
    expect((r.dados.regra as Linha).desfecho).toBe("criou");
  });

  it("add_tag com destino no contato, e o gatilho de criação recortado por uma fonte de formulário DESTA empresa", async () => {
    const c = await comFunil();
    const fonte = await ok(c, "plataforma_garantir_fonte_de_formulario", {
      nome: "Formulário do site",
      destino: { funil: "Agendamentos", etapa: "Novo contato" },
    });
    const fonteId = (fonte.dados.fonte as Linha).id as string;
    const r = await ok(c, "plataforma_garantir_automacao", {
      nome: "Etiquetar quem veio do site",
      gatilho: "lead.created",
      acoes: [{ type: "add_tag", config: { tags: ["Site"], destino: "contato" } }],
      configuracao_do_gatilho: { webhook_source_id: fonteId },
    });
    expect((r.dados.regra as Linha).desfecho).toBe("criou");
    expect(c.tabela("automation_rules")[0]).toMatchObject({
      actions: [{ type: "add_tag", config: { tags: ["Site"], destino: "contato" } }],
      trigger_config: { webhook_source_id: fonteId },
    });

    const alheia = "0f000000-0000-4000-8000-0000000000b1";
    c.tabela("webhook_sources").push({ id: alheia, organization_id: OUTRA_ORG, name: "Alheia" });
    const texto = await recusa(c, "plataforma_garantir_automacao", {
      nome: "Fonte alheia",
      gatilho: "lead.created",
      acoes: [{ type: "add_tag", config: { tags: ["x"] } }],
      configuracao_do_gatilho: { webhook_source_id: alheia },
    });
    expect(texto).toContain("A fonte escolhida não pertence a esta empresa.");
  });

  it("o funil e a etapa dos gatilhos de tempo são conferidos contra a empresa", async () => {
    const c = await comFunil();
    const ok1 = await ok(c, "plataforma_garantir_automacao", {
      nome: "Parado em Quer agendar",
      gatilho: "lead.stage_stale",
      acoes: [{ type: "add_tag", config: { tags: ["Parado"] } }],
      configuracao_do_gatilho: { dias: 7, pipeline_id: idDoFunil(c), stage_id: idDaEtapa(c, "Quer agendar"), proteger_pela_agenda: true },
    });
    expect((ok1.dados.regra as Linha).desfecho).toBe("criou");

    const texto = await recusa(c, "plataforma_garantir_automacao", {
      nome: "Etapa alheia",
      gatilho: "lead.stage_stale",
      acoes: [{ type: "add_tag", config: { tags: ["Parado"] } }],
      configuracao_do_gatilho: { dias: 7, stage_id: "0f000000-0000-4000-8000-0000000000c1" },
    });
    expect(texto).toContain("configuracao_do_gatilho.stage_id: não existe etapa");
  });

  it("⭐ DEMONSTRAÇÃO: regra com webhook ENTRE AS OPÇÕES do ai_decide não liga, e a recusa vem antes do banco; CONTROLE: na empresa de verdade, liga", async () => {
    const webhook = { id: "avisar", rotulo: "Avisar o ERP", acao: { type: "call_webhook", config: { url: "https://exemplo.invalid/gancho" } } };
    const pedido = { nome: "Decidir e avisar", gatilho: "message.received", acoes: [AI_DECIDE([ETIQUETAR, webhook])] };

    const demo = await preparar({ demonstracao: true });
    await ok(demo, "plataforma_garantir_automacao", pedido);
    const antes = demo.banco.escritas.length;
    const texto = await recusa(demo, "plataforma_ligar_automacao", { regra: "Decidir e avisar", ligada: true });
    expect(texto).toContain("Esta é a empresa de demonstração");
    expect(texto).toContain('entre as opções do passo "a IA decide"');
    expect(demo.banco.escritas.length, "a recusa chegou ao banco").toBe(antes);
    expect(demo.tabela("automation_rules")[0]!.is_active).toBeUndefined();

    const deVerdade = await preparar();
    await ok(deVerdade, "plataforma_garantir_automacao", pedido);
    const ligou = await ok(deVerdade, "plataforma_ligar_automacao", { regra: "Decidir e avisar", ligada: true });
    expect(ligou.dados.desfecho).toBe("atualizou");
    expect(deVerdade.tabela("automation_rules")[0]!.is_active).toBe(true);
  });

  it("DEMONSTRAÇÃO: ai_decide só com ações internas liga normalmente", async () => {
    const demo = await preparar({ demonstracao: true });
    await ok(demo, "plataforma_garantir_automacao", { nome: "Só por dentro", gatilho: "message.received", acoes: [AI_DECIDE([ETIQUETAR, TAREFA])] });
    expect((await ok(demo, "plataforma_ligar_automacao", { regra: "Só por dentro", ligada: true })).dados.desfecho).toBe("atualizou");
  });

  it("o catálogo de modelos ensina as ações novas e o recorte por fonte", async () => {
    const c = await preparar();
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes"] });
    const automacoes = r.dados.automacoes as { acoes: Array<{ type: string; config: string }>; gatilhos_que_pedem_configuracao: Linha };
    expect(automacoes.acoes.map((a) => a.type)).toEqual(expect.arrayContaining(["ai_decide", "apply_task_plan", "add_tag"]));
    expect(automacoes.acoes.find((a) => a.type === "add_tag")!.config).toContain('"destino"');
    expect(automacoes.acoes.find((a) => a.type === "ai_decide")!.config).toContain('"custo_de_token": true');
    expect(automacoes.gatilhos_que_pedem_configuracao["lead.created"]).toContain("webhook_source_id");
  });
});

// ---------------------------------------------------------------------------
// 1.77 · planos de tarefa (#1752)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_planos_de_tarefa · FERRAMENTA NOVA (upstream 1.77)", () => {
  const PLANO = {
    nome: "Proposta enviada",
    descricao: "O acompanhamento de quem recebeu proposta.",
    passos: [
      { titulo: "Ligar para {{contact.name}}", vence_em_dias: 2, prioridade: "high", responsavel: "implantador@exemplo.invalid" },
      { titulo: "Cobrar a resposta", vence_em_dias: 10 },
    ],
  };

  it("grava em `settings.task_plans` na forma que o motor lê, preservando as outras chaves; repetir não escreve", async () => {
    const c = await preparar();
    c.tabela("organizations")[0]!.settings = { tags: ["vip"] };
    const r = await ok(c, "plataforma_garantir_planos_de_tarefa", { planos: [PLANO] });
    expect(r.dados.planos).toEqual([{ id: "plano-proposta-enviada", nome: "Proposta enviada", passos: 2, desfecho: "criou" }]);
    expect((r.dados.avisos as string[]).join(" ")).toContain("apply_task_plan");
    const settings = c.tabela("organizations")[0]!.settings as Linha;
    expect(settings.tags).toEqual(["vip"]);
    expect(settings.task_plans).toEqual([
      {
        id: "plano-proposta-enviada",
        nome: "Proposta enviada",
        descricao: "O acompanhamento de quem recebeu proposta.",
        passos: [
          { ordem: 1, titulo: "Ligar para {{contact.name}}", descricao: null, vence_em_dias: 2, prioridade: "high", atribuir_a: { usuario_id: AUTOR } },
          { ordem: 2, titulo: "Cobrar a resposta", descricao: null, vence_em_dias: 10, prioridade: "medium", atribuir_a: "dono_do_lead" },
        ],
      },
    ]);
    expect(linhaAuditada("task_plans.settings_updated")?.metadata).toMatchObject({ planos: 1 });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_planos_de_tarefa", { planos: [PLANO] });
    expect((de_novo.dados.planos as Linha[])[0]!.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("ajustar os passos de um plano não mexe no outro; o id não muda; a leitura devolve o responsável pelo e-mail", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_planos_de_tarefa", { planos: [PLANO, { nome: "Pós-venda", passos: [{ titulo: "Pedir avaliação", vence_em_dias: 7 }] }] });
    const r = await ok(c, "plataforma_garantir_planos_de_tarefa", {
      planos: [{ nome: "proposta enviada", passos: [{ titulo: "Ligar", vence_em_dias: 1 }] }],
    });
    expect(r.dados.planos).toEqual([{ id: "plano-proposta-enviada", nome: "proposta enviada", passos: 1, desfecho: "atualizou" }]);
    const planos = (c.tabela("organizations")[0]!.settings as { task_plans: Linha[] }).task_plans;
    expect(planos.map((p) => p.id)).toEqual(["plano-proposta-enviada", "plano-pos-venda"]);
    // A descrição que não veio fica.
    expect(planos[0]!.descricao).toBe("O acompanhamento de quem recebeu proposta.");

    await ok(c, "plataforma_garantir_planos_de_tarefa", { planos: [PLANO] });
    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["planos_de_tarefa"] });
    const lidos = lido.dados.planos_de_tarefa as Array<{ id: string; passos: Linha[] }>;
    expect(lidos[0]!.passos[0]).toMatchObject({ responsavel: "implantador@exemplo.invalid", prioridade: "high" });
    expect(lidos[0]!.passos[1]).toMatchObject({ responsavel: "dono_do_lead" });
  });

  it("recusas que ensinam: responsável fora da equipe, id que não existe, e o plano repetido no pedido", async () => {
    const c = await preparar();
    const fora = await recusa(c, "plataforma_garantir_planos_de_tarefa", {
      planos: [{ nome: "X", passos: [{ titulo: "Y", vence_em_dias: 1, responsavel: "alguem@exemplo.invalid" }] }],
    });
    expect(fora).toContain("planos[0].passos[0].responsavel: «alguem@exemplo.invalid» não faz parte da equipe");
    const id = await recusa(c, "plataforma_garantir_planos_de_tarefa", { planos: [{ id: "plano-fantasma", nome: "X", passos: [{ titulo: "Y", vence_em_dias: 1 }] }] });
    expect(id).toContain("não existe plano com o id «plano-fantasma»");
    const repetido = await recusa(c, "plataforma_garantir_planos_de_tarefa", {
      planos: [
        { nome: "X", passos: [{ titulo: "Y", vence_em_dias: 1 }] },
        { nome: "x", passos: [{ titulo: "Z", vence_em_dias: 1 }] },
      ],
    });
    expect(repetido).toContain("aparece duas vezes no pedido");
    expect(c.banco.escritas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.79 · passagem por assunto jurídico (0616, #2156) e 1.74 · afirmação clínica (#2321)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_agente · PASSOU A ALCANÇAR a passagem por assunto jurídico (upstream 1.79)", () => {
  const versao = (c: Cenario) => c.tabela("ai_agent_versions").at(-1)!;

  it("desligar grava `handoff_legal_enabled` no rascunho; repetir não escreve; a leitura devolve", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    expect(versao(c).handoff_legal_enabled, "o agente novo nasce com a chave ligada").toBe(true);

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", passagem_por_assunto_juridico: false });
    expect(r.dados.versao).toMatchObject({ desfecho: "atualizou", mudancas: ["passagem por assunto jurídico"] });
    expect(versao(c).handoff_legal_enabled).toBe(false);

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Bia", passagem_por_assunto_juridico: false });
    expect(de_novo.dados.versao).toMatchObject({ desfecho: "ja_estava", mudancas: [] });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Bia" });
    const bia = (lido.dados.agentes as Linha[])[0]!;
    expect(bia.passagem_por_assunto_juridico).toBe(false);
    expect((bia.versao_vigente as Linha).passagem_por_assunto_juridico).toBe(false);
  });

  it("versão gravada antes da coluna (sem o campo) vale como ligada: nenhum rascunho nasce por isso", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    delete versao(c).handoff_legal_enabled;
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_garantir_agente", { ...BIA, passagem_por_assunto_juridico: true });
    expect(r.dados.versao).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("⭐ publicar a versão com a chave mudada deixa `ai_agent.legal_handoff_changed` com o autor do token, como a rota", async () => {
    const c = await comFunil({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", { ...BIA, passagem_por_assunto_juridico: false });
    vi.mocked(audit).mockClear();
    await ok(c, "plataforma_publicar_agente", { agente: "Bia" });
    // A auditoria da chave é disparada sem esperar (fire-and-forget): dá uma volta no laço.
    await new Promise((r) => setTimeout(r, 0));
    expect(linhaAuditada("ai_agent.legal_handoff_changed")).toMatchObject({ actorUserId: AUTOR, metadata: { enabled: false } });
  });

  it("a mudança no cadastro (limiar) deixa a linha `ai_agent.updated`, como o PATCH da rota", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    vi.mocked(audit).mockClear();
    await ok(c, "plataforma_garantir_agente", { nome: "Bia", limiar_de_sentimento: 0.2 });
    expect(linhaAuditada("ai_agent.updated")?.metadata).toMatchObject({ fields: ["config"] });
  });
});

describe("plataforma_garantir_agente · PASSOU A ALCANÇAR o bloqueio de afirmação clínica da EMPRESA (upstream 1.74)", () => {
  it("ligar grava a camada em `org_guardrail_layers`, com a auditoria da tela; repetir não escreve; a leitura devolve", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", bloquear_afirmacao_clinica: true });
    expect(r.dados.bloqueio_de_afirmacao_clinica).toEqual({ ligado: true, desfecho: "criou" });
    expect((r.dados.avisos as string[]).join(" ")).toContain("para a empresa inteira, em todos os agentes");
    expect(c.tabela("org_guardrail_layers")).toEqual([
      expect.objectContaining({ organization_id: ORG, layer: "afirmacao_clinica", enabled: true }),
    ]);
    expect(linhaAuditada("ai.guardrail_layer_changed")).toMatchObject({ resourceId: null, metadata: { layer: "afirmacao_clinica", enabled: true } });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Bia", bloquear_afirmacao_clinica: true });
    expect(de_novo.dados.bloqueio_de_afirmacao_clinica).toEqual({ ligado: true, desfecho: "ja_estava" });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_agentes", {});
    expect(lido.dados.seguranca_da_empresa).toEqual({ bloqueio_de_afirmacao_clinica: { ligado: true, escolhido_pela_empresa: true } });

    const desliga = await ok(c, "plataforma_garantir_agente", { nome: "Bia", bloquear_afirmacao_clinica: false });
    expect(desliga.dados.bloqueio_de_afirmacao_clinica).toEqual({ ligado: false, desfecho: "atualizou" });
    expect(c.tabela("org_guardrail_layers")).toHaveLength(1);
  });

  it("empresa que nunca escolheu: desligada é o padrão, e pedir desligada não cria linha", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", bloquear_afirmacao_clinica: false });
    expect(r.dados.bloqueio_de_afirmacao_clinica).toEqual({ ligado: false, desfecho: "ja_estava" });
    expect(c.tabela("org_guardrail_layers")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.74 · janela de contexto do classificador do roteador (#2061)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_roteador · PASSOU A ALCANÇAR a janela de contexto do classificador (upstream 1.74)", () => {
  async function comRoteador(extra: Record<string, unknown> = {}) {
    const c = await comFunil({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", BIA);
    await ok(c, "plataforma_garantir_agente", { ...BIA, nome: "Caio" });
    await ok(c, "plataforma_garantir_roteador", {
      nome: "Recepção",
      numero: "Recepção",
      intencoes: [
        { nome: "Marcar", descricao: "Quer marcar.", agente: "Bia" },
        { nome: "Empresas", descricao: "Fala por uma empresa.", agente: "Caio" },
      ],
      ...extra,
    });
    return c;
  }

  it("roteador novo nasce com 8, como a rota; com o pedido, o pedido", async () => {
    const c = await comRoteador();
    expect(c.tabela("ai_routers")[0]!.config).toMatchObject({ classifier_model: null, classifier_provider: null, context_message_count: 8 });
    const outro = await comRoteador({ mensagens_de_contexto: 12 });
    expect((outro.tabela("ai_routers")[0]!.config as Linha).context_message_count).toBe(12);
  });

  it("ajustar mescla em `config` (o resto fica); repetir não escreve; a leitura devolve; roteador antigo sem a chave vale 4", async () => {
    const c = await comRoteador();
    const roteador = c.tabela("ai_routers")[0]!;
    roteador.config = { classifier_model: null, classifier_provider: null, sticky: false };
    const r = await ok(c, "plataforma_garantir_roteador", { nome: "Recepção", mensagens_de_contexto: 4 });
    // Sem a chave, o motor lê 4: pedir 4 não muda nada.
    expect(r.dados.roteador).toMatchObject({ desfecho: "ja_estava", mensagens_de_contexto: 4 });
    const troca = await ok(c, "plataforma_garantir_roteador", { nome: "Recepção", mensagens_de_contexto: 2 });
    expect(troca.dados.roteador).toMatchObject({ desfecho: "atualizou", mudancas: ["mensagens de contexto do classificador"] });
    expect(c.tabela("ai_routers")[0]!.config).toEqual({ classifier_model: null, classifier_provider: null, sticky: false, context_message_count: 2 });

    const antes = c.banco.escritas.length;
    await ok(c, "plataforma_garantir_roteador", { nome: "Recepção", mensagens_de_contexto: 2 });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_agentes", {});
    expect((lido.dados.roteadores as Linha[])[0]).toMatchObject({ mensagens_de_contexto: 2 });
  });

  it("fora de 0 a 16: recusado na conferência dos argumentos", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_roteador", { nome: "Recepção", mensagens_de_contexto: 17 });
    expect(texto).toContain("`mensagens_de_contexto` pode ser no máximo 16");
  });
});

// ---------------------------------------------------------------------------
// 1.74, 1.79 e 1.80 · os ajustes de uma conexão
// ---------------------------------------------------------------------------

describe("plataforma_configurar_canal · FERRAMENTA NOVA (upstream 1.74, 1.79 e 1.80)", () => {
  /** Uma data de parede no futuro, no fuso da empresa (São Paulo, UTC-3). */
  function futuro(dias: number, hora: string): string {
    const d = new Date(Date.now() + dias * 86_400_000);
    return `${d.toISOString().slice(0, 10)}T${hora}`;
  }

  it("dias da prospecção: grava em `channel_knobs` pela régua da tela; repetir não escreve; a leitura devolve", async () => {
    const c = await preparar({ comNumero: true });
    // Número oficial: não tem a opção de guardar o histórico, e a leitura devolve `null`.
    c.tabela("channel_sessions")[0]!.provider = "meta_cloud";
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", dias_da_prospeccao: [5, 1, 2, 3, 4, 1] });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["dias da prospecção"], dias_da_prospeccao: [1, 2, 3, 4, 5] });
    expect(c.tabela("channel_knobs")).toEqual([
      expect.objectContaining({ organization_id: ORG, channel_session_id: NUMERO, prospeccao_dias: [1, 2, 3, 4, 5] }),
    ]);
    expect(linhaAuditada("ai.pacing_knobs_updated")).toMatchObject({ resourceId: NUMERO, metadata: { prospeccao_dias: [1, 2, 3, 4, 5] } });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_canal", { canal: NUMERO, dias_da_prospeccao: [1, 2, 3, 4, 5] })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect((lido.dados.canais as Linha[])[0]).toMatchObject({ id: NUMERO, dias_da_prospeccao: [1, 2, 3, 4, 5], guardar_historico: null, pausado: false });
  });

  it("a conexão que nunca escolheu vale todos os dias: pedir todos não escreve", async () => {
    const c = await preparar({ comNumero: true });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", dias_da_prospeccao: [0, 1, 2, 3, 4, 5, 6] });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
  });

  it("guardar o histórico: só número por QR; ligar pela função da tela, que aplica na sessão; desligar pede confirmação escrita", async () => {
    const c = await preparar({ comNumero: true });
    // A opção é do número por QR Code: quem responde é `conexaoGuardaHistorico` (lib/channels).
    c.tabela("channel_sessions")[0]!.provider = "meta_cloud";
    const semQr = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", guardar_historico: true });
    expect(semQr).toContain("não é um número conectado por QR Code");

    c.tabela("channel_sessions")[0]!.provider = "waha";
    c.tabela("channel_sessions")[0]!.waha_session_name = "sessao-ficticia";
    c.tabela("channel_sessions")[0]!.metadata = { ai_gate: true };
    const liga = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", guardar_historico: true });
    expect(liga.dados).toMatchObject({ mudancas: ["guardar o histórico"], guardar_historico: { ligado: true, aplicado_na_conexao: true } });
    expect(c.tabela("channel_sessions")[0]!.metadata).toEqual({ ai_gate: true, guardar_historico: true });
    expect(estado.convergiu).toEqual([{ sessao: "sessao-ficticia", guardar: true }]);
    expect(linhaAuditada("channel.acervo_updated")?.metadata).toMatchObject({ guardar_historico: true, aplicado: true });

    const semConfirmar = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", guardar_historico: false });
    expect(semConfirmar).toContain("pode apagar o que o canal já guardou");
    expect(semConfirmar).toContain("confirmo_apagar_historico_guardado");
    expect((c.tabela("channel_sessions")[0]!.metadata as Linha).guardar_historico).toBe(true);

    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", guardar_historico: false, confirmo_apagar_historico_guardado: true });
    expect((c.tabela("channel_sessions")[0]!.metadata as Linha).guardar_historico).toBe(false);
  });

  it("⭐ a ferramenta nunca escreve credencial nem número: o que ela grava em `channel_sessions` é só a chave da opção", async () => {
    const c = await preparar({ comNumero: true });
    c.tabela("channel_sessions")[0]!.provider = "waha";
    c.tabela("channel_sessions")[0]!.waha_session_name = "sessao-ficticia";
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", guardar_historico: true, dias_da_prospeccao: [1, 2] });
    const escritasNaConexao = c.banco.escritas.filter((e) => e.tabela === "channel_sessions");
    expect(escritasNaConexao.map((e) => Object.keys(e.payload as Linha))).toEqual([["metadata"]]);
    expect(c.tabela("channel_sessions")[0]).toMatchObject({ phone_number: "+5500900000001", waha_session_name: "sessao-ficticia" });
  });

  it("pausa agendada: marca a janela na hora da empresa, como a rota; repetir não marca de novo; cancelar; a leitura devolve", async () => {
    const c = await preparar({ comNumero: true });
    const inicio = futuro(3, "23:00");
    const fim = futuro(4, "02:00");
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", pausa_agendada: { inicio, fim } });
    const agenda = c.tabela("channel_schedules")[0]!;
    // 23:00 em São Paulo (UTC-3) é 02:00 do dia seguinte em UTC.
    expect(agenda).toMatchObject({
      organization_id: ORG,
      channel_session_id: NUMERO,
      starts_at: `${futuro(4, "02:00")}:00.000Z`,
      ends_at: `${futuro(4, "05:00")}:00.000Z`,
      status: "scheduled",
      created_by: AUTOR,
    });
    expect((r.dados.pausa_agendada as Linha).desfecho).toBe("criou");
    expect(acoesAuditadas()).toContain("channel.schedule_created");

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", pausa_agendada: { inicio, fim } });
    expect((de_novo.dados.pausa_agendada as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução marcou outra janela").toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect(((lido.dados.canais as Linha[])[0]!.pausas_agendadas as Linha[])[0]).toMatchObject({ id: agenda.id, situacao: "marcada" });

    const cancela = await ok(c, "plataforma_configurar_canal", { cancelar_pausa_agendada: agenda.id });
    expect(cancela.dados.pausa_cancelada).toEqual({ id: agenda.id, desfecho: "atualizou" });
    expect(c.tabela("channel_schedules")[0]!.status).toBe("cancelled");
    expect((await ok(c, "plataforma_configurar_canal", { cancelar_pausa_agendada: agenda.id })).dados.pausa_cancelada).toEqual({ id: agenda.id, desfecho: "ja_estava" });
  });

  it("pausa de TODOS os números não pede `canal`", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", { pausa_agendada: { inicio: futuro(2, "22:00"), fim: futuro(2, "23:30"), todos_os_numeros: true } });
    expect(c.tabela("channel_schedules")[0]).toMatchObject({ channel_session_id: null });
  });

  it("recusas que ensinam (as da rota): no passado, fim antes do início, mais de 24 horas, sem canal, e pedido vazio", async () => {
    const c = await preparar({ comNumero: true });
    const chamar = (pausa: Record<string, unknown>) => recusa(c, "plataforma_configurar_canal", { canal: "Recepção", pausa_agendada: pausa });
    expect(await chamar({ inicio: "2020-01-01T10:00", fim: "2020-01-01T11:00" })).toContain("precisa começar no futuro");
    expect(await chamar({ inicio: futuro(2, "10:00"), fim: futuro(2, "09:00") })).toContain("termina antes de começar");
    expect(await chamar({ inicio: futuro(2, "10:00"), fim: futuro(3, "11:00") })).toContain("não pode durar mais de 24h");
    expect(await chamar({ inicio: "amanhã cedo", fim: futuro(2, "11:00") })).toContain("não é uma data e hora válida");
    expect(await recusa(c, "plataforma_configurar_canal", { dias_da_prospeccao: [1] })).toContain("Informe `canal`");
    expect(await recusa(c, "plataforma_configurar_canal", { canal: "Recepção" })).toContain("Informe ao menos um ajuste");
    expect(c.tabela("channel_schedules")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.76 e 1.78 · a fonte de formulário (0577 e 0595)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_fonte_de_formulario · FERRAMENTA NOVA (upstream 1.76 e 1.78)", () => {
  const FONTE = {
    nome: "Formulário do site",
    destino: { funil: "Agendamentos", etapa: "Novo contato" },
    perguntas: [
      { chave: "servico", pergunta: "Qual serviço você procura?", tipo: "select", obrigatoria: true, opcoes: ["Avaliação", "Limpeza"] },
      { chave: "melhor_horario", pergunta: "Melhor horário para falar?", tipo: "text" },
    ],
    endereco_de_retorno: "https://exemplo.invalid/obrigado",
  };

  it("cria pela função da tela, com as perguntas na forma do upstream e sem segredo; repetir não escreve", async () => {
    const c = await comFunil();
    const r = await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    expect(r.dados.desfecho).toBe("criou");
    const fonte = c.tabela("webhook_sources")[0]!;
    expect(fonte).toMatchObject({
      organization_id: ORG,
      name: "Formulário do site",
      default_pipeline_id: idDoFunil(c),
      default_stage_id: idDaEtapa(c, "Novo contato"),
      redirect_to: "https://exemplo.invalid/obrigado",
      secret_encrypted: null,
      form_fields: [
        { key: "servico", label: "Qual serviço você procura?", type: "select", required: true, options: ["Avaliação", "Limpeza"] },
        { key: "melhor_horario", label: "Melhor horário para falar?", type: "text", required: false },
      ],
    });
    expect(acoesAuditadas()).toContain("webhook.source_created");
    const retrato = r.dados.fonte as Linha;
    expect(retrato.caminho_de_captacao).toBe(`/api/v1/webhooks/in/${fonte.path_token}`);
    expect(retrato).toMatchObject({ tem_assinatura: false, autorizar_ia_na_captura: false, destino: { funil: "Agendamentos", etapa: "Novo contato" } });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE)).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("⭐ autorizar a IA na captação exige a ASSINATURA (a recusa da rota); com ela posta pela tela, liga", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    const sem = await recusa(c, "plataforma_garantir_fonte_de_formulario", { nome: "Formulário do site", autorizar_ia_na_captura: true });
    expect(sem).toContain("não tem ASSINATURA");
    expect(c.tabela("webhook_sources")[0]!.authorize_ai_on_capture).toBeUndefined();

    // A pessoa pôs o segredo pela tela.
    c.tabela("webhook_sources")[0]!.secret_encrypted = "cifra-ficticia";
    c.tabela("webhook_sources")[0]!.authorize_ai_on_capture = false;
    const liga = await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: "Formulário do site", autorizar_ia_na_captura: true });
    expect(liga.dados).toMatchObject({ desfecho: "atualizou", mudancas: ["autorizar IA na captação"] });
    expect((liga.dados.avisos as string[]).join(" ")).toContain("consentimento explícito");
    expect(c.tabela("webhook_sources")[0]).toMatchObject({ authorize_ai_on_capture: true, last_change_actor_kind: "user" });
    const linha = linhaAuditada("webhook.source_updated")!;
    expect(linha.metadata).toMatchObject({ authorize_ai_on_capture: true });
    // O segredo não vai para a auditoria nem para a resposta.
    expect(JSON.stringify(linha)).not.toContain("cifra-ficticia");
    expect(JSON.stringify(liga.dados)).not.toContain("cifra-ficticia");
    expect((liga.dados.fonte as Linha).tem_assinatura).toBe(true);
  });

  it("fonte nova não nasce autorizada; pergunta com chave reservada e etapa que não existe são recusadas", async () => {
    const c = await comFunil();
    expect(await recusa(c, "plataforma_garantir_fonte_de_formulario", { ...FONTE, autorizar_ia_na_captura: true })).toContain("não nasce com a autorização de IA");
    expect(
      await recusa(c, "plataforma_garantir_fonte_de_formulario", { ...FONTE, perguntas: [{ chave: "email", pergunta: "Seu e-mail", tipo: "text" }] }),
    ).toContain("reservada");
    expect(await recusa(c, "plataforma_garantir_fonte_de_formulario", { ...FONTE, destino: { funil: "Agendamentos", etapa: "Etapa fantasma" } })).toContain(
      "não tem uma etapa em uso chamada «Etapa fantasma»",
    );
    expect(await recusa(c, "plataforma_garantir_fonte_de_formulario", { nome: "Sem destino" })).toContain("Fonte nova precisa de `destino`");
    expect(c.tabela("webhook_sources")).toEqual([]);
  });

  it("a leitura devolve as fontes sem o segredo", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    c.tabela("webhook_sources")[0]!.secret_encrypted = "cifra-ficticia";
    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["fontes_de_formulario"] });
    const fontes = lido.dados.fontes_de_formulario as Linha[];
    expect(fontes[0]).toMatchObject({ nome: "Formulário do site", tem_assinatura: true, perguntas: [expect.objectContaining({ chave: "servico" }), expect.anything()] });
    expect(lido.texto).not.toContain("cifra-ficticia");
  });
});

// ---------------------------------------------------------------------------
// 1.74 · a coluna do cliente no banco externo (0558)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_banco_externo · FERRAMENTA NOVA (upstream 1.74)", () => {
  const CONEXAO = "0f000000-0000-4000-8000-0000000000d1";
  function comConexao(c: Cenario) {
    c.tabela("platform_config").push({ chave: "MODULO_BANCO_EXTERNO", valor: "ligado" });
    // A tabela e a visão segura apontam para a MESMA linha, como no banco.
    const linha: Linha = {
      id: CONEXAO,
      organization_id: ORG,
      label: "ERP da clínica",
      host: "banco.exemplo.invalid",
      username: "leitor",
      password_ciphertext: "senha-cifrada-ficticia",
      enabled: true,
      customer_key_column: null,
      customer_key_kind: null,
      last_test_ok: true,
      last_tested_at: "2026-10-01T00:00:00Z",
    };
    c.tabela("external_db_connections").push(linha);
    c.tabela("external_db_connections_safe").push(linha);
  }

  it("grava só as duas colunas, nunca devolve endereço nem senha; repetir não escreve; a leitura devolve", async () => {
    const c = await preparar();
    comConexao(c);
    const r = await ok(c, "plataforma_configurar_banco_externo", {
      conexao: "ERP da clínica",
      cliente_nas_conversas: { coluna: "telefone_paciente", tipo: "phone" },
    });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", conexao: { nome: "ERP da clínica", cliente_nas_conversas: { coluna: "telefone_paciente", tipo: "phone" } } });
    const escrita = c.banco.escritas.find((e) => e.tabela === "external_db_connections")!;
    expect(escrita.payload).toEqual({ customer_key_column: "telefone_paciente", customer_key_kind: "phone" });
    expect(r.texto).not.toMatch(/banco\.exemplo\.invalid|senha-cifrada|leitor/);
    expect(linhaAuditada("external_db_connection.updated")?.metadata).toMatchObject({ campos: ["customer_key_column", "customer_key_kind"], senha_trocada: false });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_banco_externo", { conexao: CONEXAO, cliente_nas_conversas: { coluna: "telefone_paciente", tipo: "phone" } })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["banco_externo"] });
    expect(lido.dados.banco_externo).toMatchObject({ modulo_ligado: true, conexoes: [expect.objectContaining({ nome: "ERP da clínica" })] });
    expect(lido.texto).not.toMatch(/banco\.exemplo\.invalid|senha-cifrada|leitor/);

    await ok(c, "plataforma_configurar_banco_externo", { conexao: CONEXAO, cliente_nas_conversas: null });
    expect(c.tabela("external_db_connections")[0]).toMatchObject({ customer_key_column: null, customer_key_kind: null });
  });

  it("módulo da instalação desligado: a recusa diz que é da plataforma; conexão que não existe: diz que é criada na tela", async () => {
    const c = await preparar();
    expect(await recusa(c, "plataforma_configurar_banco_externo", { conexao: "ERP", cliente_nas_conversas: null })).toContain("módulo de banco externo está DESLIGADO");
    comConexao(c);
    expect(await recusa(c, "plataforma_configurar_banco_externo", { conexao: "Outro sistema", cliente_nas_conversas: null })).toContain("é criada e testada por uma pessoa na tela Dados externos");
    expect(c.banco.escritas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.78 · o limite de assentos do plano no convite (cobrança do revendedor)
// ---------------------------------------------------------------------------

describe("plataforma_convidar_pessoas · o limite de assentos do plano (upstream 1.78)", () => {
  it("plano cheio: o pedido inteiro é recusado com a frase da rota, antes de qualquer e-mail; sem limite (cobrança desligada), convida", async () => {
    const c = await preparar();
    const deVerdade = c.cliente.rpc.bind(c.cliente);
    let limite: number | null = 1;
    c.cliente.rpc = (async (nome: string, args: unknown) =>
      nome === "fn_limite_do_plano" ? { data: limite, error: null } : deVerdade(nome, args)) as typeof c.cliente.rpc;
    const texto = await recusa(c, "plataforma_convidar_pessoas", { pessoas: [{ email: "recepcao@exemplo.invalid", papel: "agent" }] });
    expect(texto).toContain("Seu plano permite 1 pessoa e a vaga está ocupada.");
    expect(texto).toContain("Nenhum convite saiu.");
    expect(c.tabela("team_invites")).toEqual([]);

    limite = null;
    expect(c.tabela("team_invites")).toEqual([]);
    const r = await c.mcp.chamar("plataforma_convidar_pessoas", { organization_id: ORG, pessoas: [{ email: "recepcao@exemplo.invalid", papel: "agent" }] });
    expect(r.texto).not.toContain("Seu plano permite");
  });
});

// ---------------------------------------------------------------------------
// 1.78 · a chave do CPF (0597) na saúde da instalação
// ---------------------------------------------------------------------------

describe("plataforma_ver_saude · diz se a chave do CPF está semeada, sem nunca devolver o valor (upstream 1.78)", () => {
  it("semeada: o banco cifra o CPF fictício, e a cifra não sai; sem chave: diz como semear", async () => {
    const c = await preparar();
    const deVerdade = c.cliente.rpc.bind(c.cliente);
    let comChave = true;
    const pedidos: unknown[] = [];
    c.cliente.rpc = (async (nome: string, args: unknown) => {
      if (nome !== "encrypt_cpf") return deVerdade(nome, args);
      pedidos.push(args);
      return comChave
        ? { data: "\\xc30d0407cifra-ficticia", error: null }
        : { data: null, error: { message: "CPF_ENCRYPTION_KEY ausente", code: "P0001" } };
    }) as typeof c.cliente.rpc;

    const sim = await c.mcp.chamar("plataforma_ver_saude", {});
    expect(sim.erro, sim.texto).toBe(false);
    expect(sim.dados.chave_do_cpf).toEqual({ semeada: true });
    expect(sim.texto).not.toContain("cifra-ficticia");
    // O que vai ao banco é um CPF de zeros, nunca dado de cliente.
    expect(pedidos).toEqual([{ p_plaintext: "00000000000" }]);

    comChave = false;
    const nao = await c.mcp.chamar("plataforma_ver_saude", {});
    expect((nao.dados.chave_do_cpf as Linha).semeada).toBe(false);
    expect((nao.dados.chave_do_cpf as Linha).detalhe).toContain("bootstrap");
  });
});

/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.86 AO ALCANCE DO MCP DE PLATAFORMA (a
 * regra do dono do produto: toda peça nova ou alterada do sistema que seja
 * configuração de implantação ganha ferramenta ou campo no MCP na MESMA versão,
 * a .84).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-185.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Cada bloco
 * prova o que foi GRAVADO, que a REEXECUÇÃO não escreve, a recusa que ensina e
 * a leitura que devolve.
 *
 * A CONTAGEM da lista mora no teste da versão mais nova (188). A v1.86 pediu UMA
 * ferramenta nova (`plataforma_copiar_followup`: a exportação e a importação de
 * fluxo, #3056) e campos novos: o escopo e a lista pesquisável dos campos do
 * funil (#2791, #2521), o rodízio da ação atribuir (#2041, 0692), os dois freios
 * do gatilho de silêncio (#3048) e o motor do banco externo (0691).
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados,
 * e-mails `@exemplo.invalid`.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionSchema } from "@/lib/schemas/webhooks";
import { idsCitados, montarArquivoDeFluxo } from "@/lib/followup/portabilidade";
import { nomesDaOrigem } from "@/lib/followup/portabilidade-db";
import type { FlowGraph } from "@/lib/followup/graph-schema";
import {
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  ORG,
  OUTRA_ORG,
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

const linhaAuditada = (acao: string) => vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === acao);

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Sem resposta", passo: null },
  { nome: "Fechado", passo: "won" },
  { nome: "Perdido", passo: "lost" },
];
/** O funil semeado (o PADRÃO da organização) adotado como «Vendas». */
const VENDAS = { nome: "Vendas", adotar_funil_padrao: true, etapas: ETAPAS };
const camposDe = (c: Cenario, funil = "Vendas") =>
  ((c.tabela("crm_pipelines").find((f) => f.name === funil)!.settings as Linha).fields as Linha[]) ?? [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("a lista: 69 ferramentas, e os tipos de ação seguem os do upstream", () => {
  it("a v1.86 acrescentou UMA ferramenta (69): copiar fluxo de follow-up, que só monta", () => {
    // A contagem mora no teste da versão mais nova (188).
    const copiar = FERRAMENTAS.find((f) => f.name === "plataforma_copiar_followup");
    expect(copiar?.operacao).toBe("implantar_configuracao");
    expect(Object.keys(copiar!.inputSchema).sort()).toEqual(["arquivo", "de_outra_empresa", "nome", "organization_id"]);
  });

  it("⭐ os tipos de ação que a ferramenta aceita são EXATAMENTE os do upstream (a v1.86 não trouxe ação nova: o rodízio é um modo do `assign_owner`)", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
  });
});

// ---------------------------------------------------------------------------
// 1.86 · os campos do funil: de quem é o campo (#2791) e a lista pesquisável (#2521)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_funil · CAMPOS NOVOS `escopo`, `searchable_select`, `aliases` e `allow_new` (upstream 1.86)", () => {
  it("⭐ grava o campo do CONTATO no funil padrão como a tela grava; reexecutar não escreve; `negocio` por extenso tira a chave", async () => {
    const c = await preparar();
    const pedido = { ...VENDAS, campos: [{ key: "cpf", label: "CPF", type: "text", escopo: "contato" }, { key: "plano", label: "Plano", type: "text" }] };
    await ok(c, "plataforma_garantir_funil", pedido);
    expect(camposDe(c).find((f) => f.key === "cpf")).toMatchObject({ escopo: "contato" });
    // Ausente é negócio: a chave só existe quando é `contato` (como a tela).
    expect(camposDe(c).find((f) => f.key === "plano")).not.toHaveProperty("escopo");

    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_garantir_funil", pedido);
    expect((r.dados.configuracao as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    await ok(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "cpf", label: "CPF", type: "text", escopo: "negocio" }] });
    expect(camposDe(c).find((f) => f.key === "cpf")).not.toHaveProperty("escopo");
  });

  it("⭐ a lista pesquisável grava opções com apelidos e a válvula do valor novo", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", {
      ...VENDAS,
      campos: [
        {
          key: "destino",
          label: "Destino",
          type: "searchable_select",
          allow_new: true,
          options: [
            { value: "maceio-al", label: "Maceió (AL)", aliases: ["mcz"] },
            { value: "recife-pe", label: "Recife (PE)" },
          ],
        },
      ],
    });
    expect(camposDe(c).find((f) => f.key === "destino")).toMatchObject({
      type: "searchable_select",
      allow_new: true,
      options: [{ value: "maceio-al", label: "Maceió (AL)", aliases: ["mcz"] }, { value: "recife-pe", label: "Recife (PE)" }],
    });
  });

  it("recusas que ensinam: contato fora do funil padrão, contato obrigatório no negócio, e valor novo fora da lista pesquisável", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", VENDAS);
    // Um segundo funil (não é o padrão): a ficha do contato não o lê.
    c.tabela("crm_pipelines").push({
      id: "0d000000-0000-4000-8000-000000000002",
      organization_id: ORG,
      name: "Pós-venda",
      slug: "pos-venda",
      description: null,
      position: 2000,
      is_default: false,
      is_client_pipeline: false,
      is_archived: false,
      vocabulary: {},
      settings: { fields: [] },
    });
    for (const [i, [nome, won, lost]] of ([["Aberto", false, false], ["Feito", true, false], ["Desistiu", false, true]] as const).entries()) {
      c.tabela("crm_stages").push({
        id: randomUUID(),
        organization_id: ORG,
        pipeline_id: "0d000000-0000-4000-8000-000000000002",
        name: nome,
        slug: nome.toLowerCase(),
        position: (i + 1) * 1000,
        is_won: won,
        is_lost: lost,
        is_archived: false,
      });
    }
    const posVenda = {
      nome: "Pós-venda",
      etapas: [{ nome: "Aberto", passo: "new" }, { nome: "Feito", passo: "won" }, { nome: "Desistiu", passo: "lost" }],
    };
    const fora = await recusa(c, "plataforma_garantir_funil", { ...posVenda, campos: [{ key: "cpf", label: "CPF", type: "text", escopo: "contato" }] });
    expect(fora).toContain("este não é o funil padrão");

    const obrigatorio = await recusa(c, "plataforma_garantir_funil", {
      ...VENDAS,
      campos: [{ key: "cpf", label: "CPF", type: "text", escopo: "contato", obrigatorio_em: { ao_ganhar: true } }],
    });
    expect(obrigatorio).toContain("não entra na régua de campos obrigatórios do NEGÓCIO");

    const valorNovo = await recusa(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "cidade", label: "Cidade", type: "text", allow_new: true }] });
    expect(valorNovo).toContain("só existe na lista pesquisável");
    expect(camposDe(c)).toEqual([]);
  });

  it("⭐ marcar como do contato um campo de data que uma regra LIGADA do gatilho por data lê é recusado, nomeando a regra (a mesma recusa da tela, agora na gravação compartilhada)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "fim_teste", label: "Fim do teste", type: "date" }] });
    await ok(c, "plataforma_garantir_automacao", {
      nome: "Avisar no fim do teste",
      gatilho: "lead.date_field_due",
      configuracao_do_gatilho: { pipeline_id: FUNIL_SEMEADO, campo: "fim_teste", dias: 1 },
      acoes: [{ type: "add_tag", config: { tags: ["Fim do teste"] } }],
    });
    await ok(c, "plataforma_ligar_automacao", { regra: "Avisar no fim do teste", ligada: true });

    const texto = await recusa(c, "plataforma_garantir_funil", {
      ...VENDAS,
      campos: [{ key: "fim_teste", label: "Fim do teste", type: "date", escopo: "contato" }],
    });
    expect(texto).toContain('"Avisar no fim do teste"');
    expect(texto).toContain("Troque o campo da regra ou desligue-a antes");
    expect(camposDe(c).find((f) => f.key === "fim_teste")).not.toHaveProperty("escopo");
  });
});

// ---------------------------------------------------------------------------
// 1.86 · o gatilho por data num campo do contato nunca dispara (#2791)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao e plataforma_ligar_automacao · o gatilho por data recusa campo do CONTATO (upstream 1.86)", () => {
  const regraDaData = { nome: "Parabéns", gatilho: "lead.date_field_due", acoes: [{ type: "add_tag", config: { tags: ["Aniversário"] } }] };

  it("⭐ criar a regra sobre um campo do contato é recusado com a frase da rota, e nada é gravado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "nascimento", label: "Nascimento", type: "date", escopo: "contato" }] });
    const texto = await recusa(c, "plataforma_garantir_automacao", {
      ...regraDaData,
      configuracao_do_gatilho: { pipeline_id: FUNIL_SEMEADO, campo: "nascimento", dias: 0 },
    });
    expect(texto).toContain("Este campo de data é do contato, e o gatilho por data só lê campos do negócio.");
    expect(c.tabela("automation_rules")).toEqual([]);
  });

  it("religar uma regra antiga sobre um campo que VIROU do contato é recusado; desligar segue livre", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "nascimento", label: "Nascimento", type: "date" }] });
    await ok(c, "plataforma_garantir_automacao", { ...regraDaData, configuracao_do_gatilho: { pipeline_id: FUNIL_SEMEADO, campo: "nascimento", dias: 0 } });
    // A regra está DESLIGADA: marcar o campo como do contato passa (a tela também deixa).
    await ok(c, "plataforma_garantir_funil", { ...VENDAS, campos: [{ key: "nascimento", label: "Nascimento", type: "date", escopo: "contato" }] });

    const texto = await recusa(c, "plataforma_ligar_automacao", { regra: "Parabéns", ligada: true });
    expect(texto).toContain("Este campo de data é do contato");
    // O banco em memória não aplica o default da coluna: ausente é desligada.
    expect(c.tabela("automation_rules")[0]!.is_active ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1.86 · rodízio de atendentes na ação atribuir (#2041, 0692)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao · o RODÍZIO da ação `assign_owner` (upstream 1.86, 0692)", () => {
  const rodizio = (fila: Array<{ user_id: string; pausado: boolean }>) => ({
    nome: "Repartir os leads do formulário",
    gatilho: "lead.created",
    acoes: [{ type: "assign_owner", config: { modo: "rodizio", fila } }],
  });

  it("⭐ grava a fila na ordem pedida, e reexecutar não escreve", async () => {
    const c = await preparar();
    const pedido = rodizio([
      { user_id: BRUNO.id, pausado: false },
      { user_id: ANA.id, pausado: true },
    ]);
    await ok(c, "plataforma_garantir_automacao", pedido);
    const acao = (c.tabela("automation_rules")[0]!.actions as Array<{ type: string; config: Linha }>)[0]!;
    expect(acao).toEqual({ type: "assign_owner", config: { modo: "rodizio", fila: [{ user_id: BRUNO.id, pausado: false }, { user_id: ANA.id, pausado: true }] } });

    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_garantir_automacao", pedido);
    expect((r.dados.regra as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("quem não é da equipe e quem só lê são recusados dizendo a posição na fila; o schema do upstream recusa repetido e rodízio dentro do `ai_decide`", async () => {
    const c = await preparar();
    const estranho = await recusa(c, "plataforma_garantir_automacao", rodizio([{ user_id: ANA.id, pausado: false }, { user_id: "0b000000-0000-4000-8000-0000000000f9", pausado: false }]));
    expect(estranho).toContain("acoes[0].config.fila[1]");
    expect(estranho).toContain("não faz parte da equipe");

    const leitora = await recusa(c, "plataforma_garantir_automacao", rodizio([{ user_id: LEITORA.id, pausado: false }]));
    expect(leitora).toContain("só tem acesso de visualização");

    const repetida = await recusa(c, "plataforma_garantir_automacao", rodizio([{ user_id: ANA.id, pausado: false }, { user_id: ANA.id, pausado: true }]));
    expect(repetida).toContain("Cada pessoa entra uma vez só na fila do rodízio.");
    expect(c.tabela("automation_rules")).toEqual([]);
  });

  it("o catálogo (plataforma_listar_modelos) ensina o formato do rodízio", async () => {
    const c = await preparar();
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes"] });
    expect(r.erro, r.texto).toBe(false);
    expect(JSON.stringify(r.dados)).toContain('\\"modo\\": \\"rodizio\\"');
  });
});

// ---------------------------------------------------------------------------
// 1.86 · os freios do gatilho de silêncio e os avisos da publicação (#3048)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_followup · CAMPOS NOVOS `so_se_a_equipe_respondeu` e `repeticoes_por_contato` (upstream 1.86, #3048)", () => {
  const FLUXO = "Retomada · voltar a quem parou de responder";
  const gatilho = (c: Cenario) => c.tabela("followup_flow_pointers")[0]!.trigger_config as { kind: string; params: Linha };

  it("⭐ grava os dois freios como a tela grava; reexecutar não escreve; false e null tiram as chaves", async () => {
    const c = await preparar();
    const pedido = { modelo: "geral-retomada", so_se_a_equipe_respondeu: true, repeticoes_por_contato: 3 };
    await ok(c, "plataforma_garantir_followup", pedido);
    expect(gatilho(c)).toMatchObject({ kind: "silence", params: { exige_resposta_da_equipe: true, max_enrollments_por_contato: 3 } });

    const antes = c.banco.escritas.length;
    expect(((await ok(c, "plataforma_garantir_followup", pedido)).dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_garantir_followup", { nome: FLUXO, so_se_a_equipe_respondeu: false, repeticoes_por_contato: null });
    expect(gatilho(c).params).not.toHaveProperty("exige_resposta_da_equipe");
    expect(gatilho(c).params).not.toHaveProperty("max_enrollments_por_contato");
  });

  it("fluxo que não dispara por silêncio recusa os freios; o limite fora de 1 a 50 é recusado pela ferramenta", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: [{ nome: "Quer agendar", passo: "qualified" }, { nome: "Marcou", passo: "won" }, { nome: "Desistiu", passo: "lost" }] });
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-agendamento", etapa: { funil: "Agendamentos", etapa: "Quer agendar" } });
    const texto = await recusa(c, "plataforma_garantir_followup", { nome: "Agendamento · marcar o próximo passo", so_se_a_equipe_respondeu: true });
    expect(texto).toContain("só vale para fluxo que dispara por silêncio");

    const r = await c.mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "geral-retomada", repeticoes_por_contato: 51 });
    expect(r.erro).toBe(true);
  });

  it("⭐ publicar devolve os AVISOS do gatilho que a tela mostra, com o campo do MCP que resolve cada um; com os três freios, nenhum", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const sem = await ok(c, "plataforma_publicar_followup", { fluxo: FLUXO });
    const avisos = (sem.dados.avisos as string[]).join("\n");
    expect(avisos).toContain("Sem “silêncio máximo”");
    expect(avisos).toContain("`repeticoes_por_contato`");
    expect(avisos).toContain("`so_se_a_equipe_respondeu: true`");

    await ok(c, "plataforma_publicar_followup", { fluxo: FLUXO, ativo: false });
    await ok(c, "plataforma_garantir_followup", {
      nome: FLUXO,
      silencio_maximo_minutos: 4320,
      so_se_a_equipe_respondeu: true,
      repeticoes_por_contato: 2,
    });
    const com = await ok(c, "plataforma_publicar_followup", { fluxo: FLUXO });
    expect((com.dados.avisos as string[]).join("\n")).not.toContain("silêncio máximo");
    expect((com.dados.avisos as string[]).join("\n")).not.toContain("repetições");
  });

  it("⭐ a publicação recusa o passo de modelo de mensagem que não existe NESTA empresa (a régua nova da rota, #3056)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const fluxo = c.tabela("followup_flow_pointers")[0]!;
    const grafo = fluxo.draft_graph as FlowGraph;
    const mensagem = grafo.nodes.find((n) => n.type === "action")!;
    (mensagem as { config: Linha }).config = { mode: "template", template_id: randomUUID() };
    const texto = await recusa(c, "plataforma_publicar_followup", { fluxo: FLUXO });
    expect(texto).toContain("Escolha um modelo de mensagem: o que estava aqui não existe nesta conta.");
  });
});

// ---------------------------------------------------------------------------
// 1.86 · exportar e importar fluxo de follow-up (#3056): plataforma_copiar_followup
// ---------------------------------------------------------------------------

describe("plataforma_copiar_followup · FERRAMENTA NOVA: a exportação e a importação de fluxo (upstream 1.86, #3056)", () => {
  const FLUXO = "Retomada · voltar a quem parou de responder";

  /** Uma empresa de ORIGEM com o funil «Agendamentos» e o fluxo com uma caixa que move para «Sem resposta». */
  async function comOrigem(c: Cenario): Promise<void> {
    const org = { ...c.tabela("organizations").find((o) => o.id === ORG)!, id: OUTRA_ORG, display_name: "Academia Exemplo", slug: "academia-exemplo" };
    c.tabela("organizations").push(org);
    const funil = randomUUID();
    c.tabela("crm_pipelines").push({
      id: funil,
      organization_id: OUTRA_ORG,
      name: "Agendamentos",
      slug: "agendamentos",
      description: null,
      position: 1000,
      is_default: true,
      is_client_pipeline: false,
      is_archived: false,
      vocabulary: {},
      settings: { fields: [] },
    });
    for (const [i, [nome, won, lost]] of ([["Quer agendar", false, false], ["Sem resposta", false, false], ["Marcou", true, false], ["Desistiu", false, true]] as const).entries()) {
      c.tabela("crm_stages").push({
        id: randomUUID(),
        organization_id: OUTRA_ORG,
        pipeline_id: funil,
        name: nome,
        slug: nome.toLowerCase().replace(/ /g, "-"),
        position: (i + 1) * 1000,
        is_won: won,
        is_lost: lost,
        is_archived: false,
      });
    }
    await ok(
      c,
      "plataforma_garantir_followup",
      { modelo: "geral-retomada", mover_no_funil: [{ antes_de: "fim-esgotou", funil: "Agendamentos", etapa: "Sem resposta" }] },
      OUTRA_ORG,
    );
  }

  const destinoDaCaixa = (c: Cenario, nome: string) => {
    const fluxo = c.tabela("followup_flow_pointers").find((f) => f.organization_id === ORG && f.name === nome)!;
    return ((fluxo.draft_graph as FlowGraph).nodes.find((n) => n.id === "mover-antes-de-fim-esgotou") as { config: { stage_id: string } }).config.stage_id;
  };

  it("⭐ de outra empresa: o fluxo nasce RASCUNHO no cliente, a etapa que não existe aqui vira pendência que BLOQUEIA, e a auditoria é a da rota", async () => {
    const c = await preparar();
    await comOrigem(c);
    const r = await ok(c, "plataforma_copiar_followup", { de_outra_empresa: { organization_id: OUTRA_ORG, fluxo: FLUXO } });

    expect(r.dados.fluxo).toMatchObject({ nome: FLUXO, situacao: "draft", desfecho: "criou" });
    const copiado = c.tabela("followup_flow_pointers").find((f) => f.organization_id === ORG)!;
    expect(copiado).toMatchObject({ status: "draft", surface: "followup" });
    expect(copiado.active_version_id ?? null).toBeNull();
    expect(destinoDaCaixa(c, FLUXO)).toBe("");
    const pendencias = r.dados.pendencias as Array<Linha>;
    expect(pendencias).toEqual([
      expect.objectContaining({ codigo: "etapa_nao_encontrada", bloqueia: true, referencia: "Sem resposta · Agendamentos" }),
    ]);
    expect(String(pendencias[0]!.o_que_fazer)).toContain("antes de publicar");
    expect((r.dados.avisos as string[]).join(" ")).toContain("impede a publicação");
    expect(linhaAuditada("followup_flow.imported")).toMatchObject({
      organizationId: ORG,
      metadata: { pendencias: ["etapa_nao_encontrada"], origem: "outra_empresa", via: "mcp_plataforma" },
    });

    // GARANTIR: o nome no cliente é a chave; de novo, nada é escrito.
    const antes = c.banco.escritas.length;
    const deNovo = await ok(c, "plataforma_copiar_followup", { de_outra_empresa: { organization_id: OUTRA_ORG, fluxo: FLUXO } });
    expect(deNovo.dados.fluxo).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("⭐ com o funil e a etapa de mesmo nome no cliente, a caixa é ligada à etapa DELE (pendência que só avisa)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", {
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: [{ nome: "Quer agendar", passo: "qualified" }, { nome: "Sem resposta", passo: null }, { nome: "Marcou", passo: "won" }, { nome: "Desistiu", passo: "lost" }],
    });
    await comOrigem(c);
    const r = await ok(c, "plataforma_copiar_followup", { de_outra_empresa: { organization_id: OUTRA_ORG, fluxo: FLUXO }, nome: "Retomada da academia" });

    const daqui = c.tabela("crm_stages").find((e) => e.organization_id === ORG && e.name === "Sem resposta")!.id;
    expect(destinoDaCaixa(c, "Retomada da academia")).toBe(daqui);
    expect(r.dados.pendencias).toEqual([expect.objectContaining({ codigo: "etapa_remapeada", bloqueia: false })]);
    // E a régua de publicação do upstream aceita o que foi copiado.
    expect((await ok(c, "plataforma_publicar_followup", { fluxo: "Retomada da academia" })).dados.desfecho).toBe("publicou");
  });

  it("de um ARQUIVO .fluxo.json exportado pela tela: o mesmo caminho da importação", async () => {
    const c = await preparar();
    await comOrigem(c);
    const origem = c.tabela("followup_flow_pointers").find((f) => f.organization_id === OUTRA_ORG)!;
    const grafo = origem.draft_graph as FlowGraph;
    const arquivo = montarArquivoDeFluxo(
      { name: String(origem.name), surface: null, handoff_policy: String(origem.handoff_policy ?? "pause"), trigger_config: origem.trigger_config, graph: grafo },
      await nomesDaOrigem(c.cliente as never, OUTRA_ORG, idsCitados(grafo, null)),
      new Date(),
    );
    const r = await ok(c, "plataforma_copiar_followup", { arquivo, nome: "Retomada importada" });
    expect(r.dados.fluxo).toMatchObject({ nome: "Retomada importada", desfecho: "criou" });
    expect(linhaAuditada("followup_flow.imported")).toMatchObject({ metadata: { origem: "arquivo" } });
  });

  it("recusas que ensinam: nem origem nem arquivo (ou os dois), arquivo inválido, roteiro de atendimento e fluxo de origem que não existe", async () => {
    const c = await preparar();
    await comOrigem(c);
    expect(await recusa(c, "plataforma_copiar_followup", {})).toContain("um dos dois");

    const invalido = await recusa(c, "plataforma_copiar_followup", { arquivo: { format: "outra_coisa" } });
    expect(invalido).toContain("O arquivo não é um fluxo válido");

    const origem = c.tabela("followup_flow_pointers").find((f) => f.organization_id === OUTRA_ORG)!;
    const grafo = origem.draft_graph as FlowGraph;
    const roteiro = montarArquivoDeFluxo(
      { name: "Roteiro", surface: "atendimento", handoff_policy: "pause", trigger_config: { kind: "manual" }, graph: grafo },
      { stages: new Map(), templates: new Map(), flows: new Map(), event_types: new Map() },
      new Date(),
    );
    expect(await recusa(c, "plataforma_copiar_followup", { arquivo: roteiro })).toContain("fluxo de ATENDIMENTO");

    expect(await recusa(c, "plataforma_copiar_followup", { de_outra_empresa: { organization_id: OUTRA_ORG, fluxo: "Não existe" } })).toContain(
      "o fluxo de follow-up de origem",
    );
    expect(c.tabela("followup_flow_pointers").filter((f) => f.organization_id === ORG)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.86 · o motor do banco externo e o aviso do último teste (0691)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_banco_externo e a leitura · o MOTOR do banco (upstream 1.86, 0691)", () => {
  it("⭐ a resposta e a leitura dizem o motor e o aviso do último teste; conexão antiga (sem a coluna) lê como PostgreSQL", async () => {
    const c = await preparar();
    c.tabela("platform_config").push({ chave: "MODULO_BANCO_EXTERNO", valor: "ligado" });
    // A tabela e a visão segura apontam para a MESMA linha, como no banco.
    const loja: Linha = {
      id: "0f000000-0000-4000-8000-0000000000e1",
      organization_id: ORG,
      label: "Loja do site",
      host: "banco.exemplo.invalid",
      username: "leitor",
      password_ciphertext: "senha-cifrada-ficticia",
      enabled: true,
      customer_key_column: null,
      customer_key_kind: null,
      last_test_ok: true,
      last_tested_at: "2026-10-20T10:00:00Z",
      db_type: "mysql",
      last_test_aviso: "Este usuário pode escrever: crie um usuário só de leitura.",
    };
    const antiga: Linha = { ...loja, id: "0f000000-0000-4000-8000-0000000000e2", label: "Antiga", db_type: undefined, last_test_aviso: undefined };
    delete antiga.db_type;
    delete antiga.last_test_aviso;
    for (const linha of [loja, antiga]) {
      c.tabela("external_db_connections").push(linha);
      c.tabela("external_db_connections_safe").push(linha);
    }

    const r = await ok(c, "plataforma_configurar_banco_externo", { conexao: "Loja do site", cliente_nas_conversas: { coluna: "email_cliente", tipo: "email" } });
    expect(r.dados.conexao).toMatchObject({ tipo_do_banco: "mysql", aviso_do_ultimo_teste: "Este usuário pode escrever: crie um usuário só de leitura." });
    expect(JSON.stringify(r.dados)).not.toContain("banco.exemplo.invalid");

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["banco_externo"] });
    const conexoes = (lido.dados.banco_externo as { conexoes: Linha[] }).conexoes;
    expect(conexoes.find((x) => x.nome === "Loja do site")).toMatchObject({ tipo_do_banco: "mysql" });
    expect(conexoes.find((x) => x.nome === "Antiga")).toMatchObject({ tipo_do_banco: "postgres", aviso_do_ultimo_teste: null });
  });

  it("o retrato da conexão (a mesma função da leitura) traz o motor, com PostgreSQL quando a coluna falta", async () => {
    const { retratoDaConexao } = await import("@/lib/implantacao/banco-externo");
    const base = { id: "x", label: "Antiga", enabled: true, customer_key_column: null, customer_key_kind: null, last_test_ok: true, last_tested_at: null };
    expect(retratoDaConexao(base)).toMatchObject({ tipo_do_banco: "postgres", aviso_do_ultimo_teste: null });
    expect(retratoDaConexao({ ...base, db_type: "mysql", last_test_aviso: "pode escrever" })).toMatchObject({ tipo_do_banco: "mysql", aviso_do_ultimo_teste: "pode escrever" });
  });
});

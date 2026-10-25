/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.87 E 1.88 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: toda peça nova ou alterada do sistema
 * que seja configuração de implantação ganha ferramenta ou campo no MCP na
 * MESMA versão, a .86).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-186.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 * A CONTAGEM da lista morava aqui até a .86: 69. Na .89 ela foi para
 * `mcp-de-implantacao-email-marketing.test.ts` (83: as 69, as cinco do assistente
 * da .88 e as nove do e-mail) e, desde a .90, mora em
 * `mcp-de-implantacao-cobranca.test.ts` (92: mais as nove da cobrança). As v1.87 e v1.88 não
 * pediram ferramenta nova, só campos: o reaproveitamento do card aberto na
 * fonte (0722), a assinatura com o nome de cada agente (#3318), a devolução à
 * fila da conversa do rodízio sem resposta (#2988), o telefone que entra
 * sozinho na ficha sem número (#2593), as etiquetas de contato interno
 * (refs #2353), o filtro de palavras do agente que passou a valer (#2696), os
 * operadores novos e o grupo "qualquer uma" das condições (#2727), a mensagem
 * para a equipe (#2642), o serviço em rascunho da agenda (0716), as receitas
 * prontas do banco externo (0706) e a ordem das respostas prontas (0729).
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
const { FERRAMENTAS_DE_COBRANCA } = await import("@/lib/mcp-plataforma/ferramentas/cobranca");
const { TIPOS_DE_ACAO } = await import("@/lib/mcp-plataforma/ferramentas/automacoes-e-agenda");
const { audit } = await import("@/lib/audit");

/** Pessoas fictícias da equipe. */
const ANA = { id: "0b000000-0000-4000-8000-0000000000a1", email: "ana@exemplo.invalid", papel: "agent" };

async function preparar(opcoes: OpcoesDoCenario = {}) {
  const cenario = cenarioDaImplantacao(opcoes);
  cenario.usuarios.set(ANA.id, { email: ANA.email, nome: "ana" });
  cenario.banco.tabela("user_organizations").push({
    id: randomUUID(),
    organization_id: ORG,
    user_id: ANA.id,
    role: ANA.papel,
    accepted_at: "2026-01-02T00:00:00Z",
    revoked_at: null,
    created_at: "2026-01-02T00:00:00Z",
  });
  estado.cliente = cenario.cliente;
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

const linhaAuditada = (acao: string) => vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === acao);
const settingsDa = (c: Cenario) => c.tabela("organizations").find((o) => o.id === ORG)!.settings as Linha;

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Quer agendar", passo: "qualified" },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("a lista: 69 ferramentas, e os tipos de ação seguem os do upstream", () => {
  it("as v1.87 e v1.88 não acrescentaram ferramenta (69)", () => {
    // A contagem total mora no teste da entrega mais nova (a cobrança da jornada,
    // .90: tests/unit/mcp-de-implantacao-cobranca.test.ts). Aqui fica o que as
    // v1.87 e v1.88 do upstream deixaram: nenhuma das 69 sumiu, tirando as cinco
    // do assistente da MIA (.88), as nove do e-mail marketing (.89) e as nove da
    // cobrança (.90).
    const daCobranca = new Set(FERRAMENTAS_DE_COBRANCA.map((f) => f.name));
    const doFork = FERRAMENTAS.filter(
      (f) => daCobranca.has(f.name) || /assistente|chamado|email|supressao|consentimentos|segmentos/.test(f.name),
    );
    expect(FERRAMENTAS.length - doFork.length).toBe(69);
  });

  it("⭐ os tipos de ação são EXATAMENTE os do upstream: a v1.88 trouxe `notify_team` (#2642)", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
    expect(TIPOS_DE_ACAO).toContain("notify_team");
  });
});

// ---------------------------------------------------------------------------
// 1.88 · a fonte reaproveita o card aberto do contato (0722, #3101)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_fonte_de_formulario · CAMPO NOVO `reaproveitar_card_aberto` (upstream 1.88, 0722)", () => {
  const FONTE = { nome: "Integração do site", destino: { funil: "Agendamentos", etapa: "Novo contato" } };

  async function comFonte() {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    return c;
  }

  it("fonte nova não nasce com ela, e sem a assinatura ela não liga (a frase da opção)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
    expect(await recusa(c, "plataforma_garantir_fonte_de_formulario", { ...FONTE, reaproveitar_card_aberto: true })).toContain(
      "Fonte nova não nasce reaproveitando o card aberto",
    );
    await ok(c, "plataforma_garantir_fonte_de_formulario", FONTE);
    expect(await recusa(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, reaproveitar_card_aberto: true })).toContain(
      "reaproveitar o card aberto do contato exige uma",
    );
    expect(c.tabela("webhook_sources")[0]!.reuse_open_lead_on_capture ?? false).toBe(false);
  });

  it("⭐ com a assinatura: liga, repetir responde ja_estava, desliga; a leitura devolve", async () => {
    const c = await comFonte();
    c.tabela("webhook_sources")[0]!.secret_encrypted = "cifra-ficticia";

    const liga = await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, reaproveitar_card_aberto: true });
    expect(c.tabela("webhook_sources")[0]).toMatchObject({ reuse_open_lead_on_capture: true });
    expect((liga.dados.fonte as Linha).reaproveitar_card_aberto).toBe(true);
    expect(linhaAuditada("webhook.source_updated")?.metadata).toMatchObject({ reuse_open_lead_on_capture: true, via: "mcp_plataforma" });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, reaproveitar_card_aberto: true })).dados.desfecho).toBe(
      "ja_estava",
    );
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_garantir_fonte_de_formulario", { nome: FONTE.nome, reaproveitar_card_aberto: false });
    expect(c.tabela("webhook_sources")[0]!.reuse_open_lead_on_capture).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1.87 e 1.88 · o atendimento: assinatura por agente, devolução à fila,
// telefone de ficha vazia e contato interno
// ---------------------------------------------------------------------------

describe("plataforma_configurar_atendimento · CAMPOS NOVOS das v1.87 e v1.88", () => {
  it("⭐ `assinatura.nome_de_cada_agente` grava `por_agente`, e mexer só no nome NÃO apaga a escolha (#3318)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", { assinatura: { ia: true, nome_da_ia: "Assistente", nome_de_cada_agente: true } });
    expect(settingsDa(c).assinatura_mensagens).toEqual({ humanos: false, ia: true, nome_ia: "Assistente", por_agente: true });

    // O pedido que só troca o nome mantém o gravado, como a rota desde a v1.88.
    const r = await ok(c, "plataforma_configurar_atendimento", { assinatura: { nome_da_ia: "Recepção" } });
    expect(settingsDa(c).assinatura_mensagens).toEqual({ humanos: false, ia: true, nome_ia: "Recepção", por_agente: true });
    expect(((r.dados.atendimento as Linha).assinatura as Linha).nome_de_cada_agente).toBe(true);
  });

  it("⭐ a devolução à fila da conversa do rodízio sem resposta grava `routing.unanswered_return_minutes`; null desliga (#2988)", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { modo: "round_robin", devolver_a_fila_sem_resposta_minutos: 30 });
    expect((settingsDa(c).routing as Linha).unanswered_return_minutes).toBe(30);
    expect(r.dados.mudancas).toContain("devolução à fila da conversa sem resposta");
    expect(linhaAuditada("routing.config_changed")?.metadata).toMatchObject({ devolver_a_fila_sem_resposta_minutos: 30 });

    // Outro ajuste do atendimento não desliga a devolução por omissão.
    await ok(c, "plataforma_configurar_atendimento", { visibilidade: "own" });
    expect((settingsDa(c).routing as Linha).unanswered_return_minutes).toBe(30);

    await ok(c, "plataforma_configurar_atendimento", { devolver_a_fila_sem_resposta_minutos: null });
    expect((settingsDa(c).routing as Linha).unanswered_return_minutes).toBeNull();
    expect(await recusa(c, "plataforma_configurar_atendimento", { devolver_a_fila_sem_resposta_minutos: 2 })).toBeTruthy();
  });

  it("⭐ o telefone de ficha vazia e as etiquetas de contato interno vão para `settings.crm`, sem pisar no resto do bloco", async () => {
    const c = await preparar();
    const org = c.tabela("organizations").find((o) => o.id === ORG)!;
    org.settings = { ...(org.settings as Linha), crm: { cliente_pela_agenda: true } };

    const r = await ok(c, "plataforma_configurar_atendimento", {
      telefone_de_ficha_vazia: true,
      etiquetas_de_contato_interno: ["Equipe", "Fornecedor"],
    });
    expect(settingsDa(c).crm).toMatchObject({ cliente_pela_agenda: true, telefone_de_ficha_vazia: true });
    expect(((settingsDa(c).crm as Linha).internal_contact_tags as string[]).length).toBe(2);
    expect(r.dados.atendimento).toMatchObject({ telefone_de_ficha_vazia: true });
    expect(linhaAuditada("crm.telefone_de_ficha_vazia_alterado")?.metadata).toMatchObject({ ligado: true, via: "mcp_plataforma" });
    expect(linhaAuditada("crm.tags_internas_alteradas")?.metadata).toMatchObject({ quantidade: 2, via: "mcp_plataforma" });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_configurar_atendimento", {
      telefone_de_ficha_vazia: true,
      etiquetas_de_contato_interno: ["Equipe", "Fornecedor"],
    });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_configurar_atendimento", { etiquetas_de_contato_interno: [] });
    expect((settingsDa(c).crm as Linha).internal_contact_tags).toEqual([]);
    expect((settingsDa(c).crm as Linha).telefone_de_ficha_vazia).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.87 · o filtro de palavras do agente passou a valer (#2696)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_agente · CAMPO NOVO `filtro_de_palavras` (upstream 1.87, #2696)", () => {
  const AGENTE = {
    nome: "Assistente",
    prompt: "Você é a assistente da Vita Odonto. Entenda o que a pessoa procura antes de oferecer um horário.",
    pacotes: ["vender"],
  };
  const filtrosDe = (c: Cenario) => (c.tabela("ai_agent_versions")[0]!.trigger_config as { filters: Linha }).filters;

  it("⭐ grava `keyword_regex` no rascunho, a leitura mostra, null tira, e a expressão que não compila é recusada", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, filtro_de_palavras: "orçamento|preço" });
    expect(filtrosDe(c).keyword_regex).toBe("orçamento|preço");

    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Assistente" });
    const agente = (lido.dados.agentes as Linha[])[0]!;
    expect(agente.filtro_de_palavras).toBe("orçamento|preço");
    expect((agente.versao_vigente as Linha).filtro_de_palavras).toBe("orçamento|preço");

    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", filtro_de_palavras: "orçamento|(preço" })).toContain(
      "não é uma expressão válida",
    );

    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", filtro_de_palavras: null });
    expect(filtrosDe(c).keyword_regex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 1.87 e 1.88 · as automações: operadores novos, "qualquer uma" e a mensagem
// para a equipe
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao · operadores novos, `combinar_condicoes` e `notify_team`", () => {
  it("⭐ grava o grupo `{ any: [...] }` com os operadores novos (sem valor no is_empty), e aceita a mensagem para a equipe", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_automacao", {
      nome: "Avisar a equipe do ganho",
      gatilho: "lead.won",
      combinar_condicoes: "qualquer",
      condicoes: [
        { field: "lead.tags", op: "not_contains", value: "teste" },
        { field: "lead.source", op: "is_empty" },
      ],
      acoes: [{ type: "notify_team", config: { canal: "whatsapp" } }],
    });
    const regra = c.tabela("automation_rules").find((r) => r.name === "Avisar a equipe do ganho")!;
    expect(regra.conditions).toEqual({
      any: [
        { field: "lead.tags", op: "not_contains", value: "teste" },
        { field: "lead.source", op: "is_empty", value: "" },
      ],
    });
    expect(regra.actions).toEqual([{ type: "notify_team", config: { canal: "whatsapp" } }]);
    expect(regra.is_active ?? false).toBe(false);
  });

  it("o e-mail para uma pessoa da equipe confere a pessoa contra a equipe (#2642)", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_automacao", {
      nome: "E-mail para quem não é da equipe",
      gatilho: "lead.won",
      acoes: [
        {
          type: "send_email",
          config: { destinatario: "membro_da_equipe", membro_id: "0b000000-0000-4000-8000-0000000000ff", assunto: "Ganho", corpo: "{{resumo}}" },
        },
      ],
    });
    expect(texto).toContain("não faz parte da equipe");
    await ok(c, "plataforma_garantir_automacao", {
      nome: "E-mail para a Ana",
      gatilho: "lead.won",
      acoes: [{ type: "send_email", config: { destinatario: "membro_da_equipe", membro_id: ANA.id, assunto: "Ganho", corpo: "{{resumo}}" } }],
    });
  });
});

// ---------------------------------------------------------------------------
// 1.87 · a agenda por serviço: o tipo nasce como serviço em rascunho (0716)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_tipos_de_agendamento · CAMPO NOVO `servico_em_rascunho` (upstream 1.87, 0716)", () => {
  const TIPO = { nome: "Aula experimental", categoria: "outro", duracao_minutos: 60, local: "in_person" };

  it("⭐ o tipo novo nasce serviço, desativado e sem responsável; a leitura mostra; tipo que já existe não vira serviço por aqui", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, servico_em_rascunho: true }] });
    expect(c.tabela("calendar_event_types").find((t) => t.name === TIPO.nome)).toMatchObject({
      service_enabled: true,
      is_active: false,
      default_owner_user_id: null,
    });
    expect(JSON.stringify(r.dados.avisos)).toContain("SERVIÇO EM RASCUNHO");

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["agenda"] });
    const tipo = ((lido.dados.agenda as Linha).tipos as Linha[]).find((t) => t.nome === TIPO.nome)!;
    expect(tipo.servico).toMatchObject({ em_rascunho: true });

    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, nome: "Avaliação" }] });
    expect(
      await recusa(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, nome: "Avaliação", servico_em_rascunho: true }] }),
    ).toContain("Virar serviço é só na criação");
  });
});

// ---------------------------------------------------------------------------
// 1.87 e 1.88 · as receitas prontas do banco externo (0706)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_banco_externo · CAMPO NOVO `receitas` (upstream 1.87 e 1.88, 0706)", () => {
  async function comLoja(dbType = "mysql") {
    const c = await preparar();
    c.tabela("platform_config").push({ chave: "MODULO_BANCO_EXTERNO", valor: "ligado" });
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
      db_type: dbType,
      receitas: [],
    };
    c.tabela("external_db_connections").push(loja);
    c.tabela("external_db_connections_safe").push(loja);
    return c;
  }
  const RECEITA = { receita: "woocommerce-produtos", rotulo: "Produtos da loja", fixos: { prefixo: "wp_" } };

  it("⭐ grava a lista inteira, guarda o id na reexecução (ja_estava) e audita", async () => {
    const c = await comLoja();
    await ok(c, "plataforma_configurar_banco_externo", { conexao: "Loja do site", receitas: [RECEITA] });
    const gravadas = c.tabela("external_db_connections")[0]!.receitas as Linha[];
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({ receita: "woocommerce-produtos", rotulo: "Produtos da loja", ativa: true, fixos: { prefixo: "wp_" } });
    expect(linhaAuditada("external_db_recipes.updated")?.metadata).toMatchObject({ receitas: 1, ativas: 1, via: "mcp_plataforma" });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_banco_externo", { conexao: "Loja do site", receitas: [RECEITA] })).dados.desfecho).toBe(
      "ja_estava",
    );
    expect(c.banco.escritas.length).toBe(antes);
    expect((c.tabela("external_db_connections")[0]!.receitas as Linha[])[0]!.id).toBe(gravadas[0]!.id);

    await ok(c, "plataforma_configurar_banco_externo", { conexao: "Loja do site", receitas: [] });
    expect(c.tabela("external_db_connections")[0]!.receitas).toEqual([]);
  });

  it("recusas que ensinam: parâmetro fixo fora da régua da receita, e receita de outro motor", async () => {
    const c = await comLoja();
    expect(
      await recusa(c, "plataforma_configurar_banco_externo", {
        conexao: "Loja do site",
        receitas: [{ ...RECEITA, fixos: { prefixo: "wp_", inventado: true } }],
      }),
    ).toContain("não passou na régua da receita");

    const pg = await comLoja("postgres");
    expect(await recusa(pg, "plataforma_configurar_banco_externo", { conexao: "Loja do site", receitas: [RECEITA] })).toContain("roda em mysql");
    expect(pg.tabela("external_db_connections")[0]!.receitas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.88 · a ordem das respostas prontas (0729, #3244)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_respostas_prontas · a ORDEM das novas (upstream 1.88, 0729)", () => {
  it("⭐ as novas entram no TOPO, na ordem do pedido; a que já existe não muda de lugar", async () => {
    const c = await preparar();
    c.tabela("message_templates").push({
      id: randomUUID(),
      organization_id: ORG,
      owner_user_id: null,
      title: "Endereço",
      body: "Rua Fictícia, 100.",
      shortcut: null,
      midias: [],
      ordem: 1000,
      created_by_user_id: null,
      updated_at: "2026-10-01T00:00:00Z",
    });
    await ok(c, "plataforma_garantir_respostas_prontas", {
      respostas: [
        { titulo: "Boas-vindas", texto: "Olá! Como posso ajudar?" },
        { titulo: "Horários", texto: "Atendemos de segunda a sexta." },
        { titulo: "Endereço", texto: "Rua Fictícia, 100." },
      ],
    });
    const ordem = (titulo: string) => Number(c.tabela("message_templates").find((t) => t.title === titulo)!.ordem);
    expect(ordem("Boas-vindas")).toBeLessThan(ordem("Horários"));
    expect(ordem("Horários")).toBeLessThan(ordem("Endereço"));
    expect(ordem("Endereço")).toBe(1000);
  });
});

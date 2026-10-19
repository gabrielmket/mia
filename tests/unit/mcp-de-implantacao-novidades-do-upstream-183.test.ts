/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.81 A 1.83 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: toda peça nova ou alterada do sistema
 * que seja configuração de implantação ganha ferramenta ou campo no MCP na MESMA
 * versão, a .81).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-180.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta. Cada bloco
 * prova o que foi GRAVADO e em qual linha, que a REEXECUÇÃO não escreve, a
 * recusa que ensina e a leitura que devolve. A empresa de demonstração aparece
 * onde há saída para fora (e-mail, servidor externo).
 *
 * A CONTAGEM da lista mora no teste da versão mais nova
 * (`mcp-de-implantacao-novidades-do-upstream-185.test.ts`, .83: 68).
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados,
 * e-mails `@exemplo.invalid`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionSchema } from "@/lib/schemas/webhooks";
import {
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
  ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => {
  // Antes de qualquer import: `lib/env.ts` lê a chave que cifra a chave do servidor externo.
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  return { cliente: null as unknown, removidas: [] as string[][] };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
// O download das imagens: nenhuma rede. Cada endereço devolve uma "imagem" PNG
// diferente (a assinatura dos 8 primeiros bytes é a do PNG; o resto, o endereço).
vi.mock("@/lib/mcp-plataforma/importacao/download", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  baixarArquivoPublico: async (endereco: string) => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(endereco)]),
    nome: "imagem.png",
    tipo: "image/png",
  }),
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { TIPOS_DE_ACAO } = await import("@/lib/mcp-plataforma/ferramentas/automacoes-e-agenda");
const { audit } = await import("@/lib/audit");

async function preparar(opcoes: OpcoesDoCenario = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
  // O Storage também apaga (as imagens que saem da resposta pronta).
  Object.assign(cenario.cliente, {
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "guardado" }, error: null }),
        remove: async (caminhos: string[]) => {
          estado.removidas.push(caminhos);
          return { data: [], error: null };
        },
      }),
    },
  });
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

const chamadasDeAuditoria = () => vi.mocked(audit).mock.calls.map(([e]) => e);
const linhaAuditada = (acao: string) => chamadasDeAuditoria().find((e) => e.action === acao);

const SEGUNDO_NUMERO = "0e000000-0000-4000-8000-000000000002";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
  estado.removidas = [];
});

// ---------------------------------------------------------------------------

describe("a lista: a ferramenta da .81, e os tipos de ação são os do upstream", () => {
  it("a ferramenta nova do servidor MCP externo monta (implantar_configuracao)", () => {
    // A contagem mora no teste da versão mais nova (185); aqui fica só o que é da .81.
    expect(FERRAMENTAS.find((f) => f.name === "plataforma_configurar_servidor_mcp_externo")?.operacao).toBe("implantar_configuracao");
  });

  it("⭐ `send_email` (1.81) está entre os tipos de ação, e a lista continua sendo exatamente a do upstream", () => {
    const doUpstream = actionSchema.options.map((o) => (o.shape.type as unknown as { value: string }).value).sort();
    expect([...TIPOS_DE_ACAO].sort()).toEqual(doUpstream);
    expect(TIPOS_DE_ACAO).toContain("send_email");
  });

  it("o catálogo de modelos ensina o e-mail, o fluxo de atendimento, o telefone ganho e a continuação do ganho", async () => {
    const c = await preparar();
    // Leitura que não depende de cliente: sem `organization_id`.
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes"] });
    expect(r.erro, r.texto).toBe(false);
    const automacoes = r.dados.automacoes as Record<string, unknown>;
    const acoes = automacoes.acoes as Array<{ type: string; config: string }>;
    expect(acoes.find((a) => a.type === "send_email")?.config).toContain('"destinatario"');
    expect(acoes.find((a) => a.type === "start_message_flow")?.config).toContain('"surface"');
    expect(automacoes.gatilhos).toEqual(expect.arrayContaining(["contact.phone_added", "lead.won"]));
    expect(JSON.stringify(automacoes.gatilhos_de_contato)).toContain("contact.phone_added");
    expect(JSON.stringify(automacoes.gatilhos_de_desfecho_do_negocio)).toContain("excecao_do_ganho");
  });
});

describe("plataforma_garantir_automacao / plataforma_ligar_automacao · o e-mail (upstream 1.81, #2726)", () => {
  const EMAIL = { type: "send_email", config: { destinatario: "fixo", email_fixo: "time@exemplo.invalid", assunto: "Novo negócio", corpo: "Chegou {{nome}}." } };

  it("a regra com e-mail nasce desligada pela régua do upstream; na empresa de verdade, liga", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_automacao", { nome: "Avisar por e-mail", gatilho: "lead.created", acoes: [EMAIL] });
    // Nasce DESLIGADA: o insert não liga (o padrão da coluna é false).
    expect(c.tabela("automation_rules")[0]!.is_active).toBeFalsy();
    expect(c.tabela("automation_rules")[0]).toMatchObject({ actions: [EMAIL] });
    await ok(c, "plataforma_ligar_automacao", { regra: "Avisar por e-mail", ligada: true });
    expect(c.tabela("automation_rules")[0]!.is_active).toBe(true);
  });

  it("⭐ DEMONSTRAÇÃO: a regra com e-mail não liga, e a recusa vem antes do banco", async () => {
    const c = await preparar({ demonstracao: true });
    await ok(c, "plataforma_garantir_automacao", { nome: "Avisar por e-mail", gatilho: "lead.created", acoes: [EMAIL] });
    const texto = await recusa(c, "plataforma_ligar_automacao", { regra: "Avisar por e-mail", ligada: true });
    expect(texto).toContain("empresa de demonstração");
    expect(texto).toContain("um envio de e-mail");
    expect(c.tabela("automation_rules")[0]!.is_active).toBeFalsy();
  });

  it("o fluxo de ATENDIMENTO (`surface`) passa pela régua do upstream", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_automacao", {
      nome: "Roteiro",
      gatilho: "lead.created",
      acoes: [{ type: "start_message_flow", config: { flow_pointer_id: "0f000000-0000-4000-8000-0000000000aa", surface: "outra" } }],
    });
    expect(texto).toContain("acoes.0");
  });
});

describe("plataforma_garantir_tipos_de_agendamento · PASSOU A ALCANÇAR o canal do lembrete (upstream 1.83)", () => {
  function doisNumeros(c: Cenario) {
    c.tabela("channel_sessions").push({
      ...c.tabela("channel_sessions")[0]!,
      id: SEGUNDO_NUMERO,
      display_name: "Vendas",
      phone_number: "+5500900000002",
    });
  }

  it("grava o número do lembrete pelo nome; repetir não escreve; null volta ao automático; a leitura devolve", async () => {
    const c = await preparar({ comNumero: true });
    doisNumeros(c);
    const tipo = { nome: "Avaliação", categoria: "consulta", duracao_minutos: 40, local: "in_person" };
    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...tipo, canal_do_lembrete: "Vendas" }] });
    const linha = c.tabela("calendar_event_types").find((t) => t.name === "Avaliação")!;
    expect(linha.reminder_channel_session_id).toBe(SEGUNDO_NUMERO);

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...tipo, canal_do_lembrete: SEGUNDO_NUMERO }] });
    expect((de_novo.dados.tipos as Linha[])[0]!.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["agenda"] });
    expect(((lido.dados.agenda as Linha).tipos as Linha[]).find((t) => t.nome === "Avaliação")).toMatchObject({ canal_do_lembrete_id: SEGUNDO_NUMERO });

    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...tipo, canal_do_lembrete: null }] });
    expect(c.tabela("calendar_event_types").find((t) => t.name === "Avaliação")!.reminder_channel_session_id).toBeNull();
  });

  it("⭐ com 2 números e lembrete ligado sem canal, a resposta avisa do remetente ambíguo", async () => {
    const c = await preparar({ comNumero: true });
    doisNumeros(c);
    const tipo = { nome: "Retorno", categoria: "retorno", duracao_minutos: 30, local: "in_person" };
    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [tipo] });
    c.tabela("calendar_event_types").find((t) => t.name === "Retorno")!.reminder_enabled = true;
    const r = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [tipo] });
    expect(JSON.stringify(r.dados.avisos)).toContain("canal_do_lembrete");
    await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...tipo, canal_do_lembrete: "Recepção" }] });
    const sem = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [tipo] });
    expect(JSON.stringify(sem.dados.avisos)).not.toContain("«Retorno»");
  });

  it("conexão arquivada ou de outra empresa não serve: a recusa diz quais existem", async () => {
    const c = await preparar({ comNumero: true });
    const texto = await recusa(c, "plataforma_garantir_tipos_de_agendamento", {
      tipos: [{ nome: "Visita", categoria: "visita", duracao_minutos: 60, local: "in_person", canal_do_lembrete: "Número que não existe" }],
    });
    expect(texto).toContain("Não achei a conexão");
  });
});

describe("plataforma_configurar_atendimento · PASSOU A ALCANÇAR as duas opções da agenda (upstream 1.80 e 1.81)", () => {
  it("grava as chaves de TOPO como as funções do upstream, com a auditoria da tela; repetir não escreve; a leitura devolve", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { colegas_podem_mexer_na_agenda: false, google_meet_com_acesso_aberto: true });
    expect(r.dados.mudancas).toEqual(expect.arrayContaining(["colegas podem mexer na agenda", "Google Meet com acesso aberto"]));
    expect(c.tabela("organizations")[0]!.settings).toMatchObject({ colegas_podem_mexer_na_agenda: false, google_meet_acesso_aberto: true });
    expect(linhaAuditada("agenda.colegas_podem_mexer_alterado")?.metadata).toMatchObject({ ligado: false });
    expect(linhaAuditada("agenda.meet_acesso_aberto_alterado")?.metadata).toMatchObject({ ligado: true });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_atendimento", { colegas_podem_mexer_na_agenda: false })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect(lido.dados.atendimento).toMatchObject({ colegas_podem_mexer_na_agenda: false, google_meet_com_acesso_aberto: true });
  });

  it("empresa que nunca mexeu: os padrões (colegas ligado, Meet fechado) não escrevem", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { colegas_podem_mexer_na_agenda: true, google_meet_com_acesso_aberto: false });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
  });
});

describe("plataforma_configurar_banco_externo · PASSOU A ALCANÇAR as fontes liberadas (upstream 0618)", () => {
  const CONEXAO = "0f000000-0000-4000-8000-0000000000d1";
  const FONTE = { schema: "public", tabela: "pedidos", colunas: ["numero", "status"], descricao: "Pedidos do cliente" };
  function comConexao(c: Cenario) {
    c.tabela("platform_config").push({ chave: "MODULO_BANCO_EXTERNO", valor: "ligado" });
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
      source_mode: "list",
      sources: [],
      sources_count: 0,
    };
    c.tabela("external_db_connections").push(linha);
    c.tabela("external_db_connections_safe").push(linha);
  }

  it("grava o modo e a lista INTEIRA num UPDATE só, com a auditoria da tela; repetir não escreve", async () => {
    const c = await preparar();
    comConexao(c);
    const r = await ok(c, "plataforma_configurar_banco_externo", { conexao: "ERP da clínica", fontes_liberadas: { modo: "list", fontes: [FONTE] } });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", conexao: { fontes_liberadas: { modo: "list", quantas: 1 } } });
    const escrita = c.banco.escritas.find((e) => e.tabela === "external_db_connections")!;
    expect(escrita.payload).toEqual({ source_mode: "list", sources: [FONTE] });
    expect(linhaAuditada("external_db_sources.updated")?.metadata).toMatchObject({ source_mode: "list", fontes: 1 });
    expect(r.texto).not.toMatch(/banco\.exemplo\.invalid|senha-cifrada|leitor/);

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_banco_externo", { conexao: CONEXAO, fontes_liberadas: { modo: "list", fontes: [FONTE] } })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("fonte malformada e pedido vazio: recusas que ensinam", async () => {
    const c = await preparar();
    comConexao(c);
    expect(await recusa(c, "plataforma_configurar_banco_externo", { conexao: CONEXAO, fontes_liberadas: { modo: "list", fontes: [FONTE, FONTE] } })).toContain(
      "não passou na conferência",
    );
    expect(await recusa(c, "plataforma_configurar_banco_externo", { conexao: CONEXAO })).toContain("Informe ao menos um ajuste");
    expect(c.banco.escritas).toEqual([]);
  });
});

describe("plataforma_configurar_servidor_mcp_externo · FERRAMENTA NOVA (upstream v1.83)", () => {
  const ENDERECO = "https://erp.exemplo.com.br/mcp";
  const CHAVE = "chave-ficticia-do-erp-9876";

  it("grava o endereço no settings e a chave CIFRADA nas colunas; a chave não volta nem vai para a trilha; repetir não escreve", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_servidor_mcp_externo", { endereco: ENDERECO, chave: CHAVE });
    expect(r.dados).toMatchObject({ desfecho: "atualizou", servidor: { registrado: true, host: "erp.exemplo.com.br", chave_termina_em: "9876" } });
    const org = c.tabela("organizations")[0]!;
    expect(org.settings).toMatchObject({ mcp_externo: { endpoint: ENDERECO } });
    expect(JSON.stringify(org.settings)).not.toContain(CHAVE);
    expect(org.mcp_externo_chave_encrypted).toBeTruthy();
    expect(org.mcp_externo_chave_last4).toBe("9876");
    expect(r.texto).not.toContain(CHAVE);
    // Nenhuma linha de auditoria leva a chave: nem a da tela, nem a da execução do MCP.
    expect(JSON.stringify(chamadasDeAuditoria())).not.toContain(CHAVE);
    expect(linhaAuditada("org.mcp_externo_registrado")?.metadata).toMatchObject({ endpoint: "erp.exemplo.com.br", registrado: true });

    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_servidor_mcp_externo", { endereco: ENDERECO, chave: CHAVE })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_configurar_servidor_mcp_externo", { apagar: true });
    expect(c.tabela("organizations")[0]!.settings).not.toHaveProperty("mcp_externo");
    expect(c.tabela("organizations")[0]!.mcp_externo_chave_encrypted).toBeNull();
  });

  it("⭐ DEMONSTRAÇÃO: cadastrar é recusado antes do banco; apagar continua valendo", async () => {
    const c = await preparar({ demonstracao: true });
    expect(await recusa(c, "plataforma_configurar_servidor_mcp_externo", { endereco: ENDERECO, chave: CHAVE })).toContain("empresa de demonstração");
    expect(c.banco.escritas).toEqual([]);
    await ok(c, "plataforma_configurar_servidor_mcp_externo", { apagar: true });
  });

  it("endereço de rede interna ou com segredo colado é recusado; endereço sem chave também", async () => {
    const c = await preparar();
    expect(await recusa(c, "plataforma_configurar_servidor_mcp_externo", { endereco: "http://127.0.0.1:8080/mcp", chave: CHAVE })).toContain("recusado por segurança");
    expect(await recusa(c, "plataforma_configurar_servidor_mcp_externo", { endereco: ENDERECO })).toContain("`endereco` e `chave` juntos");
    expect(c.banco.escritas).toEqual([]);
  });
});

describe("plataforma_garantir_agente · PASSOU A ALCANÇAR o servidor MCP externo e a régua do par (upstream 1.81 a 1.83)", () => {
  const PROMPT = "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.";

  it("as ferramentas do servidor vão para o `tool_ids` do rascunho; trocar os pacotes não as apaga; o atendimento vai para o cadastro", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", {
      nome: "Bia",
      prompt: PROMPT,
      pacotes: ["vender"],
      servidor_mcp_externo: { ferramentas: [{ nome: "consultar_pedido" }, { nome: "abrir_chamado", leitura: false }], no_atendimento: true },
    });
    const versao = c.tabela("ai_agent_versions")[0]!;
    expect(versao.tool_ids).toEqual(expect.arrayContaining(["mcp_externo:leitura:consultar_pedido", "mcp_externo:escrita:abrir_chamado"]));
    expect((c.tabela("ai_agents")[0]!.config as Linha).mcp_externo_no_atendimento).toBe(true);

    await ok(c, "plataforma_garantir_agente", { nome: "Bia", pacotes: ["atender"] });
    expect(c.tabela("ai_agent_versions")[0]!.tool_ids).toEqual(expect.arrayContaining(["mcp_externo:leitura:consultar_pedido"]));

    await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidor_mcp_externo: { ferramentas: [] } });
    expect((c.tabela("ai_agent_versions")[0]!.tool_ids as string[]).some((id) => id.startsWith("mcp_externo:"))).toBe(false);
  });

  it("⭐ DEMONSTRAÇÃO: o agente não usa o servidor externo", async () => {
    const c = await preparar({ demonstracao: true });
    const texto = await recusa(c, "plataforma_garantir_agente", {
      nome: "Bia",
      prompt: PROMPT,
      servidor_mcp_externo: { ferramentas: [{ nome: "consultar_pedido" }] },
    });
    expect(texto).toContain("empresa de demonstração");
    expect(c.tabela("ai_agents")).toEqual([]);
  });

  it("⭐ #2955: a IA da plataforma com par cruzado (provedor de um, modelo de outro) é recusada antes de criar", async () => {
    const c = await preparar();
    c.tabela("platform_ia")[0]!.model_id = "claude-sonnet-5";
    c.tabela("ai_models")[0]!.model_id = "claude-sonnet-5";
    const texto = await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT });
    expect(texto).toContain("Nada foi criado");
    expect(c.tabela("ai_agents")).toEqual([]);
  });
});

describe("plataforma_importar_contatos · PASSOU A ALCANÇAR o sempre atendimento humano (upstream 0624)", () => {
  it("o contato novo nasce com a marca; o que já existe só GANHA a marca, nunca a perde; a auditoria é a da tela", async () => {
    const c = await preparar({}, [...TODAS_AS_OPERACOES, "importar_base"]);
    await ok(c, "plataforma_importar_contatos", {
      origem: "planilha",
      contatos: [{ nome: "Pessoa Exemplo", telefone: "(11) 99999-0001", sempre_atendimento_humano: true }],
    });
    expect(c.tabela("contacts")[0]).toMatchObject({ ai_opt_out: true });
    expect(linhaAuditada("contacts.always_human_marked")).toBeTruthy();

    await ok(c, "plataforma_importar_contatos", {
      origem: "planilha",
      quando_ja_existe: "atualizar",
      contatos: [{ nome: "Pessoa Exemplo", telefone: "(11) 99999-0001", sempre_atendimento_humano: false }],
    });
    expect(c.tabela("contacts")[0]!.ai_opt_out, "a importação tirou a marca").toBe(true);
  });
});

describe("plataforma_garantir_funil · PASSOU A ALCANÇAR o campo condicional (upstream 1.81, #2728)", () => {
  it("grava `mostrar_quando` no campo; campo que depende de quem não existe é recusado; null tira", async () => {
    const c = await preparar();
    const ETAPAS = [
      { nome: "Novo contato", passo: "new" },
      { nome: "Fechado", passo: "won" },
      { nome: "Perdido", passo: "lost" },
    ];
    const base = { nome: "Vendas", adotar_funil_padrao: true, etapas: ETAPAS };
    await ok(c, "plataforma_garantir_funil", {
      ...base,
      campos: [
        { key: "tem_convenio", label: "Tem convênio?", type: "boolean" },
        { key: "convenio", label: "Qual convênio", type: "text", mostrar_quando: { campo: "tem_convenio", operador: "igual", valor: true } },
      ],
    });
    const funil = c.tabela("crm_pipelines").find((f) => f.name === "Vendas")!;
    const campo = ((funil.settings as Linha).fields as Linha[]).find((f) => f.key === "convenio")!;
    expect(campo.mostrar_quando).toEqual({ campo: "tem_convenio", operador: "igual", valor: true });

    expect(
      await recusa(c, "plataforma_garantir_funil", {
        ...base,
        campos: [{ key: "plano", label: "Plano", type: "text", mostrar_quando: { campo: "nao_existe", operador: "igual", valor: "x" } }],
      }),
    ).toContain("não tem um campo com essa chave");

    await ok(c, "plataforma_garantir_funil", { ...base, campos: [{ key: "convenio", label: "Qual convênio", type: "text", mostrar_quando: null }] });
    const depois = ((c.tabela("crm_pipelines").find((f) => f.name === "Vendas")!.settings as Linha).fields as Linha[]).find((f) => f.key === "convenio")!;
    expect(depois).not.toHaveProperty("mostrar_quando");
  });
});

describe("plataforma_configurar_canal · PASSOU A ALCANÇAR o nome interno e o ajuste da pausa (upstream 1.81)", () => {
  function futuro(dias: number, hora: string): string {
    const d = new Date(Date.now() + dias * 86_400_000);
    return `${d.toISOString().slice(0, 10)}T${hora}`;
  }

  it("nome interno: grava `display_name` com a auditoria da rota; repetir não escreve", async () => {
    const c = await preparar({ comNumero: true });
    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", nome_interno: "WA | Recepção" });
    expect(r.dados.nome_interno).toEqual({ nome: "WA | Recepção", desfecho: "atualizou" });
    expect(c.tabela("channel_sessions")[0]!.display_name).toBe("WA | Recepção");
    expect(linhaAuditada("channel.renamed")?.metadata).toMatchObject({ previous_display_name: "Recepção", display_name: "WA | Recepção" });
    const antes = c.banco.escritas.length;
    expect((await ok(c, "plataforma_configurar_canal", { canal: NUMERO, nome_interno: "WA | Recepção" })).dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("ajustar a pausa que ainda não começou; a que já está pausando não se ajusta", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", pausa_agendada: { inicio: futuro(3, "23:00"), fim: futuro(4, "02:00") } });
    const agenda = c.tabela("channel_schedules")[0]!;
    const r = await ok(c, "plataforma_configurar_canal", { ajustar_pausa_agendada: { id: agenda.id, inicio: futuro(3, "22:00"), fim: futuro(4, "01:00") } });
    expect((r.dados.pausa_ajustada as Linha).desfecho).toBe("atualizou");
    expect(c.tabela("channel_schedules")[0]).toMatchObject({ starts_at: `${futuro(4, "01:00")}:00.000Z`, ends_at: `${futuro(4, "04:00")}:00.000Z` });
    expect(linhaAuditada("channel.schedule_updated")).toBeTruthy();

    c.tabela("channel_schedules")[0]!.status = "running";
    expect(
      await recusa(c, "plataforma_configurar_canal", { ajustar_pausa_agendada: { id: agenda.id, inicio: futuro(3, "21:00"), fim: futuro(4, "01:00") } }),
    ).toContain("ainda não começou");
  });
});

describe("plataforma_garantir_respostas_prontas · PASSOU A ALCANÇAR as imagens (upstream 1.81, #2526)", () => {
  const A = "https://imagens.exemplo.invalid/a.png";
  const B = "https://imagens.exemplo.invalid/b.png";

  it("sobe as imagens pelo conteúdo no prefixo do template; repetir não sobe de novo; a lista que fica tira a que saiu, do bucket depois da linha", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_respostas_prontas", { respostas: [{ titulo: "Cardápio", texto: "Segue o cardápio.", imagens: [A, B] }] });
    const resposta = c.tabela("message_templates")[0]!;
    const midias = resposta.midias as Array<{ storage_path: string; media_mime: string }>;
    expect(midias).toHaveLength(2);
    for (const m of midias) {
      expect(m.storage_path).toMatch(new RegExp(`^${ORG}/templates/${String(resposta.id)}/[0-9a-f-]{36}\\.png$`));
      expect(m.media_mime).toBe("image/png");
    }
    expect(linhaAuditada("template.media_added")?.metadata).toMatchObject({ total: 2 });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_respostas_prontas", { respostas: [{ titulo: "Cardápio", texto: "Segue o cardápio.", imagens: [A, B] }] });
    expect((de_novo.dados.respostas as Linha[])[0]!.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length).toBe(antes);

    await ok(c, "plataforma_garantir_respostas_prontas", { respostas: [{ titulo: "Cardápio", texto: "Segue o cardápio.", imagens: [B] }] });
    expect(c.tabela("message_templates")[0]!.midias).toHaveLength(1);
    expect(estado.removidas).toEqual([[midias[0]!.storage_path]]);

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["mensagens"] });
    expect(((lido.dados.mensagens as Linha).respostas_prontas as Linha[])[0]).toMatchObject({ titulo: "Cardápio", imagens: 1 });
  });

  it("mais de 5 imagens é recusado na conferência dos argumentos", async () => {
    const c = await preparar();
    const seis = Array.from({ length: 6 }, (_, i) => `https://imagens.exemplo.invalid/${i}.png`);
    await recusa(c, "plataforma_garantir_respostas_prontas", { respostas: [{ titulo: "Cardápio", texto: "Segue.", imagens: seis }] });
    expect(c.tabela("message_templates")).toEqual([]);
  });
});

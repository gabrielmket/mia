/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.70 A 1.73 AO ALCANCE DO MCP DE
 * PLATAFORMA (a regra do dono do produto: toda função nova ou alterada chega ao
 * MCP na mesma versão, inclusive a que vem do upstream).
 *
 * Um bloco por novidade, e cada um responde uma de duas perguntas:
 *
 *   JÁ ALCANÇAVA   o campo ou a caixa nova passa pela ferramenta que existia,
 *                  porque ela valida com o esquema do upstream. O teste é a prova.
 *   PASSOU A       a ferramenta ganhou o campo (ou nasceu): o que foi GRAVADO, em
 *   ALCANÇAR       qual linha; a REEXECUÇÃO (a segunda chamada não escreve); a
 *                  recusa que ensina; e a leitura que devolve o que foi gravado.
 *
 * O que se mede é o banco, não a resposta. As exigências comuns a toda
 * ferramenta (descrição, exemplo válido, operação no token, organização
 * inexistente) são medidas em `mcp-de-implantacao-ferramentas.test.ts`, que
 * percorre a lista inteira, as duas ferramentas novas incluídas.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  NUMERO,
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
// Nenhuma credencial de anúncio existe aqui: a leitura das conversões não decifra nada.
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => ({ ok: false, motivo: "sem_conexao" }) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { garantirCaixas, idDaCaixa } = await import("@/lib/implantacao/followup");
const { audit } = await import("@/lib/audit");

async function preparar(opcoes: OpcoesDoCenario = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

/** Chama e exige sucesso: um preparo que falhasse calado faria o teste medir outra coisa. */
async function ok(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

const acoesAuditadas = () => vi.mocked(audit).mock.calls.map(([e]) => e.action as string);

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Já respondi", passo: "contacted" },
  { nome: "Entendendo o caso", passo: "qualifying" },
  { nome: "Quer agendar", passo: "qualified" },
  { nome: "Escolhendo horário", passo: "negotiating" },
  { nome: "Sem resposta", passo: null },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];
const PROMPT = "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.";
const BIA = { nome: "Bia", prompt: PROMPT, pacotes: ["vender"], funis: ["Agendamentos"] };
const HORARIO = { inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5] };
const RETOMADA = "Retomada · voltar a quem parou de responder";

async function comFunil(opcoes: OpcoesDoCenario = {}, operacoes?: string[]) {
  const c = await preparar(opcoes, operacoes);
  await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
  return c;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("a lista: 56 ferramentas, as duas novas com a operação certa", () => {
  it("o roteador entrou com montar e ligar em operações separadas", () => {
    expect(FERRAMENTAS).toHaveLength(56);
    const operacao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.operacao;
    expect(operacao("plataforma_garantir_roteador")).toBe("implantar_configuracao");
    expect(operacao("plataforma_ligar_roteador")).toBe("colocar_no_ar");
  });
});

// ---------------------------------------------------------------------------
// 1.70 · Configurações › Atendimento: menor carga (#1711), espera da IA depois de
// resposta pelo celular (#2005) e quem fala em negrito (#2079)
// ---------------------------------------------------------------------------

describe("plataforma_configurar_atendimento · PASSOU A ALCANÇAR (upstream 1.70)", () => {
  const PEDIDO = {
    modo: "load",
    ia_espera_apos_resposta_pelo_celular_minutos: 15,
    assinatura: { atendentes: true, ia: true, nome_da_ia: "Assistente da Clínica" },
  };

  it("grava o modo por menor carga, a espera da IA e a assinatura, sem pisar nas outras chaves; repetir não escreve", async () => {
    const c = await preparar();
    c.tabela("organizations")[0]!.settings = { llm: { provider: "openai" }, tags: ["vip"] };
    const r = await ok(c, "plataforma_configurar_atendimento", PEDIDO);
    expect(r.dados.desfecho).toBe("atualizou");
    expect(r.dados.mudancas).toEqual(["modo de distribuição", "espera da IA depois de resposta pelo celular", "assinatura de quem fala"]);

    const settings = c.tabela("organizations")[0]!.settings as Linha;
    expect(settings.routing).toMatchObject({ mode: "load", manual_reply_silence_minutes: 15 });
    // A mesma chave e a mesma forma que `PATCH /api/v1/settings/assinatura` grava.
    expect(settings.assinatura_mensagens).toEqual({ humanos: true, ia: true, nome_ia: "Assistente da Clínica" });
    expect(settings.llm).toEqual({ provider: "openai" });
    expect(settings.tags).toEqual(["vip"]);
    // Cada metade deixa a linha de auditoria da rota dela.
    expect(acoesAuditadas()).toEqual(expect.arrayContaining(["routing.config_changed", "settings.message_signature_updated"]));

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_configurar_atendimento", PEDIDO);
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("a leitura e o checklist devolvem o que foi gravado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", PEDIDO);
    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["atendimento"] });
    expect(lido.dados.atendimento).toMatchObject({
      modo: "load",
      ia_espera_apos_resposta_pelo_celular_minutos: 15,
      assinatura: { atendentes: true, ia: true, nome_da_ia: "Assistente da Clínica" },
    });
    const checklist = await ok(c, "plataforma_ver_implantacao", {});
    const area = (checklist.dados.areas as Linha[]).find((a) => a.area === "atendimento")!;
    expect((area.pronto as string[]).join(" ")).toContain("por menor carga");
    expect((area.pronto as string[]).join(" ")).toContain("mostram quem fala");
    expect(area.dados).toMatchObject({ modo: "load", assinatura: { ia: true } });
  });

  it("só a chave da assinatura que veio muda, e a distribuição não é tocada", async () => {
    const c = await preparar();
    await ok(c, "plataforma_configurar_atendimento", PEDIDO);
    vi.mocked(audit).mockClear();
    const r = await ok(c, "plataforma_configurar_atendimento", { assinatura: { atendentes: false } });
    expect(r.dados.mudancas).toEqual(["assinatura de quem fala"]);
    const settings = c.tabela("organizations")[0]!.settings as Linha;
    expect(settings.assinatura_mensagens).toEqual({ humanos: false, ia: true, nome_ia: "Assistente da Clínica" });
    expect(settings.routing).toMatchObject({ mode: "load", manual_reply_silence_minutes: 15 });
    expect(acoesAuditadas().filter((a) => a !== "plataforma.mcp_executado")).toEqual(["settings.message_signature_updated"]);
  });

  it("organização que nunca ligou a assinatura não ganha a chave por um pedido que repete o padrão", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_configurar_atendimento", { assinatura: { atendentes: false, ia: false } });
    expect(r.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas).toEqual([]);
  });

  it("recusas que ensinam: nome da IA com asterisco, e modo que não existe", async () => {
    const c = await preparar();
    const nome = await c.mcp.chamar("plataforma_configurar_atendimento", {
      organization_id: ORG,
      assinatura: { ia: true, nome_da_ia: "*Assistente*" },
    });
    expect(nome.erro).toBe(true);
    expect(nome.texto).toContain("sem asterisco e sem quebra de linha");
    expect(nome.texto).toContain('"nome_da_ia": "Assistente Virtual"');

    const modo = await c.mcp.chamar("plataforma_configurar_atendimento", { organization_id: ORG, modo: "fila" });
    expect(modo.erro).toBe(true);
    expect(modo.texto).toContain('`modo` aceita só: "manual", "round_robin", "load"');
    expect(c.banco.escritas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.72 · aviso de fora do horário (#1926) e 1.71 · limiar de sentimento (#2216)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_agente · PASSOU A ALCANÇAR o aviso de fora do horário (upstream 1.72)", () => {
  const AVISO = "Recebemos sua mensagem. Nosso atendimento volta às 8h.";
  const horarioDe = (versao: Linha) =>
    ((versao.trigger_config as { filters: { business_hours: Linha | null } }).filters.business_hours ?? null) as Linha | null;

  it("grava o texto DENTRO do horário de atendimento do rascunho, onde o motor o lê; repetir não escreve", async () => {
    const c = await comFunil();
    const pedido = { ...BIA, horario_de_atendimento: HORARIO, aviso_fora_do_horario: AVISO };
    await ok(c, "plataforma_garantir_agente", pedido);
    expect(horarioDe(c.tabela("ai_agent_versions")[0]!)).toEqual({
      timezone: "America/Sao_Paulo",
      start: "08:00",
      end: "18:00",
      weekdays: [1, 2, 3, 4, 5],
      notice: AVISO,
    });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_agente", pedido);
    expect(de_novo.dados.versao).toMatchObject({ desfecho: "ja_estava", mudancas: [] });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Bia" });
    expect(((lido.dados.agentes as Linha[])[0]!.versao_vigente as Linha).aviso_fora_do_horario).toBe(AVISO);
  });

  it("⭐ trocar SÓ o horário preserva o aviso, inclusive o que uma pessoa gravou pela tela", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", { ...BIA, horario_de_atendimento: HORARIO });
    // A tela de gatilho do agente gravou o aviso direto na versão.
    const versao = c.tabela("ai_agent_versions")[0]!;
    horarioDe(versao)!.notice = "Texto escrito pela equipe na tela.";

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", horario_de_atendimento: { ...HORARIO, fim: "20:00" } });
    expect(r.dados.versao).toMatchObject({ desfecho: "atualizou", mudancas: ["horário de atendimento"] });
    expect(horarioDe(c.tabela("ai_agent_versions")[0]!)).toMatchObject({ end: "20:00", notice: "Texto escrito pela equipe na tela." });
  });

  it("trocar só o aviso não mexe na janela; null apaga", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", { ...BIA, horario_de_atendimento: HORARIO, aviso_fora_do_horario: AVISO });
    const troca = await ok(c, "plataforma_garantir_agente", { nome: "Bia", aviso_fora_do_horario: "Voltamos amanhã cedo." });
    expect(troca.dados.versao).toMatchObject({ desfecho: "atualizou", mudancas: ["aviso de fora do horário"] });
    expect(horarioDe(c.tabela("ai_agent_versions")[0]!)).toMatchObject({ start: "08:00", end: "18:00", notice: "Voltamos amanhã cedo." });

    await ok(c, "plataforma_garantir_agente", { nome: "Bia", aviso_fora_do_horario: null });
    expect(horarioDe(c.tabela("ai_agent_versions")[0]!)!.notice).toBeNull();
    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Bia" });
    expect(((lido.dados.agentes as Linha[])[0]!.versao_vigente as Linha).aviso_fora_do_horario).toBeNull();
  });

  it("aviso sem horário de atendimento: a recusa diz o que mandar junto, e o agente não nasce", async () => {
    const c = await comFunil();
    const r = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...BIA, aviso_fora_do_horario: AVISO });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("só existe para agente que tem horário de atendimento");
    expect(r.texto).toContain('"horario_de_atendimento"');
    expect(c.tabela("ai_agents")).toHaveLength(0);
  });

  it("aviso acima de 1000 caracteres é recusado na conferência dos argumentos", async () => {
    const c = await comFunil();
    const r = await c.mcp.chamar("plataforma_garantir_agente", {
      organization_id: ORG,
      ...BIA,
      horario_de_atendimento: HORARIO,
      aviso_fora_do_horario: "x".repeat(1001),
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("`aviso_fora_do_horario` aceita no máximo 1000 caracteres");
  });
});

describe("plataforma_garantir_agente · PASSOU A ALCANÇAR o limiar de sentimento (upstream 1.71)", () => {
  it("grava no CADASTRO do agente, com a mescla da tela (padrões + o que havia + o pedido); repetir não escreve", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    // Um ajuste que alguém fez pela tela no mesmo `config`.
    c.tabela("ai_agents")[0]!.config = { aceita_comandos_celular: true };

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", limiar_de_sentimento: 0.15 });
    expect(r.dados.agente).toMatchObject({ desfecho: "atualizou", mudancas: ["limiar de sentimento"] });
    // A versão não foi tocada: o limiar não é do rascunho.
    expect(r.dados.versao).toMatchObject({ desfecho: "ja_estava" });
    const config = c.tabela("ai_agents")[0]!.config as Linha;
    expect(config.sentiment_threshold).toBe(0.15);
    expect(config.aceita_comandos_celular, "a mescla apagou o ajuste que já existia").toBe(true);
    // Os padrões entram na mescla, como no PATCH da rota.
    expect(config.rag_top_k).toBeTypeOf("number");

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Bia", limiar_de_sentimento: 0.15 });
    expect(de_novo.dados.agente).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_agentes", {});
    expect((lido.dados.agentes as Linha[])[0]!.limiar_de_sentimento).toBe(0.15);
  });

  it("agente novo já nasce com o limiar pedido; o padrão (0,3) não escreve nada no cadastro", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", { ...BIA, limiar_de_sentimento: 0.5 });
    expect((c.tabela("ai_agents")[0]!.config as Linha).sentiment_threshold).toBe(0.5);

    await ok(c, "plataforma_garantir_agente", { ...BIA, nome: "Caio", limiar_de_sentimento: 0.3 });
    const caio = c.tabela("ai_agents").find((a) => a.name === "Caio")!;
    expect(caio.config, "o padrão virou chave gravada").toBeUndefined();
    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Caio" });
    expect((lido.dados.agentes as Linha[])[0]!.limiar_de_sentimento).toBe(0.3);
  });

  it("no agente NO AR o limiar vale na hora, e a resposta avisa", async () => {
    const c = await comFunil({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", BIA);
    await ok(c, "plataforma_publicar_agente", { agente: "Bia" });
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", limiar_de_sentimento: 0.2 });
    expect((r.dados.avisos as string[]).join(" ")).toContain("já vale para a próxima mensagem");
    // Nenhum rascunho novo nasceu por causa do limiar.
    expect(c.tabela("ai_agent_versions")).toHaveLength(1);
  });

  it("fora de 0 a 1: recusado antes de gravar", async () => {
    const c = await comFunil();
    const r = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, ...BIA, limiar_de_sentimento: 1.5 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("`limiar_de_sentimento` pode ser no máximo 1");
    expect(c.tabela("ai_agents")).toHaveLength(0);
  });
});

describe("agente novo · JÁ ALCANÇAVA: nasce no formato atual, com a versão 1 em rascunho (upstream 1.73)", () => {
  it("o espelho cria `mcp_agent` com a v1 `draft`, o mesmo que a rota passou a fazer para o corpo sem `version`", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    expect(c.tabela("ai_agents")[0]).toMatchObject({ kind: "mcp_agent", created_by: AUTOR });
    expect(c.tabela("ai_agent_versions")[0]).toMatchObject({ version_number: 1, status: "draft", agent_id: c.tabela("ai_agents")[0]!.id });
  });
});

// ---------------------------------------------------------------------------
// 1.70 · a janela de esfriando da etapa ganhou tela e régua (#2161)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_funil · a janela de esfriando vai pelo caminho da tela (upstream 1.70)", () => {
  const comPrazo = (horas: number | null) => ETAPAS.map((e) => (e.nome === "Escolhendo horário" ? { ...e, prazo_esperado_horas: horas } : e));
  const escolhendo = (c: Cenario) => c.tabela("crm_stages").find((e) => e.name === "Escolhendo horário")!;

  it("grava por `atualizarEtapa`, com a auditoria da tela de etapas; repetir não escreve; null volta ao padrão do radar", async () => {
    const c = await comFunil();
    vi.mocked(audit).mockClear();
    const r = await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", etapas: comPrazo(48) });
    expect((r.dados.etapas as Linha[]).find((e) => e.nome === "Escolhendo horário")).toMatchObject({ desfecho: "atualizou", mudancas: ["prazo esperado"] });
    expect(escolhendo(c).expected_duration_hours).toBe(48);
    // A escrita carrega a autoria que a operação da tela põe, e a linha de auditoria dela.
    const escrita = c.banco.escritas.filter((e) => e.tabela === "crm_stages").at(-1)!;
    expect(escrita.payload).toMatchObject({ expected_duration_hours: 48, last_change_actor_kind: "user" });
    const linha = vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === "pipeline.stage_updated");
    expect(linha, "a mudança da janela não deixou a auditoria da tela").toBeDefined();
    expect((linha!.metadata as { pedido: Linha }).pedido).toEqual({ expected_duration_hours: 48 });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", etapas: comPrazo(48) });
    expect((de_novo.dados.etapas as Linha[]).every((e) => e.desfecho === "ja_estava")).toBe(true);
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const lido = await ok(c, "plataforma_ver_funis", { funil: "Agendamentos" });
    const etapas = (lido.dados.funis as Array<{ etapas: Linha[] }>)[0]!.etapas;
    expect(etapas.find((e) => e.nome === "Escolhendo horário")!.prazo_esperado_horas).toBe(48);

    await ok(c, "plataforma_garantir_funil", { nome: "Agendamentos", etapas: comPrazo(null) });
    expect(escolhendo(c).expected_duration_hours).toBeNull();
  });

  it("a régua é a da tela: hora quebrada e fora de 1 a 8760 são recusadas, e nada é gravado", async () => {
    const c = await comFunil();
    const antes = c.banco.escritas.length;
    const quebrada = await c.mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", etapas: comPrazo(1.5) });
    expect(quebrada.erro).toBe(true);
    expect(quebrada.texto).toContain("prazo_esperado_horas");
    const demais = await c.mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", etapas: comPrazo(9000) });
    expect(demais.erro).toBe(true);
    expect(demais.texto).toContain("`etapas[4].prazo_esperado_horas` pode ser no máximo 8760");
    expect(c.banco.escritas.length).toBe(antes);
  });
});

// ---------------------------------------------------------------------------
// 1.70 · follow-up: caixas "mover lead no funil" e "editar tag do lead" (#2181),
// e os três parâmetros do gatilho de silêncio (#2037)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_followup · PASSOU A ALCANÇAR as caixas que mexem no negócio (upstream 1.70)", () => {
  type Grafo = { nodes: Array<Linha & { id: string; type: string; config: Linha }>; edges: Array<Linha & { source: string; target: string }> };
  const rascunho = (c: Cenario) => c.tabela("followup_flow_pointers")[0]!.draft_graph as Grafo;
  const CAIXAS = {
    nome: RETOMADA,
    mover_no_funil: [{ antes_de: "fim-esgotou", funil: "Agendamentos", etapa: "Sem resposta" }],
    etiquetar: [{ antes_de: "fim-esgotou", etiquetas: ["Follow-up sem resposta"] }],
  };

  async function instalado(opcoes: OpcoesDoCenario = {}) {
    const c = await comFunil(opcoes);
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    return c;
  }

  it("põe as duas caixas ANTES do fim «sem resposta», na forma do upstream; o fluxo publica; repetir não escreve", async () => {
    const c = await instalado();
    const semResposta = c.tabela("crm_stages").find((e) => e.name === "Sem resposta")!.id;
    const r = await ok(c, "plataforma_garantir_followup", CAIXAS);
    expect(r.dados.fluxo).toMatchObject({
      desfecho: "atualizou",
      mudancas: ["caixa de mover no funil antes de fim-esgotou", "caixa de etiquetar antes de fim-esgotou"],
    });

    const grafo = rascunho(c);
    const mover = grafo.nodes.find((n) => n.id === "mover-antes-de-fim-esgotou")!;
    const etiqueta = grafo.nodes.find((n) => n.id === "etiqueta-antes-de-fim-esgotou")!;
    expect(mover).toMatchObject({ type: "move_lead", label: "Mover card de etapa", config: { stage_id: semResposta } });
    expect(etiqueta).toMatchObject({ type: "edit_lead_tag", label: "Gravar tag no lead", config: { tags: ["Follow-up sem resposta"] } });
    // O caminho: quem chegava ao fim passa pelas duas caixas, e cada caixa segue por UMA seta `always`.
    const de = (id: string) => grafo.edges.filter((e) => e.source === id).map((e) => [e.target, (e.condition as Linha).type]);
    expect(grafo.edges.filter((e) => e.target === "mover-antes-de-fim-esgotou").map((e) => [e.source, (e.condition as Linha).branch_id])).toEqual([
      ["resposta-3", "no_reply"],
    ]);
    expect(de("mover-antes-de-fim-esgotou")).toEqual([["etiqueta-antes-de-fim-esgotou", "always"]]);
    expect(de("etiqueta-antes-de-fim-esgotou")).toEqual([["fim-esgotou", "always"]]);

    // ⭐ A forma é a do upstream, e a régua de publicação dele aceita o grafo.
    const lido = flowGraphSchema.safeParse(grafo);
    expect(lido.success, lido.success ? "" : JSON.stringify(lido.error.issues)).toBe(true);
    expect(validateFlowForPublish(lido.data!).ok).toBe(true);

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_followup", CAIXAS);
    expect((de_novo.dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
    expect(rascunho(c).nodes.filter((n) => n.type === "move_lead" || n.type === "edit_lead_tag")).toHaveLength(2);

    const publicado = await ok(c, "plataforma_publicar_followup", { fluxo: RETOMADA });
    expect(publicado.dados.desfecho).toBe("publicou");
  });

  it("instalar o modelo JÁ com as caixas dá o mesmo grafo, numa chamada só", async () => {
    const c = await comFunil();
    const r = await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada", ...CAIXAS });
    expect((r.dados.fluxo as Linha).desfecho).toBe("criou");
    expect(rascunho(c).nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["mover-antes-de-fim-esgotou", "etiqueta-antes-de-fim-esgotou"]));
    expect((r.dados.avisos as string[]).join(" ")).toContain("negócio MAIS RECENTE do contato que está no funil da etapa de destino");
  });

  it("a leitura devolve a etapa de destino pelo NOME, as etiquetas e as setas", async () => {
    const c = await instalado();
    await ok(c, "plataforma_garantir_followup", CAIXAS);
    const lido = await ok(c, "plataforma_ver_followup", { fluxo: RETOMADA });
    const nos = lido.dados.nos as Linha[];
    expect(nos.find((n) => n.no === "mover-antes-de-fim-esgotou")).toMatchObject({ tipo: "move_lead", etapa_de_destino: "Sem resposta" });
    expect(nos.find((n) => n.no === "etiqueta-antes-de-fim-esgotou")).toMatchObject({ tipo: "edit_lead_tag", etiquetas: ["Follow-up sem resposta"] });
    expect(lido.dados.setas).toEqual(expect.arrayContaining([{ de: "resposta-3", para: "mover-antes-de-fim-esgotou", quando: "ramo no_reply" }]));
  });

  it("trocar o destino de uma caixa que existe, e ajustar texto depois, não perdem a caixa", async () => {
    const c = await instalado();
    await ok(c, "plataforma_garantir_followup", CAIXAS);
    const naoVaiMarcar = c.tabela("crm_stages").find((e) => e.name === "Não vai marcar")!.id;

    const troca = await ok(c, "plataforma_garantir_followup", {
      nome: RETOMADA,
      mover_no_funil: [{ no: "mover-antes-de-fim-esgotou", funil: "Agendamentos", etapa: "Não vai marcar", rotulo: "Encerra sem resposta" }],
    });
    expect((troca.dados.fluxo as Linha).mudancas).toEqual(["destino de mover-antes-de-fim-esgotou"]);
    expect(rascunho(c).nodes.find((n) => n.id === "mover-antes-de-fim-esgotou")).toMatchObject({ label: "Encerra sem resposta", config: { stage_id: naoVaiMarcar } });

    await ok(c, "plataforma_garantir_followup", { nome: RETOMADA, textos: [{ no: "msg-1", texto: "Oi! Ficou alguma dúvida?" }] });
    const grafo = rascunho(c);
    expect(grafo.nodes.find((n) => n.id === "mover-antes-de-fim-esgotou")).toMatchObject({ config: { stage_id: naoVaiMarcar } });
    expect(grafo.nodes.find((n) => n.id === "etiqueta-antes-de-fim-esgotou")).toBeDefined();
  });

  it("⭐ caixa feita NA TELA e deixada sem destino: a publicação recusa pela régua do upstream, e a ferramenta a conserta pelo `no`", async () => {
    const c = await instalado();
    // O construtor grava a caixa nova com o destino vazio (o rascunho salva trabalho pela metade).
    const grafo = rascunho(c);
    grafo.nodes.push({ id: "node-tela-1", type: "move_lead", label: "Mover card de etapa", position: { x: 0, y: 400 }, config: { stage_id: "" } });
    for (const e of grafo.edges) if (e.target === "fim-esgotou") e.target = "node-tela-1";
    grafo.edges.push({ id: "tela-1", source: "node-tela-1", target: "fim-esgotou", priority: 0, condition: { type: "always" } });

    const recusa = await c.mcp.chamar("plataforma_publicar_followup", { organization_id: ORG, fluxo: RETOMADA });
    expect(recusa.erro).toBe(true);
    expect(recusa.texto).toContain("não tem etapa de destino");

    await ok(c, "plataforma_garantir_followup", { nome: RETOMADA, mover_no_funil: [{ no: "node-tela-1", funil: "Agendamentos", etapa: "Sem resposta" }] });
    expect((await ok(c, "plataforma_publicar_followup", { fluxo: RETOMADA })).dados.desfecho).toBe("publicou");
  });

  it("recusas que ensinam: nó que não existe, antes do início, `no` e `antes_de` juntos, etapa que não existe, e etiqueta vazia", async () => {
    const c = await instalado();
    const antes = c.banco.escritas.length;
    const chamar = (extra: Record<string, unknown>) => c.mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, nome: RETOMADA, ...extra });

    const semNo = await chamar({ etiquetar: [{ antes_de: "fim-que-nao-existe", etiquetas: ["x"] }] });
    expect(semNo.erro).toBe(true);
    expect(semNo.texto).toContain("o fluxo não tem um nó «fim-que-nao-existe»");
    expect(semNo.texto).toContain("fim-esgotou (end)");

    const inicio = await chamar({ etiquetar: [{ antes_de: "inicio", etiquetas: ["x"] }] });
    expect(inicio.texto).toContain("é o início do fluxo, e nada vem antes dele");

    const osDois = await chamar({ etiquetar: [{ no: "msg-1", antes_de: "fim-esgotou", etiquetas: ["x"] }] });
    expect(osDois.texto).toContain("OU `antes_de`");

    const tipoErrado = await chamar({ etiquetar: [{ no: "msg-1", etiquetas: ["x"] }] });
    expect(tipoErrado.texto).toContain("só ajusta caixa do tipo edit_lead_tag");

    const etapa = await chamar({ mover_no_funil: [{ antes_de: "fim-esgotou", funil: "Agendamentos", etapa: "Etapa fantasma" }] });
    expect(etapa.texto).toContain("não tem uma etapa chamada «Etapa fantasma»");
    expect(etapa.texto).toContain("«Sem resposta»");

    const vazia = await chamar({ etiquetar: [{ antes_de: "fim-esgotou", etiquetas: ["   "] }] });
    expect(vazia.texto).toContain("informe ao menos uma etiqueta com texto");

    expect(c.banco.escritas.length, "uma recusa gravou algo").toBe(antes);
  });

  it("a função pura: a caixa entra com a condição do ramo preservada, e o id é estável", () => {
    const grafo = flowGraphSchema.parse({
      nodes: [
        { id: "inicio", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
        { id: "fim", type: "end", label: "Fim", position: { x: 260, y: 0 }, config: { outcome: "exhausted" } },
      ],
      edges: [{ id: "a", source: "inicio", target: "fim", priority: 0, condition: { type: "always" } }],
    });
    const caixa = { tipo: "edit_lead_tag" as const, antes_de: "fim", config: { tags: ["Sem resposta"] } };
    const uma = garantirCaixas(grafo, [caixa]);
    expect(idDaCaixa("edit_lead_tag", "fim")).toBe("etiqueta-antes-de-fim");
    expect(uma.grafo.edges.map((e) => [e.source, e.target])).toEqual([["inicio", "etiqueta-antes-de-fim"], ["etiqueta-antes-de-fim", "fim"]]);
    // A caixa ocupa o lugar do fim, e o fim anda uma coluna.
    expect(uma.grafo.nodes.find((n) => n.id === "etiqueta-antes-de-fim")!.position).toEqual({ x: 260, y: 0 });
    expect(uma.grafo.nodes.find((n) => n.id === "fim")!.position.x).toBe(520);
    const duas = garantirCaixas(uma.grafo, [caixa]);
    expect(duas.mudancas).toEqual([]);
    expect(duas.grafo).toEqual(uma.grafo);
  });
});

describe("plataforma_garantir_followup · PASSOU A ALCANÇAR o gatilho de silêncio novo (upstream 1.70)", () => {
  const gatilho = (c: Cenario) => c.tabela("followup_flow_pointers")[0]!.trigger_config as { kind: string; params: Linha };

  it("grava o teto do silêncio, a pausa e a base da pausa como a tela grava; repetir não escreve", async () => {
    const c = await preparar();
    const pedido = {
      modelo: "geral-retomada",
      silencio_minutos: 30,
      silencio_maximo_minutos: 120,
      pausa_para_recomecar_minutos: 1440,
      pausa_conta_do_ultimo_envio: true,
    };
    await ok(c, "plataforma_garantir_followup", pedido);
    expect(gatilho(c)).toMatchObject({
      kind: "silence",
      params: { threshold_minutes: 30, max_silence_minutes: 120, reentry_pause_minutes: 1440, reentry_pause_basis: "ultimo_envio" },
    });

    const antes = c.banco.escritas.length;
    expect(((await ok(c, "plataforma_garantir_followup", pedido)).dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    // Pausa zero some com a chave, e leva a base junto; null tira o teto.
    const r = await ok(c, "plataforma_garantir_followup", { nome: RETOMADA, pausa_para_recomecar_minutos: 0, silencio_maximo_minutos: null });
    expect((r.dados.fluxo as Linha).mudancas).toEqual(["gatilho"]);
    expect(gatilho(c).params).toEqual({ threshold_minutes: 30 });
  });

  it("recusas que ensinam: teto que não passa do mínimo, base sem pausa, e fluxo que não dispara por silêncio", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_followup", { modelo: "geral-retomada" });
    const chamar = (extra: Record<string, unknown>) => c.mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, nome: RETOMADA, ...extra });

    // O modelo começa com 24 horas (1440 minutos) de silêncio.
    const teto = await chamar({ silencio_maximo_minutos: 600 });
    expect(teto.erro).toBe(true);
    expect(teto.texto).toContain("precisa ser MAIOR que o silêncio que começa o fluxo");
    expect(teto.texto).toContain("1440");

    const base = await chamar({ pausa_conta_do_ultimo_envio: true });
    expect(base.texto).toContain("este fluxo não tem pausa");

    await ok(c, "plataforma_garantir_followup", { modelo: "geral-agendamento", etapa: { funil: "Agendamentos", etapa: "Quer agendar" } });
    const outro = await c.mcp.chamar("plataforma_garantir_followup", {
      organization_id: ORG,
      nome: "Agendamento · marcar o próximo passo",
      pausa_para_recomecar_minutos: 60,
    });
    expect(outro.erro).toBe(true);
    expect(outro.texto).toContain("só vale para fluxo que dispara por silêncio");
  });
});

// ---------------------------------------------------------------------------
// 1.71 · gatilhos de ganho, perda, reabertura e troca de responsável (#2211), e
// 1.70 · campos do formulário nas mensagens (#2051)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao · JÁ ALCANÇAVA os gatilhos e as marcações novas (upstream 1.70 e 1.71)", () => {
  it.each(["lead.won", "lead.lost", "lead.reopened", "lead.assigned"])(
    "o webhook de saída com o gatilho %s é aceito, nasce desligado, e leva o responsável sob `include_owner`",
    async (gatilho) => {
      const c = await preparar();
      const r = await ok(c, "plataforma_garantir_automacao", {
        nome: `Avisar o faturamento · ${gatilho}`,
        gatilho,
        acoes: [{ type: "call_webhook", config: { url: "https://exemplo.invalid/gancho", include_owner: true } }],
      });
      expect((r.dados.regra as Linha).desfecho).toBe("criou");
      const escrita = c.banco.escritas.find((e) => e.tabela === "automation_rules")!;
      expect(escrita.payload).toMatchObject({ trigger_event: gatilho, actions: [{ type: "call_webhook", config: { include_owner: true } }] });
      expect(escrita.payload, "o insert não pode ligar a regra").not.toHaveProperty("is_active");
    },
  );

  it("⭐ nesses gatilhos, atribuir responsável ou mover o negócio é recusado com a frase do upstream (a regra se realimentaria)", async () => {
    const c = await preparar();
    for (const acao of [
      { type: "assign_owner", config: { user_id: AUTOR } },
      { type: "create_or_move_lead", config: { pipeline_id: FUNIL_SEMEADO, stage_id: c.tabela("crm_stages")[0]!.id } },
    ]) {
      const r = await c.mcp.chamar("plataforma_garantir_automacao", { organization_id: ORG, nome: "Laço", gatilho: "lead.assigned", acoes: [acao] });
      expect(r.erro, acao.type).toBe(true);
      expect(r.texto).toContain("a própria mudança dispararia a automação de novo");
    }
    expect(c.tabela("automation_rules")).toHaveLength(0);
  });

  it("a mensagem com o campo do formulário ({{servico}}) é gravada como veio", async () => {
    const c = await preparar({ comNumero: true });
    const modelo = "Olá, {{primeiro_nome}}! Recebemos seu pedido de {{servico}}.";
    await ok(c, "plataforma_garantir_automacao", {
      nome: "Confirmar o pedido do formulário",
      gatilho: "lead.created",
      acoes: [{ type: "send_whatsapp_message", config: { channel_session_id: NUMERO, template: modelo } }],
    });
    expect((c.tabela("automation_rules")[0]!.actions as Array<{ config: Linha }>)[0]!.config.template).toBe(modelo);
  });

  it("o catálogo de modelos ensina os gatilhos de desfecho e o que eles não aceitam", async () => {
    const c = await preparar();
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["automacoes", "empresa"] });
    expect(r.erro, r.texto).toBe(false);
    const automacoes = r.dados.automacoes as { gatilhos: string[]; gatilhos_de_desfecho_do_negocio: { quais: string[]; acoes_proibidas: string[] } };
    expect(automacoes.gatilhos).toEqual(expect.arrayContaining(["lead.won", "lead.lost", "lead.reopened", "lead.assigned"]));
    expect(automacoes.gatilhos_de_desfecho_do_negocio.quais).toEqual(["lead.won", "lead.lost", "lead.reopened", "lead.assigned"]);
    expect(automacoes.gatilhos_de_desfecho_do_negocio.acoes_proibidas).toEqual(["assign_owner", "create_or_move_lead"]);
    expect((r.dados.empresa as { modos_de_distribuicao: Array<{ modo: string }> }).modos_de_distribuicao.map((m) => m.modo)).toEqual(["manual", "round_robin", "load"]);
  });
});

// ---------------------------------------------------------------------------
// 1.73 · o catálogo se edita pela tela, com descrição e ativo (#2288), e a régua
// de campos obrigatórios por etapa (#2295)
// ---------------------------------------------------------------------------

describe("catálogo e campos do funil · JÁ ALCANÇAVA (upstream 1.70 e 1.73)", () => {
  it("`descricao` e `ativo` entram por plataforma_garantir_produtos e voltam em plataforma_ver_catalogo", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_produtos", {
      produtos: [{ codigo: "AVAL", nome: "Avaliação", descricao: "Primeira consulta, 40 minutos.", preco_cents: 8000, ativo: false }],
    });
    expect(c.tabela("catalog_products")[0]).toMatchObject({ descricao: "Primeira consulta, 40 minutos.", ativo: false });

    const troca = await ok(c, "plataforma_garantir_produtos", { produtos: [{ codigo: "AVAL", nome: "Avaliação", preco_cents: 8000, ativo: true }] });
    expect((troca.dados.itens as Linha[])[0]).toMatchObject({ desfecho: "atualizou", mudancas: ["ativo"] });
    const lido = await ok(c, "plataforma_ver_catalogo", {});
    expect((lido.dados.produtos as Linha[])[0]).toMatchObject({ descricao: "Primeira consulta, 40 minutos.", ativo: true, origem: "implantacao" });
  });

  it("o campo que o formulário de captação mandou vira campo do lead, com a obrigatoriedade por etapa, pela gravação da tela", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_funil", {
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: ETAPAS,
      // "servico" é a chave que o formulário manda: é o que o botão "Cadastrar como campo do lead" grava.
      campos: [{ key: "servico", label: "Serviço", type: "text", obrigatorio_em: { etapas: ["Quer agendar"], ao_ganhar: true } }],
    });
    const etapa = c.tabela("crm_stages").find((e) => e.name === "Quer agendar")!;
    const campos = (c.tabela("crm_pipelines")[0]!.settings as { fields: Linha[] }).fields;
    expect(campos).toEqual([
      { key: "servico", label: "Serviço", type: "text", obrigatorio_em: { etapas: [etapa.id], ao_ganhar: true } },
    ]);
    const lido = await ok(c, "plataforma_ver_funis", { funil: "Agendamentos" });
    expect((lido.dados.funis as Array<{ campos: Linha[] }>)[0]!.campos[0]).toMatchObject({ key: "servico" });
  });
});

// ---------------------------------------------------------------------------
// 1.73 · cada intenção do roteador pode levar o negócio para o funil certo (#2290)
// ---------------------------------------------------------------------------

describe("plataforma_garantir_roteador e plataforma_ligar_roteador · PASSOU A ALCANÇAR (upstream 1.73)", () => {
  const ROTEADOR = {
    nome: "Recepção",
    numero: "Recepção",
    agente_reserva: "Bia",
    intencoes: [
      { nome: "Marcar avaliação", descricao: "A pessoa quer agendar ou remarcar uma avaliação.", exemplos: ["tem horário amanhã?"], agente: "Bia" },
      {
        nome: "Plano empresarial",
        descricao: "A pessoa fala em nome de uma empresa e quer plano para os funcionários.",
        agente: "Caio",
        destino: { funil: "Empresas", etapa: "Proposta" },
      },
    ],
  };

  /** Dois agentes no mesmo número e dois funis: o cenário em que roteador faz sentido. */
  async function doisAgentes(publicar = true, operacoes?: string[]) {
    const c = await comFunil({ comNumero: true }, operacoes);
    await ok(c, "plataforma_garantir_funil", {
      nome: "Empresas",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Proposta", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Perdeu", passo: "lost" },
      ],
    });
    await ok(c, "plataforma_garantir_agente", BIA);
    await ok(c, "plataforma_garantir_agente", { ...BIA, nome: "Caio", funis: ["Empresas"] });
    if (publicar) {
      await ok(c, "plataforma_publicar_agente", { agente: "Bia" });
      await ok(c, "plataforma_publicar_agente", { agente: "Caio" });
    }
    return c;
  }
  const idDoAgente = (c: Cenario, nome: string) => c.tabela("ai_agents").find((a) => a.name === nome)!.id;

  it("monta o roteador DESLIGADO, com o classificador da plataforma e os nomes resolvidos em ids desta empresa", async () => {
    const c = await doisAgentes();
    const r = await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    expect(r.dados.roteador).toMatchObject({ nome: "Recepção", ligado: false, desfecho: "criou", agente_reserva: "Bia", numero: { id: NUMERO } });
    expect(r.dados.intencoes).toMatchObject({ desfecho: "criou", total: 2 });
    expect((r.dados.avisos as string[]).join(" ")).toContain("nasceu DESLIGADO");
    expect((r.dados.avisos as string[]).join(" ")).toContain("MOVE o negócio do cliente");

    const roteador = c.tabela("ai_routers")[0]!;
    expect(roteador).toMatchObject({
      organization_id: ORG,
      name: "Recepção",
      channel_session_id: NUMERO,
      // ⭐ Montar não põe no ar: a tela cria ligado, a ferramenta não.
      is_active: false,
      fallback_agent_id: idDoAgente(c, "Bia"),
      // O modelo do classificador é da plataforma: roteador novo nasce no "Automático".
      config: { classifier_model: null, classifier_provider: null },
      created_by: AUTOR,
    });

    const empresas = c.tabela("crm_pipelines").find((f) => f.name === "Empresas")!;
    const proposta = c.tabela("crm_stages").find((e) => e.pipeline_id === empresas.id && e.name === "Proposta")!;
    const intencoes = c.tabela("ai_router_members").sort((a, b) => Number(a.position) - Number(b.position));
    expect(intencoes.map((i) => [i.intent_name, i.agent_id, i.pipeline_id, i.stage_id, i.position])).toEqual([
      ["Marcar avaliação", idDoAgente(c, "Bia"), null, null, 0],
      ["Plano empresarial", idDoAgente(c, "Caio"), empresas.id, proposta.id, 1],
    ]);
    expect(intencoes.every((i) => i.organization_id === ORG && i.router_id === roteador.id)).toBe(true);
    expect(acoesAuditadas()).toEqual(expect.arrayContaining(["ai.router_created", "ai.router_members_updated"]));
  });

  it("REEXECUÇÃO: o mesmo pedido de novo não cria roteador nem regrava as intenções", async () => {
    const c = await doisAgentes();
    await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    const ids = c.tabela("ai_router_members").map((i) => i.id).sort();
    const antes = c.banco.escritas.length;

    const r = await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    expect(r.dados.roteador).toMatchObject({ desfecho: "ja_estava", mudancas: [] });
    expect(r.dados.intencoes).toMatchObject({ desfecho: "ja_estava" });
    expect(c.tabela("ai_routers")).toHaveLength(1);
    expect(c.tabela("ai_router_members").map((i) => i.id).sort(), "as intenções foram regravadas").toEqual(ids);
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("a leitura devolve o roteador com o agente e o destino de cada intenção pelo nome, e o checklist manda ligar", async () => {
    const c = await doisAgentes();
    await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    const lido = await ok(c, "plataforma_ver_agentes", {});
    expect(lido.dados.roteadores).toEqual([
      expect.objectContaining({
        nome: "Recepção",
        ligado: false,
        agente_reserva: "Bia",
        numero: expect.objectContaining({ id: NUMERO, conectado: true }),
        intencoes: [
          expect.objectContaining({ nome: "Marcar avaliação", agente: "Bia", destino: null }),
          expect.objectContaining({ nome: "Plano empresarial", agente: "Caio", destino: { funil: "Empresas", etapa: "Proposta" } }),
        ],
      }),
    ]);

    const checklist = await ok(c, "plataforma_ver_implantacao", {});
    const passos = (checklist.dados.proximos_passos as Array<{ area: string; o_que: string; como: string }>).filter((p) => p.area === "agentes");
    expect(passos).toEqual([expect.objectContaining({ o_que: expect.stringContaining("montado e desligado"), como: "plataforma_ligar_roteador." })]);
    // O checklist continua dizendo que os agentes estão no ar: o roteador não o derruba.
    expect(checklist.dados.resumo).toMatchObject({ pode_atender: true, agentes_no_ar: 2 });
  });

  it("dois agentes no mesmo número e nenhum roteador: o checklist aponta a ferramenta, e não mais a tela", async () => {
    const c = await doisAgentes();
    const checklist = await ok(c, "plataforma_ver_implantacao", {});
    const passos = (checklist.dados.proximos_passos as Array<{ area: string; o_que: string; como: string }>).filter((p) => p.area === "agentes");
    expect(passos).toEqual([expect.objectContaining({ o_que: expect.stringContaining("não há roteador"), como: expect.stringContaining("plataforma_garantir_roteador") })]);
    expect(checklist.dados.com_o_humano).toEqual([]);
  });

  it("LIGAR é pôr no ar: grava `is_active`, repetir responde `ja_estava`, e roteador ligado não é editado pela montagem", async () => {
    const c = await doisAgentes();
    await ok(c, "plataforma_garantir_roteador", ROTEADOR);

    const ligar = await ok(c, "plataforma_ligar_roteador", { roteador: "Recepção", ligado: true });
    expect(ligar.dados).toMatchObject({ desfecho: "atualizou", roteador: { ligado: true } });
    expect(c.tabela("ai_routers")[0]!.is_active).toBe(true);
    expect((await ok(c, "plataforma_ligar_roteador", { roteador: "Recepção", ligado: true })).dados.desfecho).toBe("ja_estava");

    const editar = await c.mcp.chamar("plataforma_garantir_roteador", {
      organization_id: ORG,
      ...ROTEADOR,
      intencoes: [ROTEADOR.intencoes[0]],
    });
    expect(editar.erro).toBe(true);
    expect(editar.texto).toContain("está LIGADO");
    expect(editar.texto).toContain("plataforma_ligar_roteador");
    expect(c.tabela("ai_router_members"), "a recusa mexeu nas intenções").toHaveLength(2);
    // O mesmo pedido que já está gravado continua respondendo `ja_estava`, mesmo ligado.
    expect((await ok(c, "plataforma_garantir_roteador", ROTEADOR)).dados.roteador).toMatchObject({ desfecho: "ja_estava", ligado: true });

    const desligar = await ok(c, "plataforma_ligar_roteador", { roteador: "Recepção", ligado: false });
    expect(desligar.dados).toMatchObject({ desfecho: "atualizou", roteador: { ligado: false } });
    const ajuste = await ok(c, "plataforma_garantir_roteador", { nome: "Recepção", intencoes: [ROTEADOR.intencoes[0]] });
    expect(ajuste.dados.intencoes).toMatchObject({ desfecho: "atualizou", total: 1, mudancas: ["intenção «Plano empresarial» removida"] });
  });

  it("token que só MONTA cria o roteador e não consegue ligá-lo", async () => {
    const c = await doisAgentes(false, ["implantar_configuracao"]);
    await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    const ligar = await c.mcp.chamar("plataforma_ligar_roteador", { organization_id: ORG, roteador: "Recepção", ligado: true });
    expect(ligar.erro).toBe(true);
    expect(ligar.texto).toContain('Este token não tem a operação "colocar_no_ar"');
    expect(c.tabela("ai_routers")[0]!.is_active).toBe(false);
  });

  it("ligar: roteador sem intenção e segundo roteador no mesmo número são recusados; agente fora do ar vira aviso", async () => {
    const c = await doisAgentes(false);
    await ok(c, "plataforma_garantir_roteador", { nome: "Vazio", numero: "Recepção" });
    const vazio = await c.mcp.chamar("plataforma_ligar_roteador", { organization_id: ORG, roteador: "Vazio", ligado: true });
    expect(vazio.erro).toBe(true);
    expect(vazio.texto).toContain("não tem intenção nenhuma");

    const montado = await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    expect((montado.dados.avisos as string[]).join(" ")).toContain("não estão no ar");
    const ligado = await ok(c, "plataforma_ligar_roteador", { roteador: "Recepção", ligado: true });
    expect((ligado.dados.avisos as string[]).join(" ")).toContain("cai no agente reserva");

    await ok(c, "plataforma_garantir_roteador", { nome: "Vazio", intencoes: [ROTEADOR.intencoes[0]] });
    const segundo = await c.mcp.chamar("plataforma_ligar_roteador", { organization_id: ORG, roteador: "Vazio", ligado: true });
    expect(segundo.erro).toBe(true);
    expect(segundo.texto).toContain("já tem um roteador ligado, «Recepção»");
    expect(c.tabela("ai_routers").find((r) => r.name === "Vazio")!.is_active).toBe(false);
  });

  it("recusas que ensinam: sem número, agente, funil e etapa que não existem, intenção repetida, e número trocado", async () => {
    const c = await doisAgentes();
    const chamar = (pedido: Record<string, unknown>) => c.mcp.chamar("plataforma_garantir_roteador", { organization_id: ORG, ...pedido });
    const com = (intencao: Record<string, unknown>) => chamar({ ...ROTEADOR, intencoes: [{ ...ROTEADOR.intencoes[1], ...intencao }] });

    const semNumero = await chamar({ nome: "Recepção", intencoes: ROTEADOR.intencoes });
    expect(semNumero.erro).toBe(true);
    expect(semNumero.texto).toContain("Roteador novo precisa de `numero`");
    expect(semNumero.texto).toContain("«Recepção»");

    expect((await com({ agente: "Agente fantasma" })).texto).toContain("Não achei o agente «Agente fantasma»");
    expect((await com({ destino: { funil: "Funil fantasma" } })).texto).toContain("Não achei o funil «Funil fantasma»");
    // A etapa é procurada DENTRO do funil de destino: «Quer agendar» é de outro funil.
    const etapa = await com({ destino: { funil: "Empresas", etapa: "Quer agendar" } });
    expect(etapa.texto).toContain("o funil «Empresas» não tem uma etapa chamada «Quer agendar»");
    expect(etapa.texto).toContain("«Proposta»");

    const repetida = await chamar({ ...ROTEADOR, intencoes: [ROTEADOR.intencoes[0], { ...ROTEADOR.intencoes[0], nome: "marcar avaliacao" }] });
    expect(repetida.texto).toContain("têm o mesmo nome");
    expect(c.tabela("ai_routers"), "uma recusa criou roteador").toHaveLength(0);

    // Funil de OUTRA organização com o mesmo nome não é alcançado.
    c.tabela("crm_pipelines").push({ id: "0f000000-0000-4000-8000-000000000009", organization_id: OUTRA_ORG, name: "Alheio", slug: "alheio", is_archived: false, position: 1 });
    expect((await com({ destino: { funil: "Alheio" } })).texto).toContain("Não achei o funil «Alheio»");

    await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    c.tabela("channel_sessions").push({ ...c.tabela("channel_sessions")[0]!, id: "0e000000-0000-4000-8000-000000000002", display_name: "Comercial", phone_number: "+5500900000002" });
    const outroNumero = await chamar({ ...ROTEADOR, numero: "Comercial" });
    expect(outroNumero.erro).toBe(true);
    expect(outroNumero.texto).toContain("o número de um roteador não se troca");
  });

  it("organização sem número conectado: a recusa diz que conectar é com uma pessoa", async () => {
    const c = await comFunil();
    await ok(c, "plataforma_garantir_agente", BIA);
    const r = await c.mcp.chamar("plataforma_garantir_roteador", {
      organization_id: ORG,
      nome: "Recepção",
      numero: "Recepção",
      intencoes: [ROTEADOR.intencoes[0]],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("ainda não tem número de WhatsApp conectado");
    expect(r.texto).toContain("/app/connections");
  });

  it("o roteiro de atendimento que uma pessoa amarrou pela tela é preservado na intenção de mesmo nome", async () => {
    const c = await doisAgentes();
    await ok(c, "plataforma_garantir_roteador", ROTEADOR);
    const roteiro = "0f000000-0000-4000-8000-0000000000f1";
    c.tabela("followup_flow_pointers").push({ id: roteiro, organization_id: ORG, name: "Cadastro", surface: "atendimento", status: "active" });
    c.tabela("ai_router_members").find((i) => i.intent_name === "Marcar avaliação")!.flow_pointer_id = roteiro;

    await ok(c, "plataforma_garantir_roteador", {
      nome: "Recepção",
      intencoes: [{ ...ROTEADOR.intencoes[0], descricao: "A pessoa quer agendar, remarcar ou cancelar uma avaliação." }, ROTEADOR.intencoes[1]],
    });
    const intencao = c.tabela("ai_router_members").find((i) => i.intent_name === "Marcar avaliação")!;
    expect(intencao).toMatchObject({ flow_pointer_id: roteiro, intent_description: "A pessoa quer agendar, remarcar ou cancelar uma avaliação." });
  });
});

// ---------------------------------------------------------------------------
// O que fica com a pessoa, e o checklist diz onde
// ---------------------------------------------------------------------------

describe("o que NÃO entra por ferramenta aparece no checklist, com a tela", () => {
  it("1.70 · a verificação em duas etapas por papel é regra de acesso: fica em Configurações › Segurança", async () => {
    const c = await preparar();
    c.tabela("organizations")[0]!.settings = { security: { mfa_required: true, mfa_required_min_role: "manager", mfa_grace_days: 7 } };
    const r = await ok(c, "plataforma_ver_implantacao", {});
    const equipe = (r.dados.areas as Linha[]).find((a) => a.area === "equipe")!;
    expect(equipe.so_pela_tela).toEqual(
      expect.arrayContaining([expect.objectContaining({ caminho: "/app/settings/security", situacao: "feito", quem: "cliente" })]),
    );
    expect((equipe.dados as Linha).verificacao_em_duas_etapas).toEqual({ exigida: true, a_partir_do_papel: "manager", dias_de_carencia: 7 });
    // Nenhuma ferramenta recebe a regra: o campo é desconhecido em configurar_empresa.
    const tentativa = await c.mcp.chamar("plataforma_configurar_empresa", { organization_id: ORG, mfa_required_min_role: "agent" });
    expect(tentativa.erro).toBe(true);
    expect(tentativa.texto).toContain("Campo desconhecido: `mfa_required_min_role`");
  });

  it("1.70 · a identidade da Meta (ID da Página) aparece na leitura das conversões e no checklist, e é preenchida pela pessoa", async () => {
    const c = await preparar();
    const antes = await ok(c, "plataforma_ver_conversoes", {});
    expect((antes.dados.conexoes as { identidade_da_meta: Linha }).identidade_da_meta).toMatchObject({ pagina_id: null, preenchida: false });

    c.tabela("organizations")[0]!.settings = { conversions: { meta_page_id: "100000000000001", meta_whatsapp_business_account_id: null } };
    const depois = await ok(c, "plataforma_ver_conversoes", {});
    expect((depois.dados.conexoes as { identidade_da_meta: Linha }).identidade_da_meta).toMatchObject({
      pagina_id: "100000000000001",
      conta_do_whatsapp_business_id: null,
      preenchida: true,
    });
    const checklist = await ok(c, "plataforma_ver_implantacao", {});
    const conversoes = (checklist.dados.areas as Linha[]).find((a) => a.area === "conversoes")!;
    expect(conversoes.so_pela_tela).toEqual(
      expect.arrayContaining([expect.objectContaining({ o_que: expect.stringContaining("ID da Página"), situacao: "feito", caminho: "/app/settings/conversoes" })]),
    );
    expect(conversoes.situacao).toBe("pronto");
  });
});

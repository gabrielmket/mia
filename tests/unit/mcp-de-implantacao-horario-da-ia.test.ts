/**
 * FORK MIA (.85) — o HORÁRIO DE ATENDIMENTO DA IA no MCP de plataforma.
 *
 * Toda função nova entra no MCP na mesma versão. Aqui se mede o banco, não a
 * resposta:
 *
 *   ENTRADA     `plataforma_garantir_agente` grava as faixas em
 *               `trigger_config.filters.horario_da_ia`, na forma canônica, e zera
 *               o `business_hours` do upstream; o formato antigo de uma faixa
 *               vira uma faixa; `null` tira; repetir não escreve.
 *   RECUSAS     zero faixas (com a frase da tela), a faixa que passa da
 *               meia-noite, mais de 6 faixas por dia.
 *   LEITURA     `plataforma_ver_agentes` devolve o horário da versão PUBLICADA,
 *               `ativa_agora`, `proxima_troca` e se o horário cai fora da janela
 *               de resposta do número.
 *   JANELA      `plataforma_configurar_canal` ganhou `janela_de_resposta`.
 *
 * Empresa fictícia, nomes inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_SEM_FAIXA } from "@/lib/agent-engine/agent/horario-da-ia";
import {
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
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
const { audit } = await import("@/lib/audit");

async function preparar(opcoes: OpcoesDoCenario = {}) {
  const cenario = cenarioDaImplantacao(opcoes);
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

const PROMPT = "Você é a assistente da Vita Odonto. Entenda o que a pessoa procura antes de oferecer um horário.";
const AGENTE = { nome: "Assistente", prompt: PROMPT, pacotes: ["vender"] };
/** Seg a sex a IA até 10:00 e de 17:30 em diante; sábado até 10:00 e de 16:00; domingo o dia todo. */
const FAIXAS = [
  { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "10:00" },
  { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
  { dias: [6], inicio: "00:00", fim: "10:00" },
  { dias: [6], inicio: "16:00", fim: "24:00" },
  { dias: [0], inicio: "00:00", fim: "24:00" },
];
/** A forma canônica que o banco guarda: o sábado de manhã entra na faixa da semana. */
const GRAVADO = {
  fuso: "America/Sao_Paulo",
  faixas: [
    { dias: [1, 2, 3, 4, 5, 6], inicio: "00:00", fim: "10:00" },
    { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
    { dias: [6], inicio: "16:00", fim: "24:00" },
    { dias: [0], inicio: "00:00", fim: "24:00" },
  ],
};

const filtrosDe = (versao: Linha) => (versao.trigger_config as { filters: Linha }).filters;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("plataforma_garantir_agente · o horário de atendimento da IA (.85)", () => {
  it("grava as faixas na forma canônica, zera o horário antigo, e repetir não escreve", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: FAIXAS } });
    expect(r.dados.versao).toMatchObject({ desfecho: "criou" });
    const filtros = filtrosDe(c.tabela("ai_agent_versions")[0]!);
    expect(filtros.horario_da_ia).toEqual(GRAVADO);
    expect(filtros.business_hours ?? null).toBeNull();

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: FAIXAS } });
    expect(de_novo.dados.versao).toMatchObject({ desfecho: "ja_estava", mudancas: [] });
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
    // A mesma grade escrita de outro jeito (agrupada) também é "nada mudou".
    const agrupada = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", horario_de_atendimento: GRAVADO });
    expect(agrupada.dados.versao).toMatchObject({ desfecho: "ja_estava" });
  });

  it("o formato antigo de uma faixa vira uma faixa; sem fuso vale o da empresa, com fuso vale o pedido", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { inicio: "18:00", fim: "24:00", dias: [1, 2, 3, 4, 5] } });
    expect(filtrosDe(c.tabela("ai_agent_versions")[0]!).horario_da_ia).toEqual({
      fuso: "America/Sao_Paulo",
      faixas: [{ dias: [1, 2, 3, 4, 5], inicio: "18:00", fim: "24:00" }],
    });

    const r = await ok(c, "plataforma_garantir_agente", {
      nome: "Assistente",
      horario_de_atendimento: { inicio: "18:00", fim: "24:00", dias: [1, 2, 3, 4, 5], fuso: "America/Manaus" },
    });
    expect(r.dados.versao).toMatchObject({ desfecho: "atualizou", mudancas: ["horário de atendimento da IA"] });
    expect((filtrosDe(c.tabela("ai_agent_versions")[0]!).horario_da_ia as Linha).fuso).toBe("America/Manaus");
  });

  it("mudar só o prompt preserva o horário; null tira o horário", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: FAIXAS } });
    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", prompt: `${PROMPT} Seja breve.` });
    expect(filtrosDe(c.tabela("ai_agent_versions")[0]!).horario_da_ia).toEqual(GRAVADO);

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", horario_de_atendimento: null });
    expect(r.dados.versao).toMatchObject({ desfecho: "atualizou" });
    expect(filtrosDe(c.tabela("ai_agent_versions")[0]!).horario_da_ia ?? null).toBeNull();
  });

  it("zero faixas é recusado com a frase da tela, e o agente não nasce", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: [] } });
    expect(texto).toContain(MENSAGEM_SEM_FAIXA);
    expect(c.tabela("ai_agents")).toHaveLength(0);
  });

  it("a faixa que passa da meia-noite (também no formato antigo) é recusada: são duas", async () => {
    const c = await preparar();
    const antigo = await recusa(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { inicio: "22:00", fim: "02:00", dias: [5] } });
    expect(antigo).toContain("passa da meia-noite");
    expect(antigo).toContain('"24:00"');
    const novo = await recusa(c, "plataforma_garantir_agente", {
      ...AGENTE,
      horario_de_atendimento: { faixas: [{ dias: [5], inicio: "22:00", fim: "02:00" }] },
    });
    expect(novo).toContain("passa da meia-noite");
    expect(c.tabela("ai_agents")).toHaveLength(0);
  });

  it("mais de 6 faixas num dia é recusado; início 24:00 nem passa nos argumentos", async () => {
    const c = await preparar();
    const sete = Array.from({ length: 7 }, (_, i) => ({ dias: [3], inicio: `0${i}:00`, fim: `0${i}:30` }));
    expect(await recusa(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: sete } })).toContain("Até 6 faixas por dia");
    const inicio24 = await recusa(c, "plataforma_garantir_agente", {
      ...AGENTE,
      horario_de_atendimento: { faixas: [{ dias: [3], inicio: "24:00", fim: "24:00" }] },
    });
    expect(inicio24).toContain("horario_de_atendimento");
  });

  it("a descrição da ferramenta ensina a regra nova", () => {
    const garantir = FERRAMENTAS.find((f) => f.name === "plataforma_garantir_agente")!;
    const campo = (garantir.inputSchema.horario_de_atendimento as { description?: string }).description ?? "";
    for (const trecho of ["INATIVA", "24:00", "passa da meia-noite", "plataforma_pausar_agente", "formato antigo", "janela de RESPOSTA"]) {
      expect(campo, `a descrição de horario_de_atendimento não diz "${trecho}"`).toContain(trecho);
    }
  });
});

describe("plataforma_ver_agentes · o horário da IA que VALE agora (.85)", () => {
  /** Segunda, 2026-10-19, 11:00 em São Paulo: a recepção atende, a IA está inativa. */
  const SEGUNDA_11H = new Date("2026-10-19T11:00:00-03:00");

  async function publicado() {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: FAIXAS } });
    await ok(c, "plataforma_publicar_agente", { agente: "Assistente" });
    return c;
  }

  it("devolve as faixas publicadas, se está ativa, a próxima troca e que o horário cai fora da janela de resposta do número", async () => {
    const c = await publicado();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA_11H);
    const lido = await ok(c, "plataforma_ver_agentes", {});
    const agente = (lido.dados.agentes as Linha[])[0]!;
    expect(agente.horario_de_atendimento).toEqual({
      faixas: GRAVADO.faixas,
      fuso: "America/Sao_Paulo",
      ativa_agora: false,
      proxima_troca: { em: new Date("2026-10-19T17:30:00-03:00").toISOString(), texto: "hoje às 17:30", fica: "ativa" },
      // O padrão do número: responde das 7h às 22h, e a IA fica ativa de madrugada.
      janela_de_resposta_do_numero: { inicio_hora: 7, fim_hora: 22, domingo: true, fuso: "America/Sao_Paulo" },
      fora_da_janela_de_resposta_do_numero: true,
    });
  });

  it("o rascunho novo não muda o que vale: a leitura do agente segue a publicada, e a versão vigente mostra o rascunho", async () => {
    const c = await publicado();
    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", horario_de_atendimento: { faixas: [{ dias: [1], inicio: "08:00", fim: "09:00" }] } });
    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Assistente" });
    const agente = (lido.dados.agentes as Linha[])[0]!;
    expect((agente.horario_de_atendimento as Linha).faixas).toEqual(GRAVADO.faixas);
    expect((agente.versao_vigente as Linha).horario_de_atendimento).toEqual({
      fuso: "America/Sao_Paulo",
      faixas: [{ dias: [1], inicio: "08:00", fim: "09:00" }],
    });
  });

  it("sem horário: a IA responde a qualquer hora", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", AGENTE);
    await ok(c, "plataforma_publicar_agente", { agente: "Assistente" });
    const lido = await ok(c, "plataforma_ver_agentes", {});
    expect((lido.dados.agentes as Linha[])[0]!.horario_de_atendimento).toMatchObject({
      faixas: null,
      ativa_agora: true,
      proxima_troca: null,
      fora_da_janela_de_resposta_do_numero: null,
    });
  });
});

describe("plataforma_configurar_canal · a janela de RESPOSTA do número (.85)", () => {
  it("abre as respostas 24h só na janela de resposta; repetir não escreve; a leitura dos agentes deixa de avisar", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, horario_de_atendimento: { faixas: FAIXAS } });
    await ok(c, "plataforma_publicar_agente", { agente: "Assistente" });

    const r = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", janela_de_resposta: { inicio_hora: 0, fim_hora: 24 } });
    expect(r.dados).toMatchObject({
      desfecho: "atualizou",
      mudancas: ["janela de resposta"],
      janela_de_resposta: { inicio_hora: 0, fim_hora: 24, propria: true, desfecho: "atualizou" },
    });
    const linha = c.tabela("channel_knobs")[0]!;
    expect(linha).toMatchObject({ organization_id: ORG, channel_session_id: NUMERO, resposta_start_hour: 0, resposta_end_hour: 24 });
    // Só a resposta: a janela de disparo não foi gravada.
    expect(linha.window_start_hour ?? null).toBeNull();
    expect(vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === "ai.pacing_knobs_updated")).toMatchObject({
      resourceId: NUMERO,
      metadata: { resposta_start_hour: 0, resposta_end_hour: 24 },
    });

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_configurar_canal", { canal: NUMERO, janela_de_resposta: { inicio_hora: 0, fim_hora: 24 } });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(c.banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const agentes = await ok(c, "plataforma_ver_agentes", {});
    expect((agentes.dados.agentes as Linha[])[0]!.horario_de_atendimento).toMatchObject({
      janela_de_resposta_do_numero: { inicio_hora: 0, fim_hora: 24 },
      fora_da_janela_de_resposta_do_numero: false,
    });
    const canais = await ok(c, "plataforma_ver_configuracao", { secoes: ["canais"] });
    expect((canais.dados.canais as Linha[])[0]).toMatchObject({ janela_de_resposta: { inicio_hora: 0, fim_hora: 24, domingo: true } });
  });

  it("null volta a seguir a janela de disparo; a janela invertida é recusada", async () => {
    const c = await preparar({ comNumero: true });
    await ok(c, "plataforma_configurar_canal", { canal: "Recepção", janela_de_resposta: { inicio_hora: 6, fim_hora: 23 } });
    const volta = await ok(c, "plataforma_configurar_canal", { canal: "Recepção", janela_de_resposta: null });
    expect(volta.dados.janela_de_resposta).toMatchObject({ inicio_hora: 7, fim_hora: 22, propria: false, desfecho: "atualizou" });
    expect(c.tabela("channel_knobs")[0]).toMatchObject({ resposta_start_hour: null, resposta_end_hour: null });

    const invertida = await recusa(c, "plataforma_configurar_canal", { canal: "Recepção", janela_de_resposta: { inicio_hora: 22, fim_hora: 7 } });
    expect(invertida).toContain("termina antes de começar");
  });
});

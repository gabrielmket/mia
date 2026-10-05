/**
 * FORK MIA — O MODELO APROVADO DO FLUXO LEVA O PRIMEIRO NOME DO CONTATO.
 *
 * ## O que mudou
 *
 * Até a .60, o passo de fluxo que manda um modelo aprovado (e o plano B da
 * mensagem por IA) recusava QUALQUER modelo com variável: "o fluxo não tem de
 * onde tirar os valores". Um modelo "Olá {{1}}, ..." — o formato de quase toda
 * abordagem — não servia para follow-up.
 *
 * Agora o `{{1}}` (posicional) ou o primeiro parâmetro nomeado (`{{nome}}`) do
 * corpo leva o primeiro nome do contato, quando é a ÚNICA variável do modelo.
 * Sem nome: o texto neutro entra só se a amostra registrada na aprovação for
 * ele; senão o passo é pulado com o motivo. Qualquer outra variável continua
 * recusada. Regra em `lib/channels/meta/variavel-do-nome.ts`.
 *
 * ## O que este arquivo prende
 *
 * - posicional com nome, nomeado com nome: o canal recebe `values` na chave que
 *   o montador do envio lê, e a cadeia avalia o corpo JÁ com o nome;
 * - sem nome, os dois desfechos (amostra neutra entra; amostra de nome pula);
 * - nome que é telefone ou identificador técnico conta como sem nome;
 * - modelo com duas variáveis (ou variável fora do corpo) continua recusado;
 * - o plano B (`fallback_template_id`) preenche igual;
 * - o `components` que sai para a Meta é o do montador de sempre.
 *
 * ## O que NÃO prova
 *
 * Postgres real e a plataforma: que a Meta aceita o envio é do adapter.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type { createFollowupTurnHandler } from "@/lib/agent-engine/agent/followup-turn";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import { PROVIDERS_DE_MENSAGEM, capabilitiesOf } from "@/lib/channels/capabilities";
import { buildComponents } from "@/lib/channels/meta/build-components";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { variavelDoModelo } from "@/lib/channels/meta/variavel-do-nome";
import { primeiroNomeDoContato } from "@/lib/contacts/primeiro-nome";

const runBeforeSend = vi.fn(async (args: Record<string, unknown>) => {
  await (args.send as (b: string) => Promise<unknown>)(args.body as string);
  return { status: "sent", outcome: { kind: "sent" }, trace: [] };
});
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({ runBeforeSend }));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: vi.fn(async () => false) }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));
const runAgentTurn = vi.fn(async () => undefined);
vi.mock("@/lib/agent-engine/agent/inbound-turn", async (original) => ({
  ...(await original<typeof InboundTurn>()),
  runAgentTurn,
}));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({
  resultadoDoEnvioDoFollowup: vi.fn(async () => ({ kind: "sent" })),
}));

const ORG = "org-1";
const LEAD = "lead-1";
const CONVERSA = "conversa-1";
const CANAL = "canal-1";
const MODELO_ID = "22222222-2222-4222-8222-222222222222";
const HORA = 3_600_000;
/** Um canal com janela de 24 h, escolhido pela capacidade e não pelo nome. */
const PROVIDER_OFICIAL = PROVIDERS_DE_MENSAGEM.find((p) => capabilitiesOf(p).requiresTemplates)!;

const boundary = {
  organization_id: ORG,
  contact_id: LEAD,
  conversation_id: CONVERSA,
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
};

function job(payload: Record<string, unknown>): JobRow {
  return {
    id: "job-1",
    organization_id: ORG,
    contact_id: LEAD,
    kind: "followup_turn",
    source_event_id: null,
    payload: {
      followup_enrollment_id: "11111111-1111-4111-8111-111111111111",
      node_id: "passo",
      purpose: "send_message",
      ...payload,
      service_boundary: boundary,
    },
    status: "running",
    priority: 0,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    deferred_reason: null,
    locked_by: "w1",
    locked_at: new Date(),
    created_at: new Date(),
  } as JobRow;
}

interface Cenario {
  components: unknown[];
  parameterFormat?: "POSITIONAL" | "NAMED";
  /** a linha do contato; ausente = não achou */
  contato?: { name: string | null; display_name: string | null; is_anonymized?: boolean };
  ultimoInboundHa?: number;
}

function fakePool(c: Cenario) {
  const contatosConsultados: unknown[][] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> => {
    if (sql.includes("d.fechada_em::text")) return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    // A inscrição viva, no mesmo nó do job (upstream 1.72: o turno confere antes de qualquer efeito).
    if (sql.includes("select current_node_id, status from followup_enrollments")) {
      return { rows: [{ current_node_id: "passo", status: "active" }] };
    }
    if (/from meta_templates t/.test(sql)) {
      return { rows: [{ components: c.components, parameter_format: c.parameterFormat ?? "POSITIONAL", status: "APPROVED" }] };
    }
    if (/select name, language from meta_templates/.test(sql)) return { rows: [{ name: "abordagem", language: "pt_BR" }] };
    if (/from message_templates/.test(sql)) return { rows: [] };
    if (/from contacts/.test(sql)) {
      contatosConsultados.push(params ?? []);
      return { rows: c.contato ? [{ is_anonymized: false, ...c.contato }] : [] };
    }
    if (/from channel_sessions s/.test(sql)) {
      const ha = c.ultimoInboundHa ?? 72;
      return { rows: [{ provider: PROVIDER_OFICIAL, last_inbound_at: new Date(Date.now() - ha * HORA) }] };
    }
    if (/from conversations/.test(sql)) return { rows: [{ id: CONVERSA, channel_session_id: CANAL, archived_at: null }] };
    return { rows: [] };
  });
  return { pool: { query } as never, contatosConsultados };
}

function deps() {
  const send = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));
  const completeFollowupTurn = vi.fn(async () => undefined);
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crmCfg: {},
    llmCfg: {},
    knobs: {},
    channel: () => ({ send }),
    completeFollowupTurn,
  } as never;
  return { d, send, completeFollowupTurn };
}

function resultado(complete: ReturnType<typeof vi.fn>): { kind: string; reason?: string } {
  const entrada = (complete.mock.calls[0] as unknown[] | undefined)?.[1] as
    | { result: { kind: string; reason?: string } }
    | undefined;
  return entrada?.result ?? { kind: "(não chamou)" };
}

const corpo = (text: string, example?: unknown) => ({ type: "BODY", text, ...(example ? { example } : {}) });

const POSICIONAL = [corpo("Olá {{1}}, tudo bem? Vi seu interesse no Bosque.", { body_text: [["Maria"]] })];
const NOMEADO = [
  corpo("Oi {{nome}}! Separei as condições para você.", {
    body_text_named_params: [{ param_name: "nome", example: "João" }],
  }),
];
const NEUTRO = [corpo("Oi, {{1}}? Separei as condições para você.", { body_text: [["Tudo bem"]] })];

let criarHandler: typeof createFollowupTurnHandler;

beforeAll(async () => {
  ({ createFollowupTurnHandler: criarHandler } = await import("@/lib/agent-engine/agent/followup-turn"));
}, 60_000);

beforeEach(() => {
  runBeforeSend.mockClear();
  runAgentTurn.mockClear();
});

describe("passo `template` com a variável do nome", () => {
  it("⭐ posicional com nome: o {{1}} leva o primeiro nome, e a cadeia lê o corpo já preenchido", async () => {
    const { d, send, completeFollowupTurn } = deps();
    const { pool, contatosConsultados } = fakePool({
      components: POSICIONAL,
      contato: { name: "MARIA aparecida silva", display_name: "Mari 🌸" },
    });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(contatosConsultados[0]).toEqual([ORG, LEAD]);
    expect(send.mock.calls[0]![0].template).toEqual({ name: "abordagem", language: "pt_BR", values: { "1": "Maria" } });
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Olá Maria, tudo bem? Vi seu interesse no Bosque.");
    expect(runBeforeSend.mock.calls[0]![0].isTemplate).toBe(true);
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
  });

  it("⭐ nomeado com nome: o primeiro parâmetro nomeado leva o nome, pela chave dele", async () => {
    const { d, send } = deps();
    const { pool } = fakePool({
      components: NOMEADO,
      parameterFormat: "NAMED",
      contato: { name: null, display_name: "joão pedro" },
    });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(send.mock.calls[0]![0].template).toEqual({ name: "abordagem", language: "pt_BR", values: { nome: "João" } });
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Oi João! Separei as condições para você.");
  });

  it("⭐ sem nome, e a amostra do modelo é o texto neutro: sai com «tudo bem»", async () => {
    const { d, send, completeFollowupTurn } = deps();
    const { pool } = fakePool({ components: NEUTRO, contato: { name: null, display_name: null } });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(send.mock.calls[0]![0].template).toMatchObject({ values: { "1": "tudo bem" } });
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Oi, tudo bem? Separei as condições para você.");
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
  });

  it("⭐ sem nome, e a amostra é um nome: o passo é PULADO com o motivo, sem tocar na cadeia", async () => {
    const { d, send, completeFollowupTurn } = deps();
    const { pool } = fakePool({ components: POSICIONAL });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const r = resultado(completeFollowupTurn);
    expect(r.kind).toBe("skipped");
    expect(r.reason).toContain("não tem nome cadastrado");
    expect(r.reason).toContain("{{1}}");
  });

  it("nome que é telefone ou identificador técnico conta como sem nome", async () => {
    const { d, completeFollowupTurn } = deps();
    const { pool } = fakePool({
      components: POSICIONAL,
      contato: { name: "+55 31 99999-0000", display_name: "5531999990000@c.us" },
    });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn).kind).toBe("skipped");
  });

  it("⭐ modelo com DUAS variáveis continua recusado, e nem consulta o contato", async () => {
    const { d, completeFollowupTurn } = deps();
    const { pool, contatosConsultados } = fakePool({
      components: [corpo("Olá {{1}}, sua visita é {{2}}.", { body_text: [["Maria", "amanhã"]] })],
      contato: { name: "Maria", display_name: null },
    });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(contatosConsultados).toHaveLength(0);
    const r = resultado(completeFollowupTurn);
    expect(r.kind).toBe("skipped");
    expect(r.reason).toContain("variáveis que o fluxo não sabe preencher");
  });

  it("variável fora do corpo (cabeçalho) junto do {{1}}: recusado como antes", async () => {
    const { d, completeFollowupTurn } = deps();
    const { pool } = fakePool({
      components: [{ type: "HEADER", format: "TEXT", text: "Oferta {{1}}" }, corpo("Olá {{1}}")],
      contato: { name: "Maria", display_name: null },
    });
    await criarHandler(d)(job({ template_id: MODELO_ID }), pool, { workerId: "w1" });

    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn).kind).toBe("skipped");
  });
});

describe("plano B da mensagem por IA (`fallback_template_id`) com a variável do nome", () => {
  const PASSO_IA = { prompt_hint: "Retome a conversa", fallback_template_id: MODELO_ID };

  it("⭐ janela fechada: o modelo do plano B sai com o primeiro nome preenchido", async () => {
    const { d, send, completeFollowupTurn } = deps();
    const { pool } = fakePool({
      components: POSICIONAL,
      contato: { name: "Dra. ana paula", display_name: null },
      ultimoInboundHa: 30,
    });
    await criarHandler(d)(job(PASSO_IA), pool, { workerId: "w1" });

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(send.mock.calls[0]![0].template).toEqual({ name: "abordagem", language: "pt_BR", values: { "1": "Ana" } });
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Olá Ana, tudo bem? Vi seu interesse no Bosque.");
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
  });

  it("janela fechada e contato sem nome (amostra de nome): o plano B é pulado com o motivo, e a IA não roda", async () => {
    const { d, completeFollowupTurn } = deps();
    const { pool } = fakePool({ components: POSICIONAL, ultimoInboundHa: 30 });
    await criarHandler(d)(job(PASSO_IA), pool, { workerId: "w1" });

    expect(runAgentTurn).not.toHaveBeenCalled();
    const r = resultado(completeFollowupTurn);
    expect(r.kind).toBe("skipped");
    expect(r.reason).toContain("não tem nome cadastrado");
  });
});

describe("os valores viram o `components` que o envio da Meta já monta", () => {
  it("posicional: `{type:'body', parameters:[{type:'text', text}]}`", () => {
    const contrato = deriveTemplateContract({ name: "abordagem", language: "pt_BR", components: POSICIONAL as never });
    const v = variavelDoModelo(contrato, POSICIONAL);
    expect(v.tipo).toBe("nome");
    const chave = v.tipo === "nome" ? v.chave : "";
    expect(buildComponents(contrato, { [chave]: "Maria" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Maria" }] },
    ]);
  });

  it("nomeado: o parâmetro leva `parameter_name`", () => {
    const contrato = deriveTemplateContract({
      name: "abordagem",
      language: "pt_BR",
      parameter_format: "NAMED",
      components: NOMEADO as never,
    });
    const v = variavelDoModelo(contrato, NOMEADO);
    const chave = v.tipo === "nome" ? v.chave : "";
    expect(buildComponents(contrato, { [chave]: "João" })).toEqual([
      { type: "body", parameters: [{ type: "text", parameter_name: "nome", text: "João" }] },
    ]);
  });
});

describe("variavelDoModelo: o que conta como a variável do nome", () => {
  const contrato = (components: unknown[], parameter_format?: string) =>
    deriveTemplateContract({ name: "m", language: "pt_BR", ...(parameter_format ? { parameter_format } : {}), components: components as never });

  it("sem variável: nenhuma", () => {
    expect(variavelDoModelo(contrato([corpo("Oi!")]), [corpo("Oi!")]).tipo).toBe("nenhuma");
  });

  it("botão com URL dinâmica: outras", () => {
    const c = [corpo("Oi!"), { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.com/{{1}}" }] }];
    expect(variavelDoModelo(contrato(c), c).tipo).toBe("outras");
  });

  it("cabeçalho de mídia: outras", () => {
    const c = [{ type: "HEADER", format: "IMAGE" }, corpo("Olá {{1}}")];
    expect(variavelDoModelo(contrato(c), c).tipo).toBe("outras");
  });

  it("dois nomeados: outras (só o primeiro teria fonte)", () => {
    const c = [corpo("Oi {{nome}}, de {{cidade}}")];
    expect(variavelDoModelo(contrato(c, "NAMED"), c).tipo).toBe("outras");
  });

  it("nomeado com amostra neutra: aceita o texto neutro", () => {
    const c = [corpo("Oi, {{saudacao}}?", { body_text_named_params: [{ param_name: "saudacao", example: "tudo bem!" }] })];
    expect(variavelDoModelo(contrato(c, "NAMED"), c)).toEqual({
      tipo: "nome",
      chave: "saudacao",
      marcador: "{{saudacao}}",
      aceitaNeutro: true,
    });
  });

  it("sem amostra registrada: não aceita o neutro (na dúvida, pula)", () => {
    const c = [corpo("Oi, {{1}}?")];
    expect(variavelDoModelo(contrato(c), c)).toMatchObject({ tipo: "nome", aceitaNeutro: false });
  });
});

describe("primeiroNomeDoContato", () => {
  it.each([
    [{ name: "MARIA SILVA", display_name: null }, "Maria"],
    [{ name: "joão", display_name: null }, "João"],
    [{ name: "ana-maria souza", display_name: null }, "Ana-Maria"],
    [{ name: "McArthur Lima", display_name: null }, "McArthur"],
    [{ name: "Dr. Carlos", display_name: null }, "Carlos"],
    [{ name: "🌸 Bia", display_name: null }, "Bia"],
    [{ name: null, display_name: "Pedro Henrique" }, "Pedro"],
  ])("%j → %s", (c, esperado) => {
    expect(primeiroNomeDoContato(c)).toBe(esperado);
  });

  it.each([
    [{ name: null, display_name: null }],
    [{ name: "+55 31 99999-0000", display_name: null }],
    [{ name: "5531999990000", display_name: null }],
    [{ name: "Contato 5431", display_name: null }],
    [{ name: "Loja123", display_name: null }],
    [{ name: "Maria", display_name: null, is_anonymized: true }],
  ])("%j → sem nome", (c) => {
    expect(primeiroNomeDoContato(c)).toBeNull();
  });
});

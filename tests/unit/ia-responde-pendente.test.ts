/**
 * FORK MIA (.107) · A IA RESPONDE A MENSAGEM DO CLIENTE QUE FICOU PENDENTE.
 *
 * O caso (produção, 09/11/2026; aqui com dado FICTÍCIO): a equipe manda "ola"
 * pela tela, a IA fica calada 5 min, o cliente responde 21 s depois, o pedido de
 * turno é descartado pela elegibilidade e, quando o silêncio acaba, ninguém pede
 * o turno de novo. A conversa fica em "Automático" com o cliente esperando.
 *
 * Os testes medem por EFEITO: o `emit_event` que sai (ou não sai) para o banco
 * em memória, e o que fica gravado na conversa. Nenhum id, nome ou telefone
 * daqui existe fora deste arquivo.
 *
 * Mais o 2º caso (28 min depois, sem silêncio na conversa): o veto do turno
 * (`isLeadInHandoff`) contava o silêncio de OUTRA conversa do contato, noutro
 * número, assumida por uma pessoa. No turno de mensagem, conta só a desta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";
import {
  JANELA_DA_MENSAGEM_PENDENTE_MS,
  LIMITE_POR_RODADA,
  pedirTurnoDaMensagemPendente,
  selecionarFimDoSilencio,
  varrerFimDoSilencio,
  type ConversaDoFimDoSilencio,
} from "@/lib/escalacao/mensagem-pendente";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { explicarSilencioDaIa } from "@/lib/assistente/leituras/por-que-a-ia-nao-respondeu";
import { isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const RAIZ = join(__dirname, "..", "..");

// ── Dados fictícios ─────────────────────────────────────────────────────────
const ORG = "0f0f0f0f-1111-4111-8111-000000000001";
const CONV = "0f0f0f0f-2222-4222-8222-000000000002";
const CONTATO = "0f0f0f0f-3333-4333-8333-000000000003";
const NUMERO = "0f0f0f0f-4444-4444-8444-000000000004";
const PESSOA = "0f0f0f0f-5555-4555-8555-000000000005";
const ENTRADA = "0f0f0f0f-6666-4666-8666-000000000006";
const SAIDA = "0f0f0f0f-7777-4777-8777-000000000007";
const AGENTE = "0f0f0f0f-8888-4888-8888-000000000008";
const VERSAO = "0f0f0f0f-9999-4999-8999-000000000009";

const AGORA = new Date("2026-11-09T15:00:00.000Z");
const ha = (ms: number, base: Date = AGORA) => new Date(base.getTime() - ms).toISOString();
const daqui = (ms: number, base: Date = AGORA) => new Date(base.getTime() + ms).toISOString();
const MIN = 60_000;

/**
 * O caso real com dado fictício: "ola" pela tela 5 min atrás, o cliente
 * respondeu 21 s depois, o silêncio (5 min) venceu há 0 s, e o pedido original
 * foi consumido pelo drain (`done`, origem do canal).
 */
function cenario(ajuste: {
  conversa?: Partial<Linha>;
  contato?: Partial<Linha>;
  entrada?: Partial<Linha>;
  mensagensExtras?: Linha[];
  eventos?: Linha[];
  base?: Date;
} = {}) {
  const base = ajuste.base ?? AGORA;
  const ola = ha(5 * MIN, base);
  const resposta = ha(5 * MIN - 21_000, base);
  return bancoEmMemoria(
    {
      conversations: [
        {
          id: CONV,
          organization_id: ORG,
          contact_id: CONTATO,
          channel_session_id: NUMERO,
          is_group: false,
          assignee_kind: null,
          assigned_to_user_id: null,
          status: "open",
          bot_silenced_until: ha(0, base),
          last_inbound_at: resposta,
          last_outbound_at: ola,
          last_handoff_at: null,
          ...ajuste.conversa,
        },
      ],
      contacts: [
        {
          id: CONTATO,
          organization_id: ORG,
          is_blocked: false,
          is_personal: false,
          force_human: false,
          ai_opt_out: false,
          ...ajuste.contato,
        },
      ],
      messages: [
        {
          id: SAIDA,
          organization_id: ORG,
          conversation_id: CONV,
          direction: "outbound",
          type: "text",
          sent_via: "user",
          sent_by_user_id: PESSOA,
          sent_at: ola,
          created_at: ola,
          metadata: {},
        },
        {
          id: ENTRADA,
          organization_id: ORG,
          conversation_id: CONV,
          direction: "inbound",
          type: "text",
          sent_at: resposta,
          created_at: resposta,
          metadata: {},
          ...ajuste.entrada,
        },
        ...(ajuste.mensagensExtras ?? []),
      ],
      event_log: ajuste.eventos ?? [
        {
          id: "0f0f0f0f-aaaa-4aaa-8aaa-00000000000a",
          organization_id: ORG,
          event_type: "ai_agent.dispatch_requested",
          entity_kind: "message",
          entity_id: ENTRADA,
          status: "done",
          metadata: { source: "waha", request_id: "req-ficticio" },
        },
      ],
    },
    {
      // O `emit_event` de mentira grava a linha como o de verdade: é o que deixa
      // a segunda chamada ver a primeira.
      emit_event: (args, db) => {
        const linha = {
          id: `ev-${(db.event_log ??= []).length + 1}`,
          organization_id: args.p_organization_id,
          event_type: args.p_event_type,
          entity_kind: args.p_entity_kind,
          entity_id: args.p_entity_id,
          payload: args.p_payload,
          metadata: args.p_metadata,
          status: "pending",
        };
        db.event_log!.push(linha);
        return { data: linha.id, error: null };
      },
    },
  );
}

type Banco = ReturnType<typeof cenario>;

function pedidosDeTurno(banco: Banco) {
  return banco.chamadasRpc.filter(
    (c) => c.nome === "emit_event" && (c.args as { p_event_type?: string }).p_event_type === "ai_agent.dispatch_requested",
  );
}

async function pedir(banco: Banco, origem: "retomada_da_ia" | "fim_do_silencio" = "fim_do_silencio", agora = AGORA) {
  return pedirTurnoDaMensagemPendente(banco.cliente as never, {
    organizationId: ORG,
    conversationId: CONV,
    origem,
    requestId: "req-teste",
    agora,
  });
}

// ────────────────────────────────────────────────────────────────────────────
describe("A · pedirTurnoDaMensagemPendente", () => {
  it("pede o turno da última mensagem do cliente sem resposta, com o MESMO evento de pos-entrada", async () => {
    const banco = cenario();
    const r = await pedir(banco, "fim_do_silencio");
    expect(r).toEqual({ pediu: true, inboundMessageId: ENTRADA });

    const pedidos = pedidosDeTurno(banco);
    expect(pedidos).toHaveLength(1);
    const args = pedidos[0]!.args as Record<string, unknown>;
    expect(args.p_entity_kind).toBe("message");
    expect(args.p_entity_id).toBe(ENTRADA);
    expect(args.p_organization_id).toBe(ORG);
    // O payload de `pedirDespachoDoAgente` (pos-entrada.ts), campo a campo.
    expect(args.p_payload).toEqual({
      organization_id: ORG,
      conversation_id: CONV,
      contact_id: CONTATO,
      channel_session_id: NUMERO,
      inbound_message_id: ENTRADA,
    });
    expect((args.p_metadata as { source: string }).source).toBe("fim_do_silencio");
  });

  it("o payload tem as mesmas chaves que pos-entrada.ts emite (o consumidor é um só)", () => {
    const fonte = readFileSync(join(RAIZ, "lib/channels/pos-entrada.ts"), "utf8");
    const bloco = fonte.slice(fonte.indexOf('p_event_type: "ai_agent.dispatch_requested"'));
    const payload = bloco.slice(bloco.indexOf("p_payload: {"), bloco.indexOf("},", bloco.indexOf("p_payload: {")));
    for (const chave of ["organization_id", "conversation_id", "contact_id", "channel_session_id", "inbound_message_id"]) {
      expect(payload).toContain(`${chave}:`);
    }
  });

  const recusas: Array<[string, Parameters<typeof cenario>[0], string]> = [
    ["grupo", { conversa: { is_group: true } }, "grupo"],
    ["com uma pessoa atribuída", { conversa: { assignee_kind: "user", assigned_to_user_id: PESSOA } }, "com_pessoa"],
    ["silenciada agora (envio pela tela ainda valendo)", { conversa: { bot_silenced_until: daqui(3 * MIN) } }, "silenciada_agora"],
    ["silêncio infinito (handoff formal)", { conversa: { bot_silenced_until: "infinity" } }, "silenciada_agora"],
    ["conversa encerrada", { conversa: { status: "closed" } }, "conversa_encerrada"],
    ["contato bloqueado", { contato: { is_blocked: true } }, "contato_bloqueado"],
    ["contato pessoal", { contato: { is_personal: true } }, "contato_pessoal"],
    ["contato com force_human", { contato: { force_human: true } }, "force_human"],
    [
      // O mesmo caso, 27 min mais cedo: a resposta do cliente tem 31 min e pouco.
      "mensagem velha (mais de 30 min)",
      { base: new Date(AGORA.getTime() + 5 * MIN - 21_000 - JANELA_DA_MENSAGEM_PENDENTE_MS - MIN) },
      "mensagem_velha",
    ],
    ["a última do cliente é reação", { entrada: { type: "reaction" } }, "nao_e_fala"],
    ["histórico importado", { entrada: { metadata: { historico_importado: "true" } } }, "nao_e_fala"],
    [
      "já respondida (saída da IA depois dela)",
      {
        mensagensExtras: [
          {
            id: "0f0f0f0f-bbbb-4bbb-8bbb-00000000000b",
            organization_id: ORG,
            conversation_id: CONV,
            direction: "outbound",
            type: "text",
            sent_via: "ai",
            sent_at: ha(MIN),
            created_at: ha(MIN),
            metadata: {},
          },
        ],
      },
      "ja_respondida",
    ],
    [
      "o pedido original ainda está na fila do drain",
      {
        eventos: [
          {
            id: "ev-original",
            organization_id: ORG,
            event_type: "ai_agent.dispatch_requested",
            entity_kind: "message",
            entity_id: ENTRADA,
            status: "pending",
            metadata: { source: "waha" },
          },
        ],
      },
      "pedido_na_fila",
    ],
  ];

  it.each(recusas)("NÃO pede quando: %s", async (_nome, ajuste, motivo) => {
    const banco = cenario(ajuste);
    const r = await pedir(banco);
    expect(r).toEqual({ pediu: false, porque: motivo });
    expect(pedidosDeTurno(banco)).toHaveLength(0);
  });

  it("uma reação da equipe depois da mensagem NÃO conta como resposta", async () => {
    const banco = cenario({
      mensagensExtras: [
        {
          id: "0f0f0f0f-cccc-4ccc-8ccc-00000000000c",
          organization_id: ORG,
          conversation_id: CONV,
          direction: "outbound",
          type: "reaction",
          sent_via: "user",
          sent_at: ha(MIN),
          created_at: ha(MIN),
          metadata: {},
        },
      ],
    });
    expect((await pedir(banco)).pediu).toBe(true);
  });

  it("nunca pede duas vezes para a mesma mensagem (a devolução e a varredura batendo na mesma)", async () => {
    const banco = cenario();
    expect((await pedir(banco, "retomada_da_ia")).pediu).toBe(true);
    // O pedido acabou de ser drenado (`done`): não é a fila que segura, é a origem.
    for (const e of banco.db.event_log!) e.status = "done";
    expect(await pedir(banco, "fim_do_silencio")).toEqual({ pediu: false, porque: "ja_pedido" });
    expect(await pedir(banco, "retomada_da_ia")).toEqual({ pediu: false, porque: "ja_pedido" });
    expect(pedidosDeTurno(banco)).toHaveLength(1);
  });

  it("erro do banco não lança: devolve 'erro' e não pede", async () => {
    const banco = cenario();
    const quebrado = {
      ...banco.cliente,
      rpc: async () => ({ data: null, error: { message: "falha fictícia" } }),
    };
    const r = await pedirTurnoDaMensagemPendente(quebrado as never, {
      organizationId: ORG,
      conversationId: CONV,
      origem: "fim_do_silencio",
      requestId: "req-teste",
      agora: AGORA,
    });
    expect(r).toEqual({ pediu: false, porque: "erro" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("B · a devolução para a IA", () => {
  /** A retomada usa o relógio de verdade; o cenário nasce em volta dele. */
  function cenarioDaDevolucao(responder?: boolean) {
    const agora = new Date();
    // O "ola" foi 40 s atrás: os 5 min da tela ainda valem quando a pessoa devolve.
    const banco = cenario({
      base: new Date(agora.getTime() + 5 * MIN - 40_000),
      conversa: { bot_silenced_until: daqui(5 * MIN - 40_000, agora), status: "open" },
    });
    return { banco, responder };
  }

  it("zera o silêncio da tela e pede o turno da mensagem que chegou durante ele", async () => {
    const { banco } = cenarioDaDevolucao();
    const r = await devolverAtendimentoAoAgente(
      {
        supabase: banco.cliente as never,
        organizationId: ORG,
        actor: { type: "user", id: PESSOA, role: "agent" },
        requestId: "req-devolucao",
      },
      { conversationId: CONV },
    );
    expect(r.ok).toBe(true);
    const conversa = banco.db.conversations!.find((c) => c.id === CONV)!;
    expect(conversa.bot_silenced_until).toBeNull();
    expect(conversa.assignee_kind).toBe("ai");

    const pedidos = pedidosDeTurno(banco);
    expect(pedidos).toHaveLength(1);
    const args = pedidos[0]!.args as { p_entity_id: string; p_metadata: { source: string } };
    expect(args.p_entity_id).toBe(ENTRADA);
    expect(args.p_metadata.source).toBe("retomada_da_ia");
  });

  it("com responderPendente: false (fechar a conversa) devolve e NÃO pede o turno", async () => {
    const { banco } = cenarioDaDevolucao();
    const r = await devolverAtendimentoAoAgente(
      {
        supabase: banco.cliente as never,
        organizationId: ORG,
        actor: { type: "user", id: PESSOA, role: "agent" },
        requestId: "req-fechar",
      },
      { conversationId: CONV, responderPendente: false },
    );
    expect(r.ok).toBe(true);
    expect(pedidosDeTurno(banco)).toHaveLength(0);
  });

  it("as rotas que devolvem passam pela função: Liberar chama, fechar e handoff-tecnico pedem false", () => {
    const liberar = readFileSync(join(RAIZ, "app/api/v1/conversations/[id]/release/route.ts"), "utf8");
    expect(liberar).toMatch(/pedirTurnoDaMensagemPendente\(supabase, \{[^}]*origem: "retomada_da_ia"/);
    const fechar = readFileSync(join(RAIZ, "app/api/v1/conversations/[id]/close/route.ts"), "utf8");
    expect(fechar).toContain("responderPendente: false");
    const tecnico = readFileSync(join(RAIZ, "lib/escalacao/handoff-tecnico.ts"), "utf8");
    expect(tecnico).toContain("responderPendente: false");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("C · a varredura do fim do silêncio", () => {
  const linha = (id: string, fim: string | null, entrada: string | null, saida: string | null = null): ConversaDoFimDoSilencio => ({
    id,
    organization_id: ORG,
    bot_silenced_until: fim,
    last_inbound_at: entrada,
    last_outbound_at: saida,
  });

  it("pega só o silêncio que venceu nos últimos 15 min, com a mensagem chegada durante ele", () => {
    const escolhidas = selecionarFimDoSilencio(
      [
        linha("venceu-agora", ha(MIN), ha(3 * MIN), ha(5 * MIN)),
        linha("venceu-ha-20-min", ha(20 * MIN), ha(22 * MIN), ha(25 * MIN)),
        linha("infinito", "infinity", ha(3 * MIN)),
        linha("ainda-valendo", daqui(2 * MIN), ha(MIN)),
        linha("chegou-depois-do-fim", ha(3 * MIN), ha(MIN), ha(5 * MIN)),
        linha("ja-respondida", ha(MIN), ha(3 * MIN), ha(2 * MIN)),
        linha("mensagem-velha", ha(MIN), ha(31 * MIN), ha(40 * MIN)),
        linha("sem-silencio", null, ha(MIN)),
      ],
      AGORA,
    );
    expect(escolhidas.map((e) => e.conversa.id)).toEqual(["venceu-agora"]);
  });

  it("respeita o limite de 50 por rodada, do silêncio que venceu primeiro", () => {
    const muitas = Array.from({ length: 60 }, (_, i) =>
      linha(`c-${String(i).padStart(2, "0")}`, ha((i % 14) * MIN + 1000), ha(16 * MIN)),
    );
    const escolhidas = selecionarFimDoSilencio(muitas, AGORA);
    expect(escolhidas).toHaveLength(LIMITE_POR_RODADA);
    const fins = escolhidas.map((e) => e.fimDoSilencio.getTime());
    expect([...fins].sort((a, b) => a - b)).toEqual(fins);
  });

  it("de ponta a ponta no banco em memória: pede o turno do caso real e de nenhum outro", async () => {
    const banco = cenario();
    // Uma conversa com handoff formal (infinity) e mensagem recente, que NUNCA entra.
    banco.db.conversations!.push({
      id: "0f0f0f0f-dddd-4ddd-8ddd-00000000000d",
      organization_id: ORG,
      contact_id: CONTATO,
      channel_session_id: NUMERO,
      is_group: false,
      assignee_kind: null,
      status: "pending",
      bot_silenced_until: "infinity",
      last_inbound_at: ha(MIN),
      last_outbound_at: ha(10 * MIN),
    });
    const r = await varrerFimDoSilencio(banco.cliente as never, { requestId: "req-cron", agora: AGORA });
    expect(r).toEqual({ examinadas: 1, candidatas: 1, pedidas: 1, falhas: 0 });
    expect((pedidosDeTurno(banco)[0]!.args as { p_metadata: { source: string } }).p_metadata.source).toBe(
      "fim_do_silencio",
    );
    // A rodada seguinte não pede de novo.
    for (const e of banco.db.event_log!) e.status = "done";
    const segunda = await varrerFimDoSilencio(banco.cliente as never, {
      requestId: "req-cron-2",
      agora: new Date(AGORA.getTime() + MIN),
    });
    expect(segunda.pedidas).toBe(0);
    expect(pedidosDeTurno(banco)).toHaveLength(1);
  });

  it("o cron está no agendador, de minuto em minuto, e audita só com efeito", () => {
    const agendador = readFileSync(join(RAIZ, "docker/scheduler/entrypoint.sh"), "utf8");
    expect(agendador).toContain("* * * * *|60|api/v1/cron/ia-pendente");
    const rota = readFileSync(join(RAIZ, "app/api/v1/cron/ia-pendente/route.ts"), "utf8");
    expect(rota).toContain("autorizaCron(req)");
    expect(rota).toContain("if (resultado.pedidas > 0 || resultado.falhas > 0)");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D · o assistente explica", () => {
  /** O `.or(ilike)` da busca por nome não existe no banco em memória: a busca devolve o contato da org. */
  function clienteDoAssistente(tabelas: Record<string, Linha[]>) {
    const banco = bancoEmMemoria(tabelas);
    return {
      from: (nome: string) => {
        const q = banco.cliente.from(nome) as Record<string, unknown>;
        q.or = () => q;
        return q;
      },
    };
  }

  function tabelasDoAssistente(ajuste: { silencio?: string | null; metadataDoNumero?: Record<string, unknown> } = {}) {
    const ola = ha(5 * MIN);
    const resposta = ha(5 * MIN - 21_000);
    return {
      contacts: [
        {
          id: CONTATO,
          organization_id: ORG,
          name: "Cliente Fictício",
          display_name: null,
          is_anonymized: false,
          is_blocked: false,
          phone_number: "+5511900000001",
          ai_authorized_at: null,
        },
      ],
      conversations: [
        {
          id: CONV,
          organization_id: ORG,
          contact_id: CONTATO,
          status: "open",
          assigned_to_user_id: null,
          assigned_at: null,
          bot_silenced_until: ajuste.silencio === undefined ? ha(0) : ajuste.silencio,
          channel_session_id: NUMERO,
          active_ai_agent_id: null,
          last_inbound_at: resposta,
          last_outbound_at: ola,
          comando_da_conversa: "automatico",
        },
      ],
      messages: [
        { id: SAIDA, organization_id: ORG, conversation_id: CONV, direction: "outbound", sent_via: "user", sent_by_user_id: PESSOA, sent_at: ola },
        { id: ENTRADA, organization_id: ORG, conversation_id: CONV, direction: "inbound", sent_at: resposta },
      ],
      channel_sessions: [
        {
          id: NUMERO,
          organization_id: ORG,
          status: "WORKING",
          display_name: "Vendas Fictícia",
          last_status_change_at: null,
          metadata: ajuste.metadataDoNumero ?? {},
        },
      ],
      ai_agents: [
        {
          id: AGENTE,
          organization_id: ORG,
          name: "Agente Fictício",
          priority: 0,
          created_at: ha(30 * 24 * 60 * MIN),
          paused_at: null,
          published_version_id: VERSAO,
          archived_at: null,
        },
      ],
      ai_agent_versions: [{ id: VERSAO, organization_id: ORG, channel_session_id: NUMERO, trigger_config: {} }],
      agent_turn_traces: [],
    };
  }

  const explicar = (tabelas: Record<string, Linha[]>) =>
    explicarSilencioDaIa(clienteDoAssistente(tabelas) as never, {
      organizationId: ORG,
      contato: "Cliente Fictício",
      fuso: "America/Sao_Paulo",
      equipe: [],
      agora: AGORA,
    });

  it("o silêncio que já acabou sem a IA responder: diz isso e que agora ela responde sozinha", async () => {
    const r = await explicar(tabelasDoAssistente());
    expect(r.motivo).toBe("silencio_acabou_sem_resposta");
    expect(r.fatos.join(" ")).toContain("O silêncio acabou");
    expect(r.fatos.join(" ")).toContain("A partir desta versão (.107), a IA responde sozinha quando o silêncio acaba");
  });

  it("o silêncio ainda valendo continua sendo 'silenciada', e o infinito vira pausa sem data", async () => {
    const valendo = await explicar(tabelasDoAssistente({ silencio: daqui(3 * MIN) }));
    expect(valendo.motivo).toBe("ia_silenciada");
    const infinito = await explicar(tabelasDoAssistente({ silencio: "infinity" }));
    expect(infinito.motivo).toBe("ia_silenciada");
    expect(infinito.fatos.join(" ")).toContain("até alguém devolver a conversa para ela");
  });

  it("o número em modo de teste, com o contato fora da lista: diz que está em teste e onde se muda", async () => {
    const r = await explicar(
      tabelasDoAssistente({
        silencio: null,
        metadataDoNumero: { ai_gate: "allowlist", ai_gate_mode: "pre_go_live", ai_test_phone_numbers: ["+5511900000099"] },
      }),
    );
    expect(r.motivo).toBe("numero_em_teste");
    expect(r.fatos.join(" ")).toContain("está em modo de teste");
    expect(r.conserto).toContain("Conexões › o número › Configurar acesso da IA");
  });

  it("o número em teste com o contato NA lista não acusa o teste", async () => {
    const r = await explicar(
      tabelasDoAssistente({
        silencio: null,
        metadataDoNumero: { ai_gate: "allowlist", ai_gate_mode: "pre_go_live", ai_test_phone_numbers: ["+5511900000001"] },
      }),
    );
    expect(r.motivo).not.toBe("numero_em_teste");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("o 2º caso · o silêncio de OUTRA conversa do contato não cala o turno desta", () => {
  function poolQueGrava() {
    const chamadas: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        chamadas.push({ sql, params });
        return { rows: [{ handoff: false }] };
      },
    };
    return { pool, chamadas };
  }

  it("com a conversa, o veto só conta o silêncio dela; sem, segue a régua do lead", async () => {
    const { pool, chamadas } = poolQueGrava();
    await isLeadInHandoff(pool as never, ORG, CONTATO, CONV);
    await isLeadInHandoff(pool as never, ORG, CONTATO);
    expect(chamadas[0]!.params).toEqual([ORG, CONTATO, CONV]);
    expect(chamadas[1]!.params).toEqual([ORG, CONTATO, null]);
    // A forma do recorte: nulo = qualquer conversa do contato (follow-up, operador).
    expect(chamadas[0]!.sql).toMatch(/\(\$3::uuid is null or v\.id = \$3::uuid\)/);
    // As travas do CONTATO seguem valendo nos dois casos.
    expect(chamadas[0]!.sql).toContain("c.force_human");
    expect(chamadas[0]!.sql).toContain("or c.ai_opt_out");
  });

  it("os dois pontos do turno de mensagem passam a conversa", () => {
    const fonte = readFileSync(join(RAIZ, "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
    expect(fonte).toContain(
      "isLeadInHandoff(pool, job.organization_id, job.contact_id, payload.conversation_id)",
    );
    expect(fonte).toContain(
      "isLeadInHandoff(pool, tenantId, leadId, liveJob().kind === 'inbound_turn' ? input.conversationId : null)",
    );
  });
});

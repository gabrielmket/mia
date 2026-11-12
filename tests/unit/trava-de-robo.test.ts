/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ (docs/fork/trava-de-robo.md).
 *
 * O caso, com dado FICTÍCIO no formato do real: a cada mensagem nossa, o robô da
 * "Operadora Exemplo" responde "Olá." e um menu terminado em "_Mensagem enviada
 * pela inteligência artificial da Operadora Exemplo_". A IA responde, o robô
 * responde de novo, e o laço não para.
 *
 * Os testes medem a régua (pura) e o EFEITO, num banco em memória: o que fica
 * gravado no contato, nos negócios, nos follow-ups, na conversa e no registro.
 * Nenhum id, nome ou telefone daqui existe fora deste arquivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MensagemDaTrava } from "@/lib/trava-de-robo/deteccao";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("o teste injeta o banco; createAdminClient não pode ser chamado");
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { audit } = await import("@/lib/audit");
const { avaliarTrava, ehAutodeclaracaoDeAutomacao, MINIMO_DE_CARACTERES_DA_REPETICAO } = await import(
  "@/lib/trava-de-robo/deteccao"
);
const { CONFIG_PADRAO_DA_TRAVA, FAIXAS_DA_TRAVA, configDaLinha } = await import("@/lib/trava-de-robo/config");
const { aplicarTetoDeRespostas, aplicarTravaDeRobo } = await import("@/lib/trava-de-robo/aplicar");
const { avaliarETravarNoTurno } = await import("@/lib/trava-de-robo/no-turno");
const { contatoTravadoComoRobo } = await import("@/lib/trava-de-robo/etiqueta");
const textos = await import("@/lib/trava-de-robo/textos");
const { DICIONARIO } = await import("@/lib/i18n/dicionario");
const { devolverAtendimentoAoAgente } = await import("@/lib/escalacao/retomada");
const { isLeadInHandoff } = await import("@/lib/agent-engine/agent/human-handoff");

type Mensagem = MensagemDaTrava;

const RAIZ = join(__dirname, "..", "..");

// ── Dados fictícios ─────────────────────────────────────────────────────────
const ORG = "0a0b0c0d-1111-4111-8111-000000000108";
const CONV = "0a0b0c0d-2222-4222-8222-000000000108";
const CONTATO = "0a0b0c0d-3333-4333-8333-000000000108";
const FUNIL = "0a0b0c0d-4444-4444-8444-000000000108";
const ETAPA_ABERTA = "0a0b0c0d-5555-4555-8555-000000000108";
const ETAPA_PERDIDO = "0a0b0c0d-6666-4666-8666-000000000108";
const LEAD = "0a0b0c0d-7777-4777-8777-000000000108";
const JOB = "0a0b0c0d-8888-4888-8888-000000000108";
const PESSOA = "0a0b0c0d-9999-4999-8999-000000000108";

const AGORA = new Date("2026-11-12T15:00:00.000Z");
const SEG = 1000;
const MIN = 60 * SEG;
const em = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

const MENU_DA_OPERADORA = [
  "Olá! Bem-vindo ao atendimento da Operadora Exemplo.",
  "Escolha uma opção:",
  "1 - Planos e preços",
  "2 - Segunda via do boleto",
  "3 - Falar com um atendente",
  "",
  "_Mensagem enviada pela inteligência artificial da Operadora Exemplo_",
].join("\n");
const FRASES_CURTAS = "Eu entendo melhor frases mais curtas. Pode repetir de outro jeito?";

let seq = 0;
function msg(direcao: "inbound" | "outbound", sentVia: string | null, body: string, quando: number, extra: Partial<Mensagem> = {}): Mensagem {
  seq += 1;
  return {
    id: `0a0b0c0d-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    direction: direcao,
    sent_via: sentVia,
    type: "text",
    body,
    created_at: em(quando),
    ...extra,
  };
}
const daIa = (body: string, quando: number) => msg("outbound", "ai", body, quando);
const doContato = (body: string, quando: number) => msg("inbound", null, body, quando);
const daEquipe = (body: string, quando: number) => msg("outbound", "user", body, quando);

/** O laço: a IA fala, o robô manda "Olá." e o menu 2 e 3 segundos depois. Um giro a cada 30 s. */
function lacoDaOperadora(giros: number, inicio = -10 * MIN): Mensagem[] {
  const saida: Mensagem[] = [];
  for (let i = 0; i < giros; i += 1) {
    const t = inicio + i * 30 * SEG;
    saida.push(daIa(i === 0 ? "Boa tarde! Aqui é a Bia, da Clínica Exemplo. Posso ajudar?" : "Desculpe, não entendi. Pode me contar o que procura?", t));
    saida.push(doContato("Olá.", t + 2 * SEG));
    saida.push(doContato(MENU_DA_OPERADORA, t + 3 * SEG));
  }
  return saida;
}

const avaliar = (mensagens: Mensagem[], ajuste: Partial<typeof CONFIG_PADRAO_DA_TRAVA> = {}, desde: Date | null = null) =>
  avaliarTrava({ mensagens, config: { ...CONFIG_PADRAO_DA_TRAVA, ...ajuste }, agora: AGORA, desde });

beforeEach(() => {
  seq = 0;
  vi.mocked(audit).mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a régua: o laço da Operadora Exemplo", () => {
  it("não dispara no 1º nem no 2º giro, e dispara no 3º", () => {
    expect(avaliar(lacoDaOperadora(1)).dispara).toBeNull();
    expect(avaliar(lacoDaOperadora(2)).dispara).toBeNull();
    const r = avaliar(lacoDaOperadora(3));
    expect(r.dispara).toBe("robo");
    expect(r.mensagens_de_robo).toBe(3);
    expect(r.respostas_da_ia).toBe(3);
    // O "Olá." e o menu depois da MESMA resposta da IA contam um giro só.
    expect(r.sinais.every((s) => s.sinais.length > 0)).toBe(true);
    expect(r.sinais.flatMap((s) => s.sinais)).toContain("autodeclaracao");
    // 3 giros a cada 30 s: do primeiro menu ao último, 60 s.
    expect(r.duracao_segundos).toBe(60);
  });

  it("os sinais não carregam texto: só o id da mensagem e o nome do sinal", () => {
    const r = avaliar(lacoDaOperadora(3));
    expect(JSON.stringify(r.sinais)).not.toMatch(/Operadora|Olá/);
    for (const s of r.sinais) expect(s.sinais.every((n) => ["autodeclaracao", "repeticao", "velocidade"].includes(n))).toBe(true);
  });

  it("os giros fora da janela de 15 minutos não contam", () => {
    // 3 giros, mas os dois primeiros há mais de 15 minutos.
    const velhos = lacoDaOperadora(2, -40 * MIN);
    const novo = lacoDaOperadora(1, -2 * MIN);
    expect(avaliar([...velhos, ...novo]).dispara).toBeNull();
  });

  it("desligada, não dispara nada", () => {
    expect(avaliar(lacoDaOperadora(5), { ligada: false }).dispara).toBeNull();
  });

  it("o limite vem da configuração da empresa", () => {
    expect(avaliar(lacoDaOperadora(3), { mensagens_para_disparar: 4 }).dispara).toBeNull();
    expect(avaliar(lacoDaOperadora(4), { mensagens_para_disparar: 4 }).dispara).toBe("robo");
  });
});

describe("a régua: o que NÃO é laço", () => {
  it("a saudação automática ÚNICA de uma empresa não dispara (há gente por trás e não é laço)", () => {
    const conversa = [
      daIa("Boa tarde! Aqui é a Bia, da Clínica Exemplo. Posso ajudar?", -8 * MIN),
      doContato("Olá! Esta é uma mensagem automática. Obrigado pelo contato, em breve respondemos.", -8 * MIN + 2 * SEG),
      daIa("Obrigada! Fico no aguardo.", -8 * MIN + 30 * SEG),
      doContato("Oi, aqui é a Marta, do financeiro. Pode falar.", -5 * MIN),
      daIa("Oi, Marta! Queria entender como vocês fazem a cobrança hoje.", -5 * MIN + 30 * SEG),
      doContato("Hoje é tudo por boleto, manual.", -3 * MIN),
      daIa("Entendi. Posso te mostrar como fica no automático?", -3 * MIN + 30 * SEG),
      doContato("ok", -2 * MIN),
    ];
    const r = avaliar(conversa);
    expect(r.dispara).toBeNull();
    expect(r.mensagens_de_robo).toBe(1);
  });

  const RECLAMACOES = [
    "cansei de mensagem automática de vocês",
    "aqui é o bot de novo?",
    "não sou um robô",
    "não sou um robô, quero falar com gente",
    "esse assistente virtual não resolve nada",
    "essa mensagem é automática?",
    "a mensagem enviada pelo robô de vocês não ajudou",
    "Mensagem automática de vocês de novo",
    "Atendimento automático é horrível, quero uma pessoa",
    "esse atendimento automático de vocês é péssimo",
    "vocês só têm atendimento automático?",
    "sou um cliente, não um robô",
  ];

  it.each(RECLAMACOES)("gente reclamando do NOSSO robô não é autodeclaração: %s", (frase) => {
    expect(ehAutodeclaracaoDeAutomacao(frase)).toBe(false);
  });

  it("três reclamações seguidas, cada uma depois de uma resposta da IA, não disparam", () => {
    const conversa: Mensagem[] = [];
    RECLAMACOES.slice(0, 4).forEach((frase, i) => {
      conversa.push(daIa("Posso ajudar em algo mais?", -6 * MIN + i * MIN));
      conversa.push(doContato(frase, -6 * MIN + i * MIN + 20 * SEG));
    });
    expect(avaliar(conversa).dispara).toBeNull();
  });

  it("pessoa respondendo rápido 'ok', 'sim' não dispara (nem repetição, nem velocidade)", () => {
    const conversa: Mensagem[] = [];
    const respostas = ["ok", "sim", "ok", "sim", "ok", "ok", "sim", "ok"];
    respostas.forEach((r, i) => {
      conversa.push(daIa("Posso confirmar o horário das 15h?", -8 * MIN + i * 40 * SEG));
      conversa.push(doContato(r, -8 * MIN + i * 40 * SEG + 1 * SEG));
    });
    const r = avaliar(conversa);
    expect(r.dispara).toBeNull();
    expect(r.mensagens_de_robo).toBe(0);
    expect("ok".length).toBeLessThan(MINIMO_DE_CARACTERES_DA_REPETICAO);
  });

  it("a mensagem da equipe não é resposta da IA: o que vem depois dela não conta", () => {
    const conversa: Mensagem[] = [];
    for (let i = 0; i < 4; i += 1) {
      conversa.push(daIa("Desculpe, não entendi.", -9 * MIN + i * MIN));
      conversa.push(daEquipe("Oi, aqui é a Ana, da equipe.", -9 * MIN + i * MIN + 10 * SEG));
      conversa.push(doContato(MENU_DA_OPERADORA, -9 * MIN + i * MIN + 12 * SEG));
    }
    expect(avaliar(conversa).dispara).toBeNull();
  });

  it("reação, linha de sistema e histórico importado ficam fora da conta", () => {
    const conversa: Mensagem[] = [];
    for (let i = 0; i < 4; i += 1) {
      conversa.push(daIa("Posso ajudar?", -9 * MIN + i * MIN));
      conversa.push(msg("inbound", null, MENU_DA_OPERADORA, -9 * MIN + i * MIN + 3 * SEG, { type: "reaction" }));
      conversa.push(msg("inbound", null, MENU_DA_OPERADORA, -9 * MIN + i * MIN + 4 * SEG, { metadata: { historico_importado: true } }));
    }
    expect(avaliar(conversa).dispara).toBeNull();
  });
});

describe("a régua: os três sinais", () => {
  it.each([
    "_Mensagem enviada pela inteligência artificial da Operadora Exemplo_",
    "Mensagem enviada por IA",
    "Olá! Sou a assistente virtual da Clínica Exemplo.",
    "Oi! Sou a Sofia, assistente virtual da Clínica Exemplo.",
    "Sou a inteligência artificial da Operadora Exemplo.",
    "Esta é uma mensagem automática.",
    "Esta mensagem foi enviada automaticamente.",
    "Mensagem automática: em breve retornaremos.",
    "Atendimento automático",
    "Este é o nosso atendimento automático.",
    "Você está sendo atendido pelo nosso assistente virtual.",
  ])("A · autodeclaração casa: %s", (frase) => {
    expect(ehAutodeclaracaoDeAutomacao(frase)).toBe(true);
  });

  it("B · a repetição conta a partir da 3ª ocorrência do mesmo texto (sem acento, caixa ou espaço extra)", () => {
    const conversa: Mensagem[] = [];
    const variantes = [FRASES_CURTAS, FRASES_CURTAS.toUpperCase(), `  ${FRASES_CURTAS.replace("mais", "mais   ")}  `, FRASES_CURTAS, FRASES_CURTAS];
    variantes.forEach((v, i) => {
      // Devagar (1 min depois de cada resposta): sem o sinal de velocidade.
      conversa.push(daIa("Claro! Qual plano você quer conhecer?", -12 * MIN + i * 2 * MIN));
      conversa.push(doContato(v, -12 * MIN + i * 2 * MIN + MIN));
    });
    expect(avaliar(conversa.slice(0, 8)).dispara).toBeNull(); // 4 ocorrências: só a 3ª e a 4ª contam
    const r = avaliar(conversa);
    expect(r.dispara).toBe("robo");
    expect(r.sinais.map((s) => s.sinais)).toEqual([["repeticao"], ["repeticao"], ["repeticao"]]);
  });

  it("C · texto longo chegando rápido demais para alguém digitar", () => {
    const longo =
      "Para falar sobre planos, digite 1. Para boleto, digite 2. Para suporte técnico, digite 3. Para outros assuntos, aguarde.";
    expect(longo.length).toBeGreaterThanOrEqual(80);
    const rapido: Mensagem[] = [];
    const devagar: Mensagem[] = [];
    for (let i = 0; i < 3; i += 1) {
      rapido.push(daIa("Pode me dizer o que precisa?", -9 * MIN + i * MIN));
      rapido.push(doContato(`${longo} (${i})`, -9 * MIN + i * MIN + 2 * SEG));
      devagar.push(daIa("Pode me dizer o que precisa?", -9 * MIN + i * MIN));
      devagar.push(doContato(`${longo} (${i})`, -9 * MIN + i * MIN + 50 * SEG));
    }
    const r = avaliar(rapido);
    expect(r.dispara).toBe("robo");
    expect(r.sinais.every((s) => s.sinais.includes("velocidade"))).toBe(true);
    expect(avaliar(devagar).dispara).toBeNull();
  });
});

describe("a régua: o teto de respostas", () => {
  function conversaComRespostas(n: number): Mensagem[] {
    const saida: Mensagem[] = [];
    for (let i = 0; i < n; i += 1) {
      saida.push(doContato(`Pergunta número ${i} sobre o plano`, -55 * MIN + i * 90 * SEG));
      // Dois balões na mesma resposta: um turno só.
      saida.push(daIa("Boa pergunta!", -55 * MIN + i * 90 * SEG + 20 * SEG));
      saida.push(daIa("Veja os detalhes do plano.", -55 * MIN + i * 90 * SEG + 21 * SEG));
    }
    return saida;
  }

  it("30 respostas da IA em 60 minutos disparam o teto; 29 não", () => {
    expect(avaliar(conversaComRespostas(29)).dispara).toBeNull();
    const r = avaliar(conversaComRespostas(30));
    expect(r.dispara).toBe("teto");
    expect(r.respostas_no_teto).toBe(30);
  });

  it("o teto vem da configuração", () => {
    expect(avaliar(conversaComRespostas(30), { teto_respostas: 40 }).dispara).toBeNull();
  });

  it("o laço com robô vem antes do teto", () => {
    expect(avaliar([...conversaComRespostas(30), ...lacoDaOperadora(3, -2 * MIN)]).dispara).toBe("robo");
  });
});

describe("a régua: depois de um registro, a conta recomeça", () => {
  it("os giros de antes do último registro não contam de novo", () => {
    const laco = lacoDaOperadora(3);
    const registro = new Date(AGORA.getTime() - 8 * MIN);
    expect(avaliar(laco, {}, registro).dispara).toBeNull();
    const maisUm = [...laco, ...lacoDaOperadora(1, -1 * MIN)];
    const r = avaliar(maisUm, {}, registro);
    expect(r.dispara).toBeNull();
    expect(r.mensagens_de_robo).toBe(1);
  });
});

describe("a configuração", () => {
  it("o padrão é LIGADA, com os limites da especificação", () => {
    expect(CONFIG_PADRAO_DA_TRAVA).toEqual({
      ligada: true,
      janela_minutos: 15,
      mensagens_para_disparar: 3,
      repeticao_janela_minutos: 120,
      repeticoes_anteriores: 2,
      velocidade_minimo_de_caracteres: 80,
      velocidade_caracteres_por_segundo: 15,
      teto_respostas: 30,
      teto_janela_minutos: 60,
    });
    expect(configDaLinha(null)).toEqual(CONFIG_PADRAO_DA_TRAVA);
  });

  it("valor fora da faixa numa linha gravada cai no padrão daquele campo", () => {
    const c = configDaLinha({ ligada: false, teto_respostas: 0, janela_minutos: 30 });
    expect(c.ligada).toBe(false);
    expect(c.teto_respostas).toBe(30);
    expect(c.janela_minutos).toBe(30);
  });

  it("as faixas e os padrões do código são os mesmos das CHECKs e dos defaults da 9153", () => {
    const sql = readFileSync(join(RAIZ, "supabase/migrations-mia/20261112120000_9153_trava_de_robo_config.sql"), "utf8");
    for (const [campo, [min, max]] of Object.entries(FAIXAS_DA_TRAVA)) {
      expect(sql, campo).toMatch(new RegExp(`check \\(${campo} between ${min} and ${max}\\)`));
      const padrao = (CONFIG_PADRAO_DA_TRAVA as unknown as Record<string, number>)[campo];
      expect(sql, campo).toMatch(new RegExp(`${campo}\\s+integer not null default ${padrao}\\b`));
    }
    expect(sql).toMatch(/ligada\s+boolean not null default true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O EFEITO, num banco em memória
// ─────────────────────────────────────────────────────────────────────────────

function cenario(ajuste: { semNegocio?: boolean; mensagens?: Mensagem[]; conversa?: Partial<Linha>; contato?: Partial<Linha>; extras?: Record<string, Linha[]> } = {}) {
  const banco = bancoEmMemoria(
    {
      organizations: [{ id: ORG, locale: "pt-BR", display_name: "Clínica Exemplo", settings: {} }],
      contacts: [
        {
          id: CONTATO,
          organization_id: ORG,
          name: "Operadora Exemplo",
          phone_number: "5511900000000",
          force_human: false,
          ai_opt_out: false,
          is_blocked: false,
          tags: ["prospeccao"],
          ...ajuste.contato,
        },
      ],
      conversations: [
        {
          id: CONV,
          organization_id: ORG,
          contact_id: CONTATO,
          status: "ai_handling",
          is_group: false,
          assignee_kind: "ai",
          assigned_to_user_id: null,
          bot_silenced_until: null,
          last_handoff_at: null,
          last_handoff_reason: null,
          ...ajuste.conversa,
        },
      ],
      crm_pipelines: [{ id: FUNIL, organization_id: ORG, is_default: true, is_archived: false, settings: { lost_reasons: ["Sem orçamento"] }, updated_at: em(-1000 * MIN) }],
      crm_stages: [
        { id: ETAPA_ABERTA, organization_id: ORG, pipeline_id: FUNIL, name: "Novo", is_won: false, is_lost: false, is_archived: false, position: 1 },
        { id: ETAPA_PERDIDO, organization_id: ORG, pipeline_id: FUNIL, name: "Perdido", is_won: false, is_lost: true, is_archived: false, position: 9 },
      ],
      crm_leads: ajuste.semNegocio
        ? []
        : [
            {
              id: LEAD,
              organization_id: ORG,
              contact_id: CONTATO,
              pipeline_id: FUNIL,
              stage_id: ETAPA_ABERTA,
              status: "open",
              position_in_stage: 1,
              lost_reason: null,
              custom_fields: {},
              last_activity_at: em(-5 * MIN),
              created_at: em(-60 * MIN),
            },
          ],
      cron_jobs: [{ id: "0a0b0c0d-aaaa-4aaa-8aaa-000000000001", organization_id: ORG, contact_id: CONTATO, enabled: true, cancelled_at: null }],
      followup_enrollments: [
        { id: "0a0b0c0d-bbbb-4bbb-8bbb-000000000001", organization_id: ORG, contact_id: CONTATO, status: "waiting_reply", current_node_id: "n1", next_eval_at: em(60 * MIN) },
        { id: "0a0b0c0d-bbbb-4bbb-8bbb-000000000002", organization_id: ORG, contact_id: CONTATO, status: "completed", current_node_id: "n9", next_eval_at: null },
      ],
      messages: (ajuste.mensagens ?? lacoDaOperadora(3)).map((m) => ({ ...m, organization_id: ORG, conversation_id: CONV })),
      ...ajuste.extras,
    },
    {
      fn_service_status: (args, db) => {
        const c = (db.conversations ?? []).find((x) => x.id === args.p_conversation && x.organization_id === args.p_org);
        if (!c) return { data: null, error: { message: "service_not_found", code: "P0002" } };
        c.status = args.p_status;
        // A regra da função do banco: encerrar zera o silêncio quando não houve passagem.
        if (c.last_handoff_at == null) c.bot_silenced_until = null;
        return { data: c, error: null };
      },
    },
  );
  return banco;
}

const ALVO = { organizationId: ORG, conversationId: CONV, contactId: CONTATO, jobId: JOB, idioma: "pt-BR" as const };
const deps = (admin: unknown) => ({ admin: admin as never, agora: () => AGORA, requestId: "trava-de-robo:teste" });

describe("o efeito: o laço com robô", () => {
  it("cala o contato, etiqueta, cancela os follow-ups, perde o negócio, anota, encerra e registra, sem enviar nada", async () => {
    const banco = cenario();
    const avaliacao = avaliar(lacoDaOperadora(3));
    const r = await aplicarTravaDeRobo(deps(banco.cliente), ALVO, avaliacao);

    const contato = banco.db.contacts![0]!;
    expect(contato.force_human).toBe(true);
    expect(contato.tags).toEqual(["prospeccao", "robô"]);
    expect(r.etiquetaAplicada).toBe(true);

    expect(banco.db.cron_jobs![0]).toMatchObject({ enabled: false, cancel_reason: textos.MOTIVO_DO_CANCELAMENTO_DO_FOLLOWUP });
    expect(banco.db.cron_jobs![0]!.cancelled_at).toBeTruthy();
    expect(banco.db.followup_enrollments![0]).toMatchObject({ status: "cancelled", next_eval_at: null });
    // A régua já encerrada não é tocada.
    expect(banco.db.followup_enrollments![1]).toMatchObject({ status: "completed" });
    expect(r.followupsCancelados).toBe(2);

    const lead = banco.db.crm_leads![0]!;
    expect(lead.stage_id).toBe(ETAPA_PERDIDO);
    expect(lead.lost_reason).toBe(textos.MOTIVO_DE_PERDA_DA_TRAVA);
    expect(r.negocios).toEqual([LEAD]);
    // O motivo de sistema entrou na lista do funil, com a categoria, ao lado do que já havia.
    expect((banco.db.crm_pipelines![0]!.settings as { lost_reasons: unknown[] }).lost_reasons).toEqual([
      "Sem orçamento",
      { label: textos.MOTIVO_DE_PERDA_DA_TRAVA, categoria: "Ausência" },
    ]);
    const atividades = (banco.db.crm_lead_activities ?? []).map((a) => [a.type, a.reason]);
    expect(atividades).toContainEqual(["demand_closed", textos.PERDA_NA_LINHA_DO_TEMPO]);
    expect(atividades).toContainEqual(["conversation_ai_paused", textos.LINHA_DO_TEMPO_DO_ROBO]);

    expect(banco.db.conversation_notes).toHaveLength(1);
    expect(banco.db.conversation_notes![0]!.body).toBe(
      "IA pausada: o outro lado é um robô (3 mensagens automáticas em 1 min). Negócio marcado como perdido e conversa encerrada.",
    );
    expect(banco.db.conversation_notes![0]!.created_by_user_id).toBeNull();

    expect(banco.chamadasRpc.map((c) => c.nome)).toContain("fn_service_status");
    expect(banco.db.conversations![0]!.status).toBe("closed");
    expect(r.conversaEncerrada).toBe(true);

    expect(banco.db.mia_travas_de_robo).toHaveLength(1);
    expect(banco.db.mia_travas_de_robo![0]).toMatchObject({
      organization_id: ORG,
      contact_id: CONTATO,
      conversation_id: CONV,
      job_id: JOB,
      motivo: "robo",
      mensagens_de_robo: 3,
      respostas_da_ia: 3,
      negocios_afetados: [LEAD],
      conversa_encerrada: true,
      etiqueta_aplicada: true,
      followups_cancelados: 2,
      falhas: [],
    });
    expect(vi.mocked(audit).mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual(
      expect.arrayContaining(["lead.lost", "conversation.closed", "ai.trava_de_robo_disparada"]),
    );
    // Nada sai para o contato: nenhuma mensagem nova gravada.
    expect(banco.escritas.filter((e) => e.tabela === "messages")).toEqual([]);
  });

  it("sem negócio aberto, NÃO cria negócio, e a nota diz isso", async () => {
    const banco = cenario({ semNegocio: true });
    const r = await aplicarTravaDeRobo(deps(banco.cliente), ALVO, avaliar(lacoDaOperadora(3)));
    expect(banco.db.crm_leads).toEqual([]);
    expect(banco.escritas.filter((e) => e.tabela === "crm_leads")).toEqual([]);
    expect(r.negocios).toEqual([]);
    expect(banco.db.conversation_notes![0]!.body).toMatch(/Conversa encerrada; não havia negócio aberto\./);
    expect(banco.db.mia_travas_de_robo![0]).toMatchObject({ negocios_afetados: [], conversa_encerrada: true });
  });

  it("o motivo que o funil já tem é usado como está, sem duplicar", async () => {
    const banco = cenario();
    banco.db.crm_pipelines![0]!.settings = { lost_reasons: [{ label: "Robô ou atendimento automático", categoria: "Ausência" }] };
    await aplicarTravaDeRobo(deps(banco.cliente), ALVO, avaliar(lacoDaOperadora(3)));
    expect((banco.db.crm_pipelines![0]!.settings as { lost_reasons: unknown[] }).lost_reasons).toHaveLength(1);
    expect(banco.db.crm_leads![0]!.lost_reason).toBe("Robô ou atendimento automático");
  });

  it("a empresa em espanhol recebe a nota e o motivo no idioma dela", async () => {
    const banco = cenario();
    await aplicarTravaDeRobo(deps(banco.cliente), { ...ALVO, idioma: "es" }, avaliar(lacoDaOperadora(3)));
    expect(banco.db.conversation_notes![0]!.body).toMatch(/^IA en pausa: del otro lado hay un robot \(3 mensajes automáticos en 1 min\)/);
    expect(banco.db.crm_leads![0]!.lost_reason).toBe("Robot o atención automática");
  });

  it("depois da trava, o motor cala o contato (isLeadInHandoff lê o force_human)", async () => {
    const banco = cenario();
    await aplicarTravaDeRobo(deps(banco.cliente), ALVO, avaliar(lacoDaOperadora(3)));
    const contato = banco.db.contacts![0]!;
    const pool = {
      query: async () => ({ rows: [{ handoff: contato.force_human === true }] }),
    };
    expect(await isLeadInHandoff(pool as never, ORG, CONTATO)).toBe(true);
    expect(contatoTravadoComoRobo(contato)).toBe(true);
  });

  it("se calar o contato falhar, o turno cai (o job é refeito) e nada mais é escrito", async () => {
    const banco = cenario();
    const quebrado = {
      ...banco.cliente,
      from: (t: string) => {
        const q = banco.cliente.from(t) as Record<string, unknown>;
        if (t !== "contacts") return q;
        return { ...q, update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "fora do ar" } }) }) }) }) }) };
      },
    };
    await expect(aplicarTravaDeRobo(deps(quebrado), ALVO, avaliar(lacoDaOperadora(3)))).rejects.toThrow(/não foi calada/);
    expect(banco.db.crm_leads![0]!.stage_id).toBe(ETAPA_ABERTA);
    expect(banco.db.mia_travas_de_robo ?? []).toEqual([]);
  });
});

describe("o efeito: o teto de respostas", () => {
  it("pausa SÓ a conversa, avisa a equipe, anota e registra, sem perder o negócio nem encerrar", async () => {
    const banco = cenario();
    const avaliacao = { ...avaliar([]), dispara: "teto" as const, respostas_no_teto: 30, respostas_da_ia: 30, duracao_segundos: 50 * 60 };
    const r = await aplicarTetoDeRespostas(deps(banco.cliente), ALVO, avaliacao, { status: "ai_handling" });

    const conversa = banco.db.conversations![0]!;
    expect(conversa).toMatchObject({ bot_silenced_until: "infinity", status: "pending", last_handoff_reason: textos.MOTIVO_DO_SILENCIO_DO_TETO });
    expect(banco.db.contacts![0]!.force_human).toBe(false);
    expect(banco.db.contacts![0]!.tags).toEqual(["prospeccao"]);
    expect(banco.db.crm_leads![0]).toMatchObject({ stage_id: ETAPA_ABERTA, status: "open" });
    expect(banco.db.cron_jobs![0]!.enabled).toBe(true);
    expect(banco.chamadasRpc.map((c) => c.nome)).not.toContain("fn_service_status");

    expect(banco.db.agent_inbox_items).toHaveLength(1);
    expect(banco.db.agent_inbox_items![0]).toMatchObject({
      kind: "handoff",
      severity: "warn",
      ref_kind: "conversation",
      ref_id: CONV,
      title: textos.TITULO_DO_AVISO_DO_TETO,
    });
    expect(banco.db.agent_inbox_items![0]!.body).toMatch(/^A IA respondeu 30 vezes em 50 min nesta conversa/);
    expect(banco.db.conversation_notes![0]!.body).toMatch(/^IA pausada nesta conversa: a IA respondeu 30 vezes em 50 min\./);
    expect((banco.db.crm_lead_activities ?? []).map((a) => a.reason)).toEqual([textos.LINHA_DO_TEMPO_DO_TETO]);
    expect(banco.db.mia_travas_de_robo![0]).toMatchObject({ motivo: "teto", respostas_da_ia: 30, negocios_afetados: [], conversa_encerrada: false });
    expect(r.negocios).toEqual([]);
  });

  it("não abre um segundo aviso na Central para a mesma conversa", async () => {
    const banco = cenario({
      extras: {
        agent_inbox_items: [{ id: "0a0b0c0d-cccc-4ccc-8ccc-000000000001", organization_id: ORG, kind: "handoff", ref_kind: "conversation", ref_id: CONV, status: "open" }],
      },
    });
    await aplicarTetoDeRespostas(deps(banco.cliente), ALVO, { ...avaliar([]), dispara: "teto", respostas_no_teto: 30 }, { status: "pending" });
    expect(banco.db.agent_inbox_items).toHaveLength(1);
  });
});

describe("no turno: avaliar e travar", () => {
  const registrarRastro = vi.fn(async () => undefined);
  beforeEach(() => registrarRastro.mockClear());
  const noTurno = (admin: unknown) =>
    avaliarETravarNoTurno(null, { organizationId: ORG, conversationId: CONV, contactId: CONTATO, jobId: JOB }, undefined, {
      admin: admin as never,
      agora: () => AGORA,
      registrarRastro,
    });

  it("o laço da Operadora: o turno acaba, com o rastro 'trava_de_robo'", async () => {
    const banco = cenario();
    expect(await noTurno(banco.cliente)).toBe("robo");
    expect(registrarRastro).toHaveBeenCalledWith("trava_de_robo");
    expect(banco.db.contacts![0]!.force_human).toBe(true);
    expect(banco.db.mia_travas_de_robo).toHaveLength(1);
  });

  it("uma conversa comum segue, sem escrever nada", async () => {
    const banco = cenario({ mensagens: lacoDaOperadora(2) });
    expect(await noTurno(banco.cliente)).toBe("segue");
    expect(banco.escritas).toEqual([]);
    expect(registrarRastro).not.toHaveBeenCalled();
  });

  it("o grupo fica de fora", async () => {
    const banco = cenario({ conversa: { is_group: true } });
    expect(await noTurno(banco.cliente)).toBe("segue");
    expect(banco.escritas).toEqual([]);
  });

  it("a empresa que desligou a trava fica de fora", async () => {
    const banco = cenario({ extras: { mia_trava_de_robo_config: [{ organization_id: ORG, ligada: false }] } });
    expect(await noTurno(banco.cliente)).toBe("segue");
    expect(banco.escritas).toEqual([]);
  });

  it("erro ao ler as mensagens: o turno SEGUE (a trava nunca cala por dúvida)", async () => {
    const banco = cenario();
    const quebrado = {
      ...banco.cliente,
      from: (t: string) => {
        if (t !== "messages") return banco.cliente.from(t);
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "order"]) q[m] = () => q;
        q.limit = async () => ({ data: null, error: { message: "tempo esgotado" } });
        return q;
      },
    };
    expect(await noTurno(quebrado)).toBe("segue");
    expect(banco.db.contacts![0]!.force_human).toBe(false);
  });

  it("o teto pelo turno: pausa a conversa, com o rastro 'teto_de_respostas_da_ia'", async () => {
    const conversa: Mensagem[] = [];
    for (let i = 0; i < 30; i += 1) {
      conversa.push(doContato(`Dúvida ${i} sobre o plano`, -55 * MIN + i * 90 * SEG));
      conversa.push(daIa("Claro, explico.", -55 * MIN + i * 90 * SEG + 20 * SEG));
    }
    const banco = cenario({ mensagens: conversa });
    expect(await noTurno(banco.cliente)).toBe("teto");
    expect(registrarRastro).toHaveBeenCalledWith("teto_de_respostas_da_ia");
    expect(banco.db.conversations![0]!.bot_silenced_until).toBe("infinity");
  });
});

describe("o Retomar IA depois da trava ('Devolver ao automático')", () => {
  it("solta o contato, e a IA volta: a próxima mensagem do robô não trava de novo pelos giros já contados", async () => {
    const banco = cenario();
    const registrarRastro = vi.fn(async () => undefined);
    const noTurno = () =>
      avaliarETravarNoTurno(null, { organizationId: ORG, conversationId: CONV, contactId: CONTATO, jobId: JOB }, undefined, {
        admin: banco.cliente as never,
        agora: () => AGORA,
        registrarRastro,
      });
    expect(await noTurno()).toBe("robo");
    expect(banco.db.contacts![0]!.force_human).toBe(true);
    // O registro nasce "agora" no relógio do banco; no banco em memória, o teste o carimba.
    banco.db.mia_travas_de_robo![0]!.created_at = em(-30 * SEG);

    const devolvida = await devolverAtendimentoAoAgente(
      { supabase: banco.cliente as never, organizationId: ORG, actor: { type: "user", id: PESSOA, role: "admin" }, requestId: "retomar" },
      { conversationId: CONV, responderPendente: false },
    );
    expect(devolvida.ok).toBe(true);
    expect(banco.db.contacts![0]!.force_human).toBe(false);
    expect(contatoTravadoComoRobo(banco.db.contacts![0])).toBe(false);
    const pool = { query: async () => ({ rows: [{ handoff: banco.db.contacts![0]!.force_human === true }] }) };
    expect(await isLeadInHandoff(pool as never, ORG, CONTATO)).toBe(false);

    // A IA responde e o robô manda o menu de novo: um giro só depois do registro.
    banco.db.messages!.push(
      ...lacoDaOperadora(1, -10 * SEG).map((m) => ({ ...m, organization_id: ORG, conversation_id: CONV })),
    );
    expect(await noTurno()).toBe("segue");
    expect(banco.db.mia_travas_de_robo).toHaveLength(1);
  });
});

describe("fora da trava: a prévia e o sandbox", () => {
  const FONTE = readFileSync(join(RAIZ, "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const inicioDoHandler = FONTE.indexOf("export function createInboundTurnHandler(");
  const inicioDaPrevia = FONTE.indexOf("export async function runAgentPreview(");

  it("a trava mora no handler do turno de MENSAGEM, uma vez só", () => {
    expect(FONTE.match(/travaDeRoboNoTurno\(/g) ?? []).toHaveLength(1);
    const chamada = FONTE.indexOf("travaDeRoboNoTurno(pool");
    expect(chamada).toBeGreaterThan(inicioDoHandler);
  });

  it("depois do handoff e da elegibilidade, e antes de escolher o agente (sem roteador, sem modelo)", () => {
    const chamada = FONTE.indexOf("travaDeRoboNoTurno(pool");
    const handoff = FONTE.indexOf("if (await isLeadInHandoff(pool, job.organization_id, job.contact_id))", inicioDoHandler);
    const elegibilidade = FONTE.indexOf("decidirElegibilidadeDaConversa(pool", inicioDoHandler);
    const agente = FONTE.indexOf("resolveConversationTurn(pool", inicioDoHandler);
    expect(handoff).toBeGreaterThan(0);
    expect(chamada).toBeGreaterThan(handoff);
    expect(chamada).toBeGreaterThan(elegibilidade);
    expect(chamada).toBeLessThan(agente);
  });

  it("a prévia (o \"Testar\" do agente e o \"Sugerir resposta\") não passa por ela", () => {
    expect(inicioDaPrevia).toBeGreaterThan(0);
    const corpoDaPrevia = FONTE.slice(inicioDaPrevia, inicioDoHandler > inicioDaPrevia ? inicioDoHandler : undefined);
    expect(corpoDaPrevia).not.toContain("travaDeRobo");
    expect(FONTE.slice(0, inicioDoHandler)).not.toContain("travaDeRoboNoTurno(");
  });
});

describe("o nascimento do negócio: o robô não abre negócio novo a cada mensagem", () => {
  it("etiqueta 'robô' E force_human: travado; só um dos dois, não", () => {
    expect(contatoTravadoComoRobo({ tags: ["robô"], force_human: true })).toBe(true);
    expect(contatoTravadoComoRobo({ tags: ["robô"], force_human: false })).toBe(false);
    expect(contatoTravadoComoRobo({ tags: ["vip"], force_human: true })).toBe(false);
    expect(contatoTravadoComoRobo(null)).toBe(false);
  });

  it("garantirLeadDaConversa recusa com o motivo 'contato_robo', sem escrever", async () => {
    const { garantirLeadDaConversa } = await import("@/lib/leads/nascimento-do-lead");
    const banco = cenario({ semNegocio: true, contato: { tags: ["robô"], force_human: true, is_personal: false } });
    const r = await garantirLeadDaConversa(banco.cliente as never, {
      organizationId: ORG,
      contactId: CONTATO,
      conversationId: CONV,
      nomeDoContato: "Operadora Exemplo",
    });
    expect(r).toMatchObject({ criado: false, motivo: "contato_robo" });
    expect(banco.escritas).toEqual([]);
    expect(banco.chamadasRpc).toEqual([]);
  });
});

describe("os textos", () => {
  const FRASES = [
    textos.MOTIVO_DE_PERDA_DA_TRAVA,
    textos.NOTA_DO_ROBO_COM_NEGOCIO,
    textos.NOTA_DO_ROBO_SEM_NEGOCIO,
    textos.NOTA_DO_TETO,
    textos.LINHA_DO_TEMPO_DO_ROBO,
    textos.LINHA_DO_TEMPO_DO_TETO,
    textos.PERDA_NA_LINHA_DO_TEMPO,
    textos.TITULO_DO_AVISO_DO_TETO,
    textos.CORPO_DO_AVISO_DO_TETO,
    textos.AUTOR_DA_NOTA,
  ];

  it.each(FRASES)("tem espanhol no dicionário: %s", (f) => {
    expect(DICIONARIO[f]?.es, f).toBeTruthy();
  });

  it("nenhum texto que alguém lê usa travessão", () => {
    for (const f of FRASES) {
      expect(f).not.toContain("—");
      expect(DICIONARIO[f]?.es ?? "").not.toContain("—");
    }
  });

  it("os placeholders do espanhol são os mesmos do português", () => {
    for (const f of FRASES) {
      const chaves = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(chaves(DICIONARIO[f]?.es ?? ""), f).toEqual(chaves(f));
    }
  });
});

describe("o assistente explica a trava de robô", () => {
  it("contato travado: o motivo é 'trava_de_robo', com o conserto (Devolver ao automático)", async () => {
    const { explicarSilencioDaIa } = await import("@/lib/assistente/leituras/por-que-a-ia-nao-respondeu");
    const banco = bancoEmMemoria({
      contacts: [
        {
          id: CONTATO,
          organization_id: ORG,
          name: "Operadora Exemplo",
          display_name: null,
          is_anonymized: false,
          is_blocked: false,
          phone_number: "+5511900000000",
          ai_authorized_at: null,
          force_human: true,
          tags: ["robô"],
        },
      ],
      conversations: [
        {
          id: CONV,
          organization_id: ORG,
          contact_id: CONTATO,
          status: "closed",
          assigned_to_user_id: null,
          assigned_at: null,
          bot_silenced_until: null,
          channel_session_id: null,
          active_ai_agent_id: null,
          last_inbound_at: em(-1 * MIN),
          last_outbound_at: em(-2 * MIN),
          comando_da_conversa: "humano",
        },
      ],
      messages: [
        { id: "0a0b0c0d-dddd-4ddd-8ddd-000000000001", organization_id: ORG, conversation_id: CONV, direction: "outbound", sent_via: "ai", sent_at: em(-2 * MIN) },
        { id: "0a0b0c0d-dddd-4ddd-8ddd-000000000002", organization_id: ORG, conversation_id: CONV, direction: "inbound", sent_at: em(-1 * MIN) },
      ],
    });
    const cliente = {
      from: (nome: string) => {
        const q = banco.cliente.from(nome) as Record<string, unknown>;
        q.or = () => q;
        return q;
      },
    };
    const r = await explicarSilencioDaIa(cliente as never, {
      organizationId: ORG,
      contato: "Operadora Exemplo",
      fuso: "America/Sao_Paulo",
      equipe: [],
      agora: AGORA,
    });
    expect(r.motivo).toBe("trava_de_robo");
    expect(r.fatos.join(" ")).toContain("A trava de robô calou a IA para este contato");
    expect(r.conserto).toContain("Devolver ao automático");
  });
});

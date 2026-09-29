/**
 * FORK MIA — a tarefa "passagem prometida" do Jev: o estado ao ligar, a
 * pergunta que sai, o limiar e o registro.
 *
 *     npx vitest run lib/ai/decisao/passagem-prometida.test.ts
 */
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { lerConfigDoJev } from "@/lib/ai/decisao/config";
import {
  LIMIAR_DA_PASSAGEM_PROMETIDA,
  perguntarPassagemPrometidaAoJev,
  registrarPassagemPrometidaDoJev,
  rotuloDaProbabilidade,
  type PassagemPrometidaDoJev,
} from "@/lib/ai/decisao/passagem-prometida";
import { TAREFA_DA_PASSAGEM_PROMETIDA } from "@/lib/ai/decisao/tarefa-da-passagem-prometida";
import { estadoAoLigar, estadoEfetivoDaTarefa, TAREFAS_DO_JEV } from "@/lib/ai/decisao/tarefas";

const ADMIN = "22222222-2222-4222-8222-222222222222";
const ACEITE = { em: "2026-09-23T12:00:00.000Z", por: ADMIN };
const LIGADO = { jev: { ligado: true, aceite: ACEITE } };
const OBSERVANDO = { jev: { ...LIGADO.jev, tarefas: { passagem_prometida: { estado: "observando" } } } };
const DECIDINDO = { jev: { ...LIGADO.jev, tarefas: { passagem_prometida: { estado: "decidindo" } } } };

let seq = 0;
const novaOrg = () => `org-passagem-${++seq}`;

function poolCom(settings: unknown) {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      consultas.push({ sql, params });
      return { rows: [{ settings, nova: true }] };
    }),
  } as unknown as pg.Pool;
  return { pool, consultas };
}

function respostaCom(noul: number): Response {
  return new Response(
    JSON.stringify({ model: "jev-1.13.0", answers: { passagem: { type: "noul", noul } }, usage: { input_tokens: 120, output_tokens: 1 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const PROMESSA = "Perfeito, João! Vou encaminhar para a nossa equipe e em breve eles entram em contato com você.";

describe("a tarefa na lista do Jev", () => {
  it("está na lista, com ponto próprio e a primitiva sim/não", () => {
    expect(TAREFAS_DO_JEV).toContain(TAREFA_DA_PASSAGEM_PROMETIDA);
    expect(TAREFA_DA_PASSAGEM_PROMETIDA).toMatchObject({ ponto: "handoff_promise", primitiva: "noul", alcance: "mensagem" });
  });

  it("⭐ começa PAUSADA com o Jev ligado — o aceite fala da mensagem do cliente, e ela lê a do atendente", () => {
    const c = lerConfigDoJev(LIGADO);
    expect(estadoEfetivoDaTarefa(c, TAREFA_DA_PASSAGEM_PROMETIDA)).toBe("desligada");
    expect(estadoAoLigar(c, TAREFA_DA_PASSAGEM_PROMETIDA)).toBe("desligada");
  });

  it("ligada pelo administrador, começa OBSERVANDO; e só decide quando ele deixa", () => {
    expect(estadoEfetivoDaTarefa(lerConfigDoJev(OBSERVANDO), TAREFA_DA_PASSAGEM_PROMETIDA)).toBe("observando");
    expect(estadoEfetivoDaTarefa(lerConfigDoJev(DECIDINDO), TAREFA_DA_PASSAGEM_PROMETIDA)).toBe("decidindo");
  });

  it("o controle: as outras tarefas novas seguem começando observando (a regra do upstream não mudou)", () => {
    const c = lerConfigDoJev(LIGADO);
    const manipulacao = TAREFAS_DO_JEV.find((t) => t.id === "manipulacao")!;
    expect(estadoEfetivoDaTarefa(c, manipulacao)).toBe("observando");
  });
});

describe("o limiar", () => {
  it("abaixo dele é 'não passou'; a partir dele, 'passou'", () => {
    expect(rotuloDaProbabilidade(LIMIAR_DA_PASSAGEM_PROMETIDA - 0.01)).toBe("nao_passou");
    expect(rotuloDaProbabilidade(LIMIAR_DA_PASSAGEM_PROMETIDA)).toBe("passou");
    expect(rotuloDaProbabilidade(0.99)).toBe("passou");
  });
});

describe("perguntarPassagemPrometidaAoJev", () => {
  it("⭐ pausada (o padrão): nada sai para a rede", async () => {
    const { pool } = poolCom(LIGADO);
    const fetchImpl = vi.fn();
    const buscarChave = vi.fn(async () => "tsk_x");
    expect(
      await perguntarPassagemPrometidaAoJev(pool, { organizationId: novaOrg(), mensagem: PROMESSA }, { buscarChave, fetchImpl }),
    ).toBeNull();
    expect(buscarChave).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("observando: a pergunta leva só a resposta do atendente, sem telefone, como sim/não", async () => {
    const { pool } = poolCom(OBSERVANDO);
    const fetchImpl = vi.fn().mockResolvedValue(respostaCom(0.97));
    const r = await perguntarPassagemPrometidaAoJev(
      pool,
      { organizationId: novaOrg(), mensagem: `${PROMESSA} Se preferir, ligue no 11 91234-5678.` },
      { buscarChave: async () => "tsk_x", fetchImpl },
    );
    expect(r).toMatchObject({ estado: "observando", probabilidade: 0.97, rotulo: "passou", modelo: "jev-1.13.0" });
    const corpo = JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body)) as {
      state: string;
      questions: Record<string, { type: string; instructions: string }>;
    };
    expect(corpo.state).toContain("Vou encaminhar para a nossa equipe");
    expect(corpo.state).not.toMatch(/91234-5678/);
    expect(corpo.questions.passagem).toMatchObject({ type: "noul" });
    expect(corpo.questions.passagem!.instructions).toMatch(/encaminhado ou passado para a equipe/);
  });

  it("resposta abaixo do limiar vira 'não passou'", async () => {
    const { pool } = poolCom(DECIDINDO);
    const r = await perguntarPassagemPrometidaAoJev(
      pool,
      { organizationId: novaOrg(), mensagem: "Temos horário na quinta às 14h, pode ser?" },
      { buscarChave: async () => "tsk_x", fetchImpl: vi.fn().mockResolvedValue(respostaCom(0.04)) },
    );
    expect(r).toMatchObject({ estado: "decidindo", rotulo: "nao_passou" });
  });

  it("resposta ilegível não vira decisão", async () => {
    const { pool } = poolCom(OBSERVANDO);
    const ilegivel = new Response(JSON.stringify({ model: "jev-1.13.0", answers: {}, usage: {} }), { status: 200 });
    expect(
      await perguntarPassagemPrometidaAoJev(
        pool,
        { organizationId: novaOrg(), mensagem: PROMESSA },
        { buscarChave: async () => "tsk_x", fetchImpl: vi.fn().mockResolvedValue(ilegivel) },
      ),
    ).toBeNull();
  });
});

describe("registrarPassagemPrometidaDoJev", () => {
  const JEV: PassagemPrometidaDoJev = {
    estado: "observando",
    probabilidade: 0.93,
    rotulo: "passou",
    modelo: "jev-1.13.0",
    tokensDeEntrada: 120,
    tokensDeSaida: 1,
    latenciaMs: 300,
  };

  it("grava a observação com os DOIS rótulos e a chamada com o ponto, e diz se ela é nova", async () => {
    const { pool, consultas } = poolCom(null);
    const nova = await registrarPassagemPrometidaDoJev(pool, {
      organizationId: "org",
      contactId: "c",
      conversationId: "conv",
      messageId: "msg",
      jobId: "job",
      jev: JEV,
      rotuloAtual: "nao_passou",
      decidiu: false,
    });
    expect(nova).toBe(true);
    const { sql, params } = consultas[0]!;
    expect(sql).toMatch(/insert into public\.jev_observacoes/);
    expect(sql).toMatch(/'handoff_promise', 'typesafe'/);
    expect(sql).toMatch(/on conflict \(organization_id, tarefa, message_id\)/);
    expect(params.slice(0, 9)).toEqual(["org", "passagem_prometida", "observando", "conv", "msg", "job", "passou", 0.93, "nao_passou"]);
    expect(params[16]).toBe("jev_observacao");
  });

  it("falha do banco não derruba ninguém — e não conta como observação nova", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("caiu")) } as unknown as pg.Pool;
    expect(
      await registrarPassagemPrometidaDoJev(pool, {
        organizationId: "org",
        contactId: null,
        conversationId: null,
        messageId: "m",
        jobId: null,
        jev: JEV,
        rotuloAtual: "passou",
        decidiu: false,
      }),
    ).toBe(false);
  });
});

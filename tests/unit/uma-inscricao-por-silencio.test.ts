import { describe, expect, it, vi } from "vitest";

import { jaInscritosNesteSilencio, runSilenceSweep, type SilenceSweepDb } from "@/lib/followup/silence-sweep";

/**
 * FORK MIA — o fluxo de silêncio inscreve o contato UMA vez por silêncio.
 *
 * Em set/2026 a régua "Retomada leve" (silêncio de 24 h, mensagem por IA, canal
 * Meta) entrou em laço: o passo era pulado pela janela fechada, o enrollment
 * terminava em segundos e a varredura seguinte o inscrevia de novo — 22 contatos
 * somaram 14.389 enrollments, e cada volta pagava um turno de IA. A regra: depois
 * que o pointer inscreveu o contato, ele só volta quando o contato escrever.
 * O caso com banco de verdade está em tests/invariants/followup-silence-sweep.test.ts.
 */
describe("jaInscritosNesteSilencio", () => {
  const FALOU = "2026-09-27T10:00:00.000Z";

  it("inscrição depois da última fala segura o contato; antes dela, não", () => {
    const r = jaInscritosNesteSilencio(
      [
        { contact_id: "depois", started_at: "2026-09-28T11:00:00.000Z" },
        { contact_id: "antes", started_at: "2026-09-26T11:00:00.000Z" },
      ],
      [
        { contact_id: "depois", last_inbound_at: FALOU },
        { contact_id: "antes", last_inbound_at: FALOU },
      ],
    );
    expect([...r]).toEqual(["depois"]);
  });

  it("vale a fala MAIS NOVA entre as conversas do contato", () => {
    // Duas conversas (dois números): a nova fala abre outro silêncio, mesmo que a
    // conversa antiga esteja calada desde antes da inscrição.
    const r = jaInscritosNesteSilencio(
      [{ contact_id: "c", started_at: "2026-09-28T09:00:00.000Z" }],
      [
        { contact_id: "c", last_inbound_at: "2026-09-20T10:00:00.000Z" },
        { contact_id: "c", last_inbound_at: "2026-09-28T10:00:00.000Z" },
      ],
    );
    expect(r.size).toBe(0);
  });

  it("sem inscrição nenhuma, ninguém é segurado (o controle)", () => {
    expect(jaInscritosNesteSilencio([], [{ contact_id: "c", last_inbound_at: FALOU }]).size).toBe(0);
  });
});

describe("runSilenceSweep pula quem já foi inscrito neste silêncio", () => {
  it("⭐ o segurado não chega ao insert, e o resumo diz por quê", async () => {
    const insert = vi.fn(async () => ({ inserted: true }));
    const perguntou = vi.fn(async () => new Set(["ja-inscrito"]));
    const db: SilenceSweepDb = {
      loadActiveSilencePointers: async () => [
        { id: "ptr", organization_id: "org", active_version_id: "v1", threshold_minutes: 1440, segments: [] },
      ],
      loadSilentContactIds: async () => ["ja-inscrito", "novo"],
      loadContatosComRetornoVivo: async () => new Set<string>(),
      // Pausa de reentrada, pessoa no comando e inscrição viva (upstream 1.70): neutros aqui.
      loadEncerramentosDoFluxo: async () => new Map(),
      loadContatosComPessoaNoComando: async () => new Set<string>(),
      loadContatosComInscricaoViva: async () => new Set<string>(),
      loadJaInscritosNesteSilencio: perguntou,
      loadContactIdsEmCooldown: async () => new Set<string>(),
      loadTriggerNode: async () => ({ id: "inicio", pedeAgente: false }),
      insertEnrollment: insert,
    };
    const resumo = await runSilenceSweep({
      db,
      gateDb: { loadEnabledPublishedFollowupAgents: async () => [] },
      clock: () => new Date("2026-09-28T12:00:00Z"),
    });

    expect(perguntou).toHaveBeenCalledWith("org", "ptr", ["ja-inscrito", "novo"]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ contact_id: "novo" }));
    expect(resumo.skipped_same_silence).toBe(1);
    expect(resumo.enrolled).toBe(1);
  });
});

describe("as duas travas convivem: cooldown do upstream primeiro, silêncio da MIA depois", () => {
  it("o cooldown conta como o upstream mede; fora dele, o mesmo silêncio ainda segura", async () => {
    // A v1.61 do upstream trouxe o cooldown pós-conclusão: passado
    // threshold_minutes do fim da última tentativa, ele reinscreve. A MIA mantém
    // a regra dela por cima: no MESMO silêncio, não reinscreve nunca.
    const insert = vi.fn(async () => ({ inserted: true }));
    const db: SilenceSweepDb = {
      loadActiveSilencePointers: async () => [
        { id: "ptr", organization_id: "org", active_version_id: "v1", threshold_minutes: 1440, segments: [] },
      ],
      loadSilentContactIds: async () => ["nas-duas", "so-no-silencio", "livre"],
      loadContatosComRetornoVivo: async () => new Set<string>(),
      // Pausa de reentrada, pessoa no comando e inscrição viva (upstream 1.70): neutros aqui.
      loadEncerramentosDoFluxo: async () => new Map(),
      loadContatosComPessoaNoComando: async () => new Set<string>(),
      loadContatosComInscricaoViva: async () => new Set<string>(),
      loadContactIdsEmCooldown: async () => new Set(["nas-duas"]),
      loadJaInscritosNesteSilencio: async () => new Set(["nas-duas", "so-no-silencio"]),
      loadTriggerNode: async () => ({ id: "inicio", pedeAgente: false }),
      insertEnrollment: insert,
    };
    const resumo = await runSilenceSweep({
      db,
      gateDb: { loadEnabledPublishedFollowupAgents: async () => [] },
      clock: () => new Date("2026-09-29T12:00:00Z"),
    });

    expect(resumo.skipped_cooldown).toBe(1);
    expect(resumo.skipped_same_silence).toBe(1);
    expect(resumo.enrolled).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ contact_id: "livre" }));
  });
});

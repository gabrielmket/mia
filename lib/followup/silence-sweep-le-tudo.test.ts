/**
 * FORK MIA (MIA-340) — as duas leituras de inscrição ENCERRADA do sweep de
 * silêncio leem o lote inteiro, e não as primeiras 1000 linhas.
 *
 * Rodam contra o dublê que corta em `max_rows` como o PostgREST de verdade
 * (`tests/helpers/postgrest-com-teto.ts`): um dublê que obedecesse a qualquer
 * tamanho deixaria a forma antiga passar verde.
 *
 * Dado fictício: a Academia Alfa, com um fluxo de follow-up e alunos em laço.
 *
 *     npx vitest run lib/followup/silence-sweep-le-tudo.test.ts
 */
import { describe, expect, it } from "vitest";

import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

import { createSupabaseSilenceSweepDb } from "./silence-sweep";

const ACADEMIA_ALFA = "aaaaaaaa-0000-4000-8000-000000000001";
const FLUXO = "aaaaaaaa-0000-4000-8000-0000000000f1";
const BASE = Date.parse("2026-10-01T12:00:00.000Z");

const aluno = (i: number) => `aluno-${String(i).padStart(4, "0")}`;

/**
 * `porAluno` tentativas para cada um dos `alunos`, em ordem de `id` RODADA a
 * RODADA: a tentativa mais recente de cada aluno é a da última rodada, e mora
 * no fim da ordem — depois da linha 1000.
 */
function tentativas(alunos: number, porAluno: number, status: string): Linha[] {
  const linhas: Linha[] = [];
  for (let rodada = 0; rodada < porAluno; rodada++) {
    for (let a = 0; a < alunos; a++) {
      const fim = new Date(BASE + rodada * 86_400_000 + a * 1_000).toISOString();
      linhas.push({
        id: `insc-${String(rodada).padStart(3, "0")}-${String(a).padStart(4, "0")}`,
        organization_id: ACADEMIA_ALFA,
        pointer_id: FLUXO,
        contact_id: aluno(a),
        status,
        completed_at: fim,
        updated_at: fim,
      });
    }
  }
  return linhas;
}

describe("sweep de silêncio: as inscrições encerradas são lidas inteiras (MIA-340)", () => {
  it("pausa de reentrada: 100 alunos × 25 tentativas = 2.500 linhas, e o fim de cada um é o da ÚLTIMA", async () => {
    const banco = postgrestComTeto({ followup_enrollments: tentativas(100, 25, "completed") });
    const db = createSupabaseSilenceSweepDb(banco.cliente as never);
    const alunos = Array.from({ length: 100 }, (_, a) => aluno(a));

    const fatos = await db.loadEncerramentosDoFluxo(ACADEMIA_ALFA, FLUXO, alunos);

    expect(fatos.size).toBe(100);
    for (let a = 0; a < 100; a++) {
      // A rodada 24 é a última: na leitura cortada em 1000 linhas o fim lido
      // seria o da rodada 9, duas semanas antes.
      expect(fatos.get(aluno(a))?.encerradaEm).toBe(BASE + 24 * 86_400_000 + a * 1_000);
    }
    // Três páginas, todas ordenadas por `id`: 1000 + 1000 + 500.
    const pedidos = banco.pedidos.filter((p) => p.tabela === "followup_enrollments");
    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((p) => p.ordem.some((o) => o.coluna === "id"))).toBe(true);
    expect(pedidos.map((p) => p.devolvidas)).toEqual([1000, 1000, 500]);
  });

  it("cooldown: 250 alunos × 10 tentativas recentes = 2.500 linhas, e TODOS ficam em cooldown", async () => {
    const banco = postgrestComTeto({ followup_enrollments: tentativas(250, 10, "completed") });
    const db = createSupabaseSilenceSweepDb(banco.cliente as never);
    const alunos = Array.from({ length: 250 }, (_, a) => aluno(a));

    const emCooldown = await db.loadContactIdsEmCooldown(
      ACADEMIA_ALFA,
      FLUXO,
      alunos,
      new Date(BASE - 86_400_000).toISOString(),
    );

    expect(emCooldown.size).toBe(250);
    for (const a of alunos) expect(emCooldown.has(a)).toBe(true);
    // Em lotes de 100 alunos: o `in` cabe na URL, e cada lote (1000 linhas, que
    // a contagem prova serem todas) sai numa página só.
    const pedidos = banco.pedidos.filter((p) => p.tabela === "followup_enrollments");
    expect(pedidos.map((p) => p.devolvidas)).toEqual([1000, 1000, 500]);
    expect(pedidos.every((p) => p.range !== null)).toBe(true);
  });

  it("cooldown: a inscrição VIVA continua fora, e a antiga também", async () => {
    const linhas = [
      ...tentativas(3, 1, "active"),
      ...tentativas(3, 1, "completed").map((l, i) => ({
        ...l,
        id: `antiga-${i}`,
        updated_at: new Date(BASE - 30 * 86_400_000).toISOString(),
      })),
    ];
    const banco = postgrestComTeto({ followup_enrollments: linhas });
    const db = createSupabaseSilenceSweepDb(banco.cliente as never);

    const emCooldown = await db.loadContactIdsEmCooldown(
      ACADEMIA_ALFA,
      FLUXO,
      [aluno(0), aluno(1), aluno(2)],
      new Date(BASE - 86_400_000).toISOString(),
    );

    expect(emCooldown.size).toBe(0);
  });

  it("leitura que falha no meio: o ponteiro falha, em vez de seguir com metade do cooldown", async () => {
    const banco = postgrestComTeto(
      { followup_enrollments: tentativas(100, 25, "completed") },
      { falhaEm: (pedido) => (pedido === 2 ? "canceling statement due to statement timeout" : null) },
    );
    const db = createSupabaseSilenceSweepDb(banco.cliente as never);
    const alunos = Array.from({ length: 100 }, (_, a) => aluno(a));

    await expect(
      db.loadContactIdsEmCooldown(ACADEMIA_ALFA, FLUXO, alunos, new Date(BASE - 86_400_000).toISOString()),
    ).rejects.toThrow(/statement timeout/);
    await expect(db.loadEncerramentosDoFluxo(ACADEMIA_ALFA, FLUXO, alunos)).resolves.toBeInstanceOf(Map);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { registrarBatimento, TABELA_DO_BATIMENTO } from "@/lib/cron/batimento";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA (MIA-154) — 9168: o batimento dos crons, num banco de verdade.
 *
 * A prova da rota (`tests/unit/vigia-dos-canais-bate-o-ponto.test.ts`) usa um
 * dublê; aqui se prova o que o dublê não alcança:
 *  - o `upsert` de `registrarBatimento` casa com a chave da tabela: a segunda
 *    rodada REGRAVA a linha, não acumula;
 *  - a tabela é da plataforma: RLS ligado, nenhuma policy, e nem `anon` nem
 *    `authenticated` leem ou escrevem (a `/health` lê com o `service_role`);
 *  - a migration roda de novo sem erro (o baseline-mia é reaplicado a cada
 *    implantação).
 *
 *     pnpm test:db -- tests/invariants/batimento-dos-crons.test.ts
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 3,
});
const db = await pgComoSupabaseMia(pool);

const MIGRATION = join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations-mia",
  "20261123140000_9168_batimento_dos_crons.sql",
);

const ROTA = "rota-de-teste-9168";

async function linhas() {
  const { rows } = await pool.query<{ ultima_rodada_em: Date; resumo: Record<string, unknown> }>(
    `select ultima_rodada_em, resumo from public.${TABELA_DO_BATIMENTO} where rota = $1`,
    [ROTA],
  );
  return rows;
}

afterAll(async () => {
  await pool.query(`delete from public.${TABELA_DO_BATIMENTO} where rota = $1`, [ROTA]);
  await pool.end();
});

describe("9168: o batimento dos crons", () => {
  it("⭐ a segunda rodada regrava a linha da rota, não acumula", async () => {
    const primeira = new Date("2026-11-23T10:00:00.000Z");
    const segunda = new Date("2026-11-23T10:05:00.000Z");

    await registrarBatimento(db, ROTA, { sessoes: 3, verificadas: 3 }, primeira);
    await registrarBatimento(db, ROTA, { sessoes: 4, verificadas: 2, aguardando_confirmacao: 1 }, segunda);

    const gravadas = await linhas();
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]?.ultima_rodada_em.toISOString()).toBe(segunda.toISOString());
    expect(gravadas[0]?.resumo).toEqual({ sessoes: 4, verificadas: 2, aguardando_confirmacao: 1 });
  });

  it("é da plataforma: RLS ligado, zero policies, e anon/authenticated sem acesso", async () => {
    const { rows } = await pool.query<{
      rls: boolean;
      policies: number;
      anon: boolean;
      auth: boolean;
      service: boolean;
    }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = $1) as policies,
              has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as anon,
              has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as auth,
              has_table_privilege('service_role', c.oid, 'SELECT') and
                has_table_privilege('service_role', c.oid, 'INSERT') and
                has_table_privilege('service_role', c.oid, 'UPDATE') as service
         from pg_class c
        where c.oid = to_regclass('public.' || $1)`,
      [TABELA_DO_BATIMENTO],
    );
    expect(rows[0], "a tabela do batimento não existe: o baseline-mia não aplicou a 9168").toBeDefined();
    expect(rows[0]).toEqual({ rls: true, policies: 0, anon: false, auth: false, service: true });
  });

  it("a migration roda de novo sem erro e sem perder a linha", async () => {
    await registrarBatimento(db, ROTA, { sessoes: 1 }, new Date("2026-11-23T11:00:00.000Z"));
    await pool.query(readFileSync(MIGRATION, "utf8"));
    expect(await linhas()).toHaveLength(1);
  });
});

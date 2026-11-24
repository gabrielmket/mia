import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mesAtualEAnterior, periodoDoPedido } from "@/lib/ai/usage/consumo-do-periodo";
import { falhouOCustoDeMensagem, lerCustoDeMensagemDoPeriodo } from "@/lib/channels/meta/custo-do-periodo";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA (MIA-99, migration 9165) · O PREÇO DA META GANHA VIGÊNCIA, no
 * Postgres de verdade.
 *
 * O gatilho `trg_mia_precos_meta_vigencia` em `platform_precos_meta` é quem
 * fecha a vigência atual e abre a nova, seja quem for que grave o preço (a tela,
 * o MCP, a imagem de antes da migration). Aqui o upsert é o MESMO que o PUT da
 * tela e o MCP fazem (`onConflict: "categoria"`), e a conta é a mesma leitura da
 * aba Uso e do MCP (`lerCustoDeMensagemDoPeriodo`), pelo `pgComoSupabaseMia`.
 *
 * O caso, com dado fictício: a Academia Alfa teve 100 mensagens de marketing
 * cobradas no mês passado, a R$ 0,35. Neste mês o preço vai a R$ 0,50. O mês
 * passado continua R$ 35,00; este mês cobra R$ 0,35 antes da mudança e R$ 0,50
 * depois. O relógio é o do banco (`now()`), por isso os meses são o passado e o
 * corrente, em Brasília (`mesAtualEAnterior`), e não outubro e novembro fixos:
 * esses estão no teste de unidade (`tests/unit/preco-da-meta-com-vigencia.test.ts`).
 *
 * Mede também o que o gatilho promete além disso: preço igual não abre
 * vigência, duas mudanças na mesma transação dão uma vigência só, apagar fecha
 * a vigência aberta, a categoria que volta depois de apagada recomeça agora, a
 * migration aplicada de novo não mexe no histórico, o `service_role` grava e a
 * sessão não lê.
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

const ORG = "a1a1a1a1-9165-4000-8000-00000000000a";
const SESSAO = "a1a1a1a1-9165-4444-8000-00000000000a";
const CONTATO = "a1a1a1a1-9165-3333-8000-00000000000a";
const CONVERSA = "a1a1a1a1-9165-5555-8000-00000000000a";
const ADMIN = "a1a1a1a1-9165-9999-8000-00000000000a";

const MIGRATION = join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations-mia",
  "20261120120000_9165_preco_da_meta_com_vigencia.sql",
);

const { atual, anterior } = mesAtualEAnterior();
const MES_PASSADO = periodoDoPedido({ mes: anterior, dias: null })!;
const ESTE_MES = periodoDoPedido({ mes: atual, dias: null })!;

interface Vigencia {
  categoria: string;
  centavos_brl: number;
  desde_sempre: boolean;
  aberta: boolean;
  vigente_desde: Date | number;
  vigente_ate: Date | null;
}

async function vigencias(categoria: string): Promise<Vigencia[]> {
  const { rows } = await pool.query<Vigencia>(
    `select categoria, centavos_brl, vigente_desde, vigente_ate,
            vigente_desde = '-infinity'::timestamptz as desde_sempre,
            vigente_ate is null as aberta
       from public.mia_precos_meta_vigencias
      where categoria = $1
      order by vigente_desde`,
    [categoria],
  );
  return rows;
}

/** O que o PUT de `/api/v1/admin/custo-da-meta` e o MCP fazem. */
async function gravarPreco(categoria: string, centavos_brl: number): Promise<void> {
  const { error } = await db.from("platform_precos_meta").upsert(
    [{ categoria, centavos_brl, atualizado_em: new Date().toISOString(), atualizado_por: ADMIN }],
    { onConflict: "categoria" },
  );
  expect(error).toBeNull();
}

async function custo(periodo: { inicio: string; fim: string }) {
  const r = await lerCustoDeMensagemDoPeriodo(db, ORG, periodo);
  if (falhouOCustoDeMensagem(r)) throw new Error(r.erro);
  return r;
}

async function cobradas(quantas: number, primeira: string, prefixo: string): Promise<void> {
  await pool.query(
    `insert into public.messages
        (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body,
         meta_billable, meta_pricing_category, created_at)
     select gen_random_uuid(), $1, $2, $3, $4, 'text', 'outbound', $5 || n,
            true, 'marketing', $6::timestamptz + n * interval '1 second'
       from generate_series(1, $7) as n`,
    [ORG, CONVERSA, SESSAO, CONTATO, prefixo, primeira, quantas],
  );
}

beforeAll(async () => {
  await pool.query(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'academia-alfa-9165', 'Academia Alfa', 'Academia Alfa')
      on conflict (id) do nothing;
    do $s$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'academia-alfa-9165', '\\x00'::bytea);
    exception when unique_violation then null; end $s$;
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Ana Exemplo')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open')
      on conflict (id) do nothing;
  `);
  // As categorias deste arquivo partem do zero, sem preço nem histórico.
  await pool.query(`delete from public.platform_precos_meta where categoria in ('marketing', 'utility', 'service')`);
  await pool.query(`delete from public.mia_precos_meta_vigencias where categoria in ('marketing', 'utility', 'service')`);
});

afterAll(async () => pool.end());

describe("9165: o preço muda neste mês e o mês passado não muda", () => {
  it("o primeiro preço de uma categoria vale desde sempre, e é o preço atual", async () => {
    await gravarPreco("marketing", 35);
    expect(await vigencias("marketing")).toMatchObject([
      { centavos_brl: 35, desde_sempre: true, aberta: true },
    ]);
  });

  it("100 mensagens de marketing no mês passado custam R$ 35,00", async () => {
    // Dia 10 do mês passado, ao meio-dia de Brasília: longe das duas viradas.
    const dia10 = new Date(Date.parse(MES_PASSADO.inicio) + 9 * 86_400_000 + 12 * 3_600_000).toISOString();
    await cobradas(100, dia10, "mes passado ");
    expect(await custo(MES_PASSADO)).toMatchObject({ total: 100, totalCentavos: 3_500, semPreco: [] });
  });

  it("o preço vai a R$ 0,50: a vigência de R$ 0,35 fecha, a nova abre, e o mês passado continua R$ 35,00", async () => {
    // 5 mensagens deste mês ANTES da mudança (no primeiro minuto do mês).
    await cobradas(5, ESTE_MES.inicio, "antes ");
    await gravarPreco("marketing", 50);

    const v = await vigencias("marketing");
    expect(v).toMatchObject([
      { centavos_brl: 35, desde_sempre: true, aberta: false },
      { centavos_brl: 50, desde_sempre: false, aberta: true },
    ]);
    // Sem buraco nem sobreposição: a velha fecha no instante em que a nova abre.
    expect((v[0]!.vigente_ate as Date).getTime()).toBe((v[1]!.vigente_desde as Date).getTime());

    expect(await custo(MES_PASSADO)).toMatchObject({ total: 100, totalCentavos: 3_500, semPreco: [] });
  });

  it("este mês: R$ 0,35 antes da mudança e R$ 0,50 depois", async () => {
    // 10 mensagens DEPOIS da mudança: o instante do banco, numa transação posterior.
    await pool.query(
      `insert into public.messages
          (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body,
           meta_billable, meta_pricing_category, created_at)
       select gen_random_uuid(), $1, $2, $3, $4, 'text', 'outbound', 'depois ' || n, true, 'marketing', clock_timestamp()
         from generate_series(1, 10) as n`,
      [ORG, CONVERSA, SESSAO, CONTATO],
    );
    const r = await custo(ESTE_MES);
    expect(r).toMatchObject({ total: 15, totalCentavos: 5 * 35 + 10 * 50, semPreco: [] });
    expect(r.linhas[0]!.precos).toEqual([
      { centavosUnitarios: 35, cobradas: 5, totalCentavos: 175 },
      { centavosUnitarios: 50, cobradas: 10, totalCentavos: 500 },
    ]);
  });

  it("o mesmo preço gravado de novo (a tela manda a tabela inteira) não abre vigência", async () => {
    await gravarPreco("marketing", 50);
    expect(await vigencias("marketing")).toHaveLength(2);
  });

  it("a migration aplicada de novo não mexe no histórico", async () => {
    const antes = await vigencias("marketing");
    await pool.query(readFileSync(MIGRATION, "utf8"));
    expect(await vigencias("marketing")).toEqual(antes);
    expect(await custo(MES_PASSADO)).toMatchObject({ totalCentavos: 3_500 });
  });
});

describe("9165: o que mais o gatilho garante", () => {
  it("duas mudanças na mesma transação dão uma vigência só, com o último valor", async () => {
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query(`insert into public.platform_precos_meta (categoria, centavos_brl) values ('utility', 4)`);
      await cliente.query(`update public.platform_precos_meta set centavos_brl = 6 where categoria = 'utility'`);
      await cliente.query(`update public.platform_precos_meta set centavos_brl = 7 where categoria = 'utility'`);
      await cliente.query("commit");
    } finally {
      cliente.release();
    }
    expect(await vigencias("utility")).toMatchObject([{ centavos_brl: 7, desde_sempre: true, aberta: true }]);
  });

  it("apagar o preço fecha a vigência aberta; o preço que volta recomeça agora, não desde sempre", async () => {
    await pool.query(`insert into public.platform_precos_meta (categoria, centavos_brl) values ('service', 2)`);
    await pool.query(`delete from public.platform_precos_meta where categoria = 'service'`);
    expect(await vigencias("service")).toMatchObject([{ centavos_brl: 2, desde_sempre: true, aberta: false }]);

    await pool.query(`insert into public.platform_precos_meta (categoria, centavos_brl) values ('service', 3)`);
    expect(await vigencias("service")).toMatchObject([
      { centavos_brl: 2, desde_sempre: true, aberta: false },
      { centavos_brl: 3, desde_sempre: false, aberta: true },
    ]);
  });

  it("o `service_role` (o servidor) grava o preço e o gatilho abre a vigência com as permissões dele", async () => {
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query("set local role service_role");
      await cliente.query(`update public.platform_precos_meta set centavos_brl = 8 where categoria = 'utility'`);
      await cliente.query("commit");
    } finally {
      cliente.release();
    }
    expect(await vigencias("utility")).toMatchObject([
      { centavos_brl: 7, aberta: false },
      { centavos_brl: 8, aberta: true },
    ]);
  });

  it("a sessão (anon, authenticated) não lê o histórico: é preço de custo da plataforma", async () => {
    for (const papel of ["anon", "authenticated"]) {
      const cliente = await pool.connect();
      try {
        await cliente.query("begin");
        await cliente.query(`set local role ${papel}`);
        await expect(cliente.query("select 1 from public.mia_precos_meta_vigencias")).rejects.toThrow(/permission denied/);
        await cliente.query("rollback");
      } finally {
        cliente.release();
      }
    }
  });

  it("uma vigência aberta por categoria: a trava do índice recusa a segunda", async () => {
    await expect(
      pool.query(
        `insert into public.mia_precos_meta_vigencias (categoria, centavos_brl, vigente_desde) values ('utility', 9, now())`,
      ),
    ).rejects.toThrow(/uq_mia_precos_meta_vigencias_aberta/);
  });
});

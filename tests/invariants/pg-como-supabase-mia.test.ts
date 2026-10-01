import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { pgComoSupabase } from "../pg-como-supabase";
import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA — O EMBRULHO DO ADAPTADOR (`tests/pg-como-supabase-mia.ts`) FAZ
 * `delete`, `upsert`, INSERT EM LOTE, `range` E `neq`, MEDIDO ANTES DE MEDIR.
 *
 * O MCP de implantação usa as cinco formas, e o adaptador do upstream ESTOURA
 * nelas, que é o certo: método ausente que devolvesse vazio faria a prova de
 * ponta a ponta passar medindo nada. O embrulho as implementa ao lado, sem
 * tocar no arquivo do upstream, e cada uma tem aqui o caso em que um adaptador
 * MENTIROSO ficaria verde:
 *
 *  - `delete` que ignorasse o filtro esvaziaria a tabela e os casos seguintes
 *    passariam por não haver mais o que conferir;
 *  - `upsert` que virasse insert duplicaria a linha, ou estouraria na unique e
 *    o código trataria como falha de banco;
 *  - insert em lote que preenchesse a coluna ausente com o default esconderia
 *    a diferença para o PostgREST, que manda NULL;
 *  - `range` que devolvesse tudo faria a leitura paginada parecer certa numa
 *    página só;
 *  - array gravado em coluna jsonb como array do Postgres é recusado pelo
 *    banco, e o adaptador decide pelo TIPO DA COLUNA, não pelo valor.
 *
 * Arquivo próprio pelo mesmo motivo de `pg-como-supabase-nega-is.test.ts`.
 * Sem dado de ninguém: organização sintética, e-mail `@invariant.test`.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 2,
});
const db = await pgComoSupabaseMia(pool);

const ORG = "ada57e00-0000-4000-8000-000000009017";
const PESSOA = "ada57e00-1111-4000-8000-000000009017";

type Funil = { name: string; slug: string; description: string | null; is_default: boolean };

async function funis(): Promise<Funil[]> {
  const { rows } = await pool.query<Funil>(
    "select name, slug, description, is_default from crm_pipelines where organization_id = $1 and is_default = false order by position, name",
    [ORG],
  );
  return rows;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-adaptador-implantacao', 'Adaptador Implantação', 'Adaptador Implantação') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    "insert into auth.users (id, email) values ($1, 'adaptador-9017@invariant.test') on conflict (id) do nothing",
    [PESSOA],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.query("delete from auth.users where id = $1", [PESSOA]);
  await pool.end();
});

describe("insert de VÁRIAS linhas", () => {
  it("grava todas, e com `.select()` devolve as linhas gravadas", async () => {
    const { data, error } = await db
      .from("crm_pipelines")
      .insert([
        { organization_id: ORG, name: "Alfa", slug: "alfa", position: 10, description: "tem texto" },
        { organization_id: ORG, name: "Bravo", slug: "bravo", position: 20, description: null },
        { organization_id: ORG, name: "Charlie", slug: "charlie", position: 30, description: null },
      ])
      .select("name");
    expect(error).toBeNull();
    expect((data as Array<{ name: string }>).map((x) => x.name)).toEqual(["Alfa", "Bravo", "Charlie"]);
    expect((await funis()).map((f) => f.name)).toEqual(["Alfa", "Bravo", "Charlie"]);
  });

  it("a coluna que falta numa linha vai como NULL: a união das chaves, e não o default da tabela", async () => {
    // `description` só veio na primeira linha. A segunda fica nula.
    const { error } = await db.from("crm_pipelines").insert([
      { organization_id: ORG, name: "Delta", slug: "delta", position: 40, description: "com" },
      { organization_id: ORG, name: "Eco", slug: "eco", position: 50 },
    ]);
    expect(error).toBeNull();
    const eco = (await funis()).find((f) => f.name === "Eco");
    expect(eco?.description).toBeNull();
  });

  it("⭐ numa coluna NOT NULL com default, a linha sem a coluna é RECUSADA, e o lote inteiro não entra", async () => {
    // `is_default` tem default `false`. Vindo só numa linha, a outra recebe
    // NULL e o banco recusa: é o que o PostgREST faz. Um adaptador que usasse o
    // default gravaria as duas e o código pareceria certo aqui e erraria lá.
    const antes = (await funis()).length;
    const { error } = await db.from("crm_pipelines").insert([
      { organization_id: ORG, name: "Foxtrot", slug: "foxtrot", position: 60, is_default: false },
      { organization_id: ORG, name: "Golfe", slug: "golfe", position: 70 },
    ]);
    expect(error?.code).toBe("23502");
    expect((await funis()).length, "o lote recusado deixou linha para trás").toBe(antes);
  });

  it("UMA linha segue como sempre foi: a coluna ausente fica com o default", async () => {
    const { error } = await db.from("crm_pipelines").insert({ organization_id: ORG, name: "Hotel", slug: "hotel", position: 80 });
    expect(error).toBeNull();
    expect((await funis()).find((f) => f.name === "Hotel")?.is_default).toBe(false);
  });
});

describe("`range` e `neq` na leitura", () => {
  it("`range(de, ate)` é a página, com as duas pontas inclusas", async () => {
    const pagina = async (de: number, ate: number) => {
      const { data } = await db
        .from("crm_pipelines")
        .select("name")
        .eq("organization_id", ORG)
        .eq("is_default", false)
        .order("position")
        .range(de, ate);
      return (data as Array<{ name: string }>).map((x) => x.name);
    };
    expect(await pagina(0, 1)).toEqual(["Alfa", "Bravo"]);
    expect(await pagina(2, 3)).toEqual(["Charlie", "Delta"]);
    // Depois do fim, vazio: é o que encerra o laço de quem lê de página em página.
    expect(await pagina(50, 59)).toEqual([]);
  });

  it("`neq` tira quem é igual, e não traz quem é NULO (o `<>` do SQL, como no PostgREST)", async () => {
    const { data } = await db
      .from("crm_pipelines")
      .select("name")
      .eq("organization_id", ORG)
      .eq("is_default", false)
      .neq("description", "tem texto")
      .order("position");
    expect((data as Array<{ name: string }>).map((x) => x.name)).toEqual(["Delta"]);
  });
});

describe("`delete`", () => {
  it("apaga SÓ o que o filtro alcança, e com `.select()` devolve o que apagou", async () => {
    const { data, error } = await db
      .from("crm_pipelines")
      .delete()
      .eq("organization_id", ORG)
      .in("slug", ["charlie", "eco"])
      .select("name");
    expect(error).toBeNull();
    expect((data as Array<{ name: string }>).map((x) => x.name).sort()).toEqual(["Charlie", "Eco"]);
    expect((await funis()).map((f) => f.name)).toEqual(["Alfa", "Bravo", "Delta", "Hotel"]);
  });

  it("filtro que não casa com nada não apaga nada", async () => {
    const { error } = await db.from("crm_pipelines").delete().eq("organization_id", ORG).eq("slug", "nao-existe");
    expect(error).toBeNull();
    expect((await funis()).length).toBe(4);
  });

  it("⭐ SEM FILTRO é erro, e a tabela fica inteira", async () => {
    const { error } = await db.from("crm_pipelines").delete();
    expect(error?.message).toContain("WHERE");
    expect((await funis()).length, "um delete sem filtro apagou linhas").toBe(4);
  });
});

describe("`upsert`", () => {
  const jornada = async () => {
    const { rows } = await pool.query<{ is_available: boolean; capacity: number; schedule: unknown }>(
      "select is_available, capacity, schedule from attendant_availability where organization_id = $1 and user_id = $2",
      [ORG, PESSOA],
    );
    return rows;
  };

  it("a primeira vez INSERE", async () => {
    const { error } = await db
      .from("attendant_availability")
      .upsert({ organization_id: ORG, user_id: PESSOA, is_available: true, capacity: 3 }, { onConflict: "organization_id,user_id" });
    expect(error).toBeNull();
    expect(await jornada()).toEqual([{ is_available: true, capacity: 3, schedule: {} }]);
  });

  it("⭐ a segunda ATUALIZA a mesma linha, só nas colunas que vieram", async () => {
    const { error } = await db
      .from("attendant_availability")
      .upsert(
        { organization_id: ORG, user_id: PESSOA, schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "08:00", end: "12:00" }] } },
        { onConflict: "organization_id,user_id" },
      );
    expect(error).toBeNull();
    const linhas = await jornada();
    expect(linhas, "o upsert duplicou a linha").toHaveLength(1);
    // `capacity` não veio na segunda chamada e continua 3.
    expect(linhas[0]).toMatchObject({ is_available: true, capacity: 3 });
    expect(linhas[0]!.schedule).toEqual({ timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "08:00", end: "12:00" }] });
  });

  it("`ignoreDuplicates` deixa a linha que existe como está", async () => {
    const { error } = await db
      .from("attendant_availability")
      .upsert({ organization_id: ORG, user_id: PESSOA, capacity: 9 }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });
    expect(error).toBeNull();
    expect((await jornada())[0]!.capacity).toBe(3);
  });

  it("sem `onConflict` ESTOURA: o adaptador não conhece a chave primária e não adivinha", () => {
    expect(() => db.from("attendant_availability").upsert({ organization_id: ORG, user_id: PESSOA })).toThrow(/não está implementado/);
  });
});

describe("array: coluna jsonb x coluna de lista", () => {
  it("CONTROLE: o banco recusa um array do Postgres numa coluna jsonb", async () => {
    // É o que o driver mandaria sozinho. Sem a decisão pelo tipo da coluna, é
    // este o erro que o código veria.
    await expect(
      pool.query("update crm_pipelines set vocabulary = $1 where organization_id = $2 and slug = 'alfa'", [["a", "b"], ORG]),
    ).rejects.toThrow();
  });

  it("⭐ array em coluna jsonb é gravado como JSON, inclusive o array VAZIO", async () => {
    const gravar = async (valor: unknown[]) => {
      const { error } = await db.from("crm_pipelines").update({ vocabulary: valor }).eq("organization_id", ORG).eq("slug", "alfa");
      expect(error).toBeNull();
      const { rows } = await pool.query<{ vocabulary: unknown }>(
        "select vocabulary from crm_pipelines where organization_id = $1 and slug = 'alfa'",
        [ORG],
      );
      return rows[0]!.vocabulary;
    };
    expect(await gravar([{ type: "add_tag", tags: ["a"] }])).toEqual([{ type: "add_tag", tags: ["a"] }]);
    expect(await gravar(["a", "b"])).toEqual(["a", "b"]);
    expect(await gravar([])).toEqual([]);
  });

  it("array em coluna de LISTA (`text[]`) continua lista do Postgres", async () => {
    const { data, error } = await db
      .from("contacts")
      .insert({ organization_id: ORG, name: "Contato do adaptador", phone_number: "+5500900009017", tags: ["vip", "indicacao"] })
      .select("tags")
      .single();
    expect(error).toBeNull();
    expect((data as { tags: string[] }).tags).toEqual(["vip", "indicacao"]);
    const { rows } = await pool.query<{ tipo: string; n: number }>(
      "select pg_typeof(tags)::text as tipo, cardinality(tags) as n from contacts where organization_id = $1",
      [ORG],
    );
    expect(rows[0]).toEqual({ tipo: "text[]", n: 2 });
  });
});

describe("o que o adaptador do upstream já fazia continua sendo feito por ele", () => {
  it("a cadeia de filtros atravessa o embrulho: `neq` no meio, e `maybeSingle` no fim", async () => {
    const { data, error } = await db
      .from("crm_pipelines")
      .select("name")
      .eq("organization_id", ORG)
      .neq("slug", "bravo")
      .eq("slug", "alfa")
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ name: "Alfa" });
  });

  it("update com filtro e retorno: as linhas alcançadas voltam", async () => {
    const { data } = await db.from("crm_pipelines").update({ description: "reescrita" }).eq("organization_id", ORG).eq("slug", "delta").select("name");
    expect(data).toEqual([{ name: "Delta" }]);
  });

  it("CONTROLE: sem o embrulho, o adaptador do upstream segue estourando em `delete` e `neq`", () => {
    const doUpstream = pgComoSupabase(pool);
    expect(() => doUpstream.from("crm_pipelines").delete()).toThrow(/não está implementado/);
    expect(() => doUpstream.from("crm_pipelines").select("id").neq("id", "x")).toThrow(/não está implementado/);
  });

  it("método que nem o embrulho tem ESTOURA, não devolve vazio", () => {
    const consulta = db.from("crm_pipelines").select("id") as unknown as { ilike?: unknown };
    expect(consulta.ilike).toBeUndefined();
  });
});

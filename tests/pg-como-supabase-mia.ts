/**
 * FORK MIA — o que o MCP de implantação precisou do `pg-como-supabase` e ele
 * não tinha: `delete`, `upsert`, INSERT de várias linhas, `range`, `neq` e
 * array em coluna jsonb.
 *
 * ═══ POR QUE AO LADO, E NÃO DENTRO ═══
 *
 * `tests/pg-como-supabase.ts` é do upstream, muda com frequência e tem um
 * invariante próprio que AFIRMA que `delete` e `neq` estouram. Implementá-los
 * lá dentro reprovaria esse invariante e criaria um conflito a cada fusão. A
 * regra do fork é a de sempre: o nosso mora ao lado do dele. Este arquivo
 * EMBRULHA o adaptador do upstream: o que ele já faz continua sendo feito por
 * ele (leitura, filtros, embed, update, rpc), e só o que falta é escrito aqui.
 *
 * ═══ O QUE ENTRA, E COMO ═══
 *
 *  - `neq(col, v)` na leitura vira o `.not(col, "eq", v)` que o upstream já
 *    implementa (`<>`, com a mesma consequência do PostgREST: nulo não volta).
 *  - `range(de, ate)` pede ao upstream as `ate + 1` primeiras linhas e descarta
 *    as `de` primeiras. Mesma página, na mesma ordem.
 *  - INSERT (de uma ou de várias linhas), `upsert` e `delete` têm construtor
 *    próprio. O insert do upstream devolve `null` num `await` direto mesmo com
 *    `.select()`; o PostgREST devolve as linhas, e é com elas que o código
 *    conta o que gravou.
 *  - ARRAY EM COLUNA JSONB. O driver escreve um array do JavaScript como array
 *    do Postgres (`{a,b}`), certo para `text[]` e errado para `jsonb` (as ações
 *    de uma regra de automação): o banco recusa. E não dá para decidir pelo
 *    valor, porque `[]` é a lista vazia nos dois casos. O PostgREST decide pelo
 *    TIPO DA COLUNA, então aqui também: o catálogo é lido uma vez, e array em
 *    coluna (ou argumento de função) json vai como texto JSON.
 *
 * ═══ O MESMO CONTRATO DO UPSTREAM ═══
 *
 * Método que não existe ESTOURA, nunca devolve vazio. E o instrumento é medido
 * antes de medir: `tests/invariants/pg-como-supabase-mia.test.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";

import { pgComoSupabase, type RespostaFalsa } from "./pg-como-supabase";

type Linha = Record<string, unknown>;

function naoImplementado(metodo: string): never {
  throw new Error(
    `[pg-como-supabase-mia] '${metodo}' não está implementado. ` +
      "Implemente-o (com caso no teste do adaptador) em vez de contornar: " +
      "método ausente que devolvesse vazio faria o teste passar medindo nada.",
  );
}

function erroDe(e: unknown): { message: string; code?: string } {
  const bruto = e as { message?: string; code?: string };
  return { message: bruto?.message ?? String(e), code: bruto?.code };
}

/** Aspas em cada coluna: `position` e `order` são palavras vivas no SQL. */
function colunasSql(colunas: string): string {
  if (colunas.trim() === "*") return "*";
  return colunas
    .split(",")
    .map((c) => `"${c.trim()}"`)
    .join(", ");
}

interface Catalogo {
  /** tabela → colunas json/jsonb. */
  colunas: Map<string, Set<string>>;
  /** função → argumentos json/jsonb. */
  argumentos: Map<string, Set<string>>;
}

async function lerCatalogo(pool: pg.Pool): Promise<Catalogo> {
  const agrupar = (linhas: Array<{ dono: string; nome: string }>) => {
    const mapa = new Map<string, Set<string>>();
    for (const l of linhas) {
      const nomes = mapa.get(l.dono) ?? new Set<string>();
      nomes.add(l.nome);
      mapa.set(l.dono, nomes);
    }
    return mapa;
  };
  const colunas = await pool.query<{ dono: string; nome: string }>(
    `select table_name as dono, column_name as nome from information_schema.columns
      where table_schema = 'public' and udt_name in ('json', 'jsonb')`,
  );
  const argumentos = await pool.query<{ dono: string; nome: string }>(
    `select p.proname as dono, a.nome
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral unnest(p.proargnames, coalesce(p.proallargtypes, p.proargtypes::oid[])) as a(nome, tipo)
       join pg_type t on t.oid = a.tipo
      where n.nspname = 'public' and a.nome is not null and t.typname in ('json', 'jsonb')`,
  );
  return { colunas: agrupar(colunas.rows), argumentos: agrupar(argumentos.rows) };
}

const SEM_JSON: ReadonlySet<string> = new Set();

/** Array em coluna json vira texto JSON. O resto segue como o upstream trata. */
function comArraysEmJson(linha: Linha, json: ReadonlySet<string>): Linha {
  return Object.fromEntries(
    Object.entries(linha).map(([k, v]) => [k, Array.isArray(v) && json.has(k) ? JSON.stringify(v) : v]),
  );
}

/** O valor como parâmetro do driver: objeto solto e array em coluna json viram texto JSON. */
function parametro(v: unknown, colunaJson: boolean): unknown {
  if (v === null || typeof v !== "object" || v instanceof Date) return v;
  if (!Array.isArray(v)) return JSON.stringify(v);
  return colunaJson ? JSON.stringify(v) : v;
}

/**
 * `neq` e `range` em cima da leitura do upstream, sem reescrever a leitura.
 *
 * Os métodos de filtro dele devolvem `this`; o embrulho devolve a si mesmo no
 * lugar, senão o segundo método da cadeia já falaria com o objeto de dentro e
 * o `neq` voltaria a estourar.
 */
function leituraComNeqERange<T extends object>(consulta: T): T {
  let salto = 0;
  const dentro = consulta as unknown as Record<string, (...args: unknown[]) => unknown>;
  const embrulho: T = new Proxy(consulta, {
    get(alvo, prop) {
      if (prop === "neq") {
        return (coluna: string, valor: unknown) => {
          dentro.not!(coluna, "eq", valor);
          return embrulho;
        };
      }
      if (prop === "range") {
        return (de: number, ate: number) => {
          salto = de;
          dentro.limit!(ate + 1);
          return embrulho;
        };
      }
      if (salto > 0 && (prop === "single" || prop === "maybeSingle")) {
        return () => naoImplementado(`range(...).${String(prop)}()`);
      }
      if (prop === "then" && salto > 0) {
        return (aoResolver?: (v: unknown) => unknown, aoRejeitar?: (r: unknown) => unknown) =>
          (alvo as unknown as PromiseLike<RespostaFalsa<unknown[]>>)
            .then((r) => (Array.isArray(r.data) ? { ...r, data: r.data.slice(salto) } : r))
            .then(aoResolver, aoRejeitar);
      }
      const valor = Reflect.get(alvo, prop, alvo) as unknown;
      if (typeof valor !== "function") return valor;
      return (...args: unknown[]) => {
        const r = (valor as (...a: unknown[]) => unknown).apply(alvo, args);
        return r === alvo ? embrulho : r;
      };
    },
  });
  return embrulho;
}

/**
 * INSERT (de uma ou de várias linhas) e UPSERT.
 *
 * Várias linhas: as colunas são a UNIÃO das chaves, e a chave que falta numa
 * linha vai como NULL. É o que o supabase-js faz por padrão num insert em lote,
 * e é a diferença que importa: a linha sem a coluna NÃO recebe o default da
 * tabela. Numa linha só a união é a própria linha, e a coluna ausente fica com
 * o default.
 */
class EscritaEmLote<T> implements PromiseLike<RespostaFalsa<unknown>> {
  private colunasDeVolta: string | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tabela: string,
    private readonly linhas: Linha[],
    private readonly json: ReadonlySet<string>,
    private readonly conflito: { colunas: string; ignorar: boolean } | null,
  ) {}

  select(colunas = "*"): this {
    this.colunasDeVolta = colunas;
    return this;
  }

  private montar(): { texto: string; valores: unknown[] } {
    const chaves = [...new Set(this.linhas.flatMap((l) => Object.keys(l)))];
    const valores: unknown[] = [];
    const grupos = this.linhas.map((linha) => {
      const marcas = chaves.map((k) => {
        valores.push(parametro(k in linha ? linha[k] : null, this.json.has(k)));
        return `$${valores.length}`;
      });
      return `(${marcas.join(", ")})`;
    });
    let texto = `insert into public."${this.tabela}" (${chaves.map((k) => `"${k}"`).join(", ")}) values ${grupos.join(", ")}`;
    if (this.conflito) {
      const alvo = colunasSql(this.conflito.colunas);
      texto += this.conflito.ignorar
        ? ` on conflict (${alvo}) do nothing`
        : ` on conflict (${alvo}) do update set ${chaves.map((k) => `"${k}" = excluded."${k}"`).join(", ")}`;
    }
    if (this.colunasDeVolta) texto += ` returning ${colunasSql(this.colunasDeVolta)}`;
    return { texto, valores };
  }

  private async rodar(): Promise<RespostaFalsa<T[]>> {
    if (this.linhas.length === 0) return { data: this.colunasDeVolta !== null ? [] : null, error: null };
    const { texto, valores } = this.montar();
    try {
      const r = await this.pool.query(texto, valores);
      return { data: this.colunasDeVolta !== null ? (r.rows as T[]) : null, error: null };
    } catch (e) {
      return { data: null, error: erroDe(e) };
    }
  }

  async single(): Promise<RespostaFalsa<T>> {
    const r = await this.rodar();
    if (r.error) return { data: null, error: r.error };
    if ((r.data ?? []).length !== 1) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: r.data![0]!, error: null };
  }

  async maybeSingle(): Promise<RespostaFalsa<T>> {
    const r = await this.rodar();
    if (r.error) return { data: null, error: r.error };
    if ((r.data ?? []).length > 1) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: r.data?.[0] ?? null, error: null };
  }

  then<R1 = RespostaFalsa<unknown>, R2 = never>(
    aoResolver?: ((v: RespostaFalsa<unknown>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.rodar()
      .then((r) => r as RespostaFalsa<unknown>)
      .then(aoResolver, aoRejeitar);
  }
}

/**
 * DELETE com filtros: `.delete().eq(a, b).in(c, [...])`.
 *
 * ⚠️ SEM FILTRO É ERRO, e não "apaga tudo": o PostgREST recusa um DELETE sem
 * condição. Um adaptador que o aceitasse deixaria passar aqui o código que em
 * produção é recusado, ou esvaziaria a tabela do teste e faria os casos
 * seguintes passarem por não haver mais nada para conferir.
 */
class Remocao<T> implements PromiseLike<RespostaFalsa<unknown>> {
  private filtros: Array<[string, string, unknown]> = [];
  private colunasDeVolta: string | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tabela: string,
  ) {}

  eq(coluna: string, valor: unknown): this {
    this.filtros.push(["=", coluna, valor]);
    return this;
  }

  neq(coluna: string, valor: unknown): this {
    this.filtros.push(["<>", coluna, valor]);
    return this;
  }

  in(coluna: string, valores: readonly unknown[]): this {
    this.filtros.push(["= any", coluna, [...valores]]);
    return this;
  }

  select(colunas = "*"): this {
    this.colunasDeVolta = colunas;
    return this;
  }

  private async rodar(): Promise<RespostaFalsa<T[]>> {
    if (this.filtros.length === 0) {
      return { data: null, error: { message: "DELETE requires a WHERE clause", code: "21000" } };
    }
    const valores: unknown[] = [];
    const onde = this.filtros.map(([op, c, v]) => {
      valores.push(v);
      return op === "= any" ? `"${c}" = any($${valores.length})` : `"${c}" ${op} $${valores.length}`;
    });
    let texto = `delete from public."${this.tabela}" where ${onde.join(" and ")}`;
    if (this.colunasDeVolta) texto += ` returning ${colunasSql(this.colunasDeVolta)}`;
    try {
      const r = await this.pool.query(texto, valores);
      return { data: this.colunasDeVolta !== null ? (r.rows as T[]) : null, error: null };
    } catch (e) {
      return { data: null, error: erroDe(e) };
    }
  }

  then<R1 = RespostaFalsa<unknown>, R2 = never>(
    aoResolver?: ((v: RespostaFalsa<unknown>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.rodar()
      .then((r) => r as RespostaFalsa<unknown>)
      .then(aoResolver, aoRejeitar);
  }
}

/**
 * O adaptador do upstream, com o que a implantação precisa por cima.
 *
 * É assíncrono porque lê o catálogo (quais colunas e argumentos são json) uma
 * vez, antes da primeira consulta. O catálogo é o do banco NAQUELE instante:
 * um teste que crie coluna jsonb depois de pedir o cliente pede outro cliente.
 */
export async function pgComoSupabaseMia(pool: pg.Pool): Promise<SupabaseClient> {
  const base = pgComoSupabase(pool) as unknown as {
    from: (tabela: string) => {
      select: (colunas?: string) => object;
      update: (patch: Linha) => unknown;
    };
    rpc: (nome: string, args?: Linha) => unknown;
  };
  const catalogo = await lerCatalogo(pool);

  return {
    from(tabela: string) {
      const json = catalogo.colunas.get(tabela) ?? SEM_JSON;
      const doUpstream = base.from(tabela);
      return {
        select: (colunas = "*") => leituraComNeqERange(doUpstream.select(colunas)),
        insert: (linha: Linha | Linha[]) => new EscritaEmLote(pool, tabela, Array.isArray(linha) ? linha : [linha], json, null),
        update: (patch: Linha) => doUpstream.update(comArraysEmJson(patch, json)),
        delete: () => new Remocao(pool, tabela),
        upsert: (linha: Linha | Linha[], opcoes?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
          // Sem `onConflict` o PostgREST usa a chave primária, que o adaptador
          // não conhece: adivinhar "id" faria o upsert virar insert numa tabela
          // de chave composta.
          if (!opcoes?.onConflict) return naoImplementado("upsert sem onConflict");
          return new EscritaEmLote(pool, tabela, Array.isArray(linha) ? linha : [linha], json, {
            colunas: opcoes.onConflict,
            ignorar: opcoes.ignoreDuplicates === true,
          });
        },
      };
    },
    rpc: (nome: string, args: Linha = {}) => base.rpc(nome, comArraysEmJson(args, catalogo.argumentos.get(nome) ?? SEM_JSON)),
  } as unknown as SupabaseClient;
}

/**
 * FORK MIA · CLIENTE MODELO — por onde a semente escreve.
 *
 * A mesma semente sai de dois jeitos, e é o MESMO código que decide o que
 * gravar nos dois:
 *
 *  - DIRETO: conectada ao Postgres (`pg`), com parâmetros `$1, $2…`;
 *  - ROTEIRO: sem conexão nenhuma, gera o texto SQL inteiro (`begin; … commit;`)
 *    para quem só alcança o banco por um endpoint que recebe SQL — o
 *    `/pg/query` do postgres-meta atrás do Kong, no Supabase de produção da MIA,
 *    que não expõe o Postgres para fora.
 *
 * Por isso a semente não LÊ nada do banco para decidir o que escrever: toda
 * decisão que depende do banco (a coluna da 9010 existe? o slug é de outra
 * empresa? o usuário daquele e-mail existe? que colunas `auth.users` tem?) é
 * escrita em SQL e roda lá, do mesmo jeito nos dois modos.
 */
import type pg from "pg";

/** Valor que vai para uma coluna `jsonb`. */
export class Json {
  constructor(readonly valor: unknown) {}
}
export const json = (valor: unknown) => new Json(valor);

/** Expressão SQL crua (constante do código, nunca entrada de fora): entra no texto como está. */
export class Sql {
  constructor(readonly texto: string) {}
}
export const sql = (texto: string) => new Sql(texto);

export type Valor = string | number | boolean | null | Date | readonly string[] | Json | Sql;

export interface Escritor {
  /**
   * Executa um comando (direto) ou o acrescenta ao roteiro. Devolve quantas
   * linhas ele afetou, ou `null` no roteiro, onde isso só se sabe ao aplicar.
   */
  executar(comando: string, parametros?: readonly Valor[]): Promise<number | null>;
}

function texto(s: string): string {
  // Com barra invertida, `E''` deixa o sentido independente de
  // `standard_conforming_strings`; sem ela, a forma simples.
  return s.includes("\\") ? `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'` : `'${s.replace(/'/g, "''")}'`;
}

/** O valor como literal SQL — para o roteiro e para os blocos `do` dos dois modos. */
export function literal(v: Valor): string {
  if (v === null) return "null";
  if (v instanceof Sql) return v.texto;
  if (v instanceof Json) return `${texto(JSON.stringify(v.valor))}::jsonb`;
  if (v instanceof Date) return `${texto(v.toISOString())}::timestamptz`;
  if (Array.isArray(v)) return v.length === 0 ? `'{}'::text[]` : `array[${v.map((x) => texto(x)).join(", ")}]::text[]`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`cliente modelo: número inválido para SQL: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return texto(v as string);
}

function paraParametro(v: Valor): unknown {
  if (v instanceof Json) return JSON.stringify(v.valor);
  if (v instanceof Sql) throw new Error("cliente modelo: expressão SQL crua não vai como parâmetro");
  return v;
}

export function escritorDireto(db: pg.ClientBase): Escritor {
  return {
    async executar(comando, parametros = []) {
      const r = await db.query(comando, parametros.map(paraParametro));
      return r.rowCount ?? 0;
    },
  };
}

export interface EscritorDeRoteiro extends Escritor {
  /** Os comandos acumulados, cada um terminado em `;`. */
  comandos(): string[];
}

export function escritorDeRoteiro(): EscritorDeRoteiro {
  const acumulados: string[] = [];
  return {
    async executar(comando, parametros = []) {
      const pronto = comando.replace(/\$(\d+)\b/g, (_, n: string) => {
        const i = Number(n) - 1;
        if (i < 0 || i >= parametros.length) throw new Error(`cliente modelo: parâmetro $${n} sem valor`);
        return literal(parametros[i]!);
      });
      acumulados.push(`${pronto.trim().replace(/;\s*$/, "")};`);
      return null;
    },
    comandos: () => [...acumulados],
  };
}

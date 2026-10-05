/**
 * Um cliente Supabase de mentira com TABELAS DE VERDADE em memória.
 *
 * Existe para os testes da trava da IA (fork MIA, `lib/ai/trava-da-ia.ts`): a
 * pergunta ali é "QUAL provedor/modelo/chave foi gravado em qual linha", e um
 * dublê que devolve linha fixa por formato de `select` não consegue medir isso.
 *
 * Cobre o subconjunto do supabase-js que as rotas de agente usam: `select` com
 * `eq`/`is`/`in`/`not`/`order`/`limit`, `insert`, `update`, `upsert`, `delete`,
 * `single`/`maybeSingle` e a lista aguardada direto. Cada escrita fica
 * registrada em `escritas`, na ordem.
 *
 * O `select` responde às duas opções de contagem como o PostgREST:
 * `{ count: "exact" }` devolve `count` com o total que passou nos filtros (antes
 * do `range`/`limit`), e `{ head: true }` devolve só a contagem, sem linha.
 * Sem a opção, `count` vem `null`. Antes o dublê ignorava as duas, e toda
 * contagem no banco chegava ao código como `undefined` (fork MIA, .74).
 */
import { randomUUID } from "node:crypto";

export type Linha = Record<string, unknown>;

export interface Escrita {
  tabela: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: Linha | Linha[] | null;
  linhas: Linha[];
}

type Filtro = (l: Linha) => boolean;

/**
 * Uma função do banco de mentira. Recebe os argumentos da chamada e as tabelas
 * (para ler e escrever nelas, como a função de verdade faria).
 */
export type RpcDeMentira = (
  args: Record<string, unknown>,
  db: Record<string, Linha[]>,
) => { data: unknown; error: { message: string; code?: string } | null };

export function bancoEmMemoria(
  tabelas: Record<string, Linha[]> = {},
  /** As funções do banco que o teste precisa de pé. Sem entrada, a chamada devolve `null`, como sempre. */
  rpcs: Record<string, RpcDeMentira> = {},
  /**
   * `maxRows`: o teto de linhas por resposta do PostgREST (1000 em produção).
   * Corta TODA leitura nesse tamanho, sem erro, por maior que seja o `limit` ou
   * o `range`. Ausente = sem corte, que é o que os testes que não falam de
   * volume querem.
   */
  opcoes: { maxRows?: number } = {},
) {
  const maxRows = opcoes.maxRows ?? Number.POSITIVE_INFINITY;
  const db: Record<string, Linha[]> = {};
  for (const [nome, linhas] of Object.entries(tabelas)) db[nome] = linhas.map((l) => ({ ...l }));
  const escritas: Escrita[] = [];
  const chamadasRpc: Array<{ nome: string; args: unknown }> = [];
  const tabela = (nome: string) => (db[nome] ??= []);

  function consulta(nome: string) {
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Linha | Linha[] | null = null;
    // Uma entrada por `.order()`, na ordem em que foram pedidas: a segunda só
    // desempata a primeira, como no PostgREST.
    const ordens: Array<{ col: string; asc: boolean }> = [];
    let limite = Number.POSITIVE_INFINITY;
    let inicio = 0;
    // `select(colunas, { count: "exact", head: true })`.
    let contar = false;
    let soContagem = false;
    // `upsert(p, { onConflict: "a,b" })`: as colunas que identificam a linha. Sem
    // elas o upsert se comporta como insert (o que os testes antigos esperam).
    let conflito: { colunas: string[]; ignorar: boolean } | null = null;

    function executar(): { data: Linha[]; error: null; count: number | null } {
      const r = escreverOuLer();
      // Escrita não conta. Na leitura, o total é o que passou nos filtros.
      return { data: r.data, error: null, count: r.total };
    }

    function escreverOuLer(): { data: Linha[]; total: number | null } {
      const t = tabela(nome);
      if (op === "upsert" && conflito) {
        const { colunas, ignorar } = conflito;
        const saida: Linha[] = [];
        for (const p of Array.isArray(payload) ? payload : [payload ?? {}]) {
          const existente = t.find((l) => colunas.every((c) => l[c] === p[c]));
          if (existente) {
            if (!ignorar) Object.assign(existente, p);
            if (!ignorar) saida.push(existente);
            continue;
          }
          const nova = { id: randomUUID(), ...p };
          t.push(nova);
          saida.push(nova);
        }
        escritas.push({ tabela: nome, op, payload, linhas: saida });
        return { data: saida, total: null };
      }
      if (op === "insert" || op === "upsert") {
        const novas = (Array.isArray(payload) ? payload : [payload ?? {}]).map((p) => ({
          id: randomUUID(),
          ...p,
        }));
        t.push(...novas);
        escritas.push({ tabela: nome, op, payload, linhas: novas });
        return { data: novas, total: null };
      }
      const alvo = t.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of alvo) Object.assign(l, payload);
        escritas.push({ tabela: nome, op, payload, linhas: alvo });
        return { data: alvo, total: null };
      }
      if (op === "delete") {
        db[nome] = t.filter((l) => !alvo.includes(l));
        escritas.push({ tabela: nome, op, payload: null, linhas: alvo });
        return { data: alvo, total: null };
      }
      const r = [...alvo];
      if (ordens.length > 0) {
        r.sort((a, b) => {
          for (const { col, asc } of ordens) {
            const va = a[col] as number | string;
            const vb = b[col] as number | string;
            const c = va < vb ? -1 : va > vb ? 1 : 0;
            if (c !== 0) return c * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      return {
        data: soContagem ? [] : r.slice(inicio, inicio + Math.min(limite, maxRows)),
        total: contar ? r.length : null,
      };
    }

    const q: Record<string, unknown> = {
      select: (_colunas?: string, o?: { count?: string; head?: boolean }) => {
        // Depois de uma escrita (`insert(...).select()`) as opções não mudam nada.
        if (op === "select") {
          contar = o?.count === "exact";
          soContagem = o?.head === true;
        }
        return q;
      },
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
      not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) !== v), q),
      lt: (c: string, v: unknown) => (
        filtros.push((l) => (l[c] as string | number) < (v as string | number)),
        q
      ),
      gt: (c: string, v: unknown) => (
        filtros.push((l) => (l[c] as string | number) > (v as string | number)),
        q
      ),
      gte: (c: string, v: unknown) => (
        filtros.push((l) => (l[c] as string | number) >= (v as string | number)),
        q
      ),
      lte: (c: string, v: unknown) => (
        filtros.push((l) => (l[c] as string | number) <= (v as string | number)),
        q
      ),
      order: (col: string, o?: { ascending?: boolean }) => (
        ordens.push({ col, asc: o?.ascending !== false }),
        q
      ),
      limit: (n: number) => ((limite = n), q),
      // `range(de, ate)`, inclusivo nas duas pontas, como no PostgREST.
      range: (de: number, ate: number) => ((inicio = de), (limite = ate - de + 1), q),
      insert: (p: Linha | Linha[]) => ((op = "insert"), (payload = p), q),
      upsert: (p: Linha | Linha[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => (
        (op = "upsert"),
        (payload = p),
        (conflito = o?.onConflict
          ? {
              colunas: o.onConflict.split(",").map((c) => c.trim()),
              ignorar: o.ignoreDuplicates === true,
            }
          : null),
        q
      ),
      update: (p: Linha) => ((op = "update"), (payload = p), q),
      delete: () => ((op = "delete"), q),
      maybeSingle: async () => ({ data: executar().data[0] ?? null, error: null }),
      single: async () => {
        const d = executar().data[0] ?? null;
        return { data: d, error: d ? null : { message: "nenhuma linha", code: "PGRST116" } };
      },
      then: (
        ok: (v: { data: Linha[] | null; error: null; count: number | null }) => unknown,
        falha?: (e: unknown) => unknown,
      ) => {
        try {
          const r = executar();
          // Com `head: true` o PostgREST não devolve corpo.
          return Promise.resolve(ok(soContagem && op === "select" ? { ...r, data: null } : r));
        } catch (e) {
          return falha ? Promise.resolve(falha(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  }

  const cliente = {
    from: (nome: string) => consulta(nome),
    rpc: async (nome: string, args: unknown) => {
      chamadasRpc.push({ nome, args });
      const funcao = rpcs[nome];
      if (funcao) return funcao((args ?? {}) as Record<string, unknown>, db);
      return { data: null, error: null };
    },
  };

  return { cliente, db, escritas, tabela, chamadasRpc };
}

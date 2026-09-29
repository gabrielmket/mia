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

export function bancoEmMemoria(tabelas: Record<string, Linha[]> = {}) {
  const db: Record<string, Linha[]> = {};
  for (const [nome, linhas] of Object.entries(tabelas)) db[nome] = linhas.map((l) => ({ ...l }));
  const escritas: Escrita[] = [];
  const tabela = (nome: string) => (db[nome] ??= []);

  function consulta(nome: string) {
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Linha | Linha[] | null = null;
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = Number.POSITIVE_INFINITY;

    function executar(): { data: Linha[]; error: null } {
      const t = tabela(nome);
      if (op === "insert" || op === "upsert") {
        const novas = (Array.isArray(payload) ? payload : [payload ?? {}]).map((p) => ({
          id: randomUUID(),
          ...p,
        }));
        t.push(...novas);
        escritas.push({ tabela: nome, op, payload, linhas: novas });
        return { data: novas, error: null };
      }
      const alvo = t.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of alvo) Object.assign(l, payload);
        escritas.push({ tabela: nome, op, payload, linhas: alvo });
        return { data: alvo, error: null };
      }
      if (op === "delete") {
        db[nome] = t.filter((l) => !alvo.includes(l));
        escritas.push({ tabela: nome, op, payload: null, linhas: alvo });
        return { data: alvo, error: null };
      }
      const r = [...alvo];
      if (ordem) {
        const { col, asc } = ordem;
        r.sort((a, b) => {
          const va = a[col] as number | string;
          const vb = b[col] as number | string;
          return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      return { data: r.slice(0, limite), error: null };
    }

    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
      not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) !== v), q),
      order: (col: string, o?: { ascending?: boolean }) => ((ordem = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      insert: (p: Linha | Linha[]) => ((op = "insert"), (payload = p), q),
      upsert: (p: Linha | Linha[]) => ((op = "upsert"), (payload = p), q),
      update: (p: Linha) => ((op = "update"), (payload = p), q),
      delete: () => ((op = "delete"), q),
      maybeSingle: async () => ({ data: executar().data[0] ?? null, error: null }),
      single: async () => {
        const d = executar().data[0] ?? null;
        return { data: d, error: d ? null : { message: "nenhuma linha", code: "PGRST116" } };
      },
      then: (ok: (v: { data: Linha[]; error: null }) => unknown, falha?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(ok(executar()));
        } catch (e) {
          return falha ? Promise.resolve(falha(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  }

  const cliente = {
    from: (nome: string) => consulta(nome),
    rpc: async () => ({ data: null, error: null }),
  };

  return { cliente, db, escritas, tabela };
}

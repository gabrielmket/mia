/**
 * Um cliente Supabase EM MEMÓRIA para as leituras do assistente (MIA-244).
 *
 * Cobre a cadeia que as leituras usam (`select`, `eq`, `neq`, `in`, `not`, `is`,
 * `gt`, `gte`, `lt`, `lte`, `order`, `limit`, `range`, `single`, `maybeSingle`,
 * `count: "exact"` com `head`) e imita o que o PostgREST desta instalação faz e
 * que um mock "aceita tudo" esconde:
 *
 *   - no máximo `maxLinhas` (1.000) linhas por resposta, sem erro nem aviso;
 *   - `count: "exact"` conta tudo, sem o teto;
 *   - uma tabela pode FALHAR (`falhas`), devolvendo `{ error }` como o PostgREST.
 *
 * As colunas pedidas e os joins embutidos são ignorados: a linha volta inteira.
 * Não é RLS: o recorte de quem vê o quê está nos invariantes.
 */
type Linha = Record<string, unknown>;
type Filtro = (l: Linha) => boolean;

export interface OpcoesDoBanco {
  maxLinhas?: number;
  /** Tabela que responde com erro (o objeto vai em `error`). */
  falhas?: Record<string, { message: string; code?: string }>;
}

function lista(valor: string): string[] {
  return valor
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((v) => v.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function comparar(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return String(a) < String(b) ? -1 : 1;
}

export function bancoEmMemoria(tabelas: Record<string, Linha[]>, opcoes: OpcoesDoBanco = {}) {
  const maxLinhas = opcoes.maxLinhas ?? 1000;
  const pedidos: Array<{ tabela: string; contagem: boolean }> = [];

  function construtor(tabela: string) {
    const filtros: Filtro[] = [];
    let contagem = false;
    let cabeca = false;
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let faixa: [number, number] | null = null;
    let uma: "single" | "maybe" | null = null;

    const executar = () => {
      pedidos.push({ tabela, contagem });
      const falha = opcoes.falhas?.[tabela];
      if (falha) return { data: null, error: falha, count: null };
      let linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      const total = linhas.length;
      if (ordem) {
        const { coluna, asc } = ordem;
        linhas = [...linhas].sort((a, b) => (asc ? 1 : -1) * comparar(a[coluna], b[coluna]));
      }
      if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
      if (limite !== null) linhas = linhas.slice(0, limite);
      linhas = linhas.slice(0, maxLinhas);
      if (uma) {
        const primeira = linhas[0] ?? null;
        if (uma === "single" && !primeira) return { data: null, error: { message: "nenhuma linha", code: "PGRST116" }, count: null };
        return { data: primeira, error: null, count: null };
      }
      return { data: cabeca ? null : linhas, error: null, count: contagem ? total : null };
    };

    const q = {
      select(_colunas?: string, o?: { count?: string; head?: boolean }) {
        contagem = o?.count === "exact";
        cabeca = o?.head === true;
        return q;
      },
      eq(c: string, v: unknown) {
        filtros.push((l) => l[c] === v);
        return q;
      },
      neq(c: string, v: unknown) {
        filtros.push((l) => l[c] !== v);
        return q;
      },
      in(c: string, vs: readonly unknown[]) {
        const set = new Set(vs);
        filtros.push((l) => set.has(l[c]));
        return q;
      },
      is(c: string, v: null | boolean) {
        filtros.push((l) => (v === null ? l[c] === null || l[c] === undefined : l[c] === v));
        return q;
      },
      not(c: string, op: string, v: unknown) {
        if (op === "in") {
          const set = new Set(lista(String(v)));
          filtros.push((l) => !set.has(String(l[c])));
        } else if (op === "is") {
          filtros.push((l) => !(l[c] === null || l[c] === undefined));
        } else {
          filtros.push((l) => l[c] !== v);
        }
        return q;
      },
      gt(c: string, v: unknown) {
        filtros.push((l) => comparar(l[c], v) > 0);
        return q;
      },
      gte(c: string, v: unknown) {
        filtros.push((l) => l[c] !== null && l[c] !== undefined && comparar(l[c], v) >= 0);
        return q;
      },
      lt(c: string, v: unknown) {
        filtros.push((l) => l[c] !== null && l[c] !== undefined && comparar(l[c], v) < 0);
        return q;
      },
      lte(c: string, v: unknown) {
        filtros.push((l) => l[c] !== null && l[c] !== undefined && comparar(l[c], v) <= 0);
        return q;
      },
      or() {
        return q;
      },
      order(c: string, o?: { ascending?: boolean }) {
        ordem = { coluna: c, asc: o?.ascending !== false };
        return q;
      },
      limit(n: number) {
        limite = n;
        return q;
      },
      range(a: number, b: number) {
        faixa = [a, b];
        return q;
      },
      single() {
        uma = "single";
        return Promise.resolve(executar());
      },
      maybeSingle() {
        uma = "maybe";
        return Promise.resolve(executar());
      },
      then<R>(ok: (v: ReturnType<typeof executar>) => R, falhou?: (e: unknown) => R) {
        return Promise.resolve(executar()).then(ok, falhou);
      },
    };
    return q;
  }

  const db = {
    supabaseKey: "chave-anon-de-teste",
    from: (tabela: string) => construtor(tabela),
    rpc: async () => ({ data: null, error: { message: "rpc fora deste teste" } }),
  };
  return { db, pedidos };
}

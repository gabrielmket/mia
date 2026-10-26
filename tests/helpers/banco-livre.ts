/**
 * FORK MIA (.90) — um dublê do cliente do PostgREST que aceita QUALQUER método
 * de filtro (gt, lte, like, range…), grava a cadeia e responde pelo `responder`
 * do caso. Para os testes de `lib/planos-mia/` e da compra de créditos, que
 * usam filtros que o dublê da cobrança não conhece.
 */
export interface PassoLivre {
  metodo: string;
  args: unknown[];
}
export interface CadeiaLivre {
  tabela: string;
  passos: PassoLivre[];
}
export interface RespostaLivre {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

const ESCRITAS = new Set(["insert", "update", "delete", "upsert"]);

export function bancoLivre(
  responder: (cadeia: CadeiaLivre) => RespostaLivre = () => ({}),
  responderRpc: (nome: string, args: Record<string, unknown>) => RespostaLivre = () => ({}),
) {
  const cadeias: CadeiaLivre[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const resolver = (cadeia: CadeiaLivre) => Promise.resolve({ data: null, error: null, count: null, ...responder(cadeia) });
  const cliente = {
    from(tabela: string) {
      const cadeia: CadeiaLivre = { tabela, passos: [] };
      cadeias.push(cadeia);
      const builder: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_alvo, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => resolver(cadeia).then(ok, erro);
            }
            if (prop === "maybeSingle" || prop === "single") {
              return () => {
                cadeia.passos.push({ metodo: String(prop), args: [] });
                return resolver(cadeia);
              };
            }
            return (...args: unknown[]) => {
              cadeia.passos.push({ metodo: String(prop), args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return { data: null, error: null, ...responderRpc(nome, args) };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  };
  return { cliente, cadeias, rpcs };
}

export function operacaoLivre(cadeia: CadeiaLivre): string {
  return cadeia.passos.find((p) => ESCRITAS.has(p.metodo))?.metodo ?? "select";
}
export function argumentosLivres(cadeia: CadeiaLivre, metodo: string): unknown[] | undefined {
  return cadeia.passos.find((p) => p.metodo === metodo)?.args;
}
export function filtroLivre(cadeia: CadeiaLivre, metodo: string, coluna: string): unknown {
  return cadeia.passos.find((p) => p.metodo === metodo && p.args[0] === coluna)?.args[1];
}

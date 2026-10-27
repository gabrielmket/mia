/**
 * FORK MIA (.96) · um Asaas de mentira por ROTA (método + caminho), para os
 * testes do passo "Pagamento". Nenhuma chamada sai daqui. Grava cada chamada
 * (método, caminho, corpo) para os testes conferirem o que foi ao Asaas.
 */
export interface ChamadaAoAsaas {
  metodo: string;
  caminho: string;
  corpo: string;
}

type Resposta = { status?: number; corpo?: unknown } | ((c: ChamadaAoAsaas) => { status?: number; corpo?: unknown });

export function asaasFalso(rotas: Record<string, Resposta | Resposta[]>) {
  const chamadas: ChamadaAoAsaas[] = [];
  const filas = new Map(Object.entries(rotas).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const caminho = u.pathname.replace(/^\/v3/, "") + u.search;
    const c: ChamadaAoAsaas = { metodo: init?.method ?? "GET", caminho, corpo: String(init?.body ?? "") };
    chamadas.push(c);
    const chave = Object.keys(rotas).find((k) => {
      const [metodo, padrao] = k.split(" ") as [string, string];
      return metodo === c.metodo && new RegExp(`^${padrao}$`).test(u.pathname.replace(/^\/v3/, ""));
    });
    const fila = chave ? filas.get(chave) : undefined;
    const proxima = fila && fila.length > 1 ? fila.shift() : fila?.[0];
    const r = typeof proxima === "function" ? proxima(c) : (proxima ?? { status: 404, corpo: {} });
    return new Response(r.corpo === undefined ? "" : JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchFalso, chamadas };
}

export const CHAVE_DE_TESTE = ["$aact", "hmlg", "000000000000000000000000000000"].join("_");

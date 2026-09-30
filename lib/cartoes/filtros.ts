/**
 * FORK MIA — os filtros do quadro que o upstream não tem: CANAL, FAIXA e ORDEM.
 *
 * "Dono" já existe (o filtro "Responsável" do upstream, `lib/kanban/filters.ts`)
 * e não é duplicado aqui.
 *
 * Moram na URL, como os do upstream (link colado no grupo abre o quadro já
 * filtrado), mas em parâmetros PRÓPRIOS — `canal`, `faixa`, `ordem` — e com
 * serializador próprio. O `setFilters` da página reescreve a query string a
 * partir dos filtros do upstream; `preservarParametrosDoCartao` é o que impede
 * essa reescrita de apagar os nossos a cada clique no filtro de responsável.
 */
import type { Lead } from "@/lib/types/leads";
import { ORDEM_PADRAO, ORDENS_DO_QUADRO, type OrdemDoQuadro } from "@/lib/cartoes/urgencia";
import { SIGLAS_DE_CANAL, type SiglaDoCanal } from "@/lib/cartoes/tipos";

export const FAIXAS_DO_FILTRO = ["quente", "morno", "frio", "sem"] as const;
export type FaixaDoFiltro = (typeof FAIXAS_DO_FILTRO)[number];

export const ROTULO_DA_FAIXA = {
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
  sem: "Sem faixa",
} as const satisfies Record<FaixaDoFiltro, string>;

export interface FiltrosDoCartao {
  canal: SiglaDoCanal | null;
  faixa: FaixaDoFiltro | null;
  ordem: OrdemDoQuadro;
}

export const PARAMETROS_DO_CARTAO = ["canal", "faixa", "ordem"] as const;

/** Valor fora do vocabulário vira "sem filtro": a URL é deep-link, não API. */
export function lerFiltrosDoCartao(sp: { get(chave: string): string | null }): FiltrosDoCartao {
  const canal = sp.get("canal");
  const faixa = sp.get("faixa");
  const ordem = sp.get("ordem");
  return {
    canal: (SIGLAS_DE_CANAL as readonly string[]).includes(canal ?? "") ? (canal as SiglaDoCanal) : null,
    faixa: (FAIXAS_DO_FILTRO as readonly string[]).includes(faixa ?? "") ? (faixa as FaixaDoFiltro) : null,
    ordem: (ORDENS_DO_QUADRO as readonly string[]).includes(ordem ?? "")
      ? (ordem as OrdemDoQuadro)
      : ORDEM_PADRAO,
  };
}

/** Escreve os nossos parâmetros por cima de uma query string. A ordem padrão não vai para a URL. */
export function escreverFiltrosDoCartao(qs: string, f: FiltrosDoCartao): string {
  const p = new URLSearchParams(qs);
  for (const chave of PARAMETROS_DO_CARTAO) p.delete(chave);
  if (f.canal) p.set("canal", f.canal);
  if (f.faixa) p.set("faixa", f.faixa);
  if (f.ordem !== ORDEM_PADRAO) p.set("ordem", f.ordem);
  return p.toString();
}

/**
 * A query string que os filtros do upstream acabaram de montar, com os nossos
 * parâmetros que estavam na URL. Sem isto, mudar o responsável apagaria o canal.
 */
export function preservarParametrosDoCartao(
  qsDoUpstream: string,
  atual: { get(chave: string): string | null },
): string {
  return escreverFiltrosDoCartao(qsDoUpstream, lerFiltrosDoCartao(atual));
}

export function faixaDoLead(lead: Pick<Lead, "score">): FaixaDoFiltro {
  return lead.score?.band ?? "sem";
}

export function aplicarFiltrosDoCartao<T extends Pick<Lead, "score" | "cartao">>(
  leads: T[],
  f: FiltrosDoCartao,
): T[] {
  return leads.filter((l) => {
    if (f.canal && l.cartao?.canal.sigla !== f.canal) return false;
    if (f.faixa && faixaDoLead(l) !== f.faixa) return false;
    return true;
  });
}

export function temFiltroDoCartao(f: FiltrosDoCartao): boolean {
  return f.canal !== null || f.faixa !== null || f.ordem !== ORDEM_PADRAO;
}

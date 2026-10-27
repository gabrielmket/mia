"use client";

/**
 * FORK MIA (.93) — as TRILHAS do "Me mostra como", do lado da tela.
 *
 *   useTrilhas()        a situação de cada trilha para a pessoa (`GET /api/v1/assistente/trilhas`)
 *   useGuiaDaTrilha()   a guia que está andando NESTA aba (uma por vez)
 *   comecarATrilha()    começa ou retoma; a guia na tela (`GuiaNaTela`) assume
 *   comecarOGuiaDoManual()  o guia curto de um manual que tem tela, sem progresso
 *
 * A guia mora num estado do módulo, e não num contexto do React, porque quem
 * começa (o painel do assistente, a página, o Início, o "O que falta") e quem
 * anda (`GuiaNaTela`, montada ao lado do botão do topo) estão em árvores
 * diferentes. Ela fica guardada na aba (`sessionStorage`) para sobreviver a uma
 * navegação; entre abas e dias, quem guarda é o banco (o passo onde parou).
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { apiClient } from "@/lib/api/client";
import { trilhaPorId, type IdDaTrilha } from "@/lib/assistente/trilhas/catalogo";

export interface SituacaoDaTrilhaNaTela {
  id: IdDaTrilha;
  estado: "feita" | "pausada" | "andando" | "nova" | "espera" | "sem_modulo";
  passo: number | null;
  de: number;
  quando: string | null;
  feita_na_empresa: boolean;
  quem_fez: string | null;
  do_papel: boolean;
  esperando: IdDaTrilha | null;
}

export interface PessoaQuePode {
  user_id: string;
  nome: string;
}

export interface EstadoDasTrilhas {
  disponivel: boolean;
  papel?: string;
  me_mostra_como: boolean;
  recomendada: IdDaTrilha | null;
  trilhas: SituacaoDaTrilhaNaTela[];
  quem_pode: { manager: PessoaQuePode | null; admin: PessoaQuePode | null } | null;
}

export const CHAVE_DAS_TRILHAS = ["assistente", "trilhas"] as const;

export function useTrilhas(opcoes: { ativo?: boolean } = {}) {
  return useQuery({
    enabled: opcoes.ativo ?? true,
    queryKey: CHAVE_DAS_TRILHAS,
    staleTime: 15_000,
    queryFn: () => apiClient.get<{ data: EstadoDasTrilhas }>("/api/v1/assistente/trilhas").then((r) => r.data),
  });
}

export interface ProgressoNaTela {
  trilha: IdDaTrilha;
  situacao: "andando" | "pausada" | "feita";
  passo: number;
  passo_max: number;
  comecou_em: string;
}

export interface ConferidoNaTela {
  ok: boolean;
  vars: Record<string, string>;
  ids: Record<string, string>;
  feita: boolean;
  fim: string | null;
}

type Acao = "comecar" | "retomar" | "avancar" | "pausar" | "conferir" | "ja_fiz" | "pergunta";

export function postarNaTrilha<T>(corpo: { acao: Acao; trilha: IdDaTrilha; passo?: number; de_novo?: boolean }): Promise<T> {
  return apiClient.post<{ data: T }>("/api/v1/assistente/trilhas", corpo, { timeoutMs: 20_000 }).then((r) => r.data);
}

// ── a guia desta aba ─────────────────────────────────────────────────────────

/** O guia curto de um manual que tem tela (sem trilha no catálogo, sem progresso). */
export interface GuiaDeManual {
  id: string;
  titulo: string;
  href: string;
  passos: string[];
}

export interface GuiaAtiva {
  /** A trilha do catálogo, ou `null` no guia curto de um manual. */
  trilha: IdDaTrilha | null;
  manual: GuiaDeManual | null;
  passo: number;
  /** O que foi conferido em cada passo ("Nome gravado: Recepção."). */
  feitos: Record<number, string>;
  vars: Record<string, string>;
  ids: Record<string, string>;
  /** A frase do fim, quando a trilha ficou feita. */
  fim: string | null;
  /** Um endereço para a guia levar a pessoa assim que montar (ao retomar). */
  ir: string | null;
  /** Ao retomar: o recado de onde seguiu. */
  retomada: boolean;
  /** Muda a cada começo: a guia na tela sabe que é outra trilha. */
  vez: number;
}

const GUARDA = "mia-guia-da-trilha";
let atual: GuiaAtiva | null = null;
let lida = false;
const ouvintes = new Set<() => void>();

function lerDaAba(): GuiaAtiva | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(GUARDA);
    if (!bruto) return null;
    const g = JSON.parse(bruto) as GuiaAtiva;
    if (g.trilha && !trilhaPorId(g.trilha)) return null;
    if (!g.trilha && !g.manual) return null;
    return { ...g, ir: null };
  } catch {
    return null;
  }
}

function avisar() {
  for (const o of ouvintes) o();
}

export function guiaAtual(): GuiaAtiva | null {
  if (!lida) {
    lida = true;
    atual = lerDaAba();
  }
  return atual;
}

export function definirGuia(g: GuiaAtiva | null): void {
  lida = true;
  atual = g;
  try {
    if (g) window.sessionStorage.setItem(GUARDA, JSON.stringify(g));
    else window.sessionStorage.removeItem(GUARDA);
  } catch {
    // Sem a guarda da aba (janela anônima, armazenamento cheio): a guia segue na memória.
  }
  avisar();
}

export function mudarGuia(muda: (g: GuiaAtiva) => GuiaAtiva): void {
  const g = guiaAtual();
  if (g) definirGuia(muda(g));
}

export function useGuiaDaTrilha(): GuiaAtiva | null {
  return useSyncExternalStore(
    (ouvir) => {
      ouvintes.add(ouvir);
      return () => ouvintes.delete(ouvir);
    },
    guiaAtual,
    () => null,
  );
}

/**
 * Começa a trilha (ou retoma de onde parou). O servidor confere o papel e a
 * empresa, grava o passo e devolve onde ela estava. Retomar volta ao passo que
 * abre a tela do que se perdeu (`retomaEm`) e leva a pessoa até lá: é a única
 * coisa que a guia faz sozinha.
 */
export async function comecarATrilha(id: IdDaTrilha, opcoes: { retomar?: boolean; deNovo?: boolean } = {}): Promise<void> {
  const trilha = trilhaPorId(id);
  if (!trilha) return;
  const r = await postarNaTrilha<{ progresso: ProgressoNaTela | null }>({
    acao: opcoes.retomar ? "retomar" : "comecar",
    trilha: id,
    de_novo: opcoes.deNovo,
  });
  let passo = 0;
  if (opcoes.retomar && r.progresso && r.progresso.situacao !== "feita") {
    const parado = Math.min(r.progresso.passo, trilha.passos.length - 1);
    const doPasso = trilha.passos[parado];
    passo = doPasso?.retomaEm != null ? Math.min(doPasso.retomaEm, parado) : parado;
  }
  const doPassoDeRetomada = trilha.passos[passo];
  const ir = opcoes.retomar
    ? (doPassoDeRetomada?.ir ?? (doPassoDeRetomada?.tela && !doPassoDeRetomada.tela.includes("[") ? doPassoDeRetomada.tela : null))
    : null;
  definirGuia({
    trilha: id,
    manual: null,
    passo,
    feitos: {},
    vars: {},
    ids: {},
    fim: null,
    ir: ir ?? null,
    retomada: Boolean(opcoes.retomar) && passo > 0,
    vez: Date.now(),
  });
}

/** O guia curto de um manual que tem tela: os passos do manual, com a tela conferida. */
export function comecarOGuiaDoManual(manual: GuiaDeManual): void {
  definirGuia({ trilha: null, manual, passo: 0, feitos: {}, vars: {}, ids: {}, fim: null, ir: null, retomada: false, vez: Date.now() });
}

/**
 * A pessoa perguntou ao assistente durante um passo: conta no passo (só o
 * número, para a Time ver onde travam). Sem guia andando, nada.
 */
export function contarPerguntaNaTrilha(): void {
  const g = guiaAtual();
  if (!g?.trilha || g.fim) return;
  void postarNaTrilha({ acao: "pergunta", trilha: g.trilha, passo: g.passo }).catch(() => undefined);
}

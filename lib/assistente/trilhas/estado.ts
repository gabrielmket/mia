/**
 * FORK MIA (.93) — EM QUE PÉ ESTÁ CADA TRILHA, para cada pessoa, e qual o
 * assistente recomenda agora.
 *
 * Régua do protótipo (tela 2, "Quando uma trilha conta como feita"):
 *
 *   - as de PÔR DE PÉ são da empresa: ligar o número, montar o agente, o
 *     horário da IA e o convite ficam feitos para todos quando aparecem no
 *     sistema, com quem fez;
 *   - as de APRENDER são de cada pessoa: ficam feitas para quem fez;
 *   - o "onde parei" é sempre da pessoa: a gestora pausar não muda a trilha do
 *     administrador;
 *   - nada conta pelo clique em "concluir" (esse botão não existe): a linha
 *     feita só é gravada depois que o servidor conferiu no sistema.
 *
 * Módulo PURO: a rota, o MCP e a tela usam a mesma régua.
 */
import type { Role } from "@/lib/auth/types";

import { ehIdDeTrilha, papelFaz, TRILHAS, trilhaPorId, type IdDaTrilha, type Trilha } from "./catalogo";

export const SITUACOES_DO_PROGRESSO = ["andando", "pausada", "feita"] as const;
export type SituacaoDoProgresso = (typeof SITUACOES_DO_PROGRESSO)[number];

/** Uma linha de `mia_assistente_trilhas` (9090), na forma do código. */
export interface ProgressoDaTrilha {
  trilha: IdDaTrilha;
  situacao: SituacaoDoProgresso;
  passo: number;
  passo_max: number;
  comecou_em: string;
  pausou_em: string | null;
  feita_em: string | null;
  vezes: number;
}

export interface ConfigDasTrilhas {
  /** O "Me mostra como" (o destaque na tela). Desligado, o assistente só explica. */
  meMostraComo: boolean;
  desligadas: IdDaTrilha[];
  recomendada: IdDaTrilha | null;
  /** `false` = ninguém gravou; vale o padrão. */
  gravada: boolean;
}

export const CONFIG_PADRAO_DAS_TRILHAS: ConfigDasTrilhas = {
  meMostraComo: true,
  desligadas: [],
  recomendada: null,
  gravada: false,
};

/** A linha do banco na forma do código; linha ausente é o padrão. */
export function configDasTrilhasDaLinha(linha: Record<string, unknown> | null | undefined): ConfigDasTrilhas {
  if (!linha) return { ...CONFIG_PADRAO_DAS_TRILHAS, desligadas: [] };
  const desligadas = Array.isArray(linha.desligadas) ? linha.desligadas.filter(ehIdDeTrilha) : [];
  return {
    meMostraComo: linha.me_mostra_como !== false,
    desligadas: [...new Set(desligadas)],
    recomendada: ehIdDeTrilha(linha.recomendada) ? linha.recomendada : null,
    gravada: true,
  };
}

/** Uma linha do banco na forma do código, ou `null` quando não é uma trilha conhecida. */
export function progressoDaLinha(linha: Record<string, unknown>): ProgressoDaTrilha | null {
  if (!ehIdDeTrilha(linha.trilha)) return null;
  const situacao = SITUACOES_DO_PROGRESSO.includes(linha.situacao as SituacaoDoProgresso)
    ? (linha.situacao as SituacaoDoProgresso)
    : "andando";
  const inteiro = (v: unknown) => (Number.isInteger(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    trilha: linha.trilha,
    situacao,
    passo: inteiro(linha.passo),
    passo_max: inteiro(linha.passo_max),
    comecou_em: typeof linha.comecou_em === "string" ? linha.comecou_em : new Date(0).toISOString(),
    pausou_em: typeof linha.pausou_em === "string" ? linha.pausou_em : null,
    feita_em: typeof linha.feita_em === "string" ? linha.feita_em : null,
    vezes: Math.max(1, inteiro(linha.vezes)),
  };
}

export type EstadoDaTrilha = "feita" | "pausada" | "andando" | "nova" | "espera" | "sem_modulo";

export interface SituacaoDaTrilha {
  id: IdDaTrilha;
  estado: EstadoDaTrilha;
  /** Pausada ou andando: em que passo (0 = o primeiro). */
  passo: number | null;
  /** Quantos passos ela tem. */
  de: number;
  /** Quando pausou ou ficou feita. */
  quando: string | null;
  /** Da empresa e feita no sistema (vale para todos). */
  feitaNaEmpresa: boolean;
  /** Quem fez, quando se sabe (o nome de quem terminou a trilha). */
  quemFez: string | null;
  /** A pessoa faz esta trilha (o MESMO papel da tela)? As outras aparecem para ler os passos e pedir. */
  doPapel: boolean;
  /** A trilha de que esta depende, quando ainda não está feita. */
  esperando: IdDaTrilha | null;
}

export interface EntradaDaSituacao {
  papel: Role | string | null;
  /** O progresso da PESSOA (as linhas dela). */
  progresso: readonly ProgressoDaTrilha[];
  /** As trilhas da empresa que o sistema mostra feitas agora (a leitura do objetivo). */
  feitasNaEmpresa: ReadonlySet<IdDaTrilha>;
  /** Quem terminou cada trilha da empresa, quando a leitura alcança (gestor em diante). */
  quemFez?: ReadonlyMap<IdDaTrilha, string>;
  /** Os módulos contratados que as trilhas pedem. */
  modulos: ReadonlySet<string>;
  config: ConfigDasTrilhas;
}

/** A situação de UMA trilha para a pessoa. */
export function situacaoDaTrilha(t: Trilha, e: EntradaDaSituacao): SituacaoDaTrilha {
  const p = e.progresso.find((x) => x.trilha === t.id) ?? null;
  const base = {
    id: t.id,
    de: t.passos.length,
    doPapel: papelFaz(t, e.papel),
    feitaNaEmpresa: false,
    quemFez: null as string | null,
    esperando: null as IdDaTrilha | null,
  };
  if (t.daEmpresa && e.feitasNaEmpresa.has(t.id)) {
    return { ...base, estado: "feita", passo: null, quando: p?.feita_em ?? null, feitaNaEmpresa: true, quemFez: e.quemFez?.get(t.id) ?? null };
  }
  if (p?.situacao === "feita" && !t.daEmpresa) return { ...base, estado: "feita", passo: null, quando: p.feita_em };
  if (p?.situacao === "pausada") return { ...base, estado: "pausada", passo: Math.min(p.passo, t.passos.length - 1), quando: p.pausou_em };
  if (p?.situacao === "andando") return { ...base, estado: "andando", passo: Math.min(p.passo, t.passos.length - 1), quando: p.comecou_em };
  if (t.modulo && !e.modulos.has(t.modulo)) return { ...base, estado: "sem_modulo", passo: null, quando: null };
  if (t.depende) {
    const dep = trilhaPorId(t.depende);
    const depFeita = dep
      ? dep.daEmpresa
        ? e.feitasNaEmpresa.has(dep.id)
        : e.progresso.some((x) => x.trilha === dep.id && x.situacao === "feita")
      : true;
    if (!depFeita) return { ...base, estado: "espera", passo: null, quando: null, esperando: t.depende };
  }
  return { ...base, estado: "nova", passo: null, quando: null };
}

/** As trilhas que a empresa vê (as desligadas pela Time saem), com a situação de cada uma. */
export function situacoesDasTrilhas(e: EntradaDaSituacao): SituacaoDaTrilha[] {
  return TRILHAS.filter((t) => !e.config.desligadas.includes(t.id)).map((t) => situacaoDaTrilha(t, e));
}

/**
 * A trilha recomendada agora (o Início, a saudação do assistente e a lista):
 * a que a Time escolheu para a empresa, se ainda faz sentido para a pessoa; se
 * não, a primeira PAUSADA do papel dela; se não, a primeira que FALTA, na ordem
 * do catálogo. Guia curto não é recomendado (é resposta de "como faço").
 */
export function trilhaRecomendada(situacoes: readonly SituacaoDaTrilha[], config: ConfigDasTrilhas): IdDaTrilha | null {
  const candidatas = situacoes.filter((s) => s.doPapel && !trilhaPorId(s.id)?.curto);
  const escolhida = config.recomendada ? candidatas.find((s) => s.id === config.recomendada) : undefined;
  if (escolhida && (escolhida.estado === "nova" || escolhida.estado === "pausada" || escolhida.estado === "andando")) return escolhida.id;
  const pausada = candidatas.find((s) => s.estado === "pausada" || s.estado === "andando");
  if (pausada) return pausada.id;
  return candidatas.find((s) => s.estado === "nova")?.id ?? null;
}

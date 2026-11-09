/**
 * FORK MIA (.88) — "COMO ESTÁ MINHA PERFORMANCE?" e "QUANTO A EQUIPE VENDEU?":
 * o motor de relatórios do fork e as metas, nada recalculado aqui.
 *
 *   vendas   `fn_mia_relatorio` (9030/9041), o motor dos painéis e do montador.
 *            É `security invoker`: com o cliente da sessão, conta só o que a RLS
 *            de `crm_leads` deixa a pessoa ver no CRM. Fonte `negocios`, por
 *            situação; no escopo próprio, filtrada pelo dono (`resp`).
 *   metas    `lerMetasDoMes`, a MESMA leitura do `GET /api/v1/metas`.
 *
 * Nenhuma soma, taxa ou meta é refeita aqui: o número do assistente é o número
 * da tela (regra "Números" do protótipo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerMetasDoMes } from "@/lib/crm/metas/ler-do-mes";
import { consultarMotor, numero, RecusaDoMotor, type RespostaDoMotor } from "@/lib/paineis/motor";

import { nomeDaPessoa, type Escopo, type PessoaDaEquipe } from "./comum";

/** FORK MIA (.106): qualquer período do motor; "pers" com `de` e `ate` (AAAA-MM-DD). */
export type PeriodoDaPerformance = "hoje" | "7" | "30" | "90" | "mes" | "mesp" | "pers";

export interface PerformanceLida {
  escopo: Escopo["tipo"];
  periodo: PeriodoDaPerformance;
  janela: { de: string | null; ate: string | null; fuso: string };
  moeda: string;
  ganhos: { quantos: number; valor_cents: number | null };
  perdidos: number;
  abertos_no_periodo: number;
  /** Ganhos ÷ (ganhos + perdidos), de 0 a 1; nulo sem nenhum fechado. */
  taxa_de_ganho: number | null;
  /**
   * A meta da pessoa (escopo próprio) ou da empresa (equipe), do MÊS em `mes`.
   * FORK MIA (.106): lida em qualquer período (antes só em "mes" e "mesp", e o
   * assistente dizia "meta não definida" nos últimos 7 dias).
   */
  meta: { mes: string; alvo_cents: number; realizado_cents: number; fracao: number; falta_cents: number } | null;
  /** FORK MIA (.106): com `comparar`, o período anterior de mesmo tamanho. */
  anterior: {
    janela: { de: string | null; ate: string | null };
    ganhos: { quantos: number; valor_cents: number | null };
    perdidos: number;
    abertos_no_periodo: number;
    taxa_de_ganho: number | null;
  } | null;
  /** Só no escopo da equipe: os ganhos por pessoa, com a meta de cada uma quando há. */
  por_pessoa: Array<{
    user_id: string;
    nome: string;
    ganhos: number;
    valor_cents: number | null;
    meta_fracao: number | null;
  }> | null;
  avisos: string[];
  fontes: string[];
}

/**
 * O mês da meta: o mês passado em "mesp"; o mês das datas em "pers" quando o
 * intervalo cabe num mês só; nos outros, o mês de agora.
 */
export function mesDaMeta(periodo: PeriodoDaPerformance, agora: Date, fuso: string, de?: string | null, ate?: string | null): string {
  if (periodo === "pers" && de && ate && de.slice(0, 7) === ate.slice(0, 7)) return de.slice(0, 7);
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit" })
    .formatToParts(agora);
  const ano = Number(partes.find((p) => p.type === "year")?.value);
  const mes = Number(partes.find((p) => p.type === "month")?.value);
  if (periodo === "mesp") {
    const anterior = new Date(Date.UTC(ano, mes - 2, 1));
    return `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function taxa(ganhos: number, perdidos: number): number | null {
  return ganhos + perdidos > 0 ? Math.round((ganhos / (ganhos + perdidos)) * 1000) / 1000 : null;
}

function grupoDe(resposta: RespostaDoMotor, chave: string) {
  return resposta.grupos.find((g) => g.chave === chave);
}

export async function lerPerformance(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    escopo: Escopo;
    periodo: PeriodoDaPerformance;
    /** FORK MIA (.106): só com `periodo: "pers"`, AAAA-MM-DD no fuso da empresa. */
    de?: string | null;
    ate?: string | null;
    /** FORK MIA (.106): traz o período anterior de mesmo tamanho (o `p_comparar` do motor). */
    comparar?: boolean;
    agora: Date;
    fuso: string;
    equipe: readonly PessoaDaEquipe[];
  },
): Promise<PerformanceLida> {
  const { organizationId: org, escopo, periodo } = entrada;
  const pers = periodo === "pers";
  const de = pers ? (entrada.de ?? null) : null;
  const ate = pers ? (entrada.ate ?? null) : null;
  const proprio = escopo.tipo === "proprio";
  const avisos: string[] = [];
  const filtros: Record<string, string> = proprio ? { resp: escopo.userId } : {};

  let porSituacao: RespostaDoMotor;
  try {
    porSituacao = await consultarMotor(db, {
      organizationId: org,
      fonte: "negocios",
      medidas: ["qtd", "soma"],
      dim1: "situacao",
      filtros,
      periodo,
      de,
      ate,
      comparar: Boolean(entrada.comparar),
    });
  } catch (erro) {
    if (erro instanceof RecusaDoMotor && erro.semPermissao) {
      throw new Error("sem_permissao_no_motor");
    }
    throw erro;
  }

  const ganho = grupoDe(porSituacao, "ganho");
  const perdido = grupoDe(porSituacao, "perdido");
  const aberto = grupoDe(porSituacao, "aberto");
  const ganhos = ganho?.n ?? 0;
  const perdidos = perdido?.n ?? 0;

  // ── por pessoa (só a equipe) ──
  let porPessoa: PerformanceLida["por_pessoa"] = null;
  if (!proprio) {
    const porDono = await consultarMotor(db, {
      organizationId: org,
      fonte: "negocios",
      medidas: ["qtd", "soma"],
      dim1: "resp",
      filtros: { situacao: "ganho" },
      periodo,
      de,
      ate,
    });
    porPessoa = porDono.grupos
      .filter((g) => !g.sem && !g.outros)
      .sort((a, b) => (numero(b, "soma") ?? b.n) - (numero(a, "soma") ?? a.n))
      .slice(0, 12)
      .map((g) => ({
        user_id: g.chave,
        nome: nomeDaPessoa(entrada.equipe, g.chave) ?? "",
        ganhos: g.n,
        valor_cents: numero(g, "soma"),
        meta_fracao: null,
      }));
  }

  // ── a meta do mês (a mesma leitura da tela de metas) ──
  // FORK MIA (.106): lida em QUALQUER período. A meta é do mês: fora de "mes" e
  // "mesp", o aviso deixa claro que o realizado dela é o do mês inteiro.
  let meta: PerformanceLida["meta"] = null;
  const mes = mesDaMeta(periodo, entrada.agora, entrada.fuso, de, ate);
  const leitura = await lerMetasDoMes(db, org, mes);
  if (leitura.ok) {
    const receitas = leitura.dados.metas.filter((m) => m.metrica === "receita_total" && m.agent_id === null);
    const daPessoa = receitas.find((m) => m.user_id === escopo.userId);
    const daEmpresa = receitas.find((m) => m.user_id === null);
    const alvo = proprio ? daPessoa : daEmpresa;
    if (alvo) {
      meta = { mes, alvo_cents: alvo.alvo, realizado_cents: alvo.realizado, fracao: alvo.fracao, falta_cents: alvo.falta };
      if (periodo !== "mes" && periodo !== "mesp") {
        avisos.push(`A meta é do mês (${mes}): o realizado e o que falta são do mês inteiro, não só deste período.`);
      }
    } else {
      avisos.push(`Não há meta cadastrada para o mês ${mes}.`);
    }
    if (porPessoa) {
      for (const p of porPessoa) {
        const m = receitas.find((x) => x.user_id === p.user_id);
        if (m) p.meta_fracao = m.fracao;
      }
    }
    if (leitura.dados.truncado) avisos.push("A leitura da meta passou do teto de linhas e conta só as vendas mais recentes do mês.");
  } else {
    avisos.push("Não deu para ler a meta agora.");
  }

  // ── o período anterior (o motor já calcula; nada refeito aqui) ──
  let anterior: PerformanceLida["anterior"] = null;
  if (entrada.comparar && porSituacao.anterior) {
    const g = porSituacao.anterior.grupos;
    const ganhosAntes = g.ganho?.n ?? 0;
    const perdidosAntes = g.perdido?.n ?? 0;
    const soma = g.ganho?.valores?.soma;
    anterior = {
      janela: { de: porSituacao.anterior.janela.de, ate: porSituacao.anterior.janela.ate },
      ganhos: { quantos: ganhosAntes, valor_cents: typeof soma === "number" ? soma : g.ganho ? null : 0 },
      perdidos: perdidosAntes,
      abertos_no_periodo: g.aberto?.n ?? 0,
      taxa_de_ganho: taxa(ganhosAntes, perdidosAntes),
    };
  } else if (entrada.comparar) {
    avisos.push("Este período não tem anterior para comparar.");
  }

  return {
    escopo: escopo.tipo,
    periodo,
    janela: { de: porSituacao.janela.de, ate: porSituacao.janela.ate, fuso: porSituacao.janela.fuso },
    moeda: porSituacao.moeda,
    ganhos: { quantos: ganhos, valor_cents: ganho ? numero(ganho, "soma") : 0 },
    perdidos,
    abertos_no_periodo: aberto?.n ?? 0,
    taxa_de_ganho: taxa(ganhos, perdidos),
    meta,
    anterior,
    por_pessoa: porPessoa,
    avisos,
    fontes: proprio ? ["Relatórios: meus negócios", "Metas"] : ["Relatórios: negócios por responsável", "Metas"],
  };
}

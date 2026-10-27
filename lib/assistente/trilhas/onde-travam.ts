/**
 * FORK MIA (.93) — ONDE OS CLIENTES TRAVAM: o lado da Time (/admin/assistente e
 * `plataforma_ver_onde_os_clientes_travam`). Protótipo aprovado em 26/10/2026,
 * tela 6, decisão 12.
 *
 * ── O que a Time vê, e o que não vê ─────────────────────────────────────────
 *
 *   Vê: contagens por tema, por trilha, por passo e por tipo de proposta, por
 *       segmento e juntadas; e o TEXTO só das perguntas que ficaram sem
 *       resposta, sem quem perguntou (e com e-mail, telefone e documento
 *       mascarados, caso alguém tenha digitado um).
 *   Não vê: a conversa de ninguém com o assistente, nome de pessoa ou de
 *       contato, nome de empresa, o texto das propostas.
 *
 * O tema de cada pergunta sai da MESMA busca do "como faço" (`ajudaEmOrdem`,
 * sem IA): o manual que responderia a pergunta. O texto é lido aqui só para
 * isso e não sai; o que sai é o título do manual e a contagem.
 *
 * As empresas de demonstração não entram (os números delas são dos dados
 * fictícios). O cliente é o de SERVIÇO: quem chama já conferiu o administrador
 * da plataforma (a rota) ou o token de plataforma (o MCP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehOperante } from "@/lib/organizacao/operante";
import {
  ehSegmentoDoOnboarding,
  segmentoDoEstado,
  SEGMENTOS_DO_ONBOARDING,
  type SegmentoDoOnboarding,
} from "@/lib/onboarding/modelos-de-agente-da-mia";

import { ajudaEmOrdem } from "../leituras/ajuda";
import { MANUAIS } from "../manuais";
import { SO_TRILHAS, TRILHAS, trilhaDoManual, type IdDaTrilha } from "./catalogo";

export const PERIODOS_DO_PAINEL = [7, 30, 90] as const;
export type PeriodoDoPainel = (typeof PERIODOS_DO_PAINEL)[number];
export type SegmentoDoPainel = "todos" | SegmentoDoOnboarding;
export const SEGMENTOS_DO_PAINEL: readonly SegmentoDoPainel[] = ["todos", ...SEGMENTOS_DO_ONBOARDING];

/** Teto de linhas lidas por fonte (paginado de 1000 em 1000, o teto do PostgREST). */
const TETO_DE_LINHAS = 10_000;
/** Trilha pausada há mais disto, sem voltar, conta como abandonada. */
const DIAS_PARA_ABANDONO = 7;

type Db = Pick<SupabaseClient, "from">;

/** Lê todas as linhas (até o teto), de mil em mil. */
async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ linhas: T[]; cortou: boolean }> {
  const linhas: T[] = [];
  for (let de = 0; de < TETO_DE_LINHAS; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < 1000) return { linhas, cortou: false };
  }
  return { linhas, cortou: true };
}

/** Tira do texto o que identifica alguém: e-mail, telefone, documento. */
export function limparTextoDaPergunta(texto: string): string {
  return texto
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[e-mail]")
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface TemaDaPergunta {
  /** O manual que responderia a pergunta, ou `null` (nenhum). */
  manual: string | null;
  titulo: string;
}

const SEM_MANUAL: TemaDaPergunta = { manual: null, titulo: "Sem manual que responda" };

/** O tema de uma pergunta: o manual que a busca do "como faço" traz primeiro. Sem IA. */
export function temaDaPergunta(texto: string, tela: string | null): TemaDaPergunta {
  const achados = ajudaEmOrdem(texto, tela, 3);
  for (const a of achados) {
    if (a.item.fonte === "manual") return { manual: a.item.manual.id, titulo: a.item.manual.titulo };
  }
  return SEM_MANUAL;
}

/** O que já existe para um tema: a trilha, o guia curto do manual, ou nada. */
export function oQueJaExiste(manualId: string | null): "trilha" | "guia_curto" | "sem_manual" {
  if (!manualId) return "sem_manual";
  if (trilhaDoManual(manualId)) return "trilha";
  const m = MANUAIS.find((x) => x.id === manualId);
  return m?.href ? "guia_curto" : "sem_manual";
}

export interface OndeTravam {
  periodo_dias: PeriodoDoPainel;
  segmento: SegmentoDoPainel;
  empresas: { usando: number; no_ar: number };
  perguntas: { total: number; sem_resposta: number; lidas_ate_o_teto: boolean };
  trilhas_resumo: { comecadas: number; feitas: number };
  propostas_resumo: { aplicadas: number; desfeitas: number };
  temas: Array<{ tema: string; manual: string | null; perguntas: number; empresas: number; existe: "trilha" | "guia_curto" | "sem_manual"; trilha: IdDaTrilha | null }>;
  trilhas: Array<{
    id: IdDaTrilha;
    titulo: string;
    comecaram: number;
    feitas: number;
    /** % de quem começou que chegou a cada passo (o passo 1 é 100). */
    chegaram_por_passo: number[];
    maior_queda: { passo: number; pontos: number } | null;
    /** Perguntas ao assistente durante cada passo (só a contagem). */
    perguntas_por_passo: number[];
    /** "Já fiz" que não conferiu, por passo. */
    ja_fiz_sem_conferir_por_passo: number[];
  }>;
  abandonadas: Array<{ id: IdDaTrilha; titulo: string; pausadas_ha_mais_de_7_dias: number; comecaram: number; percentual: number }>;
  propostas: Array<{ tipo: string; criadas: number; aplicadas: number; rejeitadas: number; desfeitas: number; percentual_desfeitas: number }>;
  sem_resposta: Array<{ pergunta: string; vezes: number; empresas: number }>;
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);

export async function ondeOsClientesTravam(
  admin: Db,
  entrada: { periodoDias: PeriodoDoPainel; segmento: SegmentoDoPainel; agora?: Date },
): Promise<OndeTravam> {
  const agora = entrada.agora ?? new Date();
  const desde = new Date(agora.getTime() - entrada.periodoDias * 86_400_000).toISOString();

  // ── as empresas do segmento (sem as de demonstração) ──
  const { linhas: orgs } = await todas<{ id: string; status: string | null; demonstracao: boolean | null; onboarding_state: unknown }>((de, ate) =>
    admin.from("organizations").select("id, status, demonstracao, onboarding_state").order("id", { ascending: true }).range(de, ate),
  );
  const doSegmento = new Set(
    orgs
      .filter((o) => o.demonstracao !== true)
      .filter((o) => {
        if (entrada.segmento === "todos") return true;
        const s = segmentoDoEstado(o.onboarding_state);
        return (s && ehSegmentoDoOnboarding(s) ? s : "outro") === entrada.segmento;
      })
      .map((o) => o.id),
  );
  const noAr = orgs.filter((o) => doSegmento.has(o.id) && ehOperante(o.status ?? "")).length;

  // ── as perguntas: os temas e as que ficaram sem resposta ──
  const perguntas = await todas<{ organization_id: string; texto: string; tela: string | null; sem_resposta: boolean }>((de, ate) =>
    admin
      .from("mia_assistente_mensagens")
      .select("organization_id, texto, tela, sem_resposta")
      .eq("tipo", "pergunta")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .range(de, ate),
  );
  const minhas = perguntas.linhas.filter((p) => doSegmento.has(p.organization_id));
  const usando = new Set(minhas.map((p) => p.organization_id));
  const temas = new Map<string, { tema: TemaDaPergunta; perguntas: number; empresas: Set<string> }>();
  const memo = new Map<string, TemaDaPergunta>();
  const semResposta = new Map<string, { pergunta: string; vezes: number; empresas: Set<string> }>();
  for (const p of minhas) {
    const chave = `${p.tela ?? ""}|${p.texto.trim().toLowerCase()}`;
    const tema = memo.get(chave) ?? temaDaPergunta(p.texto, p.tela);
    memo.set(chave, tema);
    const t = temas.get(tema.titulo) ?? { tema, perguntas: 0, empresas: new Set<string>() };
    t.perguntas += 1;
    t.empresas.add(p.organization_id);
    temas.set(tema.titulo, t);
    if (p.sem_resposta) {
      const limpa = limparTextoDaPergunta(p.texto);
      const k = limpa.toLowerCase();
      const s = semResposta.get(k) ?? { pergunta: limpa, vezes: 0, empresas: new Set<string>() };
      s.vezes += 1;
      s.empresas.add(p.organization_id);
      semResposta.set(k, s);
    }
  }

  // ── as trilhas: em que passo param ──
  const progresso = await todas<{
    organization_id: string;
    trilha: string;
    situacao: string;
    passo_max: number;
    pausou_em: string | null;
    perguntas_no_passo: Record<string, number> | null;
    ja_fiz_sem_conferir: Record<string, number> | null;
  }>((de, ate) =>
    admin
      .from("mia_assistente_trilhas")
      .select("organization_id, trilha, situacao, passo_max, pausou_em, perguntas_no_passo, ja_fiz_sem_conferir")
      .gte("comecou_em", desde)
      .order("comecou_em", { ascending: false })
      .range(de, ate),
  );
  const linhasDasTrilhas = progresso.linhas.filter((l) => doSegmento.has(l.organization_id));
  const limiteDoAbandono = agora.getTime() - DIAS_PARA_ABANDONO * 86_400_000;
  const porTrilha = TRILHAS.map((t) => {
    const daTrilha = linhasDasTrilhas.filter((l) => l.trilha === t.id);
    const n = t.passos.length;
    const chegaram = Array.from({ length: n }, (_, k) =>
      daTrilha.filter((l) => l.situacao === "feita" || Number(l.passo_max) >= k).length,
    );
    const percentuais = chegaram.map((c) => pct(c, daTrilha.length));
    let maior: { passo: number; pontos: number } | null = null;
    for (let k = 1; k < n; k += 1) {
      const queda = percentuais[k - 1]! - percentuais[k]!;
      if (queda > 0 && (!maior || queda > maior.pontos)) maior = { passo: k + 1, pontos: queda };
    }
    const somarPorPasso = (campo: "perguntas_no_passo" | "ja_fiz_sem_conferir") =>
      Array.from({ length: n }, (_, k) => daTrilha.reduce((s, l) => s + (Number((l[campo] ?? {})[String(k)]) || 0), 0));
    const abandonadas = daTrilha.filter((l) => l.situacao === "pausada" && l.pausou_em && new Date(l.pausou_em).getTime() < limiteDoAbandono).length;
    return {
      id: t.id,
      titulo: t.titulo,
      comecaram: daTrilha.length,
      feitas: daTrilha.filter((l) => l.situacao === "feita").length,
      chegaram_por_passo: daTrilha.length > 0 ? percentuais : [],
      maior_queda: daTrilha.length > 0 ? maior : null,
      perguntas_por_passo: somarPorPasso("perguntas_no_passo"),
      ja_fiz_sem_conferir_por_passo: somarPorPasso("ja_fiz_sem_conferir"),
      abandonadas,
    };
  });

  // ── as propostas do assistente: por tipo, aplicadas, recusadas e desfeitas ──
  const propostas = await todas<{ organization_id: string; tipo: string; situacao: string }>((de, ate) =>
    admin
      .from("mia_assistente_propostas")
      .select("organization_id, tipo, situacao")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .range(de, ate),
  ).catch(() => ({ linhas: [] as Array<{ organization_id: string; tipo: string; situacao: string }>, cortou: false }));
  const porTipo = new Map<string, { criadas: number; aplicadas: number; rejeitadas: number; desfeitas: number }>();
  for (const p of propostas.linhas.filter((x) => doSegmento.has(x.organization_id))) {
    const c = porTipo.get(p.tipo) ?? { criadas: 0, aplicadas: 0, rejeitadas: 0, desfeitas: 0 };
    c.criadas += 1;
    if (p.situacao === "aplicada") c.aplicadas += 1;
    if (p.situacao === "rejeitada") c.rejeitadas += 1;
    // A situação "desfeita" chega com o desfazer (a parte "fazer com aprovação"): já conta aqui.
    if (p.situacao === "desfeita") c.desfeitas += 1;
    porTipo.set(p.tipo, c);
  }
  const listaDePropostas = [...porTipo.entries()]
    .map(([tipo, c]) => ({ tipo, ...c, percentual_desfeitas: pct(c.desfeitas, c.aplicadas + c.desfeitas) }))
    .sort((a, b) => b.percentual_desfeitas - a.percentual_desfeitas || b.criadas - a.criadas);

  const comecadas = porTrilha.filter((t) => SO_TRILHAS.some((s) => s.id === t.id)).reduce((s, t) => s + t.comecaram, 0);
  const feitas = porTrilha.filter((t) => SO_TRILHAS.some((s) => s.id === t.id)).reduce((s, t) => s + t.feitas, 0);

  return {
    periodo_dias: entrada.periodoDias,
    segmento: entrada.segmento,
    empresas: { usando: usando.size, no_ar: noAr },
    perguntas: { total: minhas.length, sem_resposta: minhas.filter((p) => p.sem_resposta).length, lidas_ate_o_teto: perguntas.cortou },
    trilhas_resumo: { comecadas, feitas },
    propostas_resumo: {
      aplicadas: listaDePropostas.reduce((s, p) => s + p.aplicadas, 0),
      desfeitas: listaDePropostas.reduce((s, p) => s + p.desfeitas, 0),
    },
    temas: [...temas.values()]
      .map((t) => {
        const existe = oQueJaExiste(t.tema.manual);
        return {
          tema: t.tema.titulo,
          manual: t.tema.manual,
          perguntas: t.perguntas,
          empresas: t.empresas.size,
          existe,
          trilha: t.tema.manual ? (trilhaDoManual(t.tema.manual)?.id ?? null) : null,
        };
      })
      .sort((a, b) => b.perguntas - a.perguntas)
      .slice(0, 15),
    trilhas: porTrilha.map(({ abandonadas: _a, ...t }) => t),
    abandonadas: porTrilha
      .filter((t) => t.comecaram > 0)
      .map((t) => ({ id: t.id, titulo: t.titulo, pausadas_ha_mais_de_7_dias: t.abandonadas, comecaram: t.comecaram, percentual: pct(t.abandonadas, t.comecaram) }))
      .sort((a, b) => b.percentual - a.percentual),
    propostas: listaDePropostas,
    sem_resposta: [...semResposta.values()]
      .map((s) => ({ pergunta: s.pergunta, vezes: s.vezes, empresas: s.empresas.size }))
      .sort((a, b) => b.empresas - a.empresas || b.vezes - a.vezes)
      .slice(0, 20),
  };
}

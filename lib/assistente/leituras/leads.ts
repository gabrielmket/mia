/**
 * FORK MIA (.88) — "COMO ESTÃO MEUS LEADS?": os negócios abertos por dono, os
 * que CHEGARAM no período por origem e por funil, e os que estão em risco.
 *
 *   abertos     `crm_leads` com `status = 'open'`, como o quadro do funil,
 *               contados no BANCO (`count: exact`).
 *   chegaram    `crm_leads` CRIADOS no período (abertos ou não), por origem
 *               (`source`) e por funil (`pipeline_id`), na janela do período no
 *               fuso da empresa (`periodo.ts`, a régua do motor de relatórios).
 *   em risco    o Radar (`carregaRadarDeRisco`), a MESMA função da tela do
 *               Radar e da ferramenta do agente: crítico e em risco pela
 *               janela de esfriamento do próprio estágio.
 *
 * O dono do negócio é `owner_user_id`. No escopo `proprio` só entram os da
 * pessoa; no da `equipe`, a divisão por dono. O funil é opcional, pelo NOME.
 *
 * ── MIA-244: por que a ferramenta nunca respondeu na produção ───────────────
 *
 * 1. O Radar lançava e levava a ferramenta inteira junto: qualquer leitura
 *    dele que falha (a agenda vira `radar_agenda_indisponivel`, por exemplo)
 *    lança. Até a .107 a agenda lia os contatos de todos os abertos num `.in()`
 *    só, que cresce com a base (o upstream passou a ler em lotes na .110, mas
 *    um lote que falha ainda derruba o Radar). Agora o Radar
 *    é uma parte: se ele não responde, os leads saem sem o "em risco", com o
 *    aviso, e a falha vai ao log com o código.
 * 2. A contagem vinha de linhas lidas com `limit(2000)`, e o PostgREST desta
 *    instalação devolve no máximo 1.000: com 1.500 negócios abertos a resposta
 *    seria "1.000", sem aviso. Agora a contagem é do banco, e as listas que
 *    precisam de linhas (por origem, por funil, por dono) vêm em páginas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/auth/types";
import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";
import { logger } from "@/lib/logger";

import { codigoDaFalha, nomeDaPessoa, type Escopo, type PessoaDaEquipe } from "./comum";
import { janelaAnterior, janelaDoPeriodo, type JanelaDoPeriodo } from "./periodo";
import type { PeriodoDaPerformance } from "./performance";

export interface ContagemPorRotulo {
  rotulo: string;
  quantos: number;
}

export interface LeadsQueChegaram {
  periodo: PeriodoDaPerformance;
  janela: { de: string; ate: string; fuso: string };
  /** Negócios CRIADOS no período, abertos ou não. */
  total: number;
  /** Desses, quantos seguem abertos agora. */
  ainda_abertos: number;
  por_origem: ContagemPorRotulo[];
  /** Sem funil pedido: a divisão por funil. Com funil, só ele. */
  por_funil: ContagemPorRotulo[];
  anterior: { janela: { de: string; ate: string }; total: number } | null;
}

export interface LeadsDaPessoa {
  escopo: Escopo["tipo"];
  /** O funil pedido, quando houve. */
  funil: { id: string; nome: string } | null;
  abertos: number;
  chegaram: LeadsQueChegaram;
  /** Nulo quando o Radar não respondeu (veja `avisos`). */
  em_risco: number | null;
  criticos: number | null;
  /** Os primeiros em risco, para o "Ver os 3". Título do negócio e o nome do contato. */
  em_risco_itens: Array<{
    lead_id: string;
    titulo: string;
    contato: string | null;
    horas_parado: number;
    /** As mesmas horas em dias inteiros, para a resposta falar em dias acima de 48 h. */
    dias_parado: number;
    dono: string | null;
  }>;
  /** Só no escopo da equipe. */
  por_dono: Array<{ user_id: string | null; nome: string; abertos: number; em_risco: number }> | null;
  /** Negócios abertos sem dono (só no escopo da equipe). */
  sem_dono: number | null;
  /** A leitura passou do teto de páginas: as divisões contam só parte (o total continua certo). */
  truncado: boolean;
  avisos: string[];
  contatos: string[];
  fontes: string[];
}

/** O funil pedido não existe: a ferramenta devolve os nomes para o modelo escolher. */
export interface FunilNaoEncontrado {
  ok: false;
  motivo: "funil_nao_encontrado";
  funis: string[];
  orientacao: string;
}

/** O PostgREST desta instalação devolve no máximo 1.000 linhas por pedido. */
export const LINHAS_POR_PAGINA = 1000;
/** Teto de páginas por lista (20 mil negócios): acima disso, `truncado`. */
const PAGINAS_NO_MAXIMO = 20;

/** O rótulo da origem gravada no negócio (`crm_leads.source`). */
export function origemLegivel(source: string | null): string {
  const s = (source ?? "").trim();
  if (!s) return "sem origem";
  const conhecidas: Record<string, string> = {
    manual: "cadastro manual",
    meta_ads: "Meta",
    meta: "Meta",
    facebook: "Meta",
    instagram: "Instagram",
    google_ads: "Google",
    google: "Google",
    whatsapp: "WhatsApp",
    site: "site",
    import: "importação",
    api: "integração",
  };
  return conhecidas[s.toLowerCase()] ?? s;
}

/** Sem acento, minúsculas e sem espaço sobrando: "Funil  Comercial" casa com "funil comercial". */
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface Funil {
  id: string;
  nome: string;
  arquivado: boolean;
}

/**
 * O funil pelo nome que a pessoa disse: igual primeiro, depois "funil X", depois
 * o que contém (só se for um). Arquivado só entra se for o único que casa.
 */
export function acharFunil(funis: readonly Funil[], pedido: string): Funil | null {
  const alvo = normalizarNome(pedido).replace(/^funil (de |do |da )?/, "");
  if (!alvo) return null;
  const nomes = funis.map((f) => ({ f, n: normalizarNome(f.nome).replace(/^funil (de |do |da )?/, "") }));
  const preferir = (lista: typeof nomes) => lista.find((x) => !x.f.arquivado)?.f ?? lista[0]?.f ?? null;
  const iguais = nomes.filter((x) => x.n === alvo);
  if (iguais.length > 0) return preferir(iguais);
  const contem = nomes.filter((x) => x.n.includes(alvo) || alvo.includes(x.n));
  const ativos = contem.filter((x) => !x.f.arquivado);
  if (ativos.length === 1) return ativos[0]!.f;
  if (ativos.length === 0 && contem.length === 1) return contem[0]!.f;
  return null;
}

type Consulta = ReturnType<SupabaseClient["from"]>;
type Filtrar = (q: ReturnType<Consulta["select"]>) => ReturnType<Consulta["select"]>;

/** Todas as linhas, em páginas de 1.000 (o teto do PostgREST), até o teto de páginas. */
async function todasAsLinhas<T>(
  db: SupabaseClient,
  colunas: string,
  filtrar: Filtrar,
  codigo: string,
): Promise<{ linhas: T[]; truncado: boolean }> {
  const linhas: T[] = [];
  for (let pagina = 0; pagina < PAGINAS_NO_MAXIMO; pagina += 1) {
    const inicio = pagina * LINHAS_POR_PAGINA;
    const { data, error } = await filtrar(db.from("crm_leads").select(colunas))
      .order("id", { ascending: true })
      .range(inicio, inicio + LINHAS_POR_PAGINA - 1);
    if (error) throw new Error(`${codigo}: ${codigoDaFalha(error)}`);
    const lote = (data ?? []) as T[];
    linhas.push(...lote);
    if (lote.length < LINHAS_POR_PAGINA) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}

async function contar(db: SupabaseClient, filtrar: Filtrar, codigo: string): Promise<number> {
  const { count, error } = await filtrar(db.from("crm_leads").select("id", { count: "exact", head: true }));
  if (error) throw new Error(`${codigo}: ${codigoDaFalha(error)}`);
  return count ?? 0;
}

function contagemOrdenada(mapa: Map<string, number>): ContagemPorRotulo[] {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([rotulo, quantos]) => ({ rotulo, quantos }));
}

export async function lerLeads(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    escopo: Escopo;
    papel: Role;
    agora: Date;
    equipe: readonly PessoaDaEquipe[];
    /** MIA-244: o fuso da empresa, para a janela do período. */
    fuso?: string | null;
    /** MIA-244: o período dos que chegaram (padrão: os últimos 7 dias, como antes). */
    periodo?: { periodo: PeriodoDaPerformance; de?: string | null; ate?: string | null; comparar?: boolean };
    /** MIA-244: o nome do funil, como a pessoa disse. */
    funil?: string | null;
  },
): Promise<LeadsDaPessoa | FunilNaoEncontrado> {
  const { organizationId: org, escopo, agora } = entrada;
  const proprio = escopo.tipo === "proprio";
  const avisos: string[] = [];
  const fontes = ["Funis"];

  // ── o funil, pelo nome ──
  const { data: funisBrutos, error: funisErr } = await db
    .from("crm_pipelines")
    .select("id, name, is_archived")
    .eq("organization_id", org);
  if (funisErr) throw new Error(`leads_funis_indisponiveis: ${codigoDaFalha(funisErr)}`);
  const funis: Funil[] = ((funisBrutos ?? []) as Array<{ id: string; name: string | null; is_archived: boolean | null }>).map((f) => ({
    id: f.id,
    nome: f.name ?? "Funil sem nome",
    arquivado: f.is_archived === true,
  }));
  const nomeDoFunil = new Map(funis.map((f) => [f.id, f.nome]));
  let funil: Funil | null = null;
  if (entrada.funil && entrada.funil.trim()) {
    funil = acharFunil(funis, entrada.funil);
    if (!funil) {
      return {
        ok: false,
        motivo: "funil_nao_encontrado",
        funis: funis.filter((f) => !f.arquivado).map((f) => f.nome),
        orientacao: "Nenhum funil com esse nome. Diga os funis que existem (em funis) e pergunte qual é, ou chame de novo com o nome certo.",
      };
    }
  }

  const doEscopo: Filtrar = (q) => {
    let c = q.eq("organization_id", org);
    if (proprio) c = c.eq("owner_user_id", escopo.userId);
    if (funil) c = c.eq("pipeline_id", funil.id);
    return c;
  };

  // ── abertos: a contagem é do banco ──
  const abertos = await contar(db, (q) => doEscopo(q).eq("status", "open"), "leads_abertos_indisponiveis");

  // ── os que chegaram no período ──
  const periodo = entrada.periodo ?? { periodo: "7" as const };
  const janela = janelaDoPeriodo(periodo, agora, entrada.fuso);
  const naJanela = (j: JanelaDoPeriodo): Filtrar => (q) =>
    doEscopo(q).gte("created_at", j.inicio.toISOString()).lt("created_at", j.fim.toISOString());
  const chegadas = await todasAsLinhas<{ source: string | null; pipeline_id: string | null; status: string | null }>(
    db,
    "source, pipeline_id, status",
    naJanela(janela),
    "leads_chegadas_indisponiveis",
  );
  const porOrigem = new Map<string, number>();
  const porFunil = new Map<string, number>();
  let aindaAbertos = 0;
  for (const l of chegadas.linhas) {
    const o = origemLegivel(l.source);
    porOrigem.set(o, (porOrigem.get(o) ?? 0) + 1);
    const f = l.pipeline_id ? (nomeDoFunil.get(l.pipeline_id) ?? "funil que você não vê") : "sem funil";
    porFunil.set(f, (porFunil.get(f) ?? 0) + 1);
    if (l.status === "open") aindaAbertos += 1;
  }
  let anterior: LeadsQueChegaram["anterior"] = null;
  if (periodo.comparar) {
    const antes = janelaAnterior(janela);
    anterior = {
      janela: { de: antes.de, ate: antes.ate },
      total: await contar(db, naJanela(antes), "leads_chegadas_indisponiveis"),
    };
  }

  // ── o Radar: uma parte, que pode faltar sem levar o resto ──
  let emRisco: Awaited<ReturnType<typeof carregaRadarDeRisco>>["items"] | null = null;
  try {
    const radar = await carregaRadarDeRisco(db, { organizationId: org, humanRole: entrada.papel, limit: 200, now: agora });
    emRisco = radar.items.filter(
      (i) =>
        (i.risk === "critico" || i.risk === "em_risco") &&
        (!proprio || i.owner_user_id === escopo.userId) &&
        (!funil || i.pipeline_id === funil.id),
    );
    fontes.push("Radar");
  } catch (erro) {
    logger.warn("[assistente] radar indisponível na leitura dos leads", { codigo: codigoDaFalha(erro) });
    avisos.push(
      "O Radar não respondeu agora: os números de abertos e de chegadas estão certos, mas o \"em risco\" ficou de fora. Diga isso em uma frase, sem pedir para tentar de novo.",
    );
  }

  // ── por dono (só a equipe): as linhas dos abertos, em páginas ──
  let porDono: LeadsDaPessoa["por_dono"] = null;
  let semDono: number | null = null;
  let truncado = chegadas.truncado;
  if (!proprio) {
    const donos = await todasAsLinhas<{ owner_user_id: string | null }>(
      db,
      "owner_user_id",
      (q) => doEscopo(q).eq("status", "open"),
      "leads_abertos_indisponiveis",
    );
    truncado ||= donos.truncado;
    const contagem = new Map<string | null, { abertos: number; em_risco: number }>();
    for (const l of donos.linhas) {
      const c = contagem.get(l.owner_user_id) ?? { abertos: 0, em_risco: 0 };
      c.abertos += 1;
      contagem.set(l.owner_user_id, c);
    }
    for (const i of emRisco ?? []) {
      const c = contagem.get(i.owner_user_id) ?? { abertos: 0, em_risco: 0 };
      c.em_risco += 1;
      contagem.set(i.owner_user_id, c);
    }
    semDono = contagem.get(null)?.abertos ?? 0;
    porDono = [...contagem.entries()]
      .filter(([dono]) => dono !== null)
      .sort((a, b) => b[1].abertos - a[1].abertos)
      .slice(0, 12)
      .map(([dono, c]) => ({ user_id: dono, nome: nomeDaPessoa(entrada.equipe, dono) ?? "", ...c }));
  }
  if (truncado) avisos.push("Base grande: a divisão por origem, funil ou dono conta só parte dos negócios; os totais estão certos.");

  return {
    escopo: escopo.tipo,
    funil: funil ? { id: funil.id, nome: funil.nome } : null,
    abertos,
    chegaram: {
      periodo: janela.periodo,
      janela: { de: janela.de, ate: janela.ate, fuso: janela.fuso },
      total: chegadas.linhas.length,
      ainda_abertos: aindaAbertos,
      por_origem: contagemOrdenada(porOrigem),
      por_funil: contagemOrdenada(porFunil),
      anterior,
    },
    em_risco: emRisco ? emRisco.length : null,
    criticos: emRisco ? emRisco.filter((i) => i.risk === "critico").length : null,
    em_risco_itens: (emRisco ?? []).slice(0, 5).map((i) => ({
      lead_id: i.id,
      titulo: i.title,
      contato: i.contact_name,
      horas_parado: i.hours_since_activity,
      dias_parado: Math.floor(i.hours_since_activity / 24),
      dono: proprio ? null : nomeDaPessoa(entrada.equipe, i.owner_user_id),
    })),
    por_dono: porDono,
    sem_dono: semDono,
    truncado,
    avisos,
    contatos: (emRisco ?? [])
      .slice(0, 5)
      .map((i) => i.contact_id)
      .filter((c): c is string => typeof c === "string"),
    fontes,
  };
}

/** A leitura voltou com os leads (e não com o funil que não existe). */
export function ehLeadsDaPessoa(r: LeadsDaPessoa | FunilNaoEncontrado): r is LeadsDaPessoa {
  return !("ok" in r);
}

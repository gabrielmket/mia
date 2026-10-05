/**
 * FORK MIA — O CARTÃO ABERTO: o que a tela precisa, e as regras puras que o montam.
 *
 * O cartão aberto junta o que as outras áreas já sabem sobre o negócio — a IA
 * (estado, retrato de objeções, promessas), a pessoa e a empresa, a origem e as
 * conversões enviadas, a agenda, as compras — para quem decide não trocar de
 * tela. A leitura mora em `cartao-aberto-servidor.ts` (uma rota, uma ida ao
 * servidor por abertura); aqui ficam o formato e as regras, testáveis.
 */
import type { CanalDoCartao } from "@/lib/cartoes/tipos";
import type { CompromissoDoCartao } from "@/lib/cartoes/compromisso";
import type { EtapaDaBarra } from "@/lib/cartoes/etapas";
import type { ResumoDeCompras } from "@/lib/cartoes/compras";
import { PADRAO_DO_REF } from "@/lib/plataformas-de-anuncio/captura-de-clique";
import { VERSAO_DO_CODIGO } from "@/lib/leads/origem-do-site";

export interface ObjecaoDoResumo {
  texto: string;
  /** Aberta = está no retrato atual; respondida = esteve e saiu dele. */
  aberta: boolean;
}

export interface ResumoDaIa {
  /** Quando a IA mexeu por último no que se sabe da pessoa. */
  atualizadoEm: string | null;
  /** Estágio do ciclo que a IA marca (new, qualifying, qualified…). */
  estagio: string | null;
  /** BANT, como a IA grava (`lead_state.qualification`). */
  quer: string | null;
  orcamento: string | null;
  decide: string | null;
  prazo: string | null;
  objecoes: ObjecaoDoResumo[];
  compromissos: string[];
  promessas: Array<{ oQue: string; prazo: string | null }>;
  /** O resumo corrido do último turno. */
  resumo: string | null;
}

export interface ConversaoDoNegocio {
  plataforma: "meta_ads" | "google_ads" | string;
  evento: string;
  situacao: "enviada" | "aguardando" | "nao_enviada" | "falha";
  motivo: string | null;
  quando: string | null;
  /** O nome que a pessoa reconhece: "Compra", "Lead qualificado", "Lead enviado", "Etapa: Visita agendada". */
  rotulo: string;
  /** O valor que o evento levou, em centavos. Nulo quando saiu (ou sairia) sem valor. */
  valorCentavos: number | null;
  moeda: string | null;
  /** A resposta da plataforma quando ela recusou o envio. */
  detalhe: string | null;
}

/** De onde o negócio veio em cada plataforma de anúncio: é o que explica a plataforma sem envio nenhum. */
export interface OrigemPorPlataforma {
  /** `pagina`: chegou pelo site com UTM da Meta (upstream 1.70, #2076). */
  meta_ads: "clique" | "pagina" | "formulario" | null;
  google_ads: "clique" | null;
}

export interface OrigemDoCartaoAberto {
  canal: CanalDoCartao;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  /** O anúncio tem id e ainda não tem nome: a tela pede o nome à plataforma. */
  anuncioSemNome: boolean;
  primeiraMensagem: { texto: string; em: string } | null;
  primeiroToque: { em: string } | null;
  /** O que foi reportado à Meta e ao Google sobre este negócio (`ad_conversion_dispatches`). */
  conversoes: ConversaoDoNegocio[];
  /** Por que não há conversão: o negócio não veio de clique em anúncio. */
  semClique: boolean;
  /** Por plataforma: veio de clique, da página ou de formulário (só a Meta), ou não veio dela. */
  origemPorPlataforma: OrigemPorPlataforma;
}

export interface PessoaDoNegocio {
  contatoId: string;
  nome: string | null;
  telefone: string | null;
  cargo: string | null;
  /** Papel NESTE negócio (crm_lead_links.metadata.papel) ou na empresa. */
  papel: string | null;
  principal: boolean;
  conversaId: string | null;
}

export interface OutroNegocio {
  id: string;
  titulo: string;
  status: string;
  etapa: string | null;
  valorCents: number | null;
  moeda: string | null;
  motivoDaPerda: string | null;
}

export interface CartaoAberto {
  etapas: EtapaDaBarra[];
  resumo: ResumoDaIa | null;
  origem: OrigemDoCartaoAberto;
  pessoas: PessoaDoNegocio[];
  outrosNegocios: OutroNegocio[];
  empresa: { id: string; nome: string; cnpj: string | null; telefone: string | null; site: string | null } | null;
  /** O contato tem empresa e o negócio ainda não está ligado a ela. */
  empresaDoContato: { id: string; nome: string } | null;
  compras: ResumoDeCompras | null;
  /** Os compromissos do negócio (ligados a ele, ou do contato sem outro negócio). */
  agenda: Array<CompromissoDoCartao & { resultado: string | null }>;
}

// ─── regras puras ────────────────────────────────────────────────────────────

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

/**
 * Objeções abertas e respondidas a partir dos retratos da IA (do mais novo para
 * o mais velho). Aberta = no retrato mais novo; respondida = apareceu num
 * retrato anterior e não está no mais novo. Sem repetir a mesma objeção.
 */
export function objecoesDosRetratos(retratos: Array<{ objections: unknown }>): ObjecaoDoResumo[] {
  if (retratos.length === 0) return [];
  const abertas = textos(retratos[0]!.objections);
  const chave = (s: string) => s.toLowerCase();
  const vistas = new Set(abertas.map(chave));
  const respondidas: string[] = [];
  for (const r of retratos.slice(1)) {
    for (const o of textos(r.objections)) {
      if (vistas.has(chave(o))) continue;
      vistas.add(chave(o));
      respondidas.push(o);
    }
  }
  return [
    ...abertas.map((texto) => ({ texto, aberta: true })),
    ...respondidas.map((texto) => ({ texto, aberta: false })),
  ];
}

/** As promessas da última declaração que a IA fez (`declaracao.promessas`). */
export function promessasDosRetratos(
  retratos: Array<{ declaracao?: unknown }>,
): Array<{ oQue: string; prazo: string | null }> {
  for (const r of retratos) {
    const d = r.declaracao as { promessas?: unknown } | null | undefined;
    if (!d || !Array.isArray(d.promessas)) continue;
    return d.promessas
      .map((p) => p as { o_que?: unknown; prazo?: unknown })
      .filter((p) => typeof p.o_que === "string" && p.o_que.trim() !== "")
      .map((p) => ({ oQue: (p.o_que as string).trim(), prazo: typeof p.prazo === "string" ? p.prazo : null }));
  }
  return [];
}

export function resumoDaIa(
  estado: { stage?: string | null; qualification?: unknown; updated_at?: string | null } | null,
  retratos: Array<{
    objections: unknown;
    commitments?: unknown;
    declaracao?: unknown;
    rolling_summary?: string | null;
    created_at?: string | null;
  }>,
): ResumoDaIa | null {
  if (!estado && retratos.length === 0) return null;
  const q = (estado?.qualification ?? {}) as Record<string, unknown>;
  const campo = (k: string) => (typeof q[k] === "string" && (q[k] as string).trim() ? (q[k] as string).trim() : null);
  const ultimo = retratos[0];
  const datas = [estado?.updated_at, ultimo?.created_at].filter((d): d is string => !!d).sort();
  return {
    atualizadoEm: datas[datas.length - 1] ?? null,
    estagio: estado?.stage ?? null,
    quer: campo("need"),
    orcamento: campo("budget"),
    decide: campo("authority"),
    prazo: campo("timeline"),
    objecoes: objecoesDosRetratos(retratos),
    compromissos: ultimo ? textos(ultimo.commitments) : [],
    promessas: promessasDosRetratos(retratos),
    resumo: ultimo?.rolling_summary?.trim() || null,
  };
}

/**
 * A primeira mensagem como a pessoa a escreveu: sem os códigos de rastreio que
 * o link do anúncio ou do site embute (`[ref:XXXXXX]`, `[dk1:…]`).
 */
export function semCodigosDeRastreio(texto: string): string {
  const doSite = new RegExp(`\\[${VERSAO_DO_CODIGO}:[A-Za-z0-9_-]+\\]`, "g");
  const doRef = new RegExp(PADRAO_DO_REF.source, "g");
  return texto.replace(doSite, "").replace(doRef, "").replace(/\s{2,}/g, " ").trim();
}

/** As situações de `ad_conversion_dispatches` na palavra da tela. */
export function situacaoDaConversao(status: string, motivo: string | null): ConversaoDoNegocio["situacao"] {
  if (status === "sent") return "enviada";
  if (status === "error") return "falha";
  if (motivo && ["aguardando_processamento", "processamento_demorado", "nova_tentativa_agendada", "reprocessamento_solicitado"].includes(motivo)) {
    return "aguardando";
  }
  return "nao_enviada";
}

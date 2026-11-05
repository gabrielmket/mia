/**
 * FORK MIA (.102) · DEPOIS QUE A IA PASSOU PARA UM VENDEDOR, E NO QUE VIROU
 * (raio-X do cliente ativo; protótipo de 05/11/2026, tela 5). PURO.
 *
 * ─── Onde mora a passagem ───────────────────────────────────────────────────
 *
 * `passagens_de_atendimento` (upstream, migration 0291): uma linha por vez em
 * que o atendimento saiu do automático para uma pessoa (`criado_em`). Ela se
 * RECONHECE (`reconhecido_em`) quando alguém assume a conversa
 * (`fn_conversation_assign`, com `reconhecido_por`) ou a devolve ao automático
 * (`fn_passagem_devolvida`, sem `reconhecido_por`) — migration 0293. A
 * conversa que passou antes de a tabela ter escritor só tem
 * `conversations.last_handoff_at`: vale como passagem, sem reconhecimento.
 *
 * ─── "Alguém assumiu" ───────────────────────────────────────────────────────
 *
 * O que vier PRIMEIRO depois da passagem: o reconhecimento dela, ou a primeira
 * mensagem de uma PESSOA na conversa (a equipe pela MIA ou o celular do
 * número). O vendedor que responde direto, sem clicar em "assumir", assumiu.
 *
 * Por conversa, a PRIMEIRA passagem do período. As faixas:
 *
 *   até 15 min · de 15 min a 2 h · mais de 2 h · ninguém assumiu
 *
 * "Ninguém assumiu" só quando já passaram 2 horas sem ninguém até o fim do
 * período; menos que isso é "em aberto" e fica fora das faixas (o mesmo
 * cuidado do "sem resposta" da .101).
 *
 * ─── No que virou ───────────────────────────────────────────────────────────
 *
 * Do funil da PRÓPRIA conta: o contato da conversa teve um negócio
 * (`crm_leads`) vivo no período, um agendamento (`calendar_appointments`)
 * criado no período, e uma venda ganha (`crm_leads.status = 'won'`, fechada no
 * período). Quem monta as marcas é o servidor (`lib/raio-x/conta.ts`); aqui
 * só se soma.
 */
import { mediana } from "./metricas";

const MIN = 60_000;
export const ESPERA_CURTA_MS = 15 * MIN;
export const ESPERA_LONGA_MS = 2 * 60 * MIN;

export const FAIXAS_DA_ESPERA = ["ate_15_min", "de_15_min_a_2_h", "mais_de_2_h", "ninguem"] as const;
export type FaixaDaEspera = (typeof FAIXAS_DA_ESPERA)[number];

/**
 * A faixa de UMA passagem. `esperaMs` nulo = ninguém assumiu até o fim do
 * período; `desdeAPassagemMs` é quanto tempo havia entre a passagem e o fim.
 */
export function faixaDaEspera(esperaMs: number | null, desdeAPassagemMs: number): FaixaDaEspera | "em_aberto" {
  if (esperaMs !== null && Number.isFinite(esperaMs)) {
    if (esperaMs <= ESPERA_CURTA_MS) return "ate_15_min";
    if (esperaMs <= ESPERA_LONGA_MS) return "de_15_min_a_2_h";
    return "mais_de_2_h";
  }
  return desdeAPassagemMs >= ESPERA_LONGA_MS ? "ninguem" : "em_aberto";
}

/** Uma passagem como o servidor a leu. */
export interface PassagemLida {
  /** Instante da passagem (epoch ms). */
  em: number;
  /** O reconhecimento (alguém assumiu ou devolveu ao automático), ou `null`. */
  reconhecidaEm: number | null;
}

/**
 * Quando alguém assumiu: o menor entre o reconhecimento e a primeira
 * mensagem de uma pessoa da equipe DEPOIS da passagem. `null` = ninguém.
 */
export function assumidaEm(p: PassagemLida, mensagensDePessoa: readonly number[]): number | null {
  const resposta = mensagensDePessoa.filter((em) => em >= p.em).sort((a, b) => a - b)[0] ?? null;
  const reconhecida = p.reconhecidaEm !== null && p.reconhecidaEm >= p.em ? p.reconhecidaEm : null;
  if (resposta === null) return reconhecida;
  if (reconhecida === null) return resposta;
  return Math.min(resposta, reconhecida);
}

/** A passagem medida de UMA conversa (a primeira do período). */
export interface PassagemMedida {
  em: number;
  esperaMs: number | null;
  faixa: FaixaDaEspera | "em_aberto";
  /** A loja estava aberta no instante da passagem. */
  aberta: boolean;
}

export function medirPassagem(p: PassagemLida, mensagensDePessoa: readonly number[], fimDoPeriodo: number, aberta: boolean): PassagemMedida {
  const assumida = assumidaEm(p, mensagensDePessoa);
  const esperaMs = assumida === null ? null : Math.max(0, assumida - p.em);
  return { em: p.em, esperaMs, faixa: faixaDaEspera(esperaMs, fimDoPeriodo - p.em), aberta };
}

/** Uma demorou: mais de 2 horas, ou ninguém assumiu. */
export function passagemLenta(p: Pick<PassagemMedida, "faixa"> | null | undefined): boolean {
  return p?.faixa === "mais_de_2_h" || p?.faixa === "ninguem";
}

export interface ResumoDasPassagens {
  /** Conversas que a IA passou para a equipe no período. */
  conversas: number;
  faixas: Record<FaixaDaEspera, number>;
  emAberto: number;
  /** Medianas do tempo até alguém assumir, em minutos (uma casa). */
  medianaMin: number | null;
  medianaComALojaAbertaMin: number | null;
  medianaComALojaFechadaMin: number | null;
  /** Mais de 2 h, ou ninguém assumiu. */
  lentas: number;
  /** Das lentas, quantas foram com a loja fechada (noite, fim de semana). */
  lentasComALojaFechada: number;
}

const emMinutos = (ms: number | null) => (ms === null ? null : Math.round((ms / MIN) * 10) / 10);

export function resumirPassagens(passagens: readonly PassagemMedida[]): ResumoDasPassagens {
  const faixas = Object.fromEntries(FAIXAS_DA_ESPERA.map((f) => [f, 0])) as Record<FaixaDaEspera, number>;
  let emAberto = 0;
  for (const p of passagens) {
    if (p.faixa === "em_aberto") emAberto += 1;
    else faixas[p.faixa] += 1;
  }
  const esperas = (lista: readonly PassagemMedida[]) => emMinutos(mediana(lista.flatMap((p) => (p.esperaMs === null ? [] : [p.esperaMs]))));
  const lentas = passagens.filter(passagemLenta);
  return {
    conversas: passagens.length,
    faixas,
    emAberto,
    medianaMin: esperas(passagens),
    medianaComALojaAbertaMin: esperas(passagens.filter((p) => p.aberta)),
    medianaComALojaFechadaMin: esperas(passagens.filter((p) => !p.aberta)),
    lentas: lentas.length,
    lentasComALojaFechada: lentas.filter((p) => !p.aberta).length,
  };
}

// ─── No que virou ───────────────────────────────────────────────────────────

/** As marcas do funil de UMA conversa, lidas do funil da própria conta. */
export interface FunilDaConversa {
  negocio: boolean;
  visita: boolean;
  venda: boolean;
}

export interface ResumoDoFunil {
  /** As conversas passadas para a equipe, e no que elas viraram. */
  passadas: number;
  negocio: number;
  visita: number;
  venda: number;
  /** Das passagens lentas (mais de 2 h ou ninguém), quantas viraram visita. */
  lentas: number;
  lentasComVisita: number;
  /** Todas as conversas de cliente do período, para o MCP e a comparação. */
  todas: { conversas: number; negocio: number; visita: number; venda: number };
}

export function resumirFunil(
  conversas: ReadonlyArray<{ passagem: PassagemMedida | null; funil: FunilDaConversa | null }>,
): ResumoDoFunil {
  const passadas = conversas.filter((c) => c.passagem !== null);
  const conta = (lista: typeof conversas, k: keyof FunilDaConversa) => lista.filter((c) => c.funil?.[k] === true).length;
  const lentas = passadas.filter((c) => passagemLenta(c.passagem));
  return {
    passadas: passadas.length,
    negocio: conta(passadas, "negocio"),
    visita: conta(passadas, "visita"),
    venda: conta(passadas, "venda"),
    lentas: lentas.length,
    lentasComVisita: conta(lentas, "visita"),
    todas: {
      conversas: conversas.length,
      negocio: conta(conversas, "negocio"),
      visita: conta(conversas, "visita"),
      venda: conta(conversas, "venda"),
    },
  };
}

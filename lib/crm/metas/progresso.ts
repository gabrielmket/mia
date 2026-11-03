/**
 * META × REALIDADE — e por que o progresso é DERIVADO, nunca guardado.
 *
 * Uma coluna `realizado` ao lado da meta parece prática e apodrece rápido: ela
 * exige que todo caminho que fecha uma venda lembre de incrementá-la, e no dia
 * em que um caminho esquecer (importação, correção manual, API), a meta passa a
 * mentir sem ninguém ver. Aqui o realizado sai das MESMAS linhas que o funil já
 * usa — se a venda existe, ela conta.
 *
 * ── As cinco métricas, e a pergunta que cada uma responde ───────────────────
 *
 *  • `reunioes` — quantas reuniões ficaram DE PÉ no mês. É a meta do SDR e a do
 *    agente de IA: mede ATIVIDADE, que é o que eles controlam.
 *  • `reunioes_realizadas` — quantas de fato ACONTECERAM. Sozinha, `reunioes`
 *    esconde os dois comportamentos opostos que importam: o SDR que marca bem e
 *    leva faltas do cliente, e o que marca com qualquer um para bater número e
 *    deixa a agenda do closer virar sala vazia. ⚠️ A falta NÃO é descontada de
 *    `reunioes` — descontar puniria o SDR pelo cliente que não apareceu.
 *  • `receita_total` — tudo que foi ganho.
 *  • `receita_recorrente` — só mensalidade. Separada porque R$ 10 mil de
 *    assinatura e R$ 10 mil de setup valem coisas diferentes para o negócio.
 *  • `receita_avulsa` — só projeto, setup, venda única.
 *  • `receita_originada` — a venda fechada por OUTRA pessoa que o SDR originou.
 *    É a "participação nas vendas" que hoje vive em planilha paralela.
 *
 * ── A regra de atribuição, escrita porque é onde dá briga ───────────────────
 *
 * Uma venda ganha conta UMA vez para o dono (`owner_user_id`) nas métricas de
 * receita, e UMA vez para quem originou (`originated_by_user_id`) em
 * `receita_originada`. Não é dobra: são perguntas diferentes — "quanto esse
 * closer fechou" e "quanto dessa receita nasceu do trabalho desse SDR". Somar as
 * duas numa só é que inventaria dinheiro.
 *
 * Venda sem `revenue_kind` não entra em recorrente nem em avulso, e o total diz
 * quantas ficaram de fora: escolher um lado por omissão inventaria a divisão que
 * o relatório existe para mostrar.
 *
 * ── GANHAR NEM SEMPRE É RECEITA, e quem diz isso é o FUNIL ──────────────────
 *
 * Numa casa com um funil só, ganhar É vender, e contar todo `won` como receita
 * acerta. Numa casa com SDR e comercial separados, o funil do SDR VENCE quando a
 * reunião é agendada — o dinheiro ainda não existe, e o card só passa ao
 * comercial. Somar esse ganho como receita anuncia faturamento que não entrou.
 *
 * O sistema não tem como adivinhar qual é o caso: os dois são legítimos e o
 * mesmo `is_won` descreve os dois. Então o funil DECLARA
 * (`crm_pipelines.settings.vitoria_e_receita`), e a ausência da declaração
 * mantém o comportamento de sempre — contar. Quem separa SDR de comercial
 * desmarca o funil do SDR e o relatório passa a somar só onde o dinheiro entra.
 *
 * ⚠️ Vale só para as métricas de RECEITA. `reunioes` continua contando as
 * reuniões de qualquer funil: a meta do SDR é justamente essa, e filtrá-la pelo
 * funil que "não é receita" zeraria a meta dele.
 */

import { partesDaVenda } from "./partes-da-venda";
import { FUSO_PADRAO, mesNoFuso } from "./fuso";

export type MetricaDeMeta =
  | "reunioes"
  | "reunioes_realizadas"
  | "receita_total"
  | "receita_recorrente"
  | "receita_avulsa"
  | "receita_originada";

export interface LeadFechado {
  /** 'won' | 'lost' | 'open' — só `won` conta. */
  status: string;
  /**
   * De qual funil é este negócio. É por ele que se sabe se vencer aqui
   * significa dinheiro — ver a doutrina no cabeçalho.
   */
  pipeline_id: string;
  value_cents: number | null;
  revenue_kind: "recorrente" | "avulso" | null;
  owner_user_id: string | null;
  originated_by_user_id: string | null;
  /** ISO. Fora do mês da meta, não conta. */
  closed_at: string | null;
}

export interface ReuniaoMarcada {
  /** Quem marcou: o atendente, ou o agente de IA. */
  marcada_por_user_id: string | null;
  marcada_por_agent_id: string | null;
  created_at: string;
  /**
   * O desfecho, quando já se sabe: `completed` (aconteceu), `no_show` (o
   * cliente faltou), ou o estado de quem ainda não chegou lá.
   *
   * O chamador já descarta os cancelados — reunião cancelada não é reunião
   * marcada, e contá-la premiaria quem marca por marcar.
   */
  status: string;
}

export interface Meta {
  id: string;
  periodo: string;
  metrica: MetricaDeMeta;
  alvo_cents: number | null;
  alvo_quantidade: number | null;
  user_id: string | null;
  agent_id: string | null;
}

export interface ProgressoDaMeta extends Meta {
  /** Centavos para métrica de dinheiro; contagem para `reunioes`. */
  realizado: number;
  alvo: number;
  /** 0 a 1 — e passa de 1 quando bate mais que a meta, de propósito. */
  fracao: number;
  /** Quanto falta, na mesma unidade do alvo. Nunca negativo. */
  falta: number;
}

/**
 * Os funis em que vencer É receita. `null` = não foi declarado nada, e aí tudo
 * conta (o comportamento de quem tem um funil só, que é a maioria).
 */
export type FunisDeReceita = ReadonlySet<string> | null;

/** Ganhas no período que contam como DINHEIRO. */
function ganhasComReceita(
  leads: readonly LeadFechado[],
  periodo: string,
  funisDeReceita: FunisDeReceita,
  fuso: string,
): LeadFechado[] {
  return leads.filter(
    (l) =>
      l.status === "won" &&
      dentroDoMes(l.closed_at, periodo, fuso) &&
      (funisDeReceita === null || funisDeReceita.has(l.pipeline_id)),
  );
}

/**
 * Este instante caiu no mês da meta?
 *
 * O fuso é de QUEM OPERA, e não Greenwich: cortar o mês às 21h do dia 30 (que é
 * o que UTC faz com uma empresa em São Paulo) joga a venda daquela noite para o
 * mês seguinte. O total do ano não muda, e por isso ninguém nota — o erro
 * aparece na conferência de comissão, um mês depois. Ver lib/crm/metas/fuso.ts.
 */
function dentroDoMes(iso: string | null, periodo: string, fuso: string): boolean {
  return mesNoFuso(iso, fuso) === periodo.slice(0, 7);
}

/**
 * O realizado de UMA meta, contra as linhas do período.
 *
 * `leads` e `reunioes` chegam já filtrados pela organização — este módulo é
 * puro e não sabe consultar nada; quem lê banco é o chamador.
 */
export function realizadoDaMeta(
  meta: Meta,
  leads: readonly LeadFechado[],
  reunioes: readonly ReuniaoMarcada[],
  funisDeReceita: FunisDeReceita = null,
  fuso: string = FUSO_PADRAO,
): number {
  if (meta.metrica === "reunioes" || meta.metrica === "reunioes_realizadas") {
    const doResponsavel = reunioes.filter((r) => {
      if (!dentroDoMes(r.created_at, meta.periodo, fuso)) return false;
      if (meta.user_id) return r.marcada_por_user_id === meta.user_id;
      if (meta.agent_id) return r.marcada_por_agent_id === meta.agent_id;
      // Meta da organização: conta tudo, inclusive o que a IA marcou.
      return true;
    });
    return meta.metrica === "reunioes"
      ? doResponsavel.length
      : doResponsavel.filter((r) => r.status === "completed").length;
  }

  const ganhas = ganhasComReceita(leads, meta.periodo, funisDeReceita, fuso);

  if (meta.metrica === "receita_originada") {
    // A pergunta aqui é a do SDR: quanto da receita fechada nasceu do trabalho
    // dele. Sem `user_id` a métrica não faz sentido (a organização inteira
    // "origina" tudo), e devolver 0 é mais honesto que somar o total.
    if (!meta.user_id) return 0;
    return somar(ganhas.filter((l) => l.originated_by_user_id === meta.user_id));
  }

  const doResponsavel = meta.user_id
    ? ganhas.filter((l) => l.owner_user_id === meta.user_id)
    : ganhas;

  if (meta.metrica === "receita_recorrente") {
    return somar(doResponsavel.filter((l) => l.revenue_kind === "recorrente"));
  }
  if (meta.metrica === "receita_avulsa") {
    return somar(doResponsavel.filter((l) => l.revenue_kind === "avulso"));
  }
  return somar(doResponsavel);
}

function somar(leads: readonly LeadFechado[]): number {
  return leads.reduce((acc, l) => acc + (l.value_cents ?? 0), 0);
}

export function progressoDaMeta(
  meta: Meta,
  leads: readonly LeadFechado[],
  reunioes: readonly ReuniaoMarcada[],
  funisDeReceita: FunisDeReceita = null,
  fuso: string = FUSO_PADRAO,
): ProgressoDaMeta {
  const realizado = realizadoDaMeta(meta, leads, reunioes, funisDeReceita, fuso);
  const contagem = meta.metrica === "reunioes" || meta.metrica === "reunioes_realizadas";
  const alvo = contagem ? (meta.alvo_quantidade ?? 0) : (meta.alvo_cents ?? 0);
  return {
    ...meta,
    realizado,
    alvo,
    // Alvo zero não existe (o CHECK do banco impede), mas um dado velho não
    // pode virar divisão por zero numa tela de acompanhamento.
    fracao: alvo > 0 ? realizado / alvo : 0,
    falta: Math.max(0, alvo - realizado),
  };
}

export interface ResumoDoMes {
  /** Receita ganha no mês, por natureza. Centavos. */
  recorrente: number;
  avulso: number;
  naoClassificada: number;
  total: number;
  /** Quantas vendas ganhas ficaram sem classificação — a tela precisa dizer. */
  vendasSemClassificacao: number;
  /** Contrato anualizado: mensalidade × meses, quando o prazo é conhecido. */
  contratoRecorrenteCents: number;
}

export interface ResumoDasReunioes {
  /** Ficaram de pé no mês (o cancelado já não chega aqui). */
  marcadas: number;
  realizadas: number;
  faltas: number;
  /** Ainda sem desfecho: não aconteceram nem faltaram — a reunião de amanhã. */
  sem_desfecho: number;
  /**
   * Realizadas ÷ (realizadas + faltas). `null` enquanto nenhuma reunião tiver
   * desfecho.
   *
   * ⚠️ O denominador NÃO é o total de marcadas, de propósito: incluir a reunião
   * de amanhã faria a taxa despencar só porque o mês não acabou, e uma taxa que
   * piora sozinha a cada reunião nova é uma taxa que ninguém consegue usar.
   */
  taxa_de_comparecimento: number | null;
}

/**
 * Marcar e comparecer são medidas diferentes, e o relatório mostra as duas.
 */
export function resumoDasReunioes(
  reunioes: readonly ReuniaoMarcada[],
  periodo: string,
  fuso: string = FUSO_PADRAO,
): ResumoDasReunioes {
  const doMes = reunioes.filter((r) => dentroDoMes(r.created_at, periodo, fuso));
  const realizadas = doMes.filter((r) => r.status === "completed").length;
  const faltas = doMes.filter((r) => r.status === "no_show").length;
  const comDesfecho = realizadas + faltas;
  return {
    marcadas: doMes.length,
    realizadas,
    faltas,
    sem_desfecho: doMes.length - comDesfecho,
    taxa_de_comparecimento: comDesfecho > 0 ? realizadas / comDesfecho : null,
  };
}

export interface LeadFechadoComPrazo extends LeadFechado {
  recurring_months: number | null;
  /** FORK MIA: a mensalidade do upstream (v1.99); ver `partes-da-venda.ts`. */
  recurring_value_cents?: number | null;
}

/**
 * O fechamento do mês — a base do relatório de vendas.
 *
 * `contratoRecorrenteCents` só soma o que tem prazo declarado: multiplicar por
 * um prazo suposto (12, por exemplo) inflaria o número mais citado do relatório
 * com um palpite que ninguém veria.
 */
export function resumoDoMes(
  leads: readonly LeadFechadoComPrazo[],
  periodo: string,
  funisDeReceita: FunisDeReceita = null,
  fuso: string = FUSO_PADRAO,
): ResumoDoMes {
  // A MESMA régua das metas, de propósito: se o resumo somasse um funil que a
  // meta não soma, a tela mostraria dois totais diferentes do mesmo mês.
  const ganhas = ganhasComReceita(leads, periodo, funisDeReceita, fuso) as LeadFechadoComPrazo[];

  let recorrente = 0;
  let avulso = 0;
  let naoClassificada = 0;
  let contratoRecorrenteCents = 0;
  let vendasSemClassificacao = 0;

  for (const l of ganhas) {
    // FORK MIA (upstream v1.99): a mensalidade pode estar na coluna própria
    // (`recurring_value_cents`); a régua das duas leituras é `partesDaVenda`.
    const partes = partesDaVenda(l);
    recorrente += partes.recorrente;
    avulso += partes.avulso;
    naoClassificada += partes.naoClassificada;
    if (partes.mensalidade !== null && l.recurring_months && l.recurring_months > 0) {
      contratoRecorrenteCents += partes.mensalidade * l.recurring_months;
    }
    if (l.revenue_kind === null) vendasSemClassificacao++;
  }

  return {
    recorrente,
    avulso,
    naoClassificada,
    total: recorrente + avulso + naoClassificada,
    vendasSemClassificacao,
    contratoRecorrenteCents,
  };
}

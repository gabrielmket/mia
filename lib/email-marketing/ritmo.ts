/**
 * FORK MIA (.89) — AQUECIMENTO, PLANO DE ENVIO, RITMO e TRAVA DE SAÚDE.
 *
 * Quatro regras do protótipo aprovado, todas puras (testadas em
 * `tests/unit/email-marketing-ritmo.test.ts`):
 *
 *   AQUECIMENTO  domínio novo começa com 200 por dia de envio e sobe por 14
 *                degraus até 20.000. Só dia com envio conta. O degrau só sobe se
 *                o dia anterior teve rejeição abaixo de 2% e reclamação abaixo de
 *                0,1%; senão se repete. Depois do 14º, vale a cota da conta.
 *   PLANO        a campanha maior que o teto do dia se divide sozinha em dias, no
 *                ritmo, na janela e nos dias úteis da empresa, e o plano aparece
 *                antes de confirmar.
 *   RITMO        a campanha pode ir mais devagar que a configuração, nunca mais
 *                rápido; o teto do aquecimento vale de qualquer jeito.
 *   TRAVA        a campanha pausa sozinha com rejeição a partir de 4% ou
 *                reclamação a partir de 0,08%, contadas a partir de 300 entregues.
 */
import {
  AQUECIMENTO_RECLAMACAO_MAXIMA_PCT,
  AQUECIMENTO_REJEICAO_MAXIMA_PCT,
  DEGRAUS_DO_AQUECIMENTO,
  TRAVA_MINIMO_DE_ENTREGUES,
  TRAVA_RECLAMACAO_PCT,
  TRAVA_REJEICAO_PCT,
} from "./regras";
import { diaSeguinte, ehFimDeSemana, instanteNoFuso, partesNoFuso } from "./fuso";

/** O último degrau: depois dele vale a cota da conta. */
export const ULTIMO_DEGRAU = DEGRAUS_DO_AQUECIMENTO.length;

/** O teto do dia de envio no degrau `degrau` (0 = primeiro dia). */
export function tetoDoDegrau(degrau: number, cotaDaConta: number): number {
  const d = Math.max(0, Math.floor(degrau));
  if (d < DEGRAUS_DO_AQUECIMENTO.length) {
    return Math.min(
      DEGRAUS_DO_AQUECIMENTO[d]!,
      cotaDaConta > 0 ? cotaDaConta : Number.POSITIVE_INFINITY,
    );
  }
  return cotaDaConta > 0 ? cotaDaConta : DEGRAUS_DO_AQUECIMENTO[DEGRAUS_DO_AQUECIMENTO.length - 1]!;
}

export interface NumerosDoDia {
  enviados: number;
  entregues: number;
  rejeicoes: number;
  reclamacoes: number;
}

export function pct(parte: number, todo: number): number {
  return todo > 0 ? (parte * 100) / todo : 0;
}

/** Rejeição sobre o que a Amazon aceitou; reclamação sobre o que foi entregue. */
export function taxasDoEnvio(n: NumerosDoDia): { rejeicaoPct: number; reclamacaoPct: number } {
  return {
    rejeicaoPct: pct(n.rejeicoes, n.enviados),
    reclamacaoPct: pct(n.reclamacoes, n.entregues),
  };
}

/**
 * O degrau do próximo dia de envio, a partir do último dia em que houve envio.
 * Dia sem envio não conta: o degrau fica onde está.
 */
export function proximoDegrau(degrauAtual: number, ultimoDia: NumerosDoDia): number {
  if (ultimoDia.enviados <= 0) return degrauAtual;
  const { rejeicaoPct, reclamacaoPct } = taxasDoEnvio(ultimoDia);
  const saudavel =
    rejeicaoPct < AQUECIMENTO_REJEICAO_MAXIMA_PCT &&
    reclamacaoPct < AQUECIMENTO_RECLAMACAO_MAXIMA_PCT;
  return saudavel ? Math.min(ULTIMO_DEGRAU, degrauAtual + 1) : degrauAtual;
}

export type MotivoDaTrava = "rejeicao" | "reclamacao";

export interface Trava {
  motivo: MotivoDaTrava;
  taxaPct: number;
  limitePct: number;
}

/** A campanha tem de pausar agora? `null` = segue. */
export function travaDeSaude(n: NumerosDoDia): Trava | null {
  if (n.entregues < TRAVA_MINIMO_DE_ENTREGUES) return null;
  const { rejeicaoPct, reclamacaoPct } = taxasDoEnvio(n);
  if (reclamacaoPct >= TRAVA_RECLAMACAO_PCT) {
    return { motivo: "reclamacao", taxaPct: reclamacaoPct, limitePct: TRAVA_RECLAMACAO_PCT };
  }
  if (rejeicaoPct >= TRAVA_REJEICAO_PCT)
    return { motivo: "rejeicao", taxaPct: rejeicaoPct, limitePct: TRAVA_REJEICAO_PCT };
  return null;
}

/** O ritmo da campanha: o dela, se for mais devagar; nunca mais rápido que o da configuração. */
export function ritmoEfetivo(
  daConfiguracao: number,
  daCampanha: number | null | undefined,
): number {
  if (!daCampanha || daCampanha <= 0) return daConfiguracao;
  return Math.min(daConfiguracao, daCampanha);
}

export interface EntradaDoPlano {
  total: number;
  inicio: Date;
  fuso: string;
  ritmoPorHora: number;
  janelaInicio: number;
  janelaFim: number;
  soDiasUteis: boolean;
  /** O degrau do aquecimento do domínio no primeiro dia de envio. */
  degrau: number;
  cotaDaConta: number;
  /** O que outras campanhas do mesmo domínio já mandaram no primeiro dia. */
  jaUsadoNoPrimeiroDia?: number;
}

export type PorQuePara = "fim" | "aquecimento" | "ritmo";

export interface DiaDoPlano {
  /** `AAAA-MM-DD`, no fuso da empresa. */
  data: string;
  diaDaSemana: number;
  inicio: string;
  fim: string;
  /** Horas decimais no relógio da empresa (9.5 = 9h30). */
  horaInicio: number;
  horaFim: number;
  quantidade: number;
  tetoDoAquecimento: number;
  porRitmo: number;
  degrau: number;
  porQuePara: PorQuePara;
}

/**
 * O plano dia a dia. Supõe que cada dia vai bem (o degrau sobe): é a melhor
 * previsão honesta, e a tela diz que um dia ruim repete o degrau.
 */
export function planejarEnvio(e: EntradaDoPlano): DiaDoPlano[] {
  const saida: DiaDoPlano[] = [];
  if (e.total <= 0 || e.ritmoPorHora <= 0 || e.janelaFim <= e.janelaInicio) return saida;
  let p = partesNoFuso(e.inicio, e.fuso);
  let dia = { ano: p.ano, mes: p.mes, dia: p.dia };
  let resta = e.total;
  let degrau = e.degrau;
  let primeiro = true;
  for (let guarda = 0; resta > 0 && guarda < 400; guarda += 1) {
    const meioDia = instanteNoFuso(dia.ano, dia.mes, dia.dia, 12, e.fuso);
    const dow = partesNoFuso(meioDia, e.fuso).diaDaSemana;
    const pular = () => {
      dia = diaSeguinte(dia.ano, dia.mes, dia.dia);
      primeiro = false;
    };
    if (e.soDiasUteis && ehFimDeSemana(dow)) {
      pular();
      continue;
    }
    let h0 = primeiro ? p.hora + p.minuto / 60 : e.janelaInicio;
    if (h0 < e.janelaInicio) h0 = e.janelaInicio;
    if (h0 >= e.janelaFim - 0.25) {
      pular();
      continue;
    }
    const porRitmo = Math.floor(e.ritmoPorHora * (e.janelaFim - h0));
    const usado = primeiro ? Math.max(0, e.jaUsadoNoPrimeiroDia ?? 0) : 0;
    const teto = Math.max(0, tetoDoDegrau(degrau, e.cotaDaConta) - usado);
    const quantidade = Math.min(resta, porRitmo, teto);
    if (quantidade <= 0) {
      pular();
      continue;
    }
    const horaFim = Math.min(e.janelaFim, h0 + quantidade / e.ritmoPorHora);
    saida.push({
      data: `${dia.ano}-${String(dia.mes).padStart(2, "0")}-${String(dia.dia).padStart(2, "0")}`,
      diaDaSemana: dow,
      inicio: instanteNoFuso(dia.ano, dia.mes, dia.dia, h0, e.fuso).toISOString(),
      fim: instanteNoFuso(dia.ano, dia.mes, dia.dia, horaFim, e.fuso).toISOString(),
      horaInicio: h0,
      horaFim,
      quantidade,
      tetoDoAquecimento: tetoDoDegrau(degrau, e.cotaDaConta),
      porRitmo,
      degrau,
      porQuePara: quantidade === resta ? "fim" : teto <= porRitmo ? "aquecimento" : "ritmo",
    });
    resta -= quantidade;
    degrau = Math.min(ULTIMO_DEGRAU, degrau + 1);
    pular();
    p = partesNoFuso(instanteNoFuso(dia.ano, dia.mes, dia.dia, e.janelaInicio, e.fuso), e.fuso);
  }
  return saida;
}

export interface EntradaDaRodada {
  agora: Date;
  fuso: string;
  ritmoPorHora: number;
  janelaInicio: number;
  janelaFim: number;
  soDiasUteis: boolean;
  /** Quantos desta campanha já saíram HOJE (no dia da empresa). */
  enviadosHojePelaCampanha: number;
  /** Quando a campanha pode começar hoje (agendamento ou início do envio). */
  comecaEm: Date | null;
  /** Quanto do teto do dia do DOMÍNIO ainda sobra (todas as campanhas somadas). */
  restaNoTetoDoDominio: number;
  tetoDaRodada: number;
}

export type MotivoDeEspera =
  "fora_dos_dias_uteis" | "fora_da_janela" | "teto_do_dia" | "no_ritmo" | null;

/**
 * Quantos e-mails podem sair NESTA rodada do worker.
 *
 * O ritmo é medido desde o começo da janela de hoje (ou desde a hora agendada,
 * se for mais tarde): até agora podiam ter saído `ritmo × horas`; sai a
 * diferença para o que já saiu. Rodada perdida não vira rajada: o teto da
 * rodada corta.
 */
export function quantosPodemSair(e: EntradaDaRodada): { quantos: number; espera: MotivoDeEspera } {
  const p = partesNoFuso(e.agora, e.fuso);
  if (e.soDiasUteis && ehFimDeSemana(p.diaDaSemana))
    return { quantos: 0, espera: "fora_dos_dias_uteis" };
  const h = p.hora + p.minuto / 60 + p.segundo / 3600;
  if (h < e.janelaInicio || h >= e.janelaFim) return { quantos: 0, espera: "fora_da_janela" };
  if (e.restaNoTetoDoDominio <= 0) return { quantos: 0, espera: "teto_do_dia" };
  let comeco = e.janelaInicio;
  if (e.comecaEm) {
    const c = partesNoFuso(e.comecaEm, e.fuso);
    const mesmoDia = c.ano === p.ano && c.mes === p.mes && c.dia === p.dia;
    if (mesmoDia) comeco = Math.max(comeco, c.hora + c.minuto / 60);
  }
  // O primeiro e-mail do dia sai na hora: `+ 1`.
  const permitidos = Math.floor(e.ritmoPorHora * Math.max(0, h - comeco)) + 1;
  const quantos = Math.max(
    0,
    Math.min(permitidos - e.enviadosHojePelaCampanha, e.restaNoTetoDoDominio, e.tetoDaRodada),
  );
  return { quantos, espera: quantos > 0 ? null : "no_ritmo" };
}

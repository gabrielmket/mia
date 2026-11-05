/**
 * FORK MIA (.101) · AS MÉTRICAS DE TEMPO DO RAIO-X — determinísticas, PURAS.
 *
 * Nada aqui passa por modelo de IA: velocidade da primeira resposta, quem ficou
 * sem resposta e quem sumiu sem a loja voltar a chamar saem de CONTA sobre o
 * horário de cada mensagem. As definições abaixo são as da doc
 * (`docs/fork/raio-x-do-atendimento.md`, seção 4) e os testes as fixam.
 *
 * ─── As definições ──────────────────────────────────────────────────────────
 *
 * EPISÓDIO DE ATENDIMENTO. A conversa é cortada em trechos: um trecho novo
 * começa na primeira mensagem do período e em toda mensagem que chega 24 horas
 * ou mais depois da anterior (de qualquer lado). Trecho que começa com mensagem
 * do CLIENTE é um episódio; trecho que começa com mensagem da loja (campanha,
 * retorno) não é, e não entra nas contas de primeira resposta.
 *
 * PRIMEIRA RESPOSTA. O tempo entre a PRIMEIRA mensagem do cliente no episódio
 * (ele costuma mandar várias) e a primeira mensagem da loja depois dela, no
 * mesmo episódio. É relógio de parede, não horário útil: o cliente que escreve
 * às 21h e recebe às 9h esperou 12 horas, e é isso que o mapa mostra.
 *
 * FICOU SEM RESPOSTA. Episódio em que a loja não mandou nada, e que já tem 24
 * horas desde a última mensagem do cliente no fim do período. Menos que isso é
 * "em aberto" e fica fora das duas contas (nem respondido, nem sem resposta).
 *
 * SUMIU. A loja respondeu, a última palavra foi dela, e o cliente não escreveu
 * mais por 48 horas (até a mensagem seguinte dele ou o fim do período).
 *
 * A LOJA VOLTOU A CHAMAR. Dentro desse silêncio, a loja mandou outra mensagem
 * 12 horas ou mais depois da primeira que ficou sem resposta. "Sumiu e a loja
 * não voltou" é o sumiu sem esse retorno.
 */
import { FAIXAS, faixaDoMinuto, lojaAberta, momentoLocal, proximaAbertura, type DiaDaSemana, type Faixa } from "./horario";
import type { HorarioComercial } from "./regras";

/**
 * FORK MIA (.102) · quem mandou a mensagem da loja, na fonte "conversas da
 * MIA" (pelo `messages.sent_via`; `lib/raio-x/quem-respondeu.ts`). Na fonte
 * "conexão" não se sabe: fica ausente.
 */
export type QuemDaLoja = "ia" | "equipe" | "celular" | "automacao";

const HORA = 3_600_000;
/** Silêncio que abre um trecho novo da conversa. */
export const NOVO_EPISODIO_APOS_MS = 24 * HORA;
/** Sem resposta só depois de 24 h da última mensagem do cliente. */
export const SEM_RESPOSTA_APOS_MS = 24 * HORA;
/** Sumiu: 48 h sem o cliente escrever depois da última palavra da loja. */
export const SUMIU_APOS_MS = 48 * HORA;
/** Voltou a chamar: outra mensagem da loja 12 h ou mais depois da que ficou sem resposta. */
export const VOLTOU_A_CHAMAR_APOS_MS = 12 * HORA;

export interface MensagemParaMedir {
  daLoja: boolean;
  /** Instante em milissegundos (epoch). */
  em: number;
  /** FORK MIA (.102): quem da loja mandou (só na fonte "conversas da MIA"). */
  quem?: QuemDaLoja | null;
}

export interface EpisodioMedido {
  inicio: number;
  dia: DiaDaSemana;
  faixa: Faixa;
  /** A loja estava aberta quando o cliente escreveu. */
  aberta: boolean;
  /** `null` = a loja não respondeu (ou ainda está no prazo). */
  primeiraRespostaMs: number | null;
  desfecho: "respondido" | "sem_resposta" | "em_aberto";
  /** FORK MIA (.102): quem deu a primeira resposta (fonte "conversas da MIA"); `null` = não se sabe ou ninguém. */
  primeiraRespostaQuem?: QuemDaLoja | null;
  /**
   * FORK MIA (.102): o cliente escreveu com a loja FECHADA e a primeira resposta
   * veio antes de a loja abrir de novo. `false` com a loja aberta ou sem resposta.
   */
  respondidoComALojaFechada?: boolean;
}

export interface ConversaMedida {
  /** O cliente escreveu ao menos uma vez no período. */
  doCliente: boolean;
  mensagensDoCliente: number;
  mensagensDaLoja: number;
  episodios: EpisodioMedido[];
  /** Trechos que começaram pela loja (campanha, retorno espontâneo). */
  trechosDaLoja: number;
  /** Quantas vezes o cliente sumiu depois da última palavra da loja. */
  sumicos: number;
  /** Desses, em quantos a loja voltou a chamar. */
  sumicosComRetorno: number;
  /** Mediana da primeira resposta dos episódios respondidos, em minutos. */
  medianaPrimeiraRespostaMin: number | null;
  /** Algum episódio ficou sem resposta. */
  semResposta: boolean;
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio]! : (v[meio - 1]! + v[meio]!) / 2;
}

const paraMinutos = (ms: number) => Math.round(ms / 60_000);

/**
 * Mede UMA conversa. `fimDoPeriodo` é o instante em que a leitura terminou: é
 * contra ele que "24 horas sem resposta" e "48 horas sumido" são conferidos.
 */
export function medirConversa(
  mensagensBrutas: readonly MensagemParaMedir[],
  horario: HorarioComercial,
  fimDoPeriodo: number,
): ConversaMedida {
  const msgs = mensagensBrutas.filter((m) => Number.isFinite(m.em)).slice().sort((a, b) => a.em - b.em);
  const medida: ConversaMedida = {
    doCliente: msgs.some((m) => !m.daLoja),
    mensagensDoCliente: msgs.filter((m) => !m.daLoja).length,
    mensagensDaLoja: msgs.filter((m) => m.daLoja).length,
    episodios: [],
    trechosDaLoja: 0,
    sumicos: 0,
    sumicosComRetorno: 0,
    medianaPrimeiraRespostaMin: null,
    semResposta: false,
  };
  if (msgs.length === 0) return medida;

  // 1. Os trechos.
  const trechos: MensagemParaMedir[][] = [];
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i]!;
    if (i === 0 || m.em - msgs[i - 1]!.em >= NOVO_EPISODIO_APOS_MS) trechos.push([m]);
    else trechos[trechos.length - 1]!.push(m);
  }

  // 2. Os episódios (trechos que o cliente abriu).
  for (const trecho of trechos) {
    const primeira = trecho[0]!;
    if (primeira.daLoja) {
      medida.trechosDaLoja += 1;
      continue;
    }
    const local = momentoLocal(primeira.em);
    const resposta = trecho.find((m) => m.daLoja && m.em >= primeira.em);
    let desfecho: EpisodioMedido["desfecho"];
    if (resposta) desfecho = "respondido";
    else {
      const ultimaDoCliente = trecho[trecho.length - 1]!.em;
      desfecho = fimDoPeriodo - ultimaDoCliente >= SEM_RESPOSTA_APOS_MS ? "sem_resposta" : "em_aberto";
    }
    const aberta = lojaAberta(local, horario);
    let respondidoComALojaFechada = false;
    if (resposta && !aberta) {
      const abre = proximaAbertura(primeira.em, horario);
      respondidoComALojaFechada = abre === null || resposta.em < abre;
    }
    medida.episodios.push({
      inicio: primeira.em,
      dia: local.dia,
      faixa: faixaDoMinuto(local.minutos),
      aberta,
      primeiraRespostaMs: resposta ? resposta.em - primeira.em : null,
      desfecho,
      primeiraRespostaQuem: resposta?.quem ?? null,
      respondidoComALojaFechada,
    });
  }

  // 3. Os sumiços: a última palavra é da loja e o cliente não volta em 48 h.
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i]!;
    if (!m.daLoja) continue;
    const anterior = msgs[i - 1];
    // Só conta a PRIMEIRA mensagem da loja depois de uma do cliente: é a que
    // ficou sem resposta. As seguintes são o retorno (ou não).
    if (!anterior || anterior.daLoja) continue;
    let j = i + 1;
    while (j < msgs.length && msgs[j]!.daLoja) j += 1;
    const proximaDoCliente = j < msgs.length ? msgs[j]!.em : null;
    const silencioAte = proximaDoCliente ?? fimDoPeriodo;
    if (silencioAte - m.em < SUMIU_APOS_MS) continue;
    medida.sumicos += 1;
    const voltou = msgs.slice(i + 1, j).some((s) => s.em - m.em >= VOLTOU_A_CHAMAR_APOS_MS);
    if (voltou) medida.sumicosComRetorno += 1;
  }

  const tempos = medida.episodios.flatMap((e) => (e.primeiraRespostaMs === null ? [] : [e.primeiraRespostaMs]));
  const med = mediana(tempos);
  medida.medianaPrimeiraRespostaMin = med === null ? null : paraMinutos(med);
  medida.semResposta = medida.episodios.some((e) => e.desfecho === "sem_resposta");
  return medida;
}

/**
 * A nota de RAPIDEZ (0 a 10) sai do relógio, não do modelo: a mediana da
 * primeira resposta da conversa. Sem resposta nenhuma, 0.
 */
export function notaDeRapidez(medianaMin: number | null, semResposta: boolean): number {
  if (medianaMin === null) return semResposta ? 0 : 5;
  if (medianaMin <= 5) return 10;
  if (medianaMin <= 15) return 9;
  if (medianaMin <= 30) return 8;
  if (medianaMin <= 60) return 6;
  if (medianaMin <= 180) return 4;
  if (medianaMin <= 720) return 2;
  return 1;
}

export interface CelulaDoMapa {
  episodios: number;
  /** Mediana da primeira resposta dos respondidos, em minutos; `null` = nenhum respondido. */
  medianaMin: number | null;
}

export interface MetricasDeTempo {
  conversasDeCliente: number;
  episodios: number;
  respondidos: number;
  semResposta: number;
  emAberto: number;
  /** Proporção dos episódios fechados (respondidos + sem resposta), de 0 a 1. */
  proporcaoSemResposta: number | null;
  medianaPrimeiraRespostaMin: number | null;
  medianaComALojaAbertaMin: number | null;
  medianaComALojaFechadaMin: number | null;
  episodiosComALojaFechada: number;
  proporcaoComALojaFechada: number | null;
  /** Episódios em que o cliente sumiu depois da última palavra da loja. */
  sumicos: number;
  sumicosSemRetorno: number;
  /** Sumiu sem retorno ÷ episódios respondidos. */
  proporcaoSumiuSemRetorno: number | null;
  /** mapa[dia][faixa], dia 0 = segunda, faixas na ordem de `FAIXAS`. */
  mapa: CelulaDoMapa[][];
  /** A célula com mais episódios (o pico), para a recomendação. */
  pico: { dia: DiaDaSemana; faixa: Faixa; episodios: number; medianaMin: number | null } | null;
  /**
   * FORK MIA (.102): as mesmas medianas em SEGUNDOS (a IA responde em segundos,
   * e "0 min" não diz nada). Ausentes nos relatórios da .101.
   */
  medianaPrimeiraRespostaSeg?: number | null;
  medianaComALojaAbertaSeg?: number | null;
  medianaComALojaFechadaSeg?: number | null;
  /**
   * FORK MIA (.102): dos episódios que chegaram com a loja fechada (sem os em
   * aberto), quantos tiveram a primeira resposta ANTES de a loja abrir de novo.
   */
  respondidosComALojaFechada?: number;
  proporcaoRespondidoComALojaFechada?: number | null;
}

const proporcao = (parte: number, todo: number) => (todo > 0 ? parte / todo : null);

/** Junta as conversas medidas nos números do relatório. */
export function agregarMetricas(conversas: readonly ConversaMedida[]): MetricasDeTempo {
  const episodios = conversas.flatMap((c) => c.episodios);
  const respondidos = episodios.filter((e) => e.desfecho === "respondido");
  const semResposta = episodios.filter((e) => e.desfecho === "sem_resposta").length;
  const emAberto = episodios.filter((e) => e.desfecho === "em_aberto").length;
  const tempo = (lista: readonly EpisodioMedido[]) => {
    const m = mediana(lista.flatMap((e) => (e.primeiraRespostaMs === null ? [] : [e.primeiraRespostaMs])));
    return m === null ? null : paraMinutos(m);
  };
  const fechados = episodios.filter((e) => !e.aberta);
  const mapa: CelulaDoMapa[][] = Array.from({ length: 7 }, (_, dia) =>
    FAIXAS.map((faixa) => {
      const daCelula = episodios.filter((e) => e.dia === dia && e.faixa === faixa);
      return { episodios: daCelula.length, medianaMin: tempo(daCelula) };
    }),
  );
  let pico: MetricasDeTempo["pico"] = null;
  mapa.forEach((linha, dia) =>
    linha.forEach((celula, i) => {
      if (celula.episodios > 0 && (!pico || celula.episodios > pico.episodios)) {
        pico = { dia: dia as DiaDaSemana, faixa: FAIXAS[i]!, episodios: celula.episodios, medianaMin: celula.medianaMin };
      }
    }),
  );
  const sumicos = conversas.reduce((s, c) => s + c.sumicos, 0);
  const sumicosSemRetorno = conversas.reduce((s, c) => s + (c.sumicos - c.sumicosComRetorno), 0);
  const segundos = (lista: readonly EpisodioMedido[]) => {
    const m = mediana(lista.flatMap((e) => (e.primeiraRespostaMs === null ? [] : [e.primeiraRespostaMs])));
    return m === null ? null : Math.round(m / 1000);
  };
  const fechadosSemEmAberto = fechados.filter((e) => e.desfecho !== "em_aberto");
  const respondidosComALojaFechada = fechadosSemEmAberto.filter((e) => e.respondidoComALojaFechada === true).length;
  return {
    conversasDeCliente: conversas.filter((c) => c.doCliente).length,
    episodios: episodios.length,
    respondidos: respondidos.length,
    semResposta,
    emAberto,
    proporcaoSemResposta: proporcao(semResposta, respondidos.length + semResposta),
    medianaPrimeiraRespostaMin: tempo(episodios),
    medianaComALojaAbertaMin: tempo(episodios.filter((e) => e.aberta)),
    medianaComALojaFechadaMin: tempo(fechados),
    episodiosComALojaFechada: fechados.length,
    proporcaoComALojaFechada: proporcao(fechados.length, episodios.length),
    sumicos,
    sumicosSemRetorno,
    proporcaoSumiuSemRetorno: proporcao(sumicosSemRetorno, respondidos.length),
    mapa,
    pico,
    medianaPrimeiraRespostaSeg: segundos(episodios),
    medianaComALojaAbertaSeg: segundos(episodios.filter((e) => e.aberta)),
    medianaComALojaFechadaSeg: segundos(fechados),
    respondidosComALojaFechada,
    proporcaoRespondidoComALojaFechada: proporcao(respondidosComALojaFechada, fechadosSemEmAberto.length),
  };
}

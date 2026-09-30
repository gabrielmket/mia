/**
 * FORK MIA · AS QUATRO JORNADAS DE QUALQUER SEGMENTO.
 *
 * Os modelos de clínica (`clinica.ts`, do upstream) desenharam quatro momentos
 * em que alguém some no meio do caminho: parou de responder, não marcou o que
 * ficou combinado, está decidindo algo grande e faltou no horário. Esses quatro
 * momentos não são de clínica: a imobiliária, a loja de carros, a academia e a
 * consultoria B2B vivem os mesmos, com outras palavras.
 *
 * Por isso aqui mora o RITMO (esperas, prazos de resposta, gatilho, política de
 * handoff) e cada segmento declara só a LINGUAGEM. O ritmo é copiado do
 * `clinica.ts`, jornada por jornada, e não importado dele: o arquivo do
 * upstream escreve os prazos inline, e mexer nele para exportá-los seria uma
 * diferença a mais em toda sincronização.
 *
 * O que vale para todo segmento, e que `modelos.test.ts` mede:
 *   • `cancel_on_reply: true`. Respondeu qualquer coisa, a conversa volta para
 *     quem atende. O follow-up só existe para o silêncio.
 *   • `handoffPolicy: "pause"`. Atendente assumiu, a escada espera.
 *   • texto sem variável, sem emoji e sem travessão; nada de preço, horário ou
 *     resultado prometido (a mensagem é escrita hoje e sai daqui a semanas).
 */
import type { ModeloDeFollowup, NichoDeModelo } from "./tipos";
import { montarEscada } from "./escada";
import type { FlowGraph } from "@/lib/followup/graph-schema";

const MIN_MS = 60_000;
const DIA_MS = 86_400_000;

/** A nota do fim "respondeu": quem assume a conversa dali em diante. */
const O_ATENDIMENTO_ASSUME = "O cliente respondeu. Quem segue a conversa é o atendimento.";

/** Os gatilhos em português, iguais para todo segmento que não é de saúde. */
export const DISPARA_NO_SILENCIO = "Um dia inteiro sem o cliente responder, com a conversa em aberto.";
export const DISPARA_NA_ETAPA = "O negócio entrar na etapa do funil que você escolher.";
export const DISPARA_NA_FALTA = "Alguém confirmar na agenda que o cliente não compareceu.";

/** Um toque, na voz do segmento. O quando é da jornada, não do segmento. */
export interface TextoDoToque {
  /** Nome do nó no construtor (até 60 caracteres). */
  rotulo: string;
  /** A mensagem, exatamente como o cliente lê. */
  texto: string;
}

/** O que cada segmento escreve para uma jornada. */
export interface TextosDaJornada<N extends 3 | 4> {
  id: string;
  /** Vira o nome do fluxo na organização: único no catálogo inteiro, até 80 caracteres. */
  nome: string;
  jornada: string;
  resumo: string;
  toques: N extends 3
    ? readonly [TextoDoToque, TextoDoToque, TextoDoToque]
    : readonly [TextoDoToque, TextoDoToque, TextoDoToque, TextoDoToque];
}

/**
 * O fim "topou" nasce da escada como "Fim: quis marcar". Numa proposta ou numa
 * retomada isso não descreve o que aconteceu, e é o rótulo que a pessoa lê no
 * canvas. Renomear aqui, depois de montar, deixa a escada do upstream intacta.
 */
function comFimDeGanho(grafo: FlowGraph, rotulo: string): FlowGraph {
  return {
    ...grafo,
    nodes: grafo.nodes.map((n) => (n.id === "fim-marcou" ? { ...n, label: rotulo } : n)),
  };
}

/**
 * RETOMADA: parou de responder com a conversa em aberto. Ritmo da "Consulta"
 * de clínica: dispara com 24 h de silêncio, três toques em uma semana.
 */
export function jornadaDeRetomada(nicho: NichoDeModelo, textos: TextosDaJornada<3>): ModeloDeFollowup {
  const [primeiro, segundo, terceiro] = textos.toques;
  return {
    id: textos.id,
    nicho,
    nome: textos.nome,
    jornada: textos.jornada,
    resumo: textos.resumo,
    oQueDispara: DISPARA_NO_SILENCIO,
    pedeEtapa: false,
    handoffPolicy: "pause",
    gatilho: () => ({
      kind: "silence",
      params: { threshold_minutes: 24 * 60 },
      cancel_on_reply: true,
    }),
    grafo: comFimDeGanho(
      montarEscada({
        prazoDeRespostaMs: 2 * DIA_MS,
        sim: { rotulo: "Quer seguir", padrao: "quero" },
        notaDeResposta: O_ATENDIMENTO_ASSUME,
        toques: [
          { ...primeiro },
          { esperaAntesMs: 2 * DIA_MS, ...segundo },
          { esperaAntesMs: 4 * DIA_MS, ...terceiro },
        ],
      }),
      "Fim: quis seguir",
    ),
  };
}

/**
 * AGENDAMENTO: mostrou interesse e não marcou o próximo passo (visita, test
 * drive, aula, reunião). Ritmo do "Exame" de clínica: a etapa dispara, um dia de
 * folga antes do primeiro toque, duas semanas no total.
 */
export function jornadaDeAgendamento(nicho: NichoDeModelo, textos: TextosDaJornada<3>): ModeloDeFollowup {
  const [primeiro, segundo, terceiro] = textos.toques;
  return {
    id: textos.id,
    nicho,
    nome: textos.nome,
    jornada: textos.jornada,
    resumo: textos.resumo,
    oQueDispara: DISPARA_NA_ETAPA,
    pedeEtapa: true,
    handoffPolicy: "pause",
    gatilho: ({ stageId }) => ({
      kind: "stage_change",
      params: { stage_id: stageId! },
      cancel_on_reply: true,
    }),
    grafo: montarEscada({
      prazoDeRespostaMs: 3 * DIA_MS,
      sim: { rotulo: "Quer marcar", padrao: "quero" },
      notaDeResposta: O_ATENDIMENTO_ASSUME,
      toques: [
        // Um dia, e não zero: a etapa quase sempre muda DURANTE a conversa, e
        // mandar na mesma hora é falar por cima de quem atende.
        { esperaAntesMs: DIA_MS, ...primeiro },
        { esperaAntesMs: 3 * DIA_MS, ...segundo },
        { esperaAntesMs: 5 * DIA_MS, ...terceiro },
      ],
    }),
  };
}

/**
 * DECISÃO: recebeu proposta e está decidindo algo grande. Ritmo da "Cirurgia"
 * de clínica: quatro toques espaçados, uns dois meses, sem pressionar.
 *
 * `ritmo: "curto"` (FORK MIA, pedido do Gabriel em 30/09/2026): carro e
 * academia se decidem em semanas, não em meses. Os mesmos quatro toques cabem
 * em cerca de um mês.
 */
export type RitmoDaDecisao = "longo" | "curto";

const TOQUES_DA_DECISAO: Record<RitmoDaDecisao, { prazoDeRespostaMs: number; esperas: readonly [number, number, number, number] }> = {
  longo: { prazoDeRespostaMs: 5 * DIA_MS, esperas: [3 * DIA_MS, 10 * DIA_MS, 21 * DIA_MS, 30 * DIA_MS] },
  curto: { prazoDeRespostaMs: 3 * DIA_MS, esperas: [1 * DIA_MS, 4 * DIA_MS, 10 * DIA_MS, 15 * DIA_MS] },
};

export function jornadaDeDecisao(
  nicho: NichoDeModelo,
  textos: TextosDaJornada<4>,
  ritmo: RitmoDaDecisao = "longo",
): ModeloDeFollowup {
  const { prazoDeRespostaMs, esperas } = TOQUES_DA_DECISAO[ritmo];
  const [primeiro, segundo, terceiro, quarto] = textos.toques;
  return {
    id: textos.id,
    nicho,
    nome: textos.nome,
    jornada: textos.jornada,
    resumo: textos.resumo,
    oQueDispara: DISPARA_NA_ETAPA,
    pedeEtapa: true,
    handoffPolicy: "pause",
    gatilho: ({ stageId }) => ({
      kind: "stage_change",
      params: { stage_id: stageId! },
      cancel_on_reply: true,
    }),
    grafo: comFimDeGanho(
      montarEscada({
        prazoDeRespostaMs,
        sim: { rotulo: "Quer seguir", padrao: "quero" },
        notaDeResposta: O_ATENDIMENTO_ASSUME,
        toques: [
          { esperaAntesMs: esperas[0], ...primeiro },
          { esperaAntesMs: esperas[1], ...segundo },
          { esperaAntesMs: esperas[2], ...terceiro },
          { esperaAntesMs: esperas[3], ...quarto },
        ],
      }),
      "Fim: quis seguir",
    ),
  };
}

/**
 * FALTA: não compareceu ao horário marcado. Ritmo da "Falta" de clínica: duas
 * horas depois da confirmação (a pessoa pode estar a caminho), três toques em
 * uma semana.
 */
export function jornadaDeFalta(nicho: NichoDeModelo, textos: TextosDaJornada<3>): ModeloDeFollowup {
  const [primeiro, segundo, terceiro] = textos.toques;
  return {
    id: textos.id,
    nicho,
    nome: textos.nome,
    jornada: textos.jornada,
    resumo: textos.resumo,
    oQueDispara: DISPARA_NA_FALTA,
    pedeEtapa: false,
    handoffPolicy: "pause",
    gatilho: () => ({ kind: "appointment_no_show", cancel_on_reply: true }),
    grafo: comFimDeGanho(
      montarEscada({
        prazoDeRespostaMs: 2 * DIA_MS,
        sim: { rotulo: "Quer remarcar", padrao: "remarcar" },
        notaDeResposta: O_ATENDIMENTO_ASSUME,
        toques: [
          { esperaAntesMs: 120 * MIN_MS, ...primeiro },
          { esperaAntesMs: 2 * DIA_MS, ...segundo },
          { esperaAntesMs: 5 * DIA_MS, ...terceiro },
        ],
      }),
      "Fim: quis remarcar",
    ),
  };
}

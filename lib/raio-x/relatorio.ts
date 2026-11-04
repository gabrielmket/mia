/**
 * FORK MIA (.101) · O RELATÓRIO DO RAIO-X, MONTADO A PARTIR DAS CONVERSAS. PURO.
 *
 * Duas fontes, e cada número diz de qual veio:
 *
 *  - o RELÓGIO (`metricas.ts`): velocidade da primeira resposta, mapa, sem
 *    resposta, sumiu sem retorno, nota de rapidez. Determinístico e testado;
 *  - o MODELO de IA (`analise.ts`), conversa a conversa: origem, assuntos,
 *    desfecho, as outras quatro notas e um comentário curto. Validado por
 *    esquema antes de entrar aqui; o que não passou não entra.
 *
 * O relatório guardado (`mia_raio_x_relatorios.dados`) é este objeto: só
 * números somados, rótulos, os 10 trechos anonimizados e as recomendações em
 * CÓDIGO + valores (a tela as escreve no idioma de quem lê). Nenhum telefone,
 * nenhum nome de cliente: o cliente é o número de ordem.
 */
import { balaoAnonimizado } from "./anonimizar";
import type { Indicadores } from "./comparacao";
import { FAIXAS, momentoLocal, type DiaDaSemana, type Faixa } from "./horario";
import { agregarMetricas, notaDeRapidez, type ConversaMedida, type MetricasDeTempo } from "./metricas";
import { ordemFormatada, type Segmento, type TipoDoRaioX } from "./regras";
import {
  CRITERIOS,
  CRITERIOS_VERSAO,
  DESFECHOS,
  DESFECHOS_DE_ATENCAO,
  DESFECHOS_RUINS,
  ORIGENS,
  ROTULO_DA_ORIGEM,
  definicaoDoSegmento,
  type Criterio,
  type Desfecho,
  type Origem,
} from "./segmentos";

/** O que o modelo devolve por conversa (já validado em `analise.ts`). */
export interface AnaliseDaConversa {
  origem: Origem;
  assuntos: string[];
  pediu_valor: boolean;
  recebeu_valor: boolean;
  desfecho: Desfecho;
  notas: {
    responde_o_perguntado: number | null;
    proximo_passo: number | null;
    volta_a_chamar: number | null;
    educacao: number | null;
  };
  comentario: string;
}

export interface MensagemDoRelatorio {
  daLoja: boolean;
  em: number;
  tipo: string;
  texto: string | null;
}

export interface ConversaParaORelatorio {
  numeroOrdem: number;
  /** A primeira mensagem do cliente veio de clique em anúncio (o metadado do aparelho). */
  anuncio: boolean;
  medida: ConversaMedida;
  analise: AnaliseDaConversa | null;
  foraDoTeto: boolean;
  mensagens: MensagemDoRelatorio[];
  /** O nome de perfil do cliente, só para tirá-lo dos trechos. Nunca vai ao relatório. */
  nomes: string[];
}

export interface Balao {
  daLoja: boolean;
  texto: string;
  dia: DiaDaSemana;
  hora: string;
  audio: boolean;
}

export interface Exemplo {
  ordem: string;
  origem: Origem;
  desfecho: Desfecho;
  desfechoRotulo: string;
  tom: "ok" | "warn" | "danger";
  baloes: Balao[];
  comentario: string;
  nota: number | null;
}

export type CodigoDaRecomendacao =
  | "fora_do_horario"
  | "voltar_a_chamar"
  | "mandar_o_valor"
  | "sem_resposta"
  | "pico"
  | "primeira_resposta_lenta";

export interface Recomendacao {
  codigo: CodigoDaRecomendacao;
  /** Quantas conversas o ponto alcança: é a ordem do relatório. */
  peso: number;
  valores: Record<string, number | string | null>;
}

export interface DadosDoRelatorio {
  versao: 1;
  criteriosVersao: string;
  empresa: string;
  segmento: Segmento;
  segmentoRotulo: string;
  tipo: TipoDoRaioX;
  periodo: { inicio: string; fim: string; dias: number };
  numeros: {
    conversas: number;
    mensagens: number;
    audios: number;
    audiosTranscritos: number;
    fotos: number;
    videos: number;
    documentos: number;
  };
  tempo: MetricasDeTempo;
  origem: Array<{ chave: Origem; rotulo: string; conversas: number }>;
  assuntos: Array<{ chave: string; rotulo: string; proporcao: number }>;
  desfechos: Array<{ chave: Desfecho; rotulo: string; conversas: number; tom: "ok" | "warn" | "danger" }>;
  anuncio: { conversas: number; agendaram: number; semResposta: number };
  notas: { media: number | null; porCriterio: Record<Criterio, number | null>; analisadas: number };
  exemplos: { bons: Exemplo[]; ruins: Exemplo[] };
  recomendacoes: Recomendacao[];
  /** Só no relatório da Time (decisão 9): nunca vai ao link do dono. */
  mia: { conversasComRespostaOuRetorno: number; semResposta: number; sumiramSemRetorno: number };
  /** Ficou sem resposta ou sem retorno, em conversas: a manchete do link do dono. */
  semRespostaOuRetorno: number;
  indicadores: Indicadores;
  analise: { analisadas: number; foraDoTeto: number; parcial: boolean };
}

export const EXEMPLOS_POR_LADO = 5;
const BALOES_POR_EXEMPLO = 4;

const r1 = (n: number) => Math.round(n * 10) / 10;

function media(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  return r1(valores.reduce((s, v) => s + v, 0) / valores.length);
}

/** As cinco notas de UMA conversa (rapidez do relógio, as outras do modelo). */
export function notasDaConversa(c: ConversaParaORelatorio): Record<Criterio, number | null> | null {
  if (!c.analise) return null;
  return {
    rapidez: notaDeRapidez(c.medida.medianaPrimeiraRespostaMin, c.medida.semResposta),
    responde_o_perguntado: c.analise.notas.responde_o_perguntado,
    proximo_passo: c.analise.notas.proximo_passo,
    volta_a_chamar: c.analise.notas.volta_a_chamar,
    educacao: c.analise.notas.educacao,
  };
}

function notaMediaDa(notas: Record<Criterio, number | null> | null): number | null {
  if (!notas) return null;
  return media(CRITERIOS.flatMap((k) => (notas[k] === null ? [] : [notas[k] as number])));
}

/**
 * O desfecho que vale. "Ficou sem resposta" é do relógio: o modelo pode errar a
 * leitura, mas não pode dizer que a loja respondeu quando ela não mandou nada.
 */
export function desfechoQueVale(c: ConversaParaORelatorio): Desfecho | null {
  const ultimo = c.medida.episodios[c.medida.episodios.length - 1];
  if (ultimo?.desfecho === "sem_resposta") return "sem_resposta";
  if (!c.analise) return null;
  if (c.analise.desfecho === "sem_resposta") return c.medida.mensagensDaLoja > 0 ? "sumiu" : "sem_resposta";
  return c.analise.desfecho;
}

function tomDoDesfecho(d: Desfecho): "ok" | "warn" | "danger" {
  if (DESFECHOS_RUINS.includes(d)) return "danger";
  if (DESFECHOS_DE_ATENCAO.includes(d)) return "warn";
  return "ok";
}

function horaLocal(instante: number): { dia: DiaDaSemana; hora: string } {
  const m = momentoLocal(instante);
  return { dia: m.dia, hora: `${String(Math.floor(m.minutos / 60)).padStart(2, "0")}:${String(m.minutos % 60).padStart(2, "0")}` };
}

/** Os balões do exemplo: o começo do primeiro episódio, só texto (e áudio transcrito). */
function baloesDoExemplo(c: ConversaParaORelatorio): Balao[] {
  const inicio = c.medida.episodios[0]?.inicio ?? null;
  const daConversa = c.mensagens
    .filter((m) => m.texto && m.texto.trim().length > 0 && (inicio === null || m.em >= inicio))
    .sort((a, b) => a.em - b.em)
    .slice(0, BALOES_POR_EXEMPLO);
  return daConversa.map((m) => ({
    daLoja: m.daLoja,
    texto: balaoAnonimizado(m.texto ?? "", c.nomes),
    audio: m.tipo === "audio",
    ...horaLocal(m.em),
  }));
}

function exemploDe(c: ConversaParaORelatorio, segmento: Segmento): Exemplo | null {
  const desfecho = desfechoQueVale(c);
  if (!desfecho || !c.analise) return null;
  const baloes = baloesDoExemplo(c);
  if (baloes.length === 0) return null;
  return {
    ordem: ordemFormatada(c.numeroOrdem),
    origem: c.analise.origem,
    desfecho,
    desfechoRotulo: definicaoDoSegmento(segmento).desfechos[desfecho],
    tom: tomDoDesfecho(desfecho),
    baloes,
    comentario: balaoAnonimizado(c.analise.comentario, c.nomes),
    nota: notaMediaDa(notasDaConversa(c)),
  };
}

const BONS: readonly Desfecho[] = ["agendou", "fechou", "negociando"];

/** 5 boas e 5 ruins, escolhidas pela nota (a Time revisa antes do dono). */
export function escolherExemplos(conversas: readonly ConversaParaORelatorio[], segmento: Segmento): DadosDoRelatorio["exemplos"] {
  const candidatos = conversas
    .map((c) => ({ c, d: desfechoQueVale(c), n: notaMediaDa(notasDaConversa(c)) }))
    .filter((x) => x.c.analise && x.d);
  const bons = candidatos
    .filter((x) => BONS.includes(x.d as Desfecho) && (x.n ?? 0) >= 6)
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.c.numeroOrdem - b.c.numeroOrdem)
    .slice(0, EXEMPLOS_POR_LADO * 2)
    .flatMap((x) => {
      const e = exemploDe(x.c, segmento);
      return e ? [e] : [];
    })
    .slice(0, EXEMPLOS_POR_LADO);
  const usados = new Set(bons.map((e) => e.ordem));
  const ruins = candidatos
    .filter((x) => !BONS.includes(x.d as Desfecho) || (x.n ?? 10) < 5)
    .filter((x) => x.d !== "outros_assuntos")
    .sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || a.c.numeroOrdem - b.c.numeroOrdem)
    .slice(0, EXEMPLOS_POR_LADO * 2)
    .flatMap((x) => {
      const e = exemploDe(x.c, segmento);
      return e && !usados.has(e.ordem) ? [e] : [];
    })
    .slice(0, EXEMPLOS_POR_LADO);
  return { bons, ruins };
}

export function recomendacoesDe(dados: {
  tempo: MetricasDeTempo;
  pediuValorSemReceber: number;
  conversas: number;
}): Recomendacao[] {
  const { tempo } = dados;
  const lista: Recomendacao[] = [];
  if ((tempo.proporcaoComALojaFechada ?? 0) >= 0.15 && (tempo.medianaComALojaFechadaMin ?? 0) > 60) {
    lista.push({
      codigo: "fora_do_horario",
      peso: tempo.episodiosComALojaFechada,
      valores: { proporcao: tempo.proporcaoComALojaFechada, mediana: tempo.medianaComALojaFechadaMin },
    });
  }
  if (tempo.sumicosSemRetorno >= 3) {
    lista.push({ codigo: "voltar_a_chamar", peso: tempo.sumicosSemRetorno, valores: { n: tempo.sumicosSemRetorno } });
  }
  if (dados.pediuValorSemReceber >= 2) {
    lista.push({ codigo: "mandar_o_valor", peso: dados.pediuValorSemReceber, valores: { n: dados.pediuValorSemReceber } });
  }
  if (tempo.semResposta >= 3) {
    lista.push({
      codigo: "sem_resposta",
      peso: tempo.semResposta,
      valores: { n: tempo.semResposta, proporcao: tempo.proporcaoSemResposta },
    });
  }
  if ((tempo.medianaComALojaAbertaMin ?? 0) > 15) {
    lista.push({
      codigo: "primeira_resposta_lenta",
      peso: Math.max(1, tempo.respondidos - tempo.episodiosComALojaFechada),
      valores: { mediana: tempo.medianaComALojaAbertaMin },
    });
  }
  if (tempo.pico && tempo.pico.episodios >= Math.max(5, Math.round(tempo.episodios * 0.08))) {
    lista.push({
      codigo: "pico",
      peso: tempo.pico.episodios,
      valores: {
        dia: tempo.pico.dia,
        faixa: FAIXAS.indexOf(tempo.pico.faixa as Faixa),
        episodios: tempo.pico.episodios,
        mediana: tempo.pico.medianaMin,
      },
    });
  }
  return lista.sort((a, b) => b.peso - a.peso);
}

export interface EntradaDoRelatorio {
  empresa: string;
  segmento: Segmento;
  tipo: TipoDoRaioX;
  periodo: { inicio: Date; fim: Date };
  conversas: ConversaParaORelatorio[];
}

export function montarRelatorio(entrada: EntradaDoRelatorio): DadosDoRelatorio {
  const def = definicaoDoSegmento(entrada.segmento);
  const doCliente = entrada.conversas.filter((c) => c.medida.doCliente);
  const tempo = agregarMetricas(doCliente.map((c) => c.medida));
  const analisadas = doCliente.filter((c) => c.analise);

  const contarOrigem = (o: Origem) =>
    doCliente.filter((c) => (c.anuncio ? "anuncio_meta" : (c.analise?.origem ?? null)) === o).length;
  const origem = ORIGENS.map((chave) => ({ chave, rotulo: ROTULO_DA_ORIGEM[chave], conversas: contarOrigem(chave) }))
    .filter((o) => o.conversas > 0)
    .sort((a, b) => b.conversas - a.conversas);

  const assuntos = Object.entries(def.assuntos)
    .map(([chave, rotulo]) => ({
      chave,
      rotulo,
      proporcao: analisadas.length ? analisadas.filter((c) => c.analise!.assuntos.includes(chave)).length / analisadas.length : 0,
    }))
    .filter((a) => a.proporcao > 0)
    .sort((a, b) => b.proporcao - a.proporcao);

  const desfechoDe = new Map(doCliente.map((c) => [c, desfechoQueVale(c)]));
  const desfechos = DESFECHOS.map((chave) => ({
    chave,
    rotulo: def.desfechos[chave],
    conversas: [...desfechoDe.values()].filter((d) => d === chave).length,
    tom: tomDoDesfecho(chave),
  }))
    .filter((d) => d.conversas > 0)
    .sort((a, b) => b.conversas - a.conversas);

  const doAnuncio = doCliente.filter((c) => c.anuncio || c.analise?.origem === "anuncio_meta");
  const anuncio = {
    conversas: doAnuncio.length,
    agendaram: doAnuncio.filter((c) => desfechoDe.get(c) === "agendou").length,
    semResposta: doAnuncio.filter((c) => desfechoDe.get(c) === "sem_resposta").length,
  };

  const notasPorConversa = analisadas.map(notasDaConversa).filter((n): n is Record<Criterio, number | null> => n !== null);
  const porCriterio = Object.fromEntries(
    CRITERIOS.map((k) => [k, media(notasPorConversa.flatMap((n) => (n[k] === null ? [] : [n[k] as number])))]),
  ) as Record<Criterio, number | null>;
  const notaMedia = media(notasPorConversa.flatMap((n) => {
    const m = notaMediaDa(n);
    return m === null ? [] : [m];
  }));

  const pediuValorSemReceber = analisadas.filter((c) => c.analise!.pediu_valor && !c.analise!.recebeu_valor).length;
  const agendou = analisadas.filter((c) => desfechoDe.get(c) === "agendou").length;

  const comSemResposta = doCliente.filter((c) => c.medida.semResposta).length;
  const comSumicoSemRetorno = doCliente.filter((c) => !c.medida.semResposta && c.medida.sumicos > c.medida.sumicosComRetorno).length;

  const contar = (tipo: string) => entrada.conversas.reduce((s, c) => s + c.mensagens.filter((m) => m.tipo === tipo).length, 0);

  return {
    versao: 1,
    criteriosVersao: CRITERIOS_VERSAO,
    empresa: entrada.empresa,
    segmento: entrada.segmento,
    segmentoRotulo: def.rotulo,
    tipo: entrada.tipo,
    periodo: {
      inicio: entrada.periodo.inicio.toISOString(),
      fim: entrada.periodo.fim.toISOString(),
      dias: Math.max(1, Math.round((entrada.periodo.fim.getTime() - entrada.periodo.inicio.getTime()) / 86_400_000)),
    },
    numeros: {
      conversas: doCliente.length,
      mensagens: entrada.conversas.reduce((s, c) => s + c.mensagens.length, 0),
      audios: contar("audio"),
      audiosTranscritos: entrada.conversas.reduce(
        (s, c) => s + c.mensagens.filter((m) => m.tipo === "audio" && m.texto).length,
        0,
      ),
      fotos: contar("imagem"),
      videos: contar("video"),
      documentos: contar("documento"),
    },
    tempo,
    origem,
    assuntos,
    desfechos,
    anuncio,
    notas: { media: notaMedia, porCriterio, analisadas: analisadas.length },
    exemplos: escolherExemplos(doCliente, entrada.segmento),
    recomendacoes: recomendacoesDe({ tempo, pediuValorSemReceber, conversas: doCliente.length }),
    mia: {
      conversasComRespostaOuRetorno: comSemResposta + comSumicoSemRetorno,
      semResposta: comSemResposta,
      sumiramSemRetorno: comSumicoSemRetorno,
    },
    semRespostaOuRetorno: comSemResposta + comSumicoSemRetorno,
    indicadores: {
      medianaPrimeiraRespostaMin: tempo.medianaPrimeiraRespostaMin,
      medianaComALojaFechadaMin: tempo.medianaComALojaFechadaMin,
      proporcaoSemResposta: tempo.proporcaoSemResposta,
      proporcaoSumiuSemRetorno: tempo.proporcaoSumiuSemRetorno,
      proporcaoPediuValorSemReceber: analisadas.length ? pediuValorSemReceber / analisadas.length : null,
      proporcaoAgendou: analisadas.length ? agendou / analisadas.length : null,
      notaMedia,
    },
    analise: {
      analisadas: analisadas.length,
      foraDoTeto: doCliente.filter((c) => c.foraDoTeto && !c.analise).length,
      parcial: doCliente.some((c) => c.foraDoTeto && !c.analise),
    },
  };
}

/** O que o link do DONO mostra: sem custo, sem o bloco da MIA, sem as anotações da Time. */
export type DadosDoDono = Omit<DadosDoRelatorio, "mia"> & { mia?: never };

export function dadosParaODono(dados: DadosDoRelatorio): DadosDoDono {
  const { mia: _mia, ...resto } = dados;
  void _mia;
  return resto;
}

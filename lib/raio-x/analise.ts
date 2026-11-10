/**
 * FORK MIA (.101) · A ANÁLISE DO RAIO-X: transcrever os áudios, classificar as
 * conversas por IA em lote e montar o relatório. Em rodadas curtas, como a
 * leitura (o agendador chama a cada minuto).
 *
 * ─── Quem paga, e quanto ────────────────────────────────────────────────────
 *
 * A credencial é a da PLATAFORMA (a chave de IA da instalação, `.env`): o raio-X
 * não é de uma empresa da MIA, e o custo é gasto da Time. Cada chamada vira uma
 * linha em `mia_raio_x_gastos` (propósito `raio_x_analise` ou
 * `raio_x_transcricao`), em dólar e em real pela cotação do dia. O TETO
 * (`mia_raio_x.teto_centavos`, padrão R$ 40, por relatório: no mensal, por
 * mês) é conferido ANTES de cada chamada com a estimativa conservadora dela;
 * bateu, a análise para, o que ficou de fora é marcado e o relatório sai
 * parcial, dizendo quantas.
 *
 * ─── O modelo ───────────────────────────────────────────────────────────────
 *
 * `gpt-6-luna` (OpenAI), o mais barato do catálogo que faz o trabalho: US$ 0,10
 * por milhão de tokens de entrada e US$ 0,50 de saída, a mesma faixa do Claude
 * Haiku 5.5. A escolha da OpenAI é pela chave: a transcrição de áudio já usa a
 * chave da OpenAI da instalação (Whisper), então o raio-X inteiro roda com UMA
 * chave. Sem chave da OpenAI e com a da Anthropic, vale o Claude Haiku 5.5. O
 * trabalho é classificação curta (origem, assunto, desfecho, quatro notas e um
 * comentário), com as métricas de tempo já calculadas fora do modelo; raciocínio
 * `low` basta. A justificativa e a medição estão na doc, seção 5.
 *
 * ─── Áudio ──────────────────────────────────────────────────────────────────
 *
 * A transcrição reaproveita o transcritor do produto
 * (`lib/messaging/media/transcription.ts`, o mesmo que o motor de agentes usa
 * para ouvir o cliente), com o serviço da instalação (`TRANSCRIPTION_API_KEY`)
 * ou a chave da OpenAI com `whisper-1`, em português. O arquivo é baixado do
 * leitor, transcrito e descartado: só o texto fica, até as conversas apagarem.
 *
 * ─── O relógio e as falhas (FORK MIA .106) ──────────────────────────────────
 *
 * Toda chamada para fora (download, transcrição, modelo) tem teto, e só começa
 * se termina antes do corte do agendador (`relogio-da-analise.ts`, com o
 * defeito da .101 que prendia a análise: o modelo só era chamado com 45 s
 * pela frente numa chamada de 45 s). Os áudios vão de 4 em 4. A exceção que se
 * repete no mesmo item fica em `analise.ultimo_erro` e, na terceira rodada
 * seguida, o item sai do caminho (`registrarFalha`): nada prende o raio-X.
 */
import { createHash, randomUUID } from "node:crypto";

import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { apiTranscriptionProvider, modeloDeTranscricaoEmVigor, type TranscriptionProvider } from "@/lib/messaging/media/transcription";

import type { LinhaDoRaioX } from "./banco";
import { compararRelatorios, gastoDoRaioX, lerNumerosDoRaioX, relatorioAnterior } from "./banco";
import { cifrarTexto, decifrarReferencia, decifrarTexto } from "./cifra";
import {
  COTACAO_DE_RESERVA,
  cabeNoTeto,
  centavosEmReais,
  custoDoAudioUsdCentavos,
  estimativaDaChamadaUsdCentavos,
  segundosDoAudio,
  tokensEstimados,
} from "./custo";
import { lojaAberta, momentoLocal } from "./horario";
import { audiosSemTranscricao, baixarAudioDaConta, lerConversasDaConta } from "./mensagens-da-conta";
import { medirConversa } from "./metricas";
import { medirPassagem } from "./passagem";
import { ehPessoa } from "./quem-respondeu";
import { prazosDoRelatorio } from "./prazos";
import { horarioDoRaioX, ordemFormatada, type Segmento } from "./regras";
import {
  AUDIOS_EM_PARALELO,
  cabeAChamada,
  comTeto,
  FALHAS_DE_DOWNLOAD_PARA_DESISTIR,
  FALHAS_SEGUIDAS_PARA_PULAR,
  TETO_DA_CLASSIFICACAO_MS,
  TETO_DA_FASE_DE_AUDIOS_MS,
  TETO_DA_TRANSCRICAO_MS,
  TETO_DO_DOWNLOAD_DO_RAIO_X_MS,
} from "./relogio-da-analise";
import { montarRelatorio, type AnaliseDaConversa, type ConversaParaORelatorio, type MensagemDoRelatorio } from "./relatorio";
import { DESFECHOS, ORIGENS, ROTULO_DA_ORIGEM, definicaoDoSegmento } from "./segmentos";
import { marcaDaMensagem } from "./tokens";

/** FORK MIA (.102): o raio-X do cliente ativo lê as conversas da conta, não as do leitor. */
const daConta = (r: Pick<LinhaDoRaioX, "fonte">) => r.fonte === "conversas_da_mia";

// ─── O modelo e a transcrição da plataforma ────────────────────────────────

export interface ModeloDaAnalise {
  provedor: "openai" | "anthropic";
  modelo: string;
  chave: string;
}

export const MODELO_PREFERIDO = "gpt-6-luna";
export const MODELO_DE_RESERVA = "claude-haiku-5-5";

export function modeloDaAnalise(ambiente: NodeJS.ProcessEnv = process.env): ModeloDaAnalise | null {
  const openai = ambiente.OPENAI_API_KEY?.trim();
  if (openai) return { provedor: "openai", modelo: MODELO_PREFERIDO, chave: openai };
  const anthropic = ambiente.ANTHROPIC_API_KEY?.trim();
  if (anthropic) return { provedor: "anthropic", modelo: MODELO_DE_RESERVA, chave: anthropic };
  return null;
}

/**
 * FORK MIA (.106): o pedido ao serviço de transcrição com teto. O transcritor do
 * upstream não passa sinal nenhum ao `fetch`; o nosso passa, e o pedido que
 * não responde é cancelado em vez de ficar pendurado. A corrida com o mesmo
 * teto em `transcrever` cobre qualquer outro transcritor (e o dublê do teste).
 */
const fetchComTetoDaTranscricao: typeof fetch = (entrada, init) => fetch(entrada, { ...init, signal: AbortSignal.timeout(TETO_DA_TRANSCRICAO_MS) });

export function transcritorDaPlataforma(ambiente: NodeJS.ProcessEnv = process.env): { provider: TranscriptionProvider; modelo: string } | null {
  const doServico = ambiente.TRANSCRIPTION_API_KEY?.trim();
  const base = ambiente.TRANSCRIPTION_BASE_URL?.trim() || undefined;
  const modeloDoAmbiente = ambiente.TRANSCRIPTION_MODEL?.trim() || undefined;
  if (doServico) {
    const modelo = modeloDoAmbiente ?? "whisper-1";
    return {
      provider: apiTranscriptionProvider({ apiKey: doServico, baseUrl: base, model: modelo, languages: ["pt"] }, fetchComTetoDaTranscricao),
      modelo,
    };
  }
  const openai = ambiente.OPENAI_API_KEY?.trim();
  if (!openai) return null;
  const modelo = modeloDeTranscricaoEmVigor({ model: modeloDoAmbiente, apiKey: undefined, baseUrl: base });
  return { provider: apiTranscriptionProvider({ apiKey: openai, model: modelo, languages: ["pt"] }, fetchComTetoDaTranscricao), modelo };
}

export async function cotacaoDoDia(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("platform_fx_rates").select("usd_brl").order("dia", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { usd_brl?: number | string } | null)?.usd_brl);
  return Number.isFinite(v) && v > 0.5 && v < 100 ? v : COTACAO_DE_RESERVA;
}

async function registrarGasto(
  admin: SupabaseClient,
  r: Pick<LinhaDoRaioX, "id" | "ciclo">,
  g: {
    proposito: "raio_x_analise" | "raio_x_transcricao";
    modelo: string;
    tokensEntrada?: number;
    tokensSaida?: number;
    segundos?: number;
    usdCentavos: number;
    estimado: boolean;
    cotacao: number;
  },
): Promise<number> {
  const reais = centavosEmReais(g.usdCentavos, g.cotacao);
  const { error } = await admin.from("mia_raio_x_gastos").insert({
    raio_x_id: r.id,
    ciclo: r.ciclo,
    proposito: g.proposito,
    modelo: g.modelo,
    tokens_entrada: g.tokensEntrada ?? 0,
    tokens_saida: g.tokensSaida ?? 0,
    segundos_de_audio: g.segundos ?? 0,
    custo_usd_centavos: g.usdCentavos,
    estimado: g.estimado,
    cotacao: g.cotacao,
    custo_centavos: reais,
  });
  if (error) throw new Error(`raio-x: gasto não gravou (${error.code ?? "sem_codigo"})`);
  return reais;
}

// ─── O pedido ao modelo ─────────────────────────────────────────────────────

const LOTE = 6;
const CARACTERES_POR_LOTE = 14_000;
const CARACTERES_POR_CONVERSA = 3_500;
const SAIDA_POR_CONVERSA = 450;
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export interface ConversaParaOModelo {
  id: string;
  fatos: string;
  linhas: string[];
}

function linhaDaMensagem(m: MensagemDoRelatorio): string {
  const local = momentoLocal(m.em);
  const hora = `${DIAS[local.dia]} ${String(Math.floor(local.minutos / 60)).padStart(2, "0")}:${String(local.minutos % 60).padStart(2, "0")}`;
  const quem = m.daLoja ? "loja" : "cliente";
  const corpo =
    m.tipo === "audio"
      ? m.texto
        ? `(áudio) ${m.texto}`
        : "(áudio sem transcrição)"
      : m.tipo === "texto"
        ? (m.texto ?? "")
        : `(${m.tipo})${m.texto ? ` ${m.texto}` : ""}`;
  return `[${quem} ${hora}] ${corpo.replace(/\s+/g, " ").slice(0, 300)}`;
}

/** O texto da conversa que vai ao modelo: o começo inteiro e o fim, até o teto. */
export function conversaParaOModelo(id: string, mensagens: MensagemDoRelatorio[], fatos: string): ConversaParaOModelo {
  const todas = mensagens.map(linhaDaMensagem);
  let linhas = todas;
  if (todas.join("\n").length > CARACTERES_POR_CONVERSA) {
    const inicio = todas.slice(0, 30);
    const fim = todas.slice(-10);
    linhas = [...inicio, "[... mensagens do meio omitidas ...]", ...fim];
    while (linhas.join("\n").length > CARACTERES_POR_CONVERSA && linhas.length > 4) linhas.splice(Math.floor(linhas.length / 2), 1);
  }
  return { id, fatos, linhas };
}

export function sistemaDoModelo(segmento: Segmento): string {
  const def = definicaoDoSegmento(segmento);
  return [
    `Você analisa conversas de WhatsApp entre uma empresa do segmento "${def.rotulo}" e os clientes dela, para um diagnóstico do atendimento comercial.`,
    "Responda SÓ com um objeto JSON, sem texto antes ou depois, no formato:",
    '{"conversas":[{"id":"C1","origem":"...","assuntos":["..."],"pediu_valor":true,"recebeu_valor":false,"desfecho":"...","notas":{"responde_o_perguntado":0,"proximo_passo":0,"volta_a_chamar":null,"educacao":0},"comentario":"..."}]}',
    "",
    "Campos:",
    `- origem: de onde o cliente veio, pela primeira mensagem dele. Uma de: ${ORIGENS.map((o) => `"${o}" (${ROTULO_DA_ORIGEM[o]})`).join(", ")}. Mensagem pronta de anúncio ("Olá! Tenho interesse e queria mais informações", "Vi o anúncio...") é "anuncio_meta"; citar o perfil do Instagram é "instagram"; citar ${def.portais} é "portal"; site ou Google é "google_site"; "fulano indicou" é "indicacao". Sem pista: "sem_identificacao".`,
    `- assuntos: até 3 chaves de: ${Object.entries(def.assuntos).map(([k, v]) => `"${k}" (${v})`).join(", ")}.`,
    "- pediu_valor: o cliente perguntou preço, valor, parcela ou proposta. recebeu_valor: a loja mandou o valor ou a proposta.",
    `- desfecho: como a conversa terminou. Um de: ${DESFECHOS.filter((d) => d !== "sem_resposta").map((d) => `"${d}" (${def.desfechos[d]})`).join(", ")}.`,
    `- notas de 0 a 10: responde_o_perguntado (a loja respondeu o que o cliente perguntou), proximo_passo (a loja chamou para o próximo passo: ${def.proximoPasso}), volta_a_chamar (a loja voltou a chamar o cliente que sumiu; null se o cliente não sumiu), educacao (educação e clareza). A rapidez NÃO é sua: já foi medida.`,
    "- comentario: uma frase de até 140 caracteres, em português, dizendo o que pesou no atendimento. Sem nomes, telefones nem dados do cliente.",
    "",
    "Use os FATOS de cada conversa (medidos pelo relógio, confiáveis) e o texto. Responda todas as conversas, com o mesmo id.",
  ].join("\n");
}

export function pedidoDoLote(conversas: ConversaParaOModelo[]): string {
  return conversas.map((c) => [`### Conversa ${c.id}`, `Fatos: ${c.fatos}`, ...c.linhas].join("\n")).join("\n\n");
}

const nota = z
  .union([z.number(), z.null()])
  .transform((n) => (n === null ? null : Math.max(0, Math.min(10, Math.round(n)))))
  .catch(null);

const itemDoModelo = z.object({
  id: z.string(),
  origem: z.enum(ORIGENS).catch("sem_identificacao"),
  assuntos: z.array(z.string()).catch([]),
  pediu_valor: z.boolean().catch(false),
  recebeu_valor: z.boolean().catch(false),
  desfecho: z.enum(DESFECHOS).catch("outros_assuntos"),
  notas: z
    .object({ responde_o_perguntado: nota, proximo_passo: nota, volta_a_chamar: nota, educacao: nota })
    .catch({ responde_o_perguntado: null, proximo_passo: null, volta_a_chamar: null, educacao: null }),
  comentario: z.string().catch(""),
});

/** Lê a resposta do modelo. Só o que passa no esquema entra; o resto fica sem análise. */
export function lerRespostaDoModelo(texto: string, segmento: Segmento): Map<string, AnaliseDaConversa> {
  const saida = new Map<string, AnaliseDaConversa>();
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return saida;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    return saida;
  }
  const lista = (bruto as { conversas?: unknown })?.conversas;
  if (!Array.isArray(lista)) return saida;
  const assuntosValidos = new Set(Object.keys(definicaoDoSegmento(segmento).assuntos));
  for (const item of lista) {
    const p = itemDoModelo.safeParse(item);
    if (!p.success) continue;
    saida.set(p.data.id, {
      origem: p.data.origem,
      assuntos: [...new Set(p.data.assuntos.filter((a) => assuntosValidos.has(a)))].slice(0, 3),
      pediu_valor: p.data.pediu_valor,
      recebeu_valor: p.data.recebeu_valor,
      desfecho: p.data.desfecho,
      notas: p.data.notas,
      comentario: semNulo(p.data.comentario).slice(0, 160),
    });
  }
  return saida;
}

export type ChamarOModelo = (pedido: { sistema: string; texto: string; tetoDeSaida: number }) => Promise<{
  texto: string;
  tokensEntrada: number;
  tokensSaida: number;
  cacheLido: number;
}>;

/** A chamada real, com a credencial da plataforma e o egress contido do produto. */
export function chamadaDaPlataforma(m: ModeloDaAnalise): ChamarOModelo {
  return async ({ sistema, texto, tetoDeSaida }) => {
    const registro = createDefaultRegistry({ openaiReasoningEffort: "low" });
    const fabrica = registro[m.provedor];
    if (!fabrica) throw new Error("raio-x: provedor da análise indisponível");
    const r = await generateText({
      model: fabrica(m.chave, m.modelo),
      system: sistema,
      prompt: texto,
      maxOutputTokens: tetoDeSaida,
      // FORK MIA (.106): o mesmo teto que decide se a chamada cabe no prazo (relogio-da-analise.ts).
      abortSignal: AbortSignal.timeout(TETO_DA_CLASSIFICACAO_MS),
    });
    return {
      texto: r.text ?? "",
      tokensEntrada: r.usage.inputTokens ?? 0,
      tokensSaida: r.usage.outputTokens ?? 0,
      cacheLido: r.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    };
  };
}

// ─── A rodada ───────────────────────────────────────────────────────────────

interface Ambiente {
  admin: SupabaseClient;
  leitor: LeitorDoRaioX | null;
  modelo: ModeloDaAnalise | null;
  chamar: ChamarOModelo | null;
  transcritor: { provider: TranscriptionProvider; modelo: string } | null;
  prazo: number;
  agora: () => number;
  /** FORK MIA (.102), para o teste: o arquivo do áudio da conta (sem ele, o storage da conta). */
  baixarDaConta?: (mensagemId: string) => Promise<{ bytes: Buffer; mime: string } | null>;
  /** FORK MIA (.106): onde a rodada está agora (a etapa e os itens), para contar as falhas seguidas. */
  rastro?: Rastro;
}

// ─── FORK MIA (.106) · as falhas seguidas e o último erro ───────────────────

export type EtapaDaAnalise = "preparo" | "transcricao" | "classificacao" | "relatorio";

/** A etapa e os itens em curso: ids internos (mensagem, conversa), nunca dado de cliente. */
interface Rastro {
  etapa: EtapaDaAnalise;
  itens: Array<string | number>;
}

/** O que fica em `mia_raio_x.analise.ultimo_erro` (a tela e o MCP mostram). */
export interface UltimoErroDaAnalise {
  quando: string;
  etapa: EtapaDaAnalise;
  mensagem: string;
  /** Resumo da etapa e dos itens: a mesma chave em rodadas seguidas é "o mesmo item". */
  chave: string;
  /** Quantos itens estavam em curso. */
  itens: number;
  /** Na N-ésima falha seguida, o item foi deixado de lado (o áudio vira "falhou", a conversa vai sem análise). */
  pulou?: boolean;
}

/**
 * As mensagens que são NOSSAS (códigos, sem conteúdo de conversa) passam
 * inteiras; a de fora (provedor, rede) vira só o nome e o status: ela pode
 * trazer pedaço do pedido ou da chave.
 */
const MENSAGEM_NOSSA = /^(raio-x: [^\n]{1,150}|sem_resposta|transcription_\d{3}|leitor_[a-z0-9_]{1,40}|rota_nao_permitida)$/;

export function mensagemCurtaDoErro(erro: unknown): string {
  if (!(erro instanceof Error)) return "erro";
  if (MENSAGEM_NOSSA.test(erro.message)) return erro.message;
  const bruto = erro as { statusCode?: unknown; status?: unknown };
  const status = typeof bruto.statusCode === "number" ? bruto.statusCode : typeof bruto.status === "number" ? bruto.status : null;
  return `${(erro.name || "Error").slice(0, 60)}${status !== null ? ` ${status}` : ""}`;
}

/** O Postgres recusa o caractere nulo em texto e em jsonb: sai antes de gravar. */
const semNulo = (texto: string) => texto.replace(/\u0000/g, "");

/** Junta `patch` ao `analise` do raio-X, no banco e na linha em memória. */
async function gravarNaAnalise(admin: SupabaseClient, r: LinhaDoRaioX, patch: Record<string, unknown>): Promise<void> {
  const analise = { ...r.analise, ...patch };
  const { error } = await admin.from("mia_raio_x").update({ analise }).eq("id", r.id);
  if (error) throw new Error(`raio-x: andamento da análise (${error.code ?? "sem_codigo"})`);
  r.analise = analise;
}

/** Deixa de lado o item que falhou N vezes seguidas. Devolve se pulou alguma coisa. */
async function pularOItem(admin: SupabaseClient, r: LinhaDoRaioX, rastro: Rastro): Promise<boolean> {
  // O relatório sai sem a comparação; na conta, o preparo dos áudios é dado por feito. Na conexão não há preparo.
  if (rastro.etapa === "relatorio") return true;
  if (rastro.etapa === "preparo") return daConta(r);
  if (rastro.itens.length === 0) return false;
  const { error } =
    rastro.etapa === "transcricao"
      ? await admin.from("mia_raio_x_mensagens").update({ transcricao: "falhou", texto: null, midia: null }).eq("raio_x_id", r.id).in("id", rastro.itens)
      : await admin.from("mia_raio_x_conversas").update({ analise: null, analise_ciclo: r.ciclo }).eq("raio_x_id", r.id).in("id", rastro.itens);
  if (error) throw new Error(`raio-x: pular o item (${error.code ?? "sem_codigo"})`);
  return true;
}

/**
 * Conta a falha da rodada no item em curso. A mesma chave da rodada anterior
 * soma; outra recomeça em 1. Na `FALHAS_SEGUIDAS_PARA_PULAR`-ésima, o item sai
 * do caminho: o áudio vira "falhou", a conversa vai sem análise
 * (`analise: null` no ciclo), o relatório sai sem a comparação com o anterior,
 * e o preparo dos áudios da conta é dado por feito. Nada disso para o raio-X.
 */
async function registrarFalha(admin: SupabaseClient, r: LinhaDoRaioX, rastro: Rastro, erro: unknown, agora: number): Promise<void> {
  const chave = createHash("sha256").update(`${rastro.etapa}:${rastro.itens.join(",")}`).digest("hex").slice(0, 16);
  const anterior = r.analise.ultimo_erro as Partial<UltimoErroDaAnalise> | undefined;
  const seguidas = anterior?.chave === chave ? (Number(r.analise.falhas_seguidas) || 0) + 1 : 1;
  const ultimo: UltimoErroDaAnalise = {
    quando: new Date(agora).toISOString(),
    etapa: rastro.etapa,
    mensagem: mensagemCurtaDoErro(erro),
    chave,
    itens: rastro.itens.length,
  };
  if (seguidas < FALHAS_SEGUIDAS_PARA_PULAR) {
    await gravarNaAnalise(admin, r, { ultimo_erro: ultimo, falhas_seguidas: seguidas });
    return;
  }
  const pulou = await pularOItem(admin, r, rastro).catch(() => false);
  await gravarNaAnalise(admin, r, {
    ultimo_erro: { ...ultimo, pulou },
    falhas_seguidas: pulou ? 0 : seguidas,
    ...(pulou && rastro.etapa === "relatorio" ? { relatorio_sem_comparacao: true } : {}),
    ...(pulou && rastro.etapa === "preparo" && daConta(r) ? { audios_preparados: true } : {}),
  });
}

interface LinhaDaMensagem {
  id: number;
  conversa_id: string;
  da_loja: boolean;
  enviada_em: string;
  tipo: string;
  texto: string | null;
  segundos: number | null;
  midia: string | null;
  transcricao: string;
}

interface LinhaDaConversa {
  id: string;
  numero_ordem: number;
  anuncio: boolean;
  referencia: string | null;
  analise: AnaliseDaConversa | null;
  analise_ciclo: number | null;
  fora_do_teto: boolean;
}

function periodo(r: LinhaDoRaioX): { inicio: string; fim: string } {
  const fim = r.periodo_fim ?? new Date().toISOString();
  const inicio = r.periodo_inicio ?? new Date(Date.parse(fim) - r.periodo_dias * 86_400_000).toISOString();
  return { inicio, fim };
}

async function mensagensDoPeriodo(admin: SupabaseClient, r: LinhaDoRaioX, conversaIds?: string[]): Promise<LinhaDaMensagem[]> {
  const { inicio, fim } = periodo(r);
  const todas: LinhaDaMensagem[] = [];
  for (let de = 0; ; de += 1000) {
    let q = admin
      .from("mia_raio_x_mensagens")
      .select("id, conversa_id, da_loja, enviada_em, tipo, texto, segundos, midia, transcricao")
      .eq("raio_x_id", r.id)
      .gte("enviada_em", inicio)
      .lte("enviada_em", fim)
      .order("id", { ascending: true })
      .range(de, de + 999);
    if (conversaIds) q = q.in("conversa_id", conversaIds);
    const { data, error } = await q;
    if (error) throw new Error(`raio-x: mensagens do período (${error.code ?? "sem_codigo"})`);
    const pagina = (data ?? []) as LinhaDaMensagem[];
    todas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return todas;
}

const paraMensagem = (m: LinhaDaMensagem): MensagemDoRelatorio => ({
  daLoja: m.da_loja,
  em: Date.parse(m.enviada_em),
  tipo: m.tipo,
  texto: m.texto,
});

/**
 * As mensagens de cada conversa pedida. Na conexão, as que o leitor gravou
 * (a .101, sem mudança); FORK MIA (.102) no cliente ativo, as da própria conta
 * (`mensagens-da-conta.ts`): a conversa cujo contato deixou de poder ser lido
 * não volta, e é tratada como "sem mensagem do cliente".
 */
async function mensagensPorConversa(admin: SupabaseClient, r: LinhaDoRaioX, conversas: LinhaDaConversa[]): Promise<Map<string, MensagemDoRelatorio[]>> {
  if (daConta(r)) {
    const lidas = await lerConversasDaConta(admin, r, conversas, { extras: false });
    return new Map([...lidas].map(([id, c]) => [id, c.mensagens]));
  }
  const mensagens = await mensagensDoPeriodo(admin, r, conversas.map((c) => c.id));
  const porConversa = new Map<string, MensagemDoRelatorio[]>();
  for (const m of mensagens) {
    const lista = porConversa.get(m.conversa_id) ?? [];
    lista.push(paraMensagem(m));
    porConversa.set(m.conversa_id, lista);
  }
  return porConversa;
}

/**
 * FORK MIA (.102) · os áudios do cliente ativo que a MIA ainda não transcreveu
 * viram linhas PENDENTES em `mia_raio_x_mensagens` (só a marca, o id da
 * mensagem cifrado e, depois, a transcrição), uma vez por ciclo. O resto do
 * caminho é o da .101: o teto antes de cada áudio, o gasto gravado, e o
 * arquivo descartado (aqui ele vem do storage da conta, não do leitor).
 */
async function prepararAudiosDaConta(amb: Ambiente, r: LinhaDoRaioX): Promise<void> {
  const conversas: Array<{ id: string; referencia: string | null }> = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await amb.admin
      .from("mia_raio_x_conversas")
      .select("id, referencia")
      .eq("raio_x_id", r.id)
      .order("numero_ordem", { ascending: true })
      .range(de, de + 999);
    if (error) throw new Error(`raio-x: conversas do raio-X (${error.code ?? "sem_codigo"})`);
    const pagina = (data ?? []) as Array<{ id: string; referencia: string | null }>;
    conversas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const audios = await audiosSemTranscricao(amb.admin, r, conversas);
  for (let i = 0; i < audios.length; i += 500) {
    const linhas = audios.slice(i, i + 500).map((a) => ({
      raio_x_id: r.id,
      conversa_id: a.conversaId,
      marca: marcaDaMensagem(r.id, a.mensagemId),
      da_loja: a.daLoja,
      enviada_em: a.em,
      tipo: "audio",
      texto: null,
      segundos: null,
      midia: cifrarTexto(a.mensagemId),
      transcricao: "pendente",
    }));
    const { error } = await amb.admin.from("mia_raio_x_mensagens").upsert(linhas, { onConflict: "raio_x_id,marca", ignoreDuplicates: true });
    if (error) throw new Error(`raio-x: áudios da conta (${error.code ?? "sem_codigo"})`);
  }
  await gravarNaAnalise(amb.admin, r, { audios_preparados: true });
}

/**
 * FORK MIA (.106) · cabe começar uma chamada de até `tetoMs`? A .101 pedia
 * 45 s pela frente para chamar o modelo, numa chamada de cron de 45 s: nunca
 * cabia (relogio-da-analise.ts conta o defeito e a regra).
 */
function cabe(amb: Ambiente, tetoMs: number): boolean {
  return cabeAChamada(amb.prazo, amb.agora(), tetoMs);
}

interface AudioPendente {
  id: number;
  conversa_id: string;
  segundos: number | null;
  midia: string | null;
}

/** `baixou`: true = o arquivo chegou; false = o download falhou (conta para a desistência); null = nem tentou. */
interface ResultadoDoAudio {
  id: number;
  transcricao: "feita" | "falhou";
  texto: string | null;
  baixou: boolean | null;
}

/**
 * 1. Os áudios pendentes do período, até o prazo da chamada.
 *
 * FORK MIA (.106): de `AUDIOS_EM_PARALELO` em `AUDIOS_EM_PARALELO` (cada um
 * baixa e transcreve por conta, `Promise.allSettled`), com o teto de custo
 * conferido para o LOTE antes. O download tem teto próprio
 * (`TETO_DO_DOWNLOAD_DO_RAIO_X_MS`, 10 s) e a transcrição também
 * (`TETO_DA_TRANSCRICAO_MS`, 30 s, por `Promise.race` aqui: o transcritor do
 * upstream não tem). Desiste, e o que falta vira "falhou", com
 * `FALHAS_DE_DOWNLOAD_PARA_DESISTIR` downloads falhando em sequência (o áudio
 * antigo que o WhatsApp não entrega mais) ou passados
 * `TETO_DA_FASE_DE_AUDIOS_MS` de `analise.audios_desde`. Áudio sem resposta
 * vira "falhou" e a fila segue.
 */
async function transcrever(amb: Ambiente, r: LinhaDoRaioX, cotacao: number): Promise<"pronto" | "andou" | "parou"> {
  const rastro: Rastro = amb.rastro ?? { etapa: "transcricao", itens: [] };
  rastro.etapa = "transcricao";
  rastro.itens = [];
  const { inicio, fim } = periodo(r);
  const lerPendentes = async (): Promise<AudioPendente[]> => {
    const { data, error } = await amb.admin
      .from("mia_raio_x_mensagens")
      .select("id, conversa_id, segundos, midia")
      .eq("raio_x_id", r.id)
      .eq("transcricao", "pendente")
      .gte("enviada_em", inicio)
      .lte("enviada_em", fim)
      .order("id", { ascending: true })
      .limit(AUDIOS_EM_PARALELO * 4);
    if (error) throw new Error(`raio-x: áudios pendentes (${error.code ?? "sem_codigo"})`);
    return (data ?? []) as AudioPendente[];
  };
  let pendentes = await lerPendentes();
  if (pendentes.length === 0) return "pronto";

  const marcarTodos = async (transcricao: "sem_servico" | "falhou" | "fora_do_teto") => {
    const { error: e } = await amb.admin
      .from("mia_raio_x_mensagens")
      .update({ transcricao, midia: null })
      .eq("raio_x_id", r.id)
      .eq("transcricao", "pendente")
      .gte("enviada_em", inicio)
      .lte("enviada_em", fim);
    if (e) throw new Error(`raio-x: marcar áudios (${e.code ?? "sem_codigo"})`);
  };
  // Sem serviço de transcrição, ou sem o leitor (desconectado): o áudio é só contado.
  const transcritor = amb.transcritor;
  if (!transcritor) {
    await marcarTodos("sem_servico");
    return "pronto";
  }
  // FORK MIA (.102): o cliente ativo não tem leitor; o áudio vem do storage da própria conta.
  if (!daConta(r) && (!amb.leitor || !r.sessao || r.desconectado_em)) {
    await marcarTodos("falhou");
    return "pronto";
  }
  // FORK MIA (.106): a fase de áudios tem teto de relógio, contado da primeira rodada que transcreveu.
  const desde = Date.parse(typeof r.analise.audios_desde === "string" ? r.analise.audios_desde : "");
  if (Number.isFinite(desde) && amb.agora() - desde >= TETO_DA_FASE_DE_AUDIOS_MS) {
    await marcarTodos("falhou");
    return "pronto";
  }
  const tetoDoAudio = TETO_DO_DOWNLOAD_DO_RAIO_X_MS + TETO_DA_TRANSCRICAO_MS;
  if (!cabe(amb, tetoDoAudio)) return "parou";
  if (!Number.isFinite(desde)) await gravarNaAnalise(amb.admin, r, { audios_desde: new Date(amb.agora()).toISOString() });

  const baixarDaConta =
    amb.baixarDaConta ?? ((mensagemId: string) => (r.organization_id ? baixarAudioDaConta(amb.admin, r.organization_id, mensagemId) : Promise.resolve(null)));
  const referencias = new Map<string, Promise<string | null>>();
  const referenciaDe = (conversaId: string): Promise<string | null> => {
    let ref = referencias.get(conversaId);
    if (!ref) {
      ref = Promise.resolve(amb.admin.from("mia_raio_x_conversas").select("referencia").eq("id", conversaId).maybeSingle()).then(
        ({ data: c }) => decifrarReferencia((c as { referencia?: string | null } | null)?.referencia)?.chatId ?? null,
        () => null,
      );
      referencias.set(conversaId, ref);
    }
    return ref;
  };

  const transcreverUm = async (p: AudioPendente): Promise<ResultadoDoAudio> => {
    const falhou = (baixou: boolean | null): ResultadoDoAudio => ({ id: p.id, transcricao: "falhou", texto: null, baixou });
    const mensagemId = decifrarTexto(p.midia);
    const chatId = daConta(r) ? null : await referenciaDe(p.conversa_id);
    if (!mensagemId || (!daConta(r) && !chatId)) return falhou(null);
    let audio: { bytes: Buffer; mime: string } | null;
    try {
      audio = await comTeto(
        daConta(r) ? baixarDaConta(mensagemId) : amb.leitor!.baixarAudio(r.sessao!, chatId!, mensagemId, TETO_DO_DOWNLOAD_DO_RAIO_X_MS),
        TETO_DO_DOWNLOAD_DO_RAIO_X_MS,
      );
    } catch {
      return falhou(false);
    }
    if (!audio) return falhou(false);
    try {
      const segundos = segundosDoAudio(p.segundos, audio.bytes.byteLength);
      const medido = await comTeto<{ texto: string; custoCents?: number | null }>(
        transcritor.provider.transcribeMedindo
          ? transcritor.provider.transcribeMedindo(audio.bytes, audio.mime)
          : transcritor.provider.transcribe(audio.bytes, audio.mime).then((texto) => ({ texto, custoCents: null })),
        TETO_DA_TRANSCRICAO_MS,
      );
      const usd = typeof medido.custoCents === "number" ? medido.custoCents : custoDoAudioUsdCentavos(segundos);
      await registrarGasto(amb.admin, r, {
        proposito: "raio_x_transcricao",
        modelo: transcritor.modelo,
        segundos,
        usdCentavos: usd,
        estimado: typeof medido.custoCents !== "number",
        cotacao,
      });
      const texto = semNulo(medido.texto ?? "").trim();
      return { id: p.id, transcricao: texto ? "feita" : "falhou", texto: texto ? texto.slice(0, 4000) : null, baixou: true };
    } catch {
      return falhou(true);
    }
  };

  let downloadsQueFalharam = Number(r.analise.falhas_de_download_seguidas) || 0;
  let andou = false;
  while (pendentes.length > 0) {
    if (!cabe(amb, tetoDoAudio)) return andou ? "andou" : "parou";
    const proximos = pendentes.slice(0, AUDIOS_EM_PARALELO);
    pendentes = pendentes.slice(proximos.length);
    rastro.itens = proximos.map((p) => p.id);
    // O teto de custo do LOTE, antes de qualquer chamada: entra o que couber, na ordem.
    const gasto = await gastoDoRaioX(amb.admin, r.id, r.ciclo);
    const lote: AudioPendente[] = [];
    let estimativa = 0;
    for (const p of proximos) {
      const desteAudio = centavosEmReais(custoDoAudioUsdCentavos(Math.max(60, p.segundos ?? 60)), cotacao);
      if (!cabeNoTeto(gasto.centavos, estimativa + desteAudio, r.teto_centavos).pode) break;
      estimativa += desteAudio;
      lote.push(p);
    }
    if (lote.length === 0) {
      await marcarTodos("fora_do_teto");
      return "pronto";
    }
    rastro.itens = lote.map((p) => p.id);
    const resultados = await Promise.allSettled(lote.map(transcreverUm));
    const saida: ResultadoDoAudio[] = resultados.map((x, i) =>
      x.status === "fulfilled" ? x.value : { id: lote[i]!.id, transcricao: "falhou", texto: null, baixou: null },
    );
    const antes = downloadsQueFalharam;
    for (const s of saida) {
      if (s.baixou === false) downloadsQueFalharam += 1;
      else if (s.baixou === true) downloadsQueFalharam = 0;
    }
    // Grava todos; o que não gravou é o item da falha (a rodada seguinte o pega de novo).
    const naoGravaram: number[] = [];
    let codigo = "sem_codigo";
    for (const s of saida) {
      const { error: e } = await amb.admin
        .from("mia_raio_x_mensagens")
        .update({ transcricao: s.transcricao, texto: s.texto, midia: null })
        .eq("id", s.id);
      if (e) {
        naoGravaram.push(s.id);
        codigo = e.code ?? "sem_codigo";
      }
    }
    if (naoGravaram.length > 0) {
      rastro.itens = naoGravaram;
      throw new Error(`raio-x: transcrição não gravou (${codigo})`);
    }
    andou = true;
    if (downloadsQueFalharam !== antes) await gravarNaAnalise(amb.admin, r, { falhas_de_download_seguidas: downloadsQueFalharam });
    if (downloadsQueFalharam >= FALHAS_DE_DOWNLOAD_PARA_DESISTIR || lote.length < proximos.length) {
      // Dez downloads seguidos sem o arquivo: o que falta do período não vai chegar. Ou o teto acabou no meio do lote.
      await marcarTodos(lote.length < proximos.length ? "fora_do_teto" : "falhou");
      return "pronto";
    }
    if (pendentes.length === 0) pendentes = await lerPendentes();
  }
  return "pronto";
}

/** 2. A classificação das conversas, em lote. */
async function classificar(amb: Ambiente, r: LinhaDoRaioX, cotacao: number): Promise<"pronto" | "andou" | "parou"> {
  // FORK MIA (.106): o rastro diz em que conversa a rodada estava se ela lançar.
  const rastro: Rastro = amb.rastro ?? { etapa: "classificacao", itens: [] };
  rastro.etapa = "classificacao";
  rastro.itens = [];
  const { inicio } = periodo(r);
  const { data, error } = await amb.admin
    .from("mia_raio_x_conversas")
    .select("id, numero_ordem, anuncio, referencia, analise, analise_ciclo, fora_do_teto")
    .eq("raio_x_id", r.id)
    .eq("fora_do_teto", false)
    .or(`analise_ciclo.is.null,analise_ciclo.neq.${r.ciclo}`)
    .gte("ultima_em", inicio)
    .order("numero_ordem", { ascending: true })
    .limit(LOTE * 3);
  if (error) throw new Error(`raio-x: conversas pendentes (${error.code ?? "sem_codigo"})`);
  const pendentes = (data ?? []) as unknown as LinhaDaConversa[];
  if (pendentes.length === 0) return "pronto";
  rastro.itens = pendentes.map((c) => c.id);

  const marcar = async (ids: string[], valores: Record<string, unknown>) => {
    if (ids.length === 0) return;
    const { error: e } = await amb.admin.from("mia_raio_x_conversas").update(valores).in("id", ids);
    if (e) throw new Error(`raio-x: marcar conversas (${e.code ?? "sem_codigo"})`);
  };

  const porConversa = await mensagensPorConversa(amb.admin, r, pendentes);
  // Sem mensagem do cliente no período: nada a classificar (campanha da loja, ou fora do mês).
  const semCliente = pendentes.filter((c) => !(porConversa.get(c.id) ?? []).some((m) => !m.daLoja));
  await marcar(semCliente.map((c) => c.id), { analise: null, analise_ciclo: r.ciclo });
  const aClassificar = pendentes.filter((c) => !semCliente.includes(c));
  if (aClassificar.length === 0) return "andou";

  if (!amb.modelo || !amb.chamar) {
    // Sem credencial de IA: o relatório sai só com o relógio, e diz.
    await marcar(aClassificar.map((c) => c.id), { analise: null, analise_ciclo: r.ciclo });
    return "andou";
  }

  const horario = horarioDoRaioX(r);
  const fimMs = Date.parse(periodo(r).fim);
  const lote: Array<{ conversa: LinhaDaConversa; paraOModelo: ConversaParaOModelo }> = [];
  let tamanho = 0;
  for (const c of aClassificar) {
    rastro.itens = [c.id];
    const msgs = (porConversa.get(c.id) ?? []).sort((a, b) => a.em - b.em);
    const medida = medirConversa(msgs.map((m) => ({ daLoja: m.daLoja, em: m.em })), horario, fimMs);
    const fatos = [
      medida.medianaPrimeiraRespostaMin === null ? "a loja não respondeu" : `primeira resposta em ${medida.medianaPrimeiraRespostaMin} min`,
      medida.sumicos > 0 ? `o cliente sumiu depois da resposta da loja${medida.sumicosComRetorno > 0 ? " e a loja voltou a chamar" : " e a loja não voltou a chamar"}` : "o cliente não sumiu",
      c.anuncio ? "a primeira mensagem veio de clique num anúncio" : "",
    ]
      .filter(Boolean)
      .join("; ");
    const paraOModelo = conversaParaOModelo(`C${ordemFormatada(c.numero_ordem)}`, msgs, fatos);
    const peso = paraOModelo.linhas.join("\n").length;
    if (lote.length > 0 && (lote.length >= LOTE || tamanho + peso > CARACTERES_POR_LOTE)) break;
    lote.push({ conversa: c, paraOModelo });
    tamanho += peso;
  }
  rastro.itens = lote.map((x) => x.conversa.id);

  const sistema = sistemaDoModelo(r.segmento as Segmento);
  const texto = pedidoDoLote(lote.map((x) => x.paraOModelo));
  const tetoDeSaida = SAIDA_POR_CONVERSA * lote.length + 300;
  const estimativaUsd = estimativaDaChamadaUsdCentavos(amb.modelo.modelo, tokensEstimados(sistema + texto), tetoDeSaida);
  if (estimativaUsd === null) {
    await marcar(lote.map((x) => x.conversa.id), { analise: null, analise_ciclo: r.ciclo });
    return "andou";
  }
  const gasto = await gastoDoRaioX(amb.admin, r.id, r.ciclo);
  if (!cabeNoTeto(gasto.centavos, centavosEmReais(estimativaUsd, cotacao), r.teto_centavos).pode) {
    // Bateu o teto: o que falta fica de fora, e o relatório diz quantas.
    await amb.admin
      .from("mia_raio_x_conversas")
      .update({ fora_do_teto: true })
      .eq("raio_x_id", r.id)
      .or(`analise_ciclo.is.null,analise_ciclo.neq.${r.ciclo}`)
      .gte("ultima_em", inicio);
    return "pronto";
  }
  // FORK MIA (.106): era `temTempo(amb, 45_000)`, que numa chamada de 45 s nunca passava.
  if (!cabe(amb, TETO_DA_CLASSIFICACAO_MS)) return "parou";

  let resposta: Awaited<ReturnType<ChamarOModelo>>;
  try {
    resposta = await comTeto(amb.chamar({ sistema, texto, tetoDeSaida }), TETO_DA_CLASSIFICACAO_MS);
  } catch (erro) {
    // Falha do provedor: conta e tenta de novo na rodada seguinte; na terceira SEGUIDA no mesmo
    // lote, o lote segue sem análise. FORK MIA (.106): a mesma conta das exceções (registrarFalha),
    // que zera quando a análise anda; antes o contador nunca zerava.
    await registrarFalha(amb.admin, r, { etapa: "classificacao", itens: [...rastro.itens] }, erro, amb.agora());
    return "parou";
  }
  const usd = costCents(amb.modelo.modelo, {
    inputTokens: resposta.tokensEntrada,
    outputTokens: resposta.tokensSaida,
    cacheReadTokens: resposta.cacheLido,
    cacheWriteTokens: 0,
  });
  await registrarGasto(amb.admin, r, {
    proposito: "raio_x_analise",
    modelo: amb.modelo.modelo,
    tokensEntrada: resposta.tokensEntrada,
    tokensSaida: resposta.tokensSaida,
    usdCentavos: usd ?? estimativaUsd,
    estimado: usd === null,
    cotacao,
  });
  const lidas = lerRespostaDoModelo(resposta.texto, r.segmento as Segmento);
  for (const { conversa, paraOModelo } of lote) {
    rastro.itens = [conversa.id];
    const analise = lidas.get(paraOModelo.id) ?? null;
    const { error: e } = await amb.admin
      .from("mia_raio_x_conversas")
      .update({ analise, analise_ciclo: r.ciclo })
      .eq("id", conversa.id);
    if (e) throw new Error(`raio-x: análise não gravou (${e.code ?? "sem_codigo"})`);
  }
  return "andou";
}

/** FORK MIA (.107): a nota da Time no relatório do cadastro, que sai revisado sem ninguém revisar. */
export const NOTA_DO_CADASTRO = "automático: cadastro";

/**
 * 3. O relatório, quando não falta nada. Devolve o id do relatório criado.
 *
 * FORK MIA (.107): o raio-X do CADASTRO (origem 'cadastro') sai REVISADO, sem
 * ator e com a nota "automático: cadastro": vai direto para quem pediu, e a
 * Time é avisada (`entrega.ts`). O da Time continua saindo em rascunho. E o
 * GRÁTIS que chega aqui sem nenhuma conversa de cliente não gera relatório
 * (devolve `null`): a grátis não é gasta, e o ciclo fecha o raio-X sem histórico.
 */
export async function gerarRelatorio(admin: SupabaseClient, r: LinhaDoRaioX, agora: Date): Promise<string | null> {
  const { inicio, fim } = periodo(r);
  const { data: conversas, error } = await admin
    .from("mia_raio_x_conversas")
    .select("id, numero_ordem, anuncio, referencia, analise, analise_ciclo, fora_do_teto")
    .eq("raio_x_id", r.id);
  if (error) throw new Error(`raio-x: conversas do relatório (${error.code ?? "sem_codigo"})`);
  const horario = horarioDoRaioX(r);
  const fimMs = Date.parse(fim);
  const linhasDasConversas = (conversas ?? []) as unknown as LinhaDaConversa[];
  let paraORelatorio: ConversaParaORelatorio[];
  // FORK MIA (.102): o número da conta é dado da empresa, e entra na busca do raio-X anterior.
  const numeros = daConta(r) ? await lerNumerosDoRaioX(admin, r.id) : [];
  if (daConta(r)) {
    // FORK MIA (.102): as conversas da própria conta, com quem respondeu, a passagem e o funil.
    const lidas = await lerConversasDaConta(admin, r, linhasDasConversas, { extras: true });
    paraORelatorio = linhasDasConversas.flatMap((c) => {
      const l = lidas.get(c.id);
      if (!l || l.mensagens.length === 0) return [];
      const msgs = l.mensagens;
      const pessoas = msgs.filter((m) => ehPessoa(m.quem)).map((m) => m.em);
      return [
        {
          numeroOrdem: c.numero_ordem,
          anuncio: c.anuncio,
          medida: medirConversa(msgs.map((m) => ({ daLoja: m.daLoja, em: m.em, quem: m.quem ?? null })), horario, fimMs),
          analise: c.analise_ciclo === r.ciclo ? c.analise : null,
          foraDoTeto: c.fora_do_teto,
          mensagens: msgs,
          nomes: l.nomes,
          numero: l.numero,
          passagem: l.passagem ? medirPassagem(l.passagem, pessoas, fimMs, lojaAberta(momentoLocal(l.passagem.em), horario)) : null,
          funil: l.funil,
        },
      ];
    });
  } else {
    const mensagens = await mensagensDoPeriodo(admin, r);
    const porConversa = new Map<string, MensagemDoRelatorio[]>();
    for (const m of mensagens) {
      const lista = porConversa.get(m.conversa_id) ?? [];
      lista.push(paraMensagem(m));
      porConversa.set(m.conversa_id, lista);
    }
    paraORelatorio = linhasDasConversas
      .filter((c) => porConversa.has(c.id))
      .map((c) => {
        const msgs = porConversa.get(c.id)!.sort((a, b) => a.em - b.em);
        const ref = decifrarReferencia(c.referencia);
        return {
          numeroOrdem: c.numero_ordem,
          anuncio: c.anuncio,
          medida: medirConversa(msgs.map((m) => ({ daLoja: m.daLoja, em: m.em })), horario, fimMs),
          analise: c.analise_ciclo === r.ciclo ? c.analise : null,
          foraDoTeto: c.fora_do_teto,
          mensagens: msgs,
          nomes: ref?.nome ? [ref.nome] : [],
        };
      });
  }
  const dados = montarRelatorio({
    empresa: r.empresa,
    segmento: r.segmento as Segmento,
    tipo: r.tipo,
    periodo: { inicio: new Date(inicio), fim: new Date(fim) },
    conversas: paraORelatorio,
    fonte: daConta(r) ? "conversas_da_mia" : "conexao",
    ...(daConta(r) ? { numeros: numeros.map((n) => ({ rotulo: n.rotulo, oficial: n.oficial })) } : {}),
  });
  // FORK MIA (.107): a grátis sem conversa nenhuma não vira relatório nem gasta a grátis.
  if (r.gratis === true && dados.numeros.conversas === 0) return null;
  const criadoEm = agora.toISOString();
  // FORK MIA (.106): a comparação que falhou três rodadas seguidas fica de fora, e o relatório sai.
  const semComparacao = (r.analise as { relatorio_sem_comparacao?: boolean }).relatorio_sem_comparacao === true;
  const anterior = semComparacao ? null : await relatorioAnterior(admin, r, criadoEm, numeros.flatMap((n) => (n.telefone ? [n.telefone] : [])));
  const { data: ultima } = await admin
    .from("mia_raio_x_relatorios")
    .select("sequencia")
    .eq("raio_x_id", r.id)
    .order("sequencia", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sequencia = Number((ultima as { sequencia?: number } | null)?.sequencia ?? 0) + 1;
  const custo = await gastoDoRaioX(admin, r.id, r.ciclo);
  const id = randomUUID();
  const comparacao = anterior ? compararRelatorios({ id, criadoEm, dados, periodo: { inicio, fim } }, anterior) : null;
  const { error: erroDoInsert } = await admin.from("mia_raio_x_relatorios").insert({
    id,
    raio_x_id: r.id,
    sequencia,
    periodo_inicio: inicio,
    periodo_fim: fim,
    competencia: r.competencia,
    criterios_versao: dados.criteriosVersao,
    dados,
    comparacao,
    anterior_id: anterior?.id ?? null,
    parcial: dados.analise.parcial,
    conversas: dados.numeros.conversas,
    custo_usd_centavos: custo.usdCentavos,
    custo_centavos: custo.centavos,
    // FORK MIA (.107): o do cadastro sai revisado, sem quem revisou.
    ...(r.origem === "cadastro" ? { situacao: "revisado", revisado_por: null, revisado_em: criadoEm, notas_da_time: NOTA_DO_CADASTRO } : {}),
  });
  if (erroDoInsert) throw new Error(`raio-x: relatório não gravou (${erroDoInsert.code ?? "sem_codigo"})`);
  const prazos = prazosDoRelatorio(r.tipo, agora);
  const primeiro = !r.ultimo_relatorio_em;
  const { error: erroDoRaioX } = await admin
    .from("mia_raio_x")
    .update({
      situacao: "pronto",
      ultimo_relatorio_em: criadoEm,
      analise: {},
      // O diagnóstico único cai 7 dias depois do PRIMEIRO relatório; desconectado, não há o que derrubar.
      // FORK MIA (.102): o cliente ativo não tem conexão nenhuma para cair.
      desconectar_em:
        !daConta(r) && r.tipo === "unico" && primeiro && !r.desconectado_em ? prazos.desconectarEm!.toISOString() : r.desconectar_em,
      // O mensal apaga mês a mês (o ciclo); o único, 30 dias depois do relatório.
      apagar_conversas_em: r.tipo === "unico" || r.desconectado_em ? (r.apagar_conversas_em ?? prazos.apagarConversasEm.toISOString()) : r.apagar_conversas_em,
    })
    .eq("id", r.id);
  if (erroDoRaioX) throw new Error(`raio-x: situação do relatório (${erroDoRaioX.code ?? "sem_codigo"})`);
  return id;
}

export type DesfechoDaAnalise =
  | { tipo: "andou" }
  | { tipo: "parou" }
  | { tipo: "relatorio"; relatorioId: string }
  // FORK MIA (.107): a grátis fechou sem nenhuma conversa de cliente.
  | { tipo: "sem_historico" };

/** Os passos de UMA rodada: áudio, depois classificação, depois relatório. */
async function passosDaRodada(amb: Ambiente & { rastro: Rastro }, r: LinhaDoRaioX): Promise<DesfechoDaAnalise> {
  const cotacao = await cotacaoDoDia(amb.admin);
  if (daConta(r) && !(r.analise as { audios_preparados?: boolean }).audios_preparados) await prepararAudiosDaConta(amb, r);
  const audio = await transcrever(amb, r, cotacao);
  if (audio !== "pronto") return { tipo: audio };
  for (let i = 0; i < 4; i += 1) {
    const passo = await classificar(amb, r, cotacao);
    if (passo === "pronto") {
      amb.rastro.etapa = "relatorio";
      amb.rastro.itens = [];
      const relatorioId = await gerarRelatorio(amb.admin, r, new Date(amb.agora()));
      if (relatorioId === null) return { tipo: "sem_historico" };
      return { tipo: "relatorio", relatorioId };
    }
    // FORK MIA (.106): o mesmo portão da classificação (era `temTempo(amb, 45_000)`).
    if (passo === "parou" || !cabe(amb, TETO_DA_CLASSIFICACAO_MS)) return { tipo: passo };
  }
  return { tipo: "andou" };
}

/**
 * UMA rodada da análise. FORK MIA (.106): a exceção não sai sem deixar rastro.
 * Antes de subir para o ciclo (que conta a falha e solta a trava), ela vira o
 * `ultimo_erro` em `mia_raio_x.analise` e soma em `falhas_seguidas` quando é
 * no MESMO item da rodada anterior; na terceira, o item sai do caminho
 * (`registrarFalha`). A rodada que anda zera a conta.
 */
export async function rodadaDeAnalise(amb: Ambiente, r: LinhaDoRaioX): Promise<DesfechoDaAnalise> {
  const rastro: Rastro = { etapa: "preparo", itens: [] };
  let desfecho: DesfechoDaAnalise;
  try {
    desfecho = await passosDaRodada({ ...amb, rastro }, r);
  } catch (erro) {
    await registrarFalha(amb.admin, r, rastro, erro, amb.agora()).catch(() => undefined);
    throw erro;
  }
  if (desfecho.tipo === "andou" && (Number(r.analise.falhas_seguidas) || 0) > 0) await gravarNaAnalise(amb.admin, r, { falhas_seguidas: 0 });
  return desfecho;
}

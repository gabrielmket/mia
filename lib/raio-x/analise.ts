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
 */
import { randomUUID } from "node:crypto";

import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { MARGEM_PARA_CHAMADA_MS, TETO_DO_DOWNLOAD_MS } from "@/lib/channels/historico/prazo";
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
import { cabeAChamada, comTeto, TETO_DA_CLASSIFICACAO_MS } from "./relogio-da-analise";
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

export function transcritorDaPlataforma(ambiente: NodeJS.ProcessEnv = process.env): { provider: TranscriptionProvider; modelo: string } | null {
  const doServico = ambiente.TRANSCRIPTION_API_KEY?.trim();
  const base = ambiente.TRANSCRIPTION_BASE_URL?.trim() || undefined;
  const modeloDoAmbiente = ambiente.TRANSCRIPTION_MODEL?.trim() || undefined;
  if (doServico) {
    const modelo = modeloDoAmbiente ?? "whisper-1";
    return { provider: apiTranscriptionProvider({ apiKey: doServico, baseUrl: base, model: modelo, languages: ["pt"] }), modelo };
  }
  const openai = ambiente.OPENAI_API_KEY?.trim();
  if (!openai) return null;
  const modelo = modeloDeTranscricaoEmVigor({ model: modeloDoAmbiente, apiKey: undefined, baseUrl: base });
  return { provider: apiTranscriptionProvider({ apiKey: openai, model: modelo, languages: ["pt"] }), modelo };
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
      comentario: p.data.comentario.slice(0, 160),
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
  const analise = { ...r.analise, audios_preparados: true };
  const { error } = await amb.admin.from("mia_raio_x").update({ analise }).eq("id", r.id);
  if (error) throw new Error(`raio-x: andamento da análise (${error.code ?? "sem_codigo"})`);
  r.analise = analise;
}

function temTempo(amb: Ambiente, folga = MARGEM_PARA_CHAMADA_MS): boolean {
  return amb.prazo - amb.agora() >= folga;
}

/**
 * FORK MIA (.106) · cabe começar uma chamada de até `tetoMs`? A .101 pedia
 * 45 s pela frente para chamar o modelo, numa chamada de cron de 45 s: nunca
 * cabia (relogio-da-analise.ts conta o defeito e a regra).
 */
function cabe(amb: Ambiente, tetoMs: number): boolean {
  return cabeAChamada(amb.prazo, amb.agora(), tetoMs);
}

/** 1. Os áudios pendentes do período, até o prazo da chamada. */
async function transcrever(amb: Ambiente, r: LinhaDoRaioX, cotacao: number): Promise<"pronto" | "andou" | "parou"> {
  const { inicio, fim } = periodo(r);
  const { data, error } = await amb.admin
    .from("mia_raio_x_mensagens")
    .select("id, conversa_id, segundos, midia")
    .eq("raio_x_id", r.id)
    .eq("transcricao", "pendente")
    .gte("enviada_em", inicio)
    .lte("enviada_em", fim)
    .order("id", { ascending: true })
    .limit(8);
  if (error) throw new Error(`raio-x: áudios pendentes (${error.code ?? "sem_codigo"})`);
  const pendentes = (data ?? []) as Array<{ id: number; conversa_id: string; segundos: number | null; midia: string | null }>;
  if (pendentes.length === 0) return "pronto";

  const marcarTodos = async (transcricao: string) => {
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
  if (!amb.transcritor) {
    await marcarTodos("sem_servico");
    return "pronto";
  }
  // FORK MIA (.102): o cliente ativo não tem leitor; o áudio vem do storage da própria conta.
  if (!daConta(r) && (!amb.leitor || !r.sessao || r.desconectado_em)) {
    await marcarTodos("falhou");
    return "pronto";
  }
  const baixarDaConta =
    amb.baixarDaConta ?? ((mensagemId: string) => (r.organization_id ? baixarAudioDaConta(amb.admin, r.organization_id, mensagemId) : Promise.resolve(null)));
  const referencias = new Map<string, string | null>();
  let andou = false;
  for (const p of pendentes) {
    if (!temTempo(amb, TETO_DO_DOWNLOAD_MS + 15_000)) return andou ? "andou" : "parou";
    const gasto = await gastoDoRaioX(amb.admin, r.id, r.ciclo);
    const estimativa = centavosEmReais(custoDoAudioUsdCentavos(Math.max(60, p.segundos ?? 60)), cotacao);
    if (!cabeNoTeto(gasto.centavos, estimativa, r.teto_centavos).pode) {
      await marcarTodos("fora_do_teto");
      return "pronto";
    }
    if (!daConta(r) && !referencias.has(p.conversa_id)) {
      const { data: c } = await amb.admin.from("mia_raio_x_conversas").select("referencia").eq("id", p.conversa_id).maybeSingle();
      referencias.set(p.conversa_id, decifrarReferencia((c as { referencia?: string | null } | null)?.referencia)?.chatId ?? null);
    }
    const chatId = daConta(r) ? null : referencias.get(p.conversa_id);
    const mensagemId = decifrarTexto(p.midia);
    let resultado: { transcricao: string; texto: string | null } = { transcricao: "falhou", texto: null };
    if (mensagemId && (chatId || daConta(r))) {
      try {
        const audio = daConta(r)
          ? await baixarDaConta(mensagemId)
          : await amb.leitor!.baixarAudio(r.sessao!, chatId!, mensagemId, TETO_DO_DOWNLOAD_MS);
        if (audio) {
          const segundos = segundosDoAudio(p.segundos, audio.bytes.byteLength);
          const medido = amb.transcritor.provider.transcribeMedindo
            ? await amb.transcritor.provider.transcribeMedindo(audio.bytes, audio.mime)
            : { texto: await amb.transcritor.provider.transcribe(audio.bytes, audio.mime), custoCents: null };
          const usd = typeof medido.custoCents === "number" ? medido.custoCents : custoDoAudioUsdCentavos(segundos);
          await registrarGasto(amb.admin, r, {
            proposito: "raio_x_transcricao",
            modelo: amb.transcritor.modelo,
            segundos,
            usdCentavos: usd,
            estimado: typeof medido.custoCents !== "number",
            cotacao,
          });
          const texto = medido.texto.trim();
          resultado = { transcricao: texto ? "feita" : "falhou", texto: texto ? texto.slice(0, 4000) : null };
        }
      } catch {
        resultado = { transcricao: "falhou", texto: null };
      }
    }
    const { error: e } = await amb.admin
      .from("mia_raio_x_mensagens")
      .update({ transcricao: resultado.transcricao, texto: resultado.texto, midia: null })
      .eq("id", p.id);
    if (e) throw new Error(`raio-x: transcrição não gravou (${e.code ?? "sem_codigo"})`);
    andou = true;
  }
  return "andou";
}

/** 2. A classificação das conversas, em lote. */
async function classificar(amb: Ambiente, r: LinhaDoRaioX, cotacao: number): Promise<"pronto" | "andou" | "parou"> {
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
  } catch {
    // Falha do provedor: conta e tenta de novo na rodada seguinte; na terceira, segue sem.
    const falhas = Number((r.analise as { falhas?: number }).falhas ?? 0) + 1;
    await amb.admin.from("mia_raio_x").update({ analise: { ...r.analise, falhas } }).eq("id", r.id);
    if (falhas >= 3) await marcar(lote.map((x) => x.conversa.id), { analise: null, analise_ciclo: r.ciclo });
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
    const analise = lidas.get(paraOModelo.id) ?? null;
    const { error: e } = await amb.admin
      .from("mia_raio_x_conversas")
      .update({ analise, analise_ciclo: r.ciclo })
      .eq("id", conversa.id);
    if (e) throw new Error(`raio-x: análise não gravou (${e.code ?? "sem_codigo"})`);
  }
  return "andou";
}

/** 3. O relatório, quando não falta nada. Devolve o id do relatório criado. */
export async function gerarRelatorio(admin: SupabaseClient, r: LinhaDoRaioX, agora: Date): Promise<string> {
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
  const criadoEm = agora.toISOString();
  const anterior = await relatorioAnterior(admin, r, criadoEm, numeros.flatMap((n) => (n.telefone ? [n.telefone] : [])));
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

export type DesfechoDaAnalise = { tipo: "andou" } | { tipo: "parou" } | { tipo: "relatorio"; relatorioId: string };

/** UMA rodada da análise: áudio, depois classificação, depois relatório. */
export async function rodadaDeAnalise(amb: Ambiente, r: LinhaDoRaioX): Promise<DesfechoDaAnalise> {
  const cotacao = await cotacaoDoDia(amb.admin);
  if (daConta(r) && !(r.analise as { audios_preparados?: boolean }).audios_preparados) await prepararAudiosDaConta(amb, r);
  const audio = await transcrever(amb, r, cotacao);
  if (audio !== "pronto") return { tipo: audio };
  for (let i = 0; i < 4; i += 1) {
    const passo = await classificar(amb, r, cotacao);
    if (passo === "pronto") {
      const relatorioId = await gerarRelatorio(amb.admin, r, new Date(amb.agora()));
      return { tipo: "relatorio", relatorioId };
    }
    // FORK MIA (.106): o mesmo portão da classificação (era `temTempo(amb, 45_000)`).
    if (passo === "parou" || !cabe(amb, TETO_DA_CLASSIFICACAO_MS)) return { tipo: passo };
  }
  return { tipo: "andou" };
}

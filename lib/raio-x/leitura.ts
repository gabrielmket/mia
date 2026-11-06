/**
 * FORK MIA (.101) · A LEITURA DAS CONVERSAS, EM RODADAS CURTAS QUE RETOMAM.
 *
 * O desenho é o da importação do histórico do upstream (#999,
 * `lib/channels/historico/rodada.ts`): o agendador chama a cada minuto, cada
 * rodada só começa uma chamada ao leitor com tempo para ela antes do prazo
 * (`MARGEM_PARA_CHAMADA_MS`, reaproveitado), o cursor fica firme no banco
 * (`mia_raio_x.leitura`), o offset das mensagens avança pelo que o leitor
 * DEVOLVEU (`lidas`), e refazer um pedaço é seguro (a marca da mensagem é
 * única). A diferença: o raio-X não grava em `contacts`, `conversations` nem
 * `messages` de empresa nenhuma, só nas tabelas dele.
 *
 * ─── As quatro fases ────────────────────────────────────────────────────────
 *
 *  sincronizando  o histórico chega EM PARTES depois do pareamento (o fullSync
 *                 do aparelho). Cada rodada conta as conversas do período; a
 *                 leitura só começa quando a conta fica PARADA por 5 minutos
 *                 (e 5 minutos depois de conectar), ou depois de 40 minutos,
 *                 o que vier primeiro. Parada em ZERO não conta (.105): espera
 *                 os 40 minutos.
 *  lendo          a passada inteira, conversa a conversa, do mais antigo ao
 *                 mais novo dentro do período.
 *  conferindo     uma segunda volta na lista: lê de novo só a conversa que
 *                 ganhou mensagem depois de lida, e a que apareceu no meio.
 *  concluida      fim; o raio-X passa para "analisando".
 *
 * Nada aqui guarda telefone cru: a conversa é a marca (HMAC) e a referência
 * cifrada; o texto entra sem telefone, e-mail ou documento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MARGEM_PARA_CHAMADA_MS } from "@/lib/channels/historico/prazo";
import type { ConversaListada, LeitorDoRaioX, MensagemLida } from "@/lib/channels/raio-x/leitor";
import { ehConversaIndividual } from "@/lib/channels/raio-x/leitor";

import { tirarIdentificadores } from "./anonimizar";
import type { LinhaDoRaioX } from "./banco";
import { cifrarReferencia, cifrarTexto } from "./cifra";
import { marcaDaConversa, marcaDaMensagem } from "./tokens";

export type FaseDaLeitura = "sincronizando" | "lendo" | "conferindo" | "concluida";

export interface EstadoDaLeitura {
  fase: FaseDaLeitura;
  /** Epoch em ms: o começo do período. */
  desde: number;
  /** Epoch em ms: o fim do período (o mensal); `null` = até agora. */
  ate: number | null;
  /** A posição da conversa na lista do leitor (o cursor). */
  indice: number;
  /** O offset das mensagens dentro dela. */
  offset: number;
  total: number;
  conversas_lidas: number;
  mensagens_lidas: number;
  sinc?: { conversas: number; estavel_desde: string; contagens: number };
  erro?: string | null;
}

export const ESTABILIZA_EM_MS = 5 * 60_000;
export const ESPERA_MAXIMA_DA_SINCRONIA_MS = 40 * 60_000;
const PAGINA_DE_CONVERSAS = 25;
const PAGINA_PARA_CONTAR = 200;
const PAGINAS_PARA_CONTAR = 50;
const PAGINA_DE_MENSAGENS = 100;
/** Chamadas ao leitor por rodada (página de conversas ou de mensagens). */
export const CHAMADAS_POR_RODADA = 40;

export function estadoInicial(desde: Date, ate: Date | null, fase: FaseDaLeitura): EstadoDaLeitura {
  return {
    fase,
    desde: desde.getTime(),
    ate: ate ? ate.getTime() : null,
    indice: 0,
    offset: 0,
    total: 0,
    conversas_lidas: 0,
    mensagens_lidas: 0,
  };
}

export function lerEstado(bruto: unknown): EstadoDaLeitura | null {
  if (!bruto || typeof bruto !== "object") return null;
  const e = bruto as Partial<EstadoDaLeitura>;
  if (!e.fase || typeof e.desde !== "number") return null;
  return {
    fase: e.fase,
    desde: e.desde,
    ate: typeof e.ate === "number" ? e.ate : null,
    indice: Number(e.indice) || 0,
    offset: Number(e.offset) || 0,
    total: Number(e.total) || 0,
    conversas_lidas: Number(e.conversas_lidas) || 0,
    mensagens_lidas: Number(e.mensagens_lidas) || 0,
    ...(e.sinc ? { sinc: e.sinc } : {}),
    erro: e.erro ?? null,
  };
}

/** A conversa entra no período? (`ultimaEm` nulo: não dá para saber, então lê.) */
function noPeriodo(c: ConversaListada, e: EstadoDaLeitura): boolean {
  return c.ultimaEm === null || c.ultimaEm >= e.desde;
}

/** A sincronia já parou de crescer? Puro, para o teste. */
export function sincroniaEstavel(
  sinc: { conversas: number; estavel_desde: string },
  conectadoEm: number,
  agora: number,
): boolean {
  if (agora - conectadoEm >= ESPERA_MAXIMA_DA_SINCRONIA_MS) return true;
  // FORK MIA (.105): contagem PARADA EM ZERO não é sincronia pronta, é o
  // histórico que ainda não chegou. O 1º raio-X real (05/11/2026) leu 0
  // conversas 7 minutos depois de conectar e fechou um relatório vazio. Em
  // zero, a leitura espera a espera máxima.
  if (sinc.conversas === 0) return false;
  return agora - conectadoEm >= ESTABILIZA_EM_MS && agora - Date.parse(sinc.estavel_desde) >= ESTABILIZA_EM_MS;
}

export interface ResultadoDaRodada {
  estado: EstadoDaLeitura;
  concluiu: boolean;
  chamadas: number;
}

interface Contexto {
  admin: SupabaseClient;
  leitor: LeitorDoRaioX;
  raioX: Pick<LinhaDoRaioX, "id" | "sessao" | "conectado_em">;
  prazo: number;
  agora: () => number;
}

function temTempo(ctx: Contexto): boolean {
  return ctx.prazo - ctx.agora() >= MARGEM_PARA_CHAMADA_MS;
}

/** Conta as conversas do período (a fase de sincronia). */
async function contarConversas(ctx: Contexto, e: EstadoDaLeitura): Promise<{ total: number; chamadas: number } | null> {
  let total = 0;
  let chamadas = 0;
  for (let pagina = 0; pagina < PAGINAS_PARA_CONTAR; pagina += 1) {
    if (!temTempo(ctx)) return null;
    const { conversas, lidas } = await ctx.leitor.paginaDeConversas(ctx.raioX.sessao!, {
      limit: PAGINA_PARA_CONTAR,
      offset: pagina * PAGINA_PARA_CONTAR,
    });
    chamadas += 1;
    total += conversas.filter((c) => ehConversaIndividual(c.chatId) && noPeriodo(c, e)).length;
    if (lidas < PAGINA_PARA_CONTAR) break;
  }
  return { total, chamadas };
}

/**
 * Grava uma página de mensagens de uma conversa. Devolve quantas linhas foram
 * mandadas ao banco (a marca única recusa a repetida em silêncio).
 */
async function gravarPagina(
  ctx: Contexto,
  chat: ConversaListada,
  mensagens: MensagemLida[],
  e: EstadoDaLeitura,
  primeiraPagina: boolean,
  cache: Map<string, string>,
): Promise<number> {
  const doPeriodo = mensagens.filter((m) => m.em >= e.desde && (e.ate === null || m.em < e.ate));
  if (doPeriodo.length === 0) return 0;
  const marca = marcaDaConversa(ctx.raioX.id, chat.chatId);
  let conversaId = cache.get(marca);
  if (!conversaId) {
    const nome = doPeriodo.find((m) => !m.daLoja && m.nome)?.nome ?? null;
    const ultima = chat.ultimaEm ?? doPeriodo[doPeriodo.length - 1]!.em;
    const { data, error } = await ctx.admin.rpc("fn_mia_raio_x_conversa", {
      p_raio_x: ctx.raioX.id,
      p_marca: marca,
      p_referencia: cifrarReferencia({ chatId: chat.chatId, nome }),
      p_ultima_em: new Date(ultima).toISOString(),
    });
    if (error) throw new Error(`raio-x: conversa não gravou (${error.code ?? "sem_codigo"})`);
    const linha = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
    if (!linha?.id) throw new Error("raio-x: conversa sem id");
    conversaId = linha.id;
    cache.set(marca, conversaId);
  }
  if (primeiraPagina) {
    const primeiraDoCliente = doPeriodo.find((m) => !m.daLoja);
    if (primeiraDoCliente?.anuncio) {
      await ctx.admin.from("mia_raio_x_conversas").update({ anuncio: true }).eq("id", conversaId);
    }
  }
  const linhas = doPeriodo.map((m) => ({
    raio_x_id: ctx.raioX.id,
    conversa_id: conversaId,
    marca: marcaDaMensagem(ctx.raioX.id, m.id),
    da_loja: m.daLoja,
    enviada_em: new Date(m.em).toISOString(),
    tipo: m.tipo,
    texto: m.texto ? tirarIdentificadores(m.texto).slice(0, 4000) : null,
    segundos: m.segundos === null ? null : Math.round(m.segundos),
    midia: m.tipo === "audio" ? cifrarTexto(m.id) : null,
    transcricao: m.tipo === "audio" ? "pendente" : "nao_se_aplica",
    anuncio: m.anuncio,
  }));
  const { error } = await ctx.admin
    .from("mia_raio_x_mensagens")
    .upsert(linhas, { onConflict: "raio_x_id,marca", ignoreDuplicates: true });
  if (error) throw new Error(`raio-x: mensagens não gravaram (${error.code ?? "sem_codigo"})`);
  return linhas.length;
}

/** As conversas já lidas, por marca (para a conferência saber o que mudou). */
async function lidasPorMarca(ctx: Contexto, marcas: string[]): Promise<Map<string, number>> {
  if (marcas.length === 0) return new Map();
  const { data, error } = await ctx.admin
    .from("mia_raio_x_conversas")
    .select("chat_marca, ultima_em")
    .eq("raio_x_id", ctx.raioX.id)
    .in("chat_marca", marcas);
  if (error) throw new Error(`raio-x: conversas lidas (${error.code ?? "sem_codigo"})`);
  return new Map(
    ((data ?? []) as Array<{ chat_marca: string; ultima_em: string | null }>).map((c) => [
      c.chat_marca,
      c.ultima_em ? Date.parse(c.ultima_em) : 0,
    ]),
  );
}

/**
 * UMA rodada. Não lança por falha do leitor no meio: devolve o estado com o
 * cursor firme até onde foi, e o `erro` para a tela; a próxima rodada segue.
 */
export async function rodadaDeLeitura(ctx: Contexto, estadoBruto: EstadoDaLeitura): Promise<ResultadoDaRodada> {
  const e: EstadoDaLeitura = { ...estadoBruto, erro: null };
  let chamadas = 0;
  if (!ctx.raioX.sessao) return { estado: { ...e, erro: "sem_sessao" }, concluiu: false, chamadas };

  try {
    // ── sincronizando ─────────────────────────────────────────────────────
    if (e.fase === "sincronizando") {
      const conta = await contarConversas(ctx, e);
      if (!conta) return { estado: e, concluiu: false, chamadas };
      chamadas += conta.chamadas;
      const agoraIso = new Date(ctx.agora()).toISOString();
      const mudou = !e.sinc || e.sinc.conversas !== conta.total;
      e.sinc = {
        conversas: conta.total,
        estavel_desde: mudou ? agoraIso : e.sinc!.estavel_desde,
        contagens: (e.sinc?.contagens ?? 0) + 1,
      };
      e.total = conta.total;
      const conectadoEm = ctx.raioX.conectado_em ? Date.parse(ctx.raioX.conectado_em) : ctx.agora();
      if (!sincroniaEstavel(e.sinc, conectadoEm, ctx.agora())) return { estado: e, concluiu: false, chamadas };
      e.fase = "lendo";
      e.indice = 0;
      e.offset = 0;
    }

    // ── lendo / conferindo ────────────────────────────────────────────────
    const cache = new Map<string, string>();
    while (e.fase === "lendo" || e.fase === "conferindo") {
      if (chamadas >= CHAMADAS_POR_RODADA || !temTempo(ctx)) return { estado: e, concluiu: false, chamadas };
      const { conversas, lidas } = await ctx.leitor.paginaDeConversas(ctx.raioX.sessao, {
        limit: PAGINA_DE_CONVERSAS,
        offset: e.indice,
      });
      chamadas += 1;
      if (lidas === 0) {
        if (e.fase === "lendo") {
          e.fase = "conferindo";
          e.indice = 0;
          e.offset = 0;
          continue;
        }
        e.fase = "concluida";
        break;
      }
      const ja = e.fase === "conferindo" ? await lidasPorMarca(ctx, conversas.map((c) => marcaDaConversa(ctx.raioX.id, c.chatId))) : null;
      for (const chat of conversas) {
        if (chat.posicao < e.indice) continue;
        let precisa = noPeriodo(chat, e);
        if (precisa && ja) {
          const lidaEm = ja.get(marcaDaConversa(ctx.raioX.id, chat.chatId));
          precisa = lidaEm === undefined || (chat.ultimaEm !== null && chat.ultimaEm > lidaEm + 1000);
        }
        if (!precisa) {
          e.indice = chat.posicao + 1;
          e.offset = 0;
          continue;
        }
        // Lê a conversa a partir do offset do cursor, página a página.
        for (;;) {
          if (chamadas >= CHAMADAS_POR_RODADA || !temTempo(ctx)) return { estado: e, concluiu: false, chamadas };
          const pagina = await ctx.leitor.paginaDeMensagens(ctx.raioX.sessao, chat.chatId, {
            limit: PAGINA_DE_MENSAGENS,
            offset: e.offset,
            desde: e.desde,
          });
          chamadas += 1;
          e.mensagens_lidas += await gravarPagina(ctx, chat, pagina.mensagens, e, e.offset === 0, cache);
          e.offset += pagina.lidas;
          if (pagina.lidas < PAGINA_DE_MENSAGENS) break;
        }
        if (e.fase === "lendo") e.conversas_lidas += 1;
        e.indice = chat.posicao + 1;
        e.offset = 0;
      }
      // Página só de grupo, status ou lista: anda pelo que o leitor devolveu.
      if (conversas.length === 0) e.indice += lidas;
    }
    return { estado: e, concluiu: e.fase === "concluida", chamadas };
  } catch (erro) {
    const codigo = erro instanceof Error && "codigo" in erro ? String((erro as { codigo: unknown }).codigo) : "falha_na_leitura";
    return { estado: { ...e, erro: codigo }, concluiu: false, chamadas };
  }
}

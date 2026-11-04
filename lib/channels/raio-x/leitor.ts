/**
 * FORK MIA (.101) · O LEITOR DO RAIO-X — o único caminho até o contêiner WAHA
 * PRÓPRIO do raio-X (serviço `raio-x-leitor` no `docker-compose.easypanel.yml`).
 *
 * ─── Só leitura, POR CONSTRUÇÃO ─────────────────────────────────────────────
 *
 * A promessa feita ao dono no termo é "nenhuma mensagem é enviada do seu
 * número". Ela não depende de disciplina de quem chama:
 *
 *  1. este módulo NÃO usa o `WahaClient` do upstream (que tem `sendMessage`,
 *     `sendSeen`, `setPresence`...). Ele tem um cliente próprio, mínimo, que
 *     expõe só ler conversas e mensagens, baixar um áudio, parear (código ou
 *     QR), ler o estado e desconectar;
 *  2. toda chamada passa por `rotaPermitida`, uma lista FECHADA de método +
 *     caminho. Envio, "visto", presença, reação, edição, apagar mensagem e o
 *     `PUT` da sessão (que poderia religar um webhook ou o "online") não estão
 *     nela: um pedido fora da lista é recusado antes de sair do servidor;
 *  3. o contêiner do raio-X não conhece o app (sem `WHATSAPP_HOOK_URL`), e
 *     nenhum caminho de envio do atendimento conhece este contêiner: o
 *     endereço dele (`RAIO_X_LEITOR_URL`) só é lido aqui;
 *  4. `tests/unit/raio-x-leitor-nao-envia.test.ts` prova as três coisas.
 *
 * ─── A sessão nasce assim (e é conferida depois de criada) ─────────────────
 *
 *   noweb.store { enabled: true, fullSync: true }  o histórico anterior à
 *       vinculação; o fullSync só acontece NA vinculação (#999), por isso vai
 *       na CRIAÇÃO e nunca depois
 *   noweb.markOnline false  com a sessão "online" o celular da loja deixa de
 *       receber notificação (doc do NOWEB, "Session Config", e o FAQ de
 *       Presença: "send markOnline: false when you create a new session")
 *   ignore grupos, status, listas e canais  (o mesmo filtro do upstream)
 *   client.deviceName "Raio-X Time Company"  como aparece em Aparelhos conectados
 *   webhooks []  nenhum aviso sai do contêiner
 *
 * Se o GET depois da criação não mostrar `store.enabled` e `markOnline: false`,
 * a sessão é apagada e o pareamento recusado: melhor não conectar do que
 * conectar um número sem histórico ou que cala o celular do dono.
 */
import { ACERVO_DO_HISTORICO, CONVERSAS_IGNORADAS } from "@/lib/waha/client";
import { extrairAtribuicaoWaha } from "@/lib/waha/atribuicao-de-anuncio";
import { wahaPayloadSchema, type WahaPayload } from "@/lib/waha/envelope";
import { bodyOf, ehReacao, notifyNameOf, resolveMessageType } from "@/lib/waha/ingest";
import { pairingPhoneSchema } from "@/lib/channels/pairing-code";

/** Teto de relógio de uma chamada comum (o do cliente do upstream). */
export const TETO_DA_CHAMADA_MS = 15_000;
export const NOME_DO_APARELHO = "Raio-X Time Company";

// ─── A lista fechada ────────────────────────────────────────────────────────

const SEGMENTO = "[^/]+";
const ROTAS: ReadonlyArray<{ metodo: "GET" | "POST" | "DELETE"; caminho: RegExp; para: string }> = [
  { metodo: "GET", caminho: new RegExp(`^/api/sessions/${SEGMENTO}$`), para: "ler o estado da sessão" },
  { metodo: "POST", caminho: /^\/api\/sessions$/, para: "criar a sessão do raio-X" },
  { metodo: "POST", caminho: new RegExp(`^/api/sessions/${SEGMENTO}/start$`), para: "iniciar a sessão" },
  { metodo: "POST", caminho: new RegExp(`^/api/sessions/${SEGMENTO}/logout$`), para: "desconectar o aparelho" },
  { metodo: "DELETE", caminho: new RegExp(`^/api/sessions/${SEGMENTO}$`), para: "apagar a sessão e o acervo" },
  { metodo: "GET", caminho: new RegExp(`^/api/${SEGMENTO}/auth/qr$`), para: "o QR do pareamento" },
  { metodo: "POST", caminho: new RegExp(`^/api/${SEGMENTO}/auth/request-code$`), para: "o código do pareamento" },
  { metodo: "GET", caminho: new RegExp(`^/api/${SEGMENTO}/chats$`), para: "listar as conversas" },
  { metodo: "GET", caminho: new RegExp(`^/api/${SEGMENTO}/chats/${SEGMENTO}/messages$`), para: "ler as mensagens" },
  { metodo: "GET", caminho: new RegExp(`^/api/${SEGMENTO}/chats/${SEGMENTO}/messages/${SEGMENTO}$`), para: "o endereço de um áudio" },
  { metodo: "GET", caminho: /^\/api\/files\/[^?#]+$/, para: "baixar o áudio" },
];

/** A régua única: método + caminho (sem a query) estão na lista? */
export function rotaPermitida(metodo: string, caminho: string): boolean {
  const so = caminho.split("?")[0] ?? "";
  return ROTAS.some((r) => r.metodo === metodo.toUpperCase() && r.caminho.test(so));
}

export class LeitorRecusou extends Error {
  constructor(public readonly codigo: string) {
    super(codigo);
    this.name = "LeitorRecusou";
  }
}

// ─── O que o leitor devolve (neutro, sem o vocabulário do transporte) ──────

export type EstadoDoAparelho = "ausente" | "parado" | "iniciando" | "esperando_pareamento" | "conectado" | "falhou";

export interface EstadoDaSessao {
  estado: EstadoDoAparelho;
  /** O número conectado (dígitos), quando o aparelho está pareado. */
  numero: string | null;
}

export type TipoDaMensagemLida = "texto" | "audio" | "imagem" | "video" | "documento" | "figurinha" | "outro";

export interface MensagemLida {
  /** O id inteiro no aparelho. Só serve para a marca (HMAC) e para pedir o áudio. */
  id: string;
  daLoja: boolean;
  /** Epoch em milissegundos. */
  em: number;
  tipo: TipoDaMensagemLida;
  texto: string | null;
  segundos: number | null;
  /** O clique no anúncio "Clique para o WhatsApp", quando a mensagem o traz. */
  anuncio: { titulo: string | null; origem: "instagram" | "facebook" | null } | null;
  /** O nome de perfil de quem escreveu (só na mensagem do cliente). */
  nome: string | null;
}

export interface ConversaListada {
  chatId: string;
  ultimaEm: number | null;
  posicao: number;
}

function tipoNeutro(bruto: string): TipoDaMensagemLida {
  switch (bruto) {
    case "text":
      return "texto";
    case "audio":
      return "audio";
    case "image":
      return "imagem";
    case "video":
      return "video";
    case "document":
      return "documento";
    case "sticker":
      return "figurinha";
    default:
      return "outro";
  }
}

function segundosDoAudio(p: WahaPayload): number | null {
  const msg = p._data?.message as Record<string, unknown> | null | undefined;
  const audio = msg && typeof msg === "object" ? (msg.audioMessage as Record<string, unknown> | undefined) : undefined;
  const s = audio?.seconds;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : null;
}

function emMs(timestamp: unknown): number | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp >= 1e11 ? timestamp : timestamp * 1000;
}

/** Do payload do acervo à mensagem neutra. `null` = não entra (reação, sem id, sem hora). */
export function mensagemDoAcervo(p: WahaPayload): MensagemLida | null {
  if (!p.id || ehReacao(p)) return null;
  const em = emMs(p.timestamp);
  if (em === null) return null;
  const daLoja = p.fromMe === true;
  const tipo = tipoNeutro(resolveMessageType(p));
  const corpo = bodyOf(p);
  const ad = daLoja ? null : extrairAtribuicaoWaha(p._data?.message);
  const url = ad?.sourceUrl ?? "";
  return {
    id: p.id,
    daLoja,
    em,
    tipo,
    // O cartão de contato (vcard) não é conversa: fica sem texto.
    texto: corpo && !corpo.startsWith("BEGIN:VCARD") ? corpo : null,
    segundos: tipo === "audio" ? segundosDoAudio(p) : null,
    anuncio: ad
      ? { titulo: ad.titulo ?? null, origem: /instagram\./i.test(url) ? "instagram" : /facebook\.|fb\./i.test(url) ? "facebook" : null }
      : null,
    nome: daLoja ? null : notifyNameOf(p),
  };
}

/** Conversa 1:1? Grupo, status, lista de transmissão e canal ficam de fora. */
export function ehConversaIndividual(chatId: string): boolean {
  return !(
    chatId.endsWith("@g.us") ||
    chatId.endsWith("@broadcast") ||
    chatId.endsWith("@newsletter") ||
    chatId === "status@broadcast"
  );
}

function estadoNeutro(status: unknown): EstadoDoAparelho {
  switch (status) {
    case "STOPPED":
      return "parado";
    case "STARTING":
      return "iniciando";
    case "SCAN_QR_CODE":
      return "esperando_pareamento";
    case "WORKING":
      return "conectado";
    case "FAILED":
      return "falhou";
    default:
      return "parado";
  }
}

// ─── O cliente ──────────────────────────────────────────────────────────────

export interface LeitorDoRaioX {
  estado(sessao: string): Promise<EstadoDaSessao>;
  /** Cria (com a configuração acima, conferida) se não existir, e inicia. */
  preparar(sessao: string): Promise<EstadoDaSessao>;
  /** O código de 8 letras para "Conectar com número de telefone" ("ABCD-EFGH"). */
  pedirCodigo(sessao: string, telefone: string): Promise<string>;
  /** O QR, como imagem PNG. `null` quando o aparelho não está esperando pareamento. */
  qr(sessao: string): Promise<Buffer | null>;
  paginaDeConversas(sessao: string, opts: { limit: number; offset: number }): Promise<{ conversas: ConversaListada[]; lidas: number }>;
  paginaDeMensagens(
    sessao: string,
    chatId: string,
    opts: { limit: number; offset: number; desde: number },
  ): Promise<{ mensagens: MensagemLida[]; lidas: number }>;
  /** Baixa UM áudio. `null` quando o WhatsApp não guarda mais o arquivo. */
  baixarAudio(sessao: string, chatId: string, mensagemId: string, tetoMs: number): Promise<{ bytes: Buffer; mime: string } | null>;
  /** Desconecta o aparelho e apaga a sessão (com o acervo que ela guardou). */
  desconectar(sessao: string): Promise<void>;
}

/** O teto do áudio baixado (o mesmo de toda mídia do produto). */
const TETO_DO_AUDIO_BYTES = 25 * 1024 * 1024;

export function criarLeitor(baseUrl: string, chave: string, fetchImpl: typeof fetch = fetch): LeitorDoRaioX {
  const base = baseUrl.replace(/\/+$/, "");

  async function chamar(
    metodo: "GET" | "POST" | "DELETE",
    caminho: string,
    corpo?: unknown,
    tetoMs: number = TETO_DA_CHAMADA_MS,
  ): Promise<Response> {
    if (!rotaPermitida(metodo, caminho)) throw new LeitorRecusou("rota_nao_permitida");
    try {
      return await fetchImpl(`${base}${caminho}`, {
        method: metodo,
        cache: "no-store",
        signal: AbortSignal.timeout(tetoMs),
        headers: { "X-Api-Key": chave, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
    } catch (e) {
      const nome = e instanceof Error ? e.name : "";
      // O corpo nunca vai para a mensagem de erro: ele fala de conversa de cliente.
      throw new LeitorRecusou(nome === "TimeoutError" || nome === "AbortError" ? "leitor_sem_resposta" : "leitor_fora_do_ar");
    }
  }

  const s = (nome: string) => encodeURIComponent(nome);

  async function lerSessao(sessao: string): Promise<Record<string, unknown> | null> {
    const res = await chamar("GET", `/api/sessions/${s(sessao)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new LeitorRecusou(`leitor_${res.status}`);
    const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!corpo || corpo.name !== sessao) throw new LeitorRecusou("leitor_resposta_invalida");
    return corpo;
  }

  function paraEstado(corpo: Record<string, unknown> | null): EstadoDaSessao {
    if (!corpo) return { estado: "ausente", numero: null };
    const me = corpo.me as Record<string, unknown> | null | undefined;
    const id = typeof me?.id === "string" ? me.id : null;
    const numero = id ? (id.split("@")[0]?.split(":")[0] ?? null) : null;
    return { estado: estadoNeutro(corpo.status), numero: numero && /^\d{8,15}$/.test(numero) ? numero : null };
  }

  /** A sessão tem o que o raio-X exige? (acervo ligado e "online" desligado) */
  function configConferida(corpo: Record<string, unknown>): boolean {
    const config = corpo.config as Record<string, unknown> | null | undefined;
    const noweb = config?.noweb as Record<string, unknown> | undefined;
    const store = noweb?.store as Record<string, unknown> | undefined;
    return store?.enabled === true && store?.fullSync === true && noweb?.markOnline === false;
  }

  async function apagar(sessao: string): Promise<void> {
    const r = await chamar("DELETE", `/api/sessions/${s(sessao)}`);
    if (!r.ok && r.status !== 404) throw new LeitorRecusou(`leitor_apagar_${r.status}`);
  }

  return {
    async estado(sessao) {
      return paraEstado(await lerSessao(sessao));
    },

    async preparar(sessao) {
      let corpo = await lerSessao(sessao);
      if (!corpo) {
        const criada = await chamar("POST", "/api/sessions", {
          name: sessao,
          start: false,
          config: {
            ignore: CONVERSAS_IGNORADAS,
            noweb: { markOnline: false, store: ACERVO_DO_HISTORICO },
            client: { deviceName: NOME_DO_APARELHO, browserName: "Chrome" },
            metadata: { "raio_x": "1" },
            webhooks: [],
          },
        });
        if (!criada.ok && criada.status !== 422) throw new LeitorRecusou(`leitor_criar_${criada.status}`);
        corpo = await lerSessao(sessao);
        if (!corpo) throw new LeitorRecusou("leitor_sessao_sumiu");
      }
      if (!configConferida(corpo)) {
        await apagar(sessao).catch(() => undefined);
        throw new LeitorRecusou("leitor_config_recusada");
      }
      if (corpo.status === "STOPPED" || corpo.status === "FAILED") {
        const r = await chamar("POST", `/api/sessions/${s(sessao)}/start`, {});
        if (!r.ok && r.status !== 422) throw new LeitorRecusou(`leitor_iniciar_${r.status}`);
        corpo = (await lerSessao(sessao)) ?? corpo;
      }
      return paraEstado(corpo);
    },

    async pedirCodigo(sessao, telefone) {
      const numero = pairingPhoneSchema.safeParse(telefone);
      if (!numero.success) throw new LeitorRecusou("telefone_invalido");
      const atual = paraEstado(await lerSessao(sessao));
      if (atual.estado === "conectado") throw new LeitorRecusou("ja_conectado");
      if (atual.estado !== "esperando_pareamento") throw new LeitorRecusou("ainda_nao_pronto");
      const r = await chamar("POST", `/api/${s(sessao)}/auth/request-code`, { phoneNumber: numero.data });
      if (!r.ok) throw new LeitorRecusou("codigo_recusado");
      const corpo = (await r.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof corpo?.code === "string" ? corpo.code.toUpperCase().replace(/-/g, "") : "";
      if (!/^[A-Z0-9]{8}$/.test(code)) throw new LeitorRecusou("codigo_invalido");
      return `${code.slice(0, 4)}-${code.slice(4)}`;
    },

    async qr(sessao) {
      const r = await chamar("GET", `/api/${s(sessao)}/auth/qr?format=image`);
      if (!r.ok) return null;
      const tipo = r.headers.get("content-type") ?? "";
      if (!tipo.startsWith("image/")) return null;
      return Buffer.from(await r.arrayBuffer());
    },

    async paginaDeConversas(sessao, opts) {
      const qs = new URLSearchParams({ limit: String(opts.limit), offset: String(opts.offset), sortBy: "id", sortOrder: "asc" });
      const r = await chamar("GET", `/api/${s(sessao)}/chats?${qs}`);
      if (!r.ok) throw new LeitorRecusou(`leitor_chats_${r.status}`);
      const bruto = (await r.json().catch(() => null)) as unknown;
      // 200 que não é lista NÃO é "acabou": a leitura terminaria no meio.
      if (!Array.isArray(bruto)) throw new LeitorRecusou("leitor_chats_invalido");
      const conversas: ConversaListada[] = [];
      bruto.forEach((item, i) => {
        if (!item || typeof item !== "object") return;
        const o = item as Record<string, unknown>;
        const id = o.id;
        const chatId =
          typeof id === "string"
            ? id
            : id && typeof id === "object" && typeof (id as Record<string, unknown>)._serialized === "string"
              ? ((id as Record<string, unknown>)._serialized as string)
              : null;
        if (!chatId || !ehConversaIndividual(chatId)) return;
        const ultima = o.conversationTimestamp ?? (o.lastMessage as Record<string, unknown> | null | undefined)?.timestamp;
        conversas.push({ chatId, ultimaEm: emMs(ultima), posicao: opts.offset + i });
      });
      return { conversas, lidas: bruto.length };
    },

    async paginaDeMensagens(sessao, chatId, opts) {
      const qs = new URLSearchParams({
        limit: String(opts.limit),
        offset: String(opts.offset),
        downloadMedia: "false",
        sortBy: "timestamp",
        sortOrder: "asc",
        "filter.timestamp.gte": String(Math.floor(opts.desde / 1000)),
      });
      const r = await chamar("GET", `/api/${s(sessao)}/chats/${s(chatId)}/messages?${qs}`);
      if (!r.ok) throw new LeitorRecusou(`leitor_mensagens_${r.status}`);
      const bruto = (await r.json().catch(() => null)) as unknown;
      if (!Array.isArray(bruto)) throw new LeitorRecusou("leitor_mensagens_invalido");
      const mensagens: MensagemLida[] = [];
      for (const item of bruto) {
        const p = wahaPayloadSchema.safeParse(item);
        if (!p.success) continue;
        const m = mensagemDoAcervo(p.data);
        if (m && m.em >= opts.desde) mensagens.push(m);
      }
      return { mensagens, lidas: bruto.length };
    },

    async baixarAudio(sessao, chatId, mensagemId, tetoMs) {
      const r = await chamar("GET", `/api/${s(sessao)}/chats/${s(chatId)}/messages/${s(mensagemId)}?downloadMedia=true`, undefined, tetoMs);
      if (!r.ok) throw new LeitorRecusou(`leitor_midia_${r.status}`);
      const corpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      const media = corpo && typeof corpo.media === "object" ? (corpo.media as Record<string, unknown> | null) : null;
      if (!media || media.error || typeof media.url !== "string" || !media.url) return null;
      // O endereço anunciado é o INTERNO do contêiner: só o caminho sobrevive,
      // resolvido na nossa base (o host nunca vem do payload).
      let caminho: string;
      try {
        caminho = new URL(media.url).pathname;
      } catch {
        return null;
      }
      const arquivo = await chamar("GET", caminho, undefined, tetoMs);
      if (!arquivo.ok) return null;
      const bytes = Buffer.from(await arquivo.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > TETO_DO_AUDIO_BYTES) return null;
      const mime = arquivo.headers.get("content-type") || (typeof media.mimetype === "string" ? media.mimetype : "audio/ogg");
      return { bytes, mime };
    },

    async desconectar(sessao) {
      const r = await chamar("POST", `/api/sessions/${s(sessao)}/logout`, {});
      if (!r.ok && r.status !== 404 && r.status !== 422) throw new LeitorRecusou(`leitor_logout_${r.status}`);
      await apagar(sessao);
    },
  };
}

/**
 * O leitor configurado, ou `null` quando a instalação não tem o contêiner do
 * raio-X (`RAIO_X_LEITOR_URL` ausente). A chave é a mesma do outro contêiner
 * (`WAHA_API_KEY`), salvo `RAIO_X_LEITOR_CHAVE`, para não pedir linha nova no
 * Environment do EasyPanel.
 */
export function leitorDoRaioX(): LeitorDoRaioX | null {
  const url = process.env.RAIO_X_LEITOR_URL?.trim();
  const chave = (process.env.RAIO_X_LEITOR_CHAVE ?? process.env.WAHA_API_KEY ?? "").trim();
  if (!url || !chave || chave === "dev_plaintext_change_me") return null;
  return criarLeitor(url, chave);
}

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Ai from "ai";
import type * as Canais from "@/lib/channels";
import type * as Derivacao from "@/lib/messaging/media/derive";
import type * as DerivacaoDeVideo from "@/lib/messaging/media/video-derive";
import type * as ExtratorDePdf from "@/lib/ai/rag/extractors/pdf";
import type * as LeituraAdiada from "@/lib/messaging/media/leitura-adiada";
import type * as Transcricao from "@/lib/messaging/media/transcription";

/**
 * FORK MIA · cerca (MIA-43): A MÍDIA DO HISTÓRICO IMPORTADO SÓ É GUARDADA.
 *
 * O histórico importado (#999) traz meses de conversa. A mídia dele vai para o
 * Storage, para quem abrir a conversa e para a análise de atendimento depois,
 * mas NÃO passa pela derivação textual: transcrição de áudio, visão de foto e
 * leitura de PDF são pagas e alimentam a IA, que responderia gente que falou
 * há meses.
 *
 * Os dois chamadores que gravam histórico com mídia rodam DE VERDADE:
 *
 *   - coexistência (`gravarLoteDoHistorico`, lote de histórico da Meta e o lote
 *     de mídia que liga o marcador `media_placeholder`);
 *   - canal não oficial (`rodarUmaRodada`, a importação pelo QR).
 *
 * Eles gravam num banco em memória e emitem eventos. Um dreno de mentira
 * entrega cada evento aos handlers REAIS registrados para o tipo dele
 * (`mediaPersistHandler`, `mediaDeriveHandler`), igual ao dreno do event_log.
 * A derivação (`deriveMessageMedia`), a transcrição, a visão (`generateText`
 * do `ai`), a leitura de PDF e a de vídeo são espiões.
 *
 * A cerca afirma, para áudio, imagem e documento:
 *   - o arquivo foi guardado (upload no bucket e `media_storage_path` gravado);
 *   - nenhum evento além do `media.persist_requested` de cada mídia: sem
 *     `media.derive_requested`, sem `message.*`;
 *   - nenhuma chamada de derivação, transcrição, visão, PDF ou vídeo;
 *   - a linha de `messages` sem texto derivado (`media_derived_text`,
 *     `media_derived_status` e corpo como o chamador gravou).
 *
 * O CONTROLE (a mesma mídia SEM a chave `historico_importado`) segue o caminho
 * normal e chama a derivação, para o "não deriva" não ficar verde à toa.
 *
 * Dado fictício: Academia Alfa, número +55 31 900000001, cliente Ana Exemplo
 * (+55 31 900000002).
 */

// ---------------------------------------------------------------------------
// Espiões: tudo que transcreve, descreve, lê ou deriva.
// ---------------------------------------------------------------------------
const espioes = vi.hoisted(() => ({
  derivar: vi.fn(async (row: { entity_id: string | null }) => ({
    consumer_key: "media_derive_v1",
    status: "ok" as const,
    detail: `derivada ${row.entity_id}`,
  })),
  generateText: vi.fn(),
  streamText: vi.fn(),
  generateObject: vi.fn(),
  deriveMediaText: vi.fn(),
  deriveVideoText: vi.fn(),
  extractPdfText: vi.fn(),
  apiTranscriptionProvider: vi.fn(),
  baixarDoCanal: vi.fn(),
  haLeitor: vi.fn(async () => true),
}));

vi.mock("@/workers/media-derive-worker", () => ({
  MEDIA_DERIVE_CONSUMER_KEY: "media_derive_v1",
  deriveMessageMedia: espioes.derivar,
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: espioes.generateText,
  streamText: espioes.streamText,
  generateObject: espioes.generateObject,
}));
vi.mock("@/lib/messaging/media/derive", async (importOriginal) => ({
  ...(await importOriginal<typeof Derivacao>()),
  deriveMediaText: espioes.deriveMediaText,
}));
vi.mock("@/lib/messaging/media/video-derive", async (importOriginal) => ({
  ...(await importOriginal<typeof DerivacaoDeVideo>()),
  deriveVideoText: espioes.deriveVideoText,
}));
vi.mock("@/lib/ai/rag/extractors/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof ExtratorDePdf>()),
  extractPdfText: espioes.extractPdfText,
}));
vi.mock("@/lib/messaging/media/transcription", async (importOriginal) => ({
  ...(await importOriginal<typeof Transcricao>()),
  apiTranscriptionProvider: espioes.apiTranscriptionProvider,
}));

// O download do canal (o adapter): devolve bytes no mime que a linha diz.
vi.mock("@/lib/channels", async (importOriginal) => {
  const real = await importOriginal<typeof Canais>();
  return {
    ...real,
    getAdapter: () => ({ fetchInboundMedia: espioes.baixarDoCanal }),
  };
});

// A foto do controle tem quem leia a descrição: sem isso a trava "foto só com
// leitor" adiaria a visão e o controle não provaria a derivação.
vi.mock("@/lib/messaging/media/leitura-adiada", async (importOriginal) => ({
  ...(await importOriginal<typeof LeituraAdiada>()),
  haLeitorDaDescricao: espioes.haLeitor,
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Coexistência: as perguntas de fora do lote (titular apagado, número interno
// de aviso, contato anonimizado) respondem "pode gravar". Não são o assunto.
vi.mock("@/lib/channels/meta/titular-apagado", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  perguntarTitularesApagadosNoLote: async () => ({ apagados: new Set<string>(), erro: null }),
}));
vi.mock("@/lib/escalacao/numero-interno-de-aviso", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ehNumeroInternoDeAviso: async () => false,
}));
vi.mock("@/lib/channels/contato-por-telefone", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  encontrarContatoPorTelefoneComAnonimizacao: async () => null,
}));

// Canal não oficial: o acervo de uma conversa só.
const acervo = vi.hoisted(() => ({
  chatId: "5531900000002@s.whatsapp.net",
  mensagens: [] as Array<Record<string, unknown>>,
  urls: {} as Record<string, string>,
}));
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({
    async paginaDeConversas(_s: string, opts: { limit: number; offset: number }) {
      const todas = [{ chatId: acervo.chatId, ultimaEm: null, posicao: 0 }];
      const fatia = todas.slice(opts.offset, opts.offset + opts.limit);
      return { conversas: fatia, lidas: fatia.length };
    },
    async paginaDeMensagens(_s: string, _c: string, opts: { limit: number; offset: number }) {
      const bruto = acervo.mensagens.slice(opts.offset, opts.offset + opts.limit);
      return { mensagens: bruto, lidas: bruto.length };
    },
    async baixarMidiaDaMensagem(_s: string, _c: string, messageId: string) {
      return { url: acervo.urls[messageId] ?? null, erro: false };
    },
  }),
}));

// O worker pega o cliente admin sozinho: aponta para o banco em memória do caso.
const atual = vi.hoisted(() => ({ banco: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => atual.banco }));

import type { EventRow } from "@/lib/event-log/dispatcher";
import { rodarUmaRodada } from "@/lib/channels/historico/rodada";
import { gravarLoteDoHistorico } from "@/lib/channels/meta/coexistencia/gravar-lote";
import { mediaPersistHandler } from "@/workers/media-persist-worker.handler";
import { mediaDeriveHandler } from "@/workers/media-derive-worker.handler";
import { bancoEmMemoria, type Linha, type RpcDeMentira } from "@/tests/helpers/banco-em-memoria";

// ---------------------------------------------------------------------------
// Banco: as tabelas de `tests/helpers/banco-em-memoria.ts`, com as funções do
// banco que os chamadores usam, o bucket e o registro dos eventos emitidos.
// ---------------------------------------------------------------------------
const ORG = "org-academia-alfa";
const SESSAO_META = "sess-meta-alfa";
const SESSAO_QR = "sess-qr-alfa";
const NUMERO_DA_EMPRESA = "5531900000001";
const WA_ID_DA_ANA = "5531900000002";

function bancoDoCaso() {
  const eventos: Array<{ tipo: string; args: Linha }> = [];
  const uploads: Array<{ bucket: string; path: string; bytes: number; contentType: string }> = [];
  const ok = (data: unknown) => ({ data, error: null });
  const rpcs: Record<string, RpcDeMentira> = {
    emit_event: (args) => {
      eventos.push({ tipo: String(args.p_event_type), args });
      return ok(null);
    },
    fn_titular_apagado_a_pedido: () => ok(false),
    fn_upsert_wa_contact: () => ok("contato-ana"),
    fn_upsert_wa_conversation_importada: (args, db) => {
      const conversas = (db.conversations ??= []);
      if (!conversas.some((c) => c.id === "conversa-ana")) {
        conversas.push({
          id: "conversa-ana",
          organization_id: ORG,
          contact_id: args.p_contact,
          channel_session_id: args.p_session,
          is_group: false,
          last_outbound_at: null,
        });
      }
      return ok("conversa-ana");
    },
    fn_mia_coexistencia_recontar: () => ok(null),
  };
  const base = bancoEmMemoria({}, rpcs);
  const admin = {
    from: base.cliente.from,
    // Função que ninguém declarou é erro: o dublê não pode responder `null` calado.
    rpc: async (nome: string, args: unknown) =>
      rpcs[nome] ? base.cliente.rpc(nome, args) : { data: null, error: { message: `rpc inesperada: ${nome}` } },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, buf: Buffer, opts: { contentType: string }) => {
          uploads.push({ bucket, path, bytes: buf.byteLength, contentType: opts.contentType });
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { admin, tabela: base.tabela, eventos, uploads };
}

type Banco = ReturnType<typeof bancoDoCaso>;

/**
 * O dreno: entrega cada evento, na ordem, a todo handler REAL que se registra
 * para o tipo dele, até não sobrar evento novo. É o que o event_log faz em
 * produção; aqui só os dois handlers da esteira de mídia estão ligados.
 */
async function drenar(banco: Banco) {
  const handlers = [mediaPersistHandler, mediaDeriveHandler];
  const atendidos: Array<{ handler: string; tipo: string; status: string; detail?: string }> = [];
  for (let i = 0; i < banco.eventos.length; i++) {
    const ev = banco.eventos[i]!;
    const row: EventRow = {
      id: `ev-${i}`,
      organization_id: String(ev.args.p_organization_id),
      event_type: ev.tipo,
      entity_kind: String(ev.args.p_entity_kind),
      entity_id: (ev.args.p_entity_id as string | null) ?? null,
      payload: (ev.args.p_payload as Record<string, unknown>) ?? {},
      metadata: (ev.args.p_metadata as Record<string, unknown>) ?? {},
      consumed_by: [],
      attempts: 0,
    };
    for (const h of handlers.filter((x) => x.events.includes(ev.tipo))) {
      const r = await h.handle(row);
      atendidos.push({ handler: h.key, tipo: ev.tipo, status: r.status, detail: r.detail });
    }
  }
  return atendidos;
}

const MIDIAS = ["audio", "image", "document"] as const;
const MIME: Record<(typeof MIDIAS)[number], string> = {
  audio: "audio/ogg",
  image: "image/jpeg",
  document: "application/pdf",
};

beforeEach(() => {
  for (const espiao of Object.values(espioes)) espiao.mockClear();
  espioes.baixarDoCanal.mockImplementation(async ({ hintMime }: { hintMime: string | null }) => ({
    buffer: Buffer.from([1, 2, 3, 4]),
    mime: (hintMime ?? "application/octet-stream").split(";")[0]!.trim(),
  }));
  espioes.haLeitor.mockResolvedValue(true);
  acervo.mensagens = [];
  acervo.urls = {};
});

/** Nada que transcreve, descreve, lê ou deriva foi chamado. */
function nenhumaDerivacao() {
  expect(espioes.derivar).not.toHaveBeenCalled();
  expect(espioes.generateText).not.toHaveBeenCalled();
  expect(espioes.streamText).not.toHaveBeenCalled();
  expect(espioes.generateObject).not.toHaveBeenCalled();
  expect(espioes.deriveMediaText).not.toHaveBeenCalled();
  expect(espioes.deriveVideoText).not.toHaveBeenCalled();
  expect(espioes.extractPdfText).not.toHaveBeenCalled();
  expect(espioes.apiTranscriptionProvider).not.toHaveBeenCalled();
}

/** A linha guardou o arquivo e não ganhou texto derivado. */
function soGuardou(banco: Banco, msg: Linha, antes: Linha) {
  expect(msg.media_storage_path).toBe(`${ORG}/conversa-ana/${msg.id}.${extensao(String(msg.media_mime))}`);
  expect(banco.uploads.some((u) => u.bucket === "whatsapp-media" && u.path === msg.media_storage_path)).toBe(true);
  expect(msg.media_size_bytes).toBe(4);
  expect((msg.metadata as Linha).media_status).toBe("stored");
  expect((msg.metadata as Linha).historico_importado).toBe("true");
  expect(msg.media_derived_text ?? null).toBeNull();
  // Nulo hoje (igual ao grupo). Se um dia o histórico ganhar o desfecho
  // terminal da #2171, só `skipped` cabe: nunca `done`, nunca texto.
  expect([null, "skipped"]).toContain(msg.media_derived_status ?? null);
  expect(msg.body).toEqual(antes.body);
  expect(msg.type).toEqual(antes.type);
}

function extensao(mime: string): string {
  return { "audio/ogg": "ogg", "image/jpeg": "jpg", "application/pdf": "pdf" }[mime] ?? "bin";
}

// ---------------------------------------------------------------------------
// Chamador 1: coexistência (o histórico que a Meta manda).
// ---------------------------------------------------------------------------
function bancoDaCoexistencia() {
  const banco = bancoDoCaso();
  banco.tabela("channel_sessions").push({
    id: SESSAO_META,
    organization_id: ORG,
    provider: "meta_cloud",
    meta_phone_number_id: "pn-academia-alfa",
  });
  banco.tabela("mia_coexistencia_conexoes").push({ id: "con-1", organization_id: ORG, channel_session_id: SESSAO_META });
  banco.tabela("mia_coexistencia_sincronizacoes").push({ id: "sinc-1", organization_id: ORG, conexao_id: "con-1" });
  return banco;
}

function loteDeHistorico(banco: Banco, id: string, mensagens: Linha[]) {
  banco.tabela("mia_coexistencia_lotes").push({
    id,
    organization_id: ORG,
    sincronizacao_id: "sinc-1",
    tipo: "historico",
    estado: "recebido",
    tentativas: 0,
    created_at: new Date().toISOString(),
    payload: {
      numero_da_empresa: NUMERO_DA_EMPRESA,
      item: { threads: [{ id: WA_ID_DA_ANA, messages: mensagens }] },
    },
  });
}

const segundos = Math.floor(Date.now() / 1000) - 3 * 86_400;
function midiaDaMeta(tipo: (typeof MIDIAS)[number], n: number): Linha {
  return {
    id: `wamid.alfa-${tipo}-${n}`,
    timestamp: String(segundos + n),
    from: WA_ID_DA_ANA,
    from_user_id: "ana-exemplo",
    type: tipo,
    [tipo]: {
      id: `midia-${tipo}-${n}`,
      mime_type: MIME[tipo],
      ...(tipo === "audio" ? { voice: true } : {}),
      ...(tipo === "document" ? { filename: "plano-academia-alfa.pdf" } : {}),
    },
  };
}

describe("coexistência: a mídia do histórico da Meta só é guardada", () => {
  it("áudio, imagem e documento: arquivo guardado, nenhum evento além da persistência, nenhuma derivação", async () => {
    const banco = bancoDaCoexistencia();
    atual.banco = banco.admin;
    loteDeHistorico(banco, "lote-1", MIDIAS.map((t, i) => midiaDaMeta(t, i)));

    const r = await gravarLoteDoHistorico(banco.admin as never, "lote-1");
    expect(r).toMatchObject({ status: "gravado", contagem: { mensagens: 3, midias: 3 } });
    const gravadas = banco.tabela("messages");
    expect(gravadas.map((m) => m.type)).toEqual(["audio", "image", "document"]);
    const antes = new Map(gravadas.map((m) => [m.id, structuredClone(m)]));

    const atendidos = await drenar(banco);

    expect(atendidos).toEqual(
      gravadas.map(() => ({ handler: "media_persist_v1", tipo: "media.persist_requested", status: "ok", detail: undefined })),
    );
    expect(banco.eventos.map((e) => e.tipo)).toEqual(Array(3).fill("media.persist_requested"));
    expect(espioes.baixarDoCanal).toHaveBeenCalledTimes(3);
    expect(banco.uploads).toHaveLength(3);
    for (const m of gravadas) soGuardou(banco, m, antes.get(m.id)!);
    nenhumaDerivacao();
  });

  it("o lote de mídia que liga o marcador também só guarda", async () => {
    const banco = bancoDaCoexistencia();
    atual.banco = banco.admin;
    loteDeHistorico(banco, "lote-1", [
      { id: "wamid.alfa-marcador", timestamp: String(segundos), from: WA_ID_DA_ANA, type: "media_placeholder" },
    ]);
    await gravarLoteDoHistorico(banco.admin as never, "lote-1");
    expect(banco.eventos).toHaveLength(0);

    banco.tabela("mia_coexistencia_lotes").push({
      id: "lote-midia",
      organization_id: ORG,
      sincronizacao_id: "sinc-1",
      tipo: "midia",
      estado: "recebido",
      tentativas: 0,
      created_at: new Date().toISOString(),
      payload: { mensagem: { ...midiaDaMeta("image", 9), id: "wamid.alfa-marcador" } },
    });
    const r = await gravarLoteDoHistorico(banco.admin as never, "lote-midia");
    expect(r).toMatchObject({ status: "gravado", contagem: { midias: 1 } });
    const [msg] = banco.tabela("messages");
    const antes = structuredClone(msg!);

    await drenar(banco);

    expect(banco.eventos.map((e) => e.tipo)).toEqual(["media.persist_requested"]);
    soGuardou(banco, msg!, antes);
    nenhumaDerivacao();
  });

  it("controle: a mesma mídia sem a chave do histórico pede e chama a derivação", async () => {
    const banco = bancoDaCoexistencia();
    atual.banco = banco.admin;
    loteDeHistorico(banco, "lote-1", MIDIAS.map((t, i) => midiaDaMeta(t, i)));
    await gravarLoteDoHistorico(banco.admin as never, "lote-1");
    const gravadas = banco.tabela("messages");
    for (const m of gravadas) delete (m.metadata as Linha).historico_importado;

    await drenar(banco);

    expect(banco.uploads).toHaveLength(3);
    expect(banco.eventos.map((e) => e.tipo)).toEqual([
      ...Array(3).fill("media.persist_requested"),
      ...Array(3).fill("media.derive_requested"),
    ]);
    expect(espioes.derivar).toHaveBeenCalledTimes(3);
    expect(espioes.derivar.mock.calls.map(([row]) => (row as EventRow).entity_id)).toEqual(gravadas.map((m) => m.id));
  });
});

// ---------------------------------------------------------------------------
// Chamador 2: canal não oficial (a importação pelo QR).
// ---------------------------------------------------------------------------
function bancoDoCanalNaoOficial() {
  const banco = bancoDoCaso();
  banco.tabela("channel_sessions").push({
    id: SESSAO_QR,
    organization_id: ORG,
    provider: "waha",
    waha_session_name: "academia-alfa",
  });
  banco.tabela("importacoes_de_historico").push({
    id: "imp-1",
    organization_id: ORG,
    channel_session_id: SESSAO_QR,
    status: "rodando",
    dias: 30,
    cursor: {},
    conversas_feitas: 0,
    mensagens_gravadas: 0,
    mensagens_existentes: 0,
    mensagens_ignoradas: 0,
    midias_baixadas: 0,
    midias_indisponiveis: 0,
    erro: null,
  });
  return banco;
}

const CHAVE_DO_TIPO: Record<string, string> = {
  audio: "audioMessage",
  image: "imageMessage",
  document: "documentMessage",
};
function midiaDoAcervo(tipo: (typeof MIDIAS)[number], n: number): Linha {
  const id = `false_${acervo.chatId}_ALFA${n}`;
  acervo.urls[id] = `http://canal/files/alfa-${n}`;
  return {
    id,
    timestamp: segundos + n,
    from: acervo.chatId,
    fromMe: false,
    body: "",
    hasMedia: true,
    ...(tipo === "document" ? { type: "document" } : {}),
    media: { url: null, mimetype: MIME[tipo], filename: tipo === "document" ? "plano-academia-alfa.pdf" : null },
    _data: {
      key: { remoteJid: acervo.chatId, fromMe: false, id: `ALFA${n}` },
      message: { [CHAVE_DO_TIPO[tipo]!]: { mimetype: MIME[tipo] } },
    },
  };
}

const SEM_TETO = { conversas: 1000, mensagens: 100_000, chamadas: 10_000 };

describe("canal não oficial: a mídia do histórico importado só é guardada", () => {
  it("áudio e imagem: arquivo guardado, nenhum evento além da persistência, nenhuma derivação; documento nem chega ao worker", async () => {
    const banco = bancoDoCanalNaoOficial();
    atual.banco = banco.admin;
    acervo.mensagens = MIDIAS.map((t, i) => midiaDoAcervo(t, i));

    const r = await rodarUmaRodada(banco.admin as never, "imp-1", SEM_TETO);
    expect(r.status).toBe("concluida");
    const gravadas = banco.tabela("messages");
    expect(gravadas).toHaveLength(3);
    const comArquivo = gravadas.filter((m) => m.media_url);
    // O importador do QR só baixa áudio e imagem; o documento fica fora do escopo.
    expect(comArquivo.map((m) => m.type)).toEqual(["audio", "image"]);
    const documento = gravadas.find((m) => !m.media_url)!;
    expect((documento.metadata as Linha).media_status).toBe("fora_do_escopo");
    const antes = new Map(gravadas.map((m) => [m.id, structuredClone(m)]));

    const atendidos = await drenar(banco);

    expect(atendidos.map((a) => [a.handler, a.status])).toEqual([
      ["media_persist_v1", "ok"],
      ["media_persist_v1", "ok"],
    ]);
    expect(banco.eventos.map((e) => e.tipo)).toEqual(["media.persist_requested", "media.persist_requested"]);
    expect(banco.uploads).toHaveLength(2);
    for (const m of comArquivo) soGuardou(banco, m, antes.get(m.id)!);
    expect(documento).toEqual(antes.get(documento.id));
    nenhumaDerivacao();
  });

  it("controle: a mesma mídia sem a chave do histórico pede e chama a derivação", async () => {
    const banco = bancoDoCanalNaoOficial();
    atual.banco = banco.admin;
    acervo.mensagens = MIDIAS.map((t, i) => midiaDoAcervo(t, i));
    await rodarUmaRodada(banco.admin as never, "imp-1", SEM_TETO);
    const comArquivo = banco.tabela("messages").filter((m) => m.media_url);
    for (const m of comArquivo) delete (m.metadata as Linha).historico_importado;

    await drenar(banco);

    expect(banco.uploads).toHaveLength(2);
    expect(banco.eventos.map((e) => e.tipo)).toEqual([
      "media.persist_requested",
      "media.persist_requested",
      "media.derive_requested",
      "media.derive_requested",
    ]);
    expect(espioes.derivar.mock.calls.map(([row]) => (row as EventRow).entity_id)).toEqual(comArquivo.map((m) => m.id));
  });
});

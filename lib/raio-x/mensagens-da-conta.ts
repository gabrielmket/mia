/**
 * FORK MIA (.102) · AS MENSAGENS DO RAIO-X DO CLIENTE ATIVO, lidas da CONTA na
 * hora da análise e do relatório (nada de texto é copiado para as tabelas do
 * raio-X; a exceção, transitória, é a transcrição do áudio que a MIA ainda não
 * tinha: `mia_raio_x_mensagens`, apagada com as conversas em 30 dias).
 *
 * Para cada conversa do raio-X (a referência cifrada guarda o id da conversa da
 * conta), devolve:
 *
 *   - as mensagens do período, na ordem, com quem mandou (`quem-respondeu.ts`):
 *     sem as apagadas (`revoked_at`), sem reação e sem linha de sistema; o texto
 *     sem telefone, e-mail ou documento (`tirarIdentificadores`); o áudio com a
 *     transcrição da MIA (`media_derived_text` pronto) ou a do raio-X;
 *   - o nome do contato, SÓ para tirá-lo dos trechos;
 *   - o rótulo do número; e, no relatório, a primeira passagem do período
 *     (`passagens_de_atendimento`, ou `conversations.last_handoff_at` da
 *     conversa que passou antes de a tabela ter escritor) e as marcas do funil
 *     da própria conta (`crm_leads`, `calendar_appointments`).
 *
 * A conversa cujo contato deixou de poder ser lido (pediu exclusão, foi
 * marcado como pessoal) desde a leitura NÃO volta: sai da análise e do
 * relatório. Toda consulta filtra `organization_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { tirarIdentificadores } from "./anonimizar";
import type { LinhaDoRaioX } from "./banco";
import { decifrarReferencia } from "./cifra";
import { elegiveis } from "./leitura-da-conta";
import type { FunilDaConversa, PassagemLida } from "./passagem";
import { quemEnviou } from "./quem-respondeu";
import type { MensagemDoRelatorio } from "./relatorio";
import { marcaDaMensagem } from "./tokens";

/** O tipo da mensagem da conta no vocabulário do raio-X. Reação e sistema não entram. */
const TIPO_DO_RAIO_X: Record<string, string> = {
  text: "texto",
  audio: "audio",
  image: "imagem",
  video: "video",
  document: "documento",
  sticker: "figurinha",
  location: "outro",
  contact: "outro",
};
const TIPOS_QUE_NAO_ENTRAM = new Set(["reaction", "system"]);
/** 100 ids por `in`: a URL do PostgREST fica abaixo de 4 KB. */
const LOTE_DE_IDS = 100;
const PAGINA = 1000;

export interface ConversaDaContaLida {
  /** O id da conversa do RAIO-X (`mia_raio_x_conversas.id`). */
  conversaId: string;
  numero: string | null;
  nomes: string[];
  mensagens: MensagemDoRelatorio[];
  /** Só com `extras`. */
  passagem: PassagemLida | null;
  funil: FunilDaConversa | null;
}

interface MensagemDaConta {
  id: string;
  conversation_id: string;
  direction: string;
  sent_via: string | null;
  type: string;
  body: string | null;
  sent_at: string;
  media_derived_text: string | null;
  media_derived_status: string | null;
  revoked_at: string | null;
}

function emLotes<T>(lista: readonly T[], tamanho = LOTE_DE_IDS): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

function falhou(contexto: string, erro: { code?: string } | null): never {
  throw new Error(`raio-x: ${contexto} (${erro?.code ?? "sem_codigo"})`);
}

async function todasAsPaginas<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>, contexto: string): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) falhou(contexto, error);
    const pagina = (data ?? []) as T[];
    saida.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return saida;
}

/** A mensagem da conta como o relatório a lê. `null` = não entra (reação, sistema, apagada). */
export function mensagemDaConta(m: MensagemDaConta, transcricaoDoRaioX: string | null): MensagemDoRelatorio | null {
  if (TIPOS_QUE_NAO_ENTRAM.has(m.type) || m.revoked_at) return null;
  const tipo = TIPO_DO_RAIO_X[m.type] ?? "outro";
  const quem = quemEnviou(m.direction, m.sent_via);
  let bruto: string | null;
  if (tipo === "audio") {
    const daMia = m.media_derived_status === "ready" && m.media_derived_text?.trim() ? m.media_derived_text : null;
    bruto = daMia ?? transcricaoDoRaioX;
  } else {
    bruto = m.body?.trim() ? m.body : null;
  }
  return {
    daLoja: quem !== "cliente",
    em: Date.parse(m.sent_at),
    tipo,
    texto: bruto ? tirarIdentificadores(bruto).slice(0, 4000) : null,
    ...(quem !== "cliente" ? { quem } : {}),
  };
}

/** O id da conversa da conta, pela referência cifrada da conversa do raio-X. */
export function conversaDaConta(referencia: string | null | undefined): string | null {
  return decifrarReferencia(referencia)?.chatId ?? null;
}

export async function lerConversasDaConta(
  admin: SupabaseClient,
  r: Pick<LinhaDoRaioX, "id" | "organization_id" | "periodo_inicio" | "periodo_fim">,
  linhas: ReadonlyArray<{ id: string; referencia: string | null }>,
  opcoes: { extras: boolean },
): Promise<Map<string, ConversaDaContaLida>> {
  const saida = new Map<string, ConversaDaContaLida>();
  const orgId = r.organization_id;
  if (!orgId || !r.periodo_inicio || !r.periodo_fim || linhas.length === 0) return saida;
  const inicio = r.periodo_inicio;
  const fim = r.periodo_fim;
  const doRaioX = new Map<string, string>();
  for (const l of linhas) {
    const id = conversaDaConta(l.referencia);
    if (id) doRaioX.set(id, l.id);
  }
  const { data: numeros, error: erroDosNumeros } = await admin.from("mia_raio_x_numeros").select("channel_session_id, rotulo").eq("raio_x_id", r.id);
  if (erroDosNumeros) falhou("números do raio-X", erroDosNumeros);
  const rotuloDoCanal = new Map(
    ((numeros ?? []) as Array<{ channel_session_id: string | null; rotulo: string }>).flatMap((n) => (n.channel_session_id ? [[n.channel_session_id, n.rotulo] as const] : [])),
  );

  for (const lote of emLotes([...doRaioX.keys()])) {
    const { data: conversas, error } = await admin
      .from("conversations")
      .select("id, contact_id, channel_session_id, last_handoff_at")
      .eq("organization_id", orgId)
      .in("id", lote);
    if (error) falhou("conversas da conta", error);
    const daConta = (conversas ?? []) as Array<{ id: string; contact_id: string; channel_session_id: string; last_handoff_at: string | null }>;
    const podem = await elegiveis(admin, orgId, daConta.map((c) => c.contact_id));
    const lidas = daConta.filter((c) => podem.has(c.contact_id));
    if (lidas.length === 0) continue;
    const ids = lidas.map((c) => c.id);
    const idsDoRaioX = ids.map((id) => doRaioX.get(id)!);

    const [mensagens, transcricoes] = await Promise.all([
      todasAsPaginas<MensagemDaConta>(
        (de, ate) =>
          admin
            .from("messages")
            .select("id, conversation_id, direction, sent_via, type, body, sent_at, media_derived_text, media_derived_status, revoked_at")
            .eq("organization_id", orgId)
            .in("conversation_id", ids)
            .gte("sent_at", inicio)
            .lt("sent_at", fim)
            .is("revoked_at", null)
            .order("sent_at", { ascending: true })
            .order("id", { ascending: true })
            .range(de, ate),
        "mensagens da conta",
      ),
      todasAsPaginas<{ marca: string; texto: string | null }>(
        (de, ate) =>
          admin
            .from("mia_raio_x_mensagens")
            .select("marca, texto")
            .eq("raio_x_id", r.id)
            .eq("tipo", "audio")
            .in("conversa_id", idsDoRaioX)
            .order("id", { ascending: true })
            .range(de, ate),
        "transcrições do raio-X",
      ),
    ]);
    const transcricao = new Map(transcricoes.map((t) => [t.marca, t.texto]));

    const porConversa = new Map<string, MensagemDoRelatorio[]>();
    for (const m of mensagens) {
      const lida = mensagemDaConta(m, m.type === "audio" ? (transcricao.get(marcaDaMensagem(r.id, m.id)) ?? null) : null);
      if (!lida) continue;
      const lista = porConversa.get(m.conversation_id) ?? [];
      lista.push(lida);
      porConversa.set(m.conversation_id, lista);
    }

    const passagens = new Map<string, PassagemLida>();
    const funis = new Map<string, FunilDaConversa>();
    if (opcoes.extras) {
      const contatos = [...new Set(lidas.map((c) => c.contact_id))];
      const [doCaso, negocios, agendamentos] = await Promise.all([
        todasAsPaginas<{ conversation_id: string; criado_em: string; reconhecido_em: string | null }>(
          (de, ate) =>
            admin
              .from("passagens_de_atendimento")
              .select("conversation_id, criado_em, reconhecido_em")
              .eq("organization_id", orgId)
              .in("conversation_id", ids)
              .gte("criado_em", inicio)
              .lt("criado_em", fim)
              .order("criado_em", { ascending: true })
              .range(de, ate),
          "passagens da conta",
        ),
        todasAsPaginas<{ contact_id: string | null; status: string; created_at: string; closed_at: string | null }>(
          (de, ate) =>
            admin
              .from("crm_leads")
              .select("contact_id, status, created_at, closed_at")
              .eq("organization_id", orgId)
              .in("contact_id", contatos)
              .lt("created_at", fim)
              .order("created_at", { ascending: true })
              .range(de, ate),
          "negócios da conta",
        ),
        todasAsPaginas<{ contact_id: string | null; created_at: string }>(
          (de, ate) =>
            admin
              .from("calendar_appointments")
              .select("contact_id, created_at")
              .eq("organization_id", orgId)
              .in("contact_id", contatos)
              .gte("created_at", inicio)
              .lt("created_at", fim)
              .order("created_at", { ascending: true })
              .range(de, ate),
          "agendamentos da conta",
        ),
      ]);
      for (const p of doCaso) {
        if (passagens.has(p.conversation_id)) continue;
        passagens.set(p.conversation_id, { em: Date.parse(p.criado_em), reconhecidaEm: p.reconhecido_em ? Date.parse(p.reconhecido_em) : null });
      }
      // A conversa que passou antes de a tabela ter escritor: vale o carimbo da conversa.
      for (const c of lidas) {
        if (passagens.has(c.id) || !c.last_handoff_at) continue;
        if (c.last_handoff_at >= inicio && c.last_handoff_at < fim) passagens.set(c.id, { em: Date.parse(c.last_handoff_at), reconhecidaEm: null });
      }
      const ini = Date.parse(inicio);
      const fimMs = Date.parse(fim);
      const porContato = new Map<string, FunilDaConversa>();
      const funilDe = (contato: string) => {
        const f = porContato.get(contato) ?? { negocio: false, visita: false, venda: false };
        porContato.set(contato, f);
        return f;
      };
      for (const n of negocios) {
        if (!n.contact_id) continue;
        const fechado = n.closed_at ? Date.parse(n.closed_at) : null;
        // Um negócio VIVO no período: nasceu antes do fim e não estava fechado antes do começo.
        if (Date.parse(n.created_at) < fimMs && (fechado === null || fechado >= ini)) funilDe(n.contact_id).negocio = true;
        if (n.status === "won" && fechado !== null && fechado >= ini && fechado < fimMs) funilDe(n.contact_id).venda = true;
      }
      for (const a of agendamentos) if (a.contact_id) funilDe(a.contact_id).visita = true;
      for (const c of lidas) funis.set(c.id, porContato.get(c.contact_id) ?? { negocio: false, visita: false, venda: false });
    }

    for (const c of lidas) {
      saida.set(doRaioX.get(c.id)!, {
        conversaId: doRaioX.get(c.id)!,
        numero: rotuloDoCanal.get(c.channel_session_id) ?? null,
        nomes: podem.get(c.contact_id)?.nomes ?? [],
        mensagens: (porConversa.get(c.id) ?? []).sort((a, b) => a.em - b.em),
        passagem: passagens.get(c.id) ?? null,
        funil: opcoes.extras ? (funis.get(c.id) ?? null) : null,
      });
    }
  }
  return saida;
}

/** Os áudios das conversas do raio-X que a MIA ainda não transcreveu, para o raio-X transcrever (dentro do teto). */
export async function audiosSemTranscricao(
  admin: SupabaseClient,
  r: Pick<LinhaDoRaioX, "id" | "organization_id" | "periodo_inicio" | "periodo_fim">,
  linhas: ReadonlyArray<{ id: string; referencia: string | null }>,
): Promise<Array<{ conversaId: string; mensagemId: string; daLoja: boolean; em: string }>> {
  const orgId = r.organization_id;
  if (!orgId || !r.periodo_inicio || !r.periodo_fim) return [];
  const doRaioX = new Map<string, string>();
  for (const l of linhas) {
    const id = conversaDaConta(l.referencia);
    if (id) doRaioX.set(id, l.id);
  }
  const saida: Array<{ conversaId: string; mensagemId: string; daLoja: boolean; em: string }> = [];
  for (const lote of emLotes([...doRaioX.keys()])) {
    const audios = await todasAsPaginas<{
      id: string;
      conversation_id: string;
      direction: string;
      sent_at: string;
      media_storage_path: string | null;
      media_derived_status: string | null;
      media_derived_text: string | null;
    }>(
      (de, ate) =>
        admin
          .from("messages")
          .select("id, conversation_id, direction, sent_at, media_storage_path, media_derived_status, media_derived_text")
          .eq("organization_id", orgId)
          .in("conversation_id", lote)
          .eq("type", "audio")
          .gte("sent_at", r.periodo_inicio!)
          .lt("sent_at", r.periodo_fim!)
          .is("revoked_at", null)
          .order("sent_at", { ascending: true })
          .range(de, ate),
      "áudios da conta",
    );
    for (const a of audios) {
      if (a.media_derived_status === "ready" && a.media_derived_text?.trim()) continue;
      if (!a.media_storage_path) continue;
      saida.push({ conversaId: doRaioX.get(a.conversation_id)!, mensagemId: a.id, daLoja: a.direction === "outbound", em: a.sent_at });
    }
  }
  return saida;
}

/** O arquivo de um áudio da conta, do storage da própria conta (o caminho é lido com o `organization_id`). */
export async function baixarAudioDaConta(
  admin: SupabaseClient,
  orgId: string,
  mensagemId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const { data } = await admin.from("messages").select("media_storage_path, media_mime").eq("organization_id", orgId).eq("id", mensagemId).maybeSingle();
  const linha = data as { media_storage_path?: string | null; media_mime?: string | null } | null;
  if (!linha?.media_storage_path) return null;
  const arquivo = await admin.storage.from("whatsapp-media").download(linha.media_storage_path);
  if (arquivo.error || !arquivo.data) return null;
  return { bytes: Buffer.from(await arquivo.data.arrayBuffer()), mime: (linha.media_mime ?? "audio/ogg").split(";")[0]!.trim() || "audio/ogg" };
}

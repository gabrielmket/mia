/**
 * FORK MIA · coexistência (S2): o WORKER grava um lote do histórico da Meta como
 * HISTÓRICO IMPORTADO, sem disparar nada.
 *
 * É o mesmo desenho da importação do canal não oficial
 * (`lib/channels/historico/rodada.ts`), com as mesmas peças:
 *
 *   - contato pela MESMA RPC e com o MESMO telefone canônico da ingestão ao vivo
 *     (`fn_upsert_wa_contact`), sem nome (o lote não traz o nome do perfil, e o
 *     da agenda chega pelo `smb_app_state_sync`);
 *   - conversa pela irmã que não reabre nem distribui
 *     (`fn_upsert_wa_conversation_importada`, 0760): a que já existe NÃO é
 *     tocada; a que não existe nasce `closed`, sem dono, com `last_message_at`
 *     da última mensagem da thread neste lote;
 *   - cada mensagem com `metadata.historico_importado = 'true'` (`mapear.ts`).
 *
 * O que NÃO é chamado, de propósito: `ingestMetaInbound`, `ingestMetaEcho`,
 * `pausarIaPorAtendimentoManual`, o carimbo da conversa
 * (`marcarConversaComMensagem`: `last_message_*`, `last_inbound_at`, não lidas,
 * a janela de 24 h) e os efeitos pós-entrada (lead, opt-out, agente). Mensagem
 * velha abrindo a janela faria a MIA tentar texto livre e a Meta recusar.
 *
 * ─── As mesmas guardas da agenda do app ─────────────────────────────────────
 *
 * Número interno de avisos não vira contato; titular apagado a pedido (LGPD) e
 * ficha anonimizada não voltam pelo histórico. A pergunta do apagado é UMA por
 * lote; se ela falha, o lote inteiro espera (falha fechada: importar na dúvida
 * desfaria o apagamento).
 *
 * ─── Reentrega e lote refeito ───────────────────────────────────────────────
 *
 * O lote reentregue nem chega aqui (`unique (sincronizacao_id, chave)`). O lote
 * que falhou no meio é refeito pelo `event_log`: o que ELE já gravou é
 * reconhecido por `metadata.coexistencia_lote_id` e conta como dele; o que
 * outro caminho gravou (o ao vivo, outro lote) conta como existente. Na 3ª
 * falha o lote desiste (`falhou`) e o cru é apagado.
 *
 * Os contadores do pedido são a soma dos lotes, recalculada pelo banco
 * (`fn_mia_coexistencia_recontar`, 9162) a cada lote.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { ehNumeroInternoDeAviso } from "@/lib/escalacao/numero-interno-de-aviso";

import { encontrarContatoPorTelefoneComAnonimizacao } from "../../contato-por-telefone";
import { canonicalPhoneBR } from "../../phone-variants";
import { perguntarTitularesApagadosNoLote } from "../titular-apagado";
import { soDigitos } from "./historico";
import { mapearMensagemDoHistorico, type LinhaDoHistoricoDaMeta } from "./mapear";

type Admin = SupabaseClient;

/** Na 3ª falha o lote desiste. */
export const TENTATIVAS_DO_LOTE = 3;
/** A mídia que chega antes da mensagem espera por ela até 30 minutos. */
export const ESPERA_DA_MIDIA_MS = 30 * 60_000;
export const INTERVALO_DA_MIDIA_MS = 2 * 60_000;

export interface ContagemDoLote {
  mensagens: number;
  existentes: number;
  conversas: number;
  midias: number;
  ignoradas: number;
}

export type DesfechoDoLote =
  | { status: "gravado"; contagem: ContagemDoLote }
  | { status: "ja_gravado" }
  | { status: "sumiu" }
  | { status: "esperar"; ate: number }
  | { status: "tentar_de_novo"; erro: string }
  | { status: "desistiu"; erro: string };

interface Lote {
  id: string;
  organization_id: string;
  sincronizacao_id: string;
  tipo: "mensagens" | "midia";
  estado: string;
  payload: Record<string, unknown> | null;
  tentativas: number;
  created_at: string;
}

interface Alvo {
  organizationId: string;
  channelSessionId: string;
  loteId: string;
  recebidoEm: number;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function erroCurto(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 120);
}

async function rpc(admin: Admin, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await admin.rpc(nome as never, args as never);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data;
}

export async function gravarLoteDoHistorico(
  admin: Admin,
  loteId: string,
  opcoes: { agora?: () => number } = {},
): Promise<DesfechoDoLote> {
  const agora = opcoes.agora ?? Date.now;
  const { data: achado, error: erroDoLote } = await admin
    .from("mia_coexistencia_lotes")
    .select("id, organization_id, sincronizacao_id, tipo, estado, payload, tentativas, created_at")
    .eq("id", loteId)
    .maybeSingle();
  if (erroDoLote) return { status: "tentar_de_novo", erro: erroCurto(erroDoLote.message) };
  const lote = achado as Lote | null;
  if (!lote) return { status: "sumiu" };
  if (lote.estado !== "recebido") return { status: "ja_gravado" };

  try {
    const { data: pedido, error: erroDoPedido } = await admin
      .from("mia_coexistencia_sincronizacoes")
      .select("conexao_id")
      .eq("id", lote.sincronizacao_id)
      .eq("organization_id", lote.organization_id)
      .maybeSingle();
    if (erroDoPedido || !pedido) throw new Error(`pedido: ${erroDoPedido?.message ?? "sem linha"}`);
    const { data: ciclo, error: erroDoCiclo } = await admin
      .from("mia_coexistencia_conexoes")
      .select("channel_session_id")
      .eq("id", (pedido as { conexao_id: string }).conexao_id)
      .eq("organization_id", lote.organization_id)
      .maybeSingle();
    if (erroDoCiclo || !ciclo) throw new Error(`ciclo: ${erroDoCiclo?.message ?? "sem linha"}`);

    const alvo: Alvo = {
      organizationId: lote.organization_id,
      channelSessionId: (ciclo as { channel_session_id: string }).channel_session_id,
      loteId: lote.id,
      recebidoEm: new Date(lote.created_at).getTime(),
    };

    let contagem: ContagemDoLote;
    if (lote.tipo === "midia") {
      const r = await ligarMidia(admin, alvo, objeto(lote.payload?.mensagem) ?? {});
      if (r === "sem_alvo") {
        if (agora() - alvo.recebidoEm < ESPERA_DA_MIDIA_MS) {
          return { status: "esperar", ate: agora() + INTERVALO_DA_MIDIA_MS };
        }
        return await desistir(admin, lote, "midia_sem_mensagem");
      }
      contagem = { mensagens: 0, existentes: 0, conversas: 0, midias: r, ignoradas: r === 0 ? 1 : 0 };
    } else {
      contagem = await gravarMensagens(
        admin,
        alvo,
        soDigitos(lote.payload?.numero_da_empresa),
        objeto(lote.payload?.item) ?? {},
      );
    }

    const { error: erroDoFim } = await admin
      .from("mia_coexistencia_lotes")
      .update({ estado: "gravado", payload: null, erro: null, ...contagem })
      .eq("id", lote.id)
      .eq("estado", "recebido");
    if (erroDoFim) throw new Error(`lote_gravado: ${erroDoFim.message}`);
    await rpc(admin, "fn_mia_coexistencia_recontar", { p_sincronizacao: lote.sincronizacao_id });
    return { status: "gravado", contagem };
  } catch (err) {
    const erro = erroCurto(err);
    if (lote.tentativas + 1 >= TENTATIVAS_DO_LOTE) return await desistir(admin, lote, erro);
    await admin
      .from("mia_coexistencia_lotes")
      .update({ tentativas: lote.tentativas + 1, erro })
      .eq("id", lote.id)
      .eq("estado", "recebido");
    return { status: "tentar_de_novo", erro };
  }
}

/** O lote desiste: o cru é apagado (a conversa não fica guardada) e o pedido conta a falha. */
async function desistir(admin: Admin, lote: Lote, erro: string): Promise<DesfechoDoLote> {
  await admin
    .from("mia_coexistencia_lotes")
    .update({ estado: "falhou", payload: null, erro, tentativas: lote.tentativas + 1 })
    .eq("id", lote.id)
    .eq("estado", "recebido");
  try {
    await rpc(admin, "fn_mia_coexistencia_recontar", { p_sincronizacao: lote.sincronizacao_id });
  } catch {
    // O próximo lote reconta: a soma é sempre refeita do zero.
  }
  return { status: "desistiu", erro };
}

async function gravarMensagens(
  admin: Admin,
  alvo: Alvo,
  numeroDaEmpresa: string | null,
  item: Record<string, unknown>,
): Promise<ContagemDoLote> {
  const conta: ContagemDoLote = { mensagens: 0, existentes: 0, conversas: 0, midias: 0, ignoradas: 0 };
  const threads = (Array.isArray(item.threads) ? item.threads : [])
    .map(objeto)
    .filter((t): t is Record<string, unknown> => t !== null);

  const waIdDa = (t: Record<string, unknown>) => soDigitos(t.id) ?? soDigitos(objeto(t.context)?.wa_id);
  const telefones = threads.map(waIdDa).filter((w): w is string => w !== null).map((w) => `+${w}`);
  const apagados = await perguntarTitularesApagadosNoLote(admin, alvo.organizationId, telefones);
  // Falha fechada: sem a resposta, nada do lote entra (o event_log refaz).
  if (apagados.erro) throw new Error(`titular_apagado: ${apagados.erro}`);

  for (const thread of threads) {
    const mensagens = (Array.isArray(thread.messages) ? thread.messages : [])
      .map(objeto)
      .filter((m): m is Record<string, unknown> => m !== null);
    const waId = waIdDa(thread);
    // Cliente só com nome de usuário, sem telefone: sem chave de contato.
    if (!waId) {
      conta.ignoradas += mensagens.length;
      continue;
    }
    const telefone = `+${waId}`;
    if (apagados.apagados.has(canonicalPhoneBR(telefone))) {
      conta.ignoradas += mensagens.length;
      continue;
    }
    if (await ehNumeroInternoDeAviso(admin, alvo.organizationId, { kind: "phone", phone: telefone, lid: null })) {
      conta.ignoradas += mensagens.length;
      continue;
    }
    const existente = await encontrarContatoPorTelefoneComAnonimizacao(admin, alvo.organizationId, waId);
    if (existente?.is_anonymized) {
      conta.ignoradas += mensagens.length;
      continue;
    }

    // Mapeia ANTES de criar contato e conversa: thread só com o que não é
    // conversa (reação, edição) não cria ficha nenhuma.
    const previa = mensagens.map((m) =>
      mapearMensagemDoHistorico(m, {
        organizationId: alvo.organizationId,
        channelSessionId: alvo.channelSessionId,
        contactId: "",
        conversationId: "",
        loteId: alvo.loteId,
        numeroDaEmpresa,
        waIdDoCliente: waId,
        recebidoEm: alvo.recebidoEm,
      }),
    );
    const validas = previa.filter((l): l is LinhaDoHistoricoDaMeta => l !== null);
    conta.ignoradas += previa.length - validas.length;
    if (validas.length === 0) continue;

    const phone = existente?.phone_number ? canonicalPhoneBR(existente.phone_number) : canonicalPhoneBR(telefone);
    const contactId = (await rpc(admin, "fn_upsert_wa_contact", {
      p_org: alvo.organizationId,
      p_kind: "phone",
      p_phone: phone,
      p_lid: null,
      p_chat_id: waId,
      p_notify: null,
    })) as string | null;
    if (!contactId) throw new Error("fn_upsert_wa_contact: sem id");

    const { data: conversaAntes, error: erroDaConversa } = await admin
      .from("conversations")
      .select("id")
      .eq("organization_id", alvo.organizationId)
      .eq("contact_id", contactId)
      .eq("channel_session_id", alvo.channelSessionId)
      .eq("is_group", false)
      .limit(1);
    if (erroDaConversa) throw new Error(`conversa: ${erroDaConversa.message}`);
    const ultima = validas.reduce((max, l) => (l.sent_at > max ? l.sent_at : max), validas[0]!.sent_at);
    const conversationId = (await rpc(admin, "fn_upsert_wa_conversation_importada", {
      p_org: alvo.organizationId,
      p_contact: contactId,
      p_session: alvo.channelSessionId,
      p_last_message_at: ultima,
    })) as string | null;
    if (!conversationId) throw new Error("fn_upsert_wa_conversation_importada: sem id");
    if (((conversaAntes ?? []) as unknown[]).length === 0) conta.conversas += 1;

    const linhas = validas.map((l) => ({ ...l, contact_id: contactId, conversation_id: conversationId }));
    await inserirMensagens(admin, alvo, linhas, conta);
  }
  return conta;
}

/**
 * Consulta antes e insere o resto em lote. A unique `(organization_id,
 * external_id)` é DEFERRABLE e não serve para `on conflict`: um 23505 no lote
 * (corrida com o ao vivo) recusa o lote inteiro, e aí cada linha vai sozinha
 * (o mesmo caminho de `rodada.ts`).
 */
async function inserirMensagens(
  admin: Admin,
  alvo: Alvo,
  linhas: LinhaDoHistoricoDaMeta[],
  conta: ContagemDoLote,
): Promise<void> {
  const ids = [...new Set(linhas.map((l) => l.external_id))];
  const { data: achadas, error } = await buscaEmLotes(ids, (lote) =>
    admin
      .from("messages")
      .select("external_id, metadata")
      .eq("organization_id", alvo.organizationId)
      .in("external_id", lote),
  );
  if (error) throw new Error(`messages_consulta: ${error.message}`);
  const ja = new Map(
    ((achadas ?? []) as Array<{ external_id: string; metadata: Record<string, unknown> | null }>).map((m) => [
      m.external_id,
      m.metadata?.coexistencia_lote_id === alvo.loteId,
    ]),
  );

  const novas: LinhaDoHistoricoDaMeta[] = [];
  const vistas = new Set<string>();
  for (const l of linhas) {
    if (ja.has(l.external_id)) {
      // Deste lote, numa tentativa anterior: é dele. De outro caminho: existente.
      if (ja.get(l.external_id)) conta.mensagens += 1;
      else conta.existentes += 1;
      continue;
    }
    if (vistas.has(l.external_id)) {
      conta.existentes += 1;
      continue;
    }
    vistas.add(l.external_id);
    novas.push(l);
  }
  if (novas.length === 0) return;

  const { data: inseridas, error: erroDoLote } = await admin
    .from("messages")
    .insert(novas as never)
    .select("id, conversation_id, metadata");
  let gravadas = (inseridas ?? []) as Array<{ id: string; conversation_id: string; metadata: Record<string, unknown> | null }>;
  if (erroDoLote) {
    if ((erroDoLote as { code?: string }).code !== "23505") throw new Error(`messages_insert: ${erroDoLote.message}`);
    gravadas = [];
    for (const l of novas) {
      const { data: uma, error: erroDeUma } = await admin
        .from("messages")
        .insert(l as never)
        .select("id, conversation_id, metadata");
      if (!erroDeUma) gravadas.push(...((uma ?? []) as typeof gravadas));
      else if ((erroDeUma as { code?: string }).code === "23505") conta.existentes += 1;
      else throw new Error(`messages_insert: ${erroDeUma.message}`);
    }
  }
  conta.mensagens += gravadas.length;

  // A mídia que veio com id (o lote costuma trazer só o marcador): o worker de
  // mídia guarda o arquivo e, pela chave do histórico, não deriva.
  for (const m of gravadas) {
    if (!m.metadata?.meta_media_id) continue;
    await pedirArquivo(admin, alvo.organizationId, m.id, m.conversation_id);
    conta.midias += 1;
  }
}

async function pedirArquivo(admin: Admin, organizationId: string, messageId: string, conversationId: string) {
  await rpc(admin, "emit_event", {
    p_event_type: "media.persist_requested",
    p_entity_kind: "message",
    p_entity_id: messageId,
    p_payload: { message_id: messageId, conversation_id: conversationId },
    p_metadata: { source: "meta_coexistencia_historico" },
    p_organization_id: organizationId,
  });
}

/**
 * O arquivo de uma mensagem que veio como `media_placeholder`. Só liga a
 * mensagem do histórico (com a chave) que ainda é marcador: a mensagem ao vivo
 * não é tocada, e a reentrega encontra a linha já ligada. Devolve quantas
 * mídias ligou (0 ou 1), ou `sem_alvo` quando a mensagem ainda não chegou.
 */
async function ligarMidia(
  admin: Admin,
  alvo: Alvo,
  mensagem: Record<string, unknown>,
): Promise<number | "sem_alvo"> {
  const externalId = typeof mensagem.id === "string" ? mensagem.id : null;
  if (!externalId) return 0;
  const { data, error } = await admin
    .from("messages")
    .select("id, conversation_id, contact_id, metadata")
    .eq("organization_id", alvo.organizationId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw new Error(`midia_alvo: ${error.message}`);
  const linha = data as {
    id: string;
    conversation_id: string;
    contact_id: string;
    metadata: Record<string, unknown> | null;
  } | null;
  if (!linha) return "sem_alvo";
  const meta = linha.metadata ?? {};
  if (meta.historico_importado !== "true" || meta.meta_media_placeholder !== "true") return 0;

  const mapeada = mapearMensagemDoHistorico(mensagem, {
    organizationId: alvo.organizationId,
    channelSessionId: alvo.channelSessionId,
    contactId: linha.contact_id,
    conversationId: linha.conversation_id,
    loteId: String(meta.coexistencia_lote_id ?? alvo.loteId),
    numeroDaEmpresa: null,
    waIdDoCliente: "",
    recebidoEm: alvo.recebidoEm,
  });
  if (!mapeada || !mapeada.metadata.meta_media_id) return 0;

  const { meta_media_placeholder: _marcador, media_status: _status, ...resto } = meta;
  const { data: ligada, error: erroDaLigacao } = await admin
    .from("messages")
    .update({
      type: mapeada.type,
      body: mapeada.body,
      media_url: mapeada.media_url,
      media_mime: mapeada.media_mime,
      metadata: {
        ...resto,
        meta_media_id: mapeada.metadata.meta_media_id,
        voice: mapeada.metadata.voice ?? false,
        ...(mapeada.metadata.media_filename ? { media_filename: mapeada.metadata.media_filename } : {}),
      },
    })
    .eq("id", linha.id)
    .eq("organization_id", alvo.organizationId)
    .select("id");
  if (erroDaLigacao) throw new Error(`midia_ligar: ${erroDaLigacao.message}`);
  if (((ligada ?? []) as unknown[]).length === 0) return 0;
  await pedirArquivo(admin, alvo.organizationId, linha.id, linha.conversation_id);
  return 1;
}

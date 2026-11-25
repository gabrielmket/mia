/**
 * FORK MIA · coexistência (S3): o AVISO de que a sincronização não deu certo.
 *
 * A Meta aceita o pedido dos contatos e do histórico UMA vez só por conexão.
 * Quando ele falha, fica sem resposta ou perde o prazo, a MIA não pede de novo
 * sozinha (`sincronizacao.ts`): quem decide é uma pessoa. O aviso é o que faz
 * essa pessoa saber.
 *
 * - Na Central da empresa: `kind = 'other'` apontando para a conexão
 *   (`ref_kind = 'channel_session'`, que já leva a Conexões), um aviso aberto
 *   por número e por tipo de pedido. Fecha por decisão de quem lê: é a regra
 *   do `other` (`lib/inbox-do-agente/como-cada-aviso-fecha.ts`).
 * - Para o suporte da plataforma: `logger.error` com o id do pedido e o código
 *   da Meta, que é o que entra no alerta de erro da instalação.
 *
 * Sem nome, telefone ou trecho de conversa: só o que a Meta disse (código e
 * título) e o que fazer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoAviso, preencher } from "@/lib/i18n/idioma-do-aviso";
import { logger } from "@/lib/logger";

import { motivoDaSaidaEmPalavras } from "./motivo";

type Admin = SupabaseClient;

export type EstadoQueAvisa = "falhou" | "sem_resposta" | "prazo_vencido";
export type TipoDoPedido = "contatos" | "historico";

export interface AvisoDaSincronizacao {
  organizationId: string;
  channelSessionId: string;
  sincronizacaoId: string;
  tipo: TipoDoPedido;
  estado: EstadoQueAvisa;
  erroCodigo?: string | null;
  erroTitulo?: string | null;
}

function textos(a: AvisoDaSincronizacao, idioma: Parameters<typeof traduzir>[1]): { title: string; body: string } {
  const t = (texto: string) => traduzir(texto, idioma);
  // Um literal por ramo: a cerca de i18n só cobra o espanhol do que lê escrito.
  const title =
    a.tipo === "contatos"
      ? t("Os contatos do app WhatsApp Business não vieram")
      : t("O histórico do app WhatsApp Business não veio");
  const motivo =
    a.estado === "falhou"
      ? preencher(t("A Meta recusou o pedido (código {codigo}: {titulo})."), {
          codigo: a.erroCodigo ?? "?",
          titulo: a.erroTitulo ?? t("sem título"),
        })
      : a.estado === "sem_resposta"
        ? t("A MIA pediu, mas não recebeu a resposta da Meta. Não dá para saber se a Meta aceitou. Se o histórico começar a chegar, a tela passa para em andamento sozinha.")
        : t("Passaram as 24 horas que a Meta dá para pedir a sincronização depois da conexão.");
  const body = `${motivo} ${t(
    "A MIA não pede de novo sozinha: a Meta só aceita este pedido uma vez. Para tentar de novo, o número precisa ser desconectado no app e conectado outra vez pelo botão Conectar pelo app WhatsApp Business. As mensagens novas chegam normalmente.",
  )}`;
  return { title, body };
}

/** Abre (ou atualiza) o aviso. Nunca lança: falhar aqui não pode mudar o desfecho do pedido. */
export async function avisarSincronizacaoQueNaoVeio(admin: Admin, aviso: AvisoDaSincronizacao): Promise<void> {
  logger.error("[meta.coexistencia] sincronização do app sem sucesso", {
    organization_id: aviso.organizationId,
    sincronizacao_id: aviso.sincronizacaoId,
    tipo: aviso.tipo,
    estado: aviso.estado,
    erro_codigo: aviso.erroCodigo ?? null,
  });
  try {
    const idioma = await idiomaDoAviso(admin, aviso.organizationId);
    const valores = textos(aviso, idioma);
    const { data, error: leitura } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", aviso.organizationId)
      .eq("kind", "other")
      .eq("ref_kind", "channel_session")
      .eq("ref_id", aviso.channelSessionId)
      .eq("title", valores.title)
      .eq("status", "open")
      .limit(1);
    if (leitura) throw leitura;
    const aberto = ((data ?? []) as Array<{ id: string }>)[0];
    const { error } = aberto
      ? await admin
          .from("agent_inbox_items")
          .update({ body: valores.body })
          .eq("organization_id", aviso.organizationId)
          .eq("id", aberto.id)
      : await admin.from("agent_inbox_items").insert({
          ...valores,
          organization_id: aviso.organizationId,
          kind: "other",
          severity: aviso.estado === "prazo_vencido" ? "warn" : "critical",
          ref_kind: "channel_session",
          ref_id: aviso.channelSessionId,
          status: "open",
        });
    if (error && error.code !== "23505") throw error;
  } catch (err) {
    logger.error("[meta.coexistencia] aviso da sincronização não gravado", {
      organization_id: aviso.organizationId,
      sincronizacao_id: aviso.sincronizacaoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── S4: o número que sai da coexistência e o que volta ──────────────────────
//
// O mesmo jeito do aviso da sincronização: `kind = 'other'` apontando para a
// conexão (`ref_kind = 'channel_session'`), UM aberto por número e por título.
// O mesmo evento de novo atualiza o texto do aviso aberto e não cria outro. Na
// volta, o de fora do ar é RESOLVIDO e entra o de "voltou"; na saída seguinte,
// o "voltou" que ainda estiver aberto é resolvido. Sem nome de contato e sem
// trecho de conversa: o número que aparece é o da EMPRESA.

type Idioma = Parameters<typeof traduzir>[1];

function tituloForaDoAr(numero: string, idioma: Idioma): string {
  return preencher(traduzir("{numero} fora do ar", idioma), { numero });
}

function tituloVoltou(numero: string, idioma: Idioma): string {
  return preencher(traduzir("{numero} voltou", idioma), { numero });
}

async function numeroDaSessao(admin: Admin, organizationId: string, channelSessionId: string, idioma: Idioma): Promise<string> {
  const { data } = await admin
    .from("channel_sessions")
    .select("phone_number")
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .limit(1);
  const numero = ((data ?? []) as Array<{ phone_number: string | null }>)[0]?.phone_number;
  return numero ?? traduzir("O número do app WhatsApp Business", idioma);
}

async function abrirOuAtualizar(
  admin: Admin,
  organizationId: string,
  channelSessionId: string,
  aviso: { title: string; body: string; severity: "info" | "warn" | "critical" },
): Promise<void> {
  const { data, error: leitura } = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("kind", "other")
    .eq("ref_kind", "channel_session")
    .eq("ref_id", channelSessionId)
    .eq("title", aviso.title)
    .eq("status", "open")
    .limit(1);
  if (leitura) throw leitura;
  const aberto = ((data ?? []) as Array<{ id: string }>)[0];
  const { error } = aberto
    ? await admin
        .from("agent_inbox_items")
        .update({ body: aviso.body })
        .eq("organization_id", organizationId)
        .eq("id", aberto.id)
    : await admin.from("agent_inbox_items").insert({
        ...aviso,
        organization_id: organizationId,
        kind: "other",
        ref_kind: "channel_session",
        ref_id: channelSessionId,
        status: "open",
      });
  if (error && error.code !== "23505") throw error;
}

async function resolver(admin: Admin, organizationId: string, channelSessionId: string, title: string): Promise<void> {
  const { error } = await admin
    .from("agent_inbox_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("kind", "other")
    .eq("ref_kind", "channel_session")
    .eq("ref_id", channelSessionId)
    .eq("title", title)
    .eq("status", "open");
  if (error) throw error;
}

export interface AvisoDaSaida {
  organizationId: string;
  channelSessionId: string;
  conexaoId: string;
  motivo: string;
  foraDoArEm: string;
  requestId: string;
}

/** Abre (ou atualiza) o aviso de número fora do ar. Nunca lança. */
export async function avisarNumeroForaDoAr(admin: Admin, aviso: AvisoDaSaida): Promise<void> {
  logger.warn("[meta.coexistencia] número fora do ar", {
    request_id: aviso.requestId,
    organization_id: aviso.organizationId,
    conexao_id: aviso.conexaoId,
    motivo: aviso.motivo,
  });
  try {
    const idioma = await idiomaDoAviso(admin, aviso.organizationId);
    const t = (texto: string) => traduzir(texto, idioma);
    const numero = await numeroDaSessao(admin, aviso.organizationId, aviso.channelSessionId, idioma);
    const body = [
      `${t("O número saiu da API. Motivo informado pela Meta:")} ${motivoDaSaidaEmPalavras(aviso.motivo, t)}`,
      t("Enquanto isso, nada sai pela MIA por este número: IA, equipe, disparos e lembretes param. O app no celular continua funcionando."),
      t("Para voltar: abra o app no celular e conecte de novo em Conexões, por Conectar pelo app WhatsApp Business. Contatos, conversas e cartões continuam os mesmos."),
    ].join(" ");
    await resolver(admin, aviso.organizationId, aviso.channelSessionId, tituloVoltou(numero, idioma));
    await abrirOuAtualizar(admin, aviso.organizationId, aviso.channelSessionId, {
      title: tituloForaDoAr(numero, idioma),
      body,
      severity: "critical",
    });
  } catch (err) {
    logger.error("[meta.coexistencia] aviso de número fora do ar não gravado", {
      request_id: aviso.requestId,
      organization_id: aviso.organizationId,
      conexao_id: aviso.conexaoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AvisoDaVolta {
  organizationId: string;
  channelSessionId: string;
  conexaoId: string;
  voltouEm: string;
  requestId: string;
}

/** Resolve o aviso de fora do ar e abre o de "voltou". Nunca lança. */
export async function avisarNumeroVoltou(admin: Admin, aviso: AvisoDaVolta): Promise<void> {
  logger.info("[meta.coexistencia] número de volta", {
    request_id: aviso.requestId,
    organization_id: aviso.organizationId,
    conexao_id: aviso.conexaoId,
  });
  try {
    const idioma = await idiomaDoAviso(admin, aviso.organizationId);
    const numero = await numeroDaSessao(admin, aviso.organizationId, aviso.channelSessionId, idioma);
    await resolver(admin, aviso.organizationId, aviso.channelSessionId, tituloForaDoAr(numero, idioma));
    await abrirOuAtualizar(admin, aviso.organizationId, aviso.channelSessionId, {
      title: tituloVoltou(numero, idioma),
      body: traduzir(
        "O número está de novo na MIA. O aviso de fora do ar foi encerrado. Contatos, conversas e cartões são os mesmos de antes: nada foi duplicado.",
        idioma,
      ),
      severity: "info",
    });
  } catch (err) {
    logger.error("[meta.coexistencia] aviso de número de volta não gravado", {
      request_id: aviso.requestId,
      organization_id: aviso.organizationId,
      conexao_id: aviso.conexaoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * A passagem nova pela janela (`conectar.ts`) também é uma volta: o aviso de
 * fora do ar da mesma sessão é resolvido. Nunca lança.
 */
export async function encerrarAvisoDeForaDoAr(
  admin: Admin,
  organizationId: string,
  channelSessionId: string,
): Promise<void> {
  try {
    const idioma = await idiomaDoAviso(admin, organizationId);
    const numero = await numeroDaSessao(admin, organizationId, channelSessionId, idioma);
    await resolver(admin, organizationId, channelSessionId, tituloForaDoAr(numero, idioma));
  } catch (err) {
    logger.error("[meta.coexistencia] aviso de fora do ar não encerrado na conexão nova", {
      organization_id: organizationId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

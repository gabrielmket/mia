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

/**
 * Ação `notify_group` — o aviso que vai para o TIME, não para o lead.
 *
 * Toda ação de mensagem que existia aqui fala com o contato do evento: elas
 * atravessam consentimento, janela de 24h, limite diário e espaçamento, porque
 * do outro lado há um cliente que pode marcar como spam. Este aviso é outra
 * coisa — é o recado interno de "marcaram reunião com fulano", no grupo em que
 * o time comercial já trabalha. Tratá-lo com a régua do contato o faria ser
 * adiado para a manhã seguinte por causa de uma janela que não é dele; tratá-lo
 * como mensagem de cliente o faria contar contra o limite diário do número.
 *
 * O que ele NÃO faz, de propósito:
 *  - não abre conversa nem grava mensagem no inbox. O grupo do time não é
 *    atendimento; virar thread no inbox encheria a fila de quem atende cliente.
 *
 * ─── Dois caminhos para o destino, e por que os dois existem ───────────────
 *
 * PADRÃO (config sem canal/grupo): o número é o da PLATAFORMA e o grupo é o
 * que o operador escolheu para ESTE cliente no painel administrativo. É o
 * caminho que a implantação usa: quem monta a régua só liga a chave, sem
 * precisar saber que existe um `120363…@g.us` no mundo.
 *
 * EXPLÍCITO (config com `channel_session_id` + `chat_id`): o canal é da própria
 * organização e o id foi digitado. Continua valendo porque regras salvas antes
 * desta mudança têm os dois campos preenchidos — e porque um cliente com número
 * próprio no grupo dele é um caso legítimo, só não é mais o caminho comum.
 * Trocar o caminho explícito pelo padrão calado mudaria para onde vai um aviso
 * que já estava no ar, que é a categoria de mudança que ninguém percebe até
 * chegar no grupo errado.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { renderTemplate } from "@/lib/automation/template";
import { destinoDoAviso, pareceGrupo } from "@/lib/avisos/destino-do-aviso";
import { entregaEmGrupo, getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";

const TIPO = "notify_group";

type Destino = { sessao: ChannelSessionRef; chatId: string } | { erro: string };

/** O caminho EXPLÍCITO: canal da própria org, id digitado pelo operador. */
async function destinoConfigurado(
  ctx: ActionCtx,
  sessionId: string,
  chatId: string,
): Promise<Destino> {
  if (!pareceGrupo(chatId)) return { erro: "destino_nao_e_grupo" };

  // O filtro por organização é explícito: o client é admin e a RLS não vale.
  const { data: sessao, error } = await ctx.admin
    .from("channel_sessions")
    .select(CHANNEL_SESSION_REF_COLUMNS)
    .eq("id", sessionId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) return { erro: error.message };
  if (!sessao) return { erro: "canal_nao_encontrado" };

  const ref = sessao as unknown as ChannelSessionRef;
  // Pergunta a CAPACIDADE (`groups: "full"`), nunca o nome do canal: deixar o
  // adapter falhar lá embaixo devolveria um erro de HTTP no lugar da frase que
  // explica por que este canal não serve.
  if (!entregaEmGrupo(ref.provider)) return { erro: "canal_sem_grupo" };

  return { sessao: ref, chatId: chatId.trim() };
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const chatIdConfig = typeof config.chat_id === "string" ? config.chat_id.trim() : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!template) return { type: TIPO, status: "failed", error: "missing_config" };

  const destino =
    sessionId && chatIdConfig
      ? await destinoConfigurado(ctx, sessionId, chatIdConfig)
      : await (async (): Promise<Destino> => {
          const d = await destinoDoAviso(ctx.admin, ctx.organizationId);
          // O motivo VIRA o erro da ação: é o que aparece na linha da régua
          // quando alguém for entender por que o time não recebeu. "sem grupo
          // neste cliente" manda a pessoa certa para a tela certa; um
          // "missing_config" genérico manda todo mundo reler a regra.
          return d.ok ? { sessao: d.sessao, chatId: d.chatId } : { erro: d.motivo };
        })();

  if ("erro" in destino) return { type: TIPO, status: "failed", error: destino.erro };

  try {
    const { externalId } = await getAdapter(destino.sessao.provider).send({
      organizationId: ctx.organizationId,
      sessionRef: resolveSessionRef(destino.sessao),
      to: destino.chatId,
      kind: "text",
      body: renderTemplate(template, ctx.context),
    });
    return {
      type: TIPO,
      status: "success",
      detail: { chat_id: destino.chatId, external_id: externalId },
    };
  } catch (err) {
    return {
      type: TIPO,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerAction({ type: TIPO, execute });

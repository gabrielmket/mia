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
 * O que ele FAZ desde a .57 (`lib/avisos/registro-do-aviso.ts`):
 *  - põe a FICHA mais recente do contato ao alcance do texto — `{{nota.headline}}`
 *    e `{{nota.body}}` —, só aqui, nunca na mensagem ao cliente;
 *  - registra no HISTÓRICO do negócio o que foi mandado e quando, e também
 *    quando NÃO saiu, com o porquê. Antes, a única evidência era a linha da
 *    regra na aba Atividade, que quem cuida do cliente não abre.
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
import type {
  ProblemaDoNumeroDaEmpresa,
  SituacaoDaReserva,
  ViaDoAviso,
} from "@/lib/avisos/origem-do-aviso";
import {
  fichaMaisRecente,
  negocioDoAviso,
  registrarAvisoNoHistorico,
  type AvisoParaRegistrar,
} from "@/lib/avisos/registro-do-aviso";
import { entregaEmGrupo, getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";

const TIPO = "notify_group";

/**
 * `via`/`desvio`/`reserva` só existem no caminho PADRÃO — é ali que a empresa
 * pode ter escolhido um número dela no lugar do da plataforma (FORK MIA .62,
 * `lib/avisos/origem-do-aviso.ts`). O caminho explícito escolhe o canal à mão.
 */
type Destino =
  | {
      sessao: ChannelSessionRef;
      chatId: string;
      nomeDoGrupo?: string;
      via?: ViaDoAviso;
      desvio?: ProblemaDoNumeroDaEmpresa | null;
    }
  | { erro: string; reserva?: SituacaoDaReserva };

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

/**
 * Registra o desfecho no histórico do negócio e devolve o resultado da ação com
 * o que aconteceu com o registro — "sem_negocio" também é resposta, e fica
 * visível na linha da regra.
 */
async function comHistorico(
  ctx: ActionCtx,
  resultado: ActionResultDetail,
  aviso: Omit<AvisoParaRegistrar, "organizationId" | "leadId" | "contactId" | "ruleId" | "ruleName">,
): Promise<ActionResultDetail> {
  const negocio = await negocioDoAviso(ctx.admin, ctx.organizationId, ctx.context).catch(() => ({
    leadId: null,
    motivo: "leitura_falhou",
  }));
  let historico: string;
  if (negocio.leadId === null) {
    historico = `sem_negocio:${"motivo" in negocio ? negocio.motivo : "desconhecido"}`;
  } else {
    const gravou = await registrarAvisoNoHistorico(ctx.admin, {
      ...aviso,
      organizationId: ctx.organizationId,
      leadId: negocio.leadId,
      contactId: negocio.contactId,
      ruleId: ctx.ruleId,
      ruleName: ctx.ruleName,
    });
    historico = gravou ? "registrado" : "falhou";
  }
  return { ...resultado, detail: { ...(resultado.detail ?? {}), historico, ficha: aviso.ficha } };
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const chatIdConfig = typeof config.chat_id === "string" ? config.chat_id.trim() : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!template) {
    return comHistorico(
      ctx,
      { type: TIPO, status: "failed", error: "missing_config" },
      { grupo: null, texto: null, ok: false, erro: "missing_config", ficha: "nao_pedida" },
    );
  }

  // A FICHA só é lida quando o texto a pede: é uma consulta a mais, e a maioria
  // dos avisos (reunião marcada) não a usa.
  const pedeFicha = /\{\{\s*nota\./.test(template);
  const contatoId =
    (ctx.context.lead as { contact_id?: string | null } | undefined)?.contact_id ??
    (ctx.context.contact as { id?: string } | undefined)?.id ??
    null;
  const ficha = pedeFicha ? await fichaMaisRecente(ctx.admin, ctx.organizationId, contatoId) : null;
  const estadoDaFicha = !pedeFicha ? "nao_pedida" : ficha ? "usada" : "ausente";
  const texto = renderTemplate(template, { ...ctx.context, nota: ficha ?? { headline: "", body: "" } });

  const destino =
    sessionId && chatIdConfig
      ? await destinoConfigurado(ctx, sessionId, chatIdConfig)
      : await (async (): Promise<Destino> => {
          const d = await destinoDoAviso(ctx.admin, ctx.organizationId);
          // O motivo VIRA o erro da ação: é o que aparece na linha da régua
          // quando alguém for entender por que o time não recebeu. "sem grupo
          // neste cliente" manda a pessoa certa para a tela certa; um
          // "missing_config" genérico manda todo mundo reler a regra.
          return d.ok
            ? { sessao: d.sessao, chatId: d.chatId, nomeDoGrupo: d.nomeDoGrupo, via: d.via, desvio: d.desvio }
            : { erro: d.motivo, reserva: d.reserva };
        })();

  if ("erro" in destino) {
    return comHistorico(
      ctx,
      {
        type: TIPO,
        status: "failed",
        error: destino.erro,
        ...(destino.reserva ? { detail: { reserva: destino.reserva } } : {}),
      },
      { grupo: null, texto, ok: false, erro: destino.erro, ficha: estadoDaFicha, reserva: destino.reserva ?? null },
    );
  }
  const grupo = destino.nomeDoGrupo ?? destino.chatId;
  // O desvio para a reserva vai para a linha da regra E para o histórico — o
  // aviso saiu, mas por outro número, e quem cuida do cliente precisa saber que
  // o número da empresa caiu.
  const rota = destino.via ? { via: destino.via, desvio: destino.desvio ?? null } : {};

  try {
    const { externalId } = await getAdapter(destino.sessao.provider).send({
      organizationId: ctx.organizationId,
      sessionRef: resolveSessionRef(destino.sessao),
      to: destino.chatId,
      kind: "text",
      body: texto,
    });
    return comHistorico(
      ctx,
      { type: TIPO, status: "success", detail: { chat_id: destino.chatId, external_id: externalId, ...rota } },
      { grupo, texto, ok: true, externalId, ficha: estadoDaFicha, ...rota },
    );
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    return comHistorico(
      ctx,
      { type: TIPO, status: "failed", error: erro, ...(destino.via ? { detail: rota } : {}) },
      { grupo, texto, ok: false, erro: "envio_falhou", ficha: estadoDaFicha, ...rota },
    );
  }
}

registerAction({ type: TIPO, execute });

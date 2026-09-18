/**
 * O AVISO NO GRUPO QUANDO A IA PASSA O BASTÃO.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * A passagem de bastão já acendia um item na Central e devolvia a conversa à
 * fila. Isso serve a quem ESTÁ com a tela aberta. O time comercial do cliente
 * não está: ele trabalha no grupo do WhatsApp, e é lá que um lead qualificado
 * precisa aparecer para alguém pegar no mesmo minuto. Sem este arquivo, o
 * produto tinha a metade que registra e não a que chama.
 *
 * ─── Onde ele é chamado, e por que nos DOIS motores ────────────────────────
 *
 * Existem dois caminhos de passagem — `performHumanHandoff` (o motor, sobre
 * `pg`) e `triggerHandoff` (o do CRM, sobre Supabase) — e os dois abrem o MESMO
 * item de Central, com a MESMA chave de dedup. O aviso sai colado nesse item,
 * e só quando ele é RECÉM-ABERTO: assim os dois motores deduplicam um contra o
 * outro de graça, e uma conversa escalada duas vezes não rende dois avisos no
 * grupo. Ligar num caminho só deixaria metade das passagens mudas — e seria
 * justamente a metade que ninguém repara faltando.
 *
 * ─── O que ele NUNCA faz ───────────────────────────────────────────────────
 *
 * Não lança. Uma falha aqui não pode derrubar a passagem de bastão: sem o
 * aviso, o time perde tempo; sem a passagem, o cliente fica com a IA calada e
 * ninguém assume. A ordem de prioridade entre os dois é essa, e é por isso que
 * todo caminho abaixo termina em `false` em vez de exceção.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { entregaEmGrupo, getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { destinoDoAviso, lerGrupoDeAvisos, type GrupoDeAvisos } from "./destino-do-aviso";

export interface DadosDaPassagem {
  organizationId: string;
  conversationId: string | null;
  nome: string | null;
  telefone: string | null;
  motivo: string;
  /** O que a IA apurou. Ausente no caminho do CRM, que não resume. */
  resumo?: string | null;
}

/** Quanto do resumo cabe num recado de grupo antes de virar parede de texto. */
const TETO_DO_RESUMO = 600;

/**
 * O motivo em português, para quem VENDE ler.
 *
 * As chaves são as de `HandoffReason` (`lib/ai/handoff/orchestrator.ts`) — o
 * vocabulário interno do motor. Mandá-lo cru para o grupo faria o time comercial
 * receber "low_sentiment" e ter de adivinhar; e adivinhar duas vezes é o que
 * ensina alguém a ignorar o aviso.
 *
 * Texto desconhecido passa INTEIRO de propósito: o motor também aceita motivo
 * escrito à mão por quem escalou ("cliente quer falar de contrato"), e essa
 * frase é melhor que qualquer rótulo que este mapa inventasse.
 */
const MOTIVO_EM_PORTUGUES: Record<string, string> = {
  requested_human: "o cliente pediu para falar com uma pessoa",
  low_sentiment: "o cliente demonstrou insatisfação",
  low_confidence: "a IA não teve confiança para seguir",
  critical_stage: "etapa crítica do funil",
  legal_mention: "menção a assunto jurídico",
  refund_mention: "menção a reembolso",
  orcamento_de_ia: "o teto de gasto com IA foi atingido",
};

export function textoDaPassagem(d: DadosDaPassagem): string {
  const linhas = [
    "🔔 *A IA passou o bastão — assumir a conversa*",
    "",
    `*Quem:* ${d.nome?.trim() || "sem nome"}`,
  ];
  if (d.telefone) linhas.push(`*Telefone:* ${d.telefone}`);
  linhas.push(`*Motivo:* ${MOTIVO_EM_PORTUGUES[d.motivo] ?? d.motivo}`);

  const resumo = d.resumo?.trim();
  if (resumo) {
    linhas.push("", "*Resumo:*", resumo.length > TETO_DO_RESUMO ? `${resumo.slice(0, TETO_DO_RESUMO)}…` : resumo);
  }

  // O link fecha a distância entre ler o aviso e assumir a conversa. Sem ele o
  // atendente sabe que alguém está esperando e não sabe ONDE — e vai procurar
  // pelo nome numa lista, que é o atrito que faz o aviso ser ignorado.
  if (d.conversationId) {
    linhas.push("", `${env.NEXT_PUBLIC_APP_URL}/app/inbox/${d.conversationId}`);
  }
  return linhas.join("\n");
}

async function enviar(
  sessao: ChannelSessionRef,
  chatId: string,
  organizationId: string,
  texto: string,
): Promise<boolean> {
  try {
    await getAdapter(sessao.provider).send({
      organizationId,
      sessionRef: resolveSessionRef(sessao),
      to: chatId,
      kind: "text",
      body: texto,
    });
    return true;
  } catch (err) {
    logger.warn("[aviso-da-passagem] o grupo não recebeu", {
      organizationId,
      detail: err instanceof Error ? err.message : "erro",
    });
    return false;
  }
}

/**
 * Caminho SUPABASE (`triggerHandoff`). Lê o número da plataforma e o grupo
 * daquele cliente, e manda. `false` quando não havia para onde mandar — que é
 * o normal em cliente sem grupo configurado, e por isso não vira erro.
 */
export async function avisarGrupoDaPassagem(
  admin: SupabaseClient,
  dados: DadosDaPassagem,
): Promise<boolean> {
  try {
    const destino = await destinoDoAviso(admin, dados.organizationId);
    if (!destino.ok) return false;
    return await enviar(destino.sessao, destino.chatId, dados.organizationId, textoDaPassagem(dados));
  } catch (err) {
    logger.warn("[aviso-da-passagem] falhou antes de enviar", {
      organizationId: dados.organizationId,
      detail: err instanceof Error ? err.message : "erro",
    });
    return false;
  }
}

/** O mínimo de `pg` que este arquivo precisa — o motor não usa Supabase. */
interface ConsultaPg {
  query<T>(texto: string, valores: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Caminho PG (`performHumanHandoff`, dentro do motor).
 *
 * A leitura é escrita em SQL aqui, e não reaproveitada de `destinoDoAviso`,
 * porque os dois motores falam com o banco por bibliotecas diferentes. O que
 * NÃO se duplica é a regra: quem decide se o grupo vale (`@g.us`) e de onde ele
 * sai (`settings.grupo_de_avisos`) continua sendo `lerGrupoDeAvisos`.
 */
export async function avisarGrupoDaPassagemPg(
  db: ConsultaPg,
  dados: DadosDaPassagem,
): Promise<boolean> {
  try {
    const { rows: sessoes } = await db.query<ChannelSessionRef>(
      `select ${CHANNEL_SESSION_REF_COLUMNS}
         from channel_sessions
        where e_numero_de_avisos = true
        limit 1`,
      [],
    );
    const sessao = sessoes[0];
    if (!sessao) return false;

    if (!entregaEmGrupo(sessao.provider)) return false;

    const { rows: orgs } = await db.query<{ settings: unknown }>(
      `select settings from organizations where id = $1`,
      [dados.organizationId],
    );
    const grupo: GrupoDeAvisos | null = lerGrupoDeAvisos(orgs[0]?.settings);
    if (!grupo) return false;

    return await enviar(sessao, grupo.id, dados.organizationId, textoDaPassagem(dados));
  } catch (err) {
    logger.warn("[aviso-da-passagem] falhou antes de enviar (motor)", {
      organizationId: dados.organizationId,
      detail: err instanceof Error ? err.message : "erro",
    });
    return false;
  }
}

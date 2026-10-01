/**
 * As notificações de mudança da Graph: o acelerador da leitura do Outlook.
 *
 * O Google do upstream só lê por consulta periódica (a cada 15 min): um
 * compromisso pessoal marcado na agenda pode levar esse tempo para bloquear o
 * horário aqui, e nesse intervalo a IA pode oferecê-lo. Para o Outlook a consulta
 * continua sendo a REDE DE SEGURANÇA, e a notificação só marca o calendário para
 * ler AGORA (a rotina de 1 minuto lê). A notificação não traz dado nenhum, e a
 * documentação da Graph não promete latência para evento: por isso ela nunca é a
 * única via. É o desenho do tempo real dos Leads da Meta (.62).
 *
 * ─── O que a Graph exige, e onde está ───────────────────────────────────────
 *
 *  - uma assinatura por calendário (`me/calendars/{id}/events`), com validade de
 *    no máximo 10.080 min para evento do Outlook: renovada quando faltam 48 h;
 *  - ao criar, a Graph chama a URL com `validationToken` e espera a mesma string
 *    em `text/plain` (rota `notificacoes`);
 *  - `clientState` aleatório por assinatura, guardado só como hash, conferido em
 *    toda notificação: notificação que não confere é descartada;
 *  - `lifecycleNotificationUrl`: `reauthorizationRequired` (renova),
 *    `subscriptionRemoved` (recria) e `missed` (leitura completa).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logger } from "@/lib/logger";

import { enderecoDasNotificacoesMicrosoft } from "./config";
import { classificarErroDaMicrosoft, GraphHttpError } from "./erros";
import { graphTransport, type GraphFetch } from "./transport";

/** Menos que os 10.080 min que a Graph aceita para evento do Outlook: folga para o relógio. */
export const VALIDADE_DA_ASSINATURA_MIN = 10_000;
/** Renova quando falta menos que isto. */
export const RENOVAR_ANTES_MS = 48 * 60 * 60 * 1000;

export function hashDoSegredo(segredo: string): string {
  return createHash("sha256").update(segredo, "utf8").digest("hex");
}

function confere(recebido: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashDoSegredo(recebido), "utf8");
  const b = Buffer.from(hashGuardado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CalendarioComAssinatura {
  id: string;
  calendario_externo_id: string;
  disponivel: boolean;
  conta_como_ocupado: boolean;
  destino: boolean;
  assinatura_id: string | null;
  assinatura_expira_em: string | null;
}

export interface ResumoDasAssinaturas {
  criadas: number;
  renovadas: number;
  apagadas: number;
  falhas: number;
}

/**
 * Deixa as assinaturas de uma conexão como devem estar: uma por calendário que
 * ocupa ou recebe, válida por mais de 48 h; nenhuma nos outros.
 *
 * Endereço que não é HTTPS público (instalação local) não recebe notificação da
 * Graph: a tentativa falha, o motivo fica na tela, e a consulta segue lendo.
 */
export async function garantirAssinaturas(
  db: SupabaseClient,
  org: string,
  conexaoId: string,
  token: string,
  opcoes: { agora?: Date; transporte?: GraphFetch; origem?: string } = {},
): Promise<ResumoDasAssinaturas> {
  const agora = opcoes.agora ?? new Date();
  const resumo: ResumoDasAssinaturas = { criadas: 0, renovadas: 0, apagadas: 0, falhas: 0 };
  const { data, error } = await db
    .from("mia_agenda_microsoft_calendarios")
    .select("id, calendario_externo_id, disponivel, conta_como_ocupado, destino, assinatura_id, assinatura_expira_em")
    .eq("organization_id", org)
    .eq("conexao_id", conexaoId);
  if (error || !data) return resumo;

  const api = graphTransport(token, opcoes.transporte);
  const endereco = enderecoDasNotificacoesMicrosoft(opcoes.origem);
  const validade = new Date(agora.getTime() + VALIDADE_DA_ASSINATURA_MIN * 60_000).toISOString();

  for (const k of data as CalendarioComAssinatura[]) {
    const precisa = k.disponivel && (k.conta_como_ocupado || k.destino);
    try {
      if (!precisa) {
        if (k.assinatura_id) {
          await api.apagarAssinatura(k.assinatura_id);
          await db
            .from("mia_agenda_microsoft_calendarios")
            .update({ assinatura_id: null, assinatura_expira_em: null, assinatura_segredo_hash: null, assinatura_erro: null })
            .eq("organization_id", org)
            .eq("id", k.id);
          resumo.apagadas += 1;
        }
        continue;
      }
      const vence = k.assinatura_expira_em ? Date.parse(k.assinatura_expira_em) : 0;
      if (k.assinatura_id && vence - agora.getTime() > RENOVAR_ANTES_MS) continue;

      if (k.assinatura_id) {
        try {
          const renovada = await api.renovarAssinatura(k.assinatura_id, validade);
          await db
            .from("mia_agenda_microsoft_calendarios")
            .update({ assinatura_expira_em: renovada.expirationDateTime, assinatura_erro: null })
            .eq("organization_id", org)
            .eq("id", k.id);
          resumo.renovadas += 1;
          continue;
        } catch (e) {
          // Assinatura que a Graph já não conhece é recriada; o resto sobe.
          if (!(e instanceof GraphHttpError && (e.status === 404 || e.status === 410))) throw e;
        }
      }

      const segredo = randomBytes(24).toString("hex");
      const criada = await api.criarAssinatura({
        resource: `me/calendars/${k.calendario_externo_id}/events`,
        notificationUrl: endereco,
        lifecycleNotificationUrl: endereco,
        clientState: segredo,
        expirationDateTime: validade,
      });
      await db
        .from("mia_agenda_microsoft_calendarios")
        .update({
          assinatura_id: criada.id,
          assinatura_expira_em: criada.expirationDateTime,
          assinatura_segredo_hash: hashDoSegredo(segredo),
          assinatura_erro: null,
        })
        .eq("organization_id", org)
        .eq("id", k.id);
      resumo.criadas += 1;
    } catch (e) {
      resumo.falhas += 1;
      const motivo =
        e instanceof GraphHttpError
          ? classificarErroDaMicrosoft(e, "sincronizar").mensagem
          : "Não foi possível ligar o tempo real. A leitura periódica continua.";
      await db
        .from("mia_agenda_microsoft_calendarios")
        .update({ assinatura_erro: motivo.slice(0, 200) })
        .eq("organization_id", org)
        .eq("id", k.id);
    }
  }
  return resumo;
}

/** Apaga as assinaturas de uma conexão (desconectar). Nunca lança. */
export async function apagarAssinaturasDaConexao(
  db: SupabaseClient,
  org: string,
  conexaoId: string,
  token: string | null,
  transporte?: GraphFetch,
): Promise<void> {
  const { data } = await db
    .from("mia_agenda_microsoft_calendarios")
    .select("assinatura_id")
    .eq("organization_id", org)
    .eq("conexao_id", conexaoId)
    .not("assinatura_id", "is", null);
  if (!token) return;
  const api = graphTransport(token, transporte);
  for (const linha of (data ?? []) as Array<{ assinatura_id: string }>) {
    try {
      await api.apagarAssinatura(linha.assinatura_id);
    } catch (e) {
      logger.warn("[agenda.microsoft.notificacoes] assinatura não apagada", {
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

const notificacaoSchema = z
  .object({
    subscriptionId: z.string().min(1),
    clientState: z.string().nullable().optional(),
    lifecycleEvent: z.string().nullable().optional(),
    changeType: z.string().nullable().optional(),
  })
  .passthrough();

export const corpoDasNotificacoesSchema = z.object({ value: z.array(z.unknown()).max(1000) }).passthrough();

export interface ResumoDoRecebimento {
  aceitas: number;
  descartadas: number;
}

/**
 * Marca para ler agora os calendários que a Graph avisou. Só o que confere com
 * o segredo da assinatura conta; o resto é descartado sem erro (responder erro
 * faria a Graph insistir).
 */
export async function receberNotificacoes(db: SupabaseClient, corpo: unknown): Promise<ResumoDoRecebimento> {
  const resumo: ResumoDoRecebimento = { aceitas: 0, descartadas: 0 };
  const lido = corpoDasNotificacoesSchema.safeParse(corpo);
  if (!lido.success) return resumo;

  for (const bruto of lido.data.value) {
    const n = notificacaoSchema.safeParse(bruto);
    if (!n.success || !n.data.clientState) {
      resumo.descartadas += 1;
      continue;
    }
    const { data: k } = await db
      .from("mia_agenda_microsoft_calendarios")
      .select("id, organization_id, assinatura_segredo_hash")
      .eq("assinatura_id", n.data.subscriptionId)
      .maybeSingle();
    const linha = k as { id: string; organization_id: string; assinatura_segredo_hash: string | null } | null;
    if (!linha?.assinatura_segredo_hash || !confere(n.data.clientState, linha.assinatura_segredo_hash)) {
      resumo.descartadas += 1;
      continue;
    }
    const agora = new Date().toISOString();
    const evento = (n.data.lifecycleEvent ?? "").toLowerCase();
    const mudancas: Record<string, unknown> = { ultima_notificacao_em: agora, proxima_leitura_em: agora };
    if (evento === "reauthorizationrequired") mudancas.assinatura_expira_em = agora;
    if (evento === "subscriptionremoved") {
      mudancas.assinatura_id = null;
      mudancas.assinatura_expira_em = null;
      mudancas.assinatura_segredo_hash = null;
    }
    // Notificação perdida: a próxima leitura é completa.
    if (evento === "missed") mudancas.delta_link = null;
    await db
      .from("mia_agenda_microsoft_calendarios")
      .update(mudancas)
      .eq("organization_id", linha.organization_id)
      .eq("id", linha.id);
    resumo.aceitas += 1;
  }
  return resumo;
}

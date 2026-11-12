/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ NO TURNO DE MENSAGEM (docs/fork/trava-de-robo.md).
 *
 * Chamada pelo handler do `inbound_turn` (`createInboundTurnHandler`, em
 * `lib/agent-engine/agent/inbound-turn.ts`), DEPOIS das travas de sempre
 * (handoff e elegibilidade) e ANTES de escolher o agente: no turno que dispara,
 * nem o roteador nem o modelo são chamados, e nada sai para o contato.
 *
 * Fica de fora, por onde ela mora:
 *
 *   - a prévia e o sandbox ("Testar" do agente): passam por `runAgentPreview`,
 *     que não é este handler;
 *   - o grupo: `is_group` volta "segue" antes de qualquer leitura de mensagem;
 *   - as mensagens da equipe: não são resposta da IA (`sent_via = 'ai'`) e a
 *     mensagem do contato que vem depois delas não conta como giro.
 *
 * NUNCA cala por dúvida: erro de LEITURA (conversa, mensagens) devolve "segue",
 * com log, e o turno corre como antes. A configuração ilegível vale o padrão
 * (ligada). Erro no primeiro passo do EFEITO (calar o contato, pausar a
 * conversa) sobe: o job é refeito e a avaliação roda de novo.
 */
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

import { montarTracoDoTurno, registrarTracoDoTurno } from "@/lib/agent-engine/agent/traco-do-turno";
import { guardServiceEffect } from "@/lib/atendimento/fronteira-server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  aplicarTetoDeRespostas,
  aplicarTravaDeRobo,
  type DesfechoDaAplicacao,
  type LoggerDaTrava,
} from "./aplicar";
import { lerConfigDaTrava } from "./config";
import { avaliarTrava, type MensagemDaTrava } from "./deteccao";

/** O `abort_reason` do rastro do turno (tela de Execuções e assistente). */
export const MOTIVO_DO_RASTRO_DO_ROBO = "trava_de_robo";
export const MOTIVO_DO_RASTRO_DO_TETO = "teto_de_respostas_da_ia";

/** Quantas mensagens da conversa a avaliação lê, no máximo (as mais novas). */
export const LIMITE_DE_MENSAGENS_LIDAS = 800;

export type DesfechoDoTurno = "segue" | "robo" | "teto";

export interface AlvoDoTurno {
  organizationId: string;
  conversationId: string;
  contactId: string;
  jobId: string;
  inboundMessageId?: string | null;
}

export interface DepsDoTurno {
  admin?: SupabaseClient;
  agora?: () => Date;
  /** Rastro do turno; ausente usa `registrarTracoDoTurno` com o pool. */
  registrarRastro?: (motivo: string) => Promise<void>;
}

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message.slice(0, 200);
  if (erro && typeof erro === "object" && "message" in erro) return String((erro as { message: unknown }).message).slice(0, 200);
  return String(erro).slice(0, 200);
}

/**
 * A trava de robô e o teto de respostas, no começo do turno. `true` = o turno
 * acaba aqui (a trava ou o teto disparou e já agiu).
 */
export async function travaDeRoboNoTurno(
  pool: pg.Pool | null,
  alvo: AlvoDoTurno,
  log?: LoggerDaTrava,
  deps: DepsDoTurno = {},
): Promise<boolean> {
  return (await avaliarETravarNoTurno(pool, alvo, log, deps)) !== "segue";
}

export async function avaliarETravarNoTurno(
  pool: pg.Pool | null,
  alvo: AlvoDoTurno,
  log?: LoggerDaTrava,
  deps: DepsDoTurno = {},
): Promise<DesfechoDoTurno> {
  const agora = deps.agora ?? (() => new Date());
  let admin: SupabaseClient;
  let avaliacao: ReturnType<typeof avaliarTrava>;
  let statusDaConversa: string | null = null;
  try {
    admin = deps.admin ?? createAdminClient();

    const { data: conversa, error: erroDaConversa } = await admin
      .from("conversations")
      .select("id, contact_id, status, is_group")
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.conversationId)
      .maybeSingle();
    if (erroDaConversa) throw new Error(`conversa: ${erroDaConversa.message}`);
    const linha = conversa as { contact_id?: string | null; status?: string | null; is_group?: boolean | null } | null;
    // Grupo nunca entra; conversa de outro contato (o turno que perdeu a corrida de uma fusão) também não.
    if (!linha || linha.is_group === true || (linha.contact_id && linha.contact_id !== alvo.contactId)) return "segue";
    statusDaConversa = linha.status ?? null;

    const { config, lida, erro } = await lerConfigDaTrava(admin, alvo.organizationId);
    if (!lida) log?.warn("trava de robô: configuração ilegível, valendo o padrão", { error: erro });
    if (!config.ligada) return "segue";

    const minutosLidos = Math.max(config.repeticao_janela_minutos, config.teto_janela_minutos, config.janela_minutos);
    const desdeLeitura = new Date(agora().getTime() - minutosLidos * 60_000).toISOString();
    const { data: mensagens, error: erroDasMensagens } = await admin
      .from("messages")
      .select("id, direction, sent_via, type, body, created_at, metadata")
      .eq("organization_id", alvo.organizationId)
      .eq("conversation_id", alvo.conversationId)
      .gte("created_at", desdeLeitura)
      .order("created_at", { ascending: false })
      .limit(LIMITE_DE_MENSAGENS_LIDAS);
    if (erroDasMensagens) throw new Error(`mensagens: ${erroDasMensagens.message}`);

    // O último registro desta conversa: o que veio antes dele já foi contado.
    const { data: ultimo, error: erroDoUltimo } = await admin
      .from("mia_travas_de_robo")
      .select("created_at")
      .eq("organization_id", alvo.organizationId)
      .eq("conversation_id", alvo.conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroDoUltimo) log?.warn("trava de robô: o último registro não foi lido", { error: erroDoUltimo.message });
    const desde = (ultimo as { created_at?: string } | null)?.created_at ?? null;

    avaliacao = avaliarTrava({
      mensagens: (mensagens ?? []) as MensagemDaTrava[],
      config,
      agora: agora(),
      desde: desde ? new Date(desde) : null,
    });
  } catch (erro) {
    log?.warn("trava de robô: avaliação não rodou, o turno segue", {
      job_id: alvo.jobId,
      conversation_id: alvo.conversationId,
      error: mensagemDoErro(erro),
    });
    return "segue";
  }

  if (avaliacao.dispara === null) return "segue";

  const { data: org } = await admin.from("organizations").select("locale").eq("id", alvo.organizationId).maybeSingle();
  const idioma = normalizarIdioma((org as { locale?: string | null } | null)?.locale ?? null);
  const depsDaAplicacao = { admin, agora, requestId: `trava-de-robo:${alvo.jobId}`, log };
  const alvoDaAplicacao = {
    organizationId: alvo.organizationId,
    conversationId: alvo.conversationId,
    contactId: alvo.contactId,
    jobId: alvo.jobId,
    idioma,
  };

  // A fronteira do atendimento, como em todo efeito do motor: um job que já não é
  // o turno corrente não escreve sobre o atendimento de outro.
  await guardServiceEffect();
  let desfecho: DesfechoDaAplicacao;
  if (avaliacao.dispara === "robo") {
    desfecho = await aplicarTravaDeRobo(depsDaAplicacao, alvoDaAplicacao, avaliacao);
  } else {
    desfecho = await aplicarTetoDeRespostas(depsDaAplicacao, alvoDaAplicacao, avaliacao, { status: statusDaConversa });
  }

  const motivoDoRastro = avaliacao.dispara === "robo" ? MOTIVO_DO_RASTRO_DO_ROBO : MOTIVO_DO_RASTRO_DO_TETO;
  log?.info(
    avaliacao.dispara === "robo"
      ? "turno encerrado pela trava de robô: o outro lado é um robô"
      : "turno encerrado pelo teto de respostas da IA nesta conversa",
    {
      job_id: alvo.jobId,
      conversation_id: alvo.conversationId,
      motivo: motivoDoRastro,
      mensagens_de_robo: avaliacao.mensagens_de_robo,
      respostas_da_ia: avaliacao.respostas_da_ia,
      negocios_perdidos: desfecho.negocios.length,
      falhas: desfecho.falhas,
    },
  );
  await registrarRastroDoTurno(pool, alvo, motivoDoRastro, log, deps);
  return avaliacao.dispara;
}

/** O rastro em `agent_turn_traces` (`aborted`), que a tela de Execuções lê. Melhor-esforço. */
async function registrarRastroDoTurno(
  pool: pg.Pool | null,
  alvo: AlvoDoTurno,
  motivo: string,
  log: LoggerDaTrava | undefined,
  deps: DepsDoTurno,
): Promise<void> {
  try {
    if (deps.registrarRastro) {
      await deps.registrarRastro(motivo);
      return;
    }
    if (!pool) return;
    await registrarTracoDoTurno(
      pool,
      montarTracoDoTurno({
        organizationId: alvo.organizationId,
        jobId: alvo.jobId,
        previewRunId: null,
        conversationId: alvo.conversationId,
        contactId: alvo.contactId,
        agentId: null,
        agentVersionId: null,
        isDryRun: false,
        status: "aborted",
        abortReason: motivo,
        errorCode: null,
        errorMessage: null,
        provider: null,
        model: null,
        messagesSent: 0,
        historicoMensagens: null,
        knowledgeSourceIds: [],
        ferramentas: [],
      }),
    );
  } catch (erro) {
    log?.warn("trava de robô: rastro do turno não gravado", { job_id: alvo.jobId, error: mensagemDoErro(erro) });
  }
}

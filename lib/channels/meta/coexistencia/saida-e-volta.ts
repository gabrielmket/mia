/**
 * FORK MIA · coexistência (S4; docs/fork/coexistencia.md): o número que SAI da
 * coexistência e o que VOLTA.
 *
 * A Meta avisa no campo `account_update` (página de cadastro de usuários do
 * app, lida em 18/11/2026):
 *
 *   - `PARTNER_REMOVED`, com `disconnection_info.reason` (ACCOUNT_DISCONNECTED,
 *     BUSINESS_DOWNGRADE, CHANGE_NUMBER, COMPANION_INACTIVITY,
 *     PRIMARY_INACTIVITY, USER_RE_REGISTERED) e `initiated_by` (USER, SYSTEM);
 *   - `ACCOUNT_OFFBOARDED`, sem motivo;
 *   - `ACCOUNT_RECONNECTED`, a volta.
 *
 * Nenhum dos três traz o `phone_number_id`: a conta é a WABA (`entry.id`, ou
 * `waba_info.waba_id`), e o ciclo é o vivo dessa WABA na empresa que
 * `donoDoEvento` resolveu pela NOSSA tabela.
 *
 * SAIR: o ciclo vai a `fora_do_ar` com o motivo, a sessão do canal sai de
 * `WORKING` (o envio para, e a faixa do upstream na conversa passa a valer) e
 * abre UM aviso na Central por número. O mesmo evento de novo atualiza o
 * mesmo aviso.
 *
 * VOLTAR: o ciclo volta a `no_ar` com `voltou_em`, a sessão volta a `WORKING`
 * (só se quem a tirou fomos nós), o aviso de fora do ar fecha e entra o de
 * "voltou". NADA É CRIADO: a sessão, o contato, a conversa e o cartão são os
 * de antes. E não pede a sincronização de novo (D4: a Meta só aceita numa
 * passagem nova pela janela, e aí é ciclo novo, em `conectar.ts`).
 *
 * A ORDEM: a Meta entrega fora de ordem (no exemplo da própria página, o
 * `ACCOUNT_RECONNECTED` tem `time` 1 segundo menor que o `ACCOUNT_OFFBOARDED`).
 * `ultimo_evento_em` guarda o `time` do último evento aplicado, e o mais velho
 * não muda nada. Empate aplica (o último a chegar vence).
 *
 * NUNCA LANÇA: falha vira desfecho e log, e a rota responde 200.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { donoDoEvento, type DonoDeEvento } from "../dono-do-evento";
import type { MetaWebhookEnvelope } from "../envelope";
import { avisarNumeroForaDoAr, avisarNumeroVoltou } from "./avisos";

type Admin = SupabaseClient;

export const EVENTOS_DE_SAIDA = ["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"] as const;
export const EVENTO_DE_VOLTA = "ACCOUNT_RECONNECTED";

/** O vocabulário do `disconnection_info.reason` (o CHECK da 9162). */
export const MOTIVOS_DA_META = [
  "ACCOUNT_DISCONNECTED",
  "BUSINESS_DOWNGRADE",
  "CHANGE_NUMBER",
  "COMPANION_INACTIVITY",
  "PRIMARY_INACTIVITY",
  "USER_RE_REGISTERED",
] as const;

export type MotivoDaSaida = (typeof MOTIVOS_DA_META)[number] | "ACCOUNT_OFFBOARDED" | "desconhecido";

/** O `status_reason` que a saída grava na sessão. A volta só devolve `WORKING` à sessão que tem ele. */
export const MOTIVO_DA_SESSAO_FORA_DO_AR = "coexistencia_fora_do_ar";

export type LeituraDaConta =
  | {
      tipo: "saida";
      wabaId: string;
      motivo: MotivoDaSaida;
      iniciadoPor: "USER" | "SYSTEM" | null;
      quando: Date;
    }
  | { tipo: "volta"; wabaId: string; quando: Date };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Lê a saída ou a volta de um `change` do webhook; `null` quando não é uma.
 * Pura. `time` é o do `entry` (epoch em segundos); sem ele, a hora da chegada.
 */
export function lerSaidaOuVolta(
  field: string,
  entry: { id?: unknown; time?: unknown },
  value: Record<string, unknown>,
  agora: Date = new Date(),
): LeituraDaConta | null {
  if (field !== "account_update") return null;
  const evento = texto(value.event)?.toUpperCase() ?? null;
  if (!evento) return null;
  const info = objeto(value.waba_info);
  const wabaId = texto(info?.waba_id) ?? texto(value.waba_id) ?? texto(entry.id);
  if (!wabaId) return null;
  const segundos = typeof entry.time === "number" ? entry.time : Number(texto(entry.time) ?? NaN);
  const quando = Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : agora;

  if (evento === EVENTO_DE_VOLTA) return { tipo: "volta", wabaId, quando };
  if (!(EVENTOS_DE_SAIDA as readonly string[]).includes(evento)) return null;

  if (evento === "ACCOUNT_OFFBOARDED") {
    return { tipo: "saida", wabaId, motivo: "ACCOUNT_OFFBOARDED", iniciadoPor: null, quando };
  }
  const desconexao = objeto(value.disconnection_info);
  const razao = texto(desconexao?.reason)?.toUpperCase() ?? null;
  const quem = texto(desconexao?.initiated_by)?.toUpperCase() ?? null;
  return {
    tipo: "saida",
    wabaId,
    motivo: razao && (MOTIVOS_DA_META as readonly string[]).includes(razao) ? (razao as MotivoDaSaida) : "desconhecido",
    iniciadoPor: quem === "USER" || quem === "SYSTEM" ? quem : null,
    quando,
  };
}

/** As leituras de saída e volta do envelope inteiro. Pura. */
export function leiturasDaConta(envelope: MetaWebhookEnvelope, agora: Date = new Date()): LeituraDaConta[] {
  const out: LeituraDaConta[] = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const l = lerSaidaOuVolta(
        String(change.field ?? ""),
        entry as { id?: unknown; time?: unknown },
        (change.value ?? {}) as Record<string, unknown>,
        agora,
      );
      if (l) out.push(l);
    }
  }
  return out;
}

export interface OpcoesDaConta<T extends DonoDeEvento> {
  requestId: string;
  sessionDoToken: T | null;
  porWaba: (wabaId: string) => Promise<T | null>;
}

interface CicloVivo {
  id: string;
  channel_session_id: string;
  estado: "no_ar" | "fora_do_ar";
  fora_do_ar_em: string | null;
  voltou_em: string | null;
  ultimo_evento_em: string | null;
}

export async function receberSaidaEVolta<T extends DonoDeEvento>(
  admin: Admin,
  envelope: MetaWebhookEnvelope,
  opcoes: OpcoesDaConta<T>,
): Promise<string[]> {
  const desfechos: string[] = [];
  for (const leitura of leiturasDaConta(envelope)) {
    try {
      const dono = await donoDoEvento({
        sessionDoToken: opcoes.sessionDoToken,
        wabaDoEvento: leitura.wabaId,
        porWaba: opcoes.porWaba,
      });
      if (!dono) {
        desfechos.push("conta:waba_desconhecida");
        continue;
      }
      desfechos.push(...(await aplicarNaConta(admin, dono.organizationId, leitura, opcoes.requestId)));
    } catch (err) {
      logger.error("[meta.coexistencia] saída ou volta do número não aplicada", {
        request_id: opcoes.requestId,
        waba_id: leitura.wabaId,
        tipo: leitura.tipo,
        erro: err instanceof Error ? err.message : String(err),
      });
      desfechos.push("conta:failed");
    }
  }
  return desfechos;
}

/** Aplica UMA leitura na empresa. Lança se o banco falhar (quem chama transforma em desfecho). Exportada para o teste. */
export async function aplicarNaConta(
  admin: Admin,
  organizationId: string,
  leitura: LeituraDaConta,
  requestId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("mia_coexistencia_conexoes")
    .select("id, channel_session_id, estado, fora_do_ar_em, voltou_em, ultimo_evento_em")
    .eq("organization_id", organizationId)
    .eq("waba_id", leitura.wabaId)
    .in("estado", ["no_ar", "fora_do_ar"]);
  if (error) throw new Error(`ciclos_da_waba: ${error.message}`);
  const ciclos = (data ?? []) as CicloVivo[];
  // Sem ciclo vivo: é número do canal oficial que não entrou pelo app (ou já
  // encerrado). A coexistência não tem o que mudar; o resto do canal segue.
  if (ciclos.length === 0) return ["conta:sem_ciclo"];

  const quando = leitura.quando.toISOString();
  const desfechos: string[] = [];
  for (const ciclo of ciclos) {
    if (ciclo.ultimo_evento_em && new Date(ciclo.ultimo_evento_em).getTime() > leitura.quando.getTime()) {
      desfechos.push("conta:evento_velho");
      continue;
    }
    desfechos.push(
      leitura.tipo === "saida"
        ? await sair(admin, organizationId, ciclo, leitura, quando, requestId)
        : await voltar(admin, organizationId, ciclo, quando, requestId),
    );
  }
  return desfechos;
}

/** O ciclo, só se o evento ainda é o mais novo (a corrida entre duas entregas). */
function soSeMaisNovo<Q extends { or: (f: string) => Q }>(consulta: Q, quando: string): Q {
  return consulta.or(`ultimo_evento_em.is.null,ultimo_evento_em.lte.${quando}`);
}

async function sair(
  admin: Admin,
  organizationId: string,
  ciclo: CicloVivo,
  leitura: Extract<LeituraDaConta, { tipo: "saida" }>,
  quando: string,
  requestId: string,
): Promise<string> {
  const jaEstavaFora = ciclo.estado === "fora_do_ar";
  const { data, error } = await soSeMaisNovo(
    admin
      .from("mia_coexistencia_conexoes")
      .update({
        estado: "fora_do_ar",
        fora_do_ar_motivo: leitura.motivo,
        fora_do_ar_iniciado_por: leitura.iniciadoPor,
        // A hora em que SAIU é a da primeira saída; reentrega não a empurra.
        fora_do_ar_em: jaEstavaFora && ciclo.fora_do_ar_em ? ciclo.fora_do_ar_em : quando,
        ultimo_evento_em: quando,
      })
      .eq("organization_id", organizationId)
      .eq("id", ciclo.id),
    quando,
  ).select("id, fora_do_ar_em");
  if (error) throw new Error(`ciclo_fora_do_ar: ${error.message}`);
  const linha = ((data ?? []) as Array<{ id: string; fora_do_ar_em: string | null }>)[0];
  if (!linha) return "conta:evento_velho";

  // A sessão sai de WORKING: o envio pela MIA para, e as telas do upstream
  // (faixa da conversa, Conexões) passam a dizer que o número caiu. Só a que
  // está WORKING: uma sessão que já caiu por outro motivo fica com o dela.
  const { error: erroDaSessao } = await admin
    .from("channel_sessions")
    .update({ status: "STOPPED", status_reason: MOTIVO_DA_SESSAO_FORA_DO_AR, last_status_change_at: quando })
    .eq("organization_id", organizationId)
    .eq("id", ciclo.channel_session_id)
    .eq("status", "WORKING");
  if (erroDaSessao) throw new Error(`sessao_fora_do_ar: ${erroDaSessao.message}`);

  await avisarNumeroForaDoAr(admin, {
    organizationId,
    channelSessionId: ciclo.channel_session_id,
    conexaoId: ciclo.id,
    motivo: leitura.motivo,
    foraDoArEm: linha.fora_do_ar_em ?? quando,
    requestId,
  });
  return jaEstavaFora ? "conta:fora_do_ar_repetido" : "conta:fora_do_ar";
}

async function voltar(
  admin: Admin,
  organizationId: string,
  ciclo: CicloVivo,
  quando: string,
  requestId: string,
): Promise<string> {
  if (ciclo.estado === "no_ar") {
    // Nada a fazer, mas o `time` fica guardado: uma saída MAIS VELHA que chegue
    // depois não tira do ar um número que já está de volta.
    const { error } = await soSeMaisNovo(
      admin
        .from("mia_coexistencia_conexoes")
        .update({ ultimo_evento_em: quando })
        .eq("organization_id", organizationId)
        .eq("id", ciclo.id),
      quando,
    );
    if (error) throw new Error(`ciclo_ja_no_ar: ${error.message}`);
    // A volta que falhou no meio: o ciclo já foi a `no_ar`, mas a escrita da
    // sessão caiu (e a rota respondeu 200). A reentrega da Meta refaz o passo da
    // sessão, que só pega a sessão que NÓS tiramos; se ele consertou, refaz o
    // aviso também. Ciclo que nunca saiu (`voltou_em` nulo) não tem o que curar.
    if (ciclo.voltou_em && (await reporSessao(admin, organizationId, ciclo, quando))) {
      await avisarNumeroVoltou(admin, {
        organizationId,
        channelSessionId: ciclo.channel_session_id,
        conexaoId: ciclo.id,
        voltouEm: ciclo.voltou_em,
        requestId,
      });
      return "conta:voltou_reparado";
    }
    return "conta:ja_no_ar";
  }

  const { data, error } = await soSeMaisNovo(
    admin
      .from("mia_coexistencia_conexoes")
      .update({ estado: "no_ar", voltou_em: quando, ultimo_evento_em: quando })
      .eq("organization_id", organizationId)
      .eq("id", ciclo.id)
      .eq("estado", "fora_do_ar"),
    quando,
  ).select("id");
  if (error) throw new Error(`ciclo_voltou: ${error.message}`);
  if (((data ?? []) as unknown[]).length === 0) return "conta:evento_velho";

  await reporSessao(admin, organizationId, ciclo, quando);

  await avisarNumeroVoltou(admin, {
    organizationId,
    channelSessionId: ciclo.channel_session_id,
    conexaoId: ciclo.id,
    voltouEm: quando,
    requestId,
  });
  return "conta:voltou";
}

/**
 * A MESMA sessão volta a WORKING. Só a que nós tiramos: se o vigia de saúde ou
 * uma pessoa mudou o estado depois, a decisão é deles. Devolve se alguma linha
 * mudou (a cura da reentrega usa isso). Lança se o banco falhar.
 */
async function reporSessao(admin: Admin, organizationId: string, ciclo: CicloVivo, quando: string): Promise<boolean> {
  const { data, error } = await admin
    .from("channel_sessions")
    .update({ status: "WORKING", status_reason: null, last_status_change_at: quando })
    .eq("organization_id", organizationId)
    .eq("id", ciclo.channel_session_id)
    .eq("status_reason", MOTIVO_DA_SESSAO_FORA_DO_AR)
    .select("id");
  if (error) throw new Error(`sessao_voltou: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * O catálogo e a leitura de um calendário do Outlook.
 *
 * O mesmo desenho de `lib/agenda/google/calendar-executor.ts` do upstream: a
 * reserva (90 s), o cursor retomável e a gravação moram no banco
 * (`fn_mia_agenda_microsoft_calendario`); aqui só a conversa com a Graph e a
 * tradução de cada evento. Uma página por rodada: calendário grande termina em
 * várias rodadas, sem segurar a rotina.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { tokenDaConexaoMicrosoft } from "./conexao";
import { classificarErroDaMicrosoft, GraphHttpError } from "./erros";
import { doEventoDaMicrosoft } from "./evento";
import { graphTransport, type CursorDaLeituraMicrosoft, type GraphFetch } from "./transport";

export async function rpcMicrosoft(db: SupabaseClient, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(nome, args as never);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

const claimSchema = z.object({ token: z.uuid(), epoch: z.string(), lease_until: z.string() });

export const cursorMicrosoftSchema = z.object({
  generation: z.uuid(),
  mode: z.enum(["full", "incremental"]),
  delta: z.boolean(),
  base: z.string().nullable(),
  page: z.string().nullable(),
  window_start: z.string(),
  window_end: z.string(),
});

const snapshotDoCalendarioSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  conexao_id: z.uuid(),
  calendario_externo_id: z.string(),
  padrao: z.boolean(),
  fuso: z.string().nullable(),
  cursor: cursorMicrosoftSchema.nullable(),
  claim: claimSchema,
});

/** O papel no vocabulário que a tela e as regras já entendem. */
export function papelDoCalendario(
  c: { canEdit?: boolean | null; owner?: { address?: string | null } | null },
  contaEmail: string,
): "owner" | "writer" | "reader" {
  if (!c.canEdit) return "reader";
  const dono = c.owner?.address?.trim().toLowerCase();
  return dono && dono === contaEmail.trim().toLowerCase() ? "owner" : "writer";
}

/** Lê o catálogo inteiro na Graph e grava (ausência só depois de todas as páginas). */
export async function atualizarCatalogoMicrosoft(
  db: SupabaseClient,
  org: string,
  conexaoId: string,
  transporte?: GraphFetch,
): Promise<void> {
  const { data, error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .select("conta_email, revisao_da_escolha")
    .eq("organization_id", org)
    .eq("id", conexaoId)
    .single();
  if (error || !data) throw error ?? new Error("Conexão indisponível.");
  const token = await tokenDaConexaoMicrosoft(db, org, conexaoId);
  const calendarios = await graphTransport(token, transporte).calendarios();
  await rpcMicrosoft(db, "fn_mia_agenda_microsoft_catalogo", {
    p_org: org,
    p_conexao: conexaoId,
    p_revisao: String(data.revisao_da_escolha),
    p_itens: calendarios.map((c) => ({
      id: c.id,
      nome: c.name ?? c.id,
      padrao: Boolean(c.isDefaultCalendar),
      papel: papelDoCalendario(c, data.conta_email),
      reunioes: c.allowedOnlineMeetingProviders ?? [],
    })),
  });
}

/** A frase gravada quando a leitura falha: só status e código, nunca o texto da Microsoft. */
export function mensagemDaRecusaDeLeituraMicrosoft(erro: unknown): string {
  if (erro instanceof GraphHttpError) return classificarErroDaMicrosoft(erro, "sincronizar").mensagem;
  if (erro instanceof Error && erro.message && erro.message.length < 160 && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(erro.message)) {
    return erro.message;
  }
  return "A leitura não terminou. Tente sincronizar novamente nas configurações.";
}

export interface OpcoesDaLeitura {
  transporte?: GraphFetch;
  /**
   * Evento que é compromisso nosso (anti-eco): quem publica reconcilia. Sem
   * isto (entrega 1), o evento só sai do espelho de ocupação.
   */
  reconciliarVinculado?: (eventoId: string, token: string) => Promise<"ok" | "busy" | "failed">;
}

export async function lerCalendarioMicrosoft(
  db: SupabaseClient,
  org: string,
  calendarioId: string,
  opcoes: OpcoesDaLeitura = {},
): Promise<"busy" | "complete" | "partial" | "failed"> {
  const bruto = await rpcMicrosoft(db, "fn_mia_agenda_microsoft_calendario", {
    p_org: org,
    p_id: calendarioId,
    p_acao: "claim",
  });
  if (!bruto) return "busy";
  const c = snapshotDoCalendarioSchema.parse(bruto);
  if (!c.cursor) throw new Error("Leitura sem cursor reservado.");
  const cursor: CursorDaLeituraMicrosoft = c.cursor;
  const chamar = (acao: string, args: Record<string, unknown> = {}) =>
    rpcMicrosoft(db, "fn_mia_agenda_microsoft_calendario", {
      p_org: org,
      p_id: calendarioId,
      p_acao: acao,
      p_args: { claim: c.claim, cursor, ...args },
    });

  try {
    const token = await tokenDaConexaoMicrosoft(db, org, c.conexao_id);
    let fuso = c.fuso;
    if (!fuso) {
      const { data: organizacao, error } = await db.from("organizations").select("timezone").eq("id", org).single();
      if (error || !organizacao?.timezone) throw new Error("Fuso da organização indisponível.");
      fuso = organizacao.timezone as string;
    }
    const pagina = await graphTransport(token, opcoes.transporte).pagina(c.calendario_externo_id, cursor);
    const inicioDaJanela = Date.parse(cursor.window_start);
    const fimDaJanela = Date.parse(cursor.window_end);

    for (const evento of pagina.eventos) {
      await chamar("renew");
      const lido = doEventoDaMicrosoft(evento, { fusoDoCalendario: fuso });
      if (lido.tipo === "recusado") {
        // Mestre de série não entra na ocupação (as ocorrências entram). Fuso
        // ilegível é defeito da leitura inteira: parar é melhor que ocupar errado.
        if (lido.motivo === "serie_nao_expandida") continue;
        throw new Error("Evento com horário ilegível. A leitura não foi concluída.");
      }
      const item =
        lido.tipo === "cancelado"
          ? { evento_externo_id: lido.externalEventId, situacao: "cancelled" }
          : {
              evento_externo_id: lido.evento.evento_externo_id,
              inicio: lido.evento.inicio,
              fim: lido.evento.fim,
              dia_inteiro: lido.evento.dia_inteiro,
              situacao: lido.evento.situacao,
              transparencia: lido.evento.ocupa ? "opaque" : "transparent",
              atualizado_la_em: lido.evento.atualizado_la_em,
            };
      // Na delta, a Microsoft também devolve o que mudou FORA da janela: o que
      // cai fora dela não é ocupação desta rodada.
      if (
        lido.tipo === "evento" &&
        (Date.parse(lido.evento.fim) <= inicioDaJanela || Date.parse(lido.evento.inicio) >= fimDaJanela)
      ) {
        continue;
      }
      const resultado = (await chamar("item", { item })) as { vinculado?: boolean } | null;
      if (resultado?.vinculado && opcoes.reconciliarVinculado) {
        const r = await opcoes.reconciliarVinculado(item.evento_externo_id, token);
        if (r === "busy") return "partial";
        if (r === "failed") throw new Error("Compromisso vinculado ainda não reconciliado.");
      }
    }

    const salvo = z
      .object({ cursor: cursorMicrosoftSchema.nullable() })
      .passthrough()
      .parse(await chamar("page", { next_page: pagina.proxima, delta_link: pagina.deltaLink }));
    return salvo.cursor ? "partial" : "complete";
  } catch (e) {
    try {
      const desfecho = e instanceof GraphHttpError ? classificarErroDaMicrosoft(e, "sincronizar").desfecho : null;
      if (desfecho === "ressincronizar") await chamar("reset");
      else await chamar("error", { message: mensagemDaRecusaDeLeituraMicrosoft(e) });
    } catch {
      /* reserva vencida não grava diagnóstico tardio */
    }
    return "failed";
  } finally {
    try {
      await rpcMicrosoft(db, "fn_mia_agenda_microsoft_calendario", {
        p_org: org,
        p_id: calendarioId,
        p_acao: "release",
        p_args: { claim: c.claim },
      });
    } catch {
      /* só a reserva original libera */
    }
  }
}

/**
 * A reconciliação de UM compromisso com o evento dele no Outlook.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.8). O algoritmo é o do
 * `reconcileAppointment` do upstream (`lib/agenda/google/sync-executor.ts`), na
 * mesma ordem e pelas mesmas razões: GET exato antes de qualquer escrita; a
 * escrita pendente é uma INTENÇÃO, observada antes de comparar a intenção atual;
 * comparação de três vias (`compare`/`checkpoint` dele, reaproveitados); conflito
 * vira decisão humana; a volta só toca compromisso de pé. O que muda é o que a
 * Microsoft faz diferente:
 *
 *  - **quem escolhe o id é a Microsoft.** O POST leva `transactionId` (a Graph
 *    descarta a criação repetida) e a propriedade estendida com o id do
 *    compromisso; se a resposta se perder, a próxima reserva reencontra o evento
 *    por essa propriedade antes de criar de novo;
 *  - **cancelar com convidados é `/cancel`** (a Microsoft avisa os convidados);
 *  - **o Teams** é pedido no próprio evento e observado na resposta e nas
 *    releituras (entrega 3, `fn_mia_agenda_microsoft_teams`).
 */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { emailDoContato } from "@/lib/agenda/google/sync-executor";
import {
  baseSchema,
  checkpoint,
  comConviteDaFicha,
  compare,
  groups,
  projectionSchema,
  sameShared,
  sharedSchema,
  type Base,
  type Group,
  type Projection,
} from "@/lib/agenda/google/sync-model";

import { rpcMicrosoft } from "./calendar-executor";
import { tokenDaConexaoMicrosoft } from "./conexao";
import { classificarErroDaMicrosoft, GraphHttpError, type OperacaoNaMicrosoft } from "./erros";
import {
  compromissoDoEvento,
  deltaMicrosoft,
  paraEventoDaMicrosoft,
  participantesParaMicrosoft,
  projecaoLocalMicrosoft,
  projecaoRemotaMicrosoft,
  type CompromissoParaMicrosoft,
  type SituacaoDoCompromisso,
} from "./evento";
import { calendarioPermiteTeams, observarTeams, TETO_DE_TENTATIVAS_DO_TEAMS, type ObservacaoDoTeams } from "./teams";
import { graphTransport, type EventoDaMicrosoft, type GraphFetch } from "./transport";

const escritaSchema = z.object({
  operation_id: z.uuid(),
  method: z.enum(["POST", "PATCH", "DELETE"]),
  etag: z.string().nullable(),
  revision: z.string(),
  local_revision: z.string(),
  desired: projectionSchema,
  groups: z.array(z.enum(groups)),
  shared: z.boolean(),
  teams: z.boolean().optional(),
});
type EscritaPendente = z.infer<typeof escritaSchema>;

export const conflitoMicrosoftSchema = z.object({
  reason: z.enum(["shared", "outbound", "legacy", "series", "outcome", "overlap", "missing", "identity"]),
  local: sharedSchema,
  remote: sharedSchema.nullable(),
  groups: z.array(z.enum(groups)),
  etag: z.string().nullable(),
  revision: z.string(),
  local_revision: z.string(),
  resolution: z.object({ choice: z.enum(["outlook", "local", "preserve_remote"]), actor_id: z.uuid() }).optional(),
});
export type ConflitoMicrosoft = z.infer<typeof conflitoMicrosoftSchema>;

const snapshotSchema = z.object({
  appointment: z.object({
    id: z.uuid(),
    organization_id: z.uuid(),
    owner_user_id: z.uuid(),
    contact_id: z.uuid().nullable(),
    event_type_id: z.uuid().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    starts_at: z.string(),
    ends_at: z.string(),
    time_zone: z.string(),
    status: z.enum(["pending", "confirmed", "completed", "no_show", "cancelled"]),
    location_kind: z.string(),
    location_details: z.string().nullable(),
    meeting_url: z.string().nullable(),
    guest_email: z.string().nullable(),
    revision: z.string(),
    local_revision: z.string(),
    google_event_id: z.string().nullable(),
  }),
  mirror: z.object({
    connection_id: z.uuid().nullable(),
    calendar_id: z.string().nullable(),
    event_id: z.string().nullable(),
    transaction_id: z.uuid(),
    etag: z.string().nullable(),
    base: baseSchema.nullable(),
    conflict: conflitoMicrosoftSchema.nullable(),
    pending: z.union([escritaSchema, z.object({ reserva: z.literal(true) }).strict()]).nullable(),
    published_revision: z.string(),
    teams_requested: z.boolean(),
    teams_state: z.enum(["nao_pedido", "pendente", "pronto", "falhou", "cancelado"]),
    teams_attempts: z.number(),
  }),
  meeting_providers: z.array(z.string()),
  claim: z.object({ token: z.uuid(), epoch: z.string(), lease_until: z.string() }),
});
type Snapshot = z.infer<typeof snapshotSchema>;

const OPERACAO: Record<EscritaPendente["method"], OperacaoNaMicrosoft> = { POST: "criar", PATCH: "atualizar", DELETE: "apagar" };

/** A frase gravada quando a Microsoft recusa: só status e código. */
export function mensagemDaRecusaMicrosoft(erro: unknown, metodo: EscritaPendente["method"]): string {
  if (erro instanceof GraphHttpError) {
    if (erro.status === 412) return erro.message;
    return classificarErroDaMicrosoft(erro, OPERACAO[metodo]).mensagem;
  }
  if (erro instanceof Error && "code" in erro) return "O compromisso mudou. A sincronização vai reler a versão atual.";
  if (erro instanceof Error && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^@]{0,150}$/.test(erro.message)) return erro.message;
  return "Não foi possível sincronizar com o Outlook. Confira a conexão e tente novamente.";
}

function etagDe(e: EventoDaMicrosoft | null | undefined): string | null {
  return (e?.["@odata.etag"] as string | undefined) ?? null;
}

function compromissoDe(s: Snapshot): CompromissoParaMicrosoft {
  const a = s.appointment;
  return {
    id: a.id,
    organization_id: a.organization_id,
    title: a.title,
    description: a.description,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    time_zone: a.time_zone,
    status: a.status as SituacaoDoCompromisso,
    location_kind: a.location_kind,
    location_details: a.location_details,
    meeting_url: a.meeting_url,
    guest_email: a.guest_email,
    teams: s.mirror.teams_requested,
  };
}

export interface OpcoesDaReconciliacao {
  transporte?: GraphFetch;
  token?: string;
}

export async function reconciliarCompromissoMicrosoft(
  db: SupabaseClient,
  org: string,
  id: string,
  opcoes: OpcoesDaReconciliacao = {},
): Promise<"busy" | "processed" | "unchanged" | "terminal" | "failed"> {
  const bruto = await rpcMicrosoft(db, "fn_mia_agenda_microsoft_compromisso", { p_org: org, p_id: id, p_acao: "claim" });
  if (!bruto) return "busy";
  if (typeof bruto === "object" && bruto !== null && "terminal" in bruto) return "terminal";
  let s = snapshotSchema.parse(bruto);
  const claim = s.claim;

  const esperado = () => ({
    claim,
    revision: s.appointment.revision,
    local_revision: s.appointment.local_revision,
    event_id: s.mirror.event_id,
    connection_id: s.mirror.connection_id,
    calendar_id: s.mirror.calendar_id,
  });
  const chamar = (acao: string, extra: Record<string, unknown> = {}) =>
    rpcMicrosoft(db, "fn_mia_agenda_microsoft_compromisso", {
      p_org: org,
      p_id: id,
      p_acao: acao,
      p_args: { ...esperado(), ...extra },
    });
  const efetivar = async (resultado: Record<string, unknown>): Promise<boolean> => {
    const salvo = await chamar("commit", { result: resultado });
    if (salvo && typeof salvo === "object" && "overlap" in salvo) return false;
    s = snapshotSchema.parse(salvo);
    return true;
  };
  const registrarTeams = async (obs: ObservacaoDoTeams | { estado: "falhou"; erro: "nao_permite" }) => {
    await rpcMicrosoft(db, "fn_mia_agenda_microsoft_teams", {
      p_org: org,
      p_id: id,
      p_args: { ...esperado(), result: obs },
    });
  };

  let metodoEmVoo: EscritaPendente["method"] = "PATCH";
  try {
    const m = s.mirror;
    if (!m.connection_id || !m.calendar_id) throw new Error("Vínculo com o Outlook sem agenda de destino.");
    const contato = await emailDoContato(db, org, s.appointment.contact_id);
    const token = opcoes.token ?? (await tokenDaConexaoMicrosoft(db, org, m.connection_id));
    const api = graphTransport(token, opcoes.transporte);
    const fuso = s.appointment.time_zone;
    const contexto = () => ({ descricaoLocal: s.appointment.description ?? "", fuso });

    // O evento: pelo id quando já existe; pela propriedade quando a criação pode
    // ter acontecido e a resposta se perdeu.
    let evento: EventoDaMicrosoft | null = null;
    if (m.event_id) {
      evento = await api.evento(m.event_id, m.calendar_id);
    } else if (m.pending && ("reserva" in m.pending || m.pending.method === "POST")) {
      const achado = await api.eventoDoCompromisso(m.calendar_id, s.appointment.id);
      if (achado) {
        await efetivar({ event_id: achado.id, etag: etagDe(achado) });
        evento = achado;
      }
    }

    if (!s.mirror.event_id && s.appointment.status === "cancelled" && !evento) {
      await efetivar({ ack: true, clear_pending: true });
      return "processed";
    }

    let local = projecaoLocalMicrosoft(compromissoDe(s));
    let base: Base | null = s.mirror.base;
    const publicadoAntes = base !== null;

    const conflito = async (razao: ConflitoMicrosoft["reason"], remoto: Projection | null, campos: Group[] = []) => {
      await efetivar({
        conflict: {
          reason: razao,
          local: local.shared,
          remote: remoto?.shared ?? null,
          groups: campos,
          etag: etagDe(evento),
          revision: s.appointment.revision,
          local_revision: s.appointment.local_revision,
        },
        etag: etagDe(evento),
      });
    };

    if (evento) {
      const dono = compromissoDoEvento(evento);
      if (dono.compromisso && dono.compromisso !== s.appointment.id) {
        await conflito("identity", null);
        return "processed";
      }
      // Virou série no Outlook: uma ocorrência não é mais o compromisso único daqui.
      if ((evento.type ?? "singleInstance").toLowerCase() !== "singleinstance" || evento.seriesMasterId) {
        await conflito("series", null);
        return "processed";
      }
    }

    let remoto = evento ? projecaoRemotaMicrosoft(evento, local, base, contexto()) : null;

    // O Teams pedido e ainda não pronto: o evento diz se o link já existe.
    if (s.mirror.teams_requested && s.mirror.teams_state === "pendente" && evento && s.appointment.status !== "cancelled") {
      const obs = observarTeams(evento);
      if (obs?.estado === "pendente" && s.mirror.teams_attempts + 1 >= TETO_DE_TENTATIVAS_DO_TEAMS) {
        await registrarTeams({ estado: "falhou", erro: "desconhecido" });
      } else if (obs) {
        await registrarTeams(obs);
      }
    }

    // A escrita pendente: observada no contexto em que foi pedida.
    if (s.mirror.pending && "operation_id" in s.mirror.pending) {
      const pendente = s.mirror.pending;
      const historico = evento ? projecaoRemotaMicrosoft(evento, pendente.desired, base, contexto()) : null;
      const alcancou =
        pendente.method === "DELETE"
          ? !evento || Boolean(evento.isCancelled)
          : historico !== null &&
            (!pendente.shared || sameShared(pendente.desired.shared, historico.shared)) &&
            pendente.groups.every((g) => pendente.desired.outbound[g] === historico.outbound[g]);
      if (alcancou) {
        const observado = historico ?? { ...pendente.desired, shared: { ...pendente.desired.shared, cancelled: true } };
        base = checkpoint(base, pendente.desired, observado, pendente.groups, pendente.shared);
        const ack = s.appointment.local_revision === pendente.local_revision && sameShared(local.shared, observado.shared);
        await efetivar({ base, etag: etagDe(evento), clear_pending: true, operation_id: pendente.operation_id, ack });
        if (ack) return "processed";
      } else if ((pendente.method === "POST" && !evento) || (etagDe(evento) && etagDe(evento) === pendente.etag)) {
        await efetivar({
          clear_pending: true,
          operation_id: pendente.operation_id,
          retry_creation: pendente.method === "POST" && !evento,
        });
      } else if (evento && pendente.method !== "POST" && base && remoto && compare(base, local, remoto).kind !== "conflict") {
        await efetivar({ clear_pending: true, operation_id: pendente.operation_id });
      } else {
        await conflito("shared", remoto);
        return "processed";
      }
    }

    remoto = evento ? projecaoRemotaMicrosoft(evento, local, base, contexto()) : null;

    // A decisão de conflito registrada pela pessoa.
    if (s.mirror.conflict) {
      const c = s.mirror.conflict;
      const escolha = c.resolution?.choice;
      const mesmaComparacao =
        c.etag === etagDe(evento) && c.revision === s.appointment.revision && c.local_revision === s.appointment.local_revision;
      // Sem decisão: só regrava quando a comparação mudou (a tela mostra a nova).
      // Com decisão sobre uma comparação que já não vale: volta a pedir decisão.
      if (!escolha || !mesmaComparacao) {
        if (!mesmaComparacao) await conflito(c.reason, remoto, c.groups);
        return "processed";
      }
      if (!remoto) {
        await conflito("missing", remoto);
        return "processed";
      }
      base ??= checkpoint(null, local, remoto, [...groups], true);
      if (escolha === "outlook") {
        if (c.groups.length || !["pending", "confirmed"].includes(s.appointment.status)) {
          await conflito("outcome", remoto);
          return "processed";
        }
        const proxima = checkpoint(base, local, remoto, [], true);
        const aceito = await efetivar({
          base: proxima,
          remote: remoto.shared,
          apply_remote: true,
          conflict: null,
          clear_pending: true,
          etag: etagDe(evento),
          ack: groups.every((g) => proxima.local[g] === local.outbound[g]),
        });
        if (!aceito) await conflito("overlap", remoto);
        return "processed";
      }
      if (escolha === "preserve_remote") {
        if (!c.groups.length) {
          await conflito("shared", remoto);
          return "processed";
        }
        const proxima = structuredClone(base);
        for (const g of c.groups) proxima.local[g] = local.outbound[g];
        await efetivar({ base: proxima, conflict: null, clear_pending: true, etag: etagDe(evento) });
      } else {
        if (!evento || evento.isCancelled) {
          await conflito("missing", remoto);
          return "processed";
        }
        const proxima = structuredClone(base);
        proxima.shared = remoto.shared;
        for (const g of c.groups) {
          proxima.remote[g] = remoto.outbound[g];
          if (c.reason === "legacy") proxima.local[g] = remoto.outbound[g];
        }
        await efetivar({ base: proxima, conflict: null, clear_pending: true, etag: etagDe(evento) });
      }
    }

    local = projecaoLocalMicrosoft(compromissoDe(s));
    base = s.mirror.base;

    async function enviar(
      metodo: EscritaPendente["method"],
      corpo: Record<string, unknown> | undefined,
      etag: string | null,
      campos: Group[],
      compartilhado: boolean,
      pedirTeams = false,
    ) {
      if (metodo === "PATCH" && !compartilhado && !campos.length && !pedirTeams) return;
      const pendente: EscritaPendente = {
        operation_id: randomUUID(),
        method: metodo,
        etag,
        revision: s.appointment.revision,
        local_revision: s.appointment.local_revision,
        desired: local,
        groups: campos,
        shared: compartilhado,
        ...(pedirTeams ? { teams: true } : {}),
      };
      await chamar("prepare", { operation: pendente });
      await chamar("renew");
      metodoEmVoo = metodo;
      let resposta: EventoDaMicrosoft | null = null;
      if (metodo === "POST") resposta = await api.criar(s.mirror.calendar_id!, corpo ?? {});
      else if (metodo === "PATCH") resposta = await api.atualizar(s.mirror.event_id!, corpo ?? {}, etag);
      else await api.cancelar(s.mirror.event_id!, etag, Boolean(evento?.attendees?.length));
      const observado = resposta
        ? projecaoRemotaMicrosoft(resposta, local, base, contexto())
        : { ...local, shared: { ...local.shared, cancelled: true } };
      await efetivar({
        base: checkpoint(base, local, observado, campos, compartilhado),
        etag: etagDe(resposta),
        ...(metodo === "POST" && resposta ? { event_id: resposta.id } : {}),
        operation_id: pendente.operation_id,
        clear_pending: true,
        ack: compartilhado || campos.length > 0,
      });
      if (pedirTeams && resposta) {
        const obs = observarTeams(resposta) ?? { estado: "pendente" as const };
        await registrarTeams(obs);
      }
    }

    const querTeams = s.mirror.teams_requested && s.mirror.teams_state === "pendente" && s.appointment.status !== "cancelled";
    const permiteTeams = calendarioPermiteTeams(s.meeting_providers);
    if (querTeams && !permiteTeams) await registrarTeams({ estado: "falhou", erro: "nao_permite" });

    if (!evento) {
      if (publicadoAntes) {
        // Apagado no Outlook: para o CRM é cancelado lá.
        remoto = { ...local, shared: { ...base!.shared, cancelled: true } };
      } else if (s.appointment.status === "cancelled") {
        await efetivar({ ack: true, clear_pending: true });
        return "processed";
      } else if (!s.mirror.pending || !("reserva" in s.mirror.pending)) {
        await conflito("missing", null);
        return "processed";
      } else {
        const corpo = paraEventoDaMicrosoft(compromissoDe(s), {
          transactionId: s.mirror.transaction_id,
          participantes: participantesParaMicrosoft({
            contactEmail: contato?.email,
            contactName: contato?.nome,
            guestEmail: s.appointment.guest_email,
          }),
          pedirTeams: querTeams && permiteTeams,
        });
        await enviar("POST", corpo, null, [...groups], true, querTeams && permiteTeams);
        return "processed";
      }
    }
    if (!remoto) throw new Error("Evento sem projeção válida.");

    const temEmail = Boolean(contato?.email);
    const eventoTemEmail = Boolean(
      contato?.email &&
        (evento?.attendees ?? []).some((p) => p.emailAddress?.address?.trim().toLowerCase() === contato.email.trim().toLowerCase()),
    );
    const decisao = comConviteDaFicha(compare(base, local, remoto), {
      temEmail,
      eventoJaTemOEmail: eventoTemEmail,
      cancelado: Boolean(evento?.isCancelled) || s.appointment.status === "cancelled",
    });

    if (decisao.kind === "conflict") {
      await conflito(decisao.reason ?? "shared", remoto, decisao.groups);
      return "processed";
    }
    if (decisao.kind === "accept_remote") {
      if (!["pending", "confirmed"].includes(s.appointment.status)) {
        await conflito("outcome", remoto);
        return "processed";
      }
      const proxima = checkpoint(base, local, remoto, [], true);
      const aceito = await efetivar({
        base: proxima,
        remote: remoto.shared,
        apply_remote: true,
        etag: etagDe(evento),
        ack: groups.every((g) => proxima.local[g] === local.outbound[g]),
      });
      if (!aceito) await conflito("overlap", remoto);
      return "processed";
    }

    // O Teams pedido num evento que ainda não tem reunião (ex.: o tipo virou
    // Teams depois): a Graph aceita ligar a reunião numa alteração.
    const ligarTeams = querTeams && permiteTeams && evento && !evento.isOnlineMeeting && !evento.isCancelled;

    if (
      decisao.kind === "converged" &&
      !ligarTeams &&
      !s.mirror.pending &&
      s.appointment.local_revision === s.mirror.published_revision &&
      s.mirror.etag === etagDe(evento) &&
      !decisao.shared &&
      !decisao.groups.length
    ) {
      await chamar("idle");
      return "unchanged";
    }
    if (decisao.kind === "converged" && !ligarTeams) {
      await efetivar({
        base: checkpoint(base, local, remoto, decisao.groups, decisao.shared),
        etag: etagDe(evento),
        ack: true,
        clear_pending: true,
      });
      return "processed";
    }
    if (!evento || evento.isCancelled) {
      await conflito("missing", remoto);
      return "processed";
    }
    const campos = decisao.kind === "converged" ? [] : decisao.groups;
    const compartilhado = decisao.kind === "converged" ? false : decisao.shared;
    if (local.shared.cancelled) {
      await enviar("DELETE", undefined, etagDe(evento), campos, compartilhado);
      return "processed";
    }
    const corpo = deltaMicrosoft(
      { ...compromissoDe(s), contact_email: contato?.email ?? null, contact_nome: contato?.nome ?? null },
      evento,
      base,
      campos,
      compartilhado,
    );
    if (ligarTeams) {
      corpo.isOnlineMeeting = true;
      corpo.onlineMeetingProvider = "teamsForBusiness";
    }
    await enviar("PATCH", corpo, etagDe(evento), campos, compartilhado, Boolean(ligarTeams));
    return "processed";
  } catch (e) {
    const mensagem = mensagemDaRecusaMicrosoft(e, metodoEmVoo);
    try {
      await chamar("error", { message: mensagem });
    } catch {
      /* reserva perdida não grava erro tardio */
    }
    return "failed";
  } finally {
    try {
      await rpcMicrosoft(db, "fn_mia_agenda_microsoft_compromisso", {
        p_org: org,
        p_id: id,
        p_acao: "release",
        p_args: { claim },
      });
    } catch {
      /* só a reserva original libera */
    }
  }
}

/** O compromisso dono de um evento do Outlook (o anti-eco da leitura chama). */
export async function compromissoDoEventoMicrosoft(
  db: SupabaseClient,
  org: string,
  conexaoId: string,
  calendarioId: string,
  eventoId: string,
): Promise<string | null> {
  const { data } = await db
    .from("mia_agenda_microsoft_compromissos")
    .select("appointment_id")
    .eq("organization_id", org)
    .eq("conexao_id", conexaoId)
    .eq("calendario_externo_id", calendarioId)
    .eq("evento_id", eventoId)
    .maybeSingle();
  return (data as { appointment_id: string } | null)?.appointment_id ?? null;
}

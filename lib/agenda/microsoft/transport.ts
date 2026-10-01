/**
 * O cliente da Microsoft Graph (v1.0) para a agenda: só `fetch` e tradução da
 * resposta. Toda decisão mora nos executores.
 *
 * ─── Os três cabeçalhos `Prefer` que vão em TODA leitura de evento ──────────
 *
 *  - `outlook.timezone="UTC"`: a Graph devolve `dateTime` SEM deslocamento, com o
 *    fuso num campo à parte (e em nome do Windows). Pedindo UTC, todo horário é
 *    UTC e nada é adivinhado.
 *  - `IdType="ImmutableId"`: sem ele o id do evento MUDA quando o evento troca de
 *    calendário, e o vínculo com o compromisso se perderia.
 *  - `outlook.body-content-type="text"`: a descrição volta em texto, não em HTML.
 *
 * ─── Link de paginação só da própria Graph ─────────────────────────────────
 *
 * `@odata.nextLink` e `@odata.deltaLink` são URLs completas que a Graph devolve e
 * que guardamos no banco. Antes de mandar o token para uma delas, o endereço é
 * conferido: só `https://graph.microsoft.com/`. Sem isso, uma linha adulterada no
 * banco mandaria o token de alguém para outro servidor.
 */

import { z } from "zod";

import { RAIZ_DA_GRAPH } from "./enderecos";
import { GraphHttpError } from "./erros";

export { RAIZ_DA_GRAPH };

/**
 * O espaço de nomes das nossas propriedades estendidas no evento. CONTRATO DE
 * FIO, fixo para sempre: é por ele que reconhecemos, meses depois, que um evento
 * do Outlook é um compromisso nosso. As chaves são as mesmas do Google
 * (`deskcomm_org`, `deskcomm_appointment`, `deskcomm_v`).
 */
export const ESPACO_DAS_PROPRIEDADES = "{c6c1a3f4-2f6e-4f0b-9f2a-7d3b5e1a9c42}";
export const PROPRIEDADE_ORG = `String ${ESPACO_DAS_PROPRIEDADES} Name deskcomm_org`;
export const PROPRIEDADE_COMPROMISSO = `String ${ESPACO_DAS_PROPRIEDADES} Name deskcomm_appointment`;
export const PROPRIEDADE_VERSAO = `String ${ESPACO_DAS_PROPRIEDADES} Name deskcomm_v`;

const PREFER_DE_LEITURA = 'outlook.timezone="UTC", IdType="ImmutableId", outlook.body-content-type="text"';

const CAMPOS_DO_EVENTO = [
  "id",
  "subject",
  "body",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "showAs",
  "type",
  "seriesMasterId",
  "responseStatus",
  "attendees",
  "organizer",
  "location",
  "isOnlineMeeting",
  "onlineMeeting",
  "onlineMeetingProvider",
  "lastModifiedDateTime",
  "isOrganizer",
  "transactionId",
].join(",");

export type GraphFetch = typeof fetch;

const instanteSchema = z
  .object({ dateTime: z.string().nullable().optional(), timeZone: z.string().nullable().optional() })
  .passthrough();

export const eventoSchema = z
  .object({
    id: z.string().min(1),
    "@odata.etag": z.string().optional(),
    "@removed": z.object({ reason: z.string().optional() }).passthrough().optional(),
    subject: z.string().nullable().optional(),
    body: z.object({ contentType: z.string().optional(), content: z.string().nullable().optional() }).passthrough().nullable().optional(),
    start: instanteSchema.nullable().optional(),
    end: instanteSchema.nullable().optional(),
    isAllDay: z.boolean().nullable().optional(),
    isCancelled: z.boolean().nullable().optional(),
    showAs: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    seriesMasterId: z.string().nullable().optional(),
    responseStatus: z.object({ response: z.string().nullable().optional() }).passthrough().nullable().optional(),
    attendees: z
      .array(
        z
          .object({
            type: z.string().nullable().optional(),
            emailAddress: z.object({ address: z.string().nullable().optional(), name: z.string().nullable().optional() }).passthrough().nullable().optional(),
            status: z.object({ response: z.string().nullable().optional() }).passthrough().nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    organizer: z
      .object({ emailAddress: z.object({ address: z.string().nullable().optional() }).passthrough().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    location: z.object({ displayName: z.string().nullable().optional() }).passthrough().nullable().optional(),
    isOnlineMeeting: z.boolean().nullable().optional(),
    onlineMeeting: z.object({ joinUrl: z.string().nullable().optional() }).passthrough().nullable().optional(),
    onlineMeetingProvider: z.string().nullable().optional(),
    lastModifiedDateTime: z.string().nullable().optional(),
    isOrganizer: z.boolean().nullable().optional(),
    transactionId: z.string().nullable().optional(),
    singleValueExtendedProperties: z
      .array(z.object({ id: z.string(), value: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough();

export type EventoDaMicrosoft = z.infer<typeof eventoSchema>;

export const calendarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    isDefaultCalendar: z.boolean().nullable().optional(),
    canEdit: z.boolean().nullable().optional(),
    owner: z.object({ address: z.string().nullable().optional() }).passthrough().nullable().optional(),
    allowedOnlineMeetingProviders: z.array(z.string()).nullable().optional(),
    defaultOnlineMeetingProvider: z.string().nullable().optional(),
  })
  .passthrough();

export type CalendarioDaMicrosoft = z.infer<typeof calendarioSchema>;

const paginaSchema = z
  .object({
    value: z.array(z.unknown()).default([]),
    "@odata.nextLink": z.string().optional(),
    "@odata.deltaLink": z.string().optional(),
  })
  .passthrough();

/** Só URL da própria Graph recebe o token. */
export function linkDaGraph(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "graph.microsoft.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

async function corpoDaRecusa(r: Response): Promise<unknown> {
  try {
    const texto = (await r.text()).trim();
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

function retryAfterDe(r: Response): number | null {
  const bruto = r.headers.get("retry-after");
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface CursorDaLeituraMicrosoft {
  generation: string;
  mode: "full" | "incremental";
  /** Leitura incremental (delta) só existe no calendário padrão. */
  delta: boolean;
  /** O `deltaLink` da rodada anterior (modo incremental). */
  base: string | null;
  /** O `nextLink` da página em curso. */
  page: string | null;
  window_start: string;
  window_end: string;
}

export function graphTransport(accessToken: string, transporte: GraphFetch = fetch) {
  async function request(
    caminhoOuUrl: string,
    opcoes: {
      method?: string;
      body?: unknown;
      etag?: string | null;
      prefer?: string;
      alvo?: GraphHttpError["alvo"];
    } = {},
  ): Promise<unknown> {
    const url = caminhoOuUrl.startsWith("https://") ? linkDaGraph(caminhoOuUrl) : `${RAIZ_DA_GRAPH}${caminhoOuUrl}`;
    if (!url) throw new Error("Link de paginação fora da Microsoft Graph recusado.");
    const r = await transporte(url, {
      method: opcoes.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(opcoes.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opcoes.etag ? { "If-Match": opcoes.etag } : {}),
        ...(opcoes.prefer ? { Prefer: opcoes.prefer } : {}),
      },
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!r.ok) throw new GraphHttpError(r.status, retryAfterDe(r), await corpoDaRecusa(r), opcoes.alvo ?? "evento");
    if (r.status === 202 || r.status === 204) return null;
    const texto = await r.text();
    return texto.trim() ? JSON.parse(texto) : null;
  }

  const expandir = `$expand=singleValueExtendedProperties($filter=id eq '${PROPRIEDADE_ORG}' or id eq '${PROPRIEDADE_COMPROMISSO}')`;

  /** Um 404 do EVENTO pode ser do CALENDÁRIO: esta pergunta separa os dois. */
  async function conferirCalendario(calendarioId: string): Promise<void> {
    await request(`/me/calendars/${encodeURIComponent(calendarioId)}?$select=id`, {
      prefer: 'IdType="ImmutableId"',
      alvo: "calendario",
    });
  }

  return {
    request,
    conferirCalendario,

    /** Quem é a conta: id estável e e-mail. */
    async me(): Promise<{ id: string; email: string | null; nome: string | null }> {
      const r = z
        .object({
          id: z.string().min(1),
          mail: z.string().nullable().optional(),
          userPrincipalName: z.string().nullable().optional(),
          displayName: z.string().nullable().optional(),
        })
        .passthrough()
        .parse(await request("/me?$select=id,mail,userPrincipalName,displayName", { alvo: "conta" }));
      const email = r.mail?.trim() || (r.userPrincipalName?.includes("@") ? r.userPrincipalName.trim() : null);
      return { id: r.id, email, nome: r.displayName?.trim() || null };
    },

    /** Todas as agendas da conta, página a página. */
    async calendarios(): Promise<CalendarioDaMicrosoft[]> {
      const todos: CalendarioDaMicrosoft[] = [];
      let proxima: string | null =
        "/me/calendars?$select=id,name,isDefaultCalendar,canEdit,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider&$top=100";
      const vistos = new Set<string>();
      while (proxima) {
        const pagina = paginaSchema.parse(
          await request(proxima, { prefer: 'IdType="ImmutableId"', alvo: "calendario" }),
        );
        for (const bruto of pagina.value) todos.push(calendarioSchema.parse(bruto));
        const seguinte = pagina["@odata.nextLink"] ?? null;
        if (seguinte && vistos.has(seguinte)) throw new Error("Catálogo sem progresso. Tente atualizar novamente.");
        if (seguinte) vistos.add(seguinte);
        proxima = seguinte;
      }
      return todos;
    },

    /** Uma página da leitura de um calendário, conforme o cursor. */
    async pagina(calendarioId: string, cursor: CursorDaLeituraMicrosoft) {
      let caminho: string;
      if (cursor.page) caminho = cursor.page;
      else if (cursor.mode === "incremental" && cursor.base) caminho = cursor.base;
      else {
        const q = new URLSearchParams({ startDateTime: cursor.window_start, endDateTime: cursor.window_end });
        caminho = cursor.delta
          ? `/me/calendarView/delta?${q}`
          : `/me/calendars/${encodeURIComponent(calendarioId)}/calendarView?${q}&$select=${CAMPOS_DO_EVENTO}&$top=100`;
      }
      const pagina = paginaSchema.parse(
        await request(caminho, {
          prefer: `${PREFER_DE_LEITURA}, odata.maxpagesize=100`,
          alvo: "calendario",
        }),
      );
      return {
        eventos: pagina.value.map((v) => eventoSchema.parse(v)),
        proxima: pagina["@odata.nextLink"] ?? null,
        deltaLink: pagina["@odata.deltaLink"] ?? null,
      };
    },

    /** O evento exato (GET por id). `null` quando não existe mais. */
    async evento(eventoId: string, calendarioId?: string): Promise<EventoDaMicrosoft | null> {
      try {
        return eventoSchema.parse(
          await request(`/me/events/${encodeURIComponent(eventoId)}?$select=${CAMPOS_DO_EVENTO}&${expandir}`, {
            prefer: PREFER_DE_LEITURA,
          }),
        );
      } catch (e) {
        if (e instanceof GraphHttpError && (e.status === 404 || e.status === 410)) {
          if (calendarioId) await conferirCalendario(calendarioId);
          return null;
        }
        throw e;
      }
    },

    /**
     * O evento de um compromisso nosso, pela propriedade estendida. É como uma
     * criação cuja resposta se perdeu é reencontrada: a Microsoft escolhe o id,
     * então não dá para "tentar de novo com o mesmo id" como no Google.
     */
    async eventoDoCompromisso(calendarioId: string, compromissoId: string): Promise<EventoDaMicrosoft | null> {
      const filtro = `singleValueExtendedProperties/Any(ep: ep/id eq '${PROPRIEDADE_COMPROMISSO}' and ep/value eq '${compromissoId.replace(/'/g, "''")}')`;
      const pagina = paginaSchema.parse(
        await request(
          `/me/calendars/${encodeURIComponent(calendarioId)}/events?$filter=${encodeURIComponent(filtro)}&$select=${CAMPOS_DO_EVENTO}&${expandir}&$top=2`,
          { prefer: PREFER_DE_LEITURA, alvo: "calendario" },
        ),
      );
      const [primeiro] = pagina.value;
      return primeiro ? eventoSchema.parse(primeiro) : null;
    },

    async criar(calendarioId: string, corpo: Record<string, unknown>): Promise<EventoDaMicrosoft> {
      return eventoSchema.parse(
        await request(`/me/calendars/${encodeURIComponent(calendarioId)}/events`, {
          method: "POST",
          body: corpo,
          prefer: PREFER_DE_LEITURA,
          alvo: "calendario",
        }),
      );
    },

    async atualizar(eventoId: string, patch: Record<string, unknown>, etag: string | null): Promise<EventoDaMicrosoft> {
      if (!etag) throw new Error("Escrita sem versão remota recusada.");
      return eventoSchema.parse(
        await request(`/me/events/${encodeURIComponent(eventoId)}`, {
          method: "PATCH",
          body: patch,
          etag,
          prefer: PREFER_DE_LEITURA,
        }),
      );
    },

    /**
     * Cancela avisando os convidados (`/cancel`, só o organizador pode) ou apaga
     * quando não há convidado. 404/410 = já não existe = estado desejado.
     */
    async cancelar(eventoId: string, etag: string | null, comConvidados: boolean): Promise<void> {
      try {
        if (comConvidados) {
          await request(`/me/events/${encodeURIComponent(eventoId)}/cancel`, {
            method: "POST",
            body: { comment: "" },
          });
        } else {
          await request(`/me/events/${encodeURIComponent(eventoId)}`, { method: "DELETE", etag });
        }
      } catch (e) {
        if (e instanceof GraphHttpError && (e.status === 404 || e.status === 410)) return;
        throw e;
      }
    },

    async criarAssinatura(corpo: {
      resource: string;
      notificationUrl: string;
      lifecycleNotificationUrl: string;
      clientState: string;
      expirationDateTime: string;
    }): Promise<{ id: string; expirationDateTime: string }> {
      return z
        .object({ id: z.string().min(1), expirationDateTime: z.string() })
        .passthrough()
        .parse(
          await request("/subscriptions", {
            method: "POST",
            body: { changeType: "created,updated,deleted", ...corpo },
            alvo: "assinatura",
          }),
        );
    },

    async renovarAssinatura(id: string, expirationDateTime: string): Promise<{ expirationDateTime: string }> {
      return z
        .object({ expirationDateTime: z.string() })
        .passthrough()
        .parse(
          await request(`/subscriptions/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { expirationDateTime },
            alvo: "assinatura",
          }),
        );
    },

    async apagarAssinatura(id: string): Promise<void> {
      try {
        await request(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", alvo: "assinatura" });
      } catch (e) {
        if (e instanceof GraphHttpError && (e.status === 404 || e.status === 410)) return;
        throw e;
      }
    },
  };
}

export type GraphTransport = ReturnType<typeof graphTransport>;

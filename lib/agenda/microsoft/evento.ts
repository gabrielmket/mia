/**
 * A tradução entre um compromisso nosso e um evento do Outlook (Graph).
 *
 * Função pura, sem banco e sem rede, como `lib/agenda/google/evento.ts` do
 * upstream, e pela mesma razão: sincronização não falha com barulho, ela falha
 * escrevendo o horário errado. As regras de ocupação são as dele, traduzidas
 * para o vocabulário da Microsoft:
 *
 *   Google                     Microsoft
 *   status: cancelled          isCancelled / `@removed` (delta)
 *   transparency: transparent  showAs: free
 *   eventType: workingLocation showAs: workingElsewhere (marcador, não compromisso)
 *   attendee self declined     responseStatus.response: declined
 *   start.date (dia inteiro)   isAllDay + meia-noite (lida no fuso da organização)
 *
 * ─── O horário volta em UTC, e é de propósito ─────────────────────────────
 *
 * Toda leitura pede `Prefer: outlook.timezone="UTC"` (`transport.ts`). A Graph
 * devolve `dateTime` SEM deslocamento e o fuso num campo à parte, em nome do
 * Windows ("E. South America Standard Time"), que o `Intl` não conhece. Pedindo
 * UTC, o campo diz "UTC" e a leitura não adivinha nada. Se um dia vier outro
 * fuso, só é aceito se for IANA válido; senão a leitura é recusada com nome.
 *
 * A escrita também vai em UTC: o instante é o mesmo e o Outlook mostra no fuso
 * de quem abre. Mandar o IANA do compromisso só funcionaria para os fusos da
 * lista que a Graph aceita (`America/Manaus`, por exemplo, não está).
 */

import { participantesDoAgendamento } from "@/lib/agenda/google/evento";
import {
  groups,
  hash,
  type Base,
  type Group,
  type Projection,
} from "@/lib/agenda/google/sync-model";
import { instanteDaParede, primeiroInstanteDoDia } from "@/lib/agenda/google/tempo";
import { fusoValido } from "@/lib/tempo/fusos";

import {
  PROPRIEDADE_COMPROMISSO,
  PROPRIEDADE_ORG,
  PROPRIEDADE_VERSAO,
  type EventoDaMicrosoft,
} from "./transport";

// ─── VOLTA: Outlook → ocupação ─────────────────────────────────────────────

export interface EventoDaMicrosoftLido {
  evento_externo_id: string;
  /** ISO-8601 UTC. */
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  situacao: "confirmed" | "tentative";
  transparencia: "opaque" | "transparent";
  atualizado_la_em: string | null;
  /** Este evento tira horário da agenda? */
  ocupa: boolean;
}

export type MotivoDeRecusaMicrosoft = "sem_id" | "sem_instante" | "instante_invalido" | "fuso_invalido" | "serie_nao_expandida";

export type LeituraDeEventoMicrosoft =
  | { tipo: "evento"; evento: EventoDaMicrosoftLido }
  | { tipo: "cancelado"; externalEventId: string }
  | { tipo: "recusado"; motivo: MotivoDeRecusaMicrosoft; detalhe: string };

const DATA_E_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Lê o `dateTime` da Graph (sem deslocamento) no fuso que veio junto. */
function instanteDaGraph(dateTime: string | null | undefined, timeZone: string | null | undefined): Date | null {
  const texto = dateTime?.trim();
  if (!texto) return null;
  const m = DATA_E_HORA.exec(texto);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo] = m;
  const fuso = !timeZone || /^(utc|etc\/utc|gmt)$/i.test(timeZone.trim()) ? "UTC" : timeZone.trim();
  if (fuso !== "UTC" && !fusoValido(fuso)) return null;
  return instanteDaParede(
    {
      ano: Number(ano),
      mes: Number(mes),
      dia: Number(dia),
      hora: Number(hora),
      minuto: Number(minuto),
      segundo: segundo ? Number(segundo) : 0,
    },
    fuso,
  );
}

/** A data (AAAA-MM-DD) de um `dateTime` da Graph, para evento de dia inteiro. */
function dataDoCampo(dateTime: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateTime?.trim() ?? "");
  return m?.[1] ?? null;
}

export function doEventoDaMicrosoft(
  evento: EventoDaMicrosoft,
  opcoes: { fusoDoCalendario: string },
): LeituraDeEventoMicrosoft {
  const id = evento.id?.trim();
  if (!id) return { tipo: "recusado", motivo: "sem_id", detalhe: "evento sem `id`" };

  // Exclusão vem primeiro, antes de exigir horário: na delta a Microsoft anuncia
  // o evento apagado como `{ id, "@removed": { reason } }`, sem start nem end.
  if (evento["@removed"] || evento.isCancelled) return { tipo: "cancelado", externalEventId: id };

  // O `calendarView` já expande a série em ocorrências. Um mestre de série que
  // escapasse descreveria só a primeira ocorrência e esconderia as outras.
  if ((evento.type ?? "").toLowerCase() === "seriesmaster") {
    return { tipo: "recusado", motivo: "serie_nao_expandida", detalhe: "mestre de série fora do calendarView" };
  }

  if (!evento.start || !evento.end) return { tipo: "recusado", motivo: "sem_instante", detalhe: "evento sem start ou end" };

  let inicio: Date | null;
  let fim: Date | null;
  const diaInteiro = Boolean(evento.isAllDay);
  if (diaInteiro) {
    // Dia inteiro é "flutuante": a meia-noite é a do dia, não um instante. A data
    // é lida no fuso da agenda (o da organização quando a agenda não diz), e o
    // fim é exclusivo como no Google.
    const di = dataDoCampo(evento.start.dateTime);
    const df = dataDoCampo(evento.end.dateTime);
    if (!di || !df) return { tipo: "recusado", motivo: "instante_invalido", detalhe: "dia inteiro sem data legível" };
    inicio = primeiroInstanteDoDia(di, opcoes.fusoDoCalendario);
    fim = primeiroInstanteDoDia(df, opcoes.fusoDoCalendario);
    if (!inicio || !fim) {
      return fusoValido(opcoes.fusoDoCalendario)
        ? { tipo: "recusado", motivo: "instante_invalido", detalhe: `data ilegível: ${di} → ${df}` }
        : { tipo: "recusado", motivo: "fuso_invalido", detalhe: `fuso desconhecido: ${opcoes.fusoDoCalendario}` };
    }
  } else {
    inicio = instanteDaGraph(evento.start.dateTime, evento.start.timeZone);
    fim = instanteDaGraph(evento.end.dateTime, evento.end.timeZone);
    if (!inicio || !fim) {
      return { tipo: "recusado", motivo: "fuso_invalido", detalhe: "horário em fuso que não é UTC nem IANA" };
    }
  }
  if (fim.getTime() < inicio.getTime()) {
    return { tipo: "recusado", motivo: "instante_invalido", detalhe: "fim antes do início" };
  }

  const mostraComo = (evento.showAs ?? "").trim().toLowerCase();
  // `free` é o "Disponível" do Outlook: existe e não ocupa. `workingElsewhere` é
  // marcador de onde a pessoa trabalha, não compromisso. Qualquer outro valor
  // (inclusive ausente ou `unknown`) ocupa: errar para "livre" marca em cima de
  // compromisso real, e só esse erro desmarca cliente.
  const transparencia: "opaque" | "transparent" =
    mostraComo === "free" || mostraComo === "workingelsewhere" ? "transparent" : "opaque";
  const recusou = (evento.responseStatus?.response ?? "").trim().toLowerCase() === "declined";
  const atualizado = evento.lastModifiedDateTime ? new Date(evento.lastModifiedDateTime) : null;

  return {
    tipo: "evento",
    evento: {
      evento_externo_id: id,
      inicio: inicio.toISOString(),
      fim: fim.getTime() === inicio.getTime() ? new Date(inicio.getTime() + 60_000).toISOString() : fim.toISOString(),
      dia_inteiro: diaInteiro,
      situacao: mostraComo === "tentative" ? "tentative" : "confirmed",
      transparencia: recusou ? "transparent" : transparencia,
      atualizado_la_em: atualizado && !Number.isNaN(atualizado.getTime()) ? atualizado.toISOString() : null,
      ocupa: transparencia === "opaque" && !recusou,
    },
  };
}

// ─── IDA: compromisso → Outlook ────────────────────────────────────────────

export type SituacaoDoCompromisso = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface CompromissoParaMicrosoft {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: SituacaoDoCompromisso;
  location_kind: string;
  location_details?: string | null;
  meeting_url?: string | null;
  guest_email?: string | null;
  /** O tipo do compromisso é reunião do Teams (MIA, `mia_agenda_tipos_com_teams`). */
  teams?: boolean;
}

/** O texto que vai no "Local" do evento. Teams: o link fica no próprio evento, não aqui. */
export function localDoEventoMicrosoft(a: CompromissoParaMicrosoft): string {
  const detalhes = a.location_details?.trim() || "";
  if (a.teams) return "Microsoft Teams";
  switch (a.location_kind) {
    case "whatsapp":
      return detalhes ? `WhatsApp · ${detalhes}` : "WhatsApp";
    case "video_link":
      return a.meeting_url?.trim() || detalhes;
    case "google_meet":
      return detalhes || "Google Meet";
    default:
      return detalhes;
  }
}

function utcSemDeslocamento(iso: string, campo: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`compromisso com ${campo} inválido: ${JSON.stringify(iso)}`);
  return d.toISOString().replace(/Z$/, "");
}

export interface ParticipanteParaMicrosoft {
  emailAddress: { address: string; name?: string };
  type: "required";
}

export function participantesParaMicrosoft(input: {
  contactEmail?: string | null;
  contactName?: string | null;
  guestEmail?: string | null;
}): ParticipanteParaMicrosoft[] {
  // A MESMA lista do Google (e-mail da ficha, depois o convidado, sem repetir).
  return participantesDoAgendamento(input).map((p) => ({
    emailAddress: p.nome ? { address: p.email, name: p.nome } : { address: p.email },
    type: "required",
  }));
}

/**
 * O corpo do POST. Lança quando o compromisso não é traduzível: a linha é
 * nossa, e mandar evento pela metade é pior que não mandar.
 */
export function paraEventoDaMicrosoft(
  a: CompromissoParaMicrosoft,
  opcoes: { transactionId: string; participantes?: ParticipanteParaMicrosoft[]; pedirTeams?: boolean },
): Record<string, unknown> {
  const titulo = a.title?.trim();
  if (!titulo) throw new Error("compromisso sem título");
  const inicio = utcSemDeslocamento(a.starts_at, "starts_at");
  const fim = utcSemDeslocamento(a.ends_at, "ends_at");
  if (new Date(a.ends_at).getTime() < new Date(a.starts_at).getTime()) throw new Error("compromisso com fim antes do início");

  const corpo: Record<string, unknown> = {
    subject: titulo,
    body: { contentType: "text", content: a.description?.trim() ?? "" },
    start: { dateTime: inicio, timeZone: "UTC" },
    end: { dateTime: fim, timeZone: "UTC" },
    location: { displayName: localDoEventoMicrosoft(a) },
    // Compromisso nosso SEMPRE ocupa; aguardando confirmação aparece como provisório.
    showAs: a.status === "pending" ? "tentative" : "busy",
    transactionId: opcoes.transactionId,
    singleValueExtendedProperties: [
      { id: PROPRIEDADE_ORG, value: a.organization_id },
      { id: PROPRIEDADE_COMPROMISSO, value: a.id },
      { id: PROPRIEDADE_VERSAO, value: "1" },
    ],
  };
  if (opcoes.participantes && opcoes.participantes.length > 0) corpo.attendees = opcoes.participantes;
  if (opcoes.pedirTeams) {
    corpo.isOnlineMeeting = true;
    corpo.onlineMeetingProvider = "teamsForBusiness";
  }
  return corpo;
}

/** O id do compromisso gravado no evento (propriedade estendida), quando veio. */
export function compromissoDoEvento(e: EventoDaMicrosoft): { org: string | null; compromisso: string | null } {
  const props = e.singleValueExtendedProperties ?? [];
  const valor = (id: string) => props.find((p) => p.id.toLowerCase() === id.toLowerCase())?.value ?? null;
  return { org: valor(PROPRIEDADE_ORG), compromisso: valor(PROPRIEDADE_COMPROMISSO) };
}

// ─── As projeções da comparação de três vias ───────────────────────────────
//
// A comparação (`compare`, `checkpoint`, `hash`, `groups`) é a do upstream
// (`lib/agenda/google/sync-model.ts`), reaproveitada sem cópia. Aqui só mora
// como um compromisso e um evento do Outlook viram "projeção".

export function projecaoLocalMicrosoft(a: CompromissoParaMicrosoft): Projection {
  return {
    shared: {
      starts_at: new Date(a.starts_at).toISOString(),
      ends_at: new Date(a.ends_at).toISOString(),
      time_zone: a.time_zone,
      cancelled: a.status === "cancelled",
    },
    outbound: {
      title: hash(a.title?.trim()),
      description: hash(a.description?.trim() ?? ""),
      location: hash(localDoEventoMicrosoft(a)),
      guest: hash(a.guest_email?.trim().toLowerCase()),
    },
  };
}

/**
 * O evento do Outlook como projeção.
 *
 * Duas adaptações à Microsoft, as duas para não fabricar conflito:
 *
 *  - **fuso:** o Outlook guarda o fuso em nome do Windows, e a leitura pede UTC.
 *    Comparar o nome do fuso acusaria diferença em todo evento; o que se compara
 *    é o INSTANTE, e o fuso da projeção remota é o do compromisso.
 *  - **descrição:** o Outlook reescreve o corpo (e, com Teams, acrescenta o
 *    bloco de entrada da reunião). Se o nosso texto está lá dentro, é o nosso
 *    texto; se não está, a mudança feita no Outlook NÃO volta para o CRM (vale a
 *    última versão conhecida). A descrição é mandada daqui, nunca lida de lá.
 */
export function projecaoRemotaMicrosoft(
  e: EventoDaMicrosoft,
  local: Projection,
  base: Base | null,
  contexto: { descricaoLocal: string; fuso: string },
): Projection {
  const lido = doEventoDaMicrosoft(e, { fusoDoCalendario: contexto.fuso });
  if (lido.tipo === "recusado") throw new Error(lido.motivo);

  const geridos = new Set([local.outbound.guest, base?.remote.guest, base?.local.guest].filter(Boolean));
  const organizador = e.organizer?.emailAddress?.address?.trim().toLowerCase() ?? null;
  const convidados = (e.attendees ?? [])
    .map((p) => p.emailAddress?.address?.trim().toLowerCase() ?? "")
    .filter((email) => email && email !== organizador && geridos.has(hash(email)));

  const corpo = (e.body?.content ?? "").replace(/\r\n/g, "\n");
  const nossa = contexto.descricaoLocal.trim();
  const descricao =
    !nossa || corpo.includes(nossa) ? local.outbound.description : (base?.remote.description ?? local.outbound.description);

  return {
    shared:
      lido.tipo === "cancelado"
        ? { ...local.shared, cancelled: true }
        : { starts_at: lido.evento.inicio, ends_at: lido.evento.fim, time_zone: local.shared.time_zone, cancelled: false },
    outbound: {
      title: hash(e.subject?.trim() ?? ""),
      description: descricao,
      location: hash(e.location?.displayName?.trim() ?? ""),
      guest: hash(convidados.sort().join(",")),
    },
  };
}

/** O PATCH só com os grupos que mudaram aqui. RSVP e convidados de fora sobrevivem. */
export function deltaMicrosoft(
  a: CompromissoParaMicrosoft & { contact_email?: string | null; contact_nome?: string | null },
  e: EventoDaMicrosoft,
  base: Base | null,
  mudou: readonly Group[],
  compartilhado: boolean,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (compartilhado) {
    patch.start = { dateTime: utcSemDeslocamento(a.starts_at, "starts_at"), timeZone: "UTC" };
    patch.end = { dateTime: utcSemDeslocamento(a.ends_at, "ends_at"), timeZone: "UTC" };
    patch.showAs = a.status === "pending" ? "tentative" : "busy";
  }
  for (const g of mudou) {
    if (!groups.includes(g)) continue;
    if (g === "title") patch.subject = a.title.trim();
    if (g === "description") patch.body = { contentType: "text", content: a.description?.trim() ?? "" };
    if (g === "location") patch.location = { displayName: localDoEventoMicrosoft(a) };
    if (g === "guest") {
      const querido = a.guest_email?.trim().toLowerCase();
      const contato = a.contact_email?.trim().toLowerCase();
      const existentes = (e.attendees ?? []).filter((p) => p.emailAddress?.address);
      const mantidos = existentes.filter((p) => {
        const email = p.emailAddress!.address!.trim().toLowerCase();
        return hash(email) !== base?.remote.guest || email === querido;
      });
      const tem = (email: string) =>
        mantidos.some((p) => p.emailAddress?.address?.trim().toLowerCase() === email);
      const lista: Array<Record<string, unknown>> = mantidos.map((p) => ({
        emailAddress: p.emailAddress,
        type: p.type ?? "required",
      }));
      if (querido && !tem(querido)) lista.push({ emailAddress: { address: querido }, type: "required" });
      if (contato && !tem(contato) && contato !== querido) {
        lista.push({
          emailAddress: a.contact_nome?.trim() ? { address: contato, name: a.contact_nome.trim() } : { address: contato },
          type: "required",
        });
      }
      patch.attendees = lista;
    }
  }
  return patch;
}

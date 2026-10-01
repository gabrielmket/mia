/**
 * "Microsoft Teams" como local de atendimento, sem mexer no vocabulário dele.
 *
 * FORK MIA (9015, docs/fork/agenda-microsoft.md, 3.6). O local do upstream é
 * fechado por CHECK (`in_person`, `phone`, `whatsapp`, `video_link`,
 * `google_meet`); alargá-lo seria redefinir uma constraint dele. O Teams entra
 * como o que ele É: um link de vídeo. O tipo fica `video_link`, com
 * `location_details = 'Microsoft Teams'` (é o que a tela dele e o `onde` da IA
 * mostram: "Link de vídeo · Microsoft Teams") e uma linha em
 * `mia_agenda_tipos_com_teams`, que é o que faz a publicação no Outlook pedir a
 * reunião e gravar o link em `meeting_url`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { LOCAL_TEAMS, ROTULO_DO_TEAMS } from "./opcao-do-teams";

export { LOCAL_TEAMS, OPCAO_DO_TEAMS, ROTULO_DO_TEAMS } from "./opcao-do-teams";

/** Traduz o apelido para o vocabulário dele antes da validação da rota. */
export function localDoTeamsParaOUpstream(corpo: unknown): { corpo: unknown; teams: boolean } {
  if (!corpo || typeof corpo !== "object") return { corpo, teams: false };
  const c = corpo as Record<string, unknown>;
  if (c.location_kind !== LOCAL_TEAMS) return { corpo, teams: false };
  const detalhes = typeof c.location_details === "string" && c.location_details.trim() ? c.location_details : ROTULO_DO_TEAMS;
  return { corpo: { ...c, location_kind: "video_link", location_details: detalhes }, teams: true };
}

export async function marcarTipoComoTeams(admin: SupabaseClient, organizationId: string, tipoId: string): Promise<void> {
  const { error } = await admin
    .from("mia_agenda_tipos_com_teams")
    .upsert({ event_type_id: tipoId, organization_id: organizationId }, { onConflict: "event_type_id" });
  if (error) {
    logger.warn("[agenda.microsoft.teams] tipo criado sem a marca do Teams", { tipo: tipoId, erro: error.message });
  }
}

/** Os ids dos tipos Teams de uma empresa (para a tela rotular e avisar). */
export async function tiposComTeams(db: SupabaseClient, organizationId: string): Promise<Set<string>> {
  try {
    const { data } = await db
      .from("mia_agenda_tipos_com_teams")
      .select("event_type_id")
      .eq("organization_id", organizationId);
    return new Set(((data ?? []) as Array<{ event_type_id: string }>).map((l) => l.event_type_id));
  } catch {
    return new Set();
  }
}

/** A marcação feita pela IA num atendimento (o `meetingBooking` do upstream). */
export interface MarcacaoPelaIa {
  sourceJobId: string;
  boundary: { organization_id: string; contact_id: string };
}

/**
 * Quando a IA marca um tipo Teams numa conversa, guarda a autorização de
 * entrega do link (a fronteira do atendimento, o job de origem e o autor) no
 * espelho do compromisso. O compromisso nasce com a entrega em `none`, porque a
 * entrega do upstream, para `video_link`, enfileira na hora e mandaria sem o
 * link; quando o link fica pronto, `fn_mia_agenda_microsoft_teams` arma a
 * entrega com esta autorização e a máquina dele confere se o atendimento ainda
 * é o mesmo. Nunca derruba a marcação.
 */
export async function registrarEntregaDoTeamsPelaIa(opcoes: {
  organizationId: string;
  appointmentId: string;
  tipoId: string;
  contactId: string | null | undefined;
  marcacao: MarcacaoPelaIa | undefined;
  autor: { type: string; id: string };
}): Promise<void> {
  const { marcacao } = opcoes;
  if (!marcacao || opcoes.autor.type !== "ai_agent") return;
  if (marcacao.boundary.organization_id !== opcoes.organizationId || marcacao.boundary.contact_id !== opcoes.contactId) return;
  try {
    const admin = createAdminClient();
    const teams = await tiposComTeams(admin, opcoes.organizationId);
    if (!teams.has(opcoes.tipoId)) return;
    await admin.from("mia_agenda_microsoft_compromissos").upsert(
      {
        appointment_id: opcoes.appointmentId,
        organization_id: opcoes.organizationId,
        teams_pedido: true,
        teams_estado: "pendente",
        entrega_da_ia: {
          service_boundary: marcacao.boundary,
          source_operation_id: marcacao.sourceJobId,
          authorized_by: { kind: "ai_agent", id: opcoes.autor.id },
        },
      },
      { onConflict: "appointment_id" },
    );
  } catch (e) {
    logger.warn("[agenda.microsoft.teams] autorização de entrega não registrada", {
      compromisso: opcoes.appointmentId,
      erro: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface TeamsNaTelaDeTipos {
  disponivel: boolean;
  tiposComTeams: string[];
  pessoasComDestinoNoOutlook: string[];
  /** Nomes dos tipos Teams em que quem está vendo é quem atende. */
  tiposTeamsDaPessoa: string[];
}

/**
 * O que a tela de tipos e "Suas agendas" precisam saber do Teams. Só ids e nomes
 * de tipo (nada de agenda de ninguém), lidos pelo servidor porque a regra
 * "quem tem destino no Outlook" atravessa as pessoas da empresa.
 */
export async function teamsNaTelaDeTipos(opcoes: {
  organizationId: string;
  userId: string;
  microsoftConfigurada: boolean;
}): Promise<TeamsNaTelaDeTipos> {
  const vazio: TeamsNaTelaDeTipos = {
    disponivel: opcoes.microsoftConfigurada,
    tiposComTeams: [],
    pessoasComDestinoNoOutlook: [],
    tiposTeamsDaPessoa: [],
  };
  try {
    const admin = createAdminClient();
    const ids = [...(await tiposComTeams(admin, opcoes.organizationId))];
    const { data: destinos } = await admin
      .from("mia_agenda_microsoft_calendarios")
      .select("conexao_id, mia_agenda_microsoft_conexoes!inner(user_id, status)")
      .eq("organization_id", opcoes.organizationId)
      .eq("destino", true);
    const pessoas = ((destinos ?? []) as unknown as Array<{
      mia_agenda_microsoft_conexoes: { user_id: string; status: string } | Array<{ user_id: string; status: string }>;
    }>)
      .flatMap((d) => (Array.isArray(d.mia_agenda_microsoft_conexoes) ? d.mia_agenda_microsoft_conexoes : [d.mia_agenda_microsoft_conexoes]))
      .filter((c) => c.status === "healthy")
      .map((c) => c.user_id);
    let nomes: string[] = [];
    if (ids.length > 0) {
      const { data: tipos } = await admin
        .from("calendar_event_types")
        .select("name")
        .eq("organization_id", opcoes.organizationId)
        .eq("default_owner_user_id", opcoes.userId)
        .eq("is_active", true)
        .in("id", ids);
      nomes = ((tipos ?? []) as Array<{ name: string }>).map((t) => t.name);
    }
    return { ...vazio, tiposComTeams: ids, pessoasComDestinoNoOutlook: [...new Set(pessoas)], tiposTeamsDaPessoa: nomes };
  } catch {
    return vazio;
  }
}

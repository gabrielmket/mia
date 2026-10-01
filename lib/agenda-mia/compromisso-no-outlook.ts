/**
 * O bloco "Outlook" do detalhe de um compromisso (sincronização e Teams).
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 6.4). A rota de detalhe do upstream
 * (`/api/v1/agenda/agendamentos/[id]`) chama isto numa linha; aqui mora a
 * leitura do nosso espelho, pela MESMA sessão (a RLS dele é da empresa).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { conflitoMicrosoftSchema, type ConflitoMicrosoft } from "@/lib/agenda/microsoft/sync-executor";
import { teamsVideoUrl } from "@/lib/agenda/microsoft/teams";

export interface SincronizacaoOutlookDetalhe {
  revision: string;
  local_revision: string;
  etag: string | null;
  synced_at: string | null;
  error: string | null;
  pending: boolean;
  conflict: ConflitoMicrosoft | null;
  can_resolve: boolean;
}

export interface TeamsDetalhe {
  state: "nao_pedido" | "pendente" | "pronto" | "falhou" | "cancelado";
  error: string | null;
  url: string | null;
}

export interface OutlookDoCompromisso {
  /** O compromisso foi (ou está sendo) publicado no Outlook. */
  publicado: boolean;
  sync: SincronizacaoOutlookDetalhe | null;
  teams: TeamsDetalhe | null;
}

export async function outlookDoCompromisso(
  db: SupabaseClient,
  opcoes: {
    organizationId: string;
    appointmentId: string;
    userId: string;
    ownerUserId: string | null;
    revision: string;
    localRevision: string;
    meetingUrl: string | null;
  },
): Promise<OutlookDoCompromisso | null> {
  try {
    const { data } = await db
      .from("mia_agenda_microsoft_compromissos")
      .select("conexao_id, evento_id, etag, conflito, revisao_publicada, erro, sincronizado_em, teams_pedido, teams_estado, teams_erro")
      .eq("organization_id", opcoes.organizationId)
      .eq("appointment_id", opcoes.appointmentId)
      .maybeSingle();
    const m = data as {
      conexao_id: string | null;
      evento_id: string | null;
      etag: string | null;
      conflito: unknown;
      revisao_publicada: number | string;
      erro: string | null;
      sincronizado_em: string | null;
      teams_pedido: boolean;
      teams_estado: TeamsDetalhe["state"];
      teams_erro: string | null;
    } | null;
    if (!m) return null;
    const conflito = conflitoMicrosoftSchema.safeParse(m.conflito);
    const publicado = Boolean(m.conexao_id);
    return {
      publicado,
      sync: publicado
        ? {
            revision: opcoes.revision,
            local_revision: opcoes.localRevision,
            etag: m.etag,
            synced_at: m.sincronizado_em,
            error: m.erro,
            pending: BigInt(opcoes.localRevision) > BigInt(m.revisao_publicada ?? 0),
            conflict: conflito.success ? conflito.data : null,
            can_resolve: opcoes.ownerUserId === opcoes.userId,
          }
        : null,
      teams: m.teams_pedido
        ? {
            state: m.teams_estado,
            error: m.teams_erro,
            url: m.teams_estado === "pronto" ? teamsVideoUrl(opcoes.meetingUrl) : null,
          }
        : null,
    };
  } catch {
    // O detalhe do compromisso nunca cai por causa do Outlook.
    return null;
  }
}

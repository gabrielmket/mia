/**
 * O que o cartão do Outlook na Agenda precisa saber, montado no servidor.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 6.1). Mora aqui e não em
 * `app/app/agenda/page.tsx` (do upstream): lá entra uma linha que chama isto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  configuracaoDaMicrosoft,
  faltaParaConectarAMicrosoft,
  linkDeAprovacaoDoTi,
  origemPublicaDoPedido,
} from "@/lib/agenda/microsoft/config";

export interface ContaDoOutlookNoCartao {
  email: string;
  tipo: "trabalho" | "pessoal";
  status: string;
  ultimaLeituraEm: string | null;
  /** Alguma agenda desta conta tem a notificação da Microsoft ligada. */
  tempoReal: boolean;
}

export interface EstadoDoCartaoDoOutlook {
  configurado: boolean;
  falta: string[];
  /** Só para quem administra a instalação: a tela `/admin/microsoft`. */
  linkDeConfiguracao: string | null;
  contas: ContaDoOutlookNoCartao[];
  /** O link que o TI de uma empresa abre para aprovar o app (o erro raro). */
  linkDoTi: string | null;
}

export async function estadoDoCartaoDoOutlook(
  supabase: SupabaseClient,
  opcoes: {
    organizationId: string;
    userId: string;
    administraAInstalacao: boolean;
    cabecalhos: Pick<Headers, "get">;
  },
): Promise<EstadoDoCartaoDoOutlook> {
  const app = await configuracaoDaMicrosoft();
  const configurado = app !== null;
  let contas: ContaDoOutlookNoCartao[] = [];
  if (configurado) {
    const { data } = await supabase
      .from("mia_agenda_microsoft_conexoes")
      .select("id, conta_email, tipo_de_conta, status, ultima_leitura_em")
      .eq("organization_id", opcoes.organizationId)
      .eq("user_id", opcoes.userId)
      .neq("status", "disconnected")
      .order("conta_email");
    const linhas = (data ?? []) as Array<{
      id: string;
      conta_email: string;
      tipo_de_conta: "trabalho" | "pessoal";
      status: string;
      ultima_leitura_em: string | null;
    }>;
    const comTempoReal = new Set<string>();
    if (linhas.length > 0) {
      const { data: calendarios } = await supabase
        .from("mia_agenda_microsoft_calendarios")
        .select("conexao_id, assinatura_expira_em")
        .eq("organization_id", opcoes.organizationId)
        .in(
          "conexao_id",
          linhas.map((l) => l.id),
        )
        .gt("assinatura_expira_em", new Date().toISOString());
      for (const k of (calendarios ?? []) as Array<{ conexao_id: string }>) comTempoReal.add(k.conexao_id);
    }
    contas = linhas.map((c) => ({
      email: c.conta_email,
      tipo: c.tipo_de_conta,
      status: c.status,
      ultimaLeituraEm: c.ultima_leitura_em,
      tempoReal: comTempoReal.has(c.id),
    }));
  }
  return {
    configurado,
    falta: configurado ? [] : await faltaParaConectarAMicrosoft(),
    linkDeConfiguracao: opcoes.administraAInstalacao ? "/admin/microsoft" : null,
    contas,
    linkDoTi: app ? linkDeAprovacaoDoTi(app.clientId, origemPublicaDoPedido(opcoes.cabecalhos)) : null,
  };
}

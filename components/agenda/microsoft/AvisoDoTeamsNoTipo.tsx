"use client";

/**
 * A explicação do "Microsoft Teams" no formulário do tipo, e o aviso quando
 * quem atende não publica no Outlook. FORK MIA (docs/fork/agenda-microsoft.md, 6.3).
 */

import { useT } from "@/hooks/i18n/useT";
import { LOCAL_TEAMS } from "@/lib/agenda-mia/opcao-do-teams";

export interface TeamsNosTipos {
  /** A instalação tem o app da Microsoft: a opção aparece. */
  disponivel: boolean;
  /** Os tipos que são reunião do Teams (o rótulo da lista). */
  tiposComTeams: string[];
  /** Quem tem uma agenda do Outlook como destino. */
  pessoasComDestinoNoOutlook: string[];
}

export function AvisoDoTeamsNoTipo({
  local,
  dono,
  pessoasComOutlook,
}: {
  local: string;
  dono: { id: string; nome: string } | null;
  pessoasComOutlook: string[];
}) {
  const t = useT();
  if (local !== LOCAL_TEAMS) return null;
  return (
    <div className="flex flex-col gap-2 text-xs sm:col-span-2">
      <p className="rounded-md border border-border bg-surface-elevated/50 p-2 text-text-muted">
        {t(
          "O link do Teams é criado sozinho quando o compromisso vai para uma agenda do Outlook que permite Teams, e é enviado ao cliente pelo WhatsApp quando a IA marca. Quem atende este tipo precisa ter o Outlook como destino.",
        )}
      </p>
      {dono && !pessoasComOutlook.includes(dono.id) && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-bg p-2 text-text">
          <span className="font-medium">{dono.nome}</span>{" "}
          {t("não tem o Outlook como destino. Os compromissos deste tipo com essa pessoa ficam sem link do Teams.")}
        </p>
      )}
    </div>
  );
}

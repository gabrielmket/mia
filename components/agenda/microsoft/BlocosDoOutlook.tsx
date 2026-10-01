"use client";

/**
 * Os blocos do Outlook no detalhe do compromisso: a sincronização (entrega 2) e
 * a reunião do Teams (entrega 3). FORK MIA (docs/fork/agenda-microsoft.md, 6.4).
 * O `DetalheDoCompromisso` do upstream monta isto numa linha; com Teams, este
 * bloco toma o lugar do "Mandar ao cliente" dele (mesma entrega por baixo).
 */

import type { OutlookDoCompromisso } from "@/lib/agenda-mia/compromisso-no-outlook";
import type { MeetingDetail } from "../MeetDoCompromisso";

import { SincronizacaoOutlook } from "./SincronizacaoOutlook";
import { TeamsDoCompromisso } from "./TeamsDoCompromisso";

export function BlocosDoOutlook({
  id,
  revision,
  outlook,
  meeting,
  onSaved,
}: {
  id: string;
  revision: string;
  outlook: OutlookDoCompromisso;
  meeting?: MeetingDetail | null;
  onSaved: () => void;
}) {
  return (
    <>
      {outlook.sync && <SincronizacaoOutlook key={id} id={id} sync={outlook.sync} onSaved={onSaved} />}
      {outlook.teams && (
        <TeamsDoCompromisso id={id} revision={revision} teams={outlook.teams} meeting={meeting} onSaved={onSaved} />
      )}
    </>
  );
}

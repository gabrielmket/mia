"use client";

/**
 * Os blocos do Outlook no detalhe do compromisso: a sincronização (entrega 2) e
 * a reunião do Teams (entrega 3). FORK MIA (docs/fork/agenda-microsoft.md, 6.4).
 * O `DetalheDoCompromisso` do upstream monta isto numa linha.
 */

import type { OutlookDoCompromisso } from "@/lib/agenda-mia/compromisso-no-outlook";

import { SincronizacaoOutlook } from "./SincronizacaoOutlook";

export function BlocosDoOutlook({
  id,
  outlook,
  onSaved,
}: {
  id: string;
  outlook: OutlookDoCompromisso;
  onSaved: () => void;
}) {
  return <>{outlook.sync && <SincronizacaoOutlook key={id} id={id} sync={outlook.sync} onSaved={onSaved} />}</>;
}

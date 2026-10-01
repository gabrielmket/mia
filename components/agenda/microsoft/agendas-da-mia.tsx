/**
 * Decide, no servidor, se "Suas agendas" é a da MIA (Google e Outlook juntos) ou
 * a do upstream. FORK MIA (docs/fork/agenda-microsoft.md, 6.2).
 *
 * Sem o app da Microsoft na instalação, devolve `undefined` e a tela mostra o
 * `AgendasConectadas` de sempre: nada muda para quem não usa o Outlook.
 */

import type * as React from "react";

import { microsoftEstaConfigurada } from "@/lib/agenda/microsoft/config";

import { AgendasConectadasMia } from "./AgendasConectadasMia";

export async function agendasConectadasDaMia(opcoes: {
  organizationId: string;
  userId: string;
  tiposTeamsDaPessoa?: string[];
}): Promise<React.ReactNode | undefined> {
  if (!(await microsoftEstaConfigurada())) return undefined;
  return <AgendasConectadasMia tiposTeamsDaPessoa={opcoes.tiposTeamsDaPessoa ?? []} />;
}

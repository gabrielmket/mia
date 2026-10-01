/**
 * A reunião do Microsoft Teams no evento do Outlook: o pedido e a observação.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.6). O Teams é criado pelo próprio
 * evento (`isOnlineMeeting` + `onlineMeetingProvider: teamsForBusiness`), com o
 * escopo `Calendars.ReadWrite`, e só quando o calendário de destino lista
 * `teamsForBusiness` em `allowedOnlineMeetingProviders`. O link vem em
 * `onlineMeeting.joinUrl`; quando a resposta da criação ainda não o traz, a
 * próxima leitura do evento observa de novo (como o Meet `pending` do upstream).
 *
 * O link é tratado como o do Meet: só vale endereço do próprio Teams, sem
 * usuário, senha nem porta. Um link de outro domínio nunca chega ao cliente.
 */

import type { EventoDaMicrosoft } from "./transport";

export const PROVEDOR_DO_TEAMS = "teamsForBusiness";

/** Tentativas de observar o link antes de desistir (a Graph costuma devolver na hora). */
export const TETO_DE_TENTATIVAS_DO_TEAMS = 12;

export function teamsVideoUrl(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  try {
    const url = new URL(valor);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (host === "teams.microsoft.com" || host === "teams.live.com") &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export type ObservacaoDoTeams =
  | { estado: "pronto"; url: string }
  | { estado: "pendente" }
  | { estado: "falhou"; erro: "invalido" | "desconhecido" };

/** O que o evento diz sobre a reunião. `null` quando ele nem pediu Teams. */
export function observarTeams(evento: EventoDaMicrosoft): ObservacaoDoTeams | null {
  if (!evento.isOnlineMeeting) return null;
  const bruto = evento.onlineMeeting?.joinUrl ?? null;
  if (!bruto) return { estado: "pendente" };
  const url = teamsVideoUrl(bruto);
  return url ? { estado: "pronto", url } : { estado: "falhou", erro: "invalido" };
}

export function calendarioPermiteTeams(provedores: readonly string[] | null | undefined): boolean {
  return (provedores ?? []).includes(PROVEDOR_DO_TEAMS);
}

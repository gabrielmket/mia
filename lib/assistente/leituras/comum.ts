/**
 * FORK MIA (.88) — o que toda leitura do assistente compartilha.
 *
 * ── O cliente é o de quem chama, e no turno é o da SESSÃO ──────────────────
 *
 * Cada leitura recebe o `SupabaseClient` pronto e filtra a organização à mão
 * (defesa em profundidade). No TURNO o cliente é o da sessão de quem perguntou
 * (`turno.ts` recusa qualquer outro), e a RLS de cada tabela de origem filtra
 * como filtra nas telas. No resumo da manhã (cron, sem sessão), o cliente é o
 * de serviço, e o ESCOPO é o que impede a leitura de passar do que a pessoa vê:
 * `proprio` lê só o que é dela (dona da tarefa, do compromisso, da conversa, do
 * negócio); `equipe` só vale para gestor e administrador, que já enxergam a
 * empresa inteira nas telas.
 *
 * ── Dado pessoal ────────────────────────────────────────────────────────────
 *
 * Nenhuma leitura daqui devolve telefone, e-mail ou documento de contato, nem
 * texto de mensagem. O contato sai pelo NOME (`nomeDoContato`, a régua única),
 * e quando não há nome, "Contato sem nome" — nunca o número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleAtLeast, type Role } from "@/lib/auth/types";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

export type Escopo =
  /** Só o que é da pessoa. Atendente, vendedor e somente leitura. */
  | { tipo: "proprio"; userId: string }
  /** A empresa inteira. Só gestor e administrador. */
  | { tipo: "equipe"; userId: string };

/** O escopo que o papel tem nas telas: gestor e administrador veem a equipe. */
export function escopoDoPapel(papel: Role, userId: string): Escopo {
  return roleAtLeast(papel, "manager") ? { tipo: "equipe", userId } : { tipo: "proprio", userId };
}

export const SEM_NOME = "Contato sem nome";

/** O nome de cada contato pedido (nunca o telefone), lido com o cliente de quem chama. */
export async function nomesDosContatos(
  db: SupabaseClient,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0))].slice(0, 200);
  const nomes = new Map<string, string>();
  if (unicos.length === 0) return nomes;
  const { data } = await db
    .from("contacts")
    .select("id, name, display_name, is_anonymized")
    .eq("organization_id", organizationId)
    .in("id", unicos);
  for (const c of (data ?? []) as Array<{ id: string; name: string | null; display_name: string | null; is_anonymized: boolean | null }>) {
    nomes.set(c.id, c.is_anonymized ? "Contato anonimizado" : (nomeDoContato(c) ?? SEM_NOME));
  }
  return nomes;
}

/** Uma pessoa da equipe, como o assistente a nomeia. */
export interface PessoaDaEquipe {
  user_id: string;
  nome: string;
  papel: Role;
}

/** O nome de alguém da equipe, ou "alguém da equipe" quando o diretório não o tem. */
export function nomeDaPessoa(equipe: readonly PessoaDaEquipe[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  return equipe.find((p) => p.user_id === userId)?.nome ?? "alguém da equipe";
}

/** Horas inteiras entre dois instantes (nunca negativo). */
export function horasEntre(de: string | Date, ate: Date): number {
  const inicio = typeof de === "string" ? new Date(de) : de;
  return Math.max(0, Math.floor((ate.getTime() - inicio.getTime()) / 3_600_000));
}

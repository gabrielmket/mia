"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { OrigemDaMemoria } from "@/lib/ai/org-memory-source";

export interface OrgMemoryDocument {
  version_id: string;
  version_number: number;
  content: string;
  created_at: string;
}
export interface OrgMemoryVersionMeta {
  id: string;
  version_number: number;
  created_at: string;
}
/**
 * Quem escreveu o aprendizado — `manual`, `flywheel` ou `agent`.
 *
 * A LISTA NÃO MORA MAIS AQUI: ela é `ORIGENS_DA_MEMORIA`, em
 * `lib/ai/org-memory-source.ts`, e é de lá que ela é cobrada contra o CHECK de
 * `org_memory_entries.source` (tests/invariants/vocabulario-banco-x-typescript).
 * As duas linhagens consertaram o mesmo 23514 ao mesmo tempo, cada uma escreveu
 * a sua cópia do vocabulário, e a fusão trouxe as duas — que é exatamente o
 * modo de falha que uma constante compartilhada existe para fechar: a próxima
 * origem entraria numa das cópias e não na outra.
 *
 * Reexportado porque a tela (`app/app/ai/memory/_client.tsx`) pede o tipo a
 * este hook, junto com os outros que ela já importa daqui.
 */
export type { OrigemDaMemoria };

export interface OrgMemoryEntryRow {
  id: string;
  title: string;
  body: string;
  source: OrigemDaMemoria;
  status: "active" | "archived";
  created_at: string;
}
export interface OrgMemoryState {
  document: OrgMemoryDocument | null;
  versions: OrgMemoryVersionMeta[];
  entries: OrgMemoryEntryRow[];
}
export interface OrgMemoryVersionDetail {
  id: string;
  version_number: number;
  content: string;
  created_at: string;
}

const KEY = ["org-memory"];

export function useOrgMemory(initialData?: OrgMemoryState) {
  return useQuery({
    queryKey: KEY,
    ...(initialData !== undefined ? { initialData } : {}),
    queryFn: () => apiClient.get<{ data: OrgMemoryState }>("/api/v1/ai/memory").then((r) => r.data),
  });
}

export function usePublishOrgMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiClient.post<{ data: { version_id: string; version_number: number } }>("/api/v1/ai/memory", { content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateOrgMemoryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      apiClient.post<{ data: { id: string } }>("/api/v1/ai/memory/entries", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetOrgMemoryEntryStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: "archived" | "active" }) =>
      apiClient.patch<{ data: { id: string; status: string } }>(`/api/v1/ai/memory/entries/${input.id}`, { status: input.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Conteúdo de uma versão do histórico, buscado sob demanda ao abrir o Dialog. */
export function useOrgMemoryVersion(id: string | null) {
  return useQuery({
    queryKey: ["org-memory-version", id],
    enabled: id !== null,
    queryFn: () =>
      apiClient
        .get<{ data: OrgMemoryVersionDetail }>(`/api/v1/ai/memory/versions/${id}`)
        .then((r) => r.data),
  });
}

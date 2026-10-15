"use client";
/**
 * FORK MIA (9023) — gera um link curto NOVO para um convite pendente
 * (`POST /api/v1/team/invites/[id]/link-curto`). O anterior deixa de valer.
 */
import { useMutation } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface LinkCurtoGerado {
  id: string;
  link_curto: string;
  expires_at: string;
}

export function useLinkCurtoDoConvite() {
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.post<{ data: LinkCurtoGerado }>(`/api/v1/team/invites/${id}/link-curto`, {}),
    onError: showApiError,
  });
}

/**
 * FORK MIA (.91) — o critério do "o que falta" para quem está na sessão: lê o
 * estado do passo a passo e os retratos com o cliente da SESSÃO e responde
 * `oQueFaltaAparece`. Usado pelo Início (`/app/inicio`) e pela raiz de `/app`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/auth/types";

import { oQueFaltaAparece, type Criterio } from "./o-que-falta-aparece";

export async function criterioDaSessao(
  db: SupabaseClient,
  entrada: { organizationId: string; papel: Role | null | undefined; suporte: boolean },
): Promise<Criterio> {
  const { data } = await db
    .from("organizations")
    .select("onboarding_state, onboarded_at, demonstracao")
    .eq("id", entrada.organizationId)
    .maybeSingle();
  const org = data as { onboarding_state?: unknown; onboarded_at?: string | null; demonstracao?: boolean } | null;
  const base = {
    onboardingState: org?.onboarding_state ?? null,
    onboardedAt: org?.onboarded_at ?? null,
    papel: entrada.papel,
    demonstracao: org?.demonstracao === true,
    suporte: entrada.suporte,
  };
  // Primeiro sem o retrato: quem nem passa pelo critério não paga a leitura.
  const previo = oQueFaltaAparece({ ...base, zerou: false });
  if (!previo.aparece || previo.onde !== "inicio") return previo;
  const { data: zero } = await db
    .from("mia_assistente_retratos")
    .select("id")
    .eq("organization_id", entrada.organizationId)
    .eq("faltam", 0)
    .limit(1)
    .maybeSingle();
  return oQueFaltaAparece({ ...base, zerou: Boolean(zero) });
}

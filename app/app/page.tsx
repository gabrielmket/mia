import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { homeDaInterface } from "@/lib/navigation/interface";
// FORK MIA (.91): a empresa nova cai no Início ("o que falta") até zerar.
import { roleAtLeast } from "@/lib/auth/types";
import { criterioDaSessao } from "@/lib/onboarding/criterio-da-sessao";
import { createClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  // FORK MIA (.91): só gestor e administrador de uma empresa que passou pelo
  // passo a passo desta versão, até zerar (lib/onboarding/o-que-falta-aparece.ts).
  // A empresa que já roda não tem o segmento gravado e segue para a tela de sempre.
  if (org && roleAtLeast(org.role, "manager") && !user.support) {
    const criterio = await criterioDaSessao(await createClient(), {
      organizationId: org.orgId,
      papel: org.role,
      suporte: false,
    }).catch(() => null);
    if (criterio?.aparece) redirect("/app/inicio");
  }
  redirect(
    homeDaInterface(
      org?.interface_settings,
      user.is_platform_admin && !user.support,
      org?.role ?? null,
    ),
  );
}

import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { proximoPasso } from "@/lib/onboarding/passos";
import { env } from "@/lib/env";
// FORK MIA (.96): o passo "Pagamento" do início (docs/fork/pagamento-no-inicio.md).
import { situacaoDoPassoNoInicio } from "@/lib/pagamento-inicial/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * O roteador do wizard. A ORDEM não mora mais aqui: mora em
 * `lib/onboarding/passos.ts`, junto com os rótulos e o resumo final — eram três
 * listas independentes que discordavam, e a divergência aparecia como um passo
 * "Loja" fantasma no indicador de toda instalação pelo kit.
 */
export default async function OnboardingIndex() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // Sem organização o onboarding não tem o que mostrar — mas mandar para
  // `/login` fechava o círculo: quem entrasse de novo voltaria para cá. A saída
  // é a tela que CRIA a organização que falta.
  if (!activeOrg) redirect("/get-started");

  const { state, onboardedAt } = await loadOnboardingState(activeOrg.orgId);
  if (onboardedAt) redirect("/app/inbox");

  // FORK MIA (.96): na entrada paga e no plano com teste, o "Pagamento" vem primeiro.
  const pagamento = await situacaoDoPassoNoInicio(createAdminClient(), activeOrg.orgId);
  if (pagamento.modo !== null && !pagamento.cumprido) redirect("/onboarding/pagamento");

  const passo = proximoPasso(state, { lojaLigada: env.NUVEMSHOP_ENABLED });
  redirect(passo ? `/onboarding/${passo.segmento}` : "/onboarding/done");
}

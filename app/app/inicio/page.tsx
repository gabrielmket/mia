import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PrimeirosPassosComAssistente } from "@/components/assistente/PrimeirosPassosComAssistente";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { homeDaInterface } from "@/lib/navigation/interface";
import { criterioDaSessao } from "@/lib/onboarding/criterio-da-sessao";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Início" };

/**
 * FORK MIA (.91) — O INÍCIO DA EMPRESA NOVA: o "o que falta" e o assistente da
 * MIA ao lado, até zerar.
 *
 * Só existe para quem o critério deixa ver (lib/onboarding/o-que-falta-aparece.ts):
 * gestor ou administrador de uma empresa que passou pelo passo a passo desta
 * versão e ainda não zerou. Para todos os outros (e para a empresa que já
 * roda), a página manda para a tela inicial de sempre, e nada muda.
 *
 * A raiz de `/app` manda para cá quem tem o critério (o login cai aqui), e a
 * faixa do topo traz de volta de qualquer tela.
 */
export default async function InicioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const db = await createClient();
  const criterio = await criterioDaSessao(db, {
    organizationId: activeOrg.orgId,
    papel: activeOrg.role,
    suporte: Boolean(user.support),
  }).catch(() => null);
  // Quem ainda está no passo a passo continua nele (o bloco aparece ao lado do passo).
  if (criterio?.onde === "passo_a_passo") redirect("/onboarding");
  if (!criterio?.aparece) {
    redirect(homeDaInterface(activeOrg.interface_settings, user.is_platform_admin && !user.support, activeOrg.role ?? null));
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Primeiros passos", user.idioma)}</h1>
        <p className="text-sm text-text-muted">
          {traduzir(
            "O que ficou para depois continua aqui até zerar. O assistente prepara o agente, o funil e o follow-up para você aprovar; o resto é com você, pela tela.",
            user.idioma,
          )}
        </p>
      </header>
      <PrimeirosPassosComAssistente apareceInicial />
    </div>
  );
}

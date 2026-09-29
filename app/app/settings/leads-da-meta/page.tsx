/**
 * FORK MIA — Configurações › Formulários da Meta. Os leads dos anúncios de
 * cadastro instantâneo entrando sozinhos no funil (docs/fork/leads-da-meta.md).
 *
 * Admin, mesmo gate de Configurações › Meta Ads: é quem cola o token e quem
 * decide que formulário cria negócio em que funil. O token NÃO passa por aqui —
 * esta página só pergunta SE existe conexão; quem decifra é a rota, no servidor.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";

import { LeadsDaMetaClient } from "./_client";

export const metadata = { title: "Formulários da Meta" };
export const dynamic = "force-dynamic";

export default async function LeadsDaMetaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  if (!(await leadsDaMetaLiberados(createAdminClient(), activeOrg.orgId))) redirect("/403");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Formulários da Meta")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t(
            "Os leads dos anúncios de cadastro instantâneo (o formulário que abre dentro do Facebook e do Instagram) entram sozinhos no funil, a cada 5 minutos, com a origem do anúncio e as respostas do formulário. As automações de lead criado disparam como em qualquer captação.",
          )}
        </p>
      </header>
      <LeadsDaMetaClient />
    </div>
  );
}

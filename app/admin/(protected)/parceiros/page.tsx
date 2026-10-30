import { notFound } from "next/navigation";

import { ParceirosDaTime } from "@/components/admin/parceiros/ParceirosDaTime";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { lerConfiguracaoDaComissao } from "@/lib/parceiros/configuracao";
import { lerParceirosParaATela } from "@/lib/parceiros/leitura";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Parceiros" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.98) · /admin/parceiros (protótipo "Cupons e parceiros", tela 3). Os
 * dados do parceiro só a Time vê. Os Repasses do mês moram em
 * /admin/parceiros/repasses. Com a cobrança desligada, 404.
 */
export default async function ParceirosPage() {
  const { user } = await requirePlatformAdmin();
  const t = (s: string) => traduzir(s, normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null));
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) notFound();
  const [parceiros, config] = await Promise.all([lerParceirosParaATela(admin), lerConfiguracaoDaComissao(admin)]);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Parceiros")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("O parceiro tem os dados para o repasse, a comissão padrão (porcentagem e por quanto tempo) e a lista dos clientes que vieram pelos cupons dele.")}
        </p>
      </header>
      <ParceirosDaTime parceiros={parceiros} semAliquota={config.aliquota_pct === null} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { ContornoDoBloco } from "@/components/planos-mia/ContornoDoBloco";
import { ModulosDosPlanos } from "@/components/planos-mia/ModulosDosPlanos";
import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { lerPainelDosPlanos } from "@/lib/planos-mia/painel-dos-planos";
// FORK MIA (.98): o preço do setup de implantação de cada plano (docs/fork/cupons-e-parceiros.md).
import { PrecoDoSetupDosPlanos } from "@/components/admin/parceiros/PrecoDoSetupDosPlanos";
import { lerPrecosDoSetup } from "@/lib/setup-de-implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Módulos dos planos" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.90) — /admin/cobranca/modulos-dos-planos: os módulos, o preço do
 * Broadcast e o cartão da página de preços de cada plano (protótipo de
 * 25/10/2026, tela 4; docs/fork/jornada-de-assinatura.md).
 *
 * Mora numa página PRÓPRIA, e não dentro da aba Planos do upstream: lá o nome de
 * cada plano já aparece na lista dele, e repetir o nome num bloco nosso ao lado
 * confunde quem procura o plano pelo nome (o e2e do upstream o acha por texto). A
 * aba Planos leva só o link para cá. Mesmo portão da aba: admin de plataforma e
 * a cobrança ligada.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const t = (s: string) => traduzir(s, usuario.idioma);
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) notFound();
  const painel = await lerPainelDosPlanos(admin);
  const ativos = painel.planos.filter((p) => !p.arquivado).length;
  const precosDoSetup = await lerPrecosDoSetup(admin);

  return (
    <div className="space-y-4 p-6">
      <Link href="/admin/cobranca?aba=planos" className="text-sm text-muted-foreground hover:underline">
        {t("Voltar aos planos")}
      </Link>
      {ativos === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Ainda não há plano ativo. Crie o primeiro na aba Planos da Cobrança.")}
        </p>
      ) : (
        <ContornoDoBloco>
          <ModulosDosPlanos {...painel} />
          <div className="mt-4">
            <PrecoDoSetupDosPlanos
              planos={painel.planos.filter((p) => !p.arquivado).map((p) => ({ id: p.id, nome: p.nome, setup_cents: precosDoSetup.get(p.id) ?? null }))}
            />
          </div>
        </ContornoDoBloco>
      )}
    </div>
  );
}

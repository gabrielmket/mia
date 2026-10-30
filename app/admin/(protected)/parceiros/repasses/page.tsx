import { notFound } from "next/navigation";

import { RepassesDoMes } from "@/components/admin/parceiros/RepassesDoMes";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { competenciaPadrao, lerRepassesParaATela } from "@/lib/parceiros/leitura";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Repasses do mês" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.98) · /admin/parceiros/repasses?mes=AAAA-MM-01 (protótipo "Cupons e
 * parceiros", tela 4). Abre no último mês que o calendário fechou. A Time anexa a
 * nota ou o recibo, faz o Pix por fora e marca como pago.
 */
export default async function RepassesPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { user } = await requirePlatformAdmin();
  const t = (s: string) => traduzir(s, normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null));
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) notFound();
  const { mes } = await searchParams;
  const competencia = typeof mes === "string" && /^\d{4}-\d{2}-01$/.test(mes) ? mes : competenciaPadrao(new Date());
  const dados = await lerRepassesParaATela(admin, competencia);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Repasses do mês")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Toda mensalidade paga por um cliente de parceiro gera uma comissão. No começo do mês, a tela junta o que foi pago no mês anterior, desconta os estornos e mostra quanto repassar a cada um. A Time faz o Pix e marca como pago; o parceiro recebe o extrato por e-mail.")}
        </p>
      </header>
      <RepassesDoMes dados={dados} />
    </div>
  );
}

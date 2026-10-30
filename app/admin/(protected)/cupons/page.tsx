import { notFound } from "next/navigation";

import { CuponsDaTime } from "@/components/admin/parceiros/CuponsDaTime";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { lerCupons } from "@/lib/cupons/banco";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { lerParceiros } from "@/lib/parceiros/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Cupons" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.98) · /admin/cupons (protótipo "Cupons e parceiros", tela 2). Cupom e
 * parceiro só existem com a cobrança ligada: desligada, 404. As escritas pedem a
 * verificação em duas etapas nas rotas.
 */
export default async function CuponsPage() {
  const { user } = await requirePlatformAdmin();
  const t = (s: string) => traduzir(s, normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null));
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) notFound();
  const [cupons, parceiros, planos] = await Promise.all([
    lerCupons(admin),
    lerParceiros(admin),
    admin.from("cobranca_planos").select("id, nome, arquivado_em").order("nome"),
  ]);
  if (planos.error) throw new Error(`cupons: planos ilegíveis (${planos.error.code ?? "sem_codigo"})`);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Cupons")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Cada cupom diz o que dá (desconto em % ou em R$, por quantos meses, ou dias grátis), em quais planos vale, até quando, quantas vezes e de qual parceiro é.")}
        </p>
      </header>
      <CuponsDaTime
        cupons={cupons}
        planos={((planos.data ?? []) as Array<{ id: string; nome: string; arquivado_em: string | null }>).map((p) => ({ id: p.id, nome: p.nome, arquivado: p.arquivado_em !== null }))}
        parceiros={parceiros
          .filter((p) => !p.anonimizado_em)
          .map((p) => ({ id: p.id, nome: p.nome, comissao_pct: p.comissao_pct, comissao_meses: p.comissao_meses }))}
        enderecoDoSistema={(env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}
      />
    </div>
  );
}

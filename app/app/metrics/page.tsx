import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";

import { MetricsClient } from "./_components/MetricsClient";
import { PainelDeMetas } from "@/components/metas/PainelDeMetas";
import { RelatorioDeVendas } from "@/components/metas/RelatorioDeVendas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Desempenho" };

export default async function MetricsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // spec 13 §6.1: agent vê as próprias (RLS); a comparação por atendente é manager+.
  const canCompare = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma` (a cadeia pessoa → organização →
  // padrão vive em `lib/auth/server.ts`), sem reler o `locale` cru.
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Desempenho")}</h1>
          <p className="text-sm text-muted-foreground">
            {canCompare
              ? t("Atrito, funil e performance por atendente nos últimos 30 dias.")
              : t("Atrito, seu funil e sua performance nos últimos 30 dias.")}
          </p>
        </div>
        {/* FORK MIA (item 8): as duas portas da área de relatórios que moram ao
            lado de Desempenho — os doze painéis prontos (o que o link do dono
            mostra) e a tela da análise do funil do upstream (#1750), que era só
            API. Controles com 44px no celular: esta tela é medida em 360px por
            `tests/e2e/celular-cabe-na-tela.spec.ts`. */}
        <nav aria-label={t("Relatórios")} className="flex flex-wrap gap-2">
          <Link
            href="/app/paineis"
            className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Painéis prontos")}
          </Link>
          <Link
            href="/app/paineis/funil"
            className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Análise do funil")}
          </Link>
        </nav>
      </header>

      {/* A meta vem ANTES do diagnóstico: quem abre Desempenho quer primeiro
          saber se vai bater o mês, e só depois por que. */}
      <PainelDeMetas />

      {/* O relatório vem DEPOIS da meta e ANTES do diagnóstico do funil:
          quem abre quer saber se bate o mês (meta), depois o que aconteceu
          (relatório), e só então onde os negócios estão parados (funil). */}
      {canCompare ? <RelatorioDeVendas /> : null}

      <MetricsClient canCompare={canCompare} currentUserId={user.id} />
    </div>
  );
}

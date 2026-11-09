/**
 * FORK MIA (.107) — /raio-x/minha-area/<id>: o RELATÓRIO na área de quem pediu
 * (protótipo aprovado em 06/11/2026, tela 7). É o MESMO relatório do link do
 * dono (`RelatorioDoDono` com `dadosParaODono`): sem custo, sem as anotações
 * da Time e sem o bloco "o que a MIA resolveria". Os clientes aparecem só por
 * número de ordem.
 *
 * Só o raio-X da PRÓPRIA conta: outro id (ou um que não existe) responde 404, a
 * mesma página. Sem sessão, volta para a entrada. `?relatorio=` escolhe outro
 * relatório revisado do mesmo raio-X (o mensal).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RelatorioDoDono } from "@/components/raio-x/RelatorioDoRaioX";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { NOME_DO_COOKIE } from "@/lib/raio-x/acesso";
import { contaDoCookie, raioXDaContaPeloId } from "@/lib/raio-x/area";
import { dadosParaODono } from "@/lib/raio-x/relatorio";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: "Raio-X do atendimento" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ relatorio?: string }>;
}

export default async function RelatorioNaAreaPage({ params, searchParams }: PageProps) {
  const admin = createAdminClient();
  const conta = await contaDoCookie(admin, (await cookies()).get(NOME_DO_COOKIE)?.value);
  if (!conta) redirect("/raio-x/entrar");
  const { id } = await params;
  const achado = await raioXDaContaPeloId(admin, conta, id);
  if (!achado) notFound();
  const revisados = achado.relatorios.filter((r) => r.situacao === "revisado").sort((a, b) => b.sequencia - a.sequencia);
  const busca = await searchParams;
  const relatorio = revisados.find((r) => r.id === busca.relatorio) ?? revisados[0] ?? null;
  if (!relatorio) notFound();
  const idioma = await idiomaDoVisitante(null);
  const t = (s: string) => traduzir(s, idioma);
  const tag = tagDeIdioma(idioma);
  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 bg-bg px-4 py-6 text-text" data-raio-x="relatorio-da-area">
        <p className="text-sm">
          <Link href="/raio-x/minha-area" className="underline">
            {t("Voltar para Meus Raio-X")}
          </Link>
        </p>
        {revisados.length > 1 ? (
          <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("Relatórios deste Raio-X")}>
            {revisados.map((x) => (
              <Link
                key={x.id}
                href={`/raio-x/minha-area/${achado.raioX.id}?relatorio=${x.id}`}
                aria-current={x.id === relatorio.id ? "page" : undefined}
                className={x.id === relatorio.id ? "rounded-full bg-primary px-3 py-1 text-primary-foreground" : "rounded-full border border-border px-3 py-1"}
              >
                {x.competencia ? x.competencia.slice(0, 7) : `#${x.sequencia}`}
              </Link>
            ))}
          </nav>
        ) : null}
        <RelatorioDoDono dados={dadosParaODono(relatorio.dados)} comparacao={relatorio.comparacao} t={t} tag={tag} />
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-text-muted">{t("Quer comparar daqui a um tempo e ver se melhorou?")}</p>
          <Link href="/raio-x/minha-area/nova" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            {t("Pedir nova análise")}
          </Link>
        </section>
        <footer className="mt-auto border-t border-border pt-4 text-center text-xs text-text-muted">
          {t("Os seus clientes aparecem só por número de ordem. As conversas são apagadas dos servidores da Time em 30 dias; o relatório fica guardado para comparar com o próximo.")}
        </footer>
      </main>
    </IdiomaProvider>
  );
}

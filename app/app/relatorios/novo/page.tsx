import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { FONTES } from "@/lib/paineis/catalogo";
import { podeVerAnuncios } from "@/lib/relatorios/acesso";
import { dimensoesDaFonte, FONTES_DO_MONTADOR, medidasDaFonte, rotuloDaDimensao } from "@/lib/relatorios/catalogo";
import { rotuloDaMedida } from "@/lib/relatorios/apresentar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo relatório" };

/**
 * FORK MIA (item 9) — NOVO RELATÓRIO (protótipo, tela 2): primeiro a fonte, de
 * onde vêm os números. Cada fonte já sabe o que dá para medir e por onde
 * agrupar (o catálogo do motor), e o editor abre com uma conta que faz sentido
 * para ela. Anúncios é de gestor e administrador (o piso da tela de
 * Conversões): para os outros, o cartão diz isso em vez de sumir.
 */
export default async function NovoRelatorioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const anuncios = podeVerAnuncios(activeOrg.role);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <nav aria-label={t("Caminho")} className="text-sm text-text-muted">
        <Link href="/app/relatorios" className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">
          {t("Relatórios")}
        </Link>{" "}
        / {t("Novo relatório")}
      </nav>
      <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Novo relatório · o que medir")}</h1>
          <p className="text-sm text-text-muted">
            {t("Primeiro a fonte: de onde vêm os números. Cada fonte já sabe o que dá para medir e por onde agrupar. Depois o editor abre com uma conta que faz sentido para ela.")}
          </p>
        </div>
        <Link
          href="/app/relatorios"
          className="inline-flex min-h-11 shrink-0 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
        >
          {t("Começar de um pronto")}
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FONTES.map((fonte) => {
          const F = FONTES_DO_MONTADOR[fonte];
          const fechada = F.soGestor && !anuncios;
          const corpo = (
            <>
              <span className="text-base font-semibold">
                {t(F.nome)} {F.sub ? <small className="font-normal text-text-muted">({t(F.sub)})</small> : null}
              </span>
              <span className="text-sm">{t(F.frase)}</span>
              <small className="text-xs text-text-muted">
                {t("Mede")}: {medidasDaFonte(fonte).map((m) => rotuloDaMedida(m, fonte, t)).join(" · ")}
              </small>
              <small className="text-xs text-text-muted">
                {t("Agrupa por")}: {dimensoesDaFonte(fonte).map((d) => t(rotuloDaDimensao(fonte, d)).toLowerCase()).join(", ")}
              </small>
              {fechada ? <small className="text-xs text-warning-fg">{t("Esta fonte é de gestor e administrador.")}</small> : null}
            </>
          );
          return fechada ? (
            <div key={fonte} aria-disabled="true" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 opacity-60">
              {corpo}
            </div>
          ) : (
            <Link
              key={fonte}
              href={`/app/relatorios/editor?fonte=${fonte}`}
              className="flex min-h-11 flex-col gap-2 rounded-md border border-border bg-surface p-4 hover:border-accent"
            >
              {corpo}
            </Link>
          );
        })}
      </div>

      <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <h2 className="font-semibold">{t("O que não entra no montador")}</h2>
        <ul className="list-disc pl-5 text-sm text-text-muted">
          <li>
            <b>{t("Custo do agente.")}</b> {t("O cliente vê consumo (conversas atendidas, na fonte Atendimento), não custo. Essa conta é da plataforma.")}
          </li>
          <li>
            <b>{t("Gasto com anúncio.")}</b> {t("A fonte Anúncios mostra o que o sistema informou à Meta e ao Google, não quanto foi gasto.")}
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * FORK MIA (.101) — /raio-x/relatorio/<token>: o relatório do raio-X para o DONO
 * (protótipo, tela 5; o molde do link dos painéis, 9031).
 *
 * Rota pública. Teto por IP antes de olhar o token; a prévia do WhatsApp
 * recebe uma página neutra e não conta acesso; token malformado, inexistente,
 * vencido, revogado ou de relatório que não foi revisado: a MESMA página de
 * "não está disponível" (404). O acesso é contado e auditado sem identificar a
 * pessoa.
 *
 * O que NÃO aparece aqui, de propósito: o custo da análise, as anotações da
 * Time e o bloco "o que a MIA resolveria" (decisão 9). Os clientes aparecem só
 * por número de ordem.
 */
import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { RelatorioDoDono } from "@/components/raio-x/RelatorioDoRaioX";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { ehVisitaDePrevia } from "@/lib/paineis/link";
import { resolverLinkDoDono } from "@/lib/raio-x/banco";
import { dadosParaODono } from "@/lib/raio-x/relatorio";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: "Raio-X do atendimento" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Raio-X do atendimento" },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RelatorioDoDonoPage({ params }: PageProps) {
  const { token } = await params;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);
  const tag = tagDeIdioma(idioma);

  if (await authRateLimited("raio_x_dono", null, { ip: 30, windowSec: 60 })) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Aguarde um minuto e abra o link de novo.")}</p>
      </Moldura>
    );
  }
  if (ehVisitaDePrevia((await headers()).get("user-agent"))) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Raio-X do atendimento")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Abra o link para ver o relatório.")}</p>
      </Moldura>
    );
  }
  if (!isServiceRoleConfigured()) notFound();
  const resolvido = await resolverLinkDoDono(createAdminClient(), token, true);
  if (!resolvido) notFound();
  void audit({
    action: "raio_x.link_do_dono_acessado",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x_links",
    resourceId: resolvido.link.id,
    requestId: randomUUID(),
    metadata: { raio_x_id: resolvido.raioX.id, relatorio_id: resolvido.relatorio.id },
  });
  const validoAte = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(
    new Date(resolvido.link.validoAte),
  );
  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 bg-bg px-4 py-6 text-text">
        <RelatorioDoDono dados={dadosParaODono(resolvido.relatorio.dados)} comparacao={resolvido.relatorio.comparacao} t={t} tag={tag} />
        <footer className="mt-auto border-t border-border pt-4 text-center text-xs text-text-muted">
          {t("Link válido até")} {validoAte}.{" "}
          {resolvido.relatorio.dados.fonte === "conversas_da_mia"
            ? t("Os seus clientes aparecem só por número de ordem. As conversas continuam só na sua conta da MIA; o relatório fica guardado para comparar com o próximo.")
            : t("Os seus clientes aparecem só por número de ordem. As conversas são apagadas dos servidores da Time em 30 dias; o relatório fica guardado para comparar com o próximo.")}
        </footer>
      </main>
    </IdiomaProvider>
  );
}

function Moldura({ idioma, children }: { idioma: Awaited<ReturnType<typeof idiomaDoVisitante>>; children: React.ReactNode }) {
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
      </div>
    </IdiomaProvider>
  );
}

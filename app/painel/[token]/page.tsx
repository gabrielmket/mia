/**
 * FORK MIA (9031) — /painel/<token>: os painéis prontos para o DONO DO NEGÓCIO.
 *
 * Rota pública (`lib/auth/public-paths.ts`), fora de `app/app/`, aberta no
 * celular de quem recebeu o link (protótipo aprovado em 15/10/2026, tela 8).
 * O porquê do token, o tamanho e onde ele mora estão em `lib/paineis/link.ts`.
 *
 * O que esta página faz, e só isto:
 *
 *  1. Conta a tentativa no teto por IP (30 por minuto, balde próprio do
 *     limitador da autenticação), ANTES de olhar o token: quem passou do teto
 *     recebe a mesma resposta para endereço bom e ruim.
 *  2. A prévia do WhatsApp e afins (que abrem o link sozinhos para montar o
 *     cartão) recebe uma página neutra, sem ir ao banco: nem o nome da empresa
 *     sai para o servidor de quem monta a prévia, e a visita não conta acesso.
 *  3. Resolve o token pelo hash. Malformado, inexistente, vencido, revogado ou
 *     de empresa parada: a MESMA página de "não está disponível", com 404
 *     (`not-found.tsx` deste segmento), sem dizer qual dos casos é.
 *  4. Link vivo: calcula os painéis do link com o cliente de serviço e a
 *     organização DA LINHA (nunca da URL), conta o acesso e audita sem
 *     identificar a pessoa.
 *  5. FORK MIA (9042): o link de um PAINEL DO MONTADOR mostra os relatórios
 *     daquele painel, na ordem e no tamanho dele (`lib/relatorios/link.ts`),
 *     menos os que identificam pessoa da equipe, e diz quantos ficaram de fora.
 *
 * Os METADADOS são fixos e neutros: nem o nome da empresa nem número nenhum
 * aparecem no título, na descrição ou no cartão de prévia.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { GradeDePaineis } from "@/components/paineis/CartoesDosPaineis";
import { GradeDoPainel } from "@/components/relatorios/GradeDoPainel";
import { isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { traduzir } from "@/lib/i18n/dicionario";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import type { Idioma } from "@/lib/i18n/idiomas";
import {
  ehPeriodoDosPaineis,
  FRASE_DO_PERIODO,
  PERIODOS_DOS_PAINEIS,
  PERIODO_PADRAO,
  ROTULO_DO_PERIODO,
  type PeriodoDosPaineis,
} from "@/lib/paineis/catalogo";
import { calcularPaineis } from "@/lib/paineis/calcular";
import { ehVisitaDePrevia, LIMITE_DA_PAGINA, registrarAcesso, resolverLink } from "@/lib/paineis/link";
import { calcularPainelDoDono, type PainelDoLink } from "@/lib/relatorios/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fixos e neutros: a prévia do WhatsApp lê isto, e daqui não sai dado nenhum.
export const metadata: Metadata = {
  title: { absolute: "Painel de resultados" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Painel de resultados" },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ periodo?: string }>;
}

export default async function PainelDoDonoPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const busca = await searchParams;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  if (await authRateLimited("paineis_do_dono", null, { ip: LIMITE_DA_PAGINA.porMinuto, windowSec: 60 })) {
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
        <h1 className="text-xl font-semibold">{t("Painel de resultados")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Abra o link para ver o painel.")}</p>
      </Moldura>
    );
  }

  if (!isServiceRoleConfigured()) notFound();
  const admin = createAdminClient();
  const resolvido = await resolverLink(admin, token);
  if (!resolvido) notFound();

  const { link } = resolvido;
  const periodo: PeriodoDosPaineis =
    link.periodo === "escolhe" ? (ehPeriodoDosPaineis(busca.periodo) ? busca.periodo : PERIODO_PADRAO) : link.periodo;

  // O painel do montador (9042) ou os prontos (9031). A empresa vem da linha do link.
  let doMontador: PainelDoLink | null = null;
  if (link.painelId) {
    doMontador = await calcularPainelDoDono(admin, {
      organizationId: resolvido.organizationId,
      painelId: link.painelId,
      periodo,
      valores: link.mostrarValores,
    });
    if (!doMontador) notFound();
  }
  const calculados = await calcularPaineis(admin, {
    organizationId: resolvido.organizationId,
    periodo,
    paineis: link.painelId ? ["resultado"] : link.paineis,
    pipelineId: link.pipelineId,
    valores: link.mostrarValores,
  });
  await registrarAcesso(admin, resolvido, periodo);

  const tag = tagDeIdioma(idioma);
  const fuso = calculados.empresa.fuso;
  const atualizado = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: fuso }).format(
    new Date(calculados.calculadoEm),
  );
  const validoAte = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: fuso }).format(
    new Date(link.validoAte),
  );
  const iniciais = calculados.empresa.nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 bg-bg px-4 py-6 text-text">
        <header className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
          >
            {iniciais}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{calculados.empresa.nome}</h1>
            <p className="text-sm text-text-muted">
              {t("Resultados")} · {t(FRASE_DO_PERIODO[periodo])} · {t("atualizado às")} {atualizado}
            </p>
          </div>
        </header>

        {calculados.empresa.demonstracao ? (
          <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
            {t("Demonstração: os números desta página são de dados fictícios.")}
          </p>
        ) : null}

        {link.periodo === "escolhe" ? (
          <nav aria-label={t("Período")} className="flex flex-wrap gap-2">
            {PERIODOS_DOS_PAINEIS.map((p) => (
              <Link
                key={p}
                href={`?periodo=${p}`}
                aria-current={p === periodo ? "page" : undefined}
                className={
                  p === periodo
                    ? "inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-base text-primary-foreground lg:min-h-8 lg:text-sm"
                    : "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-base lg:min-h-8 lg:text-sm"
                }
              >
                {t(ROTULO_DO_PERIODO[p])}
              </Link>
            ))}
          </nav>
        ) : null}

        {doMontador ? (
          <>
            <h2 className="text-lg font-semibold">{doMontador.nome}</h2>
            <GradeDoPainel itens={doMontador.itens} />
            {doMontador.deFora > 0 ? (
              <p className="text-xs text-text-muted">
                {doMontador.deFora} {t("relatórios deste painel ficam só dentro do sistema, porque mostram pessoas da equipe.")}
              </p>
            ) : null}
          </>
        ) : (
          <GradeDePaineis calculados={calculados} f={{ t, tag, moeda: calculados.empresa.moeda }} />
        )}

        <footer className="mt-auto border-t border-border pt-4 text-xs text-text-muted">
          {t("Números somados, sem dados pessoais de clientes.")} {t("Link válido até")} {validoAte}.
        </footer>
      </main>
    </IdiomaProvider>
  );
}

function Moldura({ idioma, children }: { idioma: Idioma; children: React.ReactNode }) {
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
      </div>
    </IdiomaProvider>
  );
}

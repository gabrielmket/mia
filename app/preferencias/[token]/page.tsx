/**
 * FORK MIA (.89) — /preferencias/<token>: a PÁGINA DE PREFERÊNCIAS do e-mail
 * marketing, sem login (protótipo, tela 8).
 *
 * Quem abre é a pessoa que recebeu o e-mail, pelo link do rodapé ou pelo
 * "descadastrar" (que chega aqui com `?sair=1`: o GET NUNCA descadastra, porque
 * filtro de segurança abre link sozinho). O token é assinado
 * (`lib/email-marketing/token.ts`, o formato do convite e do #1738) e leva a
 * empresa e o destinatário; a página confere a linha no banco.
 *
 *  1. Conta a tentativa no teto por IP, ANTES de olhar o token.
 *  2. Prévia de link (WhatsApp, robô de segurança) recebe página neutra, sem ir
 *     ao banco: nem o nome da empresa sai.
 *  3. Token ruim ou de linha que não existe: a MESMA página "indisponível", 404.
 *  4. Token bom: o nome da empresa, o endereço mascarado, a situação (recebe ou
 *     saiu), sair (e, se quiser, sair também do marketing pelo WhatsApp) e
 *     voltar a receber, que SÓ a própria pessoa faz, e só por aqui.
 *  5. O e-mail de TESTE abre a página no modo de teste: nada muda.
 *
 * Metadados fixos e neutros, `noindex`, sem referenciador.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PreferenciasDoEmail } from "@/components/email-marketing/PreferenciasDoEmail";
import { isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { mascararEmail } from "@/lib/email-marketing/endereco";
import { resolverQuemRecebe, situacaoDaPessoa } from "@/lib/email-marketing/preferencias";
import { comEmpresa, TEXTO_PADRAO_DE_PRIVACIDADE } from "@/lib/email-marketing/textos-padrao";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import type { Idioma } from "@/lib/i18n/idiomas";
import { ehVisitaDePrevia } from "@/lib/paineis/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: "Preferências de e-mail" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Preferências de e-mail" },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ sair?: string; aba?: string }>;
}

export default async function PreferenciasDoEmailPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const busca = await searchParams;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  if (
    await authRateLimited("email_marketing_preferencias_pagina", null, { ip: 30, windowSec: 60 })
  ) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t("Aguarde um minuto e abra o link de novo.")}
        </p>
      </Moldura>
    );
  }

  if (ehVisitaDePrevia((await headers()).get("user-agent"))) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Preferências de e-mail")}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t("Abra o link para ver as suas preferências.")}
        </p>
      </Moldura>
    );
  }

  if (!isServiceRoleConfigured()) notFound();
  const admin = createAdminClient();
  const quem = await resolverQuemRecebe(admin, token);
  if (!quem) notFound();
  const situacao = await situacaoDaPessoa(admin, quem);

  const privacidadePropria = quem.privacidade.url;
  const privacidadePadrao =
    !privacidadePropria && quem.privacidade.usarPadrao
      ? TEXTO_PADRAO_DE_PRIVACIDADE.map((p) => comEmpresa(t(p), quem.empresa.nome))
      : null;

  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 bg-bg px-4 py-8 text-text">
        <header className="space-y-1">
          <p className="text-sm text-text-muted">{t("Preferências de e-mail")}</p>
          <h1 className="text-2xl font-semibold">{quem.empresa.nome}</h1>
          {quem.email ? (
            <p className="text-sm text-text-muted">{mascararEmail(quem.email)}</p>
          ) : null}
        </header>
        <PreferenciasDoEmail
          token={token}
          teste={quem.teste}
          empresaNome={quem.empresa.nome}
          situacaoInicial={situacao}
          sairEscolhido={busca.sair === "1"}
          abaInicial={busca.aba === "privacidade" ? "privacidade" : "preferencias"}
          privacidadeUrl={privacidadePropria}
          privacidadeTexto={privacidadePadrao}
        />
      </main>
    </IdiomaProvider>
  );
}

function Moldura({ idioma, children }: { idioma: Idioma; children: React.ReactNode }) {
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
          {children}
        </div>
      </div>
    </IdiomaProvider>
  );
}

/**
 * FORK MIA (.101) — /raio-x/<código>: a página de CONEXÃO do raio-X do
 * atendimento (protótipo, tela 3; docs/fork/raio-x-do-atendimento.md).
 *
 * Rota pública (`lib/auth/public-paths.ts`). Quem abre é o dono da empresa, sem
 * conta, pelo link que a Time mandou. O que esta página faz, e só isto:
 *
 *  1. conta a tentativa no teto por IP, ANTES de olhar o código;
 *  2. a prévia do WhatsApp e afins (que abrem o link sozinhas para montar o
 *     cartão) recebe uma página neutra, sem ir ao banco: nem o nome da empresa
 *     sai para o servidor de quem monta a prévia;
 *  3. resolve o código pelo hash. Malformado, inexistente ou de raio-X
 *     encerrado: a MESMA página de "não está disponível" (404);
 *  4. mostra a etapa: o termo, a conexão (código ou QR), o andamento, pronto.
 *
 * Os METADADOS são fixos e neutros.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ConexaoDoDono } from "@/components/raio-x/ConexaoDoDono";
import { isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { ehVisitaDePrevia } from "@/lib/paineis/link";
import { raioXPeloCodigo } from "@/lib/raio-x/banco";
import { LIMITE_DA_PAGINA, ROTULO_DO_LIMITE_DA_PAGINA, situacaoPublica } from "@/lib/raio-x/publico";
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
  params: Promise<{ codigo: string }>;
}

export default async function ConexaoDoRaioXPage({ params }: PageProps) {
  const { codigo } = await params;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  if (await authRateLimited(ROTULO_DO_LIMITE_DA_PAGINA, null, LIMITE_DA_PAGINA)) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Aguarde alguns minutos e abra o link de novo.")}</p>
      </Moldura>
    );
  }
  if (ehVisitaDePrevia((await headers()).get("user-agent"))) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Raio-X do atendimento")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Abra o link para autorizar e conectar.")}</p>
      </Moldura>
    );
  }
  if (!isServiceRoleConfigured()) notFound();
  const r = await raioXPeloCodigo(createAdminClient(), codigo);
  if (!r) notFound();
  return (
    <IdiomaProvider locale={idioma}>
      <ConexaoDoDono codigo={codigo.toUpperCase()} inicial={situacaoPublica(r)} />
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

/**
 * FORK MIA (.107) — /raio-x/entrar: a entrada SEM SENHA na área do Raio-X
 * (protótipo aprovado em 06/11/2026, tela 5). E-mail → código de 6 números no
 * e-mail → a área. Quem já tem a sessão vai direto para a área.
 *
 * Rota pública (`lib/auth/public-paths.ts`). `?email=` preenche o campo e
 * `?motivo=ja_usou` diz que a grátis daquele número ou e-mail já foi usada (o
 * cadastro manda para cá).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EntrarNaArea } from "@/components/raio-x/AreaDoRaioX";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { limparEmail } from "@/lib/raio-x/aceite";
import { NOME_DO_COOKIE } from "@/lib/raio-x/acesso";
import { contaDoCookie } from "@/lib/raio-x/area";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Entrar · Raio-X do atendimento" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

interface PageProps {
  searchParams: Promise<{ email?: string; motivo?: string }>;
}

export default async function EntrarPage({ searchParams }: PageProps) {
  // A sessão vale e a conta existe: direto para a área (sem a conta, fica aqui, sem laço).
  const valor = (await cookies()).get(NOME_DO_COOKIE)?.value;
  if (valor && (await contaDoCookie(createAdminClient(), valor))) redirect("/raio-x/minha-area");
  const busca = await searchParams;
  const idioma = await idiomaDoVisitante(null);
  return (
    <IdiomaProvider locale={idioma}>
      <EntrarNaArea emailInicial={limparEmail(busca.email ?? "").slice(0, 160)} jaUsou={busca.motivo === "ja_usou"} />
    </IdiomaProvider>
  );
}

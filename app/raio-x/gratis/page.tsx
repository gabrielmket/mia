/**
 * FORK MIA (.106) — /raio-x/gratis: o cadastro do RAIO-X GRÁTIS na página do
 * próprio sistema (protótipo aprovado em 06/11/2026, tela 1). O formulário do
 * site iamia.com.br é o principal; esta página é para quem chega por outro
 * link, e posta no MESMO endereço (`POST /api/v1/publico/raio-x/cadastro`).
 *
 * Rota pública (`lib/auth/public-paths.ts`). Lê da URL só o que ajuda a pessoa:
 * o `?erro=` que o cadastro devolveu, o `?email=` (o e-mail do "tentar de novo")
 * e a origem (utm, gclid, fbclid), que segue escondida no formulário.
 */
import type { Metadata } from "next";

import { CadastroGratis } from "@/components/raio-x/CadastroGratis";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { limparEmail } from "@/lib/raio-x/aceite";
import { CAMPOS_DE_ORIGEM, camposDoErro, PERIODO_DO_GRATIS, type CampoDeOrigem } from "@/lib/raio-x/cadastro";
import { textoDoTermo } from "@/lib/raio-x/termo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Raio-X do atendimento grátis" },
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** O termo v1 com o que o cadastro ainda não sabe no lugar da empresa e do número. */
function termoDeExemplo(): string {
  return textoDoTermo({ empresa: "[a sua empresa]", whatsapp: "550000000000", periodoDias: PERIODO_DO_GRATIS, tipo: "unico" }).replaceAll(
    "(00) 0000-0000",
    "[o WhatsApp analisado]",
  );
}

export default async function CadastroGratisPage({ searchParams }: PageProps) {
  const busca = await searchParams;
  const um = (k: string) => {
    const v = busca[k];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
  };
  const origem: Partial<Record<CampoDeOrigem, string>> = {};
  for (const c of CAMPOS_DE_ORIGEM) {
    const v = um(c).trim().slice(0, 200);
    if (v) origem[c] = v;
  }
  const idioma = await idiomaDoVisitante(null);
  return (
    <IdiomaProvider locale={idioma}>
      <CadastroGratis inicial={{ email: limparEmail(um("email")).slice(0, 160), erros: camposDoErro(um("erro")), origem, termo: termoDeExemplo() }} />
    </IdiomaProvider>
  );
}

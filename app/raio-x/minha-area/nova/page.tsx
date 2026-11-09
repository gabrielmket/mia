/**
 * FORK MIA (.107) — /raio-x/minha-area/nova: a NOVA ANÁLISE (protótipo aprovado
 * em 06/11/2026, tela 8). Avulsa (paga uma vez) ou mensal (todo dia 1), com o
 * preço que a Time definiu; sem preço ativo, o pedido vira interesse e a equipe
 * fala com a pessoa. O pagamento é a fatura do Asaas (Pix, boleto ou cartão).
 *
 * O CPF ou CNPJ só é pedido quando há preço e a conta ainda não é cliente do
 * Asaas: o Asaas exige o documento para gerar o Pix e o boleto (o molde de
 * `lib/cobranca/documento.ts`), e ele vai direto ao Asaas, sem ficar guardado.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NovaAnalise } from "@/components/raio-x/AreaDoRaioX";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { NOME_DO_COOKIE } from "@/lib/raio-x/acesso";
import { contaDoCookie } from "@/lib/raio-x/area";
import { raioXDaConta } from "@/lib/raio-x/contas";
import { lerPrecos, precoAtivo } from "@/lib/raio-x/pedidos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: "Nova análise · Raio-X do atendimento" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function NovaAnalisePage() {
  const admin = createAdminClient();
  const conta = await contaDoCookie(admin, (await cookies()).get(NOME_DO_COOKIE)?.value);
  if (!conta) redirect("/raio-x/entrar");
  const [precos, raioX] = await Promise.all([lerPrecos(admin), raioXDaConta(admin, conta.id)]);
  const idioma = await idiomaDoVisitante(null);
  const t = (s: string) => traduzir(s, idioma);
  const anterior = raioX[0] ?? null;
  return (
    <IdiomaProvider locale={idioma}>
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 bg-bg px-4 py-8 text-text" data-raio-x="nova-analise">
        <p className="text-sm">
          <Link href="/raio-x/minha-area" className="underline">
            {t("Voltar para Meus Raio-X")}
          </Link>
        </p>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("Nova análise")}</h1>
          <p className="text-sm text-text-muted">
            {anterior
              ? t("Do mesmo WhatsApp da {empresa}. Escolha como quer seguir; o pagamento é pelo Asaas, no Pix ou no cartão.").replace("{empresa}", anterior.empresa)
              : t("Ainda não há um Raio-X nesta conta para repetir.")}
          </p>
        </header>
        {anterior ? (
          <section className="rounded-lg border border-border bg-surface p-5">
            <NovaAnalise
              precos={(["avulsa", "mensal"] as const).map((tipo) => ({ tipo, valorCentavos: precoAtivo(precos, tipo) }))}
              pedeDocumento={!conta.asaas_cliente_id}
              tag={tagDeIdioma(idioma)}
            />
          </section>
        ) : (
          <p className="text-sm">
            <a href="/raio-x/gratis" className="underline">
              {t("Fazer o cadastro grátis")}
            </a>
          </p>
        )}
      </main>
    </IdiomaProvider>
  );
}

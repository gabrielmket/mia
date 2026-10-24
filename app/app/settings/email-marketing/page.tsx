import type { Metadata } from "next";

import { ConfiguracaoDoEmailMarketing } from "@/components/email-marketing/ConfiguracaoDoEmailMarketing";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "E-mail marketing" };

/**
 * FORK MIA (.89) — Configurações › E-mail marketing: o domínio verificado na
 * Amazon e os seis registros, os remetentes e o "responder para", o rodapé
 * obrigatório, o ritmo, o aquecimento, a saúde, a lista de supressão, os textos
 * de consentimento e a importação de aceites (docs/fork/email-marketing.md).
 *
 * manager+ abre e vê; só o admin muda (as rotas recusam pelo mesmo critério).
 * A atendente não chega aqui: o que ela faz é registrar o consentimento na
 * ficha do contato.
 */
export default async function EmailMarketingPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const org = await resolveActiveOrg(user);
  const podeVer = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  return (
    <div className="flex h-full flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{t("E-mail marketing")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Domínio, remetentes, rodapé, ritmo e lista de supressão das campanhas de e-mail.")}
        </p>
      </header>
      {podeVer ? (
        <ConfiguracaoDoEmailMarketing />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(
            "A configuração de e-mail é do administrador. O que a atendente faz é registrar o consentimento na ficha do contato.",
          )}
        </p>
      )}
    </div>
  );
}

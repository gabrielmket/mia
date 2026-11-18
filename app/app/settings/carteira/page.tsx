import type { Metadata } from "next";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { traduzir } from "@/lib/i18n/dicionario";
import { CarteiraDaEmpresa } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Créditos" };

export default async function CarteiraPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const org = await resolveActiveOrg(user);
  // manager+: o extrato diz quanto a empresa gastou, e isso não é informação de
  // atendente. A rota da API recusa pelo mesmo critério — a guarda daqui é para
  // a porta não abrir, não para o dado não vazar.
  const podeVer = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* FORK MIA: o cabeçalho comum das subtelas (volta ao índice), do upstream. */}
      <CabecalhoDaSubTela className="min-w-0" titulo={t("Créditos")} idioma={user.idioma}>
        <p className="text-sm text-muted-foreground">
          {t("Quanto crédito a empresa tem para disparos, e o que já foi consumido.")}
        </p>
      </CabecalhoDaSubTela>
      {podeVer ? (
        <CarteiraDaEmpresa />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Esta tela é de quem gerencia a empresa.")}
        </p>
      )}
    </div>
  );
}

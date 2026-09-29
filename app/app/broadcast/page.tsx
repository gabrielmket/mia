import type { Metadata } from "next";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { MiaBroadcast } from "@/components/broadcast/MiaBroadcast";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Broadcast" };

export default async function BroadcastPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const org = await resolveActiveOrg(user);
  // manager+: cada mensagem gasta dinheiro do cliente, e quem atende não decide
  // gastar. A rota recusa pelo mesmo critério — aqui é para a porta não abrir.
  const podeVer = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Broadcast</h1>
        <p className="text-sm text-muted-foreground">
          {t("Enviar para uma lista pela API oficial da Meta, com template aprovado e cobrança por mensagem.")}
        </p>
      </header>
      {podeVer ? (
        <MiaBroadcast />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Esta tela é de quem gerencia a empresa.")}
        </p>
      )}
    </div>
  );
}

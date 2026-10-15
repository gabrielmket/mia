/**
 * FORK MIA (9023) — /c/<código>: o LINK CURTO do convite de equipe.
 *
 * Rota pública (`lib/auth/public-paths.ts`). O porquê, o tamanho do código e
 * onde ele mora estão em `lib/team/link-curto.ts`.
 *
 * O que esta página faz, e só isto:
 *
 *  1. Conta a tentativa no teto por IP (o limitador do login e do aceite,
 *     balde próprio). Antes de olhar o código: a resposta de quem passou do
 *     teto é a mesma para código bom e ruim.
 *  2. Resolve o código pelo hash. Código malformado, que não existe, de
 *     convite vencido, aceito ou revogado: a MESMA tela de "convite inválido
 *     ou expirado" da página de aceite, sem dizer qual dos casos é.
 *  3. Convite pendente: redireciona para `/team/accept-invite/<token>`, a
 *     página de aceite de sempre, com o token re-assinado a partir da linha
 *     (`linkDeAceite`, o mesmo que a tela de Equipe usa). Daí em diante é o
 *     fluxo de sempre: login, criar conta, e-mail que não bate.
 *
 * NÃO grava nada. O Outlook, o Hotmail e o WhatsApp abrem o link sozinhos
 * (conferência de segurança, prévia) e essa visita não pode gastar o convite:
 * quem aceita é o botão da página de aceite (server action). Também não tem
 * metadados próprios: a prévia do WhatsApp mostra o título padrão da
 * instalação, e o e-mail do convidado e o nome da empresa não aparecem em
 * metadado nenhum, nem aqui nem na página de aceite.
 */
import { redirect } from "next/navigation";

import { isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkDeAceite } from "@/lib/team/convites";
import {
  LIMITE_DO_LINK_CURTO,
  ROTULO_DO_LIMITE_DO_LINK_CURTO,
  resolverLinkCurto,
} from "@/lib/team/link-curto";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ codigo: string }>;
}

export default async function LinkCurtoDoConvitePage({ params }: PageProps) {
  const { codigo } = await params;

  // Quem abre o link vem de fora (WhatsApp, e-mail): o cookie de sessão
  // (`sameSite: "strict"`) não viaja nessa navegação, então o idioma é o do
  // navegador.
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  if (await authRateLimited(ROTULO_DO_LIMITE_DO_LINK_CURTO, null, LIMITE_DO_LINK_CURTO)) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Aguarde alguns minutos e abra o link do convite de novo.")}
        </p>
      </Moldura>
    );
  }

  const convite = isServiceRoleConfigured()
    ? await resolverLinkCurto(createAdminClient(), codigo)
    : null;

  if (!convite) {
    return (
      <Moldura idioma={idioma}>
        <h1 className="text-xl font-semibold">{t("Convite inválido ou expirado")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Este link não é válido ou o prazo do convite já passou. Peça um novo convite a quem administra a sua empresa.",
          )}
        </p>
      </Moldura>
    );
  }

  // Caminho, não endereço: o destino é sempre a página de aceite DESTA
  // instalação, nunca um host vindo de fora.
  redirect(new URL(linkDeAceite(convite)).pathname);
}

// A mesma moldura da página de aceite (`app/team/accept-invite/[token]/page.tsx`):
// é o `IdiomaProvider` que acerta o `lang` do documento fora da árvore do `/app`.
function Moldura({ idioma, children }: { idioma: Idioma; children: React.ReactNode }) {
  return (
    <IdiomaProvider locale={idioma}>
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">{children}</div>
      </div>
    </IdiomaProvider>
  );
}

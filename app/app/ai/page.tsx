import type { Metadata } from "next";
import { NavHub } from "@/components/shell/NavHub";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { modulosDaOrganizacao } from "@/lib/modulos/liberacao";
import { modoDeVendaDaOrganizacao } from "@/lib/empresas/modo-de-venda";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agente MIA" };

/**
 * Hub da área de IA.
 *
 * Substitui as abas que só apareciam para quem JÁ estava dentro de `/app/ai/*`:
 * Conhecimento, Credenciais, Uso, Casos e Alertas eram invisíveis de qualquer
 * outro lugar do sistema. Aqui as dez telas aparecem juntas, na jornada de quem
 * opera um agente — montar, ensinar, acompanhar.
 *
 * Passa `locale` (o padrão do `NavHub` é pt-BR): sem isso o hub inteiro ficava
 * em português mesmo com idioma=es — títulos, seções e descrições.
 */
export default async function AiHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const idioma = user.idioma;
  // O hub é INVENTÁRIO: ele mostra o que existe. Módulo não contratado não
  // existe para esta empresa, então some daqui pelo mesmo critério do menu.
  const modulos = activeOrg
    ? [...(await modulosDaOrganizacao(await createClient(), activeOrg.orgId))]
    : undefined;
  // O mesmo critério do menu (item C2): quem vende para pessoa não vê a
  // entidade empresa nem no inventário.
  const modoDeVenda = activeOrg
    ? await modoDeVendaDaOrganizacao(await createClient(), activeOrg.orgId)
    : undefined;

  return (
    <NavHub
      group="ia"
      isPlatformAdmin={user.is_platform_admin && !user.support}
      role={activeOrg?.role ?? null}
      interfaceSettings={activeOrg?.interface_settings}
      modulos={modulos}
      modoDeVenda={modoDeVenda}
      // Obrigatório desde o upstream (B1 do #1573): sem a lista, o cartão de
      // "Fluxos de atendimento" aparecia numa instalação sem o módulo e o
      // clique dava 404.
      modulosLigados={await modulosLigados(createAdminClient())}
      // O título é a marca do produto ("Agente MIA", não "Agente de IA"), mas
      // ainda passa pelo dicionário: a entrada existe e a chave é o texto em
      // português, então quem usa es vê a marca sem cair em português cru no
      // resto do hub. O upstream não mudou o título — só encostou nesta linha
      // ao acrescentar `modulosLigados` logo acima.
      title={traduzir("Agente MIA", idioma)}
      subtitle={traduzir(
        "Tudo que define quem atende por você — e como acompanhar o que ele faz.",
        idioma,
      )}
      locale={idioma}
    />
  );
}

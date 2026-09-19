import type { Metadata } from "next";
import { NavHub } from "@/components/shell/NavHub";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { modulosDaOrganizacao } from "@/lib/modulos/liberacao";
import { modoDeVendaDaOrganizacao } from "@/lib/empresas/modo-de-venda";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CRM" };

/**
 * Hub do CRM.
 *
 * Nasceu de uma promessa escrita: o comentário de densidade do `Sidebar.tsx`
 * dizia que, quando o quinto destino de CRM aparecesse, o conserto seria criar
 * o hub do grupo — e não raspar mais alguns pixels de padding. Tarefas (PR
 * #546) foi o quinto, e a dobra de 900px estourou em 13px.
 *
 * O sidebar fica com o que se abre todo dia (Funis, Contatos, Tarefas); o que
 * se define uma vez (Produtos, Etapas do funil) fica aqui. As duas seções são a
 * mesma régua escrita por extenso: o hub não é a sobra do menu, é o inventário
 * do grupo — Funis, Contatos e Tarefas aparecem aqui também.
 *
 * Passa `locale` (o padrão do `NavHub` é pt-BR): quem escolheu espanhol lê o
 * título, o subtítulo e as seções em espanhol, e não uma tela meio traduzida.
 */
export default async function CrmHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
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
  const idioma = user.idioma;

  return (
    <NavHub
      group="crm"
      isPlatformAdmin={user.is_platform_admin && !user.support}
      role={activeOrg?.role ?? null}
      interfaceSettings={activeOrg?.interface_settings}
      modulos={modulos}
      modoDeVenda={modoDeVenda}
      title={traduzir("CRM", idioma)}
      subtitle={traduzir(
        "Onde a venda acontece — e o que você define uma vez para ela funcionar.",
        idioma,
      )}
      locale={idioma}
    />
  );
}

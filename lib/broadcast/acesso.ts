import "server-only";

/**
 * FORK MIA — a porta das telas do Broadcast, lida no servidor.
 *
 * Uma função para as três telas nossas (`/app/broadcast`, `/novo`, `/[id]`) e
 * para a faixa das telas de Campanhas (`app/app/campaigns/layout.tsx`): quatro
 * cópias da mesma conferência seriam quatro lugares para um dia só três
 * aprenderem o motivo novo. A decisão em si é pura e testada
 * (`decidirAcesso`, em `canais-do-disparo.ts`); aqui só se juntam os insumos.
 *
 * O menu já esconde a porta de quem não tem o módulo, mas esconder não é
 * recusar: link salvo e favorito continuam chegando. Quem recusa de verdade são
 * as rotas de API; esta tela recusa para a pessoa entender por quê, em vez de ver
 * uma lista vazia.
 */
import { resolveActiveOrg, requireAuth } from "@/lib/auth/server";
import { roleAtLeast, type AuthUser } from "@/lib/auth/types";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createClient } from "@/lib/supabase/server";

import { decidirAcesso, MODULO_DO_BROADCAST, type AcessoAoBroadcast } from "./canais-do-disparo";

export async function acessoAoBroadcast(): Promise<{ user: AuthUser; acesso: AcessoAoBroadcast }> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const papelSuficiente = !!org && roleAtLeast(org.role, "manager");
  // Só pergunta ao banco quando a resposta muda alguma coisa.
  const contratado =
    !!org && papelSuficiente
      ? await moduloLiberado(await createClient(), org.orgId, MODULO_DO_BROADCAST)
      : false;
  return {
    user,
    acesso: decidirAcesso({ temOrganizacao: !!org, papelSuficiente, contratado }),
  };
}

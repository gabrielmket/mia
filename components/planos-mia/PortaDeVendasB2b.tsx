import type { ReactNode } from "react";

import { ForaDoPlano } from "@/components/planos-mia/ForaDoPlano";
import { loadAuthUser, orgAtivaSemPortao } from "@/lib/auth/server";
import { crmB2bForaDoPlanoDaSessao } from "@/lib/planos-mia/crm-b2b-da-sessao";

/**
 * FORK MIA (.90) — a porta das telas de Vendas B2B (Pessoas e Importações).
 *
 * Com a cobrança desligada, ou para a empresa isenta, devolve a tela como
 * sempre. Com a cobrança ligada e a empresa num plano sem Vendas B2B, mostra
 * "não está no plano" (as rotas já recusam com 403). O módulo da instalação
 * desligado continua sendo a resposta das rotas do upstream (404).
 */
export async function PortaDeVendasB2b({ children }: { children: ReactNode }) {
  if (!(await crmB2bForaDoPlanoDaSessao())) return children;
  const user = await loadAuthUser();
  const org = user ? await orgAtivaSemPortao(user) : null;
  return (
    <ForaDoPlano
      modulo="crm_b2b"
      idioma={user?.idioma ?? "pt-BR"}
      administra={org?.role === "admin"}
    />
  );
}

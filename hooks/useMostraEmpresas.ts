"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { mostraEmpresas } from "@/lib/empresas/modo-de-venda";

/**
 * Esta organização enxerga a entidade empresa? (item C2)
 *
 * Um hook e não `useAuth().activeOrg?.modo_de_venda === "b2b"` espalhado pelas
 * telas: a pergunta que a tela faz é "mostro o campo?", e quem escreve um
 * formulário não deveria precisar saber que B2B é o modo que mostra.
 *
 * ⚠️ NÃO é autorização. As rotas de `/api/v1/empresas` continuam atendendo — o
 * modo esconde a porta, não tranca. Ver `lib/empresas/modo-de-venda.ts`.
 *
 * Ausente devolve `true`: na dúvida o produto mostra de mais. Esconder um campo
 * porque o contexto ainda não carregou faria o operador abrir o cadastro, não
 * achar a empresa, e concluir que o sistema perdeu o dado.
 */
export function useMostraEmpresas(): boolean {
  const { activeOrg } = useAuth();
  return mostraEmpresas(activeOrg?.modo_de_venda);
}

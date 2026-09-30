"use client";

import { usePermission } from "@/hooks/auth/AuthProvider";

/**
 * FORK MIA: a pessoa enxerga a equipe no formulário do negócio?
 *
 * É o mesmo piso da reatribuição (spec 13 §4: escrita no funil é agent+), e
 * decide se o seletor de "quem originou a venda" do `LeadFieldsForm` lista os
 * membros. Quem monta o formulário (dossiê e diálogo do card) chama isto e
 * desce o valor pela prop `podeVerEquipe`.
 *
 * Mora num hook próprio, e não dentro do formulário, por dois motivos medidos
 * na fusão da v1.66.0 do upstream: o teste de moeda dele monta o
 * `LeadFieldsForm` com o `AuthProvider` simulado só com `useActiveOrg`, e a
 * cerca `vocabulario-do-funil` lê texto de tela nos `.tsx`, onde o nome da
 * permissão aparecia como se fosse texto para o usuário.
 */
export function usePodeVerEquipe(): boolean {
  return usePermission("pipeline.move_card");
}

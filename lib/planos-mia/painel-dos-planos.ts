/**
 * FORK MIA (.90) — os dados da página "Módulos e Broadcast de cada plano" do
 * painel (`/admin/cobranca/modulos-dos-planos`, `ModulosDosPlanos.tsx`): os planos com
 * o lado nosso, quantas empresas assinam cada um (é o que trava tirar módulo) e
 * a estimativa de conversas. O dólar do teto fica no formulário do upstream,
 * que é do dono da instalação. LANÇA na falha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlanoComLado } from "@/components/planos-mia/ModulosDosPlanos";
import { modulosLigados } from "@/lib/instalacao/modulos";

import { conversasEstimadas } from "./catalogo";
import { lerPlanosComModulos } from "./leitura";

export async function lerPainelDosPlanos(
  admin: SupabaseClient,
): Promise<{ planos: PlanoComLado[]; crmB2bNaInstalacao: boolean }> {
  const [planos, assinaturas, ligados] = await Promise.all([
    lerPlanosComModulos(admin),
    admin
      .from("cobranca_assinaturas")
      .select("plano_id, plano_agendado_id, plano_troca_pendente_id")
      .limit(10_000),
    modulosLigados(admin),
  ]);
  if (assinaturas.error)
    throw new Error(`assinaturas: leitura falhou (${assinaturas.error.code ?? "sem_codigo"})`);
  const conta = new Map<string, number>();
  for (const a of (assinaturas.data ?? []) as Array<{
    plano_id: string;
    plano_agendado_id: string | null;
    plano_troca_pendente_id: string | null;
  }>) {
    for (const id of new Set(
      [a.plano_id, a.plano_agendado_id, a.plano_troca_pendente_id].filter((x): x is string => !!x),
    )) {
      conta.set(id, (conta.get(id) ?? 0) + 1);
    }
  }
  return {
    crmB2bNaInstalacao: ligados.includes("crm_b2b"),
    planos: planos.map((p) => ({
      id: p.id,
      nome: p.nome,
      arquivado: p.arquivado_em !== null,
      assinantes: conta.get(p.id) ?? 0,
      conversas: conversasEstimadas(p.teto_ia_usd_cents),
      modulos: p.modulos,
      preco_por_mensagem_cents: p.preco_por_mensagem_cents,
      frase: p.frase,
      destaque: p.destaque,
    })),
  };
}

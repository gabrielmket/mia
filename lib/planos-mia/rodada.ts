/**
 * FORK MIA (.90) — A JORNADA DE ASSINATURA NA RODADA HORÁRIA DA COBRANÇA.
 *
 * Roda depois da rodada do upstream (`lib/cobranca/rodada.ts`), no mesmo cron
 * (`app/api/v1/cron/cobranca`), e por isso só com a cobrança LIGADA:
 *   1. os módulos seguem o plano em todas as empresas (a rede de segurança dos
 *      ganchos da releitura e da troca);
 *   2. o aviso de 7 dias antes de uma descida de plano desligar módulo;
 *   3. a releitura das compras de crédito por Pix em aberto (o aviso do Asaas
 *      que se perdeu).
 * Cada passo audita o próprio efeito e nada lança: a rodada do upstream já
 * respondeu, e a jornada não pode derrubá-la.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { relerComprasEmAberto } from "@/lib/carteira/compra-pelo-asaas";
import { logger } from "@/lib/logger";

import { avisarModulosQueSaem, seguirOPlanoEmTodas } from "./seguir-o-plano";

export interface ResumoDaJornada {
  empresasComModuloMudado: number;
  avisosDeModuloSaindo: number;
  comprasLancadas: number;
}

export async function rodadaDaJornada(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<ResumoDaJornada> {
  const resumo: ResumoDaJornada = {
    empresasComModuloMudado: 0,
    avisosDeModuloSaindo: 0,
    comprasLancadas: 0,
  };
  try {
    resumo.empresasComModuloMudado = await seguirOPlanoEmTodas(admin);
    resumo.avisosDeModuloSaindo = await avisarModulosQueSaem(admin, agora);
    resumo.comprasLancadas = await relerComprasEmAberto(admin, { limite: 50 });
  } catch (erro) {
    logger.warn("planos-mia: rodada da jornada falhou", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
  return resumo;
}

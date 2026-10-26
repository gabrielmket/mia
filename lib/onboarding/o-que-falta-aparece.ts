/**
 * FORK MIA (.91) · QUEM VÊ O BLOCO "O QUE FALTA" E O ASSISTENTE NOS PRIMEIROS PASSOS.
 *
 * Uma regra só, pura, para o passo a passo (`/onboarding`), o Início
 * (`/app/inicio`), a faixa do topo, a rota e o MCP.
 *
 * ── O critério ────────────────────────────────────────────────────────────
 *
 * Sai do ESTADO DE CONCLUSÃO do `/onboarding` do upstream
 * (`organizations.onboarded_at` e `organizations.onboarding_state`):
 *
 *   1. a empresa ainda está no passo a passo (`onboarded_at` nulo): toda
 *      empresa que entra no passo a passo é nova (a que já roda tem
 *      `onboarded_at`, ou não entraria em `/app`). Ou, depois de terminar,
 *      passou pelo passo "Seu negócio" DESTA versão: o
 *      `onboarding_state.welcome.segmento` existe. Só o passo da .91 grava o
 *      segmento, então:
 *        - quem foi implantado pela Time (MCP de plataforma, carga, SQL) nunca
 *          passou pelo passo a passo e não tem `welcome`;
 *        - quem passou pelo passo a passo ANTES da .91 tem `welcome` sem
 *          `segmento`.
 *      Nos dois casos, nada muda: toda empresa que já roda (as implantadas
 *      antes da .91) não vê bloco novo em lugar nenhum;
 *   2. quem olha administra ou gere a empresa (`admin` ou `manager`): o
 *      atendente e o somente leitura não veem (o protótipo: "os primeiros
 *      passos são da administradora"). Aplicar proposta continua só do
 *      administrador;
 *   3. a empresa ainda está no passo a passo (`onboarded_at` nulo), OU já
 *      terminou e ainda não ZEROU: o bloco fica no Início até a primeira
 *      rodada em que não falta nada (o retrato com `faltam = 0`, 9081). Zerou,
 *      sai de vez;
 *   4. nunca na empresa de demonstração nem para o acompanhamento do suporte.
 */
import { roleAtLeast, type Role } from "@/lib/auth/types";

import { segmentoDoEstado } from "./modelos-de-agente-da-mia";

export interface EntradaDoCriterio {
  onboardingState: unknown;
  onboardedAt: string | null;
  papel: Role | null | undefined;
  /** Já houve um retrato com nada faltando (9081). */
  zerou: boolean;
  demonstracao?: boolean;
  /** Sessão de acompanhamento do suporte (somente leitura ou não). */
  suporte?: boolean;
}

export type MotivoDoCriterio =
  | "empresa_nova_no_passo_a_passo"
  | "empresa_nova_ate_zerar"
  | "sem_o_passo_a_passo_desta_versao"
  | "papel_sem_os_primeiros_passos"
  | "ja_zerou"
  | "demonstracao"
  | "suporte";

export interface Criterio {
  aparece: boolean;
  /** Em que fase: no passo a passo ou no Início. */
  onde: "passo_a_passo" | "inicio" | null;
  motivo: MotivoDoCriterio;
}

export function oQueFaltaAparece(e: EntradaDoCriterio): Criterio {
  if (e.suporte) return { aparece: false, onde: null, motivo: "suporte" };
  if (e.demonstracao) return { aparece: false, onde: null, motivo: "demonstracao" };
  if (!e.papel || !roleAtLeast(e.papel, "manager")) return { aparece: false, onde: null, motivo: "papel_sem_os_primeiros_passos" };
  if (!e.onboardedAt) return { aparece: true, onde: "passo_a_passo", motivo: "empresa_nova_no_passo_a_passo" };
  if (!segmentoDoEstado(e.onboardingState)) return { aparece: false, onde: null, motivo: "sem_o_passo_a_passo_desta_versao" };
  if (e.zerou) return { aparece: false, onde: null, motivo: "ja_zerou" };
  return { aparece: true, onde: "inicio", motivo: "empresa_nova_ate_zerar" };
}

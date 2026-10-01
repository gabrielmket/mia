/**
 * FORK MIA — AS DUAS REGRAS DA TAREFA DA PRÓXIMA AÇÃO, SEM NADA DE SERVIDOR.
 *
 * O cartão aberto (`components/cartoes/aberto/Foco.tsx`) anuncia o prazo e o
 * responsável ANTES do clique em "Aprovar", com as mesmas contas que o servidor
 * faz ao criar a tarefa (`lib/cartoes/tarefa-da-proxima-acao.ts`). Por isso elas
 * moram aqui, num módulo que o navegador pode carregar: o módulo do servidor
 * importa auditoria e cliente do banco (`next/headers`), e uma tela que o
 * importasse derrubava o build de produção.
 *
 *  - PRAZO: hoje às 18h (no fuso da empresa) se ainda são menos de 17h; senão,
 *    amanhã às 10h. Uma hora de folga é o mínimo para a tarefa não nascer
 *    vencida; amanhã cedo é o próximo momento em que alguém a vê.
 *  - RESPONSÁVEL: o dono HUMANO do negócio; negócio sem dono humano (dono é o
 *    agente, ou ninguém), quem aprovou.
 */
import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";

const HORA_DO_PRAZO_DE_HOJE = 18;
const LIMITE_PARA_HOJE = 17;
const HORA_DO_PRAZO_DE_AMANHA = 10;

export function prazoDaProximaAcao(agora: Date, fuso: string): Date {
  const p = partesNoFuso(agora, fuso);
  if (p.hora < LIMITE_PARA_HOJE) {
    return instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia, hora: HORA_DO_PRAZO_DE_HOJE }, fuso);
  }
  const amanha = partesNoFuso(new Date(agora.getTime() + 86_400_000), fuso);
  return instanteDe({ ano: amanha.ano, mes: amanha.mes, dia: amanha.dia, hora: HORA_DO_PRAZO_DE_AMANHA }, fuso);
}

export function responsavelDaProximaAcao(
  lead: { owner_kind: string | null; owner_user_id: string | null },
  quemAprovou: string,
): string {
  return lead.owner_kind !== "ai" && lead.owner_user_id ? lead.owner_user_id : quemAprovou;
}

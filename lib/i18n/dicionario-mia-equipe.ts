/**
 * FORK MIA — as frases de tela da equipe e do convite que são nossas, em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_DA_EQUIPE_MIA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1: o nosso mora ao lado
 * do dele). A chave é o texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz: o espalhamento vem por
 * último e VENCERIA a tradução dele em silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_EQUIPE_MIA: Traducoes = {
  // A frase do upstream dizia "janela de 24h". No fork o convite vale 15 dias
  // (`INVITE_TTL_SECONDS`), e a frase deixou de citar o número para não voltar a
  // mentir quando o prazo mudar.
  "Este link não é válido ou o prazo do convite já passou. Peça um novo convite a quem administra a sua empresa.": {
    es: "Este enlace no es válido o el plazo de la invitación ya venció. Pide una nueva invitación a quien administra tu empresa.",
  },
  // 9020: o aviso da tela Convidar membros na empresa de demonstração
  // (`app/app/team/invite/_components/AvisoDeConviteNaDemonstracao.tsx`).
  "Esta é a empresa de demonstração. O convite dá acesso a ela, e nada mais sai daqui.": {
    es: "Esta es la empresa de demostración. La invitación da acceso a ella, y nada más sale de aquí.",
  },
  // 9020: o motivo de falha do convite que o banco não gravou
  // (`app/app/team/invite/_components/motivo-da-falha.ts`).
  "Não foi possível registrar este convite, e nenhum e-mail foi enviado. Tente de novo em instantes.": {
    es: "No fue posible registrar esta invitación, y no se envió ningún correo. Inténtalo de nuevo en unos instantes.",
  },
};

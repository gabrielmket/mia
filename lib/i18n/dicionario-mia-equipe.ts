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
};

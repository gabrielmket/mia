/**
 * FORK MIA (.107) · as frases de tela da IA calada por OUTRA conversa do
 * contato (a faixa do cabeçalho da conversa,
 * `components/inbox/FaixaDaPausaPorOutraConversa.tsx`), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_IA_PENDENTE: Traducoes = {
  "IA pausada: {pessoa} está atendendo este contato no número {numero}.": {
    es: "IA en pausa: {pessoa} está atendiendo a este contacto en el número {numero}.",
  },
  "IA pausada: este contato está com a IA pausada no número {numero}.": {
    es: "IA en pausa: este contacto tiene la IA en pausa en el número {numero}.",
  },
  "Enquanto uma pessoa atende o contato em qualquer número, a IA fica calada em todos os números dele. Para a IA voltar aqui, devolva aquela conversa para a IA ou feche-a.":
    {
      es: "Mientras una persona atiende al contacto en cualquier número, la IA queda en silencio en todos sus números. Para que la IA vuelva aquí, devuelve esa conversación a la IA o ciérrala.",
    },
  "Abrir aquela conversa": { es: "Abrir esa conversación" },
  "alguém da equipe": { es: "alguien del equipo" },
  "outro número": { es: "otro número" },
};

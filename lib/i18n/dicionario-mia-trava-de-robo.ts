/**
 * FORK MIA (.108) · as frases da trava de robô (`lib/trava-de-robo/textos.ts`),
 * em espanhol: a nota na conversa, a linha do tempo do negócio, o aviso da
 * Central no teto e o motivo de perda que entra no funil.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_TRAVA_DE_ROBO: Traducoes = {
  "Robô ou atendimento automático": { es: "Robot o atención automática" },
  "IA pausada: o outro lado é um robô ({mensagens} mensagens automáticas em {minutos} min). Negócio marcado como perdido e conversa encerrada.":
    {
      es: "IA en pausa: del otro lado hay un robot ({mensagens} mensajes automáticos en {minutos} min). Negocio marcado como perdido y conversación cerrada.",
    },
  "IA pausada: o outro lado é um robô ({mensagens} mensagens automáticas em {minutos} min). Conversa encerrada; não havia negócio aberto.":
    {
      es: "IA en pausa: del otro lado hay un robot ({mensagens} mensajes automáticos en {minutos} min). Conversación cerrada; no había negocio abierto.",
    },
  "IA pausada nesta conversa: a IA respondeu {respostas} vezes em {minutos} min. O negócio e a conversa continuam abertos. Para a IA voltar, use Devolver ao automático.":
    {
      es: "IA en pausa en esta conversación: la IA respondió {respostas} veces en {minutos} min. El negocio y la conversación siguen abiertos. Para que la IA vuelva, usa Devolver al automático.",
    },
  "IA pausada: o outro lado é um robô. Negócio marcado como perdido e conversa encerrada.": {
    es: "IA en pausa: del otro lado hay un robot. Negocio marcado como perdido y conversación cerrada.",
  },
  "IA pausada nesta conversa: limite de respostas da IA atingido.": {
    es: "IA en pausa en esta conversación: se alcanzó el límite de respuestas de la IA.",
  },
  "Perdido: robô ou atendimento automático": { es: "Perdido: robot o atención automática" },
  "IA pausada nesta conversa: limite de respostas atingido": {
    es: "IA en pausa en esta conversación: límite de respuestas alcanzado",
  },
  "A IA respondeu {respostas} vezes em {minutos} min nesta conversa e foi pausada nela. Confira se do outro lado há uma pessoa; para a IA voltar, use Devolver ao automático.":
    {
      es: "La IA respondió {respostas} veces en {minutos} min en esta conversación y quedó en pausa en ella. Revisa si del otro lado hay una persona; para que la IA vuelva, usa Devolver al automático.",
    },
};

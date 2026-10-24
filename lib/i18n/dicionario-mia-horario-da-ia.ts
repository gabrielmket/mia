/**
 * FORK MIA (.85) — as frases de tela do HORÁRIO DE ATENDIMENTO DA IA (o editor
 * da grade da semana e os selos da lista de agentes e da conversa), em
 * espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DO_HORARIO_DA_IA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o texto
 * em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_HORARIO_DA_IA: Traducoes = {
  // ── os dias ──
  Domingo: { es: "Domingo" },
  Segunda: { es: "Lunes" },
  Terça: { es: "Martes" },
  Quarta: { es: "Miércoles" },
  Quinta: { es: "Jueves" },
  Sexta: { es: "Viernes" },
  Sábado: { es: "Sábado" },
  "amanhã às": { es: "mañana a las" },
  "no domingo às": { es: "el domingo a las" },
  "na segunda às": { es: "el lunes a las" },
  "na terça às": { es: "el martes a las" },
  "na quarta às": { es: "el miércoles a las" },
  "na quinta às": { es: "el jueves a las" },
  "na sexta às": { es: "el viernes a las" },
  "no sábado às": { es: "el sábado a las" },

  // ── o editor (app/app/ai/agents/[id]/_components/HorarioDaIaEditor.tsx) ──
  "Horário de atendimento da IA": { es: "Horario de atención de la IA" },
  "Dentro do horário a IA responde. Fora dele ela fica inativa: não responde o que chegar, nem depois, e a conversa fica com a equipe. Vale depois de publicar.":
    {
      es: "Dentro del horario la IA responde. Fuera de él queda inactiva: no responde lo que llegue, ni después, y la conversación queda con el equipo. Vale después de publicar.",
    },
  "Este agente ainda tem o horário antigo, que adia a resposta para a abertura:": {
    es: "Este agente todavía tiene el horario antiguo, que aplaza la respuesta hasta la apertura:",
  },
  "Ele deixa de valer quando você monta o horário da IA.": { es: "Deja de valer cuando armas el horario de la IA." },
  "Tirar o horário antigo": { es: "Quitar el horario antiguo" },
  "Quando a IA fica ativa": { es: "Cuándo la IA queda activa" },
  "Ativa a qualquer hora": { es: "Activa a cualquier hora" },
  "Ativa só no horário abaixo": { es: "Activa solo en el horario de abajo" },
  'A IA responde a qualquer hora. Escolha "Ativa só no horário abaixo" para montar a grade da semana.': {
    es: 'La IA responde a cualquier hora. Elige "Activa solo en el horario de abajo" para armar la grilla de la semana.',
  },
  "o da empresa": { es: "el de la empresa" },
  "inativa o dia todo": { es: "inactiva todo el día" },
  "ativa o dia todo": { es: "activa todo el día" },
  Agora: { es: "Ahora" },
  "como fica": { es: "cómo queda" },
  "Ativa nos horários": { es: "Activa en los horarios" },
  "Ativa o dia todo": { es: "Activa todo el día" },
  "Inativa o dia todo": { es: "Inactiva todo el día" },
  faixa: { es: "franja" },
  termina: { es: "termina" },
  "Tirar a faixa": { es: "Quitar la franja" },
  "Até 6 faixas por dia.": { es: "Hasta 6 franjas por día." },
  "+ faixa": { es: "+ franja" },
  "A faixa": { es: "La franja" },
  "passa da meia-noite.": { es: "pasa de la medianoche." },
  "Dividir:": { es: "Dividir:" },
  "começa e termina no mesmo horário.": { es: "empieza y termina en el mismo horario." },
  "escreva como 08:30. Para o fim do dia, use 24:00.": { es: "escribe como 08:30. Para el fin del día, usa 24:00." },
  "Faixas que se cruzam contam como uma só.": { es: "Las franjas que se cruzan cuentan como una sola." },
  "Sem faixa: inativa o dia todo.": { es: "Sin franja: inactiva todo el día." },
  "por semana": { es: "por semana" },
  "Segunda copiada para terça, quarta, quinta e sexta.": { es: "Lunes copiado a martes, miércoles, jueves y viernes." },
  "Copiar a segunda para terça a sexta": { es: "Copiar el lunes de martes a viernes" },
  "Sem nenhuma faixa a IA nunca responde. Para parar o agente, use Pausar.": {
    es: "Sin ninguna franja la IA nunca responde. Para detener el agente, usa Pausar.",
  },
  "Com este horário, a IA está ativa agora e fica inativa": { es: "Con este horario, la IA está activa ahora y queda inactiva" },
  "Com este horário, a IA fica ativa a semana inteira.": { es: "Con este horario, la IA queda activa la semana entera." },
  "Com este horário, a IA está inativa agora e volta": { es: "Con este horario, la IA está inactiva ahora y vuelve" },

  // ── a janela de resposta do número ──
  "O número": { es: "El número" },
  "só envia respostas das": { es: "solo envía respuestas de las" },
  "e não envia no domingo": { es: "y no envía el domingo" },
  "para se proteger de bloqueio. Com este horário a IA fica ativa fora dessa janela, e o que ela escrever nesse período só sai quando a janela abre.":
    {
      es: "para protegerse de bloqueos. Con este horario la IA queda activa fuera de esa ventana, y lo que escriba en ese período solo sale cuando la ventana abre.",
    },
  "Abrir as respostas 24h neste número": { es: "Abrir las respuestas 24 h en este número" },
  "Um administrador pode abrir as respostas 24h neste número.": { es: "Un administrador puede abrir las respuestas 24 h en este número." },
  "Abrir vale só para a resposta a quem escreveu. Disparo em massa, retomada e prospecção continuam na janela de disparo do número.":
    {
      es: "Abrir vale solo para la respuesta a quien escribió. El envío masivo, la retomada y la prospección siguen en la ventana de envío del número.",
    },
  "Respostas liberadas 24h neste número. Disparo e prospecção continuam como estavam.": {
    es: "Respuestas liberadas 24 h en este número. El envío masivo y la prospección siguen como estaban.",
  },
  "Não consegui abrir as respostas 24h. Tente de novo em Conexões › Proteção de envio.": {
    es: "No pude abrir las respuestas 24 h. Inténtalo de nuevo en Conexiones › Protección de envío.",
  },

  // ── os selos (components/ai/SeloDoHorarioDaIa.tsx) ──
  "Ativa até": { es: "Activa hasta" },
  "Inativa · volta às": { es: "Inactiva · vuelve a las" },
  "Inativa · volta": { es: "Inactiva · vuelve" },
  "IA inativa agora · conversa da equipe": { es: "IA inactiva ahora · conversación del equipo" },
  "IA ativa · responde até": { es: "IA activa · responde hasta" },
  "IA ativa a qualquer hora": { es: "IA activa a cualquier hora" },
  "Horário de atendimento da IA da versão publicada. Fora dele a IA não responde e a conversa fica com a equipe.": {
    es: "Horario de atención de la IA de la versión publicada. Fuera de él la IA no responde y la conversación queda con el equipo.",
  },
  "A IA responde as mensagens novas desta conversa até o fim do horário dela. Conversa assumida por alguém continua com a pessoa.": {
    es: "La IA responde los mensajes nuevos de esta conversación hasta el fin de su horario. Una conversación que alguien asumió sigue con esa persona.",
  },
  "A IA está fora do horário de atendimento: não responde o que chegar agora, nem depois. Quem responde é a equipe.": {
    es: "La IA está fuera del horario de atención: no responde lo que llegue ahora, ni después. Quien responde es el equipo.",
  },
};

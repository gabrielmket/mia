/**
 * FORK MIA · OS QUATRO FOLLOW-UPS DE SERVIÇOS B2B (agência, consultoria,
 * software, prestador para empresa).
 *
 * Do outro lado está uma empresa: o próximo passo é a reunião e a proposta
 * passa por mais de uma pessoa antes do sim. O tom é de colega de trabalho,
 * sem pressão de fechamento e sem prometer retorno, prazo ou resultado.
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_DE_SERVICOS_B2B: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("servicos_b2b", {
    id: "servicos-b2b-retomada",
    nome: "Contato · retomar quem parou de responder",
    jornada: "Atendimento",
    resumo:
      "A empresa chamou, a conversa parou antes de marcar uma reunião e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! A nossa conversa parou por aqui e eu não quis deixar o assunto solto. Ainda faz sentido a gente conversar sobre o que você trouxe?",
      },
      {
        rotulo: "Pergunta a prioridade",
        texto:
          "Passando de novo por aqui. Se o tema ainda estiver na sua lista, me diz qual é a prioridade hoje que eu te conto como a gente trabalha.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Se quiser retomar, é só me responder a qualquer momento. Se não for prioridade agora, tudo bem também.",
      },
    ],
  }),

  jornadaDeAgendamento("servicos_b2b", {
    id: "servicos-b2b-reuniao",
    nome: "Reunião · marcar a conversa de diagnóstico",
    jornada: "Reunião",
    resumo:
      "A empresa mostrou interesse e a reunião ainda não foi marcada. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece a reunião",
        texto:
          "Oi! Ficou faltando a gente marcar aquela conversa. Quer que eu te mande algumas opções de horário? Me responde aqui que eu organizo.",
      },
      {
        rotulo: "Pergunta a agenda",
        texto:
          "Ainda dá para marcar a nossa conversa. Me diz o dia e o período que funcionam melhor na sua agenda que eu envio o convite.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre a reunião. Se quiser marcar, me responde que eu vejo um horário. Se o assunto saiu da pauta, me avisa que eu encerro por aqui.",
      },
    ],
  }),

  jornadaDeDecisao("servicos_b2b", {
    id: "servicos-b2b-proposta",
    nome: "Proposta comercial · acompanhar a decisão",
    jornada: "Proposta",
    resumo:
      "Proposta enviada costuma passar por mais de uma pessoa antes do sim. O fluxo acompanha por quase três meses, sem pressionar.",
    toques: [
      {
        rotulo: "Abre para dúvidas",
        texto:
          "Oi! Queria saber se a proposta chegou certinho e se ficou alguma dúvida. Se ajudar, posso explicar os pontos principais para mais alguém da equipe.",
      },
      {
        rotulo: "Oferece rever o escopo",
        texto:
          "Passando para saber como está a avaliação por aí. Se quiser ajustar o escopo, os prazos ou a forma de pagamento, me chama que a gente conversa com calma.",
      },
      {
        rotulo: "Convida a retomar",
        texto:
          "Faz um tempo que a gente não fala sobre a proposta. Se o projeto voltou para a pauta, me responde aqui que eu retomo de onde paramos.",
      },
      {
        rotulo: "Deixa a porta aberta",
        texto:
          "Esta é a minha última mensagem sobre isso, não quero incomodar. Quando o tema voltar a ser prioridade, é só me escrever.",
      },
    ],
  }),

  jornadaDeFalta("servicos_b2b", {
    id: "servicos-b2b-falta",
    nome: "Reunião · remarcar quem não compareceu",
    jornada: "Falta",
    resumo:
      "A reunião estava marcada e a pessoa não entrou. O fluxo oferece outro horário em vez de deixar a oportunidade esfriar.",
    toques: [
      {
        rotulo: "Oferece outro horário",
        texto:
          "Oi! Vi que não conseguimos nos falar no horário de hoje. Imprevisto acontece. Quer que eu mande outras opções de horário?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Posso remarcar a nossa conversa. Me diz o dia e o período que funcionam melhor na sua agenda.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser conversar, é só me responder. Depois desta eu paro de lembrar, para não lotar a sua caixa de mensagens.",
      },
    ],
  }),
];

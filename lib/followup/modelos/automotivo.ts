/**
 * FORK MIA · OS QUATRO FOLLOW-UPS DE LOJA DE CARROS.
 *
 * O próximo passo é vir à loja ver o carro e fazer o test drive; a decisão
 * costuma esperar a avaliação do usado ou a aprovação do crédito. O texto não
 * cita modelo, preço nem parcela: o estoque de hoje não é o de daqui a três
 * semanas, quando a mensagem sai.
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_AUTOMOTIVOS: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("automotivo", {
    id: "automotivo-retomada",
    nome: "Veículo · retomar quem parou de responder",
    jornada: "Atendimento",
    resumo:
      "A pessoa perguntou sobre um carro, a conversa parou antes de ela vir à loja e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! A gente estava conversando sobre o carro e a conversa parou por aqui. Ainda está procurando? Posso te passar mais detalhes.",
      },
      {
        rotulo: "Pergunta o que busca",
        texto:
          "Passando de novo por aqui. Se ainda estiver procurando, me diz o modelo, o ano ou a faixa de valor que você tem em mente que eu vejo o que temos.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Se quiser retomar, é só me responder a qualquer momento.",
      },
    ],
  }),

  jornadaDeAgendamento("automotivo", {
    id: "automotivo-test-drive",
    nome: "Test drive · marcar a visita à loja",
    jornada: "Test drive",
    resumo:
      "O cliente se interessou por um carro e ainda não marcou o test drive ou a visita à loja. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece o test drive",
        texto:
          "Oi! Sobre o carro que você gostou: quer marcar um horário para ver de perto e fazer o test drive? Me responde aqui que eu organizo.",
      },
      {
        rotulo: "Pergunta o período",
        texto:
          "Ainda dá para marcar a sua visita. Me diz o dia e o período que funcionam melhor para você que eu vejo um horário.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre isso. Se quiser ver o carro, me responde que eu marco. E se já tiver resolvido, me avisa que eu encerro por aqui.",
      },
    ],
  }),

  jornadaDeDecisao("automotivo", {
    id: "automotivo-negociacao",
    nome: "Negociação · acompanhar a decisão de compra",
    jornada: "Negociação",
    resumo:
      "Quem viu o carro e recebeu proposta pode estar comparando, vendendo o usado ou esperando o crédito. O fluxo acompanha por cerca de um mês e meio, sem pressionar.",
    toques: [
      {
        rotulo: "Abre para dúvidas",
        texto:
          "Oi! Sei que trocar de carro pede tempo e não tem pressa da nossa parte. Ficou alguma dúvida sobre o carro ou a proposta? Pode perguntar por aqui.",
      },
      {
        rotulo: "Oferece rever condições",
        texto:
          "Passando para saber como você está pensando. Se quiser rever a entrada, as parcelas ou a avaliação do seu usado, me chama que eu explico com calma.",
      },
      {
        rotulo: "Convida a retomar",
        texto:
          "Faz um tempo que a gente não conversa. Se ainda estiver procurando carro, me responde aqui que eu te mostro o que temos hoje.",
      },
      {
        rotulo: "Deixa a porta aberta",
        texto:
          "Esta é a minha última mensagem sobre isso, não quero incomodar. Quando quiser voltar a olhar carro, é só me escrever.",
      },
    ],
  }, "curto"),

  jornadaDeFalta("automotivo", {
    id: "automotivo-falta",
    nome: "Test drive · remarcar quem não compareceu",
    jornada: "Falta",
    resumo:
      "O cliente não apareceu no horário marcado na loja. O fluxo oferece outra data em vez de deixar o interesse esfriar.",
    toques: [
      {
        rotulo: "Oferece outra data",
        texto:
          "Oi! Vi que não deu para você vir no horário de hoje. Acontece. Quer que eu veja outro dia para você conhecer o carro?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Posso ver outro horário para você. Me diz o dia da semana e o período que ficam melhor.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser ver o carro, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagens.",
      },
    ],
  }),
];

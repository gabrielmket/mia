/**
 * FORK MIA · OS QUATRO FOLLOW-UPS DE IMOBILIÁRIA E CONSTRUTORA.
 *
 * O próximo passo aqui é a visita, e a decisão é das maiores que alguém toma:
 * quem visitou e recebeu proposta leva semanas, às vezes esperando crédito.
 * O texto fala de imóvel sem nomear endereço, valor ou condição, porque a
 * mensagem é escrita hoje e sai daqui a semanas, quando a tabela já mudou.
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_IMOBILIARIOS: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("imobiliario", {
    id: "imobiliario-retomada",
    nome: "Imóvel · retomar quem parou de responder",
    jornada: "Atendimento",
    resumo:
      "A pessoa perguntou sobre um imóvel, a conversa parou antes da visita e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! A gente estava conversando sobre o imóvel e a conversa parou por aqui. Ainda está procurando? Posso te passar mais detalhes.",
      },
      {
        rotulo: "Pergunta o que busca",
        texto:
          "Passando de novo por aqui. Se ainda estiver procurando, me diz a região e o que é mais importante para você no imóvel que eu vejo o que temos.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Se quiser retomar a busca, é só me responder a qualquer momento.",
      },
    ],
  }),

  jornadaDeAgendamento("imobiliario", {
    id: "imobiliario-visita",
    nome: "Visita · marcar a visita ao imóvel",
    jornada: "Visita",
    resumo:
      "O cliente se interessou por um imóvel e ainda não marcou a visita. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece a visita",
        texto:
          "Oi! Sobre o imóvel que você gostou: quer que eu veja os horários para uma visita? Me responde aqui que eu organizo.",
      },
      {
        rotulo: "Pergunta o período",
        texto:
          "Ainda dá para marcar a sua visita. Me diz o dia e o período que funcionam melhor para você que eu vejo um horário.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre a visita. Se quiser conhecer o imóvel, me responde que eu vejo um horário. Se não for mais o momento, me avisa que eu encerro por aqui.",
      },
    ],
  }),

  jornadaDeDecisao("imobiliario", {
    id: "imobiliario-proposta",
    nome: "Proposta · acompanhar a decisão de compra",
    jornada: "Proposta",
    resumo:
      "Comprar um imóvel é uma decisão grande, e quem visitou ou recebeu proposta costuma levar semanas. O fluxo acompanha por quase três meses, sem pressionar.",
    toques: [
      {
        rotulo: "Abre para dúvidas",
        texto:
          "Oi! Sei que essa decisão não é simples e não tem pressa da nossa parte. Ficou alguma dúvida sobre o imóvel ou a proposta? Pode perguntar por aqui.",
      },
      {
        rotulo: "Oferece rever condições",
        texto:
          "Passando para saber como você está pensando. Se quiser rever valores, formas de pagamento ou financiamento, me chama que eu explico com calma.",
      },
      {
        rotulo: "Convida a retomar",
        texto:
          "Faz um tempo que a gente não conversa sobre o imóvel. Se quiser retomar, ou ver outras opções, me responde aqui.",
      },
      {
        rotulo: "Deixa a porta aberta",
        texto:
          "Esta é a minha última mensagem sobre isso, não quero incomodar. Se em algum momento quiser voltar a procurar, é só me escrever.",
      },
    ],
  }),

  jornadaDeFalta("imobiliario", {
    id: "imobiliario-falta",
    nome: "Visita · remarcar quem não compareceu",
    jornada: "Falta",
    resumo:
      "O cliente não apareceu na visita marcada. O fluxo oferece outra data em vez de deixar o interesse esfriar.",
    toques: [
      {
        rotulo: "Oferece outra data",
        texto:
          "Oi! Vi que não deu para a gente se encontrar na visita de hoje. Acontece. Quer que eu veja outro horário para você conhecer o imóvel?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Posso ver outro dia para a visita. Me diz o dia da semana e o período que ficam melhor para você.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser visitar o imóvel, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagens.",
      },
    ],
  }),
];

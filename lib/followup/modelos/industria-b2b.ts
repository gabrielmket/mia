/**
 * FORK MIA · OS QUATRO FOLLOW-UPS DE INDÚSTRIA E DISTRIBUIÇÃO B2B (fabricante
 * ou distribuidora que vende para revendas, instaladores e construtoras, com
 * representante comercial por região e catálogo grande).
 *
 * Do outro lado está um comprador. Ele cota com mais de um fornecedor, decide
 * pelo prazo de entrega, pela condição de pagamento e pelo mix, e volta a
 * comprar quando o estoque baixa. O próximo passo quase nunca é "fechar": é
 * mandar a lista de itens para cotar ou receber o representante. Por isso as
 * quatro jornadas aqui são atendimento, visita do representante, cotação e a
 * visita que não aconteceu.
 *
 * O tom é o de quem atende o comercial de uma fábrica: direto, sem pressão e
 * sem prometer preço, prazo de entrega nem estoque (a mensagem é escrita hoje e
 * sai daqui a dias, e a tabela pode ter mudado).
 *
 * A cotação de reposição se decide em semanas, não em meses: ritmo curto, como
 * carro e academia (`jornadas.ts`).
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_DE_INDUSTRIA_B2B: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("industria_b2b", {
    id: "industria-b2b-retomada",
    nome: "Atendimento · retomar a revenda que parou de responder",
    jornada: "Atendimento",
    resumo:
      "A revenda ou o instalador pediu informação de produto, a conversa parou antes da cotação e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! A nossa conversa parou por aqui e eu não quis deixar o seu pedido de informação sem resposta. Ainda está procurando os itens que você comentou?",
      },
      {
        rotulo: "Oferece montar a cotação",
        texto:
          "Passando de novo por aqui. Se ajudar, me manda a lista de itens e as quantidades que eu monto a cotação para você comparar com calma.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Quando precisar repor o estoque ou cotar material para uma obra, é só me responder aqui.",
      },
    ],
  }),

  jornadaDeAgendamento("industria_b2b", {
    id: "industria-b2b-visita",
    nome: "Visita do representante · marcar a apresentação do catálogo",
    jornada: "Visita",
    resumo:
      "O cliente quis conhecer a linha de produtos e a visita do representante ainda não foi marcada. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece a visita",
        texto:
          "Oi! Ficou faltando a gente marcar a visita do representante para apresentar o catálogo. Quer que eu veja um dia da semana que funcione para você?",
      },
      {
        rotulo: "Pergunta a agenda",
        texto:
          "Ainda dá para combinar a visita. Me diz o dia e o período mais tranquilos na loja ou na obra que eu passo para o representante da sua região.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre a visita. Se quiser marcar, me responde que eu organizo. Se preferir receber o catálogo por aqui mesmo, é só me avisar.",
      },
    ],
  }),

  jornadaDeDecisao(
    "industria_b2b",
    {
      id: "industria-b2b-cotacao",
      nome: "Cotação enviada · acompanhar até virar pedido",
      jornada: "Cotação",
      resumo:
        "Quem recebeu a cotação costuma comparar com outros fornecedores e conferir o próprio estoque antes de pedir. O fluxo acompanha por cerca de um mês e meio, sem pressionar.",
      toques: [
        {
          rotulo: "Abre para dúvidas",
          texto:
            "Oi! Queria saber se a cotação chegou certinho e se ficou alguma dúvida sobre os itens, as quantidades ou a forma de pagamento.",
        },
        {
          rotulo: "Oferece ajustar a cotação",
          texto:
            "Passando para saber como está a análise por aí. Se quiser trocar algum item, mudar as quantidades ou rever o prazo de pagamento, me chama que eu refaço.",
        },
        {
          rotulo: "Convida a retomar",
          texto:
            "Faz um tempo que a gente não fala da cotação. Se o pedido voltou para a pauta, me responde aqui que eu confiro a disponibilidade e atualizo os valores para você.",
        },
        {
          rotulo: "Deixa a porta aberta",
          texto:
            "Esta é a minha última mensagem sobre essa cotação, não quero incomodar. Quando precisar de material, é só me escrever.",
        },
      ],
    },
    "curto",
  ),

  jornadaDeFalta("industria_b2b", {
    id: "industria-b2b-falta",
    nome: "Visita do representante · remarcar quem não pôde receber",
    jornada: "Falta",
    resumo:
      "A visita estava marcada e o representante não conseguiu ser recebido. O fluxo oferece outra data em vez de deixar o interesse esfriar.",
    toques: [
      {
        rotulo: "Oferece outra data",
        texto:
          "Oi! Vi que não deu para receber o representante no horário combinado. Imprevisto acontece. Quer que eu veja outra data para a visita?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Posso remarcar a visita. Me diz o dia e o período que ficam melhores para você que eu passo para o representante.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser receber a visita, é só me responder. Depois desta eu paro de lembrar, para não lotar a sua caixa de mensagens.",
      },
    ],
  }),
];

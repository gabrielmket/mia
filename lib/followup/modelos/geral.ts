/**
 * FORK MIA · OS QUATRO FOLLOW-UPS GERAIS, o padrão da galeria.
 *
 * Para quem não se vê em nenhum segmento, ou ainda não escolheu: o texto fala
 * de "cliente", "atendimento" e "proposta", nunca de paciente, imóvel ou carro.
 * O ritmo de cada jornada mora em `jornadas.ts`; aqui só a linguagem.
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_GERAIS: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("geral", {
    id: "geral-retomada",
    nome: "Retomada · voltar a quem parou de responder",
    jornada: "Retomada",
    resumo:
      "O cliente chamou, a conversa parou antes do próximo passo e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! A nossa conversa parou por aqui e eu não quis deixar você sem resposta. Ainda posso te ajudar com o que você procurava?",
      },
      {
        rotulo: "Pergunta o que falta",
        texto:
          "Passando de novo por aqui. Se ainda fizer sentido para você, me conta o que ficou faltando que eu sigo a partir daí.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Se quiser retomar, é só me responder a qualquer momento. Se preferir deixar para depois, tudo bem também.",
      },
    ],
  }),

  jornadaDeAgendamento("geral", {
    id: "geral-agendamento",
    nome: "Agendamento · marcar o próximo passo",
    jornada: "Agendamento",
    resumo:
      "O cliente mostrou interesse e ainda não marcou a visita, a reunião ou o atendimento. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece marcar",
        texto:
          "Oi! Ficou faltando a gente marcar o próximo passo. Quer que eu veja os horários disponíveis para você?",
      },
      {
        rotulo: "Pergunta o período",
        texto:
          "Ainda dá para marcar. Me diz o dia e o período que funcionam melhor para você, manhã ou tarde, que eu procuro um horário.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre isso. Se quiser marcar, me responde que eu vejo um horário. E se não for mais o momento, me avisa que eu encerro por aqui.",
      },
    ],
  }),

  jornadaDeDecisao("geral", {
    id: "geral-proposta",
    nome: "Proposta · acompanhar a decisão",
    jornada: "Proposta",
    resumo:
      "Quem recebeu a proposta e não respondeu nem sempre desistiu: pode estar decidindo. O fluxo acompanha por quase três meses, sem pressionar.",
    toques: [
      {
        rotulo: "Abre para dúvidas",
        texto:
          "Oi! Sei que decidir leva tempo e não tem pressa da nossa parte. Ficou alguma dúvida sobre a proposta? Pode perguntar por aqui.",
      },
      {
        rotulo: "Oferece rever condições",
        texto:
          "Passando para saber como você está pensando. Se quiser rever algum ponto da proposta, as condições ou os prazos, me chama que eu explico com calma.",
      },
      {
        rotulo: "Convida a retomar",
        texto:
          "Faz um tempo que a gente não conversa sobre a proposta. Se quiser retomar, me responde aqui que eu continuo de onde paramos.",
      },
      {
        rotulo: "Deixa a porta aberta",
        texto:
          "Esta é a minha última mensagem sobre isso, não quero incomodar. Se em algum momento quiser retomar, é só me escrever.",
      },
    ],
  }),

  jornadaDeFalta("geral", {
    id: "geral-falta",
    nome: "Falta · remarcar quem não compareceu",
    jornada: "Falta",
    resumo:
      "O cliente não compareceu ao horário marcado. O fluxo oferece outra data em vez de deixar a conversa esfriar.",
    toques: [
      {
        rotulo: "Oferece outra data",
        texto:
          "Oi! Vi que a gente não conseguiu se encontrar no horário marcado. Acontece. Quer que eu veja outra data para você?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Posso procurar outro horário para você. Me diz o dia da semana e o período que funcionam melhor.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser remarcar, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagens.",
      },
    ],
  }),
];

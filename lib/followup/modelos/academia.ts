/**
 * FORK MIA · OS QUATRO FOLLOW-UPS DE ACADEMIA E BEM-ESTAR.
 *
 * Vale para academia, estúdio de pilates, crossfit, dança, yoga: o próximo
 * passo é a aula experimental e a decisão é a matrícula. O texto não fala de
 * corpo, peso ou saúde de ninguém (a mensagem aparece na tela de bloqueio do
 * celular) e não promete resultado de treino.
 */
import type { ModeloDeFollowup } from "./tipos";
import { jornadaDeAgendamento, jornadaDeDecisao, jornadaDeFalta, jornadaDeRetomada } from "./jornadas";

export const MODELOS_DE_ACADEMIA: readonly ModeloDeFollowup[] = [
  jornadaDeRetomada("academia", {
    id: "academia-retomada",
    nome: "Planos · retomar quem parou de responder",
    jornada: "Atendimento",
    resumo:
      "A pessoa perguntou sobre planos ou horários, a conversa parou antes da matrícula e ninguém voltou nela.",
    toques: [
      {
        rotulo: "Retoma a conversa",
        texto:
          "Oi! Você perguntou sobre os nossos planos e a conversa parou por aqui. Ainda está pensando em começar? Posso te explicar as opções.",
      },
      {
        rotulo: "Pergunta a rotina",
        texto:
          "Passando de novo por aqui. Se ainda quiser começar, me conta os dias e horários que encaixam na sua rotina que eu te mostro o que combina.",
      },
      {
        rotulo: "Último toque",
        texto:
          "Esta é a última vez que eu apareço sobre isso. Quando quiser começar, é só me responder.",
      },
    ],
  }),

  jornadaDeAgendamento("academia", {
    id: "academia-aula-experimental",
    nome: "Aula experimental · marcar a primeira aula",
    jornada: "Aula experimental",
    resumo:
      "O cliente quis conhecer o espaço e ainda não marcou a aula experimental. O fluxo lembra por duas semanas e sai de cena.",
    toques: [
      {
        rotulo: "Oferece a aula",
        texto:
          "Oi! Ficou faltando marcar a sua aula experimental. Quer que eu veja os horários disponíveis? Me responde aqui que eu organizo.",
      },
      {
        rotulo: "Pergunta o período",
        texto:
          "Ainda dá para marcar a sua aula. Me diz o dia e o período que funcionam melhor, manhã, tarde ou noite, que eu vejo um horário.",
      },
      {
        rotulo: "Encerra e libera",
        texto:
          "Último lembrete sobre a aula experimental. Se quiser marcar, me responde que eu vejo um horário. Se não for o momento, me avisa que eu encerro por aqui.",
      },
    ],
  }),

  jornadaDeDecisao("academia", {
    id: "academia-matricula",
    nome: "Matrícula · acompanhar quem ainda está decidindo",
    jornada: "Matrícula",
    resumo:
      "Quem fez a aula experimental ou pediu valores e não se matriculou pode estar só organizando a rotina. O fluxo acompanha por quase três meses, sem pressionar.",
    toques: [
      {
        rotulo: "Abre para dúvidas",
        texto:
          "Oi! Queria saber o que você achou. Ficou alguma dúvida sobre os planos, os horários ou as aulas? Pode perguntar por aqui.",
      },
      {
        rotulo: "Oferece comparar planos",
        texto:
          "Passando para saber como você está pensando. Se quiser comparar os planos e ver o que encaixa melhor na sua rotina, me chama que eu explico com calma.",
      },
      {
        rotulo: "Convida a retomar",
        texto:
          "Faz um tempo que a gente não conversa. Se quiser começar agora, me responde aqui que eu te ajudo com a matrícula.",
      },
      {
        rotulo: "Deixa a porta aberta",
        texto:
          "Esta é a minha última mensagem sobre isso, não quero incomodar. Quando fizer sentido começar, é só me escrever.",
      },
    ],
  }),

  jornadaDeFalta("academia", {
    id: "academia-falta",
    nome: "Aula experimental · remarcar quem faltou",
    jornada: "Falta",
    resumo:
      "O cliente não apareceu na aula experimental. O fluxo oferece outro horário em vez de deixar a vontade de começar passar.",
    toques: [
      {
        rotulo: "Oferece outro horário",
        texto:
          "Oi! Vi que não deu para você vir na aula de hoje. Acontece. Quer que eu veja outro horário para você?",
      },
      {
        rotulo: "Pede dia e período",
        texto:
          "Consigo encaixar a sua aula em outro dia. Me diz o dia da semana e o período que ficam melhor para você.",
      },
      {
        rotulo: "Encerra o assunto",
        texto:
          "Se ainda quiser fazer a aula, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagens.",
      },
    ],
  }),
];

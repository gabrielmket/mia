/**
 * COMO CADA AVISO FECHA — e a obrigação de responder isso para todo aviso novo.
 *
 * ─── O defeito, medido ─────────────────────────────────────────────────────
 *
 * A Central tem 26 tipos de aviso. Quatro sabiam se fechar sozinhos. Os outros
 * 22 abriam, ficavam abertos, e continuavam abertos DEPOIS de o problema ter
 * sido resolvido: a conexão voltou, o lead respondeu, a mensagem saiu — e o
 * alerta crítico seguia lá, vermelho.
 *
 * O desfecho disso é conhecido e pior que o barulho: a Central vira uma parede
 * de vermelho velho, o operador aprende que ela mente, e o dia em que houver um
 * aviso de verdade ele estará no meio de trinta que já não valem.
 *
 * ─── Por que um REGISTRO, e não 22 consertos ───────────────────────────────
 *
 * Consertar os 22 de hoje deixa o 23º nascer órfão amanhã — foi exatamente
 * assim que chegamos a 22. O `satisfies Record<InboxKind, RegraDeFechamento>`
 * abaixo faz o COMPILADOR cobrar a resposta: um `kind` novo não compila
 * enquanto ninguém disser como ele deixa de valer.
 *
 * ─── Três respostas legítimas, e a terceira é a mais importante ────────────
 *
 * `condicao` — dá para reperguntar ao banco se ainda é verdade. Fecha sozinho.
 *
 * `idade`    — nunca "deixa de ser verdade" (uma chamada perdida ontem seguirá
 *              perdida para sempre), mas para de ser ACIONÁVEL. Fecha por tempo,
 *              e o tempo é declarado aqui, não escondido num cron.
 *
 * `decisao`  — só uma pessoa fecha, porque o aviso É uma pergunta: "aprovo esta
 *              melhoria?", "o que faço com estes negócios parados?". Fechar
 *              sozinho apagaria a pergunta, e ninguém saberia que ela existiu.
 *              Declarar isto NÃO é dívida: é a resposta certa, escrita.
 */
import type { InboxKind } from "@/lib/agent-engine/db/repository";

export type RegraDeFechamento =
  | {
      modo: "condicao";
      /**
       * A pergunta que o vigia refaz, em palavras. O SQL mora no cron
       * (`app/api/v1/cron/varredura-de-avisos`), porque cada uma olha uma tabela
       * diferente; aqui fica o CONTRATO, que é o que precisa ser lido junto da
       * lista de kinds.
       */
      quando: string;
      /**
       * Rede de segurança: mesmo por condição, um aviso não pode ficar aberto
       * para sempre se a condição nunca mais for avaliável (a conversa foi
       * apagada, o contato anonimizado). `null` = sem rede, e aí é decisão.
       */
      tetoEmDias: number | null;
    }
  | { modo: "idade"; dias: number; porque: string }
  | { modo: "decisao"; porque: string };

/**
 * ⚠️ NÃO acrescente um `kind` aqui sem responder COMO ele fecha. O compilador
 * cobra a entrada; só você pode cobrar que ela seja verdadeira.
 */
export const COMO_FECHA = {
  // ── Fecham porque a condição some ─────────────────────────────────────────
  qr_rescan: {
    modo: "condicao",
    quando: "a sessão do canal voltou a WORKING",
    tetoEmDias: null,
  },
  channel_number_alert: {
    modo: "condicao",
    quando: "o número saiu do estado que gerou o aviso",
    tetoEmDias: 30,
  },
  budget_exceeded: {
    modo: "condicao",
    quando: "o teto foi elevado ou o período virou",
    tetoEmDias: null,
  },
  budget_warning: {
    modo: "condicao",
    quando: "o gasto voltou para baixo do aviso, ou o período virou",
    tetoEmDias: null,
  },
  job_dead: {
    modo: "condicao",
    quando: "o job foi devolvido à fila em Trabalho parado",
    tetoEmDias: null,
  },
  event_dead: {
    modo: "condicao",
    quando: "o evento saiu de 'dead'",
    tetoEmDias: null,
  },
  followup_dead: {
    modo: "condicao",
    quando: "a régua daquele lead voltou a andar",
    tetoEmDias: 30,
  },
  routing_unassigned: {
    modo: "condicao",
    quando: "a conversa ganhou responsável, foi fechada ou saiu da fila",
    tetoEmDias: 14,
  },
  message_send_stuck: {
    modo: "condicao",
    quando: "a mensagem saiu (deixou de estar presa)",
    tetoEmDias: 7,
  },
  appointment_outcome_required: {
    modo: "condicao",
    quando: "alguém registrou o desfecho do compromisso",
    tetoEmDias: 30,
  },
  contact_proposal_expired: {
    modo: "condicao",
    quando: "a proposta foi aceita ou recusada",
    tetoEmDias: 30,
  },
  next_action_ambiguous: {
    modo: "condicao",
    quando: "a conversa passou a ter um negócio definido",
    tetoEmDias: 30,
  },
  conhecimento_nao_indexado: {
    modo: "condicao",
    quando: "o material entrou na base de conhecimento",
    tetoEmDias: 30,
  },
  snooze_expired: {
    modo: "condicao",
    quando: "o lead respondeu, ou alguém adiou de novo",
    tetoEmDias: 30,
  },
  handoff: {
    modo: "condicao",
    quando: "uma pessoa assumiu a conversa (ela saiu de 'pending')",
    tetoEmDias: 30,
  },

  // ── Fecham por idade: o fato não muda, a utilidade sim ────────────────────
  midia_nao_lida: {
    modo: "idade",
    dias: 7,
    porque:
      "A foto que o agente não leu continua não lida para sempre. Depois de uma semana, " +
      "ou alguém já respondeu ao cliente por outro caminho, ou a conversa esfriou — " +
      "em nenhum dos dois o aviso ainda ajuda.",
  },
  channel_template_review: {
    modo: "idade",
    dias: 14,
    porque:
      "É um recado de que a plataforma mudou a situação de um modelo. Depois de duas " +
      "semanas ou o modelo foi corrigido, ou não era usado — e o aviso vira histórico.",
  },
  voice_call_missed: {
    modo: "idade",
    dias: 7,
    porque:
      "Uma chamada perdida de sete dias atrás não se atende mais. Manter o aviso aberto " +
      "não devolve a ligação; só empurra para baixo o que ainda dá para fazer.",
  },
  capabilities_missing: {
    modo: "idade",
    dias: 14,
    porque:
      "O atendimento que saiu capado já saiu. O aviso serve para alguém conferir a " +
      "configuração das ferramentas; depois de duas semanas, ou conferiram, ou o " +
      "problema reapareceu em aviso novo — e é esse que precisa ser visto.",
  },
  promise_unfulfilled: {
    modo: "idade",
    dias: 14,
    porque:
      "Que ninguém assumiu a promessa é um fato daquele turno, e ele não se desfaz. " +
      "Passadas duas semanas, o que importa é o estado ATUAL do lead — que aparece no " +
      "funil e nos avisos de risco, não aqui.",
  },
  reactivation_expired: {
    modo: "idade",
    dias: 30,
    porque:
      "A sugestão de retomar contato já venceu quando o aviso nasceu. Um mês depois, " +
      "reabrir aquele lead é uma decisão nova — e ela começa no funil, não num aviso velho.",
  },

  // ── Só pessoa fecha: o aviso É uma pergunta ──────────────────────────────
  promotion_review: {
    modo: "decisao",
    porque:
      "É um pedido de aprovação para mudar o comportamento do agente. Fechar sozinho " +
      "descartaria a proposta em silêncio, e ninguém saberia que ela existiu.",
  },
  judge_unaligned: {
    modo: "decisao",
    porque:
      "O avaliador de qualidade discorda de si mesmo e pede recalibragem. Enquanto " +
      "ninguém recalibra, o problema continua inteiro — e é exatamente isso que o aviso diz.",
  },
  risk_backlog_seeded: {
    modo: "decisao",
    porque:
      "É a lista de negócios que já estavam parados quando o vigia nasceu. Ela pede uma " +
      "decisão por negócio; fechar o aviso não decide nada e some com a lista.",
  },
  appointment_recovery_review: {
    modo: "decisao",
    porque:
      "A recuperação de um compromisso perdido exige alguém dizer o que fazer com o " +
      "cliente. Não há estado no banco que responda por essa escolha.",
  },
  other: {
    modo: "decisao",
    porque:
      "Guarda-chuva: sem kind próprio não há condição a reperguntar. Quem usa `other` " +
      "para algo recorrente está pedindo um kind novo — e aí ele declara como fecha aqui.",
  },
} as const satisfies Record<InboxKind, RegraDeFechamento>;

/** Os que o vigia fecha por idade, com o prazo de cada um. */
export function avisosQueVencem(): Array<{ kind: InboxKind; dias: number }> {
  return (Object.entries(COMO_FECHA) as Array<[InboxKind, RegraDeFechamento]>)
    .filter(([, r]) => r.modo === "idade")
    .map(([kind, r]) => ({ kind, dias: (r as { dias: number }).dias }));
}

/** O teto de segurança dos que fecham por condição — `null` quando não há. */
export function tetosDeSeguranca(): Array<{ kind: InboxKind; dias: number }> {
  return (Object.entries(COMO_FECHA) as Array<[InboxKind, RegraDeFechamento]>)
    .filter((par): par is [InboxKind, Extract<RegraDeFechamento, { modo: "condicao" }>] =>
      par[1].modo === "condicao",
    )
    .filter(([, r]) => r.tetoEmDias !== null)
    .map(([kind, r]) => ({ kind, dias: r.tetoEmDias as number }));
}

/** Os que NUNCA fecham sozinhos. Existe para a tela poder dizer isso a quem lê. */
export function avisosDeDecisao(): InboxKind[] {
  return (Object.entries(COMO_FECHA) as Array<[InboxKind, RegraDeFechamento]>)
    .filter(([, r]) => r.modo === "decisao")
    .map(([kind]) => kind);
}

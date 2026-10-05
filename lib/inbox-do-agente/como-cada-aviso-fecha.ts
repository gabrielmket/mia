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
  // O caso está em `awaiting_human` há mais de um dia: a IA travou esperando
  // alguém da equipe e há um cliente do outro lado. Deixa de ser verdade quando
  // o caso SAI desse estado — foi concluído, devolvido ao cliente
  // (`awaiting_lead`), escalado ou cancelado. Não é `idade`: quem espera no dia
  // 8 espera tanto quanto no dia 2, e fechar por tempo devolveria o defeito
  // medido que criou este vigia (22 pedidos parados, o mais antigo há 17,6 dias,
  // e nada no sistema os trazia de volta).
  // O teto é a mesma rede de `handoff`, e com o mesmo prazo de propósito: os
  // dois são "tem gente esperando" pendurados numa linha que pode sumir (caso
  // apagado, contato anonimizado pela cascata de LGPD). Depois de 30 dias parado
  // não há mais cliente esperando resposta — há um caso morto, e o lugar dele é
  // a tela de Casos, não o sino.
  case_stale: {
    modo: "condicao",
    quando: "o caso saiu de 'awaiting_human' — alguém concluiu, devolveu ao cliente, escalou ou cancelou",
    tetoEmDias: 30,
  },
  // Os dois avisos do Jev (upstream v1.68.0, migration 0500): ele percebeu, numa
  // mensagem que a regra sem IA deixou passar, um pedido para falar com uma
  // pessoa ou para parar de receber. Quem fecha os dois é o PRÓPRIO upstream,
  // por gatilho no banco (`trg_fechar_avisos_do_jev_da_conversa` e
  // `trg_fechar_aviso_do_jev_ao_bloquear`), na mesma transação em que o pedido é
  // atendido — a varredura não precisa reperguntar nada.
  // O pedido novo sobre a mesma conversa REABRE o mesmo aviso e o põe na data de
  // agora (`lib/ai/decisao/pedidos.ts`), então a idade aqui é sempre "desde o
  // pedido mais recente".
  //
  // Falar com uma pessoa: par do `handoff` — é gente esperando gente —, com a
  // mesma rede e o mesmo prazo. Depois de 30 dias sem a conversa ganhar uma
  // pessoa nem ser encerrada, não há mais cliente esperando naquela mensagem; e
  // se ele pedir de novo, o aviso volta.
  jev_pedido_de_humano: {
    modo: "condicao",
    quando: "a conversa ficou com uma pessoa (alguém assumiu, ou ela foi passada) ou foi encerrada",
    tetoEmDias: 30,
  },
  // Parar de receber: `tetoEmDias: null` não é omissão. O aviso é o único lugar
  // do produto que sabe que o cliente pediu para sair e segue recebendo — a regra
  // de hoje só bloqueia com o "PARAR" literal, e o Jev nunca bloqueia ninguém.
  // Vencê-lo por tempo apagaria o sinal com o problema de pé, e este é pedido de
  // titular: o pior dos dois erros é o silêncio. O upstream o desenhou para ficar
  // aberto até o contato ser bloqueado ou a conversa encerrada (por isso ele NÃO
  // fecha quando alguém assume), e o "Marcar resolvido" da Central segue valendo
  // para quem conferiu e viu que não era pedido.
  jev_parar_de_receber: {
    modo: "condicao",
    quando: "o contato foi bloqueado (o próprio cliente mandou PARAR) ou a conversa foi encerrada",
    tetoEmDias: null,
  },
  // O canal está ligado, em modo de teste e sem nenhum número autorizado: as
  // mensagens chegam normalmente e a IA não responde ninguém. O próprio vigia
  // (`app/api/v1/cron/canal-mudo-watcher`) já fecha o aviso nos quatro
  // desfechos, e é ele quem manda aqui.
  // `tetoEmDias: null` não é omissão. Esse cron lê os avisos ABERTOS antes das
  // conexões e resolve os que sobraram sem canal, então a condição nunca fica
  // inavaliável — não há o que a rede pegaria. E um teto seria o pior dos dois
  // erros possíveis: no dia 31 o canal segue mudo, o aviso some, e a instalação
  // volta a falhar exatamente do jeito silencioso que este kind existe para
  // acabar — "as mensagens chegam, ninguém é respondido, e o dono conclui que o
  // produto está quebrado".
  canal_mudo_sem_numero: {
    modo: "condicao",
    quando: "o canal ganhou número autorizado, saiu do modo de teste, foi arquivado ou apagado",
    tetoEmDias: null,
  },
  // O aviso daquele caso não chegou ao WhatsApp da equipe, em definitivo (a
  // entrega venceu as 24h de `VALIDADE_DA_ENTREGA_MS`). A falha de entrega em si
  // nunca "deixa de ser verdade" — mas ela não é o assunto: o aviso nasce com
  // `ref_kind='agent_case'` de propósito, porque o que importa é o caso sobre o
  // qual NINGUÉM foi avisado. Some quando esse caso para de esperar.
  // Não é `idade`: enquanto o caso está aberto e o aviso não saiu, este item é o
  // único lugar do produto que sabe disso, e vencê-lo por tempo apagaria o
  // sinal com o problema de pé.
  // Fechar por condição não perde o histórico da falha: a fonte da verdade é
  // `entregas_de_aviso_de_caso` (a migration 0292 escreve isso com todas as
  // letras, justamente porque qualquer membro apaga um item da Central pelo
  // PostgREST). E se a conexão de avisos continuar quebrada, o próximo caso
  // aberto abre outro item — o sintoma volta sozinho enquanto a causa existir.
  // Teto de 30 pelo mesmo motivo de `case_stale`: o caso pode ser apagado ou
  // anonimizado, e aí a pergunta fica sem quem a responda.
  aviso_de_caso_nao_entregue: {
    modo: "condicao",
    quando: "o caso referido saiu dos estados abertos ('awaiting_human'/'awaiting_lead') — alguém o atendeu apesar de o aviso não ter chegado",
    tetoEmDias: 30,
  },
  // O fluxo de follow-up está publicado, o gatilho pede IA e nenhum agente
  // publicado arma o ponteiro: ele aparece `active` na tela e não inscreve
  // ninguém, sem erro e sem log. Deixa de ser verdade quando o vínculo aparece
  // (ou quando o grafo publicado passa a ser só texto fixo, que não precisa de
  // agente), e quem fecha é o MESMO cron que abre — ele já reconcilia os dois
  // lados por rodada.
  // Não é `decisao`, embora só uma pessoa possa consertar: existe estado no
  // banco que responde pela pergunta ("o ponteiro está na lista do agente
  // publicado?"), e declarar decisão aqui obrigaria quem já consertou a voltar
  // para fechar o aviso à mão — aviso que pede algo já feito é o começo de
  // aprender a ignorar a Central.
  // O teto é a rede para o buraco do vigia: ele só varre ponteiros `active`, e
  // um fluxo pausado ou apagado sai da varredura deixando o aviso aberto para
  // sempre. Fechar cedo demais custa quase nada justamente aqui — se o fluxo
  // seguir publicado e desarmado, a rodada seguinte abre outro aviso.
  followup_sem_agente: {
    modo: "condicao",
    quando: "um agente publicado passou a armar o fluxo, ou o grafo publicado deixou de pedir agente",
    tetoEmDias: 30,
  },
  // A IA rascunhou a proposta e falta uma pessoa conferir: confirmar o modelo
  // sugerido, dar preço ao que ficou "a definir", preencher o documento. Deixa
  // de ser verdade quando essas pendências somem, ou quando a proposta sai de
  // rascunho. Quem fecha é o próprio upstream: o
  // `resolverAvisoDeRevisaoSeProntaOuEncerrada` (lib/propostas/aviso-de-revisao.ts)
  // roda a cada edição, troca de modelo, envio e descarte da proposta.
  // Não é `idade`: rascunho não vence, e o cliente que pediu a proposta espera
  // tanto no dia 10 quanto no dia 2. Não é `decisao`: o banco responde a
  // pergunta e o upstream já a refaz; declarar decisão obrigaria quem revisou e
  // enviou a voltar à Central para fechar à mão.
  // O teto cobre um buraco medido, não um hábito: apagar o NEGÓCIO cancela os
  // rascunhos dele por gatilho SQL (`fn_cancelar_propostas_rascunho_do_lead`,
  // migration 0466), e gatilho não chama o resolvedor. Sem teto, o aviso ficaria
  // aberto para sempre pedindo revisão de uma proposta cancelada. Trinta dias
  // pelo mesmo motivo de `case_stale`: depois disso não há cliente esperando
  // aquela proposta, há um rascunho velho, e o lugar dele é a lista de
  // propostas. O preço, aceito de propósito: no dia 30 ele sai também de
  // "propostas esperando revisão" no radar, que lê este aviso ABERTO.
  proposta_pronta_para_revisao: {
    modo: "condicao",
    quando: "a proposta ficou pronta (modelo confirmado, todo item com preço, documento sem pendência), ou foi enviada ou descartada",
    tetoEmDias: 30,
  },
  // O cron `proposta-travada` achou proposta presa em `enviando` e a devolveu a
  // rascunho, sem reenviar nada. É o par de `message_send_stuck` (a própria
  // `lib/ai/inbox-destino.ts` diz isso), e pelo mesmo motivo é condição: o que
  // o aviso pede, reenviar, deixa rastro no banco. Some quando as propostas
  // devolvidas saem de rascunho: reenviadas (o envio zera `ultima_falha_envio`)
  // ou descartadas.
  // Quem escrever a re-pergunta não pode olhar só o `ref_id`: o aviso fala de
  // TODAS as propostas da organização naquela rodada ("3 propostas não
  // confirmaram o envio") e aponta só a primeira. Fechar pela primeira calaria
  // as outras duas com o problema de pé.
  // Hoje ninguém refaz a pergunta, e quem fecha é o teto. Sem ele, o aviso
  // (`critical`) ficaria vermelho para sempre depois do reenvio: a parede que
  // este registro existe para derrubar. Sete dias, como `message_send_stuck`, e
  // aqui o teto não esconde nada: a proposta devolvida mostra a falha na
  // própria tela enquanto estiver em rascunho ("O último envio falhou"), a
  // conexão caída tem aviso próprio (`qr_rescan`, `channel_number_alert`), e o
  // cron roda a cada minuto, então a próxima proposta que travar abre aviso novo.
  proposta_travada: {
    modo: "condicao",
    quando: "as propostas devolvidas a rascunho saíram de lá: foram reenviadas ou descartadas",
    tetoEmDias: 7,
  },
  // Uma tarefa de enviar proposta (`source_kind = 'promised_proposal'`) venceu
  // e o negócio não ganhou proposta nenhuma depois da promessa. A pergunta é de
  // estado e o banco a responde: some quando o negócio ganha proposta criada
  // depois da promessa, ou quando a tarefa deixa de estar pendente (concluída
  // ou cancelada). Não é `idade`: quem monta o rascunho no dia 3 resolveu, e
  // manter o aviso até vencer é pedir algo já feito.
  // Hoje ninguém refaz a pergunta: o cron que abre
  // (`proposal-promised-not-created`) não fecha, e a varredura ainda não tem a
  // consulta. Quem fecha é o teto, e por isso ele é curto. Fechar cedo aqui não
  // esconde nada: aquele cron roda TODO DIA e só deixa de abrir enquanto houver
  // um aviso ABERTO para o negócio, então a promessa que segue descumprida volta
  // à Central na manhã seguinte. O limite do outro lado é o barulho: com teto de
  // um dia o mesmo aviso nasceria (e tocaria) toda manhã. Sete dias é um lembrete
  // por semana enquanto a promessa estiver de pé, e no máximo uma semana pedindo
  // "monte o rascunho" a quem já montou.
  proposal_promised_not_created: {
    modo: "condicao",
    quando: "o negócio ganhou proposta criada depois da promessa, ou a tarefa da promessa deixou de estar pendente",
    tetoEmDias: 7,
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
  // A proposta enviada passou da validade sem aceite nem recusa, e o cron
  // `proposal-expiry` a marcou `vencida`. Não há condição a reperguntar:
  // `vencida` não tem saída (o gatilho `fn_crm_proposals_transicao_da_sessao` só
  // deixa `enviada` virar aceita ou recusada, e só `enviada` pode ser revisada).
  // Não é `decisao`, embora peça uma: TODA proposta que vence sem resposta abre
  // um aviso, e um por proposta que só fecha à mão é a parede de vermelho velho.
  // Fechar por idade não tira o problema da vista: o radar lista a proposta em
  // "propostas vencidas sem retomada" enquanto o negócio estiver aberto no funil
  // e não ganhar proposta nova.
  proposal_expired_notice: {
    modo: "idade",
    dias: 14,
    porque:
      "A proposta vencida não volta a valer. O aviso serve para alguém decidir se retoma o " +
      "cliente; duas semanas depois, ou retomou, ou o cliente esfriou. E o que continua " +
      "pendente segue no radar, em 'propostas vencidas sem retomada', até sair uma proposta nova.",
  },
  // A taxa de aceite dos últimos 30 dias ficou abaixo do piso. O aviso é um
  // RETRATO: o número vai escrito no corpo no dia em que ele nasce e não se
  // atualiza, e enquanto ele está aberto o cron não abre outro com o número de
  // hoje. A pergunta "ainda está baixa?" já é refeita pelo próprio cron que
  // abre (`proposal-acceptance-rate`), uma vez por semana. O que faltava era o
  // retrato velho sair da frente dele.
  // Seis dias, e não sete, de propósito: aquele cron roda domingo às 6h
  // (`docker/scheduler/entrypoint.sh`) e esta varredura roda de hora em hora.
  // Com sete, o aviso fecharia às 7h do domingo seguinte, UMA HORA DEPOIS da
  // rodada que teria aberto o novo, e uma taxa ainda baixa passaria a semana
  // inteira fora da Central. Com seis, fecha no sábado, e o domingo traz o
  // número atual se ele ainda estiver baixo. Quem mudar a cadência daquele cron
  // revê este prazo.
  proposal_acceptance_rate_drop: {
    modo: "idade",
    dias: 6,
    porque:
      "É o boletim de uma janela de 30 dias, com o número congelado no dia em que nasceu. " +
      "O cron que o abre mede de novo toda semana: se a taxa seguir baixa, chega um boletim " +
      "com o número de hoje; se subiu, o velho não tem mais o que dizer.",
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
  // Upstream 1.70 (#1987): a revisão das conversas que chegaram enquanto a
  // empresa estava suspensa (`fn_reativar_organizacao`).
  org_reativada: {
    modo: "decisao",
    porque:
      "É a lista das conversas que receberam mensagem durante a suspensão e que a IA não " +
      "respondeu. Cada uma pede que alguém da equipe a abra e decida; não há estado no banco " +
      "que diga que a revisão foi feita.",
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

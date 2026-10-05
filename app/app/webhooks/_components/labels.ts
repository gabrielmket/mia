/**
 * Labels pt-br congelados da aba Automações (UI-T3). Fonte única — a timeline
 * de atividade (UI-T4) importa os mesmos mapas, nunca redeclara os textos.
 */
import type { TRIGGER_EVENTS } from "@/lib/schemas/webhooks";

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];
export type ActionType =
  | "create_or_move_lead"
  | "send_whatsapp_message"
  | "send_ai_message"
  | "add_tag"
  | "assign_owner"
  | "call_webhook"
  | "start_message_flow"
  | "notify_group"
  | "create_task";

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  "lead.created": "Quando entrar um contato novo (webhook)",
  "lead.stage_changed": "Quando um lead mudar de etapa",
  // #1528 — os quatro que nascem do trigger do banco e valem para todo caminho
  // que termina num UPDATE do lead (arraste, botão, lote, IA, o mover da
  // automação). Criar já ganho/perdido ou já com dono NÃO emite: o trigger
  // retorna cedo no INSERT. A frase diz o DESFECHO, que é
  // o que quem integra escuta — não o botão que a pessoa apertou.
  "lead.won": "Quando um negócio for ganho",
  "lead.lost": "Quando um negócio for perdido",
  "lead.reopened": "Quando um lead encerrado for reaberto",
  "lead.assigned": "Quando o responsável do lead mudar",
  "message.received": "Quando chegar mensagem no WhatsApp",
  // A frase é do ponto de vista de quem RECEBE o aviso: a falha é do envio, e
  // é ela que manda o integrador verificar. "não for entregue" cobre os dois
  // caminhos que emitem (recusa da plataforma e pré-voo), sem prometer que a
  // causa é sempre a mesma.
  "message.failed": "Quando uma mensagem não for entregue",
  "lead.tag_added": "Quando um lead ganhar uma tag",
  "contact.tag_added": "Quando um contato ganhar uma tag",
  // A frase evita "agendamento criado", que não diz ao operador o que ele vê na
  // agenda: um horário marcado pode nascer pendente (o tipo pede confirmação) ou
  // já confirmado, e os dois caem aqui.
  "appointment.created": "Quando um horário for marcado",
  "appointment.confirmed": "Quando um horário pendente for confirmado",
  "appointment.rescheduled": "Quando um horário for remarcado",
  "appointment.cancelled": "Quando um horário for cancelado",
  // O nome ANTIGO do de cima (ver `ENTIDADE_ESPERADA_POR_GATILHO`). Não aparece
  // no seletor — `GATILHOS_OFERECIDOS` o tira de lá —, mas continua com rótulo
  // porque `RulesTab` lê este mapa para MOSTRAR regra já salva: sem a linha, a
  // lista de automações de quem implantou antes exibiria a string crua
  // "appointment.booked" no lugar de uma frase.
  "appointment.booked": "Quando uma reunião for marcada",
  // O desfecho (#1612): a frase diz o que a EQUIPE registrou na tela —
  // "compareceu" e "faltou" são os botões Realizado/Faltou do histórico, e
  // usar outro vocabulário aqui faria o operador procurar o gatilho que já viu.
  "appointment.completed": "Quando alguém comparecer ao compromisso",
  "appointment.no_show": "Quando alguém faltar ao compromisso",
  "contact.birthday": "No aniversário de um contato",
  // A frase diz o que a regra vê ("uma data do funil"), e não o que o operador
  // escreveu — o campo é escolhido embaixo, e o mesmo rótulo serve para "data
  // do casamento", "vencimento" e "data da prova".
  "lead.date_field_due": "Quando faltarem N dias para uma data do funil",
  // #1540 — gatilhos por TEMPO: a frase diz a DURAÇÃO, e os detalhes (N, direção,
  // funil) ficam embaixo, na configuração da regra.
  "lead.silent_for": "Quando ficar N dias sem mensagem",
  "lead.stage_stale": "Quando um lead ficar N dias na mesma etapa",
  // FORK MIA — documentos e obrigações (lib/obrigacoes/gatilhos.ts). As frases
  // são literais aqui, e não um espalhamento, para a cerca de espanhol alcançar
  // cada uma pela tabela.
  "obrigacao.documento_vencendo": "Quando um documento estiver para vencer (X dias antes)",
  "obrigacao.documento_vencido": "Quando um documento vencer (no dia seguinte)",
  "obrigacao.documento_nao_enviado": "Quando um documento pedido não chegar (pedido há X dias)",
  "obrigacao.documento_recebido": "Quando um documento for recebido",
  "obrigacao.atividade_chegando": "Quando uma atividade recorrente estiver chegando (X dias antes)",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  create_or_move_lead: "Criar/mover lead no funil",
  send_whatsapp_message: "Enviar mensagem no WhatsApp",
  send_ai_message: "Mensagem escrita pela IA",
  add_tag: "Adicionar tag",
  assign_owner: "Atribuir a um atendente",
  call_webhook: "Avisar outro sistema (webhook)",
  start_message_flow: "Iniciar fluxo de mensagem",
  notify_group: "Avisar o time num grupo do WhatsApp",
  // #1540 — a ação que não fala com o cliente: o lembrete é da equipe.
  create_task: "Criar tarefa interna (sem mensagem ao cliente)",
};

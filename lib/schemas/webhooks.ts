/**
 * Zod schemas for webhook-sources e automation-rules (feature Webhooks, Task 12).
 * TRIGGER_EVENTS deve espelhar exatamente os eventos que o motor
 * (`lib/automation/engine.ts` → EXPECTED_ENTITY_KIND) reconhece.
 */
import { z } from "zod";

export const TRIGGER_EVENTS = [
  "lead.created",
  "lead.stage_changed",
  "message.received",
  "lead.tag_added",
  "contact.tag_added",
  "appointment.booked",
] as const;

export const conditionSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "contains"]),
  value: z.string().max(500),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_or_move_lead"),
    config: z.object({
      pipeline_id: z.string().uuid(),
      stage_id: z.string().uuid(),
      /**
       * Contato que já tem negócio em OUTRO funil: recusar (padrão, o
       * comportamento de sempre) ou abrir um card novo no funil de destino —
       * a passagem de bastão do SDR para o comercial.
       */
      quando_em_outro_funil: z.enum(["recusar", "abrir_novo_card"]).optional(),
    }),
  }),
  z.object({ type: z.literal("send_whatsapp_message"), config: z.object({ channel_session_id: z.string().uuid(), template: z.string().min(1).max(2000) }) }),
  z.object({ type: z.literal("add_tag"), config: z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(10) }) }),
  z.object({ type: z.literal("assign_owner"), config: z.object({ user_id: z.string().uuid() }) }),
  z.object({
    type: z.literal("send_ai_message"),
    config: z.object({
      /** Agente PUBLICADO que assina a mensagem. */
      agent_id: z.string().uuid(),
      channel_session_id: z.string().uuid(),
      /**
       * O que fazer com os dados do formulário. Mesmo teto do `prompt_hint` de
       * um passo de follow-up (1000): é instrução, não roteiro — quem escreve
       * mais que isso está tentando pôr o prompt do agente aqui dentro.
       */
      instruction: z.string().min(1).max(1000),
    }),
  }),
  z.object({
    type: z.literal("call_webhook"),
    config: z.object({
      url: z.string().url().max(2000),
      // Input do usuário (plaintext, write-only) — a rota troca por secret_enc.
      secret: z.string().max(200).optional(),
      // Ciphertext hex (round-trip do editor: GET devolve, PATCH preserva).
      secret_enc: z.string().max(4000).optional(),
    }),
  }),
  z.object({
    type: z.literal("start_message_flow"),
    config: z.object({ flow_pointer_id: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("notify_group"),
    config: z.object({
      /**
       * Canal e grupo são OPCIONAIS — e essa é a mudança que faz a régua ser
       * montável por quem implanta.
       *
       * Sem os dois, o aviso sai pelo número da PLATAFORMA e cai no grupo que
       * o operador escolheu para este cliente no painel administrativo
       * (`lib/avisos/destino-do-aviso.ts`). Quem monta a régua só liga a chave.
       *
       * Com os dois, vale o que está escrito: canal da própria organização e id
       * digitado. Continua aceito porque as regras salvas antes desta mudança
       * têm os dois campos, e apagá-los mudaria calado para onde vai um aviso
       * que já estava no ar.
       *
       * O que NÃO se aceita é meio par: canal sem grupo (ou o contrário) é
       * quase sempre um formulário salvo pela metade, e adivinhar a metade que
       * falta é justamente como um aviso interno vai parar no lugar errado.
       */
      channel_session_id: z.string().uuid().optional(),
      /** O id do grupo no WhatsApp (`...@g.us`). */
      chat_id: z.string().min(6).max(120).optional(),
      template: z.string().min(1).max(2000),
    })
      .refine((c) => Boolean(c.channel_session_id) === Boolean(c.chat_id), {
        message: "Informe canal e grupo juntos, ou nenhum dos dois.",
        path: ["chat_id"],
      }),
  }),
]);

export const createWebhookSourceSchema = z.object({
  name: z.string().min(1).max(120),
  default_pipeline_id: z.string().uuid(),
  default_stage_id: z.string().uuid(),
  redirect_to: z.string().url().max(2000).nullish(),
  field_map: z
    .object({
      name: z.array(z.string()).optional(),
      phone: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
    })
    .optional(),
  secret: z.string().min(16).max(200).nullish(),
});
export const updateWebhookSourceSchema = createWebhookSourceSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createAutomationRuleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export const updateAutomationRuleSchema = createAutomationRuleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateWebhookSourceInput = z.infer<typeof createWebhookSourceSchema>;
export type UpdateWebhookSourceInput = z.infer<typeof updateWebhookSourceSchema>;
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;

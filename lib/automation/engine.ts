import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
/**
 * Motor de regras: consome eventos-gatilho do event_log e executa as
 * automation_rules ativas do tenant. Registrado no registry via engine.handler.
 *
 * Anti-loop: eventos com metadata.caused_by_rule OU metadata.request_id
 * prefixado "rule:" não reprocessam (profundidade 1 no v1 — cadeia
 * regra→regra fica pra v2/Task 9, que estampa esse metadata nos eventos que
 * uma ação do motor emite).
 *
 * entity_kind guard: o trigger legado `fn_emit_event_on_lead_change` emite
 * lead.created/lead.stage_changed com entity_kind='lead' (derivado por
 * split_part do event_type), enquanto os handlers desta feature emitem com
 * entity_kind='crm_lead'. Sem este filtro o motor rodaria a regra 2x por
 * mudança de lead (uma vez por linha de event_log duplicada).
 *
 * A exceção de #1528: os quatro gatilhos de encerramento/reabertura/atribuição
 * SÓ existem como linha do trigger, portanto SÓ existem com entity_kind='lead'.
 * Para eles `'lead'` vale como `'crm_lead'` (`entidadeDoEvento`) — sem isso a
 * regra nunca roda, ou roda sem o objeto `lead` no contexto. O `lead.stage_changed`
 * legado continua recusado: é o mesmo fato que o moveLeadHandler já emite com
 * `crm_lead`, e aceitá-lo entregaria o webhook duas vezes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import { getAction } from "@/lib/automation/actions";
import type { ActionResultDetail } from "@/lib/automation/types";
import { audit } from "@/lib/audit";
import { regraDoEvento } from "@/lib/automation/gatilho-de-data-do-funil";
import { regrasDoNomeAntigo } from "@/lib/automation/regras-do-nome-antigo";
import {
  acoesQueFechamLaco,
  ENTIDADE_ESPERADA_POR_GATILHO,
  GATILHOS_DO_TRIGGER_DE_LEAD,
} from "@/lib/schemas/webhooks";
import { logger } from "@/lib/logger";
// FORK MIA — o contexto dos cinco gatilhos de documentos e obrigações.
import { contextoDaObrigacao } from "@/lib/obrigacoes/contexto-da-automacao";
import { ENTIDADE_DA_OBRIGACAO } from "@/lib/obrigacoes/gatilhos";

export const AUTOMATION_CONSUMER_KEY = "automation-rules";

/**
 * FONTE ÚNICA (upstream): o mapa saiu daqui e virou
 * `ENTIDADE_ESPERADA_POR_GATILHO`, em `lib/schemas/webhooks.ts`.
 *
 * O mapa embutido que este fork mantinha listava `appointment.booked` — nada se
 * perde: aquele gatilho continua declarado lá, ao lado dos quatro nomes novos do
 * ciclo de vida do compromisso. Manter as duas listas era o defeito que a
 * mudança consertou: acrescentar um gatilho exigia lembrar de três lugares, e
 * esquecer um deles faz a regra aparecer na tela, o operador salvá-la, o evento
 * acontecer — e nada rodar, sem erro, sem log, sem run.
 */
const EXPECTED_ENTITY_KIND: Record<string, string> = ENTIDADE_ESPERADA_POR_GATILHO;

/** Os gatilhos que o trigger do banco grava com `entity_kind='lead'` (#1528). */
const GATILHOS_DO_TRIGGER = new Set<string>(GATILHOS_DO_TRIGGER_DE_LEAD);

/**
 * A entidade que a REGRA enxerga — nem sempre a que está gravada na linha.
 *
 * Para os quatro gatilhos do trigger do banco, `'lead'` (o que o `fn_log_event`
 * deriva do `split_part` do event_type) é o MESMO fato que `'crm_lead'`
 * (o que os handlers da feature emitem, e o que `buildContext` sabe hidratar).
 * Só para eles: em qualquer outro evento, o `entity_kind` gravado segue
 * mandando, que é a anti-duplicação de sempre.
 */
function entidadeDoEvento(row: Pick<EventRow, "event_type" | "entity_kind">): string {
  if (row.entity_kind === "lead" && GATILHOS_DO_TRIGGER.has(row.event_type)) return "crm_lead";
  return row.entity_kind;
}

interface RuleRow {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
}

/** Hidrata o contexto avaliado pelas condições/ações a partir do entity do evento. */
export async function buildContext(admin: SupabaseClient, row: EventRow): Promise<Record<string, unknown>> {
  const context: Record<string, unknown> = { event: row.payload };
  // Admin client bypassa RLS — todo lookup filtra organization_id do evento
  // (doutrina multi-tenant; um FK cross-org corrompido nunca vaza pro contexto).
  const org = row.organization_id;
  // `lead` ≡ `crm_lead` para os gatilhos do trigger do banco (#1528): sem
  // isto, `lead.won`/`lead.lost`/`lead.reopened`/`lead.assigned` chegavam com a
  // entidade que o `fn_log_event` deriva e a regra rodava SEM o objeto `lead`
  // — um webhook de ganho sem o negócio dentro, que é pior que webhook nenhum.
  const entidade = entidadeDoEvento(row);
  if (entidade === "crm_lead") {
    // O id vem da linha (o `fn_log_event` grava `entity_id` = payload.lead_id);
    // o payload é o fallback para fixtures e para o Reenviar.
    const payloadLeadId = typeof row.payload?.lead_id === "string" ? row.payload.lead_id : null;
    const leadId = row.entity_id ?? payloadLeadId;
    const { data: lead } = leadId
      ? await admin
          .from("crm_leads")
          .select("*")
          .eq("id", leadId)
          .eq("organization_id", org)
          .maybeSingle()
      : { data: null };
    if (lead) {
      context.lead = lead;
      if (lead.contact_id) {
        const { data: contact } = await admin
          .from("contacts")
          .select("*")
          .eq("id", lead.contact_id)
          .eq("organization_id", org)
          .maybeSingle();
        if (contact) context.contact = contact;
      }
    }
  } else if (row.entity_kind === "contact" && row.entity_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("*")
      .eq("id", row.entity_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (contact) context.contact = contact;
  } else if (row.entity_kind === "calendar_appointment" && row.entity_id) {
    // O evento carrega só os ids; o resto vem daqui, como em lead.created. O
    // que o operador escreve no aviso ({{agendamento.notes}}, a hora, o nome do
    // contato) precisa estar no contexto, senão o template renderiza vazio e o
    // time recebe um aviso sem o que ele foi criado para dizer.
    const { data: agendamento } = await admin
      .from("calendar_appointments")
      .select("*")
      .eq("id", row.entity_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (agendamento) {
      // DOIS NOMES PARA A MESMA LINHA, e é de propósito.
      //
      // Este fork hidrata `agendamento` (é o token que a tela oferece em
      // `ActionConfigForm`: {{agendamento.starts_at}}, {{agendamento.notes}}) e o
      // upstream hidrata `appointment`. Regra JÁ SALVA não se reescreve sozinha:
      // ficar com um nome só deixaria mudo, em produção, todo aviso escrito na
      // outra linhagem — o template renderiza string vazia e ninguém vê erro.
      // Publicar a mesma linha sob os dois nomes custa uma referência e nenhuma
      // consulta a mais. Quando as regras antigas tiverem sido migradas, o
      // `appointment` fica e o `agendamento` sai (nesta ordem, nunca na outra).
      context.agendamento = agendamento;
      context.appointment = agendamento;
    }
    // O CONTATO sai do COMPROMISSO primeiro (upstream): a linha do banco é a
    // versão de AGORA, e o payload é a de quando o evento nasceu — nome trocado
    // no meio do caminho chegaria errado no texto da mensagem. O payload fica
    // como segunda opção porque a leitura acima pode voltar vazia (compromisso
    // apagado, RLS), e sem ela o aviso perderia até o nome de quem marcou.
    // Um `??` por termo. A fusão encaixou a leitura nova na frente da antiga e
    // deixou o `(… ?? null)` do meio: `(x ?? null) ?? y` é `x ?? y` escrito duas
    // vezes, e é o que o TS2871 aponta.
    const contactId =
      (agendamento as { contact_id?: string | null } | null)?.contact_id ??
      (row.payload.contact_id as string | null) ??
      null;
    if (contactId) {
      const { data: contact } = await admin
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .eq("organization_id", org)
        .maybeSingle();
      if (contact) context.contact = contact;
    }
    // O lead entra quando JÁ existe. Quando não existe, a ausência é o sinal
    // que a ação `create_or_move_lead` lê para criar o card em vez de mover.
    const leadId = (row.payload.lead_id as string | null) ?? null;
    if (leadId) {
      const { data: lead } = await admin
        .from("crm_leads")
        .select("*")
        .eq("id", leadId)
        .eq("organization_id", org)
        .maybeSingle();
      if (lead) context.lead = lead;
    }
  } else if (row.entity_kind === "message" && row.entity_id) {
    const contactId = row.payload.contact_id as string | undefined;
    if (contactId) {
      const { data: contact } = await admin
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .eq("organization_id", org)
        .maybeSingle();
      if (contact) context.contact = contact;
    }
  } else if (row.entity_kind === ENTIDADE_DA_OBRIGACAO && row.entity_id) {
    // FORK MIA — o item de obrigação vira negócio, contato e `obrigacao` pela
    // mesma herança da tela (lib/obrigacoes/contexto-da-automacao.ts).
    Object.assign(context, await contextoDaObrigacao(admin, row));
  }
  return context;
}

/**
 * Grava a linha do adiamento — a única evidência de que a regra casou e está
 * esperando.
 *
 * Um run por adiamento, e não um por tique do drain: o evento só volta na hora
 * marcada por `retry_at`, então não há repetição a cada minuto. Se a janela
 * seguir fechada quando ele voltar, sai outra linha — e aí a repetição É a
 * informação (a automação está presa há três dias).
 *
 * Fire-and-forget quanto a erro: perder o registro não pode impedir o
 * adiamento, que é o que protege o número.
 */
async function registrarAdiamento(
  admin: SupabaseClient,
  row: EventRow,
  rule: RuleRow,
  actionType: string,
  retryAt: string,
): Promise<void> {
  const { error } = await admin.from("automation_rule_runs").insert({
    organization_id: row.organization_id,
    rule_id: rule.id,
    event_id: row.id,
    status: "adiado",
    actions_result: [
      {
        type: actionType,
        status: "postponed",
        detail: {
          reason: "fora_da_janela_de_envio",
          retry_at: retryAt,
          explicacao:
            "A regra casou e está esperando a janela de envio do número reabrir — nada foi tentado ainda.",
        },
      },
    ],
  });
  if (error) {
    logger.error("[automation.engine] não foi possível registrar o adiamento", {
      rule_id: rule.id,
      organization_id: row.organization_id,
      error: error.message,
    });
  }
}

export async function runAutomationForEvent(
  admin: SupabaseClient,
  row: EventRow,
): Promise<HandlerResult> {
  const serviceBoundaries = new Map<string, Promise<ServiceBoundary>>();
  const requestId = row.metadata?.request_id;
  const causedByRule =
    Boolean(row.metadata?.caused_by_rule) || (typeof requestId === "string" && requestId.startsWith("rule:"));
  if (causedByRule) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "caused_by_rule" };
  }

  const expectedKind = EXPECTED_ENTITY_KIND[row.event_type];
  if (expectedKind && entidadeDoEvento(row) !== expectedKind) {
  
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "entity_kind_mismatch" };
  }

  const { data: rules, error } = await admin
    .from("automation_rules")
    .select("id, name, conditions, actions")
    .eq("organization_id", row.organization_id)
    .eq("trigger_event", row.event_type)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "error", detail: error.message };
  }
  // Fork MIA: as regras salvas como `appointment.booked` rodam no
  // `appointment.created`, que é o mesmo fato (ver regras-do-nome-antigo.ts).
  const doNomeAntigo = await regrasDoNomeAntigo(admin, row);
  if (doNomeAntigo.error) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "error", detail: doNomeAntigo.error.message };
  }
  const todas = [...(rules ?? []), ...doNomeAntigo.data] as unknown as RuleRow[];
  if (!todas.length) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_rules" };
  }

  // ═══ EVENTO DIRIGIDO: A REGRA QUE O RELÓGIO APONTOU ═══
  //
  // O gatilho de data do funil (`lead.date_field_due`) não nasce de uma ação de
  // ninguém: quem o emite é a varredura `cron/lead-date-field-due`, e ela sabe
  // PARA QUAL REGRA — o payload traz `rule_id`. Sem este recorte, duas regras do
  // mesmo gatilho com `dias` diferentes (240 dias antes do casamento e 60
  // depois dele) rodariam as duas no mesmo evento, porque aqui só se casa
  // `event_type`: a confirmação de entrega sairia junto com o aviso de 240 dias.
  //
  // Todo outro gatilho emite payload sem `rule_id`, então `regraDoEvento`
  // devolve `null` e a seleção segue exatamente como sempre foi: todas as
  // regras ativas daquele tipo.
  const regraApontada = regraDoEvento(row.payload);
  const matched = regraApontada ? todas.filter((r) => r.id === regraApontada) : todas;
  if (!matched.length) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_rules" };
  }

  const context = await buildContext(admin, row);
  const applicable = matched.filter((r) => evaluateConditions(r.conditions ?? [], context));
  if (!applicable.length) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_match" };
  }

  // Pré-checagem de postpone (throttle etc.): all-or-nothing ANTES de executar
  // qualquer ação — reexecução parcial no retry seria pior que atraso.
  for (const rule of applicable) {
    for (const action of rule.actions ?? []) {
      const executor = getAction(action.type);
      if (!executor?.postponeUntil) continue;
      const until = await executor.postponeUntil(
        { admin, serviceBoundaries, organizationId: row.organization_id, ruleId: rule.id, ruleName: rule.name, event: row, context, requestId: row.id },
        action.config ?? {},
      );
      if (until) {
        // A ESPERA É UM ESTADO, e um estado que ninguém vê é indistinguível de
        // morte. Sem esta linha o evento sumia até a janela reabrir e a aba
        // Atividade não mostrava NADA — para quem montou a regra, "não apareceu
        // nada" e "não rodou" são a mesma tela (migration 0175).
        await registrarAdiamento(admin, row, rule, action.type, until);
        return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "retry", retry_at: until };
      }
    }
  }

  for (const rule of applicable) {
    const results: ActionResultDetail[] = [];
    // O índice é o da lista INTEIRA — a posição do resultado em
    // `actions_result` e parte do id da entrega do webhook (#1529).
    for (const [indiceDaAcao, action] of (rule.actions ?? []).entries()) {
      const executor = getAction(action.type);
      if (!executor) {
        results.push({ type: action.type, status: "failed", error: "unknown_action" });
        continue;
      }
      // Defesa em profundidade do veto de #1528: a regra pode ter chegado por
      // outra porta que não o schema (SQL, import). Regravar o lead aqui
      // reemitiria o próprio gatilho, sem marca de anti-laço.
      if (acoesQueFechamLaco(row.event_type, [action]).length) {
        results.push({ type: action.type, status: "skipped", error: "acao_fecharia_laco" });
        continue;
      }
      try {
        results.push(
          await executor.execute(
            {
              admin,
              serviceBoundaries,
              organizationId: row.organization_id,
              ruleId: rule.id,
              ruleName: rule.name,
              event: row,
              context,
              requestId: row.id,
              actionIndex: indiceDaAcao,
              ruleActions: rule.actions ?? [],
            },
            action.config ?? {},
          ),
        );
      } catch (err) {
        results.push({
          type: action.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ═══ O AGREGADOR TAMBÉM PRECISA DIZER A VERDADE ═══
    //
    // `failed === 0 ? "success"` fazia uma ação `postponed` — mensagem que ficou
    // em `queued` e NÃO chegou ao cliente — virar "Sucesso" verde na tela. É o
    // MESMO defeito que `desfecho-do-envio.ts` existe para matar, ressurgindo
    // um nível acima: a ação passou a ser honesta e quem soma continuava
    // mentindo. Conserto por instância, não por classe.
    //
    // Achado por revisão adversarial, com o cenário alcançável: instalação sem
    // o transporte de WhatsApp configurado (o caso de TODA instalação nova), a
    // janela aberta, `postponeUntil` devolve null, a ação executa, e o envio
    // termina em `queued` com `queued_reason`. É exatamente o estado congelado
    // em `tests/invariants/automation-send-whatsapp.test.ts` caso 2.
    //
    // A MESMA mentira reapareceu de novo, um degrau abaixo: `status ===
    // "skipped"` (guarda-do-contato.ts — sem contato, bloqueado, sem telefone,
    // OU sem consentimento) também não era `failed` nem `postponed`, então caía
    // no `else` e virava "Sucesso" — pra uma mensagem que nunca foi NEM
    // TENTADA. Achado pelo e2e `tests/e2e/automacao-diz-a-verdade.spec.ts`: um
    // lead de webhook genérico (sem Respondi, sem pergunta de consentimento)
    // nunca tem `consent.marketing.granted_at`, então TODO envio automático
    // pra um lead assim batia no gate de consentimento — e a tela dizia
    // "Sucesso" pra um envio que nem chegou a discar o WhatsApp. Pior que o
    // defeito original: aquele pelo menos tinha TENTADO.
    //
    // `skipped` entra junto de `failed` na contagem: as duas significam "não
    // saiu, e não é a fila que vai resolver sozinha" — a diferença entre elas
    // (uma tentou e não conseguiu, a outra nem tentou) é o `reason`/`error` que
    // a ação já registra, não o status agregado.
    //
    // A ordem importa: falha (+ skip) vence adiamento. Uma regra em que uma
    // ação falhou/pulou e outra ficou esperando é `partial` — quem lê precisa
    // saber que algo quebrou, não que está tudo a caminho.
    const naoEnviadas = results.filter((r) => r.status === "failed" || r.status === "skipped").length;
    const adiados = results.filter((r) => r.status === "postponed").length;
    const status =
      naoEnviadas > 0
        ? naoEnviadas === results.length
          ? "failed"
          : "partial"
        : adiados > 0
          ? "adiado"
          : "success";
    const { data: runRow, error: runErr } = await admin
      .from("automation_rule_runs")
      .insert({
        organization_id: row.organization_id,
        rule_id: rule.id,
        event_id: row.id,
        status,
        actions_result: results,
      })
      .select("id")
      .maybeSingle();
    if (runErr) logger.error("[automation.engine] run insert failed", { error: runErr.message });

    // Audit só em falha/partial (spec §9) — não inflar audit em toda run.
    if (status !== "success") {
      void audit({
        action: "automation.rule_executed",
        organizationId: row.organization_id,
        resourceType: "automation_rule_run",
        resourceId: runRow?.id ?? null,
        metadata: { rule_id: rule.id, status, event_type: row.event_type },
      });
    }

    // run_count sem RPC de increment: read-modify-write é aceitável aqui
    // (contador informativo de UI, não invariante).
    const { data: cur } = await admin.from("automation_rules").select("run_count").eq("id", rule.id).maybeSingle();
    await admin
      .from("automation_rules")
      .update({ last_run_at: new Date().toISOString(), run_count: (cur?.run_count ?? 0) + 1 })
      .eq("id", rule.id);
  }

  return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok" };
}

/**
 * AS REGRAS SALVAS COM O NOME ANTIGO DE "HORÁRIO MARCADO" — servidas pelo
 * evento de hoje (fork MIA).
 *
 * ─── O defeito que isto fecha ───────────────────────────────────────────────
 * Este fork emitia `appointment.booked` ao marcar reunião; o upstream passou a
 * emitir `appointment.created` no MESMO instante e pela MESMA régua (nascer
 * pendente ou confirmado — `gatilhoDaTransicao(null, …)`). Os dois juntos eram
 * o mesmo fato anunciado duas vezes em `event_log`: quem ouve compromisso por
 * webhook contaria a reunião em dobro. A cerca é
 * `tests/unit/agenda-aviso-de-compromisso.test.ts` ("exatamente um aviso").
 *
 * O handler da agenda agora emite só o `created`, e ele leva as duas chaves que
 * o corpo antigo carregava e que o lado MIA lê (`lead_id`, `nome_do_tipo`).
 *
 * ─── Por que o motor precisa disto ──────────────────────────────────────────
 * As regras JÁ SALVAS em produção guardam `trigger_event = 'appointment.booked'`
 * (card no funil comercial, aviso no grupo do time), e o motor casa regra por
 * `trigger_event = event_type`. Sem esta busca a mais, elas parariam de rodar
 * caladas no dia em que o `booked` deixou de sair: a regra continua na tela,
 * a reunião é marcada, e nem o card nasce nem o grupo recebe nada.
 *
 * Reescrever as regras salvas seria a outra saída, e é a pior: mexe em dado de
 * cliente no deploy, e o editor mostra as condições antigas pelo nome antigo
 * (`AGENDAMENTO_FIELDS_LEGADO`). Aqui nada se reescreve — a regra antiga só
 * passa a ouvir o evento que diz a mesma coisa.
 *
 * Evento `booked` que ainda esteja na fila no deploy segue pelo caminho normal
 * do motor (`trigger_event = event_type`); esta busca só entra no `created`,
 * então nenhuma regra roda duas vezes pelo mesmo horário.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { GATILHO_LEGADO_DE_REUNIAO, type GatilhoDeAutomacao } from "@/lib/schemas/webhooks";

/** O evento de hoje que diz o que o nome antigo dizia. */
export const GATILHO_QUE_SERVE_O_NOME_ANTIGO = "appointment.created" satisfies GatilhoDeAutomacao;

/**
 * As regras ativas salvas com o nome antigo, quando o evento é o que as serve.
 *
 * Para qualquer outro evento devolve vazio SEM consultar: o motor continua
 * fazendo exatamente uma leitura de regras por evento, como sempre fez.
 *
 * `select("*")` e não a lista de colunas do motor: se o upstream passar a ler
 * outra coluna da regra, a regra antiga chega com ela também, em vez de chegar
 * sem e divergir das irmãs.
 */
export async function regrasDoNomeAntigo(
  admin: SupabaseClient,
  row: Pick<EventRow, "organization_id" | "event_type">,
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  if (row.event_type !== GATILHO_QUE_SERVE_O_NOME_ANTIGO) return { data: [], error: null };
  const { data, error } = await admin
    .from("automation_rules")
    .select("*")
    .eq("organization_id", row.organization_id)
    .eq("trigger_event", GATILHO_LEGADO_DE_REUNIAO)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  return { data: data ?? [], error: error ? { message: error.message } : null };
}

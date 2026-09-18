/**
 * varredura-de-avisos — fecha o que deixou de valer na Central.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * A Central tem 26 tipos de aviso e quatro sabiam se fechar. Os outros ficavam
 * abertos DEPOIS de resolvidos: a conexão voltou, o lead respondeu, a mensagem
 * saiu — e o alerta crítico seguia vermelho. O resultado não é barulho: é uma
 * tela que MENTE, e o operador aprende a não olhar. Aí o aviso que importa chega
 * no meio de trinta que já não valem.
 *
 * ─── O que este cron faz, e o que ele se recusa a fazer ────────────────────
 *
 * Ele aplica o registro de `lib/inbox-do-agente/como-cada-aviso-fecha.ts`, e só
 * ele. Três caminhos:
 *
 *  1. CONDIÇÃO — repergunta ao banco se ainda é verdade (a conversa ainda está
 *     sem dono? ainda está na fila?). Fecha quando não é mais.
 *  2. IDADE — o fato não muda (uma chamada perdida segue perdida), mas para de
 *     ser acionável. Fecha pelo prazo DECLARADO no registro.
 *  3. DECISÃO — não toca. O aviso É uma pergunta ("aprovo esta melhoria?"), e
 *     fechá-lo sozinho apagaria a pergunta sem ninguém saber que existiu.
 *
 * O teto de segurança é a rede dos de condição: se a condição ficar inavaliável
 * para sempre (a conversa foi apagada, o contato anonimizado), o aviso ainda
 * assim sai depois do prazo. Nenhum aviso fica aberto para sempre por acidente
 * — só por decisão escrita.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (fail-closed), como os demais.
 *
 * NOTA DE DEPLOY: o agendamento vive no serviço `scheduler` do
 * `docker-compose.prod.yml` — não há `vercel.json` neste repo (self-host).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { avisosQueVencem, tetosDeSeguranca } from "@/lib/inbox-do-agente/como-cada-aviso-fecha";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto por rodada e por regra. A varredura roda de hora em hora; não precisa de pressa. */
const LIMITE = 500;

function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const fechados: Record<string, number> = {};

  async function fechar(chaveDoLog: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { data, error } = await admin
      .from("agent_inbox_items")
      .update({ status: "resolved", resolved_at: agora })
      .in("id", ids)
      // Cinto contra corrida: alguém pode ter fechado à mão entre a leitura e a
      // escrita, e recontar isso como "o vigia fechou" inflaria o número que
      // esta rota devolve — o único jeito de saber se a varredura está fazendo
      // alguma coisa.
      .eq("status", "open")
      .select("id");
    if (error) {
      logger.warn("[varredura-de-avisos] falhou ao fechar", {
        regra: chaveDoLog,
        detail: error.message,
        requestId,
      });
      return;
    }
    fechados[chaveDoLog] = (fechados[chaveDoLog] ?? 0) + (data ?? []).length;
  }

  // ── 1. Por CONDIÇÃO: a conversa saiu do estado que gerou o aviso ──────────
  //
  // Os dois abaixo têm a mesma pergunta por baixo — "esta conversa ainda está
  // largada?" — e são os dois que mais enchem a Central, porque toda passagem
  // de bastão e toda conversa sem dono passa por eles.
  const { data: abertosDeConversa } = await admin
    .from("agent_inbox_items")
    .select("id, kind, ref_id")
    .in("kind", ["handoff", "routing_unassigned"])
    .eq("ref_kind", "conversation")
    .eq("status", "open")
    .limit(LIMITE);

  const porConversa = (abertosDeConversa ?? []) as Array<{
    id: string;
    kind: string;
    ref_id: string;
  }>;

  if (porConversa.length > 0) {
    const { data: conversas } = await admin
      .from("conversations")
      .select("id, status, assigned_to_user_id")
      .in(
        "id",
        porConversa.map((a) => a.ref_id),
      );

    const estado = new Map(
      (conversas ?? []).map((c) => {
        const linha = c as { id: string; status: string | null; assigned_to_user_id: string | null };
        return [linha.id, linha];
      }),
    );

    const resolvidos = porConversa
      .filter((a) => {
        const c = estado.get(a.ref_id);
        // Conversa sumida NÃO fecha o aviso aqui: quem cuida disso é o teto de
        // segurança, com prazo. Fechar por ausência confundiria "resolvido" com
        // "perdi de vista", e as duas coisas pedem reações diferentes.
        if (!c) return false;
        // Alguém assumiu, ou a conversa saiu da fila: nos dois casos o aviso
        // ("largada") deixou de ser verdade.
        return c.assigned_to_user_id !== null || (c.status !== null && c.status !== "pending");
      })
      .map((a) => a.id);

    await fechar("conversa_assumida", resolvidos);
  }

  // ── 2. Por CONDIÇÃO: o job voltou para a fila ─────────────────────────────
  const { data: abertosDeJob } = await admin
    .from("agent_inbox_items")
    .select("id, ref_id")
    .eq("kind", "job_dead")
    .eq("ref_kind", "job_queue")
    .eq("status", "open")
    .limit(LIMITE);

  const porJob = (abertosDeJob ?? []) as Array<{ id: string; ref_id: string }>;
  if (porJob.length > 0) {
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, status")
      .in(
        "id",
        porJob.map((a) => a.ref_id),
      )
      .neq("status", "dead");
    const vivos = new Set((jobs ?? []).map((j) => (j as { id: string }).id));
    await fechar(
      "job_de_volta",
      porJob.filter((a) => vivos.has(a.ref_id)).map((a) => a.id),
    );
  }

  // ── 3. Por IDADE: o fato não muda, a utilidade sim ────────────────────────
  for (const { kind, dias } of avisosQueVencem()) {
    const { data } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("kind", kind)
      .eq("status", "open")
      .lt("created_at", diasAtras(dias))
      .limit(LIMITE);
    await fechar(`venceu:${kind}`, ((data ?? []) as Array<{ id: string }>).map((a) => a.id));
  }

  // ── 4. O TETO dos de condição ─────────────────────────────────────────────
  //
  // A rede, não a regra. Um aviso que chega aqui é sintoma de que a condição
  // dele parou de ser avaliável — vale o log, porque é assim que se descobre
  // uma re-pergunta que quebrou.
  for (const { kind, dias } of tetosDeSeguranca()) {
    const { data } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("kind", kind)
      .eq("status", "open")
      .lt("created_at", diasAtras(dias))
      .limit(LIMITE);
    const ids = ((data ?? []) as Array<{ id: string }>).map((a) => a.id);
    if (ids.length > 0) {
      logger.info("[varredura-de-avisos] fechando pelo teto de segurança", {
        kind,
        dias,
        quantidade: ids.length,
        requestId,
      });
    }
    await fechar(`teto:${kind}`, ids);
  }

  return ok({ fechados }, { requestId });
}

export const GET = handle;
export const POST = handle;

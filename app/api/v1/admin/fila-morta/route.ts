/**
 * GET|POST /api/v1/admin/fila-morta — o trabalho que morreu, e a volta dele.
 *
 * GET  → os jobs mortos agrupados pela CAUSA, de todas as organizações.
 * POST → devolve um grupo (ou um job) à fila.
 *
 * Atravessa o tenant de propósito: quem conserta um rate limit, uma chave
 * expirada ou um número caído é quem opera a plataforma, e o mesmo defeito mata
 * jobs de vários clientes ao mesmo tempo. Uma tela por tenant obrigaria a
 * percorrer um a um para desfazer um estrago que é único.
 *
 * ⚠️ Reprocessar é um ato com consequência: cada job morto é um turno de
 * conversa que não aconteceu. Devolvê-los à fila faz o agente responder AGORA
 * mensagens que chegaram horas atrás — o que é certo quando a causa era
 * transitória (o rate limit cedeu) e errado quando o lead já foi atendido por
 * uma pessoa no meio tempo. Por isso a tela mostra desde quando eles estão
 * parados, e o botão diz quantos vão voltar.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { agruparFilaMorta, type JobMorto } from "@/lib/operacao/fila-morta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto da varredura. Rajada grande é comum; ler 5.000 já responde a pergunta. */
const LIMITE = 5_000;

const corpoSchema = z.object({
  /** Os jobs a devolver. A tela manda o grupo inteiro. */
  ids: z.array(z.string().uuid()).min(1).max(500),
});

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_queue")
    .select("id, organization_id, kind, last_error, attempts, created_at")
    .eq("status", "dead")
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) return fail("db_error", error.message, 500, { requestId });

  const jobs = (data ?? []) as unknown as JobMorto[];
  const grupos = agruparFilaMorta(jobs);

  // O nome do cliente, para o grupo dizer QUEM ficou sem resposta. Uma consulta
  // só: a rajada costuma ser de poucas organizações, e uma por grupo seria N+1
  // numa tela que já lê cinco mil linhas.
  const { data: orgs } = await admin.from("organizations").select("id, display_name");
  const nome = new Map(
    (orgs ?? []).map((o) => [
      (o as { id: string }).id,
      (o as { display_name: string }).display_name,
    ]),
  );

  return ok(
    {
      total: jobs.length,
      truncado: jobs.length >= LIMITE,
      grupos: grupos.map((g) => ({
        ...g,
        organizacoes: g.organizacoes.map((id) => nome.get(id) ?? id),
        // Os ids vão para o POST, mas capados: devolver 3.000 uuids na tela
        // engorda a resposta sem servir a ninguém, e o POST tem teto próprio.
        ids: g.ids.slice(0, 500),
      })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Lista inválida.", 422, { requestId });

  const admin = createAdminClient();

  /**
   * `attempts: 0` e `run_after: agora`.
   *
   * Zerar as tentativas é o ponto: sem isso o job volta com 5 de 5 e morre na
   * primeira falha, sem nenhuma chance real — e o operador conclui que o botão
   * não funciona. O `status` volta a `pending`; `locked_by`/`locked_at` são
   * limpos porque um lease órfão de um worker que já morreu impediria o claim.
   *
   * O filtro por `status = 'dead'` é o que impede a corrida: se o job já voltou
   * (dois cliques, duas abas), o segundo update não pega nada em vez de
   * ressuscitar algo que está rodando agora.
   */
  const { data, error } = await admin
    .from("job_queue")
    .update({
      status: "pending",
      attempts: 0,
      run_after: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
    })
    .in("id", parsed.data.ids)
    .eq("status", "dead")
    .select("id");
  if (error) return fail("db_error", error.message, 500, { requestId });

  const voltaram = (data ?? []).length;

  /**
   * Fecha os avisos da Central desses jobs.
   *
   * Sem isto, o alerta crítico continua lá depois de o problema ter sido
   * resolvido — o defeito de "aviso que não se fecha" que este repositório já
   * mediu, e o que faz a Central virar uma parede vermelha que ninguém lê.
   */
  if (voltaram > 0) {
    await admin
      .from("agent_inbox_items")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("kind", "job_dead")
      .eq("ref_kind", "job_queue")
      .in("ref_id", parsed.data.ids)
      .eq("status", "open");
  }

  void audit({
    action: "platform.fila_morta_reprocessada",
    actorUserId: ctx.user.id,
    organizationId: null,
    requestId,
    metadata: { pedidos: parsed.data.ids.length, voltaram },
  });

  return ok({ voltaram }, { requestId });
}

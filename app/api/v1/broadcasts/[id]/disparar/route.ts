/**
 * POST /api/v1/broadcasts/[id]/disparar — tira a campanha do rascunho.
 *
 * Separado da criação de propósito: criar monta a lista e mostra quem ficou de
 * fora; disparar é o ato que gasta. Juntar os dois tiraria a chance de olhar a
 * peneira antes — e é olhando a peneira que se descobre que 900 dos 4.000
 * contatos não têm telefone.
 *
 * A trava é conferida AQUI DE NOVO, e não só na criação: entre montar a lista e
 * clicar em disparar pode ter passado uma hora, e nessa hora outro disparo pode
 * ter consumido o crédito.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { podeComecar } from "@/lib/broadcast/plano";
import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * O corpo é OPCIONAL, e é o que separa "disparar" de "agendar".
 *
 * Sem corpo, tudo segue como sempre: sai agora. Com `agendado_para`, a campanha
 * vai para `agendada` e o worker a pega quando a hora chegar — a coluna, o
 * status e o índice parcial já existiam desde a 0247, esperando alguém que os
 * criasse. O worker já trata `status: 'agendada'` e `agendado_para <= now()`;
 * o que faltava era exatamente esta porta.
 */
const corpoSchema = z
  .object({
    /** ISO-8601. Ausente ou nulo = agora, que é o comportamento de sempre. */
    agendado_para: z.string().datetime({ offset: true }).nullish(),
  })
  .nullish();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Agendamento inválido.", 422, { requestId });
  }
  const quando = parsed.data?.agendado_para ?? null;

  /**
   * Hora no PASSADO é recusada, e não "corrigida" para agora.
   *
   * Aceitar caladamente faria a tela dizer "agendado para ontem" e a campanha
   * sair na hora — que é o oposto do que quem digitou a data esperava. Um
   * minuto de tolerância absorve o relógio do navegador adiantado.
   */
  if (quando && new Date(quando).getTime() < Date.now() - 60_000) {
    return fail("validation_failed", "A hora escolhida já passou.", 422, { requestId });
  }

  const { id } = await ctx.params;
  const { data: campanha } = await db
    .from("broadcasts")
    .select("id, status, template_name, template_language, preco_cents")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!campanha) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  // Só rascunho e pausada saem daqui. Reenviar uma concluída seria mandar tudo
  // de novo para quem já recebeu — e cobrar de novo.
  if (campanha.status !== "rascunho" && campanha.status !== "pausada") {
    return fail("state_conflict", `A campanha está ${campanha.status}.`, 409, { requestId });
  }

  const [{ count }, saldoLido, { data: preco }, { data: template }] = await Promise.all([
    db
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", id)
      .eq("status", "pendente"),
    // FORK MIA: o saldo sai do extrato INTEIRO (`lerSaldoDaCarteira`, paginado).
    // O `.limit(100_000)` que estava aqui trazia no máximo 1000 linhas.
    lerSaldoDaCarteira(db, authz.org.orgId),
    db
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents")
      .eq("organization_id", authz.org.orgId)
      .maybeSingle(),
    db
      .from("meta_templates")
      .select("status")
      .eq("organization_id", authz.org.orgId)
      .eq("name", campanha.template_name)
      .eq("language", campanha.template_language)
      .maybeSingle(),
  ]);

  const precoCents =
    preco?.preco_por_mensagem_cents === null || preco?.preco_por_mensagem_cents === undefined
      ? null
      : Number(preco.preco_por_mensagem_cents);

  const veredicto = podeComecar({
    destinatarios: count ?? 0,
    saldoCents: saldoLido.saldo_cents,
    precoPorMensagemCents: precoCents,
    templateAprovado: template?.status === "APPROVED",
    temCanal: true,
    qualidade: "UNKNOWN",
  });
  if (!veredicto.pode) {
    return fail("invalid_request", veredicto.motivo ?? "nao_pode_disparar", 422, {
      requestId,
      details: { falta_cents: veredicto.trava?.falta_cents ?? null },
    });
  }

  const agora = new Date().toISOString();
  const admin = createAdminClient();
  await admin
    .from("broadcasts")
    .update({
      status: quando ? "agendada" : "enviando",
      agendado_para: quando,
      /**
       * O preço é congelado AQUI, inclusive quando agenda.
       *
       * É o acordado no momento em que a pessoa MANDOU disparar, e é ele que o
       * relatório desta campanha vai usar para sempre. Congelar no envio faria
       * uma campanha marcada para sexta sair pelo preço de sexta — e quem
       * autorizou autorizou o de hoje.
       */
      preco_cents: precoCents,
      // `iniciado_em` é quando COMEÇOU a sair, não quando foi autorizada: a
      // campanha agendada ainda não começou, e carimbar agora faria o relatório
      // contar como iniciada uma campanha que não mandou nada.
      iniciado_em: quando ? null : agora,
      motivo_da_parada: null,
      updated_at: agora,
    })
    .eq("id", id);

  void audit({
    action: "broadcast.disparado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: {
      broadcast_id: id,
      destinatarios: count ?? 0,
      preco_cents: precoCents,
      agendado_para: quando,
    },
  });

  // O envio em si é do cron (a cada minuto): responder "enviando" e sair é o
  // que evita uma requisição HTTP segurando 4.000 mensagens.
  return ok(
    { id, status: quando ? "agendada" : "enviando", agendado_para: quando, na_fila: count ?? 0 },
    { requestId },
  );
}

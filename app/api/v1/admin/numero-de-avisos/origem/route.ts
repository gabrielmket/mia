/**
 * PUT /api/v1/admin/numero-de-avisos/origem — POR QUAL NÚMERO sai o aviso DESTE cliente.
 *
 * FORK MIA (.62). A terceira metade do par número+grupo: o grupo é de cada
 * empresa (rota irmã `grupo`), e agora o número também pode ser — o da
 * plataforma (padrão, como sempre foi) ou um que a própria empresa conectou.
 * A regra de envio mora em `lib/avisos/origem-do-aviso.ts`; aqui só se grava a
 * escolha, conferida.
 *
 * Mora no painel da plataforma, ao lado do grupo, porque quem adiciona o número
 * aos grupos é quem opera, e é o mesmo gesto: escolher o número e o grupo dele.
 *
 * O que a gravação confere, e por quê:
 *  - o número é DESTA empresa: o aviso leva nome do lead e resumo da
 *    qualificação, e sair pelo telefone de outro cliente é o pior desfecho;
 *  - entrega em grupo (a capacidade da matriz, nunca o nome do canal): a API
 *    oficial não manda mensagem para grupo, e a escolha ficaria salva e muda;
 *  - não é o número da plataforma (seria a opção "plataforma" com outro nome);
 *  - está CONECTADO — mas só quando o número muda. Ligar ou desligar a reserva
 *    de um número que caiu tem de continuar possível: é justamente a hora em que
 *    alguém vai querer mexer nela.
 *
 * Grava em `organizations.settings.numero_de_avisos` preservando o resto do
 * jsonb — o mesmo cuidado da rota do grupo.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { CHAVE_DA_ORIGEM, lerOrigemDoAviso } from "@/lib/avisos/origem-do-aviso";
import { entregaEmGrupo } from "@/lib/channels";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import type { ChannelSessionRef } from "@/lib/channels/session-ref";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  organization_id: z.string().uuid(),
  origem: z.discriminatedUnion("modo", [
    z.object({ modo: z.literal("plataforma") }),
    z.object({
      modo: z.literal("empresa"),
      channel_session_id: z.string().uuid(),
      reserva_da_plataforma: z.boolean(),
    }),
  ]),
});

type LinhaDaSessao = {
  id: string;
  organization_id: string;
  provider: ChannelSessionRef["provider"];
  status: string | null;
  archived_at: string | null;
  e_numero_de_avisos: boolean | null;
};

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    ctx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Escolha de número inválida.", 422, { requestId });
  }
  const { organization_id: organizationId, origem } = parsed.data;

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (erroLeitura) return fail("db_error", erroLeitura.message, 500, { requestId });
  if (!atual) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const settings = { ...((atual.settings as Record<string, unknown> | null) ?? {}) };

  if (origem.modo === "empresa") {
    const { data: sessao, error } = await admin
      .from("channel_sessions")
      .select("id, organization_id, provider, status, archived_at, e_numero_de_avisos")
      .eq("id", origem.channel_session_id)
      .maybeSingle();
    if (error) return fail("db_error", error.message, 500, { requestId });

    const linha = sessao as LinhaDaSessao | null;
    if (!linha || linha.organization_id !== organizationId || linha.archived_at) {
      return fail("validation_failed", "Este número não é desta empresa, ou não existe mais.", 422, { requestId });
    }
    if (!entregaEmGrupo(linha.provider)) {
      return fail(
        "validation_failed",
        "Este número não entrega em grupo (a API oficial não manda mensagem para grupo). Escolha um número conectado por QR Code.",
        422,
        { requestId },
      );
    }
    if (linha.e_numero_de_avisos === true) {
      return fail(
        "validation_failed",
        "Este é o número da plataforma. Para usá-lo, escolha “Número da plataforma”.",
        422,
        { requestId },
      );
    }
    const anterior = lerOrigemDoAviso(settings);
    const mesmoNumero = anterior.modo === "empresa" && anterior.channel_session_id === linha.id;
    if (!mesmoNumero && linha.status !== STATUS_SAUDAVEL) {
      return fail(
        "validation_failed",
        "Este número não está conectado agora. Reconecte-o antes de escolhê-lo para os avisos.",
        422,
        { requestId },
      );
    }
    settings[CHAVE_DA_ORIGEM] = origem;
  } else {
    // Ausência É o padrão (a plataforma): apagar em vez de gravar
    // `{ modo: "plataforma" }` deixa o jsonb como o de quem nunca mexeu.
    delete settings[CHAVE_DA_ORIGEM];
  }

  const { error } = await admin.from("organizations").update({ settings }).eq("id", organizationId);
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.origem_do_aviso_alterada",
    actorUserId: ctx.user.id,
    // A organização é o alvo, como na rota do grupo: a linha da auditoria
    // precisa dizer de QUEM é o número que passou a avisar.
    organizationId,
    requestId,
    metadata: { origem },
  });

  return ok({ origem }, { requestId });
}

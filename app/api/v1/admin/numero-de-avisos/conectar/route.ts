/**
 * POST /api/v1/admin/numero-de-avisos/conectar — pareia um número NOVO aqui mesmo.
 *
 * Antes, o número de avisos precisava nascer dentro da tela de Conexões de
 * algum cliente e só depois ser marcado aqui. São dois passos onde a cabeça de
 * quem implanta enxerga um — e o primeiro acontece no lugar errado: um número
 * que serve a plataforma inteira não deveria exigir entrar no tenant de alguém
 * para existir.
 *
 * ⚠️ A sessão AINDA pertence a uma organização, e isso não é detalhe: a coluna
 * é NOT NULL e toda a máquina de conexão, saúde e reconexão é escrita em cima
 * dela. Por isso a tela pergunta em qual organização o número vai morar (a sua,
 * normalmente) em vez de inventar um tenant-fantasma da plataforma — que seria
 * uma organização sem dono, sem plano e sem ninguém olhando, aparecendo em toda
 * listagem e contagem do sistema.
 *
 * O que MUDA é o papel: ao conectar por aqui, o número já nasce marcado como o
 * de avisos. Conectar e esquecer de marcar é o desfecho que os dois passos
 * anteriores produziam.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { connectWahaChannel, ChannelConnectionError } from "@/lib/channels/connect-waha";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  organization_id: z.string().uuid(),
  display_name: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    ctx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });

  const waha = getWahaClient();
  if (!waha) {
    // 503 e uma frase: sem transporte configurado não existe QR para mostrar, e
    // deixar a tela girando é o jeito mais caro de descobrir isso.
    return fail("unavailable", "O contêiner do WhatsApp não está no ar.", 503, { requestId });
  }

  const admin = createAdminClient();

  try {
    /**
     * `admin` nos DOIS lugares de propósito.
     *
     * `connectWahaChannel` recebe um client de sessão (que passa pela RLS) e um
     * de serviço. Aqui quem pede é um admin de PLATAFORMA agindo sobre uma
     * organização que pode não ser a ativa dele — a RLS recusaria, e é ela que
     * está sendo substituída pelo portão de plataforma lá em cima.
     */
    const { channel } = await connectWahaChannel(admin, admin, waha, {
      organizationId: parsed.data.organization_id,
      displayName: parsed.data.display_name ?? "Número de avisos",
      idempotencyKey: randomUUID(),
      userId: ctx.user.id,
      requestId,
    });

    // Já nasce marcado. Desmarcar a anterior primeiro porque o índice único
    // parcial do banco recusaria a segunda marcação com um 23505 cru na tela.
    await admin
      .from("channel_sessions")
      .update({ e_numero_de_avisos: false })
      .eq("e_numero_de_avisos", true);
    await admin
      .from("channel_sessions")
      .update({ e_numero_de_avisos: true })
      .eq("id", channel.id);

    void audit({
      action: "platform.numero_de_avisos_alterado",
      actorUserId: ctx.user.id,
      organizationId: null,
      requestId,
      metadata: { channel_session_id: channel.id, conectado_aqui: true },
    });

    return ok({ channel_session_id: channel.id }, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ChannelConnectionError) {
      return fail(err.code, err.code, err.status, { requestId });
    }
    return fail("internal_error", err instanceof Error ? err.message : "erro", 500, { requestId });
  }
}

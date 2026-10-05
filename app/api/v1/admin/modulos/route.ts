/**
 * QUEM COMPROU O QUÊ — a liberação por módulo, pelo painel da plataforma.
 *
 * GET  → o catálogo inteiro, com o estado de UMA organização (`?organization_id=`).
 *        Devolve os módulos que ela NÃO tem também: a tela precisa oferecer o
 *        que dá para vender, não só listar o que já foi vendido.
 * POST → libera (ou re-libera) um módulo.
 * DELETE → cancela. Não apaga a linha: carimba `revoked_at`, porque apagar
 *        responderia "nunca teve", que é a história errada na conversa em que
 *        alguém pergunta por que a tela sumiu.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODULOS, moduloPorChave } from "@/lib/modulos/vendaveis";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  organization_id: z.string().uuid(),
  modulo: z.string().min(1).max(60),
  note: z.string().trim().max(200).optional(),
});

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

/**
 * FORK MIA — a ESCRITA desta rota exige scope `full` e MFA em dia (upstream
 * 1.70, `requirePlatformAdminEscrita`): o acesso só de leitura ao painel de
 * plataforma (`support_readonly`) lê e não muda nada.
 */
async function exigirPlataformaParaEscrever(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdminEscrita() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const orgId = req.nextUrl.searchParams.get("organization_id");
  if (!orgId) return fail("validation_failed", "organization_id é obrigatório.", 422, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_modules")
    .select("id, modulo, granted_at, revoked_at, note")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  if (error) return fail("db_error", "Falha ao ler os módulos.", 500, { requestId });

  const vivos = new Map((data ?? []).map((l) => [l.modulo as string, l]));

  return ok(
    {
      organization_id: orgId,
      modulos: MODULOS.map((m) => {
        const linha = vivos.get(m.chave);
        return {
          chave: m.chave,
          rotulo: m.rotulo,
          descricao: m.descricao,
          liberado: !!linha,
          granted_at: (linha?.granted_at as string | undefined) ?? null,
          note: (linha?.note as string | null | undefined) ?? null,
          // O que o cliente ganha, em endereços — é o que permite conferir na
          // tela dele sem abrir o código.
          telas: m.telas,
        };
      }),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest) {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = corpoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Pedido inválido.", 422, { requestId });
  }
  // Chave fora do catálogo é recusada: uma liberação para um módulo que não
  // existe ficaria gravada, invisível em toda tela, e reapareceria no dia em
  // que alguém criasse um módulo com aquele nome.
  if (!moduloPorChave(parsed.data.modulo)) {
    return fail("validation_failed", "Módulo desconhecido.", 422, { requestId });
  }

  const admin = createAdminClient();
  // Re-liberar depois de cancelar é caso normal (voltou a contratar), e o
  // índice único só vale para linha viva — então basta inserir de novo.
  const { data, error } = await admin
    .from("organization_modules")
    .insert({
      organization_id: parsed.data.organization_id,
      modulo: parsed.data.modulo,
      note: parsed.data.note ?? null,
      granted_by: ctx.user.id,
    })
    .select("id, modulo, granted_at")
    .single();
  if (error || !data) {
    // Violação do índice único = já estava liberado. Não é erro para quem
    // clicou: o estado desejado já é o atual.
    if ((error as { code?: string } | null)?.code === "23505") {
      return ok({ modulo: parsed.data.modulo, ja_estava: true }, { requestId });
    }
    return fail("db_error", "Falha ao liberar o módulo.", 500, { requestId });
  }

  void audit({
    action: "platform_admin.modulo_liberado",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: parsed.data.organization_id,
    requestId,
    metadata: { modulo: parsed.data.modulo, id: data.id },
  });

  return ok(data, { requestId });
}

export async function DELETE(req: NextRequest) {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  const orgId = req.nextUrl.searchParams.get("organization_id");
  const modulo = req.nextUrl.searchParams.get("modulo");
  if (!orgId || !modulo) {
    return fail("validation_failed", "organization_id e modulo são obrigatórios.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_modules")
    .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.user.id })
    .eq("organization_id", orgId)
    .eq("modulo", modulo)
    .is("revoked_at", null);
  if (error) return fail("db_error", "Falha ao cancelar o módulo.", 500, { requestId });

  void audit({
    action: "platform_admin.modulo_cancelado",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    requestId,
    metadata: { modulo },
  });

  return ok({ organization_id: orgId, modulo }, { requestId });
}

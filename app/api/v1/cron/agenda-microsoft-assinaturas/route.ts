/**
 * As assinaturas de notificação da Graph (de hora em hora).
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 4.5). Cria a que falta, renova a que
 * vence em menos de 48 horas (a Graph aceita no máximo 10.080 min para evento do
 * Outlook) e apaga a de calendário que deixou de ocupar ou receber. Se a
 * assinatura cair, nada para: a leitura periódica continua; só o tempo real
 * espera a próxima rodada.
 */

import { NextResponse, type NextRequest } from "next/server";

import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";
import { tokenDaConexaoMicrosoft } from "@/lib/agenda/microsoft/conexao";
import { garantirAssinaturas } from "@/lib/agenda/microsoft/notificacoes";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TETO_DE_CONEXOES = 50;

async function executar(req: NextRequest) {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: { code: "unauthenticated", message: "cron secret inválido" } }, { status: 401 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .select("id, organization_id, user_id")
    .eq("status", "healthy")
    .order("updated_at")
    .limit(TETO_DE_CONEXOES);
  if (error) {
    return NextResponse.json({ error: { code: "internal_error", message: "Não foi possível ler as conexões." } }, { status: 500 });
  }
  const conexoes = await apenasDeMembrosAtivos(db, (data ?? []) as Array<{ id: string; organization_id: string; user_id: string }>);

  const total = { criadas: 0, renovadas: 0, apagadas: 0, falhas: 0 };
  for (const conexao of conexoes) {
    try {
      const token = await tokenDaConexaoMicrosoft(db, conexao.organization_id, conexao.id);
      const r = await garantirAssinaturas(db, conexao.organization_id, conexao.id, token);
      total.criadas += r.criadas;
      total.renovadas += r.renovadas;
      total.apagadas += r.apagadas;
      total.falhas += r.falhas;
    } catch {
      total.falhas += 1;
    }
  }

  if (total.criadas + total.renovadas + total.apagadas + total.falhas > 0) {
    await audit({ action: "agenda.microsoft.assinaturas_executadas", metadata: { conexoes: conexoes.length, ...total } });
  }
  return NextResponse.json({ data: { conexoes: conexoes.length, ...total } });
}

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

/**
 * A ida para o Outlook (a cada 5 min, como a do Google).
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.8). Pega o que a
 * `fn_mia_agenda_microsoft_a_publicar` aponta (compromisso novo cujo destino é
 * o Outlook, vínculo com mudança daqui, releitura do que ainda não passou,
 * decisão de conflito registrada) e reconcilia um a um. Quem saiu da empresa
 * não tem a agenda tocada.
 */

import { NextResponse, type NextRequest } from "next/server";

import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";
import { rpcMicrosoft } from "@/lib/agenda/microsoft/calendar-executor";
import { reconciliarCompromissoMicrosoft } from "@/lib/agenda/microsoft/sync-executor";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function executar(req: NextRequest) {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: { code: "unauthenticated", message: "cron secret inválido" } }, { status: 401 });
  }
  const db = createAdminClient();
  let candidatos: Array<{ id: string; organization_id: string; user_id: string }>;
  try {
    candidatos = ((await rpcMicrosoft(db, "fn_mia_agenda_microsoft_a_publicar", { p_limite: 50 })) ?? []) as typeof candidatos;
  } catch {
    return NextResponse.json(
      { error: { code: "internal_error", message: "Não foi possível ler os compromissos do Outlook." } },
      { status: 500 },
    );
  }
  const ativos = await apenasDeMembrosAtivos(db, candidatos);

  const efeitos = new Map<string, number>();
  const resumo = { processados: 0, inalterados: 0, falhas: 0, ocupados: 0 };
  for (const c of ativos) {
    const r = await reconciliarCompromissoMicrosoft(db, c.organization_id, c.id);
    if (r === "processed" || r === "terminal") {
      resumo.processados += 1;
      efeitos.set(c.organization_id, (efeitos.get(c.organization_id) ?? 0) + 1);
    } else if (r === "unchanged") resumo.inalterados += 1;
    else if (r === "busy") resumo.ocupados += 1;
    else {
      resumo.falhas += 1;
      efeitos.set(c.organization_id, (efeitos.get(c.organization_id) ?? 0) + 1);
    }
  }

  // Entrega 3: compromisso de tipo Teams cujo responsável publica no Google (ou
  // não tem destino) não pode ter o Teams. A Central avisa uma vez.
  let semOutlook = 0;
  try {
    semOutlook = Number((await rpcMicrosoft(db, "fn_mia_agenda_microsoft_teams_sem_outlook", { p_limite: 50 })) ?? 0);
  } catch {
    semOutlook = 0;
  }

  for (const [organizationId, quantidade] of efeitos) {
    if (quantidade > 0) {
      await audit({
        action: "agenda.microsoft.publicacao_executada",
        organizationId,
        metadata: { direcao: "ida", compromissos: quantidade },
      });
    }
  }
  return NextResponse.json({ data: { candidatos: candidatos.length, teams_sem_outlook: semOutlook, ...resumo } });
}

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

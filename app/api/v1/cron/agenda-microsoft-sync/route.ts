/**
 * A volta do Outlook: lê as agendas que estão na hora (a cada minuto).
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 4.2 e 4.5). Espelha
 * `agenda-google-sync` do upstream, com uma diferença de cadência: roda a cada
 * minuto, mas só lê o que está VENCIDO (`proxima_leitura_em`). Cada calendário
 * lido volta para a fila em 15 minutos, como no Google; a notificação da Graph
 * põe o calendário na frente da fila na hora. Rodada sem nada vencido é uma
 * consulta indexada e nenhuma chamada à Microsoft.
 *
 * O catálogo de cada conta é relido uma vez por dia (agenda nova, agenda que
 * sumiu, Teams que passou a ser permitido).
 */

import { NextResponse, type NextRequest } from "next/server";

import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";
import { atualizarCatalogoMicrosoft, lerCalendarioMicrosoft } from "@/lib/agenda/microsoft/calendar-executor";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TETO_DE_CALENDARIOS = 25;
const TETO_DE_CATALOGOS = 5;
const UM_DIA_MS = 86_400_000;

interface CalendarioVencido {
  id: string;
  organization_id: string;
  conexao_id: string;
  conta_como_ocupado: boolean;
  destino: boolean;
}

interface ConexaoAtiva {
  id: string;
  organization_id: string;
  user_id: string;
}

async function executar(req: NextRequest) {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: { code: "unauthenticated", message: "cron secret inválido" } }, { status: 401 });
  }
  const db = createAdminClient();
  const agora = new Date();
  const efeitos = new Map<string, number>();
  const somar = (org: string) => efeitos.set(org, (efeitos.get(org) ?? 0) + 1);

  const { data: conexoesBrutas, error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .select("id, organization_id, user_id")
    .eq("status", "healthy");
  if (error) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "Não foi possível ler as conexões do Outlook." } },
      { status: 500 },
    );
  }
  const conexoes = await apenasDeMembrosAtivos(db, (conexoesBrutas ?? []) as ConexaoAtiva[]);
  const ativas = new Set(conexoes.map((c) => c.id));

  // 1. Catálogos velhos (mais de um dia), poucos por rodada.
  let catalogos = 0;
  for (const conexao of conexoes) {
    if (catalogos >= TETO_DE_CATALOGOS) break;
    const { data: maisVelho } = await db
      .from("mia_agenda_microsoft_calendarios")
      .select("catalogo_conferido_em")
      .eq("organization_id", conexao.organization_id)
      .eq("conexao_id", conexao.id)
      .order("catalogo_conferido_em", { nullsFirst: true })
      .limit(1);
    const conferido = maisVelho?.[0]?.catalogo_conferido_em as string | null | undefined;
    if (maisVelho && maisVelho.length > 0 && conferido && Date.parse(conferido) > agora.getTime() - UM_DIA_MS) continue;
    catalogos += 1;
    try {
      await atualizarCatalogoMicrosoft(db, conexao.organization_id, conexao.id);
      somar(conexao.organization_id);
    } catch {
      await db
        .from("mia_agenda_microsoft_conexoes")
        .update({ ultimo_erro: "Não foi possível atualizar a lista de agendas. Confira a conexão nas configurações." })
        .eq("organization_id", conexao.organization_id)
        .eq("id", conexao.id);
    }
  }

  // 2. As leituras vencidas.
  const { data: vencidos } = await db
    .from("mia_agenda_microsoft_calendarios")
    .select("id, organization_id, conexao_id, conta_como_ocupado, destino")
    .eq("disponivel", true)
    .lte("proxima_leitura_em", agora.toISOString())
    .order("proxima_leitura_em")
    .limit(TETO_DE_CALENDARIOS * 2);

  let lidos = 0;
  for (const k of (vencidos ?? []) as CalendarioVencido[]) {
    if (lidos >= TETO_DE_CALENDARIOS) break;
    if (!ativas.has(k.conexao_id)) continue;
    if (!k.conta_como_ocupado && !k.destino) {
      // Sem consumidor: sai da fila por um dia. A escolha nova rearma o prazo.
      await db
        .from("mia_agenda_microsoft_calendarios")
        .update({ proxima_leitura_em: new Date(agora.getTime() + UM_DIA_MS).toISOString() })
        .eq("organization_id", k.organization_id)
        .eq("id", k.id);
      continue;
    }
    lidos += 1;
    const resultado = await lerCalendarioMicrosoft(db, k.organization_id, k.id);
    if (resultado !== "busy") somar(k.organization_id);
  }

  for (const [organizationId, quantidade] of efeitos) {
    if (quantidade > 0) {
      await audit({
        action: "agenda.microsoft.sync_executado",
        organizationId,
        metadata: { direcao: "volta", calendarios: quantidade },
      });
    }
  }
  return NextResponse.json({ data: { conexoes: conexoes.length, calendarios: lidos, catalogos } });
}

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

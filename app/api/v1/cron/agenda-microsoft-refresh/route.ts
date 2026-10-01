/**
 * A renovação dos tokens da Microsoft (a cada 10 min).
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 4.1). Espelha `agenda-google-refresh`
 * do upstream: varre quem vence nos próximos 15 minutos, renova pela MESMA
 * função que o uso na hora (`renovarConexaoMicrosoft`) e só audita rodada que
 * fez alguma coisa. O token da Microsoft dura de 60 a 90 minutos, e renovar de
 * hora em hora é também o que impede o `refresh_token` de vencer por 90 dias de
 * inatividade enquanto a conexão está ligada.
 */

import { NextResponse, type NextRequest } from "next/server";

import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";
import { precisaRenovar } from "@/lib/agenda/google/oauth";
import { configuracaoDaMicrosoft } from "@/lib/agenda/microsoft/config";
import { COLUNAS_DA_CONEXAO, renovarConexaoMicrosoft, type LinhaDaConexaoMicrosoft } from "@/lib/agenda/microsoft/conexao";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const JANELA_DE_RENOVACAO_MS = 15 * 60 * 1000;
export const TETO_POR_RODADA = 50;

export interface ResumoDaRenovacaoMicrosoft {
  examinadas: number;
  renovadas: number;
  reautenticar: number;
  falhas: number;
  semApp: boolean;
}

export async function renovarAgendasDaMicrosoft(
  admin: ReturnType<typeof createAdminClient>,
  opcoes: { agora: Date },
): Promise<ResumoDaRenovacaoMicrosoft> {
  const resumo: ResumoDaRenovacaoMicrosoft = { examinadas: 0, renovadas: 0, reautenticar: 0, falhas: 0, semApp: false };
  const app = await configuracaoDaMicrosoft();
  if (!app) {
    resumo.semApp = true;
    return resumo;
  }

  const limite = new Date(opcoes.agora.getTime() + JANELA_DE_RENOVACAO_MS).toISOString();
  const { data, error } = await admin
    .from("mia_agenda_microsoft_conexoes")
    .select(COLUNAS_DA_CONEXAO)
    .in("status", ["healthy", "rate_limited"])
    .not("token_expira_em", "is", null)
    .lte("token_expira_em", limite)
    .order("token_expira_em", { ascending: true })
    .limit(TETO_POR_RODADA);
  if (error || !data) return resumo;

  // Quem saiu da empresa para de ter a agenda lida: o token não sabe de RH.
  const linhas = await apenasDeMembrosAtivos(admin, data as unknown as LinhaDaConexaoMicrosoft[]);
  for (const linha of linhas) {
    resumo.examinadas += 1;
    if (!precisaRenovar(linha.token_expira_em, opcoes.agora, JANELA_DE_RENOVACAO_MS)) continue;
    const r = await renovarConexaoMicrosoft(admin, linha, app, opcoes.agora);
    if (r.ok) resumo.renovadas += 1;
    else if (r.situacao === "token_expired") resumo.reautenticar += 1;
    else resumo.falhas += 1;
  }

  if (resumo.renovadas > 0 || resumo.reautenticar > 0 || resumo.falhas > 0) {
    await audit({
      action: "agenda.microsoft.renovacao_executada",
      metadata: {
        examinadas: resumo.examinadas,
        renovadas: resumo.renovadas,
        reautenticar: resumo.reautenticar,
        falhas: resumo.falhas,
      },
    });
  }
  return resumo;
}

async function executar(req: NextRequest): Promise<Response> {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: { code: "unauthenticated", message: "cron secret inválido" } }, { status: 401 });
  }
  const resumo = await renovarAgendasDaMicrosoft(createAdminClient(), { agora: new Date() });
  return NextResponse.json({ data: resumo });
}

export async function GET(req: NextRequest): Promise<Response> {
  return executar(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return executar(req);
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";

import { AnaliseDoFunilClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Análise do funil" };

/**
 * FORK MIA (item 8) — A ANÁLISE DO FUNIL, a tela que faltava.
 *
 * Decisão do protótipo aprovado em 15/10/2026: "fazemos agora, por cima da
 * conta que o sistema-base já tem e ainda não mostra em tela nenhuma". A conta
 * é do upstream (`lib/metrics/funil.ts`, issue #1750) e a rota também
 * (`GET /api/v1/metrics/funil`): conversão etapa a etapa reconstruída das
 * passagens de etapa, dias do primeiro contato ao fechamento (mediana e
 * quartis), origem × situação com valor por moeda e a contra-métrica (turnos e
 * opt-outs). Nada é recalculado aqui: a tela só desenha o que a rota devolve.
 *
 * Mesmo piso da rota: todo membro abre, e a RLS decide o que cada um vê (o
 * atendente, os negócios dele).
 */
export default async function AnaliseDoFunilPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  return <AnaliseDoFunilClient />;
}

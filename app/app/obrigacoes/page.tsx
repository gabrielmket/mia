import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";

import { ObrigacoesClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Obrigações" };

/**
 * FORK MIA — OBRIGAÇÕES: a agenda de renovações da carteira.
 *
 * Todos os documentos e as atividades recorrentes de todos os negócios,
 * empresas e contatos, do mais urgente para o menos: o que venceu, o que vence
 * em 30 dias, o que foi pedido e não chegou, e o que está em dia. A situação é
 * calculada pelas datas (`lib/obrigacoes/situacao.ts`); ninguém a digita.
 *
 * ─── Quem pode o quê ───────────────────────────────────────────────────────
 *
 * `viewer` VÊ a lista (é informação de operação, como as Tarefas). Adicionar,
 * pedir, receber e marcar feita é `agent`, e a rota cobra de novo. O que cada
 * pessoa vê é decidido pela RLS: o item de um negócio que ela não enxerga não
 * aparece (migration 9018).
 */
export default async function ObrigacoesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  return <ObrigacoesClient />;
}

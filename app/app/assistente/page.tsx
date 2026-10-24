import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";

import { AssistenteClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assistente" };

/**
 * FORK MIA (.88) — O ASSISTENTE DA MIA, a página: o histórico de cada pessoa, o
 * resumo da manhã e os chamados para a Time Company; para o administrador, a
 * base própria da empresa ("como trabalhamos aqui"), quem usa e as perguntas
 * que ficaram sem resposta.
 *
 * O painel do assistente também abre ao lado de qualquer tela, pelo botão do
 * topo. Todo dado desta página vem das rotas `/api/v1/assistente/*`, que leem
 * pela sessão (a RLS da 9050 decide o que cada pessoa vê).
 */
export default async function AssistentePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  return <AssistenteClient />;
}

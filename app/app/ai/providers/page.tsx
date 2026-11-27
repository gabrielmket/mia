import { redirect } from "next/navigation";

import { podeConfigurarChaveDeIa } from "@/lib/ai/custo-e-da-plataforma";
import { escolheIa } from "@/lib/ai/trava-da-ia";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { PainelDeProvedores } from "./_components/PainelDeProvedores";

export const dynamic = "force-dynamic";

/**
 * Onde o dono do negócio vê e escolhe qual IA atende cada parte do sistema.
 *
 * O sistema chama modelo em 23 lugares. Até esta tela existir, a escolha estava
 * espalhada por três pilhas de código e sete variáveis de ambiente, e não havia
 * lugar nenhum onde a pergunta "quem usa IA aqui, e com qual chave?" tivesse
 * resposta — o que transformava qualquer falha de configuração em falha muda.
 *
 * Os dados vêm do endpoint (`/api/v1/ai/providers`) e não de uma consulta aqui:
 * a mesma resolução de precedência precisa valer para a tela e para o runtime,
 * e duas leituras diferentes da mesma configuração é como se cria a tela que
 * mente.
 */
export default async function ProvedoresPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  // FORK MIA (MIA-262): a tela inteira é escolha de IA (provedor, modelo, chave,
  // Jev, embedding, voz e mapas), e escolher é da plataforma. Entra o admin da
  // plataforma e a plataforma em suporte com edição; a empresa e a agência, não.
  if (!escolheIa(user)) redirect("/403");

  // FORK MIA (MIA-218): o link da chave própria só para o admin da plataforma.
  return <PainelDeProvedores podeCadastrarChave={podeConfigurarChaveDeIa(user)} />;
}

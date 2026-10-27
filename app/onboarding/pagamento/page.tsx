import { redirect } from "next/navigation";

import { PassoDoPagamento } from "@/components/pagamento-inicial/PassoDoPagamento";
import { orgAtivaSemPortao, requireAuth } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { marcaDaSaida } from "@/lib/branding/saida";
import { lerPassoDoPagamento } from "@/lib/pagamento-inicial/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * FORK MIA (.96) · O PASSO "PAGAMENTO" DO INÍCIO (protótipo "Pagamento no
 * início", aprovado em 27/10/2026; docs/fork/pagamento-no-inicio.md).
 *
 * Antes do "Seu negócio", em dois modos:
 *   - ENTRADA PAGA (plano sem teste, ou o fim do teste sem pagamento): a empresa
 *     está parada e paga aqui, por Pix, cartão digitado (checkout transparente
 *     do Asaas) ou boleto (este, não no fim do teste). A tela confere sozinha e
 *     mostra "Pagamento confirmado";
 *   - PLANO COM TESTE: "Nada é cobrado hoje"; a pessoa escolhe como paga depois
 *     do teste (cartão cadastrado agora, ou Pix 3 dias antes do fim) e segue.
 *
 * A organização é a da sessão SEM o portão da suspensão (`orgAtivaSemPortao`):
 * a empresa que espera o primeiro pagamento está suspensa, e é aqui que ela paga.
 * Empresa sem o passo volta ao roteador do início.
 */
export default async function PagamentoPage() {
  const user = await requireAuth();
  if (user.support) redirect("/app/inbox");
  const org = await orgAtivaSemPortao(user);
  if (!org) redirect("/get-started");
  const admin = createAdminClient();
  const passo = await lerPassoDoPagamento(admin, org.orgId, { podePagar: roleAtLeast(org.role, "admin") });
  if (passo.modo === null) redirect("/onboarding");
  const marca = await marcaDaSaida(null);
  return <PassoDoPagamento inicial={passo} marca={marca.nome} />;
}

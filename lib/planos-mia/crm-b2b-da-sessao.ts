/**
 * FORK MIA (.90) — Vendas B2B fora do plano, para a SESSÃO que pergunta.
 *
 * As rotas do B2B do upstream perguntam só "o módulo da instalação está
 * ligado?" (`seModuloB2bDesligado`, sem organização). Com a cobrança ligada, a
 * empresa que está num plano sem Vendas B2B também não o usa: este é o ponto
 * que a rota, a tela e o menu chamam, com a organização ativa da sessão.
 *
 * Com a cobrança desligada, devolve `false` sem ler a sessão nem o banco além da
 * chave: nada muda para ninguém. Sem sessão (a rota vai recusar sozinha pela
 * autenticação dela), também `false`.
 */
import { loadAuthUser, orgAtivaSemPortao } from "@/lib/auth/server";
import { moduloLigado, modulosLigados, type ModuloOpcional } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

import { crmB2bForaDoPlano } from "./modulos";

export async function crmB2bForaDoPlanoDaSessao(): Promise<boolean> {
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return false;
  const user = await loadAuthUser();
  if (!user) return false;
  // Admin de plataforma fora de acompanhamento enxerga tudo: é ele quem libera.
  if (user.is_platform_admin && !user.support) return false;
  const org = await orgAtivaSemPortao(user);
  if (!org) return false;
  return crmB2bForaDoPlano(admin, org.orgId, true);
}

/**
 * Os módulos da instalação como o menu DESTA empresa os enxerga: a lista de
 * `modulosLigados`, menos Vendas B2B fora do plano. Para os hubs que desenham o
 * inventário (o do CRM). Desligada a cobrança, é a lista de sempre.
 */
export async function modulosLigadosParaASessao(): Promise<ModuloOpcional[]> {
  const ligados = await modulosLigados(createAdminClient());
  if (!ligados.includes("crm_b2b") || !ligados.includes("cobranca")) return ligados;
  return (await crmB2bForaDoPlanoDaSessao()) ? ligados.filter((m) => m !== "crm_b2b") : ligados;
}
